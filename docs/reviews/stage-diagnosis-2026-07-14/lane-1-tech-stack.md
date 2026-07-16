# 阶段性回头诊断 · Lane 1：技术栈合理性 + 无效兜底审计

- 日期：2026-07-14
- 分支 / HEAD：`main` / `22a9d4e`（`feat: add Ark media execution adapters`，为本报告固定点（后续提交不在本报告范围内））
> 状态：历史诊断快照；当前代码与决策以仓库 HEAD 和 07-decision-log.md 为准。
- 维度：后端技术栈选型自洽性、对 ADR-0002/0005/0006/0007/0008 的实现漂移、`recorded/mock/fixture` 兜底通路的全量定位与"真实 provider 是否接通"判定、过度打磨的兜底细节 vs 真实产品能力缺失
- 阅读范围：`apps/core/src/p1/model-supply/{adapters,runtime-config,ai-sdk-runner,ark-media-adapter,media-generation-workflow,catalog,index,composed-video-workflow,ffmpeg-composition-port}.ts`、`apps/core/src/product/{copy-provider,model-supply-copy-provider,p1-model-policy}.ts`、`apps/core/src/{job-worker,main,server}.ts`、`apps/core/src/video/*`、`apps/core/src/p1/job-runtime/{pg-boss-job-port,graphile-worker-job-port,runtime-comparison}.ts`、`.env.example`、`apps/core/package.json`
- 站位：本报告站在 `docs/reviews/historical-review-implementation-reconciliation-2026-07-14.md`（下称"对账报告"，其固定点为 `dfa599a`）与 `p1-code-quality-deep-review-2026-07-12.md` 之上，只诊断"增量与现状"，重点核对 HEAD 提交（Ark 媒体适配器）对旧结论的推翻或延续。

---

## 一、现状实证

### 1.1 技术栈选型：整体合理且与 ADR 高度一致

后端依赖（`apps/core/package.json:22-33`）：

```
"@ai-sdk/mcp": 2.0.10, "@ai-sdk/openai-compatible": 3.0.7,
"@aws-sdk/client-secrets-manager": 3.1085.0, "ai": ^7.0.19,
"graphile-worker": 0.17.3, "pg": ^8.16.3, "pg-boss": 12.26.0,
"sharp": 0.34.5, "zod": ^4.4.3
```

逐项核对：

- **AI SDK v7 + `@ai-sdk/openai-compatible`**：与 ADR-0007（AI SDK first、Mastra deferred）一致。真实实现落在 `ai-sdk-runner.ts` —`OpenAiCompatibleAiSdkRunner` 用 `createOpenAICompatible` + `generateObject`/`streamText`（`ai-sdk-runner.ts:60-183`），结构化候选走 zod `generatedCopyCandidatesSchema`。未见 Mastra 依赖，ADR-0007 的"运行时 Port 即法律"在代码里成立：业务侧只依赖 `ProviderExecutionPort` 接口，AI SDK 仅出现在 runner 内部。**无漂移。**
- **PostgreSQL（`pg` + `pg-boss`）单一事实源**：与 ADR-0006（Workers 壳 + 单 Node 服务 + 托管 Postgres）一致。两个生产入口 `main.ts:263` 与 `job-worker.ts:106` 均 `PgBossJobPort.connect(...)`。**无漂移。**
- **`sharp`**：仅用于 Ark 图片下载后转 PNG（`ark-media-adapter.ts:394`），用途正当。
- **`@aws-sdk/client-secrets-manager`**：集成凭据库（对应 CONTEXT `集成凭据库`），属 P1 锁定方向。

**结论：技术栈本体选型合理、与 ADR 承诺自洽，没有引入未经 ADR 论证的自写 framework。** 这一层是这个仓库最扎实的部分。

### 1.2 "双队列"的真相：pg-boss 是唯一生产队列，graphile-worker 是休眠比较代码

任务路标写的"graphile-worker + pg-boss 双队列"在生产装配层**并不成立**：

- `GraphileWorkerJobPort`（`graphile-worker-job-port.ts:94`，590 行）在任何生产入口都**未被实例化**：`grep GraphileWorkerJobPort` 命中仅为其自身定义、`README.md` 与 `*.test.ts`；`main.ts`/`job-worker.ts` 都只用 `PgBossJobPort`。
- `runtime-comparison.ts:19-92`（92 行）自陈 `recommendation: 'pg-boss'`，并把 graphile 定位为 "viable control adapter"（可选比较适配器）。
- 二者合计 682 行 + 一个已发进 `package.json` 的 npm 依赖（`graphile-worker@0.17.3`），是一份"架构比较证据"被冻进依赖树，**没有任何生产消费者**。

