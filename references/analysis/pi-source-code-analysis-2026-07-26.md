# Pi 源码工程适配分析（2026-07-26）

> 目标：基于 Pi 官方仓库当前 `main` 的固定提交，判断它与本项目现有 AI SDK、DBOS Harness、Skills / Recipe、ContentPackage 边界的真实工程关系。  
> 结论先行：**Pi 最有价值的是 stage-local 的 agent loop、工具生命周期、steer / follow-up 队列和可替换的会话树抽象；它不能替代 DBOS Harness、CreationExecutionSnapshot、ContentPackage revision port 或现有结构化生成链。当前不应接入完整 `pi-coding-agent`，也不应直接以 `AgentHarness + pi-ai` 替换现有 AI SDK。若要试点，优先在单个非写入型 StagePort 内，用低层 loop 做受限实验，并由现有 DBOS、snapshot、工具 allowlist、step budget 和 canonical write port 包住。**

## 1. 审查基线与证据范围

- Pi 官方仓库：`https://github.com/earendil-works/pi`
- 固定提交：`5bc1c2c0a6f07e00e8c240304182f213ab8d311f`
- 提交时间：`2026-07-25T14:37:15+02:00`
- 本地只读镜像：`/tmp/pi-source-analysis.ja10Eq/pi`
- 本项目审查提交：`ccb8840f7ffd11a9c64f91f298abe0e99b8dca06`
- 本项目路径：`/Users/bin/Desktop/开发/内容无人区/美业内容2`
- 证据只取 Pi 官方源码、官方测试、package manifests，以及仓库内版本记录；没有把文档宣传语当成实现证据。
- Pi 镜像没有安装 `node_modules`，本轮没有执行其测试；测试文件只作为官方行为合同阅读。项目本地存在依赖，但本轮是源码映射，不修改也不执行产品代码。

固定链接格式：

```text
https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/<path>#L<start>-L<end>
```

## 2. 最终建议

### 2.1 三种接入路径比较

| 路径 | 能得到什么 | 主要代价 | 与当前产品的结论 |
|---|---|---|---|
| A. 完整 `pi-coding-agent` | CLI/TUI、项目上下文发现、文件技能、扩展、read/bash/edit/write、本地 JSONL session | 默认高权限本地工具；任意 TS 扩展同进程执行；UI/CLI/本地文件系统耦合；依赖面最大；与 Web/SaaS 产品模型不符 | **不采用** |
| B. `pi-agent-core AgentHarness + pi-ai` | agent loop、会话树、compaction、steer/follow-up、工具 hook、provider collection | `AgentHarness` 强依赖 `pi-ai Models`；没有内建 max turn/step；默认工具并行；会形成第二套 provider/auth/retry/session 语义；近期 API 高频 breaking | **不作为当前主链；只适合隔离 PoC** |
| C. 低层 `agentLoop` / `Agent` + 现有 AI SDK stream adapter | 只引入 loop 和工具调度，保留 Vercel AI SDK 的 provider、`Output.object`、UI stream 和现有配置 | 需要完整转换 model/message/tool/event/usage/error/abort 语义；`StreamFn` 失败必须编码成 Pi event stream，适配成本不低；直接 `Agent` 仍依赖 Pi message types | **如果必须采用 Pi，这是最小风险路径；先做单 StagePort spike，不进入 canonical 写链** |
| D. 不引入依赖，只借鉴模式 | 保留现有 AI SDK / DBOS，仅借鉴队列、hook、并发标注、会话树测试方式 | 需要自行实现少量薄层 | **当前推荐** |

