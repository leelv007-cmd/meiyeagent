# 个性化上下文、资源与 Prompt 实现审计

- 审计日期：2026-07-24
- 审计范围：当前工作区的 Composer 主链、旧 Product 创作链、公共合同、服务端、PostgreSQL 持久化、Harness 与 Model Supply Provider 调用
- 规划基线：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
- 代码根目录：`/Users/bin/Desktop/开发/内容无人区/美业内容2`
- 证据口径：只把当前生产代码、数据库迁移和直接约束测试视为实现证据；设计文档只用于比较目标，不把计划、注释或测试夹具冒充已接通的产品能力
- 外部检索：未使用。该票是本地实现审计，当前代码事实足以回答问题

## 1. 执行结论

当前项目已经拥有一套相当完整的个性化“结构骨架”，但尚未形成一条端到端闭合的“用户专属上下文 → 精确 Prompt → 三模态成品 → 反馈学习”主干。

已真实成立的部分：

1. `MarketingIdentity`、`StoreFact`、`ContextBundle`、`Recipe`、Brief revision、执行快照、Harness trace 和生成资产都有版本化结构或持久化。
2. 新 Composer 的文案、图片、视频都进入同一条 `Composer → CreationExecutionSnapshot → Harness → Model Supply` 主干。
3. 被选中的 `MarketingIdentity` 完整内容和 active `StoreFact` 会进入冻结 `ContextBundle`；整个 bundle 会进入 Brief 编译 Prompt。
4. 图片和视频的引用素材会被解析为 Provider 可读 URL，真实进入 Provider 请求并影响输出。
5. `ContextBundle`、身份、事实、Recipe、Brief 确认和 Provider attempt 都有可追溯 revision 或审计记录。

没有闭合的部分：

1. **门店双真相断链**：Store 页面确认的是 Product `StoreProfile`，Composer 也用它做“可提交”门禁；Harness 实际读取的却是独立的 `StoreFactLedger`。当前生产代码没有发现 `confirm_store → StoreFactLedger.append` 投影，因此“门店已确认”不等于门店名、项目、价格和 `brandVoice` 进入新主链 Prompt。
2. **Recipe 与运行 Prompt 断链**：Recipe 强制保存 `promptRevisionRef`，但执行快照不冻结它，Harness 也不按它解析 Prompt。实际运行只解析两个全局 Langfuse Prompt；Model Supply 另把 schema revision 记作 `promptRevision`，形成三套互不绑定的版本语义。
3. **媒体 Prompt 串模态**：Harness 只有 `harness/brief-copy` 这一条 Brief Prompt；图片和视频编译也显式传入它，覆盖各自硬编码的媒体 instructions。换言之，媒体输出 schema 是图片/视频，实际 system instruction 却是“专业文案 Brief”。
4. **偏好与反馈停在结构层**：Preference 的合同、数据库和“三次独立任务才提议”逻辑已存在，但确认后的状态固定为 `inactive_stage2`；普通 Composer 不携带 `reuseSeed`，结果页采用/修改也不产生 `PreferenceSignal`。
5. **历史作品复用未进入新 UI 主路**：服务端可以从 source `ContentPackage` 和显式 reuse seed 装配结构、风格、素材，但当前 Composer 提交只发送 `sources.assets`。
6. **身份选择与身份政策不完整**：UI 没有身份选择器，固定取 active identities 的第一个结果；服务端只验证 active/version，不做确定性校验 allowed platform、allowed scene、肖像和声音授权。
7. **媒体成品缺少 ContextBundle 血缘**：文案交付会把 `marketing.contextBundle` 写回 `ContentPackage`；图片/视频交付没有传 `marketing`，初始包也没有该字段，因此媒体成品不保留同等的 bundle 引用。
8. **个性化数据被按 public 路由**：Composer route、结构化 LLM 和媒体 submission 都写死 `dataClass: []`，路由再把它解释为 `public`。这与身份、PII、人物素材和医疗类事实可能进入 Prompt/Provider 的现实不一致。

因此，当前完成度应表述为：

> 已完成可追溯的上下文编译和三模态生成骨架；身份与媒体素材在主链中真实生效；门店事实、行业/服务绑定、历史复用、Recipe Prompt、偏好反馈和媒体血缘仍是部分实现或旁路实现。

## 2. 四层判定口径

本报告严格区分以下四层：

| 层级 | 判定条件 |
| --- | --- |
| S：有数据结构 | 有公共合同、服务端领域对象或数据库结构 |
| P：进入 Prompt | 当前生产路径把真实值或其可解释摘要放入模型输入，而不只是保存 ID |
| O：影响输出 | 值被生成模型直接读取，或被确定性路由、权利/政策门和交付合同使用 |
| R：记录供复用 | 下一任务能够通过正式产品入口自动或显式读取；只有日志、审计或未激活记录不算已生效复用 |

“进入 Prompt”不等于“模型一定遵守”；“有 revision head”也不等于对应业务内容已经进入 bundle。

## 3. 规划目标与当前实现对照

设计基线要求：