所以真实拓扑是"pg-boss 单队列 + graphile 死代码"，不是冗余的双运行队列。这既不是致命问题，也不是双活风险，但属于 §三 要点的"过度打磨"一类：一个评估工件被固化为长期携带成本。

### 1.3 `recorded` 兜底的规模与默认档位

- `adapters.ts` 中 "recorded" 字面出现 **236 次**（`grep -oi recorded | wc -l`），`runtime-config.ts` 4 次。
- **默认档位是 `recorded`**：`runtime-config.ts:376` `const mode = env.MODEL_EXECUTION_MODE ?? 'recorded'`。仓库 `.env.example:15` 出货值是 `fixture`（且 `APP_ENV=e2e`，`fixture` 被硬闸到 e2e，`runtime-config.ts:388`）。
- 五种执行模式（`ModelExecutionRuntimeMode`，`adapters.ts:1330-1335`）：`disabled | recorded | fixture | gateway | direct`。真实 provider 只在 `direct`（LLM）与 media 侧 `MODEL_MEDIA_EXECUTION_MODE=ark` 两个档位接通，其余全为兜底。

### 1.4 三条链路的"真实 provider 是否接通"逐条判定

| 链路 | 真实通路是否存在 | 接通条件 | 默认/证据状态 |
|---|---|---|---|
| **文案（LLM copy）** | **是** | `MODEL_EXECUTION_MODE=direct` → `OpenAiCompatibleLlmExecutionPort`（`adapters.ts:215-262`）→ 真实 HTTP `generateObject`（`ai-sdk-runner.ts:78-99`） | 默认 recorded/fixture；live 测试 `live-llm-provider.integration.test.ts` 存在但 `RUN_LIVE_MODEL_PROVIDER_TEST=1` 才跑，CI 默认 skip |
| **图片（Seedream 5 Pro）** | **是（新增，HEAD 提交）** | `MODEL_MEDIA_EXECUTION_MODE=ark` → `ArkMediaExecutionPort.submitImage`（`ark-media-adapter.ts:446-496`）→ 真实 `POST /images/generations` | 默认 `disabled`；无 live 测试（`ark-media-adapter.test.ts` 全部 fetch-mock） |
| **视频（Seedance 2.0）** | **是（新增，HEAD 提交）** | 同上 → `submitVideo`（`ark-media-adapter.ts:498-528`）→ 真实 `POST /contents/generations/tasks` + 轮询 + 下载 | 默认 `disabled`；无 live 测试 |

**关键增量：HEAD 提交 `22a9d4e` 直接反转了对账报告的 P0-E 结论。** 对账报告（`historical-review-implementation-reconciliation-2026-07-14.md:157`，固定点 `dfa599a`）断言"`direct` 分支只提供真实 LLM，没有 media"。当前 HEAD 通过 `withArkMedia()` 把真实 Ark 媒体端口注入**所有五种模式**（`adapters.ts:1466/1474/1483/1493/1506`），因此 `recorded` + `ark`、`direct` + `ark` 都能拿到真实图片/视频执行面。该结论已过期，须以本报告为准。

### 1.5 Ark 适配器（888 行）是真调通，不是又一层 recorded

`ark-media-adapter.ts` 经逐行核对是**真实火山方舟直连适配器**，非兜底：

- 真实 `fetch`：图片 `POST {baseUrl}/images/generations`（`:459`）、视频 `POST {baseUrl}/contents/generations/tasks`（`:502`）、轮询 `GET .../tasks/{id}`（`:564`）、取消 `DELETE`（`:420`）、资产下载真实 `this.fetch(sourceUrl)` + `sharp` 转码（`:370-394`）。
- 真实鉴权：`authorization: Bearer {apiKey}`（`:576`）、`x-client-request-id` 幂等头。
- 真实错误分类：`classify(status, providerCode)`（`:114-130`）区分 content_policy/auth/rate_limit/quota/transient，密钥 `redact()`（`:878`）。
- 任务凭据用 AES-256-GCM 加密并按 workspace+effectKey+model+credentialVersion 作用域绑定（`encodeTaskRef`/`decodeTaskRef` `:665-733`）。
- 通过 `ArkMediaCompositeExecutionPort`（`adapters.ts:1359-1371`）**仅**把 `seedream-5-pro` 与 `seedance-2` 路由到 Ark，其余落回 fallback。

