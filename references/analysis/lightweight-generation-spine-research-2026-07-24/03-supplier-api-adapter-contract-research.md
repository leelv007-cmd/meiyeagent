# 轻量生成主干：供应商 API 差异与最小适配器契约研究

- 日期：2026-07-24
- 研究票据：`lpgs-03`
- 结论性质：供应商契约研究与下一步决策输入，不是供应商选型
- 覆盖范围：同步 LLM、同步图片、异步图片/视频、参考素材、首尾帧、编辑、结构化输出、进度、取消、错误、用量/成本、临时资产

## 1. 执行摘要

供应商 API 可以统一的，只是很薄的一层产品语义：一次生成意图、一次确定的路由、一次或多次上游尝试、最终受管资产/文本结果，以及产品用量和供应商成本两本账。

不应统一成一个“OpenAI-compatible 万能协议”的部分更多：同步与异步、参考素材的角色和组合约束、图片编辑与视频延展、结构化输出支持范围、进度可信度、取消语义、上游接单不确定性、供应商原生用量维度、结果 URL 的保存期限和错误分类。官方文档与本仓库的 Tuzi/Ark 实现都直接证明，这些差异不是字段命名问题，而是不同的生命周期和产品能力。

建议采用“小公共内核 + 显式能力快照 + 两种生命周期端口”：

1. 同步端口处理 LLM、同步图片等一次请求即得到最终结果的能力。
2. 异步端口处理 submit/observe/fetch，并把 cancel 做成能力驱动的可选操作。
3. 所有提交都返回三态接单结果：`accepted`、`rejected_before_accept`、`acceptance_unknown`。
4. 输入素材必须携带语义角色，至少区分 `source`、`mask`、`reference`、`first_frame`、`last_frame`、`reference_video`，不能继续只靠通用 `reference_image`。
5. 适配器返回“原生观测事实”，成本金额由冻结的价格版本在适配器外计算；若供应商直接返回实付金额，也应作为 observed money 保留。
6. 生成成功只有在结果被复制进 `OwnedAsset` 后才能成为产品级成功；供应商临时 URL 只是待摄取来源。

现有架构中应保留：接单三态、不可变 RouteSnapshot、ProviderAttempt、跨进程 receipt、OwnedAsset 托管、ProductUsage/ProviderCost 双账本。应补强：能力表达、ProviderAttempt 证据、通用用量维度和资产期限证据。应简化：面向产品暴露的 Catalog/Route 字段，以及把所有媒体供应商强行塞进同一个必选 `cancel` 生命周期。

## 2. 研究方法与证据边界

本研究先读当前代码，再以供应商官方文档/官方 API Reference 为主证据。所有网络检索和正文阅读优先使用 Open CLI：

- 搜索：`opencli google search ... -f yaml`、`opencli duckduckgo search ... -f yaml`
- 已知页面：`opencli web read --url ... --stdout -f yaml`
- 本文没有使用 Web Search 结果作为结论证据。

已核验的主要一手页面包括：

