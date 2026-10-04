# Daling 微信客服接入器

这是运行在**有固定公网出口 IP 的服务器**上的独立 Node 服务。网站负责账号、10 题 AI 对话和匹配报告；本服务只接收微信客服回调、可靠排队、转发给网站，再将回复发回微信。无需安装任何 npm 依赖，推荐 Node 24；最低 Node 22.13（使用内置 `node:sqlite`）。

**目前代码具备接入能力；未配置企业微信账号、凭证、可信 IP、回调域名及网站桥接密钥时，微信服务尚未开通。单元测试不代表实际微信账号已经连通。**

网页：<https://daling-ai-matching-smile.harebod.chatgpt.site/>

## 1. 企业微信后台准备

1. 登录企业微信管理员后台，在企业微信里使用微信客服，创建「妲灵」客服账号。
2. 创建并启用一个自建应用。进入「微信客服 → API → 可调用接口的应用」，授权这个应用。
3. 在「通过 API 管理微信客服账号 → 企业内部开发」选择妲灵账号。原生自动接待规则会暂停，由接入器负责收发消息。若配置接待人员，将人员放进应用可见范围。
4. 记录企业 ID `CorpID`、**授权自建应用的 Secret**、客服账号 `open_kfid`。
5. 配置企业可信 IP 为这台服务器的**公网出口 IP**。回调域名按后台要求使用可验证的自有域名；已认证主体可能需要与备案主体对应。共享托管网站的出口 IP 不能假定可以直接使用。
6. 完成下一节服务器部署后，将回调 URL 填为 `https://wechat.example.com/wechat/callback`，设置相同的 `Token` 和 `EncodingAESKey`，保存通过 URL 验证。
7. 在客服后台获取客服链接/二维码，提供给用户。也可调用官方获取客服链接接口。普通客户从自己的微信进入，无需加入企业。

从 2023-12-01 起，新接入不支持用微信客服系统应用 Secret 调用 API；存量企业例外。这里统一使用获授权自建应用的 Secret。

## 2. 配置网站和接入器

在**网站的服务端机密配置**设置：

```text
WECHAT_ENABLED=true
DALING_WECHAT_BRIDGE_SECRET=<至少43字符的随机密钥>
WECHAT_CORP_ID=<企业ID>
WECHAT_OPEN_KFID=<客服账号ID>
```

`DALING_WECHAT_BRIDGE_SECRET` 两端必须相同。可生成 32 随机字节的 base64url：

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"
```

将本目录 `.env.example` 复制成服务器私有文件，例如 `/etc/daling-wechat.env`，填入对应值，文件权限设为 `600`。**不要将填好的文件、SQLite 数据库、应用 Secret 或桥接密钥上传 GitHub。** 微信应用 Secret、回调 Token 和 AES key 只放在接入服务器，不需要给网页前端。

| 配置 | 用途 |
| --- | --- |
| `DALING_SITE_URL` | 网站的 HTTPS origin，不能包含账号、密码、路径或查询参数 |
| `DALING_WECHAT_BRIDGE_SECRET` | 网站与本服务共用的随机密钥，至少 43 字符 |
| `WECHAT_CORP_ID` | 企业 ID |
| `WECHAT_APP_SECRET` | 获授权且已启用的自建应用 Secret |
| `WECHAT_OPEN_KFID` | 单个客服账号 ID；一个实例对应一个账号 |
| `WECHAT_TOKEN` | 回调签名 Token，1–32 个英文字母或数字 |
| `WECHAT_ENCODING_AES_KEY` | 后台配置的 43 字符 AES key |
| `WECHAT_HOST` / `WECHAT_PORT` | 默认 `127.0.0.1:8788`，由 HTTPS 代理访问 |
| `WECHAT_DB_PATH` | 私有 SQLite 文件；默认在用户目录 `.local/state/daling-wechat/` |
| `WECHAT_START_AT` | 首次启动的 ISO UTC 时间或 Unix 秒数；为空时记录首次启动时间，此后从数据库保持 |

首次同步会从腾讯最近 3 天的历史开始拉取，但**早于初始水位、或延迟超过 1 小时的消息不会进入 AI 或补发回复**。请在用户测试前启动服务；不要为重启而删除数据库或随意调低初始水位。

## 3. 部署：systemd + Caddy

将本目录放到 `/opt/daling/integrations/wechat`，服务器安装 Node 24 和 Caddy。创建专用系统用户 `daling-wechat`。环境文件由 root 管理，权限 `600`。

示例 `/etc/systemd/system/daling-wechat.service`：

```ini
[Unit]
Description=Daling WeChat customer service relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=daling-wechat
Group=daling-wechat
WorkingDirectory=/opt/daling/integrations/wechat
EnvironmentFile=/etc/daling-wechat.env
ExecStart=/usr/bin/node /opt/daling/integrations/wechat/relay.mjs
Restart=on-failure
RestartSec=5
StateDirectory=daling-wechat
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/daling-wechat
TimeoutStopSec=240