因此这是本轮最实的一块真实产品能力。但它有两条明确边界（见 §二 P1-1、P1-2）：只覆盖 8 个媒体模型中的 2 个，且无任何 live 冒烟证据（激活证据是 env 注入的哈希，不是探针结果）。

### 1.6 生产装配的真实档位（`main.ts` / `job-worker.ts`）

- `aiStreamingRunner` 三态（`main.ts:140-145`）：`fixture` → `FixtureAiStreamingRunner`；`live_verified && direct` → 真实 `OpenAiCompatibleAiSdkRunner`；否则 `undefined`（copilot/copy 流式 503 不可用，`server.ts:466-471`）。
- `mediaGeneration`/`mediaGenerationWorker` 仅在 `modelRuntime.media` 存在（即 ark 模式）时装配（`main.ts:296-304`、`job-worker.ts:205-242`）。
- 抖音、BYOK 仍是 `RecordedDouyinAdapter`、`RecordedByokExecutionAdapter`（`main.ts:334`、`job-worker.ts:199`）——延续对账报告 P0-E/P0-G，非本 lane 重点但确认未变。

---

## 二、缺陷清单（带严重度）

### P0-1 · `gateway` 模式的 Bifrost/LiteLLM 是纯 recorded，`BifrostLiteLlmComparison.report()` 是伪能力证据

- **证据**：`GatewayLlmRecordedMediaExecutionPort`（`adapters.ts:1391-1430`）——LLM 走 `RecordedGatewayPocPort`（`index.ts:858`，继承 recorded 模板拼接），媒体走 `RecordedAdapterRouter`（全兜底）。`createModelExecutionRuntime` 的 `gateway` 分支 `activation: 'recorded_only'`（`adapters.ts:1490-1499`）。
- **问题**：`BifrostLiteLlmComparison.report()`（`adapters.ts:1514-1671`，约 157 行）是一份手写的结构化"证据清单"，`productionDependency: false`、`productionTraffic: false`，其 `evidence[].reference` 全部指向 `adapters.test.ts#...` 锚点，而非真实网关探测结果。CONTEXT 的 `自托管执行网关验证` 把 Bifrost/LiteLLM PoC 定义为"P1 强制的隔离对比"，但代码里这个对比是一个**静态文档对象**，没有任何一次真实网关请求被发出。
- **严重度 P0**：这是"把研究结论当成已验证能力"的典型。157 行看似详实的对比报告会让读者误判 gateway PoC 已完成；实际是零真实执行。发布证据包（CONTEXT `模型供应发布证据包`）若引用它即为造假风险。

### P0-2 · 真实链路无一条 live 证据在 CI 内跑；"激活"由 env 注入哈希伪装

- **证据**：LLM live 测试 `live-llm-provider.integration.test.ts:22-27` 需 `RUN_LIVE_MODEL_PROVIDER_TEST=1`；Ark 无 live 测试（`ark-media-adapter.test.ts` 全 fetch-mock，`ark-media-adapter.test.ts:53` `fetchMock`）；唯一的真实 Ark 视频 live 测试 `video/ark-provider.live.test.ts` 属于**已孤立的旧栈**（见 P1-2）。`.env.example` 出货 `RUN_LIVE_MODEL_PROVIDER_TEST=0`。
- **问题**：`direct`/`ark` 的 `activation: 'live_verified'` 状态并非来自真实探针，而是来自 `runtime-config.ts:205-333` 对 `MODEL_*_ACTIVATION_EVIDENCE_REF` / `VERIFIED_AT` / `CONFIGURATION_REVISION` 三个环境变量的**格式校验 + 哈希比对**。即：只要运维填入一个 ISO 时间戳、一个 evidenceRef 字符串、以及与当前配置匹配的 sha256，系统就标记 `live_verified`（`runtime-config.ts:91-94`、`251-256`）。哈希只证明"配置没变过"，不证明"真的调通过一次"。
- **严重度 P0**：这是 CONTEXT `模型部署激活`/`模型证据状态` 的核心风险点——"未验证候选伪装成可提交"。当前机制允许在**从未真实调用**的情况下把 deployment 置为 active + live_verified，只要人填对三个环境变量。真实探针（哪怕一次 staging 冒烟落盘）缺失。

