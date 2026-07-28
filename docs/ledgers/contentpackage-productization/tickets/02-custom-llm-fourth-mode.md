# 票 02 · 自定义模式作为第四 LLM 备选
> 建设面: 模型供应模板 ｜ 决策: DEC-NATIVE-TEMPLATES ｜ Blocked-by: 无（可立即启动）

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "02",
  "decisionIds": [
    "DEC-NATIVE-TEMPLATES"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/evidence/contentpackage/ticket-02/README.md",
    "docs/evidence/contentpackage/ticket-02/evidence.json",
    "docs/evidence/contentpackage/ticket-02/continuous-custom-provider-journey.webm",
    "docs/evidence/contentpackage/ticket-02/01-custom-live-verified-admin.png",
    "docs/evidence/contentpackage/ticket-02/02-custom-catalog-published.png",
    "docs/evidence/contentpackage/ticket-02/03-custom-fixed-before-submit.png",
    "docs/evidence/contentpackage/ticket-02/04-custom-real-three-candidates.png",
    "docs/evidence/contentpackage/ticket-02/manifest.json"
  ],
  "resolution": "completed",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **第四备选缺席（confirmed）**：规格拍板"三家兼容 LLM 供应商以各自原生格式为固定模板，外加一个自定义模式作为第四备选；中转站在原生模板之上手动适配"（`docs/specs/contentpackage-productization-spec.md:39`，User Story 19 `:81`，接口口径 `:163`）。但 runner 的家族枚举今天只有三个原生值：`apps/core/src/p1/model-supply/ai-sdk-runner.ts:24` `LlmApiFamily = 'openai' | 'anthropic' | 'gemini'`，`createNativeLanguageModel` 的 switch（`:334-360`）没有 custom 分支——模板之外的供应商在类型层就不存在。
- **装配入口硬性拒绝（confirmed）**：`apps/core/src/p1/model-supply/runtime-config.ts:413` `nativeFamilies = ['openai', 'anthropic', 'gemini'] as const`；`:417-426` 对不在此列的目录模型直接抛 `MODEL_DIRECT_CATALOG_MODEL_ID must name an LLM catalog model in a native API family (openai, anthropic, or gemini) that supports copy.generate.`。平台管理员今天把直连指向任何模板外供应商，进程启动即崩，没有可配置的出口。
- **目录无第四位（confirmed）**：`catalog.ts:218-221` 四个 LLM 目录模型全部落在三原生家族（`llm-domestic` 也被硬编码为 `apiFamily: 'openai'`，`catalog.ts:362`），部署类型 `apps/core/src/p1/model-supply/index.ts:43` 的 `apiFamily` 联合类型同样没有 `custom`——目录层不存在"自定义供应商"这个可选项。
- **管理面前端会当场拒收（confirmed）**：`mkfast-template-main/src/p1/admin-view-model.ts:298,311` 两处 `z.enum(['openai','anthropic','gemini','image','media'])` 是 strictObject 硬校验。即使 core 侧发布了含 custom 部署的目录修订，管理模式模型目录页的查询 parse（`normalizeAdminCatalogControl`，`:387-389`）与 JSON 草稿提交（`parseAdminCatalogDraft`，`:395-407`）都会抛错——平台管理员在后台既看不到也提交不了第四模式。
- **票界**：本票只做 LLM 模板线的第四备选（Native LLM Templates 模块，spec `:124`），不碰媒体线（中转站媒体适配是票 10 的 TuziMediaAdapter）、不建配置持久层（票 05）、不做可视化切换面（票 18）。本票也不新增任何内容事实源——自定义模式是 provider 供应配置，ContentPackage 唯一成品事实源（ADR-0011）不受影响。BYOK endpoint profile 的 `apiFamily: 'openai-compatible'`（`apps/core/src/main.ts:337`）是票 03 的另一条线、另一个字符串枚举，本票不合并不改动。

## 现状代码入口（实核 file:line）

以下全部于 2026-07-15 对照真实代码复核；提示锚点两处均未漂移。