Pi 低层 `StreamFn` 虽然是结构化函数类型，但输入输出仍是 Pi 的 `Model`、`Context` 和 `AssistantMessageEventStream`，并明确要求运行失败不能 reject，而要编码为 error/aborted stream。因此“复用现有 AI SDK”不是直接把 `streamText` 传进去，而是一个双向协议适配器。[Pi 源码：`packages/agent/src/types.ts` L18-L32](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/types.ts#L18-L32)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/types.ts:18-32`。

还要注意：低层 `agentLoop()` 启动异步运行后只把成功结果接到 event stream，没有在这一层补一个通用 reject 转 error-stream 的兜底；高层 `Agent` 才会捕获 run failure 并补齐失败消息和 lifecycle。因此路径 C 若直接用 loop，adapter 必须自己保证所有约定为“不抛出”的 callback，并兜住未预期 reject。[Pi 源码：`packages/agent/src/agent-loop.ts` L31-L53](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L31-L53)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:31-53`。[Pi 源码：`packages/agent/src/agent.ts` L471-L512](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent.ts#L471-L512)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent.ts:471-512`。

### 2.2 现在应该怎么用

1. 保持 `CreationExecutionSnapshot + DBOS Harness` 为唯一顶层 durable orchestration。
2. 保持 Vercel AI SDK 为 provider、结构化输出、UI stream 的主实现。
3. 保持 Product Core 的 ContentPackage revision port 为唯一成品写入口。
4. 第一阶段只借鉴 Pi 的四个实现模式：
   - turn 内 `beforeToolCall` / `afterToolCall`；
   - `executionMode: sequential` 对副作用工具的显式标注；
   - steer 与 follow-up 的语义分离；
   - conversation transcript 与业务事实分离。
5. 若 D-112 的“段内受限 agent loop”现有 AI SDK 实现不足，再做一个只读 PoC：
   - 只允许 `readCurrentContext`、`proposeFieldPatch`、质量自检类工具；
   - 由宿主强制最大 3 step；
   - 禁止直接调用 usage、Asset、ContentPackage、发布或外部 Provider side effect；
   - 每次运行仍由 DBOS `runStep` 承载；
   - 结果必须回到项目 Zod contract，而不是把 Pi transcript 当结果。

## 3. 当前项目不是“缺少 Agent SDK 的空白”

### 3.1 现有 AI SDK 已覆盖关键 LLM 运行能力

当前 Core 已依赖 `ai@^7.0.19`、Anthropic、Google、OpenAI-compatible 和 MCP provider，同时已锁定 DBOS SDK。[本地：`apps/core/package.json:38-53`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/package.json:38)

`ai-sdk-runner.ts` 已经具有：

- `generateText` + `Output.object` + Zod schema 的结构化输出；
- `streamText` 的 partial structured output；
- UI message stream / text stream；
- provider usage 与 provider task ref；
- `isStepCount(3)` 的 agent step 上限；
- 两个受限工具：只读当前 Work context、提出但不自动应用的字段 patch；
- `maxRetries: 0`，把重试主权留给外部执行合同。

证据：[本地：`apps/core/src/p1/model-supply/ai-sdk-runner.ts:125-153`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ai-sdk-runner.ts:125)、[同文件 `:222-279`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ai-sdk-runner.ts:222)、[同文件 `:297-328`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ai-sdk-runner.ts:297)。

Pi 源码中没有与 AI SDK `Output.object` 同级的通用 structured-output API；其范式是工具 schema + transcript。官方 coding-agent 的 structured output 示例也是通过末尾工具调用收集结构化结果，而不是独立的 object output primitive。因此 Pi 若进入 copy / brief compiler，会倒退现有 schema-first 输出路径。这个源码检索结论由以下边界共同支持：Pi tool schema 是 TypeBox，工具结果进入消息链，[Pi 源码：`packages/agent/src/types.ts` L385-L402](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/types.ts#L385-L402)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/types.ts:385-402`。官方示例把结构化输出注册成工具，[Pi 源码：`packages/coding-agent/examples/extensions/structured-output.ts` L18-L43](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/examples/extensions/structured-output.ts#L18-L43)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/examples/extensions/structured-output.ts:18-43`。

### 3.2 现有 DBOS Harness 已有 durable 语义

本项目的五阶段 Harness 不是普通对话循环。其 runtime 明确提供：

- 带稳定 effect idempotency key 的 `runStep`；
- progress / token 有序事件；
- durable decision wait / resume；
- immutable successor submission；
- stage trace。

证据：[本地：`apps/core/src/p1/harness/workflow-core.ts:151-197`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:151)、[同文件 `:209-339`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/workflow-core.ts:209)。

DBOS adapter 用 `DBOS.runStep`、`writeStream`、`recv`、`send` 和确定的 workflow ID 承载恢复及外部互动。[本地：`apps/core/src/p1/harness/dbos-workflow.ts:57-169`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/dbos-workflow.ts:57)、[同文件 `:172-205`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/harness/dbos-workflow.ts:172)。

当前 P0 authority 还明确禁止新 Agent/workflow 框架替代 DBOS 主干。[本地：`docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md:307-314`](/Users/bin/Desktop/开发/内容无人区/美业内容2/docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md:307)。

因此 Pi 的 `AgentHarness` 只能被定义为“某个 DBOS stage 内的 LLM/tool loop”，不能成为新的顶层 Harness。

## 4. Pi 源码能力与限制

### 4.1 包分层与真实依赖面

`@earendil-works/pi-agent-core@0.82.1` 的直接依赖相对克制：`pi-ai`、`diff`、`ignore`、`typebox`、`yaml`，Node 要求 `>=22.19.0`。[Pi manifest：`packages/agent/package.json` L1-L37、L52-L54](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/package.json#L1-L37)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/package.json:1-37,52-54`。

但 `agent-core` 不是 provider-free 安装：它直接依赖 `pi-ai`。`pi-ai@0.82.1` 又直接安装 Anthropic SDK、AWS Bedrock、Google GenAI、Mistral、OpenAI、OTel、Smithy 和 proxy agents。[Pi manifest：`packages/ai/package.json` L62-L73](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/package.json#L62-L73)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/package.json:62-73`。

`pi-ai` 的 root export 经过拆分，核心入口声明为 side-effect free，provider factories 放到 subpath；这有利于 bundler tree-shaking，但不能消除 npm 安装时的直接依赖成本。[Pi 源码：`packages/ai/src/index.ts` L1-L46](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/index.ts#L1-L46)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/index.ts:1-46`。[Pi manifest：`packages/ai/package.json` L8-L41](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/package.json#L8-L41)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/package.json:8-41`。

`pi-coding-agent` 的直接依赖还包括 TUI、Photon WASM、chalk、cross-spawn、glob、highlight.js、jiti、proper-lockfile 等；它的 package 描述本身就是带 read/bash/edit/write 和 session management 的 coding CLI。[Pi manifest：`packages/coding-agent/package.json` L1-L29、L41-L59](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/package.json#L1-L59)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/package.json:1-59`。

其 root SDK entry 同时导出 CLI main、interactive/RPC modes 和大量 TUI components，不是为 Web 后端收窄过的 runtime entry。[Pi 源码：`packages/coding-agent/src/index.ts` L194-L221、L326-L380](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/index.ts#L194-L221)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/index.ts:194-221,326-380`。

还有一个容易被仓库整体成熟度掩盖的边界：Pi 自家的主力 coding-agent 当前并没有使用新的通用 `AgentHarness`。`createAgentSession()` 仍先构造低层 `Agent`，再包装进 3,000 多行的 `AgentSession`；所以 coding CLI 已经验证过的自动 compaction、retry、extension、session 恢复等能力，不能直接当成通用 `AgentHarness` 的生产成熟度证明。[Pi 源码：`packages/coding-agent/src/core/sdk.ts` L294-L390](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/sdk.ts#L294-L390)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/sdk.ts:294-390`。

### 4.2 Agent loop、steer 与 follow-up

Pi loop 的行为清晰：

- prompt 进入 transcript；
- assistant turn 完成；
- 有 tool call 就执行；
- 执行完当前整批工具后才检查 steering；
- 没有工具和 steering 后才检查 follow-up；
- follow-up 会开启后续 turn。

[Pi 源码：`packages/agent/src/agent-loop.ts` L95-L143、L155-L275](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L95-L143)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:95-143,155-275`。

这能覆盖 D-114 对话流中“用户在生成中追加方向”和普通后续消息排队，但有两个产品边界：

1. `steer` **不会中断已开始的工具批次**；它在本轮工具执行完后注入。因此不能把它当取消、审批或外部副作用撤销。
2. D-046 的结果阶段自由调整必须创建 derived Work/revision 并重新启动现有 Harness，不得把 follow-up transcript 提升为业务真相。[本地：`CONTEXT.md:785-787`](/Users/bin/Desktop/开发/内容无人区/美业内容2/CONTEXT.md:785)。

Pi 的官方测试明确验证 steering 要等当前全部工具完成才注入。[Pi 测试：`packages/agent/test/agent-loop.test.ts` L681-L785](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/test/agent-loop.test.ts#L681-L785)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/test/agent-loop.test.ts:681-785`。

### 4.3 工具执行、并发与错误

默认工具执行模式是 `parallel`。只要同一 assistant message 中任一工具声明 `executionMode: "sequential"`，整批就顺序执行。[Pi 源码：`packages/agent/src/types.ts` L254-L263、L385-L402](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/types.ts#L254-L263)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/types.ts:254-263,385-402`。[Pi 源码：`packages/agent/src/agent-loop.ts` L411-L425](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L411-L425)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:411-425`。

并行实现不是简单乱序：

- schema validation 和 `beforeToolCall` 预检按 source order 顺序执行；
- 真正的 `execute` 用 `Promise.all` 并发，没有内建并发上限；
- `tool_execution_end` 按完成时间发出；
- tool-result message 再按 assistant source order 写回 transcript。

[Pi 源码：`packages/agent/src/agent-loop.ts` L489-L553、L600-L664](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L489-L553)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:489-553,600-664`。官方测试覆盖了“完成事件乱序、transcript 结果仍按源顺序”。[Pi 测试：`packages/agent/test/agent-loop.test.ts` L586-L679](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/test/agent-loop.test.ts#L586-L679)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/test/agent-loop.test.ts:586-679`。

工具 schema / hook / execute 抛错不会默认让外层 workflow 失败，而是被转换成 `isError: true` 的模型可见 tool result，模型可以继续下一 turn。[Pi 源码：`packages/agent/src/agent-loop.ts` L600-L703](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L600-L703)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:600-703`。

abort 也是协作式：Agent 只触发 `AbortController`，provider、tool 和 hook 是否及时停止取决于它们是否遵守 signal；parallel batch 仍会等待已启动的 promises settle。核心没有通用 per-tool timeout 或 concurrency semaphore。[Pi 源码：`packages/agent/src/agent.ts` L306-L314](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent.ts#L306-L314)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent.ts:306-314`。[Pi 源码：`packages/agent/src/agent-loop.ts` L666-L706](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L666-L706)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:666-706`。

这对“允许工具微错、流程继续”的 D-122 有价值，但对业务副作用危险：

- 额度预占、Provider submit、Asset 登记、ContentPackage 写入、发布/交接，不能只把错误告诉模型后继续；
- 这些工具必须在 Pi 之外由 DBOS step 和现有 idempotency port 执行，或者至少设 `executionMode: "sequential"` 并在宿主层把 terminal business error 升格；
- `afterToolCall` 可以重写 `isError` 和 `terminate`，所以它本身也是策略边界，不能交给无审计扩展。

本项目 ContentPackage 写口已经具备 transaction、workspace/package advisory lock、idempotency receipt、fingerprint、OCC 和 rollback；Pi 的 tool result 语义不能取代它。[本地：`apps/core/src/p1/execution-spine/content-package-revision-port.ts:87-171`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:87)、[同文件 `:174-317`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/execution-spine/content-package-revision-port.ts:174)。

### 4.4 `AgentHarness`：能做进程内 orchestration，不能做 durable workflow

`AgentHarness` 构造参数包括 session、`Models`、tools、resources、system prompt、stream options、model、thinking、active tools 和 steer/follow-up mode；没有 max turn / max step 参数。[Pi 源码：`packages/agent/src/harness/types.ts` L911-L956](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/types.ts#L911-L956)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/types.ts:911-956`。

低层 `AgentLoopConfig` 提供 `shouldStopAfterTurn`，但高层 `AgentHarness.createLoopConfig()` 没有把这个控制点暴露给宿主，只设置 context、tool hooks、prepareNextTurn、steer 和 follow-up。[Pi 源码：`packages/agent/src/types.ts` L207-L226](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/types.ts#L207-L226)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/types.ts:207-226`。[Pi 源码：`packages/agent/src/harness/agent-harness.ts` L442-L497](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/agent-harness.ts#L442-L497)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/agent-harness.ts:442-497`。

所以高层 Harness 不能直接满足项目当前 `isStepCount(3)` 的硬上限。若采用它，必须额外以 AbortSignal / event counter 包装，或者改用低层 `agentLoop`。

它的运行锁是进程内 `phase` + `runPromise`；busy 时拒绝第二个结构操作。[Pi 源码：`packages/agent/src/harness/agent-harness.ts` L171-L223、L658-L705](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/agent-harness.ts#L171-L223)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/agent-harness.ts:171-223,658-705`。这不是跨进程 lease、DBOS workflow ID、effect idempotency 或 crash replay。

`save_point` 的实际实现是：turn end listener 后 flush pending session writes，再发一个事件；它没有 checkpoint transaction 或外部副作用 receipt。[Pi 源码：`packages/agent/src/harness/agent-harness.ts` L512-L565](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/agent-harness.ts#L512-L565)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/agent-harness.ts:512-565`。

### 4.5 crash 一致性与 orphan tool-call 风险

provider 完成 assistant message 时，loop 先发 `message_end`，之后才进入工具执行。[Pi 源码：`packages/agent/src/agent-loop.ts` L346-L370、L411-L425](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/agent-loop.ts#L346-L370)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/agent-loop.ts:346-370,411-425`。

`AgentHarness.handleAgentEvent()` 收到任何 `message_end` 就立即 `session.appendMessage()`。因此 assistant tool-call message 会在工具执行前持久化；若进程在工具运行中崩溃，session 可能只留下 tool call 而没有 tool result。[Pi 源码：`packages/agent/src/harness/agent-harness.ts` L538-L565](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/agent-harness.ts#L538-L565)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/agent-harness.ts:538-565`。

这对 coding transcript 是可接受的恢复材料，但对本项目外部副作用不够：

- 不能从“session 中有 tool call”推断 Provider 是否已受理；
- 不能自动重放 write tool；
- 必须继续使用 ProviderAttempt、DBOS step、receipt 和 `acceptance_unknown` 规则。

当前 P0 spec 明确要求任意 stage replay 不重复 Provider side effect、Asset、usage terminal event、audit 或 ContentPackage revision，并用 PostgreSQL + DBOS 验证恢复。[本地：`docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md:263-269`](/Users/bin/Desktop/开发/内容无人区/美业内容2/docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md:263)。

### 4.6 Session JSONL、tree 与 storage abstraction

值得复用的是接口设计：

- session entry 是 append-only tree；
- entry 有 `id`、`parentId`、timestamp；
- message、model、thinking、active tools、compaction、branch summary、custom、label、leaf 分开；
- `SessionStorage` 和 `SessionRepo` 是可替换接口；
- context projection 与完整审计 entry 分离。

[Pi 源码：`packages/agent/src/harness/types.ts` L375-L464、L481-L538](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/types.ts#L375-L464)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/types.ts:375-464,481-538`。

这套抽象可以启发“对话投影 / agent observation log”，但不能直接成为产品事实层：

- JSONL storage 逐行 append，先更新文件再更新内存；
- 打开时把整个文件读入内存；
- 实现没有跨进程 lock、fsync、OCC 或 multi-entry transaction；
- malformed entry 会直接使 session invalid，而不是业务级修复流程。

[Pi 源码：`packages/agent/src/harness/session/jsonl-storage.ts` L162-L215、L243-L287](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/session/jsonl-storage.ts#L162-L215)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/session/jsonl-storage.ts:162-215,243-287`。解析校验行为见 [Pi 源码：同文件 L53-L131](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/session/jsonl-storage.ts#L53-L131)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/session/jsonl-storage.ts:53-131`。

Pi 还提供单独的 Node SQLite session backend，说明 storage abstraction 可以落到事务存储，但它仍只是 session backend，不是 durable workflow。[Pi manifest：`packages/storage/sqlite-node/package.json` L1-L37](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/storage/sqlite-node/package.json#L1-L37)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/storage/sqlite-node/package.json:1-37`。其 adapter transaction 是本地 `BEGIN/COMMIT/ROLLBACK`，[Pi 源码：`packages/storage/sqlite-node/src/index.ts` L48-L80](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/storage/sqlite-node/src/index.ts#L48-L80)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/storage/sqlite-node/src/index.ts:48-80`。

### 4.7 Compaction 是对话可用性，不是事实压缩

Pi compaction：

- 默认 reserve 16,384 tokens，保留最近约 20,000 tokens；
- 优先用最近 assistant usage，缺失时用 `chars / 4` 估算；
- image 固定估算为 4,800 chars；
- 生成 summary 后把 compaction entry + retained tail 投影回 context。

[Pi 源码：`packages/agent/src/harness/compaction/compaction.ts` L163-L178、L230-L327](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/compaction/compaction.ts#L163-L178)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/compaction/compaction.ts:163-178,230-327`。[Pi 源码：`packages/agent/src/harness/session/session.ts` L59-L148](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/session/session.ts#L59-L148)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/session/session.ts:59-148`。

摘要输入会把单个 tool result 截到 2,000 chars；附带的文件操作识别只认识 `read` / `write` / `edit` 三个 coding tool 名。[Pi 源码：`packages/agent/src/harness/compaction/utils.ts` L23-L58、L74-L131](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/compaction/utils.ts#L23-L58)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/compaction/utils.ts:23-58,74-131`。

因此：

- 可用于长对话的 model context；
- 不得用于 StoreFact、rights、quota、DecisionTrace、Recipe revision、ContentPackage 的压缩或替代；
- 本项目每轮仍应从 immutable snapshot 和 confirmed ContextBundle 重建权威上下文；
- summary 只能是非权威 conversation aid。

### 4.8 Skills 与 ResourceLoader

`AgentHarness` 本身允许应用直接传入 resources，并明确由应用负责 loading/reloading；这比 coding-agent 的文件扫描更适合 SaaS。[Pi 源码：`packages/agent/src/harness/types.ts` L87-L96、L911-L939](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/types.ts#L87-L96)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/types.ts:87-96,911-939`。

但 Pi `Skill` 仍以完整 content + absolute `filePath` 建模，调用 prompt 和 system prompt 会把路径暴露给模型。[Pi 源码：`packages/agent/src/harness/types.ts` L58-L75](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/types.ts#L58-L75)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/types.ts:58-75`。[Pi 源码：`packages/agent/src/harness/skills.ts` L37-L40](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/skills.ts#L37-L40)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/skills.ts:37-40`。[Pi 源码：`packages/agent/src/harness/system-prompt.ts` L3-L24](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/system-prompt.ts#L3-L24)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/system-prompt.ts:3-24`。

本项目的 Skill 是 product artifact：Recipe 只绑定 immutable `skillRevisionRefs`，prompt body 不进入浏览器 DTO。[本地：`packages/contracts/src/creation-experience.ts:114-149`](/Users/bin/Desktop/开发/内容无人区/美业内容2/packages/contracts/src/creation-experience.ts:114)。Recipe Studio 还强制 exact revision，拒绝 `latest` 和未版本化依赖。[本地：`apps/core/src/p1/creation-experience/recipe-studio.ts:96-113`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/creation-experience/recipe-studio.ts:96)、[同文件 `:168-185`](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/creation-experience/recipe-studio.ts:168)。

推荐映射：

- PG / Langfuse 继续做定义与版本真相；
- StagePort 启动时按 snapshot 的 exact refs 拉取内容；
- 由本项目 system prompt compiler 注入，不复用 Pi filesystem loader；
- transcript 只记录 revision ref 和 prompt trace，不记录可变“当前 skill”。

完整 `pi-coding-agent` 的 `DefaultResourceLoader` 会扫描全局与 cwd 的所有祖先目录到文件系统根、解析 package resources、加载 extensions、skills、prompts、themes 和 AGENTS/CLAUDE context。[Pi 源码：`packages/coding-agent/src/core/resource-loader.ts` L88-L123、L341-L493](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/resource-loader.ts#L88-L123)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/resource-loader.ts:88-123,341-493`。这不符合多租户服务端的明确资源装配边界。

### 4.9 Extensions 与安全边界

coding-agent extension 是通过 Jiti 直接 import 的 TS/JS module，然后在同进程执行 factory；这不是 sandbox。[Pi 源码：`packages/coding-agent/src/core/extensions/loader.ts` L403-L427、L454-L479](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/extensions/loader.ts#L403-L427)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/extensions/loader.ts:403-427,454-479`。

coding-agent SDK 在未提供 allowlist 时默认启用 `read`、`bash`、`edit`、`write`。[Pi 源码：`packages/coding-agent/src/core/sdk.ts` L54-L73、L245-L251](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/sdk.ts#L54-L73)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/sdk.ts:54-73,245-251`。

虽然 ResourceLoader 有 project trust bootstrap，但它解决的是 coding CLI 是否加载 project-local resources，不是 SaaS 的 workspace isolation、RBAC、secret redaction、egress policy、per-tool approval 或 container sandbox。[Pi 源码：`packages/coding-agent/src/core/resource-loader.ts` L333-L360](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/resource-loader.ts#L333-L360)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/resource-loader.ts:333-360`。

`agent-core` 自带的 Node execution environment 也不是目录沙箱：路径层接受绝对路径、`~` 和 `file:` URL；shell 默认可继承 `process.env`，cwd 只是相对路径基准。[Pi 源码：`packages/agent/src/harness/env/nodejs.ts` L50-L64](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/env/nodejs.ts#L50-L64)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/env/nodejs.ts:50-64`。[Pi 源码：同文件 L237-L247、L415-L425](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/src/harness/env/nodejs.ts#L237-L247)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/src/harness/env/nodejs.ts:237-247,415-425`。若未来使用其 read/bash/edit/write 工具，必须另加容器或虚拟机、workspace root 围栏、环境变量白名单、超时和 egress policy。

所以生产禁止：

- 把运营配置上传成 coding-agent extension；
- 在 API worker 内加载租户提供的 TS；
- 默认启用 bash/file write；
- 让 extension hook 直接获得 canonical write port。

可安全复用的是低层 `beforeToolCall` block hook；实际授权仍必须由本项目 workspace、role、snapshot、rights、quota 和 capability gate 判定。

### 4.10 Provider abstraction、认证、错误与重试

`pi-ai` 的 Provider 抽象统一了：

- provider id/name/base URL/headers；
- API key / OAuth auth；
- 静态或动态 model catalog；
- `stream` / `streamSimple`；
- `Models` collection 的 auth resolve、model availability 和 delegation。

[Pi 源码：`packages/ai/src/models.ts` L66-L120、L122-L187](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/models.ts#L66-L120)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/models.ts:66-120,122-187`。

请求时 `Models` 会找到 provider、解析 credential、合并 headers/env/base URL，再委托 provider stream。[Pi 源码：`packages/ai/src/models.ts` L411-L429、L455-L526](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/models.ts#L411-L429)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/models.ts:411-429,455-526`。

DeepSeek provider 是 OpenAI Completions API 上的内建 provider factory。[Pi 源码：`packages/ai/src/providers/deepseek.ts` L1-L15](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/providers/deepseek.ts#L1-L15)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/providers/deepseek.ts:1-15`。

但项目已经用 Vercel AI SDK native/provider-compatible 路径承载相同问题，并额外拥有 schema-first structured output、UI message protocol 和既有 catalog/cost/receipt contracts。引入 `pi-ai` 会产生第二套：

- model identifier 和 catalog；
- auth store；
- request options；
- retry；
- usage/cost；
- provider error normalization。

Pi provider retry 默认 `maxRetries = 0`；显式开启时对 408/409/429/5xx 和无 status provider error 重试，尊重 retry-after，指数退避带 jitter，并可 abort。[Pi 源码：`packages/ai/src/utils/provider-retry.ts` L1-L35、L37-L67、L97-L124](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/utils/provider-retry.ts#L1-L35)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/utils/provider-retry.ts:1-35,37-67,97-124`。

另一个 assistant-level retry classifier 主要依赖 error message 正则，排除 quota/billing 后对 overload、429/5xx、网络和 stream premature end 重试。[Pi 源码：`packages/ai/src/utils/retry.ts` L3-L103、L144-L226](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/ai/src/utils/retry.ts#L3-L103)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/ai/src/utils/retry.ts:3-103,144-226`。

这类 retry 适合纯 LLM request 或 compaction，不足以处理本项目的 `acceptance_unknown`、冻结 route、usage ledger、provider receipt。重试主权必须继续在 Model Supply / DBOS stage，而不是交给 Pi 的通用 assistant retry。

### 4.11 API 稳定性与锁版成本

Pi 当前三个包都是 `0.82.1`，尚未到 1.0。AgentHarness 在最近三条 minor 系列持续发生 breaking：

- `0.80.0`：`Models` 变成 required、移除旧 auth 参数、compaction API 改签名、移除 selective-provider entry；
- `0.81.0`：`SessionStorage` 接口改动、stream function required；
- `0.81.1`：又恢复 host-configurable fallback；
- `0.82.0`：`ExecutionEnv` / tool context 设计再次替换。

[Pi 仓库版本记录：`packages/agent/CHANGELOG.md` L5-L41、L99-L108](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/agent/CHANGELOG.md#L5-L41)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/agent/CHANGELOG.md:5-41,99-108`。

本地固定镜像在“当前时间往前 30 天”范围内有约 339 个 commits；这个数字会随统计时点变化，但足以说明主分支高频演进。若做 PoC：

- 必须 exact pin commit 或 exact npm version，不能用 caret；
- 必须由项目自有 adapter 隔离所有 Pi types；
- 不允许业务 domain import Pi session/tool/provider types；
- 只有 adapter 的 contract tests 通过后才能升级。

## 5. 产品功能映射

| 当前产品能力 | Pi 覆盖度 | 可复用点 | 必须保留的项目边界 |
|---|---|---|---|
| D-112 五段内受限 agent loop | 中高 | loop、工具 schema、before/after hook、steer、并发标注 | DBOS 决定 stage 转移；宿主 max step；输出进 Zod contract |
| D-114 agent 流式对话主容器 | 中 | assistant/tool lifecycle event、queue、abort | HTTP/SSE/AG-UI/UI message protocol、任务卡、跨设备恢复仍由产品实现 |
| 事实槽满足度判断 | 中 | 只读 ContextBundle tool、结构化 tool args | confirmed facts、expiry、rights、snapshot 是硬事实；模型只出判断信号 |
| HITL 补问/确认 | 低到中 | follow-up queue 可承载本次进程内消息 | durable wait/resume、question revision、timeout、idempotency 继续用 DBOS |
| 结果阶段“还想怎么改” | 低 | steer/follow-up 只可改善交互响应 | 必须编译为 derived Work/revision；transcript 不是第二真相 |
| Skills / Recipe | 中（格式层） | skill listing/invocation 格式 | PG + Langfuse、exact revision、Recipe aggregate、审计与发布状态 |
| Provider abstraction | 高（独立看） | 多 provider、OAuth/API key、model catalog | 当前已有 AI SDK + Model Supply；不应双栈 |
| Structured compiler output | 低于现状 | 可用“最终工具调用”模拟 | 保留 `Output.object` + Zod |
| Session tree / branch / compaction | 高（对话层） | observation log、branch UI、model context compaction | 不得替代 StoreFact、Snapshot、DecisionTrace、ContentPackage |
| Durable workflow / crash replay | 低 | session 可恢复 transcript | DBOS、ProviderAttempt、receipt、idempotency、outbox |
| ContentPackage delivery | 无 | 无 | 唯一 revision port、OCC、rights、lineage、audit transaction |
| 多租户 / RBAC / quota | 无 | beforeToolCall 可作为最后一道 hook | Product Core 的 server gates |
| 沙箱 / extension isolation | 无 | 无 | 不执行租户 TS；工具由宿主 allowlist |

## 6. 可复用模块、耦合点与隐藏成本

### 6.1 可复用或值得移植

1. **低层 tool loop 语义**：特别是 preflight 顺序、execution 并行、result source-order。
2. **`executionMode: sequential`**：作为所有 business side-effect tool 的静态审查字段。
3. **`beforeToolCall` / `afterToolCall`**：前者做 authorization/policy，后者做 redaction/usage/terminal classification。
4. **steer / follow-up 分离**：前者是当前 run 的下一 turn 输入，后者是 run 完成后的新输入。
5. **SessionStorage / SessionRepo 接口形状**：只用于 agent observation / conversation projection。
6. **compaction 的“summary + retained tail”结构**：只用于 model context，不进 canonical facts。
7. **provider retry 的 abortable sleep 和 retry-after cap**：可作为现有 provider adapter 的实现参考，不直接引包。

### 6.2 核心耦合点

1. `AgentHarness.models: Models` 是硬依赖，turn、compaction、branch summary 全走 `pi-ai`。
2. `agent-core` 的 message/model/tool/event 类型来自 `pi-ai`。
3. `pi-coding-agent` root export 同时承载 SDK、CLI、TUI 与本地资源系统。
4. `createAgentSession()` 默认创建 auth/model runtime、settings、JSONL session 和 ResourceLoader，并默认开启四个 coding tools。
5. coding-agent module import 时会设置 global default stream function，存在模块级运行时副作用。[Pi 源码：`packages/coding-agent/src/core/sdk.ts` L1-L36](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/src/core/sdk.ts#L1-L36)；本地：`/tmp/pi-source-analysis.ja10Eq/pi/packages/coding-agent/src/core/sdk.ts:1-36`。
6. Pi tools 使用 TypeBox，项目输出和 HTTP contracts 使用 Zod；会增加 schema bridge。

### 6.3 容易低估的隐藏成本

- AI SDK ↔ Pi stream event 双向适配及异常语义；
- usage、reasoning、tool call、image、partial JSON、abort 的完整兼容测试；
- 两套 provider/model/auth/cost catalog 的漂移；
- max-step、token budget、time budget 的宿主实现；
- crash 后 orphan tool call reconciliation；
- DB-backed session adapter 的 workspace isolation、OCC 和 migration；
- compaction summary 的事实污染防护；
- Skill filePath 与内部路径泄漏；
- 任意 TS extension 的供应链和同进程权限；
- Pi 0.x 高频 breaking 的锁版、wrapper 和升级验证；
- Node `>=22.19.0` 的部署约束；
- 与当前 AI SDK `Output.object`、UI stream、MCP 和 provider packages 的重复依赖。

## 7. 明确不采用的部分

1. 不采用完整 `@earendil-works/pi-coding-agent` 进入 Core runtime。
2. 不采用默认 read/bash/edit/write。
3. 不采用 coding-agent filesystem ResourceLoader 作为产品 Skills/Recipe loader。
4. 不采用同进程 TS extensions 作为租户/运营扩展机制。
5. 不用 Pi JSONL/SQLite session 替代 PostgreSQL、DBOS 或 product records。
6. 不用 transcript / compaction summary 替代 CreationExecutionSnapshot、ContextBundle 或 StoreFact。
7. 不用 `AgentHarness.save_point` 宣称 durable checkpoint。
8. 不让 Pi tool 直接写 ContentPackage、额度、Asset、发布或 Provider submit。
9. 不在已有 `Output.object` compiler 上改成“最终工具调用”以迁就 Pi。
10. 不让 Pi provider retry 取代 Model Supply 的 acceptance / receipt / frozen-route 重试规则。

## 8. 若要 PoC，建议的最小合同

PoC 位置：只选一个尚需多步判断、但没有外部写副作用的 Harness StagePort，例如“事实槽满足度判断 + 建议补问”或“结果质量自检”。

输入：

- immutable `CreationExecutionSnapshot` ref；
- confirmed `ContextBundle` projection；
- exact Recipe / prompt / Skill revision refs；
- 最多 2～3 个只读工具；
- deadline、max step = 3、token budget。

输出：

- 项目自有 Zod schema；
- decision signal + evidence refs；
- tool trace（去敏）；
- usage；
- terminal classification；
- 不包含 Pi session ID 作为业务标识。

强制规则：

- `toolExecution: "sequential"`，即使工具当前只读，也先收窄行为；
- `beforeToolCall` 重新检查 workspace/snapshot/allowlist；
- 对所有 tool throw 做 terminal/non-terminal 分类，不能一律交回模型；
- DBOS `runStep` 包住整次 loop；
- 任何 semantic change 产生新 snapshot / Work，而不是修改 transcript；
- ContentPackage 只由第五阶段现有 revision port 写；
- 精确锁定 Pi SHA/版本，所有 Pi types 被 adapter 隔离。

验收：

1. 与当前 AI SDK baseline 做同一 fixture 对比；
2. 确认 3 step 后必停；
3. 并发、abort、tool throw、provider 429/5xx、process kill 后行为可解释；
4. 重放不产生任何重复业务 side effect；
5. session/summary 中没有 secret、内部绝对路径、未确认事实升级；
6. 删除 PoC adapter 后，业务 domain contracts 不受影响。

## 9. 决策结语

Pi 的源码质量在 agent loop、事件顺序、并行工具和 session tree 上是成熟且可读的；新 `AgentHarness` 也在向“应用自带 resources/tool context/storage”靠拢。但它目前仍是一个快速演进的 0.x 进程内 agent runtime，且 provider/session/tool semantics 与 `pi-ai` 强耦合。

本项目当前真正缺的不是“能调用工具的 Agent SDK”，而是把 D-112 的受限智能节点稳定装进已存在的：

```text
CreationExecutionSnapshot
  → DBOS five-stage Harness
  → AI SDK structured/streaming node
  → Product Core stage ports
  → sole ContentPackage revision port
```

因此当前最优决策是：**不换主干、不引完整 coding-agent、不引第二 provider stack；先借鉴 Pi 的 loop 设计。如果后续单 StagePort 证明现有 AI SDK step loop 确实不足，再以低层 adapter 做可删除 PoC。**