### P1-1 · 真实媒体只覆盖 8 个模型中的 2 个，其余 6 个在 ark 模式下仍是 recorded

- **证据**：`ArkMediaCompositeExecutionPort.execute`（`adapters.ts:1365-1370`）只对 `seedream-5-pro`、`seedance-2` 走真实 Ark，其余落 `fallback`（recorded）。首发模型池（CONTEXT `图片首发模型池`/`视频首发模型池`）为图片 4 个（GPT Image 2、Nano Banana 2、Nano Banana Pro、Seedream 5 Pro）+ 视频 4 个（Seedance 2.0、Kling、Grok、Veo），共 8 个。
- **问题**：`gpt-image-2`、`nano-banana-2`、`nano-banana-pro`、`kling-latest`、`grok-latest-video`、`veo-latest` 六个 CatalogModel 即便开了 `ark` 模式也只有 recorded 通路（`RECORDED_MEDIA_ADAPTER_CONTRACTS` `adapters.ts:402-427`）。用户若在目录里选中这 6 个中任一并提交，拿到的是 `RECORDED_PNG`（`adapters.ts:1265`）或 ffmpeg 合成的假 mp4（`adapters.ts:1278`）。
- **严重度 P1**：真实产品能力缺失。首发池 2/8 真实，产品对外声称的"四图四视频独立可选"（CONTEXT）在真实执行层只兑现 1/4 图 + 1/4 视频。

### P1-2 · 存在两套 Ark 视频真实适配器，旧栈 `apps/core/src/video/` 已孤立

- **证据**：
  - 旧栈 `apps/core/src/video/ark-provider.ts` 的 `ArkDirectVideoProvider`（真实 fetch，`video/ark-provider.ts:117/217`）在生产**未被引用**：`grep ArkDirectVideoProvider` 命中仅 `video/provider.test.ts`、`video/ark-provider.live.test.ts`。
  - `apps/core/src/index.ts:14` `export * from './video/index.js'` 把整个旧 video 模块对外导出，但 `main.ts`/`job-worker.ts` 只从 `ffmpeg-composition-port.ts` 间接用到 `video/composer.js`（真实 ffmpeg concat+drawtext，`composer.ts:179-197`）与 `video/product-renderer.js`，**没有**用到 `ArkDirectVideoProvider`。
  - 新栈 `ark-media-adapter.ts` 的 `ArkMediaExecutionPort` 才是 HEAD 提交接线的真实视频路径。
- **问题**：同一个火山方舟视频能力有两份真实实现——旧的 `ArkDirectVideoProvider`（孤立，Jul 10）与新的 `ArkMediaExecutionPort`（已接线，Jul 14）。旧栈连同其 `composer/proof/validation/product-renderer/provider` 约 10 个文件里，只有 `composer.ts`+`product-renderer.ts` 被合成端口复用，`ark-provider.ts`/`provider.ts`/`proof.ts` 的 video 生成职责已被新栈取代却未退役。
- **严重度 P1**：重复的真实 provider 实现 + 孤立死代码，维护面翻倍、事实源二义。属对账报告 §8「两套事实通过投影拼起来」的技术栈层同类问题。

### P1-3 · graphile-worker 死依赖：682 行 + 一个 npm 依赖服务于一份不运行的架构比较

- **证据**：见 §1.2。`GraphileWorkerJobPort`（590 行）+ `runtime-comparison.ts`（92 行）无生产消费者；`graphile-worker@0.17.3` 是已安装依赖。
- **问题**：ADR-0006/0007 的取向是"单部署单元 + 组装小工具"，携带一整套第二队列适配器（含 lease 续约、cron、DLQ 投影的自写扩展）只为一份 `recommendation: 'pg-boss'` 的对比证据，与"最小实现"取向相悖。
- **严重度 P1**：非功能缺陷，但属明确的过度工程与供应链面扩大；升级 pg-boss 或审计依赖时需连带维护一个永不启用的队列实现。

### P2-1 · 默认 `recorded` 文案是确定性字符串插值，且存在两份质量不一的 recorded copy 生成器