- `apps/core/src/p1/model-supply/ai-sdk-runner.ts:24`：`LlmApiFamily` 三值联合。`:26-41` `OpenAiCompatibleAiSdkOptions`（`apiFamily?` 在 `:40`，默认 openai）；`:70-78` 构造器把 options 交给 `createNativeLanguageModel`（`:77`）；`:334-360` 家族分发——anthropic→`createAnthropic`（`:338-343`）、gemini→`createGoogleGenerativeAI`（`:344-349`）、default→`createOpenAICompatible(...).chatModel`（`:350-358`，provider name `meiye-direct`）；`:362-376` `assertOptions` 只校验四个必填串与单价。提示锚点未漂移。
- `apps/core/src/p1/model-supply/runtime-config.ts:404-450`：`directOptions` 从 env 解析直连配置；`:413` `nativeFamilies` 列表、`:414-416` 从默认部署反查 `apiFamily`、`:417-426` 非原生家族抛错。提示锚点未漂移。`:259-275` `directModelConfigurationRevision` 哈希只含 baseUrl/model/credentialVersion/endpointRevision（不含 apiFamily，属既有缺口，本票只在 custom 分支补形态入哈希，不重造三原生公式）；`:98-100` fixture 模式激活全部 documented 部署。
- `apps/core/src/p1/model-supply/adapters.ts:144-206`：`DirectLlmRecordedAdapter` 抽象类（`:148` 的 `apiFamily` 类型同样只有三原生值）与三个 recorded 适配器（`:193-206`）；`:1314` `defaultRecordedAdapters()` 注册表——注意 `llm-domestic` 有部署无 recorded 适配器是既有缺口，fixture 下选中会抛 `No recorded adapter`，本票不修它但不得复制该缺口。`:215-220` `OpenAiCompatibleLlmExecutionPort` 内嵌同一 runner，家族分发一处生效、生产执行与流式两条路共用。
- `apps/core/src/p1/model-supply/catalog.ts:218-221`（LLM 目录模型）、`:234`/`:253`（provider profile / 执行通道默认表）、`:303/:314/:335`（capability/price/route 修订按目录模型派生，新模型自动覆盖，price 无命中时回退 0.02）、`:346-370` `createDefaultDeployments` 定义表。
- `apps/core/src/p1/model-supply/index.ts:43`：`ModelDeployment.apiFamily` 联合类型；`:2172` RouteSnapshot 冻结 `apiFamily`；`:2206-2220` `supportsRuntimeDeployment` 逐字段比对 runtime capability（含 apiFamily），类型放宽后审计链自动携带 custom。`:1387` `executeCopyQualityProbe` 是真实探针的 seam 入口。
- `apps/core/src/p1/model-supply/foundation-module.ts:1529-1544`：目录修订发布时校验部署与 ExecutionChannel 的 `apiFamily` 等不可变事实一致（`:1535`）——core 侧对 apiFamily 无值域白名单，新增 custom 只需目录事实自洽；真正的拒收在前端 zod。
- `apps/core/src/main.ts:139-145`：`modelRuntimeAssemblyFromEnv` 唯一装配点，`live_verified + direct` 时用 `modelRuntime.direct` 构造 `OpenAiCompatibleAiSdkRunner`——custom 选项随 direct 配置对象自动流入，无需第二装配路径。
- `mkfast-template-main/src/p1/admin-view-model.ts:296-311`：两处 apiFamily 枚举；`mkfast-template-main/src/p1/admin-model-control.tsx:431`（目录查询）、`:1697`（Deployment 计数徽章）、`:1680-1730`（目录 JSON 草稿表单）是管理员可见面。
- 测试基线：`ai-sdk-runner.test.ts:484-523` 已有 anthropic→`/v1/messages`、gemini→`generateContent` 两条家族路由断言（规格 `:245` 点名复用该形态）；`runtime-config.test.ts:252-259` 断言 llm-anthropic 被接受、`:279-291` 断言非原生家族抛 `/native API family/`；`live-llm-provider.integration.test.ts:9-27` 的 env 门禁 + `:29` 起的真实探针测试是 D01 留证载体（中转站凭据在 `docs/_private/tuzi.env`，规格 `:263` 确认 LLM 探针已实测通过）。

## 改造方案（步骤级）

垂直切片顺序：契约 → runner 分发 → Application Service 装配 → 目录 → 管理面前端 → 测试 → 真实留证。每层都被最高 seam（Product Core Application Service）外部行为覆盖，不新增 seam。

