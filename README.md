# 妲灵双向交友匹配

基于原命令行问卷的公开网页测试版。原文件只有问答，没有真正匹配；本项目新增账号、资料保存、双向筛选、心动确认和自主删除。原型分析与任务拆解见 [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md)。

## 已实现

- 用户名和密码注册、登录、退出、修改密码与永久删除账号。账号、会话和限流记录存于 Cloudflare D1；密码以每人独立盐值及 PBKDF2-SHA256 哈希保存，会话令牌只在数据库保存 SHA-256 摘要。
- 匿名填写浏览器标签页内的草稿，注册后继续填写。成年人资料需单独同意加入匹配池。
- 双方性别、年龄、城市和身高期待都符合后，才进入候选池；共同兴趣等仅影响显示顺序。
- 双方都选择“想认识”且都授权分享联系方式后，才显示对方填写的联系方式；支持撤回、屏蔽、关闭可见性及删除资料。
- 可选 DeepSeek 自我介绍整理：用户主动点击才发送自述，AI 返回预览，用户确认后才进入资料。AI 不决定匹配资格或联系方式权限。
- 响应式手机与桌面页面、资料与隐私说明、使用规则。

## 本地运行

要求 Node.js 22.13+：

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_keen_mysterio.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_smart_yellowjacket.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_warm_blue_blade.sql
npm run dev
```

不要重复执行已经应用的迁移。配置 `DEEPSEEK_API_KEY` 为服务端运行时 secret 才能使用 AI 助手；不用 AI 时其余功能照常工作。密钥不得写入仓库、浏览器代码或构建产物。当前账号只用用户名和密码，没有邮件或找回密码流程。

## 数据与部署

`.openai/hosting.json` 使用 D1 绑定 `DB`。`db/schema.ts` 是数据库表定义。生产环境通过 Sites 保存服务端 secret、运行迁移、推送源码并发布版本。所有涉及资料和互动的 API 都校验站内会话，写入 API 还校验请求来源。原脚本中出现过的明文密钥应在相应服务商后台撤销。

## 已知限制

这是公开测试版，没有身份证核验、照片、站内私信、密码找回或人工举报处理。大规模公开推广前应增加滥用处置和运营支持。候选池目前一次读取最近 1000 个公开用户；用户量增加后应做数据库预筛选和分页。