[Install]
WantedBy=multi-user.target
```

确保环境文件的 `WECHAT_DB_PATH=/var/lib/daling-wechat/relay.sqlite`。启动：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now daling-wechat
sudo systemctl status daling-wechat
```

Caddyfile（替换成已配置 DNS、满足企业微信校验要求的自有域名）：

```caddyfile
wechat.example.com {
    handle /wechat/callback {
        reverse_proxy 127.0.0.1:8788
    }
    handle {
        respond "Not found" 404
    }
}
```

Caddy自动管理 HTTPS；服务器开放 80/443，8788 留在本机。不要启用包含回调查询串或正文的代理访问日志；查询串内含加密验证数据。`/health` 只返回 `ok`，本例不对公网暴露。

## 4. 部署：Docker

Docker 必须仍运行在你自己的固定出口服务器上，不能省略企业可信 IP。HTTPS 使用上面的宿主机 Caddy。

```sh
docker build -t daling-wechat ./integrations/wechat
docker volume create daling-wechat-data
docker run -d --name daling-wechat --restart unless-stopped \
  --env-file /etc/daling-wechat.env \
  -e WECHAT_HOST=0.0.0.0 -e WECHAT_DB_PATH=/data/relay.sqlite \
  -p 127.0.0.1:8788:8788 \
  -v daling-wechat-data:/data daling-wechat
```

命名卷保存队列和游标。不要用无持久卷的容器，也不要同时部署多副本处理同一数据库。数据库含个人文本，请限制卷访问及备份权限。

## 5. 用户使用顺序

1. 用户在网页注册/登录，进入 `/account`。
2. 在「微信里接着聊」生成绑定码，复制 `绑定 DL-…` 指令。绑定码 10 分钟内有效，只能使用一次。
3. 打开妲灵客服链接或二维码，在微信客服会话发送该指令。
4. 绑定后，微信与网页共用当前对话进度。微信普通文本交给网站现有 AI 流程；用户可提前匹配、查看进度和匹配结果。
5. 在网站账号设置可以解除微信绑定。

网站只有在 `WECHAT_ENABLED=true`、桥接密钥及客服身份配置完整时显示「微信里接着聊」。请在自己账号的完整实测通过后再将二维码公开。微信客服接入不会自动提升匹配人数，也不会把演示档案变成真实用户。

## 6. 可靠性与限制

| 环节 | 行为 |
| --- | --- |
| GET 回调验证 | 验签、解密 `echostr`，原样返回明文，不附加换行；无需访问 AI |
| POST 回调 | 验签解密并 SQLite WAL + FULL 落盘后立即返回空 200；落盘失败返回 503，正文限 128 KiB |
| 重复通知/消息 | 密文摘要去重，客户 `msgid` 去重，网站再做消息级幂等 |
| 同步 | 持久化 `next_cursor`；即使空 `msg_list` 也按 `has_more` 继续；通知 token 过期不复用 |
| 回调丢失 | 启动和每 5 分钟从持久游标对齐一次消息，过期 token 不参与同步 |
| 人工接管 | AI 前和发回前均查客服状态，只允许 0 未处理、1 智能助手；2/3/4 跳过 |
| AI 暂时忙 | 网站 409/503 或网络失败退避重试同一 `msgid`，保持问答顺序；重试消息超过 1 小时停止 |
| 已知发送拒绝 | 同一 `msgid` 重取网站幂等回复并重新核对绑定，无需重新调用 AI；已过期消息停止发送 |
| 发送结果未知 | 超时、断网、非 JSON 响应或发送中进程崩溃，标记 `uncertain`，**不自动重发**；避免重复发送 |
| 发送失败事件 | 处理 `msg_send_fail`，将对应回复记为失败，不当作客户新回答 |
| 多实例误启动 | SQLite worker lease 防止同时处理；崩溃后的旧 lease 最迟约 4 分钟释放 |
| 保留时限 | relay 正文、回复、通知最多保留约 72 小时；自动删除并清除已过期 token，SQLite secure_delete + WAL checkpoint；外部备份需另外管理 |
| 日志 | 只输出操作名、状态及错误码，不输出用户文本、ID、凭证或完整请求 URL |