1. **契约与类型先行**：`ai-sdk-runner.ts:24` `LlmApiFamily` 增 `'custom'`；`OpenAiCompatibleAiSdkOptions` 增 `customProtocol?: 'openai_chat' | 'anthropic_messages' | 'gemini_generate_content'`——"请求/响应形态"取值限定为三种已实现线型，不做自由模板映射引擎。`index.ts:43` 与 `adapters.ts:148` 的 apiFamily 联合类型同步加 `'custom'`。
2. **runner 家族分发**：`createNativeLanguageModel`（`ai-sdk-runner.ts:334-360`）增 `case 'custom'`：按 `customProtocol` 三选一复用现有 provider 构造器（openai_chat→`createOpenAICompatible`，provider name 用 `meiye-custom` 与原生 openai 区分审计；anthropic_messages→`createAnthropic`；gemini_generate_content→`createGoogleGenerativeAI`），base URL 全部取管理员配置值。`assertOptions`（`:362-376`）增双向校验：`apiFamily === 'custom'` 时 `customProtocol` 必填；原生家族携带 `customProtocol` 直接抛错，不静默忽略。生产执行（`OpenAiCompatibleLlmExecutionPort`）与流式两条路经同一 runner 自动获得第四模式。
3. **Application Service 装配命令入口**：`runtime-config.ts` `directOptions`（`:404-450`）把可接受家族从 `nativeFamilies` 扩为"三原生 + custom"；家族为 custom 时解析新 env `MODEL_DIRECT_CUSTOM_PROTOCOL`（必填、三值枚举），原生家族配置了该变量则抛错；`:417-426` 错误文案更新为四选项口径。`directModelConfigurationRevision`（`:259-275`）在 custom 分支把 `apiFamily + customProtocol` 纳入哈希——换形态即换配置修订，旧激活证据失效必须重新探针；三原生哈希公式不动，既有 tuzi 证据不作废。
4. **目录可选自定义**：`catalog.ts` 增一组自洽目录事实——目录模型 `llm-custom`（displayName「自定义供应商」，modality llm，operations `['copy.generate']`，qualityRank 低于全部原生模型，确保 auto 质量路由永不静默选中，只能显式固定选择）、`provider-custom` profile、`channel-custom-llm-direct` 执行通道（apiFamily `custom`）、`custom-llm-direct-recorded` 部署；capability/price/route 修订由 `:303/:314/:335` 派生函数自动覆盖。`adapters.ts` 增 `CustomDirectRecordedAdapter`（照 `:193-206` 形态）并注册进 `defaultRecordedAdapters()`（`:1314`），避免 fixture/recorded 模式下选中 llm-custom 触发 `No recorded adapter` 崩溃（不复制 llm-domestic 的既有缺口）。
5. **管理面前端契约**：`admin-view-model.ts:298,311` 两处 `z.enum` 增 `'custom'`，使目录查询 parse 与 JSON 草稿提交都接受第四模式；管理模式→模型目录页（`admin-model-control.tsx`）随目录数据自动显示第四部署，本票不新增页面组件。
6. **测试（打 seam 外部行为 + 家族路由）**：`ai-sdk-runner.test.ts` 照 `:484-523` 形态补——custom+openai_chat 命中 `<baseUrl>/chat/completions`、custom+anthropic_messages 命中 `/messages`、custom 缺 protocol 与原生带 protocol 各自抛错；`runtime-config.test.ts` 补——`MODEL_DIRECT_CATALOG_MODEL_ID=llm-custom` + `MODEL_DIRECT_CUSTOM_PROTOCOL` 被接受、缺 protocol 拒绝、`gpt-image-2` 继续被拒、配置修订随 protocol 变化；`model-supply.test.ts` 在 Application Service 上断言 fixed selection llm-custom 完成 copy.generate 且 RouteSnapshot 冻结 `apiFamily: 'custom'`（`index.ts:2172`）与用量/成本完整；`admin-view-model.test.ts` 断言含 custom 部署的目录 payload parse 通过。测试是工程护栏，不作为 DoD。
7. **真实留证（D01）**：用 `docs/_private/tuzi.env` 的真实中转站凭据，以 `MODEL_DIRECT_CATALOG_MODEL_ID=llm-custom` + `MODEL_DIRECT_CUSTOM_PROTOCOL=openai_chat` 跑 `live-llm-provider.integration.test.ts` 真实探针（`RUN_LIVE_MODEL_PROVIDER_TEST=1`，显式隔离、不进普通 CI），并以同配置本地起服在真实 `/dashboard` 工作台生成一次文案；证据（探针输出的模型名/用量/成本 + 录屏/截图）落 `docs/evidence/contentpackage/`。

涉及文件：`apps/core/src/p1/model-supply/ai-sdk-runner.ts`、`runtime-config.ts`、`adapters.ts`、`catalog.ts`、`index.ts`（类型联合）、`ai-sdk-runner.test.ts`、`runtime-config.test.ts`、`model-supply.test.ts`、`live-llm-provider.integration.test.ts`（跑通即可，尽量零改动）、`mkfast-template-main/src/p1/admin-view-model.ts`、`mkfast-template-main/src/p1/admin-view-model.test.ts`。

## DoD（全部必须是用户可见行为）

