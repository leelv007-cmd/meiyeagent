# 票 15 · 水印/AIGC 烧录进输出 + 撤权阻止导出
> 建设面: E3 合规落地 ｜ 决策: DEC-COMPLIANCE-OUTPUT ｜ Blocked-by: 13

> 合同变更通知（2026-07-17）：票 01 冻结后的 `needs_replacement` 允许动作已增加 `edit_text`；本票仍必须保证撤权阻断新导出，文字编辑不得被误读为恢复素材权利。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "15",
  "decisionIds": [
    "DEC-COMPLIANCE-OUTPUT"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [],
  "blockedBy": [
    "13"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **水印/AIGC 开关是"合同记账"，不是输出事实（2026-07-15 复核）**：商户在工作台看到两个开关（`mkfast-template-main/src/product/unified-creation-workbench.tsx:1784-1798`，AIGC 默认开 `:361`），开关进了执行合同（`apps/core/src/p1/operations/types.ts:552-553` `watermarkEnabled/aigcLabelEnabled`）并在合同摘要里回显一行文案（`:1944-1951`）——但提交执行时被整体丢弃：`apps/core/src/p1/operations/model-supply-creation-adapter.ts:310-344` `submitGeneration` payload 只有 dataClass/尺寸/referenceAssetIds/时长/prompt/选型，两个开关字段零传递。生成的图片 Asset、采用后的成品，服务端产物上没有任何标识。
- **Canvas 导出路径的"烧录"信浏览器、服务端只记布尔**：唯一现存标识绘制在客户端一次性文档里（`mkfast-template-main/src/p1/polotno-export-labels.ts:91-141` 徽章几何，`polotno-canvas-runtime.tsx:118-120` 导出时套用）；服务端 `exportWork` 只把开关值散进回执（`apps/core/src/p1/operations/application-service.ts:3355-3372` `appliedLabels` 记账），`RecordedCanvasExportAdapter`（`adapters.ts:304-319`）与像素证据校验（`:181-231`）验证的是**持久化 revision 的元素**，标识徽章不在 revision 里、不被校验——不画标识的客户端照样通过，回执照样写 `true`。且商户下载的文件是浏览器 dataUrl（`canvas-work-page.tsx:375,405-413`），服务端产物本就是伪 objectKey（票 13 已锚定）。
- **视频链路半烧半丢**：AIGC 可见标识 + 隐式元数据烧录能力**存在且真**——`apps/core/src/video/composer.ts:187-192`（drawtext 右上角）、`:230-236`（`aigc_*` metadata）、CJK 字体解析 `:46-73`、生产合成默认 ffmpeg 模式（`composition-runtime.ts:15`）、事后可用 `validation.ts:119-135` 读回验证。但：① 品牌水印在视频端**完全不存在**——`ComposeVideoOptions`（`composer.ts:21-37`）无水印字段，工作台的 `watermarkEnabled` 传给视频面板时被静默丢弃（`unified-creation-workbench.tsx:1989-1990` 只传 `aigcLabelEnabled`；`video-workflow-panel.tsx:60-68` Props 无水印）；② `CreateVideoWorkflowInput` 无水印字段（`p1/model-supply/index.ts:2607`），合成幂等键也只含 aigc 维度（`:3648-3654`）。
- **旧撤权只作用于旧 Product 内容（提示锚点实核，行号补全）**：`apps/core/src/product/product-service.ts:1898-1904` `withdraw_asset` 把素材置 `withdrawn` 后，`:1902` `replacementRequired = state.contents.some(...)` **只扫旧 Product `contents`**；P1 采用产物 `creativeContents`（`application-service.ts:5629-5641`，全字段无任何权利态）与独立视频工作流均不被检查。`needs_replacement/needsReplacement` 全仓非测试源码 grep 0 命中——十条状态契约的"撤权→needs_replacement"今天没有域实现。
- **撤权对新导出零约束力**：旧系统自洽（`product-service.ts:2668-2682` 旧 handoff 有 `assetsAuthorized` 门），但 P1 `exportWork`（`application-service.ts:3315-3394`）无任何权利检查；商户在素材库点"撤回授权"（`canonical-asset-actions.tsx:348-353`）后，用该素材做出的 P1 成品照常可导——"权利状态只约束旧 Product 内容"正是 spec 故事 29 的反面。
- **票界**：本票=两开关真正烧进 ContentPackage 的输出文件（图文导出视觉 + 视频成片）+ 撤权（素材级撤回授权与包级 `revoke_content_package_rights`）作用于 ContentPackage、阻止新导出的完整旅程。不改旧 `exportWork`/Polotno 路径（D06 旧路径维持原样）；不新增商户侧合规开关面（开关事实在生成前的既有工作台开关处决定，随包固化；平台级默认值归票 21）；文案文本文件不加标注（现行拍板只覆盖图/视频可见标识与视频隐式元数据，发布阶段平台标注归法务后审）；`rights=revoked → conflict` 的导出受理守卫是票 01 冻结条款、票 13 已实现，本票补素材级传导与烧录，不重写守卫。最高 seam 仍是 Product Core Application Service，传导走既有 Port 装配模式，**不新增 seam**；状态用语只用「创作中 / 可使用 / 需处理」（D14）；D4 不重开。

## 现状代码入口（实核 file:line）

- `packages/contracts/src/content-package.ts`（票 01 交付）：`compliance` 开关位（01 prose 明示"烧录落地归票 15"）、`rights`（authorized/revoked）、`needs_replacement` 契约与 `revoke_content_package_rights` 命令、`exportReceipts[]`。本票需要的 `compliance.watermarkText` 快照与回执 `appliedCompliance` 若冻结版缺失，走票 01 冻结变更记录，不静默扩。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:310-344`：创作执行提交点——图像/视频合同两开关在此断流（实核未漂移）。
- `apps/core/src/p1/operations/application-service.ts:3355-3372`：`exportWork` 的 `appliedLabels` 记账形态——"记录了什么"与"烧录了什么"必须一致的反面参照；本票不改此方法。
- `apps/core/src/video/composer.ts:7,21-37,46-73,127-136,187-192,230-236`：`DEFAULT_AIGC_VISIBLE_LABEL`、`ComposeVideoOptions`（无水印字段）、`resolveFontFile` CJK 兜底与明确报错（`:67-71`）、可见标识 drawtext、隐式 metadata——水印选项在此做纯加法。
- `apps/core/src/p1/model-supply/index.ts:2607,2857,3511-3520,3605-3633,3648-3654`：`CreateVideoWorkflowInput.aigcLabelEnabled`、创建时归一化、`if (!workflow.composedAsset)` 合成一次性执行与 compose 调用、workflowId 重用的 draft 一致性校验、`videoCompositionKey`（需加水印维度）。
- `apps/core/src/p1/model-supply/foundation-module.ts:2011`：`create_video_workflow` payload 解析（`aigcLabelEnabled === true`）——水印字段在此并列加入。
- `apps/core/src/p1/model-supply/ffmpeg-composition-port.ts:55-90,91-95`：合成 port 传参与 ffprobe 技术验收；`composition-runtime.ts:11-25` env 装配（ffmpeg 默认、`FFMPEG_FONT_PATH`）。
- `apps/core/src/video/validation.ts:119-135`：`validateVideoLabels` 读回 `aigc_visible_label/aigc_*` tags——成片标识证据的现成验证器。
- `apps/core/src/product/product-service.ts:651-658,684-695,1898-1904`：`ProductServiceOptions`（`searchProjection` 先例=可选 Port 注入点）、构造器、`withdraw_asset` 命令体——素材级传导的挂载处。
- `apps/core/src/main.ts:456-460,473-475`：`ProductOperationsBatchExecutionAdapter(productService, () => operationsService)` 的 lazy thunk 跨模块装配先例、`ProductCreativeGroundingResolver` 产品侧实现 operations Port 的先例（`product/p1-model-policy.ts:13-28,30-147`，含 `authorizationStatus === 'authorized'` 判定 `:55`）——撤权传导与导出时权利复核照此两个模式，不发明新缝。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:360-361,790-811,1784-1798,1944-1951,1989-1990`：开关 state、合同组装、开关 UI、摘要回显、视频面板传参（水印丢失点）。
- `mkfast-template-main/src/product/video-workflow-panel.tsx:60-68,140-156`：面板 Props 与 `buildVideoWorkflowDraft`（`video-workflow-model.ts`）——水印字段前端穿透点。
- 票 13 交付（导出通道）：`ContentPackageExportPort` live adapter（image_text 走资产字节→zip→`persistGeneratedAsset`；video 引用 `composedAsset`）、`export_content_package` 受理守卫（revoked/needs_replacement 拒绝）、回执落聚合——本票的烧录步骤与守卫复核挂在这些交付物上，具体 file:line 以票 13 实际落点为准，本 brief 不冒充其为现状。

## 改造方案（步骤级）

垂直切片：合同/冻结变更 → 视频合成烧录（域+Port+前端穿透）→ 图文导出烧录（export adapter）→ 撤权传导与守卫复核（Application Service 命令行为）→ 前端可见化 → 合同测试与留证。

1. **合同与冻结变更（`packages/contracts/src/content-package.ts`）**：核对票 01 冻结版 `compliance` 字段；按冻结变更记录流程补 `watermarkText?`（门店名快照，包创建/采用时固化，缺失时用产品兜底文案，与 `polotno-export-labels.ts:131-132` 同口径）与回执 `appliedCompliance: { brandWatermark: boolean; aigcLabel: boolean }`；撤权证据补 `rights.revokedReason ∈ package_revoked | asset_withdrawn`（+ 触发 assetId）。同步票 01/06/07/13 负责人签收。协调项：票 06/08 落地时若未把合同/工作流开关写进包 `compliance`，本票补该映射（字段已冻结，无 schema 变更）——image_text 来自 `CreativeExecutionContract`，video 来自 workflow 事实。
2. **视频成片烧录补全（合成是视频输出文件的唯一产出点，导出零再编码）**：
   - `composer.ts`：`ComposeVideoOptions` 加可选 `brandWatermarkText?: string`，drawtext 右下角水印（复用 `:46-73` 字体解析与 `:54-58` 转义；几何对齐 polotno 徽章比例，右上 AIGC / 右下水印互不遮挡），纯加法不动既有滤镜链。
   - `p1/model-supply`：`CreateVideoWorkflowInput` 与 workflow 状态加 `watermarkEnabled/watermarkText` 快照（`index.ts:2607` 旁、`:2857` 归一化、`:3605-3633` draft 一致性校验同步扩）；`videoCompositionKey`（`:3648-3654`）加水印维度——已 `composedAsset` 的在途工作流因 `:3511` 短路不受影响，不重投；compose 调用（`:3514-3520`）与 `ffmpeg-composition-port.ts:74-90` 透传水印参数；`foundation-module.ts:2011` 解析新字段。
   - 前端穿透：`unified-creation-workbench.tsx:1989-1990` 把 `watermarkEnabled` 与门店名传入面板；`video-workflow-panel.tsx` Props 与 `buildVideoWorkflowDraft` 加字段。隐式 metadata 的 `contentId` 维持 workflowId（`ffmpeg-composition-port.ts:81-86` 既有语义），包侧由 childRun 关联。
3. **图文导出烧录（票 13 的 `ContentPackageExportPort` live adapter 内，资产字节→zip 之间插一步）**：包 `compliance` 开关开启时，对目标 variant 版本的每张视觉图执行 ffmpeg drawtext 单帧烧录（与视频同一薄壳、同一字体解析与 CJK 缺失报错行为，AIGC 文本用 `DEFAULT_AIGC_VISIBLE_LABEL`，几何镜像 `polotno-export-labels.ts:100-137` 使客户端预览≈服务端烧录）；烧录后做标识区域像素证据断言（复用 `adapters.ts:254-301` `rasterRegionEvidence` 思路），证据不过不产出文件。**烧录只发生在导出产物上，源 Asset 字节永不改写**（Asset 不可变契约）；开关全关时字节原样入 zip。回执写入 `appliedCompliance`，与包事实一致——记账值从此有真实产物背书。
4. **撤权传导（素材级 → ContentPackage，双保险）**：
   - 传导 Port：`ProductServiceOptions`（`product-service.ts:651-658`）加可选 `packageRightsPropagation`，adapter 按 `main.ts:456-460` lazy thunk 模式包 OperationsApplicationService；`withdraw_asset`（`:1898-1904`）在素材事实落定后调用传导——operations 侧新增内部命令行为（复用票 01 `revoke_content_package_rights` 的域转换，reason=asset_withdrawn）：扫描本 workspace 引用该 assetId 的 ContentPackage（source 素材、版本有序视觉、variant 版本、视频源片段），逐包转 `needs_replacement`（用户可见=需处理）+ `rights` 证据，audit 带 correlationId；已 needs_replacement/revoked 的包幂等跳过。传导失败时 withdraw 命令整体报错可重试（幂等重放补齐），不静默半完成。`:1902` 旧 `contents` 检查保留不动（旧三套只读历史的既有投影）。
   - 守卫复核：票 13 的导出受理守卫已拒 revoked/needs_replacement；本票在受理时增加源素材权利**live 复核**（照 `ProductAssetDataClassResolver` 模式的产品侧资产权利 resolver，判定 `authorizationStatus === 'authorized'`，`p1-model-policy.ts:55` 同口径）——发现撤回而包未转态（传导缺口）时，当场转 needs_replacement 并拒绝导出，保证"撤权后导不出"不依赖传导百分百送达。
5. **前端可见化（票 07 详情面 + 票 13 导出动作上叠加，零新页面）**：导出动作旁只读回显本次将烧录的标识（「品牌水印：开/关 · AI 生成标识：开/关」，读包 compliance，禁第二套开关）；需处理成品显示原因「引用素材已撤回授权」与指引（替换素材做新版本归票 12 的编辑通道，本票只给指引文案）；素材库撤回授权的确认弹层提示将影响 N 个成品（读传导预检查询或撤回后 toast 汇总，取实现最薄者）。所有状态徽章仍唯一来自票 01 `contentPackageStatusGroup`。
6. **合同测试与留证（打 Application Service 外部行为；evidence 落 `docs/evidence/contentpackage/ticket-15/`）**：
   - 烧录：开关开→导出 artifact 内图字节≠源 Asset 字节且像素证据通过、回执 `appliedCompliance` 与包事实一致；开关关→字节与源 Asset 一致；同幂等键 replay 不重复烧录不重复文件。
   - 视频：fake composition port 断言 workflow 事实携带两开关与文本快照；ffmpeg 真实烧录走既有 integration 形态（`composer.integration.test.ts`/`ffmpeg-composition-port.test.ts` 扩展：水印+AIGC 双烧成片 `validateVideoLabels` 读回 + drawtext 区域证据），live 隔离、默认不进普通 CI。
   - 撤权：撤回素材→引用包 needs_replacement（需处理）、未引用包不动、重复撤回幂等；撤回后导出→conflict，零新回执零新 artifact；包级撤权同断言；**历史已成功回执与已导出文件全保留**（撤权阻止"新"导出，不追溯销毁——契约"必须行为"断言）；workspace 隔离（B 撤 A 的素材不可能、B 查不到 A 的需处理传导）。

## DoD（全部必须是用户可见行为）

- **导出文件带标识（主对照证据，当前 vs 改造后）**：真实 dev 环境（真实 Postgres + 真实文件存储 + 真实 ffmpeg，非 recorded/fixture），商户对开关全开的 image_text 成品导出，解开下载的 zip：每张图右上可见「内容由 AI 生成」徽章、右下可见门店名水印，肉眼可辨；开关全关的成品导出，图片干净且字节与素材库原图一致。对照当前：开关只有工作台摘要回显（`unified-creation-workbench.tsx:1944-1951`）与回执布尔记账（`application-service.ts:3363-3372`），服务端导出产物零标识。改造前后文件与截图各留一份进 evidence。
- **视频成片带标识**：商户在开关全开下走真实合成的视频成品，播放器里右上角可见 AI 标识、右下角可见门店水印，`ffprobe` 读回 `aigc_*` 元数据齐全；对照当前：水印开关在视频链路被静默丢弃（`:1989-1990`）、成片无水印能力（`composer.ts:21-37`）。可另附即梦等对标产品导出成片的 AI 标注样例并排参照。
- **撤回素材授权立刻约束成品**：商户在素材库对一张已用于成品的真实素材点「撤回授权」后，内容库中引用它的每个 ContentPackage 立即显示「需处理」、详情标明「引用素材已撤回授权」；导出动作禁用；经命令通道强行导出得到明确 conflict，不产生新回执与新文件。对照当前：撤回后 P1 成品毫无反应（`product-service.ts:1902` 只扫旧 `contents`，`needs_replacement` 全仓 0 实现）。
- **撤权不销毁历史**：撤权前已导出的回执仍在成品详情可见、已下载文件不受影响、历史版本与 variants 完整——商户可核对"阻止的是新导出，不是抹掉过去"。
- **开关事实全程一致**：商户在生成前工作台看到的开关状态 = 成品 compliance 事实 = 导出动作旁回显 = 回执 `appliedCompliance` = 文件里实际烧录，五处一致；不存在"记录 true 文件却干净"的组合。
- **重复动作不重复副作用**：重复撤回同一素材、同幂等键重放导出，成品状态、回执数量、存储文件数均不变。
- **关票边界（禁止项）**：不得以"烧录函数单测绿""fixture 包转了 needs_replacement""composer 支持水印参数"关票——必须真实运行服务上的下载文件肉眼验标 + ffprobe 元数据 + 撤回→需处理→导出被拒的完整操作录屏三者齐备。本票关闭 ≠ 真实链路完成：北极星"真实跑通链路数"由票 22（D01 硬 Gate）计数；发布受 ADR-0009 单发布闸约束，E3 面单独完成不发布。

## Blocked-by / Blocks

- **Blocked-by**：票 01（`compliance/rights/needs_replacement` 冻结合同、`revoke_content_package_rights`、冻结变更记录通道；全局 gate：合同未冻结集内任何票不得关闭）；票 06（image_text 包存在且采用映射合同开关）；票 08（video 包存在且映射工作流事实）；票 13（导出通道、revoked/needs_replacement 受理守卫、回执落聚合——烧录与守卫复核的宿主）。相邻非前置：票 07（详情面，UI 叠加点）、票 09/10（真实素材进媒体与烧录无耦合）、票 12（替换素材出新版本的编辑通道）、票 21（平台级合规开关默认值，本票只消费包内事实）。
- **Blocks**：票 22（E6 完整真实验收——合规落到输出是 E3 建设面必备件，真实链路留证需包含带标识的导出文件）；ADR-0011 E3「合规落到输出」由本票收口，与 09/10 共同构成 E3 面，按 ADR-0009 任一缺席不发布。

## 风险与回退

- **CJK 字体缺失产出乱码/空标**：沿 `composer.ts:61-73` 行为——字体解析失败明确报错，图文导出进 export_failed（需处理）、视频合成失败走既有 attempt 失败路径，绝不产出无标识却记 `appliedCompliance=true` 的文件；`FFMPEG_FONT_PATH` 列入部署检查项。
- **双重烧录**：单点原则——视频只在合成烧、导出零再编码；图像只在导出烧、源 Asset 永不烧。若未来 Work 导出物（客户端已画标识）入包成为视觉资产，按资产来源事实跳过同类标识；本票先以合同测试锁"源 Asset 字节不变 + 导出仅烧一次"。
- **compliance 与成片不一致的包（迁移件/理论不可达）**：视频包 compliance 与 `composedAsset` 实烧状态不符时，导出不做同步重编码（HTTP 命令内重编码超时不可控），直接拒绝并置需处理、提示重新成片；迁移旧视频的 compliance 映射置信度归票 17，unknown 不补造。
- **合成幂等键加维度的波及**：`videoCompositionKey` 加水印维度只影响新合成；已 `composedAsset` 的工作流被 `:3511` 短路保护，合同测试断言在途工作流不重投、不产生第二次合成计费。
- **撤权传导两阶段一致性**：素材事实先落、传导幂等可重放、导出守卫 live 复核兜底——三层保证"撤了导不出"即使传导中断也成立；传导失败对商户可见（命令报错可重试），不静默半完成。传导范围按包引用面扫描，workspace 内全量过滤沿既有 per-workspace state 读取模式，量级=单店成品数，无需新索引先行。
- **产品模块反向依赖 operations**：走 `ProductServiceOptions` 可选 Port + lazy thunk（`main.ts:456-460` 既有先例），不 import 具体类、不形成模块环；测试可注入 fake 传导 port 打 seam 外部行为。
- **回退**：composer 水印选项、workflow 新字段、导出烧录步骤、传导 port、UI 回显均为纯增量，逐项可摘——摘除后回到"开关记账"现状；已烧录的导出文件、已转移的 needs_replacement 状态与撤权审计保留为历史事实，不删除不改写。