腾讯限制：客户主动发送后 48 小时内最多连续回复 5 条，客户再发消息后重新计算；本服务每条输入只发送**一条**回复，最多 2048 UTF-8 字节。网站回复过长会保留完整字符后截断；匹配报告宜提供摘要和登录后的网页入口。

`send_msg` 返回成功并不等于最终送达。因此 `sent` 表示接口接受，发送失败事件仍可更新状态。`uncertain` 需结合微信中的实际收到情况核对；不要批量改成 `ready` 重发。用户可发送一条新的「进度」消息继续。

网站解绑或删除账号会清除网站关联，**不能撤回已生成、正在发送、已发送或送达状态未知的微信回复**。relay 还可能保留待处理正文与回复，按约 72 小时保留规则清理；解绑不代表接入服务器上的缓存立刻删除。部署者如需处理提前删除请求，应暂停服务、定位授权请求对应记录并清理服务器数据库及其备份，不能声称微信聊天副本也已删除。

暂停服务/取消公开前，应先在微信客服后台切回人工或关闭对应服务，避免 API 模式继续接收用户但无法响应。

## 7. 检查与测试

本地没有凭证也能运行隔离测试：

```sh
node --test integrations/wechat/relay.test.mjs
```

测试包括腾讯官方独立加密向量、签名/receiver 验证、XML 外部实体拒绝、HTTP 空应答和落盘失败、SQLite 重启恢复、历史过滤、消息去重、空列表续拉、人工接管、AI 重试顺序、未知发送防重复、失败事件、token 刷新、UTF-8 限长及 72 小时清理。测试使用虚构用户与临时数据库，不向真实微信或 AI 服务发送消息。

实际开通需用自己的测试微信检查：URL 验证成功 → 用户绑定 → 一次正常 AI 回答 → 提前匹配及摘要 → 网站看到同一轮进度 → 人工接管期间不会被 AI 覆盖。

常见诊断：`60020` 检查可信出口 IP；`60030` 检查接待人员可见范围；`site_401/403` 检查两端桥接密钥和客服身份；回调验证失败检查域名、Token、43 字符 AES key、CorpID，以及服务器时间是否同步。直接 API 凭证过期会自动刷新一次。

## 官方依据

- [微信客服概述与授权自建应用](https://developer.work.weixin.qq.com/document/path/94638)
- [接收消息、回调 token、cursor、origin 与失败事件](https://developer.work.weixin.qq.com/document/path/94670)
- [发送消息、48 小时/5 条及 2048 字节](https://developer.work.weixin.qq.com/document/path/94677)
- [客服状态 0–4](https://developer.work.weixin.qq.com/document/path/94669)
- [回调验证 1 秒与 POST 5 秒要求](https://developer.work.weixin.qq.com/document/path/90930)
- [官方消息签名与 AES 加解密说明](https://developer.work.weixin.qq.com/document/path/90968)
- [获取并缓存 access_token](https://developer.work.weixin.qq.com/document/path/91039)
- [获取公开客服链接](https://developer.work.weixin.qq.com/document/path/94665)
- [自建应用可信 IP 安全升级公告](https://developer.work.weixin.qq.com/community/announcement/detail?content_id=16334603338859177543)

截至 2026-10-04 核对；账号资质、域名校验和接待额度以企业微信管理后台当前显示为准。