- 上下文优先级为本次指令、当前事实、门店/IP 资产、偏好、行业/平台配方、模型知识；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:248-250`。
- 最小 ContextBundle 应包含意图、门店事实、服务/Offer、表达身份、行业配方、素材、平台规则、历史经验和即时信号；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:465-469`。
- 采用、修改、拒绝、发布和复用应可回溯，并在满足条件后提议偏好或资产晋升；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:487-491`、`:514-520`。
- Recipe 应冻结来源策略、Workflow/Prompt/ModelPolicy/QuotePolicy revision 等血缘；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:1400-1411`。
- 条件 Brief 应绑定精确 draft/recipe/model/quote/source revisions；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:1585-1594`。

当前匹配度：

| 规划合同 | 当前状态 | 代码判断 |
| --- | --- | --- |
| 不可变 ContextBundle | **基本实现** | 六维 bundle、hash、revision、不可更新 trigger 和 recompile event 已有 |
| 当前事实、身份、素材进入 bundle | **部分实现** | MarketingIdentity 与 StoreFact 可进入；StoreProfile、Recipe 内容、Preference 内容没有自动汇入 |
| Recipe 冻结全套执行血缘 | **部分实现** | delivery/model/contentModules 生效；`promptRevisionRef`、完整 context patches、`requiredSourcePolicy` 未冻结到执行根 |
| 条件 Brief revision 绑定 | **基本实现** | trigger、context、confirmation 和漂移校验存在；它绑定的是 revision 摘要，不是最终 ExecutionBrief 文本 |
| 用户可换身份/素材/事实 | **部分实现** | 素材可选；身份固定取第一条；StoreProfile 与 StoreFact 无统一纠错路径 |
| 历史经验和偏好进入新任务 | **旁路/未激活** | source ContentPackage 和 reuse seed 有后端通道；普通 Composer UI 不提交，Preference 固定 inactive |
| 发布/导出后回收反馈并提议晋升 | **未接通** | 采用、编辑、审计和 PreferenceSignal 是平行对象，没有自动桥接 |
| 三模态成品保留 ContextBundle 血缘 | **不一致** | 文案写入，图片/视频未写入同等 `marketing.contextBundle` |

## 4. 对象级四层矩阵

| 对象/信息 | S | P | O | R | 当前真实状态 |
| --- | :---: | :---: | :---: | :---: | --- |
| 个人 `MarketingIdentity` | 是 | 是 | 是 | 部分 | 完整字段进入三模态 Brief；版本可重复读取，但 UI 不能选身份，授权字段无确定性门 |
| 品牌 `MarketingIdentity` | 是 | 是 | 是 | 部分 | `brandClaims/forbiddenClaims/visualPrinciples/seriesAnchors` 进入 bundle；无反馈学习 |
| Product `StoreProfile` | 是 | 旧链是；新链否 | 旧链是；新链仅门禁 | 旧链是 | 新 Composer 只据此判断“门店已确认”，不把值交给 Harness |
| `StoreFact` | 是 | 是 | 是 | 是 | 只要已单独写入、有效且 scope 匹配，就会进入每次 bundle；主 Store UI 没有自动桥接 |
| 行业/品类 | 部分 | 很弱 | 很弱 | 否 | 主要由 task type、Recipe 和模型知识隐式承担，没有用户专属行业事实绑定 |
| 服务项目/价格/Offer | 两套 | 条件式 | 条件式 | 条件式 | StoreProfile project 在旧链有效；新链必须另有 StoreFact，默认 scope 还可能漏掉 service/platform 事实 |
| Product 输入素材 | 是 | 文案仅 ID；媒体是 | 文案有限；媒体是 | 手动 | 图片/视频把真实 URL 发给 Provider；文案结构化节点不读取像素 |
| 历史 `ContentPackage` | 是 | 后端可 | 后端可 | 后端可 | 当前 Composer UI 不发送 `sources.contentPackage` |
| `ReuseTaskSeed` / AssetRevision | 是 | 非快照路径可 | 非快照路径可 | 是 | 普通 Composer execution snapshot 明确拒绝 request 自带 reuse seed |
| Preference | 是 | 否 | 否 | 仅保存 | 状态固定 `inactive_stage2`；测试明确证明不注入 ContextBundle |
| 禁忌/禁止表达 | 两套 | 条件式 | 条件式 | 部分 | 新链使用 MarketingIdentity `forbiddenClaims`；旧链使用 StoreProfile `prohibitions` |
| 用户采用/修改/拒绝 | 是 | 否 | 不影响后续任务 | 仅审计 | Result、Harness decision、ContentPackage audit、PreferenceSignal 互不连通 |
| Recipe | 是 | 部分 | 是 | 是 | delivery/model/contentModules 影响执行；Prompt ref、来源强策略和多数 context patches 不影响运行 |
| Brief | 三套 | 是 | 是 | 部分 | UI trigger Brief、旧 CreativeBrief、Harness ExecutionBrief 语义重复，内容和 revision 未统一 |
| Prompt revision | 三套 | 是 | 是 | 审计可查但不可精确回放 | Recipe ref、Langfuse frozen prompt、schema revision 没有统一 binding |
| Harness | 是 | 是 | 是 | trace 可复盘 | 五段运行时真实存在；个性化质量取决于上游是否把正确事实送入 bundle |

## 5. UI → 公共合同 → 服务端 → 数据库 → Provider 三模态追踪

### 5.1 共同入口与执行根

1. Composer 从 ProductState 判断门店、项目、资质和素材是否齐全：`mkfast-template-main/src/product/creative-brief-editor.tsx:57-83`，调用点在 `mkfast-template-main/src/product/composer/composer-home.tsx:245-255`。
2. UI 查询 MarketingIdentity，但提交时固定取 `identitiesQuery.data?.[0]`：`mkfast-template-main/src/product/composer/composer-home.tsx:780-809`、`:843-849`。
3. UI 提交 intent、Recipe、identity、quote、model、Brief refs 和资产；`sources` 只有 `{ assets }`：`mkfast-template-main/src/product/composer/composer-home.tsx:649-720`。
4. Web 与 Core 各自维护一份 transport schema，而不是共享公共合同：
   - Web：`mkfast-template-main/src/product/composer/composer-submission-client.ts:7-47`
   - Core：`apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:75-138`
5. Admission 重读 published Recipe/Surface、quote、route、identity、asset、rights 和 Brief confirmation：`apps/core/src/p1/execution-spine/composer-submission-gate.ts:129-242`、`:244-375`。
6. Snapshot 只冻结 Recipe ID/revision、identity ID/revision、sources、Brief refs、model、quote 和 route；没有 `promptRevisionRef`、Recipe 全量 body、StoreProfile 或 Preference：`apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:140-215`。
7. Work、Task、ContentPackage 壳和 usage reservation 在事务中写入；初始 ContentPackage 只含 execution snapshot 引用和 source refs：`apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:109-228`。
8. Harness 把 snapshot 转成 request 时强制空 `sourceSummaries`、默认 `factScope={storeId: workspaceId}`，不携带 reuse seed：`apps/core/src/p1/harness/task-admission.ts:139-183`。

### 5.2 文案路径

```text
Composer(copy)
→ CreationExecutionSnapshot
→ intent naming
→ ContextBundle freeze
→ copy ExecutionBrief
→ 3 个结构化候选
→ policy gate / scoring
→ ContentPackage review_ready
```

| 层 | 当前实现与证据 |
| --- | --- |
| UI | 文案 Lens 与其他 Lens 共用 Composer，提交 identity、assets、Recipe 和 intent；`composer-home.tsx:649-720` |
| 公共合同 | StoreProfile 在 `packages/contracts/src/product.ts:15-41`；MarketingIdentity 在 `packages/contracts/src/marketing-package.ts:150-203`；ContextBundle 在 `packages/contracts/src/context-bundle.ts:72-194` |
| 服务端 | 全量 ContextBundle 被序列化进 Brief Prompt：`apps/core/src/p1/harness/structured-nodes.ts:225-268` |
| 数据库 | 身份保存在 `p1_marketing_identity_versions`：`apps/core/src/p1/operations/marketing-identity.ts:166-187`；bundle 保存在不可变 `p1_context_bundle_revisions`：`apps/core/src/p1/operations/postgres-context-bundle-repository.ts:27-92`、`:172-249` |
| 生成调用 | 每个候选 Prompt 携带 `brief` 和完整 generation context：`apps/core/src/p1/harness/execution-selection.ts:103-147`；结构化 runner 调用 Model Supply `text.respond`：`apps/core/src/p1/model-supply/structured-node-runner.ts:108-135` |
| 结果复用 | 文案交付把 ContextBundle/事实/权利/身份 refs 投影到 `ContentPackage.marketing`：`apps/core/src/p1/harness/marketing-scene-policy.ts:17-76`、`apps/core/src/p1/harness/production-stage-ports.ts:453-516` |

文案的真实个性化：

- MarketingIdentity 全量值和 active StoreFacts 会进入 ContextBundle，再进入 Brief 和候选 Prompt。
- 输入素材只以 asset ID/context ref 出现在 bundle 和 Brief。`StructuredNodeRunnerRequest` 没有素材字段，Model Supply submission 也没有 `input.referenceAssetIds`：`apps/core/src/p1/model-supply/structured-node-runner.ts:17-28`、`:108-122`。因此当前文案模型不会读取所附图片像素。

### 5.3 图片路径

```text
Composer(image_text)
→ Snapshot(lens=image)
→ ContextBundle
→ LLM 编译 ImageBrief
→ image.generate
→ resolve reference assets
→ Provider prompt + image URLs
→ OwnedAsset
→ ContentPackage review_ready
```

| 层 | 当前实现与证据 |
| --- | --- |
| UI | 上传后写 Product Asset 并授权，冻结 asset ID/hash；`mkfast-template-main/src/product/composer/composer-home.tsx:490-587` |
| 公共合同 | Product Asset 含 owner、rights、用途、人脸、敏感信息和未成年人字段：`packages/contracts/src/product.ts:65-89` |
| 服务端 | ImageBrief 从完整 bundle 和 execution snapshot 编译：`apps/core/src/p1/harness/unified-media-stage-ports.ts:79-109` |
| 数据库 | Product Asset 属于 ProductState/relation facts；生成结果再写 Foundation/Model Supply owned asset 和 ContentPackage |
| 生成调用 | Brief 的 prompt、ratio、resolution 和 `referenceAssetIds` 进入 `image.generate`：`apps/core/src/p1/harness/unified-media-stage-ports.ts:244-288` |
| Provider | Model Supply 把 asset 解析为 Provider URL：`apps/core/src/p1/model-supply/media-generation-workflow.ts:845-949`；Ark 请求发送 prompt 与 image URL：`apps/core/src/p1/model-supply/ark-media-adapter.ts:669-757` |
| 结果复用 | 生成 asset 进入 ContentPackage `ownedAssets`：`apps/core/src/p1/harness/unified-media-stage-ports.ts:117-158`；不会自动成为 ReusableAssetCandidate |

因此，图片素材达到 S/P/O；R 只达到“成品和资产可再次手动引用”，没有自动资产晋升。

### 5.4 视频路径

```text
Composer(video) + 必须确认 Brief
→ Snapshot(lens=video)
→ ContextBundle
→ LLM 编译 storyboard / first frame
→ video.generate
→ Provider async task
→ poll / 下载 / OwnedAsset
→ ContentPackage review_ready
```

| 层 | 当前实现与证据 |
| --- | --- |
| UI | 视频总是要求 Brief 确认：`mkfast-template-main/src/product/composer/composer-home.tsx:910-946` |
| 公共合同 | Brief confirmation 绑定 draft/recipe/model/quote/source/surface/lens revisions：`packages/contracts/src/creation-experience.ts:362-374` |
| 服务端 | VideoBrief schema 包含 storyboard、首帧 prompt、reference assets、时长和比例：`apps/core/src/p1/harness/structured-nodes.ts:99-120` |
| 数据库 | Brief context/confirmation 分别保存于 `p1_creation_brief_revision_contexts` 和 `p1_creation_brief_confirmations`：`apps/core/src/p1/creation-experience/postgres-brief-revision-context.ts:184-294`、`apps/core/src/p1/creation-experience/postgres-audit-repository.ts:17-44`、`:86-126` |
| 生成调用 | Provider Prompt 由 first-frame prompt 与 storyboard 拼接：`apps/core/src/p1/harness/unified-media-stage-ports.ts:244-288` |
| Provider | Ark 请求发送文本和 image/video URL：`apps/core/src/p1/model-supply/ark-media-adapter.ts:760-840` |
| 结果复用 | 视频作为 owned asset 写入 ContentPackage；没有自动生成 series/reuse candidate |

视频素材同样达到 S/P/O，R 只到手动复用。

## 6. 个性化信息逐项审计

### 6.1 身份与品牌：当前最完整，但选择和授权门不完整

结构与持久化：

- MarketingIdentity 覆盖 owner、专业边界、平台、场景、表达样本、生效/过期和生命周期；品牌再含 claims、禁忌、视觉和系列锚点，人物再含真实身份、肖像/声音/历史内容授权：`packages/contracts/src/marketing-package.ts:150-203`。
- 每个版本写入 `p1_marketing_identity_versions`，并递增 context source identity head：`apps/core/src/p1/operations/marketing-identity.ts:166-187`、`:272-320`。

注入与影响：

- Snapshot 指定精确 identity ID/version；Context port 只加载该 active revision：`apps/core/src/p1/harness/production-context-port.ts:386-407`。
- 完整字段作为 `expression_identity` contribution 进入 bundle：`apps/core/src/p1/harness/production-context-port.ts:579-612`。
- Copy 会强制 ExecutionBrief 的 identity ref 与 snapshot 相同：`apps/core/src/p1/harness/production-stage-ports.ts:549-588`。

断点：

1. UI 固定取第一条 active identity，不呈现选择结果或冲突：`mkfast-template-main/src/product/composer/composer-home.tsx:780-809`。
2. UI 创建身份时把所有平台和所有场景硬编码为允许：`mkfast-template-main/src/product/marketing-identity-form.ts:155-180`。
3. Admission 只判断 active/version：`apps/core/src/p1/execution-spine/composer-submission-gate.ts:228-242`。
4. 生产代码中 `allowedPlatforms`、`allowedScenes`、`portraitAuthorization`、`voiceAuthorization` 和 `historicalContentPermission` 除了写入 ContextBundle，没有确定性执行门。模型可能遵守，也可能不遵守。
5. StoreProfile 的 `brandVoice/prohibitions` 和 MarketingIdentity 的品牌表达字段是两套并行来源，未定义跨实体冲突规则。

### 6.2 门店、项目与 Offer：旧链可用，新链断开

旧 Product 链：

- StoreProfile 包含门店名、地区、预约方式、brand voice、prohibitions、账号和项目：`packages/contracts/src/product.ts:23-41`。
- Store 页面通过 `confirm_store` 写入 Product aggregate，并硬编码两条 prohibitions：`mkfast-template-main/src/routes/dashboard/store.tsx:224-260`。
- Product service 把 confirmed store 写入 ProductState：`apps/core/src/product/product-service.ts:1949-1975`。
- relational repository 将 ProductState 投影到 `p1_relation_facts`：`apps/core/src/product/relational-product-repository.ts:24-65`、`:119-159`。
- 旧 Operations 生成路径会把门店、品牌语气、禁忌、项目、价格和授权素材写进 Prompt：`apps/core/src/p1/operations/model-supply-creation-adapter.ts:203-262`。

新 Composer/Harness 链：

- UI 仍以 ProductState 的 confirmed store/project/qualification 做准入：`mkfast-template-main/src/product/creative-brief-editor.tsx:57-83`。
- Harness 只读取 `StoreFactLedger.listActive`：`apps/core/src/p1/harness/production-context-port.ts:150-173`、`:250-260`。
- StoreFact 是独立合同和独立表：`packages/contracts/src/context-bundle.ts:7-70`；`apps/core/src/p1/operations/postgres-store-fact-ledger.ts:37-130`。
- 生产代码存在显式 `store_fact_append` 和 Asset Intake 确认通道：`apps/core/src/p1/operations/context-foundation-module.ts:105-119`、`apps/core/src/p1/operations/asset-intake-service.ts:664-790`。
- 但当前 Store UI 的 `confirm_store` 没有调用这些通道；全局生产代码检索未发现从 `confirm_store` 自动 append StoreFact 的桥。

范围问题：

- StoreFact 支持 `serviceId/personaId/platform`：`packages/contracts/src/context-bundle.ts:34-41`。
- snapshot path 强制只请求 `{storeId: workspaceId}`：`apps/core/src/p1/harness/task-admission.ts:162-182`。
- scope 匹配要求事实上的任何细分维度都与请求一致：`apps/core/src/p1/operations/store-fact-ledger.ts:62-72`。

所以，带 service/persona/platform 的事实会被默认 scope 漏掉；StoreProfile project 又没有自动进入 StoreFact。当前“项目/服务/Offer 个性化”不是主流程可靠能力。

### 6.3 行业与品类：结构化模板存在，用户专属行业上下文不足

当前可见的行业信息主要来自：

- Harness task type 和六维 ContextBundle 结构；
- published Recipe 的 lens/delivery/contentModules；
- StoreFact 的 service/price 等通用 kind；
- 模型通用知识。

没有发现新 Composer 将用户门店的行业/品类选择冻结进 execution snapshot，或把专属行业事实作为独立 contribution 注入。Recipe 的 `contextPatches` 只有 `contentModules` 被 server gate 读取：`apps/core/src/p1/execution-spine/composer-submission-gate.ts:425-527`；前端 apply 只处理 delivery/settings/model policy，不把 context patches 装入用户上下文：`mkfast-template-main/src/product/composer/recipe-apply.ts:204-281`。

这与规划中的“行业配方不能覆盖本店事实”仍有距离：当前首先缺的是行业配方内容真正进入运行 ContextBundle，而不是优先级冲突实现。

### 6.4 素材与 OwnedAsset：媒体生效，概念和权利模型分裂

当前至少存在四类相近对象：

1. Product `Asset`：真实输入素材，带 rights、consent、人脸/敏感信息；`packages/contracts/src/product.ts:65-89`。
2. Foundation `OwnedAsset`：绑定 job/attempt/object/hash 的生成回执；`apps/core/src/p1/foundation/domain.ts:345-356`，持久化在 `p1_owned_assets`：`apps/core/src/p1/foundation/postgres-repository.ts:218-237`。
3. Model Supply `OwnedAsset`：Provider 结果的 object/hash/contentType/技术证据；`apps/core/src/p1/model-supply/supply-contracts.ts:181-204`。
4. Canvas `CanvasOwnedAsset`：本地导入/派生/生成资产，并附 export policy；`apps/core/src/pro-studio/canvas-asset-facade.ts:48-93`，持久化在 `pro_studio_owned_assets`：`apps/core/src/pro-studio/postgres-pro-studio-migration.ts:80-102`。

可复用部分：

- Composite resolver 已能从 Product 与 Canvas 等来源解析 Provider 素材。
- Product resolver 会校验 authorization、consent、rights evidence、用途和过期：`apps/core/src/p1/model-supply/reference-asset-resolver.ts:278-348`。
- 图片/视频 Provider 路径会再次解析并验证引用完整性。

风险与断点：

1. Copy StructuredNode 不读取真实素材内容。
2. Admission 当前调用 `resolve`，不是只读 metadata 的 `inspect`，在准入阶段已经读取整份 bytes 并构造 base64：`apps/core/src/p1/execution-spine/composer-submission-gate.ts:244-269`、`apps/core/src/p1/model-supply/reference-asset-resolver.ts:162-195`。
3. `OwnedAssetReferenceResolver` 校验 workspace/object/hash/大小，但没有检查 Canvas `exportPolicy`：`apps/core/src/p1/model-supply/reference-asset-resolver.ts:115-227`。撤销/过期的 Canvas export policy 不能阻止其作为 Provider reference 被读取。
4. 生成媒体会成为 ContentPackage owned asset，但不会自动创建 ReusableAssetCandidate；“记录成品”不等于“已沉淀复用配方”。

### 6.5 历史作品和复用资产：后端结构存在，Composer 主入口绕过

后端已支持：

- source ContentPackage 的结构、风格和 selected assets 进入 ContextBundle：`apps/core/src/p1/harness/production-context-port.ts:524-560`。
- ReusableAssetCandidate/AssetRevision 保存 fixed items、variable slots、scope、provenance 和 rights：`packages/contracts/src/reuse-memory.ts:195-255`。
- 显式 reuse seed 的 fixed items/variable slots 进入 ContextBundle：`apps/core/src/p1/harness/production-context-port.ts:231-250`。

当前主入口断点：

- Web schema 支持 optional `sources.contentPackage`，但 `composer-home.tsx` 最终只构造 `{ assets }`：`mkfast-template-main/src/product/composer/composer-submission-client.ts:31-46`、`mkfast-template-main/src/product/composer/composer-home.tsx:684-720`。
- snapshot path 明确要求 request `reuseSeed === undefined`：`apps/core/src/p1/harness/task-admission.ts:185-217`。

所以历史作品复用是可调用的服务端能力，不是当前新 Composer 的实际产品主路。

### 6.6 偏好与反馈：数据层完成，学习闭环未激活

结构和数据库：

- PreferenceSignal、Candidate、Preference 和作用域都有公共合同：`packages/contracts/src/reuse-memory.ts:272-343`。
- PostgreSQL 有 signal/candidate/head/revision/receipt 和不可更新 trigger：`apps/core/src/p1/operations/postgres-reuse-memory-repository.ts:31-200`。
- 相同 modification 必须来自至少三个独立任务才提出 candidate：`apps/core/src/p1/operations/reuse-memory-service.ts:757-827`。

未生效事实：

- confirm 后 status 固定为 `inactive_stage2`：`apps/core/src/p1/operations/reuse-memory-service.ts:878-953`。
- 测试明确验证 pending 和 inactive preference 不进入 ContextBundle：`apps/core/src/p1/operations/reuse-memory-service.test.ts:501-549`。
- `ProductionHarnessContextPort` 只带 preference revision head，没有读取正式 Preference 内容作为 contribution：`apps/core/src/p1/harness/production-context-port.ts:439-470`。
- Result 路由调用通用 `result_adopt`：`mkfast-template-main/src/routes/dashboard/results_/$workId.tsx:524-533`、`:738-773`，生产 UI 没有调用 `adopt_harness_candidate`。
- 即使调用后端 Harness adoption，也只更新 ContentPackage、Work 和 audit，不调用 `recordPreferenceSignal`：`apps/core/src/p1/operations/application-service.ts:8698-8824`。
- Weekly review 类型直接声明 reject/adjust 只记录 decision、不写 preference：`mkfast-template-main/src/product/results/weekly-review-model.ts:92-98`。

因此：

- “有反馈控件/审计”达到 S；
- “反馈进入下一次 Prompt”没有达到 P；
- “反馈改变后续输出”没有达到 O；
- “反馈形成正式可用偏好”也没有达到 R。

## 7. Recipe、Brief、Prompt revision 与 Harness

### 7.1 Recipe：交付结构生效，Prompt 和来源强策略不生效

公共合同定义了：

- delivery、context patches、legacy source requirements；
- `requiredSourcePolicy` 的 object type、数量、平台、rights 与 fallback；
- ModelPolicy、Workflow/Prompt/Quote refs；
- `promptRevisionRef`。

证据：`packages/contracts/src/creation-experience.ts:47-164`。

实际 server catalog `RecipeBodyInput` 没有 `requiredSourcePolicy`：`apps/core/src/p1/creation-experience/types.ts:84-107`。normalize 和 rollback body 也只复制 legacy `sourceRequirements`：`apps/core/src/p1/creation-experience/catalog-service.ts:129-166`、`:235-259`。

Admission：

- 确实重读 published Recipe；
- delivery/model/contentModules 会影响 snapshot；
- 来源只用 content type 粗略检查 legacy `sourceRequirements`，不做 slot assignment、minimum/maximum、rights/platform/fallback 强策略。

证据：`apps/core/src/p1/execution-spine/composer-submission-gate.ts:129-183`、`:308-321`、`:425-565`。

结论：Recipe 是真实可复用结构，但不是规划文档所描述的完整运行合同。

### 7.2 Brief：三个含义相近但未统一的对象

1. 旧 `CreativeBrief`：intent/scene/tone/audience 与 merchant/AI owner；`packages/contracts/src/uiux.ts:86-114`。
2. 新 Composer `BriefRevisionContext + BriefConfirmation`：保存草稿/来源/模型/报价等 revision 与是否需要确认；`packages/contracts/src/creation-experience.ts:362-470`，数据库见 `apps/core/src/p1/creation-experience/postgres-brief-revision-context.ts:184-294`。
3. Harness `ExecutionBrief`：由 LLM 从 IntentDeclaration、完整 ContextBundle 和 execution contract 编译，真正提供 provider prompt、storyboard 或 copy constraints；`apps/core/src/p1/harness/structured-nodes.ts:225-298`。

新 Composer 没有把旧 CreativeBrief 四字段作为 snapshot 内容提交；Brief confirmation 冻结 revision 关系，不冻结最终 LLM ExecutionBrief 的正文。当前 “Brief 已确认” 只能证明输入 revision 没变，不代表可以离线重放出同一 ExecutionBrief。

### 7.3 Prompt revision：三套版本语义没有 binding

当前存在：

| 版本语义 | 真实用途 | 证据 |
| --- | --- | --- |
| Recipe `promptRevisionRef` | Catalog 保存、浏览器展示 | `apps/core/src/p1/creation-experience/catalog-service.ts:107-166` |
| Harness frozen prompt | Admission 时从 Langfuse 获取或 builtin fallback，并记录 name/version/hash | `apps/core/src/p1/harness/langfuse-prompts.ts:3-13`、`:44-108`、`:126-156` |
| Structured node `schemaRevision` | Model Supply submission 的 `promptRevision` | `apps/core/src/p1/model-supply/structured-node-runner.ts:108-130` |

生产代码检索中，`promptRevisionRef` 的消费者只在 Creation Experience catalog/admin/seed；Composer gate、snapshot、Harness 和 Model Supply 没有按该 ref 解析实际 Prompt。

Harness trace 会记录 Langfuse prompt 的 name/version/hash：`apps/core/src/p1/harness/workflow-core.ts:246-302`、`:486-541`；这能说明“本次用了哪个 Harness prompt”，但不能证明它与 Recipe 声明的 prompt revision 一致。

### 7.4 图片/视频实际使用 copy Brief Prompt

- resolver 只定义 `harness/intent-naming` 与 `harness/brief-copy`：`apps/core/src/p1/harness/langfuse-prompts.ts:3-13`。
- Harness admission 对所有模态装载同一 `briefCompilation`：`apps/core/src/p1/harness/task-admission.ts:100-111`。
- Media stage 把该 prompt 传给 `compileExecutionBrief`：`apps/core/src/p1/harness/unified-media-stage-ports.ts:79-99`。
- `compileExecutionBrief` 优先使用传入 prompt，只有没有传入时才使用 image/video 自己的 hardcoded instructions：`apps/core/src/p1/harness/structured-nodes.ts:239-298`。

由于生产 wiring 总是配置 resolver：`apps/core/src/main.ts:1542-1547`，图片和视频实际会收到 copy-oriented instruction。这不是只有命名不准确，而是运行 Prompt 的模态语义错误。

### 7.5 Harness：运行骨架完整，输入真相决定上限

五段 Harness 已真实实现：

1. intent naming；
2. ContextBundle compile/freeze；
3. Brief compilation；
4. execution/selection；
5. assembly/delivery。

文案流程证据：`apps/core/src/p1/harness/workflow-core.ts:189-451`；媒体流程证据：`:454-671`。

可复用优点：

- effect idempotency、source revision fence、recompile、trace、prompt hash、pending decision 和 durable request 均存在；
- task request、question、decision 和 trace 均持久化在 `harness_runtime.*`：`apps/core/src/p1/harness/postgres-store.ts:61-149`；
- ContextBundle 是不可变、带 hash 和 source revisions 的运行输入。

主要问题不是 Harness 不存在，而是它忠实执行了一个不完整或错误装配的 bundle/prompt。

## 8. 关键断点与影响

### P0：门店确认与生成事实源分裂

**现象**：StoreProfile 可以通过 UI 和 Composer grounding gate，但新 Harness Prompt 仍没有门店事实。

**影响**：

- 输出可能退回通用文案/通用画面；
- 已确认项目/价格无法作为可追溯事实约束生成；
- 产品会给用户“已经了解门店”的错误认知。

**根因**：Product relation facts 与 StoreFact ledger 是两条独立写链，没有显式投影与单一 owner。

### P0：Recipe Prompt revision 未控制实际 Prompt

**现象**：Recipe ref 只被保存，不进入 snapshot 和 prompt resolver。

**影响**：

- Recipe 的可回滚不等于 Prompt 可回滚；
- 同一 snapshot 在不同时间可能使用不同 Langfuse production label；
- 无法证明成品使用了 Recipe 声明的 Prompt revision。

### P0：媒体使用 copy Brief instruction

**现象**：图片/视频 output schema 正确，但 system instruction 来自 `harness/brief-copy`。

**影响**：

- Prompt 质量和稳定性不可控；
- Langfuse trace 名称会误导审计；
- 图片/视频不能独立评估和发布 Prompt revision。

### P1：偏好和反馈不进入下一任务

**现象**：Preference 永久 inactive，adopt/edit/reject 不产生 signal。

**影响**：系统不会随使用变得更像这家店；“持续个性化”停留在静态身份/事实复用。

### P1：身份选择和授权不是确定性门

**现象**：UI 盲选第一条 active identity，所有平台/场景默认允许，授权字段只进入 Prompt。

**影响**：多身份门店不可预测；人物身份可能用于不适用平台/场景；授权约束依赖模型自律。

### P1：媒体 ContextBundle 血缘未写回 ContentPackage

**现象**：

- Copy write input 包含 `marketing`：`apps/core/src/p1/harness/production-stage-ports.ts:453-516`。
- Media write input 没有 `marketing`：`apps/core/src/p1/harness/unified-media-stage-ports.ts:117-158`。
- 初始 ContentPackage 也没有 `marketing`：`apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:187-213`。

**影响**：图片/视频成品不能从 ContentPackage 直接回答“用了哪个 ContextBundle、哪些身份/事实/权利 ref”。

### P1：personal/face 数据按 public 进行 Provider routing

**现象**：

- route freezer 使用空 data class，并写成 `public`：`apps/core/src/p1/execution-spine/composer-route-resolver.ts:20-27`、`:57-82`；
- Structured LLM submission 默认空 data class：`apps/core/src/p1/model-supply/structured-node-runner.ts:108-122`；
- 媒体 submission 也固定为空：`apps/core/src/p1/harness/unified-media-stage-ports.ts:257-288`。

**影响**：Provider capability/region/data-class policy 无法区分身份、PII、人脸和医疗内容。

### P2：公共合同与实体语义重复

- Composer Web/Core 两份 schema；
- StoreProfile/StoreFact 两套门店事实；
- Brand voice/prohibitions 与 MarketingIdentity 品牌字段；
- 三种 Brief；
- 三种 Prompt version；
- Product/Foundation/Model Supply/Canvas 四类 Asset/OwnedAsset；
- Result local feedback、Harness decision、ContentPackage audit、PreferenceSignal 四套反馈。

这会扩大修改面，也使“记录了”与“执行使用了”难以区分。

## 9. 可复用、重复和缺失清单

### 9.1 建议保留并复用的现有实体/能力

以下判断只表示“具备可复用价值”，不提前决定最终命名：

1. `MarketingIdentity` 的 version/lifecycle/source/authorization 结构与 repository。
2. `StoreFactLedger` 的 source、scope、effective/expiry、append-only revision 与 context hash。
3. `ContextBundle` 的六维结构、优先级、source revisions、hash、freeze 和 fence。
4. `CreationExecutionSnapshot` 的 server-owned execution root 与 Composer admission gate。
5. Recipe catalog 的 immutable revision/publish/rollback 基础。
6. Brief trigger 的 risk 条件、revision confirmation 和 drift revalidation。
7. Harness 的五段执行、idempotency、decision、trace、recompile 与 Langfuse outbox。
8. Model Supply 的 route/provider attempt/cost/owned asset 与媒体异步恢复。
9. Product Asset 的真实权利、用途、人脸和敏感数据字段。
10. source ContentPackage contribution 与 ReuseMemory 的 fixed items/variable slots/scope/provenance 结构。

### 9.2 重复实体/语义

| 重复面 | 当前对象 |
| --- | --- |
| 门店事实 | Product `StoreProfile` / Product relation facts / `StoreFactLedger` |
| 品牌表达 | `StoreProfile.brandVoice/prohibitions` / brand `MarketingIdentity` |
| 素材 | Product Asset / Foundation OwnedAsset / Model Supply OwnedAsset / CanvasOwnedAsset |
| Brief | legacy CreativeBrief / BriefRevisionContext+Confirmation / Harness ExecutionBrief |
| Prompt revision | Recipe ref / Langfuse frozen prompt / schema revision |
| 提交合同 | Web local Composer schema / Core local Composer schema |
| 偏好 | Model default/favorite preference / content-style Preference |
| 反馈 | Result local state / Harness decision / ContentPackage audit / PreferenceSignal |
| 历史复用 | source ContentPackage / ReusableAssetRevision / derived Work |

### 9.3 缺失实体或缺失绑定

以下是能力缺口描述，不建议在本票中锁定新对象名：

1. 缺少 Product StoreProfile 到 StoreFact 的明确 projection、revision 关联和单一写 owner。
2. 缺少用户显式选择并冻结的 identity selection。
3. 缺少 identity platform/scene/portrait/voice policy 的确定性 admission result。
4. 缺少行业/品类、服务项目和当前 Offer 到 execution snapshot/ContextBundle 的显式绑定。
5. 缺少 Recipe `requiredSourcePolicy` 的 server storage、slot assignment 和 admission enforcement。
6. 缺少 Recipe `promptRevisionRef` 到实际 frozen prompt 的 binding。
7. 缺少 copy/image/video 独立的 Prompt identity、revision 和 evaluation lineage。
8. 缺少 media ContentPackage 对 ContextBundle/identity/fact/rights 的交付血缘。
9. 缺少 Preference activation/read path 和普通 Composer contribution。
10. 缺少 adopt/edit/reject/publish/reuse 到 DecisionEvent/PreferenceSignal 的统一映射。
11. 缺少 Composer 对 source ContentPackage/reuse seed 的产品入口。
12. 缺少文案是否读取视觉素材的显式能力声明或多模态输入合同。
13. 缺少从真实输入和素材自动派生 data class 的服务端 policy。
14. 缺少共享 Composer submission 公共合同。
15. 缺少跨 Asset 类型统一的当前可用权利/导出资格检查。

## 10. 优化顺序

### 第一优先级：先修“真相和 Prompt 绑定”

1. 明确 StoreProfile 与 StoreFact 的唯一事实 owner；保留一条显式、可回放、版本关联的投影，而不是双写。
2. 让 execution snapshot 冻结实际 Prompt binding；运行时必须按 snapshot 解析精确版本，trace 和 Model Supply 使用同一 identity/hash。
3. 将 copy/image/video 的 Prompt 分开发布和评估；禁止 media 复用 `harness/brief-copy`。
4. 把 identity 的选择、适用平台/场景和人物授权变成 admission 规则，不交给模型猜。

### 第二优先级：补齐“结果血缘和反馈回路”

1. 三模态交付统一写入 ContextBundle、identity、fact、rights 和 Prompt lineage。
2. 统一 Result adoption 到 Harness candidate/content version 的精确动作，避免“有 current version 即已采用”的投影。
3. 将 adopt/edit/reject 映射为可审计 DecisionEvent；只在明确长期意图或三次独立修改后生成 PreferenceCandidate。
4. 激活前先定义 Preference 在 ContextBundle 的优先级、scope 和撤销语义，再开放 read path。

### 第三优先级：收敛资源与公共合同

1. 把 Composer transport schema 移入共享 contract，减少 Web/Core 漂移。
2. 补 Recipe `requiredSourcePolicy` 的 server 类型、持久化与 slot binding，逐步淘汰粗粒度 legacy `sourceRequirements`。
3. 保留不同资产生命周期，但统一“是否能用于这次 Provider 调用”的权利判定；Canvas export policy 必须进入 reference resolution。
4. 从 identity、asset metadata、StoreFact kind 和任务用途派生 data class，禁止默认 public。
5. 给文案附图入口明确能力：要么真实发送视觉输入，要么 UI 显示“仅引用素材记录，不读取画面”。

### 第四优先级：再开放历史复用与长期个性化

1. Composer 支持显式 source ContentPackage，并展示复用的是结构、风格还是素材角色。
2. 对 ReusableAsset promotion 保留人工确认和最窄 scope。
3. Preference/Reuse contribution 在正式启用前，补跨门店、跨身份、过期事实、撤权素材和 false-memory 回放测试。

## 11. 最终判断

从“有结构”看，项目已覆盖大多数规划对象；从“被注入并影响输出”看，可靠能力集中在：

- 当前 intent；
- 精确 MarketingIdentity revision；
- 已单独进入 StoreFactLedger 且 scope 匹配的事实；
- 当前附加的媒体素材；
- Recipe delivery/model/contentModules；
- Harness 自己解析出的 Brief。

从“被记录以供下一次复用”看，当前可靠能力仅有：

- active MarketingIdentity；
- active StoreFact；
- 用户再次手动选择的资产；
- 显式调用的 source ContentPackage/reuse task；
- Recipe revision。

Preference、采用/修改反馈、历史作品主入口、StoreProfile 新链注入和 Recipe Prompt 都尚未形成主路复用。

所以轻量化主干不应围绕继续增加更多对象，而应优先完成三件事：

1. 让用户确认的门店/项目/身份只存在一条可执行真相；
2. 让每次成品绑定同一份可回放 ContextBundle 与精确 Prompt；
3. 让采用和修改只在明确规则下进入下一任务。

这三件事闭合后，现有结构才能从“完整骨架”变成真实的个性化生成产品。
