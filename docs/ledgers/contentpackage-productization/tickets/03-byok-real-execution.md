# 票 03 · BYOK 接真实执行通路
> 建设面: D10 诚实标注/真接 ｜ 决策: DEC-BYOK-REAL ｜ Blocked-by: 无（可立即启动）

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "03",
  "decisionIds": [
    "DEC-BYOK-REAL"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-HARDCODED-ADAPTER"
  ],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/evidence/contentpackage/ticket-03/README.md",
    "docs/evidence/contentpackage/ticket-03/evidence.json",
    "docs/evidence/contentpackage/ticket-03/continuous-byok-live-journey.webm",
    "docs/evidence/contentpackage/ticket-03/01-admin-byok-live-restart-pending.png",
    "docs/evidence/contentpackage/ticket-03/02-admin-byok-live-effective.png",
    "docs/evidence/contentpackage/ticket-03/03-merchant-write-only-live-connection.png",
    "docs/evidence/contentpackage/ticket-03/05-merchant-real-chinese-output.png",
    "docs/evidence/contentpackage/ticket-03/06-invalid-key-refunded-needs-attention.png",
    "docs/evidence/contentpackage/ticket-03/manifest.json"
  ],
  "resolution": "completed",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US20 / D10（已拍板未落地）**：规格拍板"BYOK 不绑平台审核，现在接真实执行通路"，但生产装配 `apps/core/src/main.ts:326` 仍是 `byok: new RecordedByokExecutionAdapter()`——硬编码桩，无任何 env 分支或 live 装配（原锚点已实测未漂移）。同文件里 LLM 主链路（`:137-145` `modelRuntimeAssemblyFromEnv` + fixture/live 分支）、secret store（`:323` recorded/aws）、飞书 MCP（`:324` recorded/remote）都有装配开关，BYOK 是唯一 new 死的执行 adapter。
- **桩的行为是假执行**：`apps/core/src/p1/integrations/byok.ts:18-30` 的 `execute()` 收到商户 credential 后直接丢弃（只记录 endpoint/catalogModelId/prompt），返回 `recorded:${catalogModelId}` 假字符串。商户在 `/settings/models` 的 BYOK 面板提交 prompt 后，`mkfast-template-main/src/p1/entitlement-byok-panels.tsx:304-306` 会把 `recorded:llm-domestic` 这类假输出当作"生成结果"原样展示。
- **账单口径在说谎**：桩执行照样走真实台账——copy 额度被 committed、结果标 `externally_billed`、面板显示"模型供应商费用由工作区 Key 对应账户另行结算"（`apps/core/src/p1/integrations/application-service.ts:1247-1248`），但供应商侧根本没发生调用，何来外部账单。这正是诊断病根"recorded 完备性冒充可用"在 BYOK 通路的具体表现，与 D10 拍板的诚实标注原则直接冲突。
- **链路其余环节全部完好**：幂等/回放、BYOK 连接门禁、受控 endpoint profile 白名单、secrets 取明文、strict 台账 prepare/settle、审计、前端表单与结果面板都已就位（见下节实核）。断点只有执行 adapter 这一环——本票是把最后一环从桩换成真实调用的垂直切片，不是重建链路。
- **票界**：只动 BYOK 执行通路。抖音 `RecordedDouyinAdapter`（`main.ts:334`）按 D10 保持"未接入（硬编码 recorded）"诚实标注，本票不碰；BYOK 输出是面板内文本结果，不写 ContentPackage / 内容库，不触及 ADR-0011 成品事实收敛；Admin Control Plane 的"adapter 装配点选"（US24/E7）不在本票，本票用与既有 recorded/aws、recorded/remote 同款的 env 装配起步。

## 现状代码入口（实核 file:line）

