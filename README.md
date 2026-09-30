# 妲灵双向交友匹配

基于原命令行问卷的公开网页测试版。原文件只有问答，没有真正匹配；本项目新增资料持久化、双向筛选、心动确认和自主删除。详细分析见 [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md)。

## 功能

- 未登录填写暂存草稿；登录 ChatGPT 后保存资料。
- 严格双向筛选性别、年龄、城市和身高期待。共同兴趣、同城、体型与星座只参与显示排序。
- 资料公开和联系方式分享分别授权。只有两人都心动且两人都同意分享，才可看到对方填写的联系方式。
- 私密保存、关闭匹配池、撤回心动、屏蔽和删除资料。
- 资料与隐私说明、使用规则、移动端界面。

## 本地运行

要求 Node.js 22.13+。在本目录运行：

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_keen_mysterio.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_smart_yellowjacket.sql
npm run dev
```

迁移文件名以 `drizzle/` 中实际生成的文件为准。Windows 上本机若预装 Node 20，应先切换到 Node 22+。本地预览可以访问 `/signin-with-chatgpt?return_to=/`，使用 starter 提供的**本地模拟登录**；生产环境登录由 Sites 平台处理。

## 数据与部署

`.openai/hosting.json` 使用 D1 绑定 `DB`。`db/schema.ts` 是数据库表结构，`app/api` 中所有写接口都要求已登录，用户身份来自服务器收到的平台认证上下文。上线通过 Sites 的源码工作流、版本保存和发布完成。不要在代码或前端放 API 密钥。原脚本中的明文凭证必须在原服务商后台撤销。

## 已知限制

当前未接入生成式模型；网页的核心“智能匹配”为可解释的规则和兴趣排序，完全不依赖旧脚本已经停用的模型名或泄露的密钥。无身份核验、照片、站内私信或人工举报审核。用户量增加后，应对候选池查询做数据库预筛选与分页。公开推广前请完成安全与运营准备。
