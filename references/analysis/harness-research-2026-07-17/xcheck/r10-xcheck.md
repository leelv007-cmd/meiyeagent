哥，结论先给：**报告总体裁定为「成立但需修正」；Mastra Port“打开但受限”的方向没有被事实翻转，但原文不能直接作为锁定 ADR 的最终证据。** 20 条断言中：✅ 10 条、⚠️ 8 条、❌ 2 条、❓ 0 条。全程只读，未修改任何文件。

## 判定汇总表

| # | 可证伪断言 | 判定 | 核验结论 |
|---:|---|:---:|---|
| 1 | Mastra 1.0 于 2026-01-21 发布，来源为 `mastrav1` | ❌ | 稳定版发布于 **2026-01-20**；所引页面是 2025-11 的 **v1 beta** 公告 |
| 2 | Mastra“如今 1.52”，半年发 52 个 minor | ⚠️ | 镜像/main 是 `1.52.0-alpha.4`，但 npm 稳定 latest 是 **1.51.0**；节奏确实比周级更快，但不是完整 52 个稳定 minor |
| 3 | 仓库为 Apache 2.0 + EE 双许可；EE 生产需书面协议 | ✅ | 根许可明确：任意 `ee/` 目录受 EE 许可，其他代码 Apache 2.0 |
| 4 | `@mastra/editor` 存在；核心可商用，Agent Builder 属 EE | ✅ | 包真实存在；`@mastra/editor/ee` 运行时许可门控。npm 包自身缺少 `license` 字段，需知悉 |
| 5 | Mastra 底层“就是 Vercel AI SDK v5”，无需换流协议 | ⚠️ | 属 AI SDK 生态成立；但当前同时兼容 **v5/v6/v7**，主仓已标注 AI SDK v7；“就是 v5”错误 |
| 6 | Editor 提供 CMS 式提示词/工具编辑、Prompt Blocks、变量与显示条件 | ✅ | 文档与源码均确认 |
| 7 | Editor 支持 db/code 源、版本快照、三态、回滚和版本定向 | ✅ | db 源成立；code 源版本与回滚依赖 Git，不是同一套 draft/publish API |
| 8 | Editor 只能改 instructions/tools，绝对不能改 model | ⚠️ | 对 **code-defined agent 的 OSS override** 正确；stored agent API 和 EE Agent Builder 可以设置/选择 model |
| 9 | Studio 可正式部署到生产 | ✅ | 可平台托管或自托管；独立 SPA、与 API 同服都成立 |
| 10 | 免费档只有 Simple Auth；生产 SSO/RBAC 属 EE | ⚠️ | SimpleAuth 核心可用；但 `StaticRBACProvider` 位于 `auth/ee`，不能推导其生产免费 |
| 11 | `auth_header` 是“干净”的后台嵌入接入点 | ⚠️ | token 不落 localStorage 属实，但官方明确警告 URL 会泄漏到历史、Referer、访问日志 |
| 12 | Studio 只能可视化 Mastra 原生 agent/workflow | ✅ | 它操作 Mastra server 已注册资源，不是通用工作流观察器 |
| 13 | workflow 支持 suspend/resume 和 PG snapshot 持久化 | ✅ | 文档明确快照跨部署、跨进程重启；PostgreSQL 是支持的存储适配器 |
| 14 | 崩溃后从最后活跃步骤重跑，步骤须幂等，非事件溯源 replay | ⚠️ | 默认执行引擎基本成立；幂等是正确工程推论，但当前仓库还存在 evented 执行路径，原文范围过宽 |
| 15 | 原生引擎在 serverless 上拿不到自动崩溃恢复 | ⚠️ | 没有常驻进程触发自动恢复的判断合理；但官方只明确保证 local server 启动恢复，未明确宣称 serverless 永远不能恢复 |
| 16 | Mastra↔Inngest 是一等集成 | ✅ | workflow/step 直接映射、memoization、flow control、cron、版本治理均有明文 |
| 17 | `@mastra/langfuse` exporter 存在并支持生产批量导出 | ⚠️ | 包存在且能力成立，但真实目录是 `observability/langfuse/`，不在 `packages/`；报告还写错了 `excludeSpanTypes` 配置层级 |
| 18 | Signals 自 1.39 引入，至今仍为 beta | ✅ | 本地当前文档仍明确标 beta |
| 19 | DurableAgent“今天仍只是单进程 in-memory” | ❌ | `createDurableAgent()`适合单进程属实，但**运行状态已持久化并声明可跨进程重启**；默认内存的是流事件 cache，不能等同整个运行状态 |
| 20 | SignalProvider 是 poll/webhook 适配器，不是外部 durable 调度器 | ✅ | 注册表确为进程内；轮询随进程运行，webhook 需自行挂路由，重启后订阅需自行恢复 |