- `apps/core/src/main.ts:326`：`byok: new RecordedByokExecutionAdapter()` 硬编码装配点，本票的替换目标。`:38` 对应 import；`:335-346` 唯一受控 endpoint profile `openai-compatible-default`（endpoint 读 `BYOK_OPENAI_COMPATIBLE_ENDPOINT` 默认 `https://api.openai.com/v1`，permittedModels = catalog 全部 llm 模型 id）。原锚点未漂移。
- `apps/core/src/p1/integrations/byok.ts:6-31`：`RecordedByokExecutionAdapter` 全文——记录请求、可预置失败、返回 `recorded:*` 假输出。保留它作测试 fake，生产装配移除。
- `apps/core/src/p1/integrations/contracts.ts:150-164`：`StrictByokExecutionRequest`（endpoint/catalogModelId/prompt/credential）与 `StrictByokExecutionPort` 三态合同（completed | unauthorized | failed）。**Port 合同不动**。`:142-148` `ControlledEndpointProfile`；`:174-182` RouteSnapshot 固化 `credentialMode: 'byok_strict'`、`fallbackConsent: false`。
- `apps/core/src/p1/integrations/application-service.ts:1095-1226`：`submitStrictByok` 命令全链——`:1120` 校验 byok+model 连接；`:1127-1136` endpoint profile 门禁（`ENDPOINT_PROFILE_DENIED`）；`:1144-1152` `secrets.use` 取商户 key 明文；`:1167-1172` 调 `byok.execute`；`:1173-1174` 异常兜底归 failed；`:1186-1197` 结果映射连接状态（completed→available / failed→permission_missing / unknown→degraded）与凭据状态；`:1203-1218` 审计。`:1228-1250` `getStrictByokOptions` 查询（profiles + usage + billingNotice），本票在此回传执行模式。
- `apps/core/src/p1/integrations/foundation-byok-ledger.ts:134-196`：settle 三态语义——unauthorized→public `failed`（额度 refunded、rejected_before_accept）；failed→public `unknown`（额度 reserved、acceptance_unknown）；`:75` `policyRevision: 'byok-strict-no-fallback-v1'`。真实 adapter 的错误分类必须对齐这套已固化语义。
- `apps/core/src/p1/integrations/foundation-module.ts:326-330,472-473`：`submit_strict_byok` / `strict_byok_options` 的 P1 dispatch；`apps/core/src/p1/foundation/application-service.ts:53` 权限白名单 `integrations:submit_strict_byok`。HTTP 暴露已通，无需新路由。
- `apps/core/src/p1/integrations/runtime-from-env.ts:11-31,33-74`：`integrationSecretStoreFromEnv`（recorded/aws）与 `feishuMcpAdapterFromEnv`（recorded/remote）的既有 env 装配范式，BYOK 装配函数照此形态新增。
- `apps/core/src/p1/model-supply/ai-sdk-runner.ts:334-360`：`createNativeLanguageModel` 已用官方 `@ai-sdk/*` 落三原生分发；`:26-41` options 支持注入 `fetch`（测试口）。真实 BYOK adapter 复用该 provider 工厂模式，不裸写 fetch。
- `apps/core/src/p1/model-supply/catalog.ts:218-221`：catalog llm 模型的 `stableModelName` 全是 `recorded-openai-copy` 等假名——**catalogModelId 不能直接当供应商模型名发出去**，真实 adapter 必须注入 catalogModelId→供应商模型名的 bindings（平台 direct 通路用 `MODEL_DIRECT_MODEL` env 解决同一问题，见 `runtime-config.ts:444`）。
- `apps/core/src/p1/integrations/integration.test.ts:1014-1112`：现有 strict BYOK 合同测试（打 Application Service 外部行为）：幂等回放不重复执行、`fallbackConsent: false`、routeSnapshot 无 secret、unauthorized→refunded+permission_missing。形态保留，继续用 Recorded fake。
- 前端：`mkfast-template-main/src/routes/settings/models.tsx:70` → `ModelByokSettings`（`integration-settings.tsx:2166`）→ `StrictByokExecutionPanel`（`integration-settings.tsx:1825` 挂载；面板本体 `entitlement-byok-panels.tsx:50-313`，`:89-98` 发 `submit_strict_byok`，`:28-41` options 类型，`:43-48` 结果类型）。表单、额度提示、结果渲染全部已在，本票前端只加执行模式的诚实标注。

## 改造方案（步骤级）

