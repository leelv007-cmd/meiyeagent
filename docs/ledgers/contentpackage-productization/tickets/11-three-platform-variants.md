# 票 11 · 三平台 variants 生成
> 建设面: E4 三平台 ｜ 决策: DEC-THREE-VARIANTS ｜ Blocked-by: 06

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "11",
  "decisionIds": [
    "DEC-THREE-VARIANTS"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [
    "X-THREE-VARIANTS-EDITABLE"
  ],
  "blockedBy": [
    "06"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US12 / D01 链路环节缺失**：规格拍板"一个成品自动适配出小红书 / 抖音 / 视频号三个平台版本"，且三平台适配是 D01 硬 Gate 商户旅程（档案→主题→图文或视频→**三平台适配**→确认→内容库）的必经环节，但当前产品里"视频号"作为平台**全仓零命中**（`grep -rn 'video_account|videoAccount|视频号'` 在 apps/core/src 与 mkfast-template-main/src 均为 0），全产品唯一平台类型 `packages/contracts/src/product.ts:3` 是 `Platform = 'xiaohongshu' | 'douyin'`——ADR-0011 聚合形态要求的 Xiaohongshu / Douyin / Video Account 三 variant，第三个平台连类型都不存在。
- **新事实源（P1 采用链）零 variant 概念**：`apps/core/src/p1/operations/application-service.ts:5629-5640` 的 `acceptCreativeAsset` 造出的 creative content 只有 title / body / `assetIds: [asset.id]`（:5631；ADR-0011 所引 `:5638` 已漂移数行至同对象的 `workId` 字段，"单 Asset→单 Content、无 variant"的事实未变）。商户采用文案后得到的成品没有任何平台版本的容身之处。
- **旧事实源的 variant 是字符串拼接假适配**：旧 Product 虽有 `ContentVariant`（`packages/contracts/src/product.ts:108-115`），但生成它的 `create_douyin_variant`（`apps/core/src/product/product-service.ts:1944-1951`）产物是 `title: \`${source.title}｜N 秒口播\``、body = 标题+正文+钩子的纯字符串拼接——**零模型调用**的假"平台适配"，且只覆盖抖音一个目标平台。按 D06 该套已判只读迁移来源，不能在其上建设；它恰是"recorded 完备性冒充可用"病根在 variant 面的实例，本票不得复刻这种假生成。
- **商户可见断裂**：P1 采用的内容详情页 `mkfast-template-main/src/product/canonical-history-page.tsx:549-561` 双源拼接（creative 查 canonical_history、persisted 查旧 `state.contents`），只有旧 persisted 侧渲染 variants（:555-561）——商户在新链路采用的每一条内容，详情页**永远没有平台版本区**；旧内容库 `content.tsx:514` 的"抖音 N 秒版本"按钮只作用于旧事实源。
- **执行通路没有适配类操作**：`ModelOperation`（`apps/core/src/p1/model-supply/index.ts:6-10`）只有 copy.generate / image.generate / image.edit / video.generate；direct LLM 执行端口 `adapters.ts:227` 显式拒绝 copy.generate 之外的操作；AI SDK runner 只有 `generateCopy`（schema 钉死 3 候选）。平台适配这个付费 LLM 行为在双账体系（Product Usage + Provider Cost）里没有合法通道。
- **票界**：ContentPackage 聚合与采用命令由票 01/06 落地，本票在其上补"三平台 variants 生成"这一个命令的垂直切片；variant 的编辑/版本/回滚是票 12，导出是票 13，复用是票 14，跨设备是票 16，旧三套迁移是票 17，均不在本票。三平台版本是**内容适配**，不是发布能力——抖音发布/账号接入仍按 D10 保持"未接入"诚实标注（票 04），本票不碰发布闸（ADR-0009）。

## 现状代码入口（实核 file:line）

- `packages/contracts/src/p1.ts:32-47`：`generatedCopyCandidateSchema` / `generatedCopyCandidatesSchema`（恰 3 候选）——新三平台 variant 生成 schema 照此形态落同文件。
- `packages/contracts/src/uiux.ts:41-66`：`creativeExecutionContractSchema`，operation 枚举在 :42-47，报价字段（quoteRevision / estimatedAmount / outputCount / outputLabel）齐备——variant 生成命令复用该合同形状承载报价确认。
- `apps/core/src/p1/model-supply/index.ts:6-10`：`ModelOperation` 枚举，扩展点。`:505-522` `ProviderExecutionResponse`（completed 分支现有 `copyCandidates?` / `assetBytes?`）；`:1257-1267` `submit` 按操作分流（媒体→mediaRuntime，其余→execution port）；`:1782-1801` 完成结果组装、台账 settle、resultSink、幂等落账——`copyCandidates` 在 :1789 条件透传，新增可选 `platformVariants` 字段同款接入；`:1459-1461` 等多处 `operation === 'copy.generate'` 守卫在扩枚举时逐一复核。
- `apps/core/src/p1/model-supply/catalog.ts:218-221`：四个 LLM catalog 模型 `operations: ['copy.generate']`，unitPrice 声明在 :418 附近——copy.adapt 需在此声明才有报价与路由资格。
- `apps/core/src/p1/model-supply/ai-sdk-runner.ts:80-101`：`generateCopy` 用 `generateObject`（maxRetries: 0，:88 绑 `generatedCopyCandidatesSchema`，:91 严格 parse），:334 `createNativeLanguageModel` 三原生家族分发——新 `adaptPlatformVariants` 方法照此模式。
- `apps/core/src/p1/model-supply/adapters.ts:144-191`：`DirectLlmRecordedAdapter`（:157-164 操作守卫、:180-189 recorded 成功输出）与三家 recorded 子类 :193-206；`:215-262` `OpenAiCompatibleLlmExecutionPort`（:225-235 绑死 copy.generate、:238 调 `runner.generateCopy`、:244 回 `copyCandidates`）。两处都要按 operation 分发。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:229-293`：`inspect` 的 catalog revision 校验 + 报价校验（:258-277 outputCount / outputLabel / quoteRevision 按 operation 组装）；`:295-353` `submit` 经 `controlPlane.submitGeneration` 带幂等键提交——variant 生成的执行出口复用这条已审计通路。
- `apps/core/src/p1/operations/foundation-module.ts:433-437`：`accept_creative_asset` 命令 dispatch 形态，新命令 `generate_package_variants` 照此挂接。
- `apps/core/src/p1/operations/application-service.ts:5572-5667`：`acceptCreativeAsset` 全链（幂等回放 :5590-5593、审计 :5651-5658）——票 06 将其改写 ContentPackage，本票的 variant 命令挂同一 Application Service（最终落点以票 01/06 实际为准）。`:4380-4389` `getCreativeWorkbench` 投影现状。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:2346-2369`：采用按钮（发 `accept_creative_asset`）与已采用 Badge；`:2378-2390` 采用后"下一步"区——"生成三平台版本"入口挂在这条旅程上。
- `mkfast-template-main/src/product/canonical-history-page.tsx:538-637`：内容详情页现状（票 07 收敛为 ContentPackage 详情），variants 区的可见容器。
- `mkfast-template-main/src/routes/dashboard/content.tsx:100,136,141,514`：旧内容库读 `state.contents` 与旧 douyin variant 按钮——本票不碰，随票 07/17 退出主路径。
- 测试形态：`apps/core/src/p1/operations/creative-work.test.ts:991-1006`（采用幂等/冲突合同测试）、`apps/core/src/p1/model-supply/ai-sdk-runner.test.ts`（runner 合同）、`apps/core/src/p1/operations/http.test.ts`（HTTP 边界）。
- i18n：`mkfast-template-main/project.inlang/messages/zh.json` / `en.json`——"视频号"字样全文件零命中，平台名与状态用语 key 需新增。

## 改造方案（步骤级）

1. **契约层（schema 先行，对齐票 01 冻结合同）**：`packages/contracts/src/p1.ts` 新增 `contentPackagePlatformSchema = z.enum(['xiaohongshu', 'douyin', 'video_account'])` 与 `generatedPlatformVariantSchema`（title / body / topics / conversionHook 等非空字段，具体槽位以票 01 冻结的 variant 合同为准，不另造第二套字段），`generatedPlatformVariantsSchema` 要求三平台键**全部齐备**——缺任一平台即 parse 失败，不落半截。不改旧 `product.ts:3` 的 legacy `Platform`（D06 只读，旧类型不再扩）。`uiux.ts:42-47` 的 operation 枚举追加 `'copy.adapt'`。
2. **ModelSupply 执行层（Ports/Adapters 外围，非新 seam）**：`ModelOperation`（`index.ts:6-10`）追加 `'copy.adapt'`，逐一复核既有 `operation === 'copy.generate'` 守卫（`:1275,1459-1461` 等）确保 copy.adapt 走 LLM 执行分支、不误入媒体/流式通路；`ProviderExecutionResponse` completed 分支加可选 `platformVariants`，`:1789` 同款条件透传进 `ModelSupplyResult` 与幂等落账。catalog（`catalog.ts:218-221`）为四个 LLM 模型的 operations/capabilities 追加 copy.adapt，报价沿用各模型现有 copy 单价 revision。
3. **runner 与 adapter 分发**：`ai-sdk-runner.ts` 新增 `adaptPlatformVariants(prompt)`——`generateObject` + `generatedPlatformVariantsSchema`、maxRetries: 0 单次 side effect、instructions 写明三平台各自表达规范（小红书种草笔记 + 话题、抖音短视频口播钩子、视频号私域转化口吻），产物严格 parse。`OpenAiCompatibleLlmExecutionPort.execute`（`adapters.ts:222-261`）按 operation 分发 generateCopy / adaptPlatformVariants；`DirectLlmRecordedAdapter`（:144-191）补 copy.adapt 的 recorded 三平台输出与失败场景，本地/CI 不依赖真实调用。
4. **报价与执行出口**：`model-supply-creation-adapter.ts` 的 inspect/submit 扩展 copy.adapt：outputLabel「三平台版本」、outputCount 与估价按**单次适配调用**口径组装 quoteRevision（一次调用产三平台，不按三倍单价虚报，对齐 D15 简单费用提示），prompt 由源成品当前版本文案 + 门店语气事实组装，不重抓外部内容（L-1 不复活）。
5. **Application Service 命令（最高 seam，不新增 seam）**：新命令 `generate_package_variants`（dispatch 挂 `foundation-module.ts:433` 同款 case），输入 `{ packageId, contract, submissionKey }`。行为合同：package 必须存在且其文案处于已采用可用版本；同 submissionKey 回放既有结果、**不重复 provider 调用不重复计费**（ADR-0011"使用原幂等键只查询"）；三 variant 已齐再发新 key 返回 409 `VARIANT_ALREADY_EXISTS`（重生成属票 12 的编辑范畴）；执行成功一次性写入三平台 variant 槽 + child run 引用 + 实际模型证据，audit `content_package.variants_generated`；失败不写任何 variant、错误可见、额度按 ModelSupply 双账 acceptance 语义处置。variants 运行态映射进票 01 冻结的十条状态契约投影，用户可见用语只有**创作中 / 可使用 / 需处理**（D14），不造第二状态机。
6. **查询投影**：ContentPackage 详情查询（票 07 落地的容器）扩展返回 `variants[]`（platform / title / body / topics / conversionHook / 状态 / 生成来源引用），内容库列表项带"已有三平台版本"标记。
7. **前端（详情页 + 工作台旅程）**：成品详情页新增"平台版本"区——未生成时主动作「生成三平台版本」+ 简单费用提示（D15），生成中显示创作中，完成后三平台 tab（小红书 / 抖音 / 视频号）各渲染完整适配文案，失败显示需处理 + 重试（新 submissionKey）。工作台采用成功后（`unified-creation-workbench.tsx:2378` 起的"下一步"区）提供直达该成品"生成三平台版本"的入口，让 D01 链路在同一旅程闭合。i18n 三平台名与文案 key 补 zh/en；抖音 tab 内不出现任何"发布/连接账号"暗示（D10 边界）。
8. **测试（打 Application Service 外部行为）**：合同测试——采用成 package 后发 `generate_package_variants`，断言三平台键恰为 xiaohongshu / douyin / video_account 且各含非空适配文案、内容库/详情查询立即可见；同 key 重放单次 provider side effect（Product Usage 与 Provider Cost 各只记一笔）；预置失败场景断言零 variant 落库 + 需处理可见 + 台账 acceptance 语义正确；已齐再发新 key 得 409；workspace 隔离。runner 合同测试（fetch mock）断言单次调用、缺平台键即失败。HTTP 边界测试补命令 dispatch。显式隔离 live 探针（默认不进 CI）用 `docs/_private/tuzi.env` 真跑一次 copy.adapt。测试是工程护栏，不作关票依据。

## DoD（全部必须是用户可见行为）

- 商户在内容库打开一个采用生成的成品，点「生成三平台版本」，在同一成品详情内看到小红书 / 抖音 / 视频号三个版本先后就绪，每个版本都是贴合该平台表达习惯的完整可读中文文案（三份实质不同，不是同一段文字复制三遍）。**对照证据（当前 vs 改造后）**：当前 P1 采用的内容详情页（`canonical-history-page.tsx:549-631`）没有任何平台版本区，旧内容库仅有的"抖音 N 秒版本"是标题拼接的假适配（`product-service.ts:1944-1951`，零模型调用）；改造后同一成品三平台真实模型适配，实际模型在详情可查。
- 商户点生成前看到简单用量/费用提示（D15，明细在二级）；生成过程中该区显示**创作中**；完成后成品与三版本为**可使用**；失败时显示**需处理**与明确的重试动作——全程只出现这三种状态用语。
- 三平台版本共享同一成品的图片/视频（variant 是文案与结构适配，不触发媒体重新生成、不重复扣媒体费用）；"视频号"作为平台首次真实出现在商户产品里。
- 同一生成请求重复提交（刷新、重点按钮）不产生第二套版本、不重复扣费；失败后重试成功只补齐版本，不留下半截或重复的平台版本。
- 抖音版本清楚呈现为"可复制使用的内容版本"，页面不出现"发布到抖音"或"只差账号连接"的暗示——抖音接入状态仍按 D10 标注未接入。
- 采用（3 选 1 单选）行为不变：三平台版本是同一成品的三个输出面，不是三个候选，商户无需也不能在版本间"选一弃二"（不重开 D4）。
- **真实留证（D01 口径）**：至少一次真实 LLM（direct 通路，`tuzi.env` 凭据）走完"工作台采用→生成三平台版本→详情页三版本可读"的完整操作并留证（录屏/截图 + audit 记录 + 用量与 Provider Cost 台账对比），证据落 `docs/reviews/`。仅 schema 落库、runner 单测绿、recorded fixture 出三平台，一律不得关票。

## Blocked-by / Blocks

- **Blocked-by**：票 01（ContentPackage 聚合合同 + 十条状态契约冻结——variant 槽位与状态映射的唯一权威，E1 未冻结不得动工，规格 §11 Codex 警告）；票 06（采用写 ContentPackage——没有成品实例就没有适配对象）；票 07（内容库只读 ContentPackage——三平台版本的商户可见容器是新详情页）。
- **Blocks**：票 12（variant 编辑 + 版本 + 回滚——先有 variant 才有可编辑对象）；票 13（导出 + 回执——导出按平台版本出件）；票 22（真实链路端到端——D01 北极星链路的"三平台适配"环节由本票供给）。票 16（跨设备）经票 07 的同一查询投影自然获得 variants 展示，非硬阻塞。解阻不等于关票：本票自身 DoD 的真实留证不依赖后续票。

## 风险与回退

- **一次调用产三平台 vs 三次调用**：本票选单次 `generateObject` 出三键对象——原子、单次报价、无 partial 状态复杂度；schema 三键必齐保证不落半截。风险是单平台质量不齐或长输出截断：控制=schema 严格 parse 失败即整体失败（额度按 acceptance 语义处置），商户重试用新 key 新调用。若真实模型三合一质量实测不可用，回退为同一命令内按平台三次子调用（保留成功、只重试失败，对齐 ADR-0011"保留成功子任务只重试失败"），该回退不改命令合同与 DoD，不算重开决策。
- **operation 枚举扩散面**：`ModelOperation` 加值触碰 catalog / 报价 / 合同 enum / 多处 switch 守卫。控制：copy.adapt 只对 llm modality 模型开放；`index.ts:1257-1267` 分流与 `:1459-1461` 媒体守卫逐处过一遍并有测试兜底；媒体与流式（copy stream）通路行为零变化。
- **与票 01 合同冲突**：variant 字段形状若与票 01 冻结结果有出入，以聚合合同为唯一权威调整生成 schema，不双合同、不在 contracts 留两套 variant 类型。
- **假适配复辟**：任何人不得为"先跑通"把 adaptPlatformVariants 降级为字符串模板拼接——那正是 `product-service.ts:1944-1951` 被诊断否决的病根。recorded adapter 仅限测试/演示装配，且演示环境沿用票 03 确立的诚实标注口径。
- **两处"平台版本"并存造成困惑**：迁移完成前旧内容库的 douyin 按钮仍在旧页面。控制：新详情页只读写 ContentPackage；旧页面按 D06 只读历史、不新增入口，票 07/17 收口后自然退出。
- **回退**：出问题下线前端「生成三平台版本」入口即可回到票 06/07 交付态——命令幂等可重入、无 schema 迁移负担；已生成的 variants 是 ContentPackage 事实，保留不回滚；copy.adapt 操作保留在 catalog 不影响 copy.generate 主链。