- 平台管理员把直连配置指向自定义供应商（llm-custom + 自定义 base URL + 请求/响应形态）后，服务正常启动，真实探针经该中转站返回 3 条实质不同候选并留证。**对照证据（当前 vs 改造后）**：当前同样意图的配置在进程启动即抛 `MODEL_DIRECT_CATALOG_MODEL_ID must name an LLM catalog model in a native API family (openai, anthropic, or gemini)...`（`runtime-config.ts:423-425` 实测文案），管理员没有任何第四选项；改造后启动成功 + 探针留证，两份终端记录并排存档。
- 平台管理员在管理模式→模型目录页看到第四个 LLM 部署「自定义供应商」及其 API 家族、激活状态，且含 custom 部署的目录 JSON 草稿校验通过、可走发布流。**对照证据**：当前该页在 core 返回 custom 部署时因 `admin-view-model.ts:298,311` 枚举 parse 抛错（页面报错截图），改造后正常渲染（截图并排）。
- 自定义部署在真实探针通过前保持未激活，商户不可提交到它——诚实呈现，不以"只差一个 Key"表述冒充可用（与 D10 同一口径）。
- 探针通过激活后，商户在创作工作台生成文案时看到的执行模型即该自定义供应商的显示名，全程固定不变：无跨品牌 Auto、无静默回退，逐字流式与 3 选 1 单选采用（D4）行为与三原生模板完全一致；成品照常落库，成品状态照常呈现创作中/可使用/需处理。以 tuzi.env 起服的真实 `/dashboard` 录屏留证。
- **DoD-5（治理修订）**：~~平台管理员修改自定义模式的请求/响应形态后，旧激活证据立即失效：服务启动报配置修订不匹配、要求重新探针——形态变更不可能带着旧证据伪装已验证。~~
  - **新口径**：配置漂移 → 旧证据立即失效，运行时静默降级为 `configured_unverified`，fail-closed 且商户不可提交；服务启动同时产出 warning 日志，点名对应 deployment，并明确“configuration drift, activation evidence invalidated, re-probe required”，要求重新探针。
  - **治理批注 2026-07-17**：用户拍板，'启动报错'调整为'启动 warning + fail-closed 降级'，安全语义不变（无有效证据即不可执行），依据 2026-07-16 关票分析 batch-T1。
- 仅"runner 支持 custom / 类型编译通过 / 单测全绿"一律不得关票；上述证据齐备并落 `docs/evidence/contentpackage/` 才进入关票判断。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置（波次 0 独立快线）。但遵守 MAP 全局规则：**票 01（ContentPackage 聚合合同冻结）完成前，本票不得关票**（guard 强制）。
- **Blocks**：不阻塞任何票的实施。价值上为票 18（执行模式可视化切换）、票 19（凭据管理）提供第四模式的可点选项——届时自定义模式的 base URL/形态/凭据须迁入配置持久层与脱敏面，那是 05/18/19 的票界；票 22 的真实链路可在任一模板（含第四模式）上跑，本票为其多备一条供应商退路。

## 风险与回退

- **"万能兼容层"回潮**：custom 模式可能被滥用成把三原生也拉平的兼容层，违背"每家按官方原生格式固定模板"的拍板（spec `:39,80`）。控制：三原生目录模型禁止挂 custom 家族（`directOptions` 家族仍从目录部署反查，目录事实由 `foundation-module.ts:1529-1544` 一致性校验锁死）；llm-custom qualityRank 垫底 + 仅限固定选择，auto 路由永不静默选中。
- **形态枚举被要求扩成任意协议映射**：本票只支持三种已实现线型；出现第四种真实线型需求走 ADR，不在本票夹带自由 JSON 模板引擎。
- **配置漂移伪装已验证**：换 base URL/形态后旧证据若仍有效即重蹈"环境变量哈希伪装"病根。控制：custom 分支把 `apiFamily + customProtocol` 纳入配置修订哈希；三原生哈希公式不动（既有缺口——原生家族未入哈希——留给票 20 的真实探针激活机制统一重造，本票不扩大爆炸半径）。
- **fixture 崩溃面**：fixture 模式激活全部 documented 部署（`runtime-config.ts:98-100`），无 recorded 适配器的目录模型选中即崩。控制：`CustomDirectRecordedAdapter` 与目录事实同票落地；llm-domestic 的同类既有缺口只记录不顺手修。
- **自定义 base URL 的安全面**：任意 URL 意味着凭据外送与 SSRF 面扩大。控制：base URL 仍只能由平台管理员经服务端配置（现为 env，票 05/19 后进持久层与脱敏面），商户侧编辑 provider Key/Base URL 明确在规格 Out of Scope；错误信息与日志沿用现有脱敏口径，不回显 key。
- **回退**：把 `MODEL_DIRECT_CATALOG_MODEL_ID` 指回任一三原生目录模型即完整回退到今日行为；目录中的 llm-custom 部署无激活证据时保持 inactive，不影响既有路由、审计与结算链。回退不删除已留存的探针证据与审计记录。