1. **契约层（seam 查询小扩展，Port 不动）**：`getStrictByokOptions`（`application-service.ts:1228-1250`）返回值增加 `executionMode: 'recorded' | 'live'`，来源是装配注入的 `dependencies.byokExecutionMode`（缺省 recorded）。`StrictByokExecutionPort` 三态合同与 `SubmitStrictByokInput` 均不变——不新增 seam，不改命令合同。
2. **真实执行 adapter（Ports/Adapters 外围）**：在 `apps/core/src/p1/integrations/byok.ts` 新增 `LiveByokExecutionAdapter implements StrictByokExecutionPort`。构造参数：`modelBindings: Record<string, string>`（catalogModelId→供应商模型名）、`timeoutMs`（默认 60s）、可注入 `fetch`（测试口，对齐 `ai-sdk-runner.ts:34` 模式）。`execute()` 内**按请求的 `request.credential` 现场构造** `createOpenAICompatible`（官方 `@ai-sdk/openai-compatible`，仓内已装）+ `generateText({ maxRetries: 0, abortSignal: AbortSignal.timeout(...) })`——构造器不收任何平台 key，adapter 内物理上不存在可回落的平台凭据，"strict 不回落"从测试断言升级为结构保证。v1 只支持 openai-compatible 家族（覆盖中转站与国产厂商主流），anthropic/gemini 原生家族留给自定义模式/E7，不在本票展开。
3. **错误分类对齐 settle 已固化语义**：HTTP 401/403（`APICallError.statusCode`）→ `unauthorized`（供应商确定性拒绝：额度 refunded、连接→需处理、凭据→未验证）；其余一切（网络、超时、5xx、4xx 配置错）→ `failed`（结果不明：额度 reserved 保守挂起）。不扩 Port 三态，不改 `foundation-byok-ledger.ts` 台账语义。错误路径不得把 credential 或 authorization header 带进日志与返回值。
4. **装配函数 + 替换硬编码**：在 `runtime-from-env.ts` 新增 `byokExecutionRuntimeFromEnv(env)`，返回 `{ adapter, mode }`：`BYOK_EXECUTION_MODE` 缺省 `recorded`（返回 RecordedByokExecutionAdapter，本地/CI 不炸）；`live` 时解析 `BYOK_MODEL_BINDINGS`（形如 `llm-domestic=deepseek-chat,llm-openai=gpt-4o-mini`），缺失或为空 fail-fast。`main.ts:326` 改为消费该函数；`main.ts:342-344` 的 permittedModels 在 live 模式收缩为有 binding 的子集，避免商户选中无法执行的模型。这是与 `:323-324` 完全同款的既有装配范式，不是新框架。
5. **前端诚实标注（不冒充）**：`entitlement-byok-panels.tsx` 的 `StrictByokOptions` 增加 `executionMode`；`recorded` 时面板顶部 Alert 明示"演示执行——当前环境未接真实模型调用，结果为录制样例"（新增 i18n key，措辞对齐 D10 抖音标注口径）；`live` 时不显示该标注，真实输出经既有 `:304-306` 渲染自然流入。结果区、额度提示、表单均不动。
6. **测试（打外部行为 + adapter 合同）**：
   - 现有 `integration.test.ts:1014-1112` seam 合同原样保留（继续用 Recorded fake，seam 行为无变化即测试无改动——这是本票"不新增 seam"的直接验证）。
   - 新增 `LiveByokExecutionAdapter` 合同测试（注入 fetch mock）：请求打到受控 endpoint、`authorization` 头恰为 `Bearer <request.credential>` 且不含任何 env 值、model 字段为 bindings 映射名、`maxRetries: 0` 单次 side effect、401/403→unauthorized、500/网络异常/超时→failed、成功→completed 且 output 非空、错误对象不含 credential。
   - `runtime-from-env` 测试：缺省 recorded；live 缺 bindings fail-fast；live 下 permittedModels 收缩。
   - 显式隔离的 live 探针（默认不进 CI，对齐 `live-llm-provider.integration.test.ts` 形态）：`BYOK_LIVE_TEST=1` 时用 `docs/_private/tuzi.env` 凭据真实调用一次，断言 completed + 非 recorded 前缀输出。
7. **真实留证（D01 口径）**：live 装配环境用商户账号走一遍 `/settings/models` BYOK 面板：真实 key 提交→真实输出截图、审计记录（`byok.completed` + correlationId）、额度 committed 前后对比，证据落 `docs/reviews/` 留档。BYOK 通路的"真实跑通"以此为准，recorded 全绿不算。

## DoD（全部必须是用户可见行为）