- OpenAI：[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[Image edit](https://developers.openai.com/api/reference/resources/images/methods/edit/)、[Background mode](https://developers.openai.com/api/docs/guides/background)、[Cancel a response](https://developers.openai.com/api/reference/resources/responses/methods/cancel/)
- Anthropic：[Messages API](https://platform.claude.com/docs/en/api/messages)、[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)、[Errors](https://platform.claude.com/docs/en/api/errors)
- Google：[Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)、[generateContent](https://ai.google.dev/api/generate-content)、[Image generation](https://ai.google.dev/gemini-api/docs/image-generation)、[Veo](https://ai.google.dev/gemini-api/docs/veo)
- 火山方舟：[图片生成 API Center](https://api.volcengine.com/api-docs/view?action=ImageGenerations&version=2024-01-01&serviceCode=ark)、[创建视频任务 API Center](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&version=2024-01-01&serviceCode=ark)、[查询视频任务 API Center](https://api.volcengine.com/api-docs/view?action=GetContentsGenerationsTask&version=2024-01-01&serviceCode=ark)、[取消/删除视频任务 API Center](https://api.volcengine.com/api-docs/view?action=DeleteContentsGenerationsTasks&version=2024-01-01&serviceCode=ark)
- Kling：[图生视频](https://klingai.com/document-api/api/video/3-0-omni/image-to-video)、[回调协议](https://klingai.com/document-api/api/get-started/callbacks)
- xAI：[Videos API](https://docs.x.ai/developers/rest-api-reference/inference/videos)、[Cost tracking](https://docs.x.ai/developers/cost-tracking)

### 2.1 Open CLI 降级记录

火山方舟的部分 `www.volcengine.com/docs` / `docs.volcengine.com/docs` 页面在 Open CLI Browser Bridge 中跳转到 `about:blank#blocked`，无法稳定读取正文。对这些页面只采用了以下已核验材料：

- Open CLI 能成功读取的“查询视频生成任务”正文；
- Open CLI 搜索返回的官方页面摘要；
- Open CLI 能读取的火山 API Center 入口；
- 当前 Ark 适配器实现作为“本仓库现状”，不把它冒充官方契约。

因此，下文对 Ark 创建/取消能力只保留已核验的保守表述，不推断未验证的请求字段、幂等承诺或强取消保证。

## 3. 当前实现的契约画像

### 3.1 已经做对的结构

1. **接单三态是正确且必要的。** `MediaProviderSubmissionReceipt` 已明确区分 `accepted`、`acceptance_unknown`、`rejected_before_accept`；这能阻止网络超时后的危险重提。[provider-lifecycle.ts:137-150](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:137)
2. **同步与媒体生命周期已经部分分开。** 同步侧是单一 `execute`，媒体侧是 `submit/recover/poll/download/cancel`，比强行假设所有生成都是同步更接近真实世界。[provider-lifecycle.ts:110-150](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:110) [provider-lifecycle.ts:180-217](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:180)
3. **跨进程 receipt 是正确的可靠性边界。** 当前接口要求持久化上游 receipt，用于 kill/restart 后恢复，且 Ark 在缺 receipt 时明确不重提可能已接单的任务。[provider-lifecycle.ts:219-226](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:219) [ark-media-adapter.ts:472-485](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ark-media-adapter.ts:472)
4. **路由冻结和双账本值得保留。** RouteSnapshot 保留部署、价格版本、数据策略和回退路径；ProductUsage 与 ProviderCost 分别表达产品权益和真实供应成本，不能合并。[route-contracts.ts:172-249](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/route-contracts.ts:172) [ledger-contracts.ts:25-37](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ledger-contracts.ts:25)
5. **取消后的终态对账已进入领域模型。** 用户取消不等于供应商不再执行或不再计费，当前单独记录 cancelled terminal reconciliation 的方向是对的。[ledger-contracts.ts:39-50](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ledger-contracts.ts:39)

### 3.2 现在会阻碍多供应商接入的缺口

1. **素材角色不够。** 当前只有 `reference_image/reference_video/reference_audio/mask`，表达不了首帧、尾帧、编辑源图、角色参考与普通风格参考。[supply-contracts.ts:44-55](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/supply-contracts.ts:44)
2. **能力声明过薄。** `CanvasGenerationCapability` 只有 operation、参数名和输入角色，没有数量、MIME、互斥组合、同步/异步、进度、取消、输出交付、期限和计费维度。[supply-contracts.ts:82-86](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/supply-contracts.ts:82)
3. **异步端口把 cancel 设为必选。** 同步图片无法取消；部分视频供应商没有已验证取消；部分平台只是 best-effort。要求所有适配器实现同一强语义会制造假能力。[provider-lifecycle.ts:180-203](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:180)
4. **ProviderAttempt 证据不足。** 目前只有 id/job/model/deployment/acceptance/taskRef/status/time，缺 phase、上游 request id、原生状态、错误码、retry-after、是否可重试、是否可能计费和原生 usage 证据。[route-contracts.ts:251-260](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/route-contracts.ts:251)
5. **成本单位过窄。** ProviderCost 只允许 input/output tokens 和 mediaUnits，容纳不了缓存 token、图片 token、生成张数、视频时长/帧数/像素、GPU seconds、资源包扣减或供应商直接返回的实付金额。[ledger-contracts.ts:31-37](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ledger-contracts.ts:31)
6. **TTL 事实与估计混在一起。** Ark 当前依据本地配置和时间戳推断 `sourceExpiresAt`；应明确标记 observed/documented/estimated，不能把估计期限当供应商返回事实。[ark-media-adapter.ts:1168-1180](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ark-media-adapter.ts:1168)
7. **LLM 结构化能力存在过度乐观默认。** AI SDK runner 正确区分 OpenAI、Anthropic、Gemini 原生协议，但 custom/OpenAI 分支仍硬编码 `supportsStructuredOutputs: true`，而各家 schema 子集、拒答和流式错误行为不同。[ai-sdk-runner.ts:32-55](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ai-sdk-runner.ts:32) [ai-sdk-runner.ts:648-695](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ai-sdk-runner.ts:648)
8. **Tuzi 已证明“兼容”不等于同构。** 其代码把图片改为 multipart edit，把视频重新映射；注释记录 `first_frame/last_frame/input_reference` 互斥，实际暂只映射一个 reference，且因上游行为暂不发送 duration。[tuzi-media-adapter.ts:172-225](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/tuzi-media-adapter.ts:172) [tuzi-media-adapter.ts:254-295](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/tuzi-media-adapter.ts:254)
9. **Ark 当前只发送通用 reference 角色。** 视频请求只区分 `reference_image/reference_video`，无法表达官方和其他供应商已有的 first/last frame 语义。[ark-media-adapter.ts:760-840](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/ark-media-adapter.ts:760)
10. **Recorded adapter 只能是测试夹具。** 它把能力、价格、TTL 和错误写成录制契约，适合做 conformance fixtures，不应作为当前官方能力事实。[recorded-media-adapters.ts:43-151](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/recorded-media-adapters.ts:43)

## 4. 官方供应商差异矩阵

| 供应商/接口 | 生命周期 | 输入与编辑 | 进度/取消 | 用量与成本 | 资产交付与期限 | 对适配器的含义 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI LLM | 同步或流式 | Structured Outputs 是模型和 JSON Schema 子集相关能力；需处理 refusal/incomplete | 流中断不是媒体任务取消 | input/output 等 token usage | 文本/JSON | 结构化输出必须是 capability，不能对兼容端点默认 true |
| Anthropic Messages | 同步或 SSE | 文本/图片消息；结构化输出仍受 schema 约束 | SSE 可在 HTTP 200 后报错；SDK 对部分暂态错误重试 | input/output、cache 相关 token 维度 | 文本/JSON | HTTP 成功不等于流成功；usage 维度不可压成只有两种 token |
| Gemini generateContent | 同步或流式 | JSON Schema 子集；返回值仍需业务语义校验；可有 promptFeedback/finishReason | 无媒体任务状态 | usageMetadata | 文本、inline data | 安全阻断与普通生成失败应分开记录 |
| OpenAI Images | 生成/编辑通常同步 | 多参考图、mask、图片编辑；不同模型参数和数量限制不同 | 没有可轮询媒体 task；不能承诺提交后取消 | 文本/图片输入 token、输出图片 token | GPT Image 默认可返回 base64 | 同步媒体不要伪装成异步任务；输出可以是 inline bytes |
| Gemini Image | 通常由 generateContent/Interactions 返回 | 文本生图、图像编辑、多参考、多轮；模型可同时返回文本和图 | 无统一任务取消 | 模型特定 token/cost | inline base64 等 | 结果 cardinality 和 content parts 必须按模型能力解释 |
| Google Veo | 长任务 operation，轮询完成 | 文生视频、图生视频、最多若干参考图、首帧+尾帧、延展；组合与模型版本相关 | operation 状态；本文未验证供应商取消保证 | 模型/分辨率/时长相关 | 官方文档提示生成视频保留 2 天，应及时下载 | first/last/reference/extend 必须是一等语义；成功后立即托管 |
| 火山方舟 Seedream | 图片接口同步返回 | 生成/编辑、URL 或 Base64；能力随模型变化 | 同步图片没有可用的提交后取消 | 可返回 generated_images / token 类 usage | 官方生成结果 URL 有效期为 24 小时 | 不应要求 image adapter 实现异步 poll/cancel |
| 火山方舟 Seedance | 创建任务后按 id 查询，也可 callback | 多模态 reference；首尾帧相关能力随模型/接口变化，另有 `return_last_frame` | queued/running/succeeded/failed/expired/cancelled；DELETE 行为取决于状态 | completion_tokens 等可作为计费对账证据 | 任务 id 保存 7 天，结果 URL 有效期为 24 小时 | receipt 和 taskRef 必须先落盘；cancel 不是简单布尔值 |
| Kling Video 3.0 | 创建异步任务，轮询或 callback | `first_frame`、`last_frame`、主体等显式角色；URL/Base64 输入 | submitted/processing/succeeded/failed；未验证 provider cancel | 返回 cash/unit 扣减信息和 list price 等 | 结果防盗链约 30 天 | 角色、扣减类型、TTL 与 Ark 都不同，不能只改 endpoint |
| xAI Videos | request_id + polling | 文/图生视频；另有 edit 和 extension API | pending/done/expired/failed，并可返回真实 progress；未验证 provider cancel | `cost_in_usd_ticks` 是本次实际扣费 | 返回临时 URL | 精确金额可以 observed money 落账；progress 不能强迫其他供应商伪造 |
| Tuzi 中转 | 本仓库实现在 Ark 生命周期外重写协议 | edit multipart、单 reference 映射、部分参数因上游问题丢弃 | 复用 Ark 观察语义，不代表官方同构 | 依赖本地价格配置 | 依赖中转返回 URL | 无公开官方契约时只能作为独立 provider profile，不得继承“OpenAI compatible”能力 |

当前首发 Catalog 中的 OpenAI、Google、Seedream 图片候选，对应已核验官方路径均是“同次响应返回结果/内容”的同步形态。[catalog.ts:395-447](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:395) 因此本文不虚构一个“已验证异步图片供应商”；候选合同允许媒体部署将 `execution.mode` 声明为 `async`，但未来异步图片只有完成该供应商的 submit/observe/fetch、接单不确定性和资产期限合同验证后才能激活。

## 5. 分维度差异结论

### 5.1 同步 LLM 与异步媒体不能共用一个生命周期

同步 LLM 的主要终态在同一 HTTP/SSE 会话内发生；失败可能发生在建立 200 响应后。异步视频在 submit 接单后才进入另一个可持续数分钟的任务生命周期。

所以统一点只能是 `GenerationOutcome`，不能统一过程。若把所有供应商都塞进 `execute()`：

- 异步任务会隐藏 receipt、恢复、取消和资产过期；
- 若把所有供应商都塞进 `submit/poll/cancel()`，同步图片会产生虚假 task 和虚假 cancel。

### 5.2 参考素材必须有语义角色与组合约束

“有几张参考图”不足以描述视频输入：

- Kling 和 Veo 明确区分首帧、尾帧和普通参考；
- Ark/Seedance 具有首尾帧和多模态参考模式，部分模式互斥；
- 图片编辑还需要 source 与 mask；
- xAI video edit/extension 接受的是既有视频，不是 reference image；
- 模型间还存在数量、顺序、MIME、大小、分辨率与可组合性差异。

最小公共表达应保留语义角色，但不建立一套试图覆盖未来所有供应商的巨型 DSL。每个部署以版本化 capability 描述“允许哪些角色、各自 cardinality、哪些组合可用”。

### 5.3 结构化输出不是布尔意义上的“兼容”

OpenAI、Anthropic、Gemini 都有结构化输出，但存在：

- 支持的 JSON Schema 子集不同；
- 首次 schema 编译延迟、SDK 自动移除不支持约束等实现差异；
- refusal、safety block、incomplete、流式中途错误等非 schema-success 终态；
- 即使 JSON 符合 schema，Gemini 官方仍建议做业务语义验证。

因此 capability 至少要绑定模型/部署和 schema profile；不能因为 endpoint 形似 OpenAI 就设 `supportsStructuredOutputs: true`。

### 5.4 进度只能表达“供应商实际提供的证据”

供应商可能提供：

- 仅终态；
- queued/running 阶段；
- queue position；
- runner logs；
- callback；
- xAI 一类真实百分比进度。

统一的 `progress: number` 会诱使适配器伪造百分比。更稳妥的是 `stage` 必有、`fraction` 可选并附 `source: provider_observed`。

### 5.5 取消不是一个布尔结果

至少有五种真实情况：

1. 同步调用已完成，不存在取消；
2. 排队中可确定移除；
3. 运行中只发送 best-effort 信号，仍可能完成；
4. 供应商 DELETE 的行为随任务状态变化；
5. 供应商没有已验证的取消能力。

取消结果应是 `unsupported/requested/cancelled/already_terminal/unknown`，并继续 reconciliation，不能把用户侧 `cancel_requested` 直接写成供应商 `cancelled`。

### 5.6 错误需要同时保留标准类与原生证据

建议的稳定错误类只用于产品策略：

- `invalid_input`
- `authentication`
- `permission`
- `quota_exhausted`
- `rate_limited`
- `safety_blocked`
- `asset_unavailable`
- `provider_unavailable`
- `timeout`
- `provider_internal`
- `unknown`

同时必须保留 `phase`、HTTP status、provider code/message、upstream request id、retry-after、retryable、acceptance、可能计费状态。尤其 submit 超时不能简单归到 retryable：如果供应商可能已经接单，重试会造成重复任务和重复成本。

### 5.7 用量和成本不能只有 token，也不能由适配器随意估价

官方 API 已出现以下不同事实：

- LLM input/output/cache token；
- 图片输入/输出 token、生成张数；
- 视频 completion token、时长、帧/分辨率；
- 供应商资源包单位或 cash 扣减；
- xAI 直接返回本次实际扣费 `cost_in_usd_ticks`。

建议适配器输出通用 measurement 列表与 observed money；价格计算使用 RouteSnapshot 冻结的 price revision 在适配器外执行。这样更换价表不需要改 provider adapter，也可以在 observed 与 estimated 之间对账。

### 5.8 临时 URL 不是产品资产

官方期限差异显著：Veo 约 2 天、Ark 约 24 小时、Kling 约 30 天；部分供应商直接返回 Base64/inline bytes。共同契约应把这些都归一成“上游资产来源”，然后复制到本方 OwnedAsset。

产品级完成条件应为：

`provider terminal success -> source verified -> bytes copied -> checksum/content type recorded -> OwnedAsset durable -> product success`

如果上游成功但下载或托管失败，应处于 `asset_ingest_pending/failed`，而不是丢失供应商成本或误报为完整成功。

## 6. 建议的最小适配器契约

下面是决策形状，不是要求立即复制进代码的最终 TypeScript：

```ts
type Acceptance =
  | "accepted"
  | "rejected_before_accept"
  | "acceptance_unknown";

type InputRole =
  | "source"
  | "mask"
  | "reference"
  | "first_frame"
  | "last_frame"
  | "reference_video"
  | "reference_audio";

interface ProviderInputAsset {
  role: InputRole;
  ordinal: number;
  contentType: string;
  byteSize: number;
  checksum: string;
  delivery: ProviderAssetDelivery;
}

interface ProviderRequest {
  effectId: string;
  attemptId: string;
  idempotencyKey: string;
  operation: ModelOperation;
  prompt?: string;
  structuredOutput?: StructuredOutputRequest;
  inputAssets: ProviderInputAsset[];
  parameters: Record<string, unknown>;
  runtimeBinding: ProviderRuntimeBinding;
}

interface UpstreamEvidence {
  providerRequestId?: string;
  providerStatus?: string;
  measurements: UsageMeasurement[];
  observedCost?: Money;
  rawError?: {
    httpStatus?: number;
    code?: string;
    message?: string;
    retryAfterMs?: number;
  };
}

type AcceptedCompletion =
  | { kind: "completed"; result: ProviderResult }
  | { kind: "deferred"; taskRef: string };

type SubmitResult<
  TCompletion extends AcceptedCompletion = AcceptedCompletion,
> =
  | {
      acceptance: "accepted";
      completion: TCompletion;
      evidence: UpstreamEvidence;
    }
  | {
      acceptance: "rejected_before_accept";
      error: NormalizedProviderError;
      evidence: UpstreamEvidence;
    }
  | {
      acceptance: "acceptance_unknown";
      recoveryRef?: string;
      error: NormalizedProviderError;
      evidence: UpstreamEvidence;
    };

interface SynchronousGenerationAdapter {
  submit(
    request: ProviderRequest
  ): Promise<SubmitResult<{ kind: "completed"; result: ProviderResult }>>;
}

interface AsynchronousGenerationAdapter {
  submit(request: ProviderRequest): Promise<SubmitResult>;
  observe(taskRef: string): Promise<TaskObservation>;
  fetch(taskRef: string): Promise<ProviderResult>;
  cancel?(
    taskRef: string
  ): Promise<
    | "requested"
    | "cancelled"
    | "already_terminal"
    | "unknown"
  >;
}
```

### 6.1 为什么这个契约足够小

- `ProviderRequest` 不包含美业、画布、套餐、营销场景等产品领域字段。
- 不把所有供应商参数强行标准化；先由 capability 验证公共语义，再把少量模型参数留在已验证的 `parameters`。
- `SubmitResult` 同时容纳同步完成和异步 task，但没有要求同步适配器实现 poll/cancel。
- `taskRef` 必须是不透明且作用域受控的引用；产品层不解析供应商 ID。
- `ProviderResult` 可以包含文本、结构化对象、inline bytes 或临时 asset source，但产品层只消费托管后的 OwnedAsset。
- 原生错误和 usage 是证据，不直接成为产品状态或用户计费。

## 7. 最小能力清单

能力应绑定 `provider + model/deployment + revision`，而不是只绑定供应商品牌。

```ts
interface GenerationCapability {
  revision: string;
  execution: {
    mode: "sync" | "async";
    observation: "none" | "poll" | "webhook" | "poll_or_webhook";
    progress: "terminal_only" | "stages" | "fraction";
    cancellation:
      | "none"
      | "queued_only"
      | "best_effort"
      | "provider_state_dependent";
    idempotency:
      | "provider_key"
      | "recoverable_client_reference"
      | "local_receipt_only";
  };
  operations: ModelOperation[];
  inputs: {
    roles: InputRoleCapability[];
    allowedCombinations: InputRoleCombination[];
  };
  structuredOutput?: {
    supported: boolean;
    schemaProfile?: string;
    streaming?: boolean;
  };
  outputs: {
    kinds: Array<"text" | "json" | "image" | "video" | "audio">;
    delivery: Array<"inline_bytes" | "temporary_url" | "provider_file">;
    count?: { min: number; max: number; exact: boolean };
  };
  assetRetention: {
    kind: "documented" | "observed" | "estimated" | "unknown";
    seconds?: number;
  };
  usageMetrics: string[];
}
```

首发并不需要实现任意布尔表达式式的 capability DSL。`allowedCombinations` 只需列出经过合同测试的组合，例如：

- `[first_frame]`
- `[first_frame, last_frame]`
- `[reference x 1..3]`
- `[source, mask]`
- `[reference_video]`

未列出的组合在路由前拒绝，避免把供应商 400 当产品能力探测。

## 8. 哪些内容不应该被统一

1. **供应商请求/响应字段名和 endpoint。** 这些只存在于 adapter 内。
2. **一个全局参数全集。** `duration`、`size`、`quality`、`resolution`、`audio` 在不同模型上的合法值和含义不同。
3. **一个固定 reference 数量。** 应由部署 capability 决定。
4. **一个统一的 edit。** mask edit、conversational edit、video edit、extension 是不同 operation。
5. **一个强取消语义。** 只统一“用户请求了取消”和供应商观测结果。
6. **一个伪造进度百分比。** 没有上游证据时只展示阶段。
7. **一个 token-only usage。** 用通用 measurement，不丢原始计费事实。
8. **一个统一 TTL。** 每个 source 都携带自己的 retention evidence。
9. **一个结构化输出布尔值。** 必须绑定 schema profile 和模型 revision。
10. **“OpenAI-compatible = capability-compatible”。** Tuzi 的协议重写和参数丢弃已经构成反例。

## 9. 对 Catalog / Route / ProviderAttempt / 双账本的建议

### 9.1 Catalog：保留，但分成产品能力和供应运行两层

保留：

- 模型/部署稳定标识；
- operation；
- 版本化 GenerationCapability；
- 状态与 capability evidence；
- 价格版本引用。

从产品可见 Catalog 降级到内部运行层：

- base URL、API family、credential ref、region；
- provider profile/channel；
- 供应商健康、熔断、排水；
- 原生模型名和 endpoint revision。

这些字段仍需要存在，但不应泄漏到画布、营销任务或业务 API。当前 `AdapterRuntimeConfig` 已混合 endpoint、pricing、TTL 等关注点，后续应拆成 binding、retention policy 和 pricing snapshot。[provider-lifecycle.ts:20-43](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/provider-lifecycle.ts:20)

### 9.2 RouteSnapshot：保留不可变性，简化对外形状

建议形成两个组合快照：

- `GenerationRouteSnapshot`：选择策略、capability revision、数据策略、价格版本、fallback 次序；
- `ProviderBindingSnapshot`：provider/deployment/model/endpoint/credential revision 等运维事实。

不要现在直接删除现有 RouteSnapshot 字段。先用查询和审计证据证明哪些字段从未参与重放、成本对账、事故定位或合规审计，再做收缩。目标是隔离，不是牺牲可追溯性。

### 9.3 ProviderAttempt：应补强，而不是删除

建议新增：

- `phase: submit | observe | fetch | cancel`
- `providerRequestId`
- `providerStatus`
- `normalizedErrorClass`
- `providerErrorCode`
- `httpStatus`
- `retryAfterMs`
- `retryable`
- `billability: none | possible | observed | unknown`
- `measurements`
- `startedAt/acceptedAt/terminalAt`

原生 message 可进入受限诊断存储，避免直接向用户透传敏感内容。

### 9.4 ProductUsage / ProviderCost：双账本必须保留

两者解决不同问题：

- ProductUsage：用户额度预留、提交、退款；
- ProviderCost：供应商成本估计、观察、对账。

应把 ProviderCost 的固定 usage 对象改成 measurements，并允许：

- `status: estimated | observed | reconciled`
- `pricingRevision`
- `observedMoney`
- `calculatedMoney`
- `variance`

用户取消、供应商最终成功且计费的场景继续通过 cancelled terminal reconciliation 连接两本账。

### 9.5 OwnedAsset：提升为成功门槛

保留 `sourceTaskRef` 和 `sourceTtlEvidence`，并补充：

- source URL/inline 的来源类型；
- observed/documented/estimated retention；
- ingest attempt 与失败原因；
- checksum、byteSize、contentType；
- custody completed time。

只有 custody 完成后，产品 UI 才应显示“已完成并可长期使用”。

## 10. 推荐优化顺序

### P0：先锁契约，再接新供应商

1. 将素材角色扩展到 source/mask/reference/first/last/reference_video/reference_audio。
2. 把媒体 adapter 拆成 sync/async 两种生命周期；`cancel` 改为 capability 驱动。
3. 扩充 ProviderAttempt 的原生证据和 phase。
4. 将资产摄取纳入产品成功状态机。
5. 取消 custom/OpenAI-compatible 结构化输出的硬编码 true。

### P1：建立能力与对账

1. 引入 versioned GenerationCapability 和组合级校验。
2. ProviderCost 改为 measurements + observed money + frozen price revision。
3. TTL 改为 documented/observed/estimated/unknown 证据。
4. 将 recorded adapters 明确降级为 fixture，并新增官方合同/生产探针证据层。

### P2：再做控制面简化

1. 分离产品 Catalog 与内部 provider binding。
2. 统计 RouteSnapshot 字段的实际审计/重放使用后再删减。
3. 为 webhook 签名、重复投递、乱序投递建立统一 intake，但不要求所有供应商都支持 webhook。

## 11. 必须通过的合同测试

每个 adapter/deployment 至少应通过以下 conformance tests：

1. capability 拒绝不支持的 role、数量和组合，且不发上游请求；
2. submit 连接在“可能已接单”位置断开时返回 `acceptance_unknown`，不会自动重提；
3. accepted receipt 在返回业务层之前已经 durable；
4. 重启后能凭 taskRef/receipt 恢复；不能恢复时保持 unknown；
5. sync provider 不产生伪 task，不宣称可取消；
6. queued-only / best-effort / state-dependent cancel 分别产生正确 reconciliation；
7. webhook 重复、乱序和漏投时，轮询能收敛到相同终态；
8. 上游 URL 即将过期、已过期、下载中断时，资产状态和供应商成本不丢；
9. observed usage、estimated cost、observed money 与 frozen price revision 可复算；
10. provider 400/401/403/429/5xx、安全阻断、HTTP 200 后流错误映射到稳定错误类，同时保留原生 request id/code；
11. 结构化输出分别覆盖 schema unsupported、refusal/safety、incomplete、语义校验失败；
12. recorded fixtures 与 live probe 明确分层，fixture 通过不能被报告成“供应商已验证”。

## 12. 对下一票据 `lpgs-11` 的决策输入

建议下一票据只锁定以下内容：

1. `SynchronousGenerationAdapter` 与 `AsynchronousGenerationAdapter` 的边界；
2. SubmitResult 接单三态和 deferred/completed 分支；
3. InputRole 最小集合与组合型 capability；
4. TaskObservation、cancel 多态结果和 asset ingest 状态；
5. UpstreamEvidence/UsageMeasurement/ProviderAttempt 的最小字段；
6. Catalog/Route 的两层隔离，但暂不大规模删字段；
7. ProductUsage/ProviderCost 双账本继续存在。

下一票据不应做：

- 选择首发供应商；
- 设计覆盖所有未来供应商的参数 DSL；
- 以 OpenAI-compatible 作为能力继承机制；
- 把所有供应商都实现后才验证契约；
- 用 recorded adapter 代替一个真实同步适配器和一个真实异步适配器的合同验证。

最小可证伪验证应选“一个同步 LLM/图片路径 + 一个异步视频路径”，重点验证接单不确定性、恢复、取消差异、成本证据和资产托管，而不是比较模型效果或决定供应商。

## 13. 最终结论

当前代码已经有一条比普通“统一 AI SDK”更可靠的骨架：接单三态、RouteSnapshot、receipt、ProviderAttempt、双账本和 OwnedAsset。真正的问题不是缺少更多 provider enum，而是能力表达与运行证据还不够精确。

最优收敛方向是：

`产品生成意图 -> 能力校验 -> 冻结路由 -> 同步或异步适配器 -> 原生尝试证据 -> 托管资产/文本 -> 双账本对账`

供应商差异留在 adapter 和 capability snapshot；产品层只拥有稳定的生成语义、任务状态、托管资产和权益结果。这样既能支持首发所需的少数供应商，也不会为了假想的“全供应商统一”把当前系统做成难以验证的巨型框架。