- **证据**：
  - 生产 `recorded` 模式经 `RecordedAdapterRouter` → `DirectLlmRecordedAdapter.execute` → `recordedBeautyCopy(prompt)`（`adapters.ts:41-89`），产出 3 条**基于 grounding 的、正文各异**的模板文案。
  - 但 `index.ts:794` 的 `RecordedProviderExecutionPort`（另一份 recorded LLM 生成器）产出的 3 条候选正文近乎同构，仅结尾 `强调${['到店体验','服务细节','预约行动']}` 不同（`index.ts:819-834`）——即 `p1-code-quality-deep-review-2026-07-12.md:25` 当时点名的那份。两份并存，取决于调用路径。
- **问题**：默认档位下用户看到的文案都非 AI 生成，是确定性插值；且仓库里存在质量不一致的两份 recorded 生成器，容易在不同装配路径下给出不同"假"结果。
- **严重度 P2**：默认不可用于真实质量评估（CONTEXT `内容质量闭环` 的采纳率/编辑距离在真模型接线前无法度量），但 `direct` 模式可绕过；属默认体验问题而非阻断。

### P2-2 · 过度打磨的兜底细节（成本：把将被替换的模拟层做成了生产级保真度）

按"打磨强度 vs 未来存活概率"排序，以下 recorded 细节属过度投入：