- 商户在 `/settings/models` 的"自带 Key 执行"面板选择自己的 BYOK 连接、受控 endpoint 与模型，提交一段中文美业需求后，看到**真实模型生成的中文内容**。**对照证据（当前 vs 改造后）**：当前提交后结果区显示 `recorded:llm-domestic` 假字符串（`entitlement-byok-panels.tsx:304-306` 渲染 `byok.ts:29` 的桩输出）；改造后同一操作显示真实模型输出，且审计里该次执行的 correlationId 可查到 `byok.completed`。
- 商户用无效或已撤销的 key 提交时，面板明确显示执行失败、copy 额度已退还，该 BYOK 连接进入**需处理**（permission_missing）、凭据显示未验证——不出现假成功，不静默扣额度。
- 商户用有效 key 成功执行后，连接保持**可使用**，凭据"最近使用时间"随本次真实调用更新；同一幂等键重复提交只回放同一结果，不产生第二次供应商调用与第二次扣费。
- 商户的 BYOK 调用**始终只用自己的 key**：执行失败不回落平台 key、不静默换模型；结果面板的"供应商费用由工作区 Key 账户另行结算"从本票起对应真实发生的外部调用，不再是桩执行下的空话。
- 在仍为 recorded 装配的环境（本地/演示），面板顶部明示"演示执行——未接真实模型调用"，商户不会把录制样例误认为真实生成（对齐 D10 诚实标注口径）。
- 平台管理员在审计投影中能看到本次执行的 endpointProfileId、catalogModelId、额度状态与凭据版本，可复查每一次 BYOK 真实调用。
- 关票前置：至少一次真实 key 端到端执行留证（截图 + 审计记录 + 额度台账对比）。仅 adapter 单测绿、fetch mock 合同绿、curl 出流量，一律不得关票。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置。BYOK 无 pilot 触发点依赖（D10 明确"现在接真实"）；不依赖 E1 ContentPackage 合同冻结（本票在 integrations 模块，不触成品事实）；不依赖 E7 配置持久层（env 装配起步，与既有 secret-store/feishu 装配同款）。真实调用凭据已备（`docs/_private/tuzi.env`，LLM 探针已实测通过）。
- **Blocks**：解阻 E7 Admin Control Plane 的"BYOK adapter 装配点选"票（US24——先有 live adapter，后台点选 recorded/live 才有真实对象可切）；为规格 US20 直接闭环；并为"三家原生模板 + 自定义模式"（US18/19）提供 BYOK 侧的家族扩展点。本票完成不改变北极星口径：真实跑通链路数的主链路（档案→文案→图/片→入库→三平台）仍由 E3/E6 票承载，本票是侧翼通路的真实化，不冒充主链路 0→1。

## 风险与回退

- **模型 bindings 配错**：供应商返回 400（如 model_not_found）归入 failed→额度 reserved 挂起而非退还，商户看到"需处理"但根因在平台配置。控制：装配 fail-fast + live 探针冒烟先行；风险留言给运营——reserved 堆积时优先核对 `BYOK_MODEL_BINDINGS`。不为此扩 Port 三态（保守挂起与 P1 Attempt acceptance_unknown 语义一致），语义细分留给 E7 配置中心。
- **credential 泄漏**：真实 key 现在会出 adapter 边界。控制：adapter 不 log 请求头；错误分类只消费 statusCode，错误对象在返回前剥离；测试显式断言错误路径与 routeSnapshot 均不含 credential（后者已有断言 `integration.test.ts:1085`）。
- **超时与重复计费**：慢供应商可能拖死请求或诱发盲重试。控制：`AbortSignal.timeout` + `maxRetries: 0`，超时归 failed（reserved，不自动重投）；恢复动作只能由商户显式再次提交（新幂等键），已有幂等回放保证旧键不二次执行。
- **默认 recorded 造成"接了真实但环境没开"**：`BYOK_EXECUTION_MODE` 缺省 recorded 是为本地/CI 安全，代价是生产忘配则商户仍在演示模式。控制：前端诚实标注让该状态可见不可冒充；DoD 的真实留证强制至少一个环境开 live 并跑通。
- **回退**：出问题把 `BYOK_EXECUTION_MODE` 改回 `recorded` 即回到当前行为——Port 合同、seam 命令、前端表单全程未变，回退无迁移成本；已产生的真实执行审计与台账记录保留，不回滚事实。
- **范围失守**：不把 BYOK 输出接进 ContentPackage / 内容库（ADR-0011 成品事实源不受本票影响）；不动抖音 recorded 桩；不提前造可视化配置面或配置表（E7 硬前置是配置持久层，本票不越界）。
