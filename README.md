# 妲灵双向交友匹配

公开网页测试版，复刻原命令行脚本的逐题交谈体验，并补上账号、资料持久化、双向匹配和报告。详细的原型审计、实现边界、任务拆解与 Agent 能力对比见 [技术分析](./TECHNICAL_ANALYSIS.md)。

## 使用流程

1. 访问首页，先用站内用户名和密码注册或登录。账号与 ChatGPT 无关；注册需确认年满 18 岁。
2. 与妲灵逐题交谈。当前共有 13 个引导话题，从称呼、年龄、城市和择偶条件，逐步到兴趣、自述与可选信息。每次回答仅推进当前话题；答非所问或字段不明确时会留在原题追问。可选话题可输入“跳过”。
3. 对话记录、进度和资料草稿保存在 D1，刷新页面可继续。结束后核对提取结果，确认成年人身份与资料用途；是否进入真实用户匹配池、是否分享联系方式分别选择。若需修改结构化字段，可重新对话，或保存后在“我的资料与真实匹配”编辑。
4. 保存后自动生成规则匹配报告：展示 18 份**虚构样例**中的合格数量、前几名及理由，另列真实报名者。虚构样例不能心动或联系，真实池为空时如实显示。用户再次勾选授权后，可让 AI 为样例结果生成文字解读；AI 不改动匹配资格和排序。

## 技术结构

| 部分 | 实现 |
| --- | --- |
| 网页 | React、Next.js 兼容的 Vinext、Cloudflare Workers；手机和桌面响应式布局 |
| 账号 | 站内用户名和密码；独立随机盐值与分段 PBKDF2-SHA256 密码哈希；仅保存会话令牌摘要，浏览器使用 HttpOnly Cookie |
| 数据 | Cloudflare D1 中的账号、会话、资料、对话、心动、屏蔽、限流和 AI 解读缓存；虚构样例仅在 [`lib/demo-profiles.ts`](./lib/demo-profiles.ts) 代码中 |
| 对话 | [`lib/conversation.ts`](./lib/conversation.ts) 的服务端状态机；DeepSeek 解析当前回答并给出简短回复，字段经服务端校验；模型不可改变年龄、授权或题目顺序 |
| 匹配 | [`lib/matching.ts`](./lib/matching.ts) 的双方性别、年龄、城市与身高硬条件；同城与共同兴趣等仅影响排序；报告在 [`lib/report.ts`](./lib/report.ts) 构建 |
| 互动 | 仅真实报名者可心动或屏蔽；双方都心动且都授权分享时，才显示彼此填写的联系方式 |

对话与报告可在 AI 不可用时使用服务端备用解析或规则报告。自然语言理解会因此变弱；用户应核对最终资料。对话不收取联系方式；联系方式在核对环节单独填写，不发送给 AI。DeepSeek 密钥只以服务端 `DEEPSEEK_API_KEY` secret 保存，不写入仓库或浏览器包。

## 本地运行

要求 Node.js 22.13+。首次创建本地 D1 时，在项目根目录执行：

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_keen_mysterio.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_smart_yellowjacket.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_warm_blue_blade.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_pink_colossus.sql
npm run dev
```

已有数据库只执行尚未应用的迁移。若本地未配置服务端 `DEEPSEEK_API_KEY`，对话将依赖有限的备用解析，AI 解读按钮不可用。不要把密钥写入 `.env` 并提交到 Git。原脚本中暴露过的凭据应在对应服务商后台撤销。

## 验证与上线

至少覆盖：匿名访问首页进入登录页；注册、退出、重新登录和账号删除；13 个话题的顺序、可选题跳过、无效回答重问、刷新续聊；核对与授权；报告中的虚构样例数量、零匹配、真实池隔离；心动与联系方式双向授权；无密钥时备用流程；构建和 D1 迁移。发布前确认服务端 secret 已配置，并复查生产数据库中没有测试账号。

当前仍是公开测试版：没有身份核验、密码找回、照片上传、站内私信和人工举报处理，用户资料来自自述。真实候选池目前最多读取最近 1000 份公开资料后在服务端筛选；扩大推广前要补数据库预筛选、分页、滥用处置与运营渠道。
