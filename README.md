# 妲灵双向交友匹配

公开网页测试版，复刻原命令行脚本的逐题交谈体验，并补上账号、资料持久化、双向匹配和报告。详细的原型审计、实现边界、任务拆解与 Agent 能力对比见 [技术分析](./TECHNICAL_ANALYSIS.md)。

## 使用流程

1. 访问首页，先用站内用户名和密码注册或登录。账号与 ChatGPT 无关；注册需确认年满 18 岁。
2. 与妲灵进行有顺序的自然对话，共 19 个话题：13 个基础话题和 6 个深度主题。深度部分涵盖关系价值观、分歧修复、情感支持、生活节奏、未来方向与相处边界。每轮发送访谈协议、当前与下一主题、已完成主题的本人 JSON、最近对话历史和最新回答；AI 据此回应、追问或改写下一题，服务器校验字段和顺序。可选主题允许跳过。
3. 对话记录、进度和草稿保存在 D1，刷新可继续。结束后核对基础与深度档案，确认成年人身份与资料用途；是否进入真实池、是否分享联系方式分别选择。保存版本化完整匹配 JSON，可下载本人档案。原回答与完整 JSON 仅供本人读取；其他候选人只看到公开基础资料、比较依据和讨论建议。已完成基础资料的用户可补充深度主题；基础编辑不会清除深度档案。
4. 保存后自动生成规则匹配报告：展示 18 份**虚构样例**中的合格数量、前几名及理由，另列真实报名者。虚构样例不能心动或联系，真实池为空时如实显示。用户再次勾选授权后，可让 AI 为样例结果生成文字解读；AI 不改动匹配资格和排序。

## 技术结构

| 部分 | 实现 |
| --- | --- |
| 网页 | React、Next.js 兼容的 Vinext、Cloudflare Workers；手机和桌面响应式布局 |
| 账号 | 站内用户名和密码；独立随机盐值与分段 PBKDF2-SHA256 密码哈希；仅保存会话令牌摘要，浏览器使用 HttpOnly Cookie |
| 数据 | Cloudflare D1 中的账号、会话、资料、对话、心动、屏蔽、限流和 AI 解读缓存；虚构样例仅在 [`lib/demo-profiles.ts`](./lib/demo-profiles.ts) 代码中 |
| 对话 | [`lib/interview.ts`](./lib/interview.ts) 定义主题、每轮提示词和字段契约；[`lib/conversation.ts`](./lib/conversation.ts) 持久化服务端状态。AI 根据上下文生成回应与问题措辞，服务器控制推进和授权 |
| 匹配 | [`lib/matching.ts`](./lib/matching.ts) 双向筛选性别、年龄、城市及身高；[`lib/compatibility.ts`](./lib/compatibility.ts) 比较六个深度维度，输出相符度、覆盖度与讨论建议；[`lib/report.ts`](./lib/report.ts) 构建报告 |
| 互动 | 仅真实报名者可心动或屏蔽；双方都心动且都授权分享时，才显示彼此填写的联系方式 |
| 设计 | 自主编写的留白、大字、蓝色视觉与轨道动画；Motion 实现消息和卡片入场，CSS 实现轨道与交互过渡；适配手机及减少动画偏好 |

对话需要服务端 AI。请求失败、JSON 无效或提取结果不合规时，本轮不会写入或推进，输入框保留回答供重试；不使用规则猜测资料。JSON 格式失败最多重试一次，提取字段或问题契约失败可请求一次修正；所有尝试共享 20 秒时间预算。已保存档案仍可生成确定性匹配报告；AI 文字解读失败时保留规则报告。联系方式在核对环节单独填写，不发送给 AI。DeepSeek 密钥只以服务端 `DEEPSEEK_API_KEY` secret 保存，不写入仓库或浏览器包。

深度维度权重为价值观 25、分歧修复 15、支持 20、节奏 15、未来 15、边界 10。只比较明确填写的字段，未知不扣分；报告同时展示可比较资料的覆盖度。整体相符度按覆盖度给予深度分最多 70% 权重，是产品规则分数，不是关系成功率。18 份演示资料含六种虚构的相处画像。

## 设计参考与许可

独立动画网站参考：[Codrops OnScrollTypographyAnimations](https://tympanus.net/Development/OnScrollTypographyAnimations/)（[MIT 源码](https://github.com/codrops/OnScrollTypographyAnimations)）；开源组件参考：[Magic UI](https://github.com/magicuidesign/magicui)（MIT）。实际动画依赖 [Motion](https://github.com/motiondivision/motion/blob/main/LICENSE.md)（MIT），视觉和轨道图形由本项目自行实现。Eloqwnt 作为视觉方向参考，未发现可复用的开源许可，因此未复制其源码或素材。

## 本地运行

要求 Node.js 22.13+。首次创建本地 D1 时，在项目根目录执行：

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_keen_mysterio.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_smart_yellowjacket.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_warm_blue_blade.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_pink_colossus.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_eminent_ken_ellis.sql
npm run dev
```

已有数据库只执行尚未应用的迁移。若本地未配置服务端 `DEEPSEEK_API_KEY`，采访会提示 AI 暂不可用并保留输入与进度；已有档案仍可读取规则报告。不要提交密钥。原脚本中暴露过的凭据应在对应服务商后台撤销。

## 验证与上线

覆盖：匿名入口与独立账号；19 主题顺序、离题追问、自然跳过、上下文回应、刷新续聊；AI 失败保留输入且不推进；核对授权；JSON 保存与本人导出；六维比较和缺失字段；虚构与真实池隔离；双向联系方式授权；基础编辑保留深度档案；多标签页及延迟请求冲突；报告缓存版本；减少动画偏好；构建及全部 D1 迁移。线上验证结果按实际执行记录，不能以构建成功代替线上模型验证。

当前仍是公开测试版：没有身份核验、密码找回、照片上传、站内私信和人工举报处理，用户资料来自自述。真实候选池目前最多读取最近 1000 份公开资料后在服务端筛选；扩大推广前要补数据库预筛选、分页、滥用处置与运营渠道。