## 逐条展开

### 1. 1.0 日期和来源：原报告引用错误

npm Registry 给出的 `@mastra/core@1.0.0` 发布时间是 `2026-01-20T15:40:07.040Z`；正确官方公告是 [Announcing Mastra 1.0](https://mastra.ai/blog/announcing-mastra-1)，日期也是 2026-01-20。

报告所引的 [mastrav1](https://mastra.ai/blog/mastrav1) 标题实际是 “Announcing Mastra v1 beta”，发布于 2025-11-06，并非稳定版公告。因此“2026-01 发 1.0”成立，但精确日期与证据来源均错误。

### 2. 当前版本和发布节奏：把 alpha 当成“如今版本”

本地镜像确实是：

- `@mastra/core@1.52.0-alpha.4`
- `@mastra/editor@0.13.8-alpha.0`

但线上稳定版本分别是：

- [`@mastra/core/latest = 1.51.0`](https://registry.npmjs.org/@mastra%2Fcore/latest)
- [`@mastra/editor/latest = 0.13.7`](https://registry.npmjs.org/@mastra%2Feditor/latest)

GitHub latest release 也是 [`@mastra/core@1.51.0`](https://github.com/mastra-ai/mastra/releases/tag/%40mastra/core%401.51.0)。

发布节奏判断成立：从 1.0.0 到 1.51.0，稳定 `1.x.0` 实际发布了 51 个版本，`1.44.0` 缺失，平均约每 **3.5 天**一个 minor。准确写法应是：

> 截至 2026-07-17，npm 稳定版为 1.51.0；main/alpha 为 1.52.0-alpha.4；发布节奏平均快于周级。

### 3. 许可证：核心判断成立，但 EE 范围不能只列三个目录

根许可写的是“**任何名为 `ee/` 的目录**”均适用 EE 许可，而不是仅报告枚举的三个路径。[LICENSE.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/LICENSE.md:3)

EE 许可明确规定：

- 生产使用必须与 Kepler 有书面协议；
- 无协议只允许本地或 staging 开发、测试；
- 可补救违约须在知悉后 30 天内修复。

证据见 [ee/LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/ee/LICENSE:7)。

所以“Apache 核心可以商业自托管、EE 生产受限”成立，但实施前应扫描所有依赖路径是否进入任意 `ee/`，不能只看报告列举的目录。

### 4. `@mastra/editor`：真实存在，许可拆分基本正确

[`packages/editor/package.json`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/packages/editor/package.json:1) 确认包名、版本和 `./ee` 导出。

非 `ee/` 代码按根许可为 Apache 2.0；Agent Builder 从 `@mastra/editor/ee` 导入，并有运行时许可门控。[MastraEditor reference](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/reference/editor/mastra-editor.mdx:129)

但 npm 的 `@mastra/editor@0.13.7` manifest 没有 SPDX `license` 字段。仓库许可仍能给出法律归属，但这是发布包元数据缺口，正式商用应保留仓库版本及许可快照。

### 5. “底层就是 AI SDK v5”：错误地把包 major 当成 AI SDK 世代

当前 core 同时依赖 provider API v5、v6、v7 兼容别名：[core package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/packages/core/package.json:840)。

仓库还直接标注：

> AI SDK v7 (LanguageModelV4) support

见 [pnpm-workspace.yaml](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/pnpm-workspace.yaml:107)。

报告把 `@ai-sdk/provider@4` 解读为“AI SDK v5 生态”是世代映射错误。正确结论是：

- Mastra 与 Vercel AI SDK **生态高度兼容**；
- 当前不是仅构建在 AI SDK v5 上，而是同时兼容多个世代；
- Mastra stream 在部分场景仍需 `toAISdkV5Stream()` 等转换，因此“不需要换流式协议”也不能绝对化。

这会削弱“零摩擦同源”的加分强度，但不会推翻局部采用。

### 6–7. Editor 主体功能：成立

[Editor overview](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/editor/overview.mdx:10) 明确确认：

- CMS 式 agent 配置管理；
- Prompt Blocks 可复用、版本化；
- 模板变量与显示条件；
- 工具接入和描述覆盖；
- 每次保存产生快照；
- A/B、金丝雀、按请求/用户/环境版本定向。

存储源需要区分：

- `db`：draft/published/archived、API 回滚；
- `code`：落 per-agent JSON，版本历史和回滚由 Git 提供。

因此报告功能判断正确，但“一次 API 回滚”等表述只能明确用于 db 源，不能扩展到 code 源。[版本生命周期](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/editor/overview.mdx:201)

### 8. Editor 关键限制：限定版正确，绝对版错误

对 code-defined agent，文档明确只允许覆盖 Instructions 和 Tools，`id/name/model` 来自代码，variables 只读。[Editor 限制表](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/editor/overview.mdx:163)

但存在两个反例：

1. `editor.agent.create()` 创建 stored agent 时，初始 snapshot 可包含 `model`、memory、tools 等。[stored agent API](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/reference/editor/mastra-editor.mdx:159)

2. EE Agent Builder 明确有 model policy/model picker，可决定默认模型及是否允许终端用户更改。[Model policy](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/agent-builder/model-policy.mdx:9)

因此应改成：

> 在本决策默认关闭 EE、且①③使用 code-defined agent 的前提下，OSS Studio Editor 只能持久覆盖 instructions/tools，不能持久修改 model；workflow 步骤顺序仍只能改代码。

这个限定非常重要。它保住了报告的架构推理，但原文粗体绝对断言不准确。

### 9. Studio 可部署生产：成立

[Studio deployment](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/studio/deployment.mdx:13) 明文称有“两种 primary ways”：

- Mastra Platform 托管；
- 自托管，既可独立 SPA，也可与 Mastra server 同服。

所以报告的“三条路径”更准确地说是“两类路径、三种部署形态”。另外，`mastra studio deploy` 已被标为 earlier split deploy path，新项目应使用统一的 `mastra deploy`。[平台部署说明](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/mastra-platform/studio.mdx:15)

### 10–11. Auth：必须修正生产免费边界和 token 风险

[Studio auth](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/studio/auth.mdx:8) 确认：

- `server.auth` 同时保护 Studio UI 和 API；
- 无 auth 时 UI 与所有 API 路由公开；
- SSO、RBAC、permission UI 属 EE。

但报告把 “Simple Auth（API key）+ `StaticRBACProvider` 免费”揉在一起有风险：

- `SimpleAuth` 从非 EE 路径导入，可按 Apache 核心理解；
- `StaticRBACProvider` 和默认角色从 `@mastra/core/auth/ee` 导入；
- 根 EE 许可没有“搭配 SimpleAuth 即可免费生产”的例外。

因此最安全口径是：

> SimpleAuth 基础认证可走 OSS；StaticRBAC/FGA 生产使用按 EE 处理，除非 Mastra 给出书面许可澄清。

`auth_header` 也不是报告所称的完全“干净接入点”。官方明确警告初始 URL 可能进入 browser history、Referer 和 server access log。[风险原文](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/studio/auth.mdx:72)

生产嵌入更适合短期 token、URL fragment/后端交换或统一反向代理会话，并同时保护 Studio 与 Mastra API。

### 12. Studio 绑定 Mastra 原生资源：成立

Studio 是连接 Mastra server 的 SPA；Agent、Workflow、Tool 等面板读取已注册资源。它不是可以对任意外部 durable 编排进行图形化的通用观察器。

报告由此推导：

- 吃 Editor，需要①③以 Mastra Agent 表达；
- 吃 Workflow 图和 time travel，需要编排以 Mastra Workflow 表达；
- 只采用 Agent/Editor，不要求五段式全部迁移。

这段事实链成立。

### 13. suspend/resume 与 PG snapshot：成立

[Suspend and resume](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/workflows/suspend-and-resume.mdx:8) 明确：

- `suspend()` 保存当前执行状态；
- snapshot 持久化到配置的 storage；
- 可跨部署和应用重启恢复；
- `resume()` 可从 HTTP、事件处理器、用户输入或定时器触发。

[Snapshots](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/workflows/snapshots.mdx:88) 明确列出 PostgreSQL、libSQL、MongoDB、Upstash、D1、DynamoDB。

“PG 适配器支持”可以确认；“PG 已达到本项目生产可靠性”仍需压测、迁移和故障注入，文档存在不等于生产验证完成。

### 14–15. 崩溃恢复：核心语义成立，但证据等级写高了

[Workflow overview](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/workflows/overview.mdx:497) 明确：

- `restart()` 从 last active step 重启；
- local Mastra server 启动时自动重启 active runs；
- active 状态是 `running` 或 `waiting`。

源码路径也显示恢复时保留已完成步骤结果，重新执行活跃步骤。因此：

- 外部付费调用、写库、发消息等步骤必须幂等；
- 默认执行引擎不是 Temporal/DBOS 式逐事件确定性重放。

但两个限制必须加上：

1. “步骤须幂等”是由源码语义推导出的工程要求，不是该文档的逐字保证。
2. 当前仓库还有 evented 执行路径，不能把默认引擎结论扩展成 Mastra 所有执行模式的绝对性质。

对 serverless，准确口径是“**没有常驻进程提供自主唤醒保证**”，而不是“永远无法恢复”。官方只明确保证 local server 启动自动恢复。

### 16. Inngest：一等集成成立

[Inngest 部署指南](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/guides/deployment/inngest.mdx:12) 明确：

- 每个 Mastra workflow 映射为 Inngest function；
- 每个 Mastra step 映射为 Inngest step；
- 结果 memoization；
- 重试/恢复跳过已完成步骤；
- suspend/resume、dashboard、flow control、cron。

需补两个边界：

- `connect()` 当前仍是 public beta；
- Vercel/Lambda 不支持的是长连接 `connect()` worker，不是整个 Inngest 集成；HTTP `serve()` 路径支持 serverless。[Connect 边界](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/guides/deployment/inngest.mdx:429)

### 17. Langfuse exporter：包和能力成立，目录与配置细节错误

`@mastra/langfuse` 真实存在，当前稳定版为 1.4.4，但不在 `packages/`，而在 [`observability/langfuse/package.json`](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/observability/langfuse/package.json:1)。

[官方 exporter 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/observability/integrations/exporters/langfuse.mdx:9) 支持：

- 凭据环境变量就绪后的 zero-config 构造；
- realtime 和 batch；
- batch flush 调优；
- agent/workflow 元数据；
- Langfuse Prompt Management linking。

报告的一个技术错误是：`excludeSpanTypes` 不属于 `LangfuseExporter` constructor，而应放在 Observability config 层。

### 18–20. 2026-07-05 历史校准：两条成立，一条必须重写

**Signals：成立。** [signals.mdx](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/long-running-agents/signals.mdx:9) 明确写着自 `@mastra/core@1.39.0` 引入，当前仍为 beta。

**DurableAgent：原校准不再能原样成立。** [durable-agents.mdx](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/long-running-agents/durable-agents.mdx:19) 明确写道：

- run state 会持久化并跨 process restart；
- 默认 in-memory 的是已发布流事件 cache；
- cache 可以替换为 Redis 等后端；
- `createDurableAgent()`定位仍是本地和单进程服务；
- 生产推荐 `createInngestAgent()`。

所以不能再写“DurableAgent 仅单进程 in-memory”。正确说法是：

> 本地 factory 的执行形态适合单进程，流回放 cache 默认内存；运行状态已有持久化能力，但官方生产级路径仍推荐 Inngest。

**SignalProvider：成立。** [signal-providers.mdx](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/mastra/docs/src/content/en/docs/long-running-agents/signal-providers.mdx:206) 明确注册表为 in-memory/per-process，持久订阅需自行保存并在 `start()` 重建。它会在进程存活时按 interval 轮询，但不是外部 durable cron。

## 三段关键推理复核

### 8.1：7.5/10 没有可复现的计算依据

四个子分是 10、8、3、6；等权平均为：

\[
(10+8+3+6)/4=6.75
\]

报告没有说明权重，无法从列出的数字推出 7.5。即使允许主观加权，仍存在三个问题：

- 提示词 10/10 没扣除 Editor 0.x、PG 迁移和真实回滚尚未验证；
- 生产后台 6/10 没处理 StaticRBAC 的 EE 许可风险；
- 参数 3/10 建立在 code-defined agent 范围内，但报告此前把限制绝对化。

**裁定：精确的 7.5/10 不成立；“提示词强、模型/编排参数弱”的定性结论成立。** 建议 ADR 删除单一总分，或明确权重与验收条件。

### 8.2：“整套不值得，①③值得”方向成立，但论证不充分

支持该结论的事实：

- Mastra Agent 可以脱离 Mastra Workflow 单独注册；
- ①③采用 Agent 即可获得 Editor、Studio Agent 调试和 Langfuse 归因；
- ②④⑤可以继续由外部 durable 载体控制。

但原论证有三处问题：

1. “迁移 workflow 只换来图可视化”不完整。它还带来 snapshot、suspend/resume、schema 化步骤、time travel 和 Inngest 直接映射。
2. “editor 0.x schema 锁进”不能作为反对 workflow 的独立理由，因为推荐方案本身已经采用 editor。
3. 没有量化现有五段式迁移成本，也没与最终选定的 DBOS/Inngest/Trigger/CF Workflows 做同口径比较。

**裁定：局部采用是技术上可行且合理的默认方案，但“不值得整套迁移”目前是架构判断，不是已被证实的事实。** 应由一次小型双路径 spike 决定，而不是仅靠 7.5 分和文字判断。

### 8.4：“Port 打开但限定 Editor/Studio 层”基本成立，但边界名称不准确

这个 Port 并非纯 UI 层。要使用 Editor/Studio，实际引入的是：

- Mastra Agent runtime；
- Mastra server REST surface；
- `@mastra/editor` 存储 schema；
- Studio UI；
- Node `>=22.13.0` 运行要求；
- Auth/CORS/API 暴露边界；
- Langfuse exporter。

因此建议改写为：

> Mastra Port 打开至“Mastra Agent runtime + Editor/Studio + Langfuse 集成边界”。①③可用 Mastra Agent 表达；②④⑤及 durable 编排暂留在独立载体。默认不启用 EE Agent Builder、RBAC/FGA。若未来选择 Inngest，再评估是否将 Workflow 收入 Mastra。

同时增加四个准入 Gate：

1. 使用稳定版 `core@1.51.0`、`editor@0.13.7` 做 spike，除非明确依赖 alpha 功能。
2. 在 PostgreSQL 上实测 draft/publish/rollback、版本定向和升级迁移。
3. 鉴权必须同时覆盖 Studio 与全部 Mastra API；不得把长效 token 放进 `auth_header` URL。
4. 明确接受 OSS code-defined agent 不能在 UI 持久修改 model/择优参数；若要求这一能力，需要自研配置面或进入 EE/stored-agent 路径。

## 总裁定

**成立但需修正。**

不会翻转 Port 方向的事实：

- Editor 核心能力真实存在；
- OSS code-defined agent 的提示词/工具覆盖、版本化、回滚和版本定向真实存在；
- Studio 可部署生产；
- Agent 可局部采用，不强制整个 Workflow 迁移；
- Langfuse、PG snapshot、Inngest 集成均真实存在。

必须在锁定决策前修正的内容：

- 稳定版应写 1.51，不是 1.52；
- 1.0 日期和公告来源错误；
- “底层就是 AI SDK v5”应改成“兼容 AI SDK v5/v6/v7 生态”；
- Editor 的 model 限制必须限定为 OSS code-defined agent；
- StaticRBAC 不能被写成已确认可免费用于生产；
- DurableAgent“仅单进程 in-memory”已经不准确；
- 7.5/10 不可复现；
- “限定 Editor/Studio 层”应改成“限定 Mastra Agent runtime 与调优/观测集成边界”。

**最终建议：不要按原报告原文直接锁定 ADR；完成上述措辞修正并通过四项 spike Gate 后，可以条件性批准“Port 打开、Workflow 暂不迁移”的决定。**