1. **`RECORDED_MEDIA_ADAPTER_CONTRACTS` + 错误状态机**（`adapters.ts:338-467`）：为每个 recorded 媒体模型声明 per-model 错误码、维度/时长边界、`submit/poll/download/cancel` 四相 `acceptance/billable/retryable` 合同、按 workspace+credential 的冷却（`cooldownUntilByScope`）、AES 任务引用、`recoveredTask` 恢复、`cancel_pending` 语义、late-terminal 对账（`media-generation-workflow.ts:338-454`）。这是对"没有真实供应商在背后"的适配器做了数百行供应商生命周期保真模拟。
2. **`createRecordedH264Video()`**（`adapters.ts:1278-1312`）：真实 shell out 到 ffmpeg 合成一段 1s H264 片段，作为**假**"provider 视频输出"。用真 ffmpeg 产假视频。
3. **`BifrostLiteLlmComparison.report()`**（157 行，见 P0-1）。
4. **`FixtureAiStreamingRunner`**（`ai-sdk-runner.ts:194-330）**：用定时器分块手写 SSE（含 `data-field_patch`、工具调用事件），为 fixture 打磨了逐字流式 UX。
- **严重度 P2**：这些不是 bug，但代表把工时投在了"注定被真实 Ark/direct 路径替换的兜底保真度"上，而真实能力缺口（P0-2 live 证据、P1-1 6 个模型）仍空着。是资源错配信号，不是代码错误。

---

## 三、阶段判定

统一标尺（L0 脚手架能跑 / L1 demo 能演示 / L2 真实商家可端到端用 / L3 商家易用），本 lane 只对"技术栈 + 模型执行面"这一纵切给出判定：

| 子链路 | 阶段 | 依据 |
|---|---|---|
| 技术栈本体（AI SDK / pg-boss / Postgres / sharp） | **L2-就绪** | 选型合理、与 ADR 自洽、真实库真实用，无自写 framework |
| 文案（LLM copy）执行面 | **L2-可达但未证明** | `direct` 真实通路存在且经 Runtime Port 接线；缺 CI 内 live 证据，默认 recorded |
| 图片（Seedream）执行面 | **L2-可配置未证明（本轮新增）** | Ark 真实适配器已接线；默认 disabled，无 live 冒烟，仅 1/4 图 |
| 视频（Seedance）执行面 | **L2-可配置未证明（本轮新增）** | 同上，ffmpeg 合成 shell 亦为真实；仅 1/4 视频 |
| gateway（Bifrost/LiteLLM）执行面 | **L1-伪装** | 纯 recorded + 静态证据对象，冒充 PoC |
| 其余 6 个媒体模型 | **L1** | ark 模式下仍 recorded |

**本 lane 综合判定：L1→L2 过渡带，且刚刚因 HEAD 的 Ark 提交向 L2 迈进了实质一步。**

技术栈这一层不是产品的短板——它扎实、自洽、无过度抽象。真正卡在 L2 门槛上的是两件事：（1）没有任何真实供应商调用在受控环境里被证明过一次（P0-2）；（2）"看起来完成"的表面积（236 处 recorded、157 行 gateway 报告、888 行 Ark、两套 video 栈）远大于"真实接通"的表面积（1 条 LLM + 2 个媒体模型，且都未 live）。这与对账报告 §8 根因「Done 语义坍缩」「fixture 掩盖最难部分」在技术栈层完全同构。

---

## 四、增量建议

按"解锁真实价值 / 移除误导性表面积"两类排序，均为最小增量、不扩范围：

1. **【对应 P0-2，最高优先】给真实链路补一次可落盘的 staging 冒烟，把"激活"从哈希校验升级为探针证据。** 让 `MODEL_*_ACTIVATION_EVIDENCE_REF` 指向一份**真实调用回执**（一次 direct LLM + 一次 Seedream + 一次 Seedance 的 staging 请求落盘），而不是仅校验 sha256。这是把"配置没变"升级为"真的调通过"的最小动作，直接解 CONTEXT `模型部署激活` 的伪装风险。

2. **【对应 P0-1】给 gateway 的"完成"祛魅。** `BifrostLiteLlmComparison.report()` 若无真实网关请求，应在 report 里显式标注 `evidenceKind: 'recorded_contract_only'` 并从任何"发布证据包"引用中排除；或真正起一个隔离 Bifrost 发一次请求。当前 157 行结构化报告是最容易被误读为"已验证"的对象。

3. **【对应 P1-1】明确 6 个未接真实适配器的媒体模型的证据状态。** 在目录投影里，把 `gpt-image-2/nano-banana-*/kling/grok/veo` 标为 `模型证据状态 = documented_unverified` 且在 ark 模式下不可提交（复用 CONTEXT `视频条件候选`/`模型证据状态` 语义），避免用户选中后拿到 recorded 假图/假视频却无提示。不要求立刻接 6 个，只要求诚实标注。

4. **【对应 P1-2】退役旧 video 栈的 provider 部分。** 保留 `video/composer.ts`+`video/product-renderer.ts`（合成端口在用），把 `video/ark-provider.ts`（`ArkDirectVideoProvider`）、`video/provider.ts` 及其 live/单测标为 superseded 或删除，`index.ts:14` 收窄导出。消除两套真实 Ark 视频实现的二义。

5. **【对应 P1-3】决定 graphile-worker 去留。** 若不打算真启用第二队列，将 `graphile-worker-job-port.ts` + `runtime-comparison.ts` 降级为 `docs/` 下的架构决策记录并从 `package.json` 移除 `graphile-worker` 依赖；ADR-0006 的"单部署单元"取向不需要在依赖树里长期携带一个不运行的队列。

6. **【对应 P2-1】收敛两份 recorded copy 生成器。** 让 `index.ts:794` 的 `RecordedProviderExecutionPort` LLM 分支复用 `adapters.ts` 的 `recordedBeautyCopy`（grounded、3 条各异），删除同构正文那份，消除装配路径导致的"假结果质量不一致"。

7. **【对应 P2-2，非阻断】冻结兜底保真度投入。** recorded 媒体错误状态机、`createRecordedH264Video`、fixture 逐字 SSE 已足够支撑 e2e 与 UI 演示，不再新增兜底细节；把工时转向 1、3 两项真实缺口。

---

### 附：对旧评审结论的增量校正（本 lane 范围内）

| 旧结论 | 出处 | 当前 HEAD（22a9d4e）校正 |
|---|---|---|
| "`direct` 只装配真实 LLM，图片/视频仍 recorded/fixture" | 对账报告 §6 P0-E（固定点 dfa599a） | **已部分过期**：Ark 提交为 Seedream/Seedance 接入真实媒体适配器并注入全模式；但仅 2/8 模型、无 live 证据 |
| "假 mp4、视频双轨已修" | `p1-code-quality-deep-review` §三 | **延续且新增二义**：ffmpeg 合成为真，但真实视频 provider 出现新旧两套（P1-2） |
| "recorded LLM copy 三条正文相同" | `p1-code-quality-deep-review:25` | **部分过期**：生产 recorded 路径已是 grounded 各异（`recordedBeautyCopy`），但同构那份仍留存于 `index.ts:819`（P2-1） |
| "pg-boss + graphile 双队列" | 任务路标 | **不成立**：pg-boss 单队列，graphile 为休眠比较代码（P1-3） |
