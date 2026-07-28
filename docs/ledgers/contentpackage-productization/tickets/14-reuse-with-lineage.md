# 票 14 · 复用 + 血缘
> 建设面: E4 三平台 ｜ 决策: DEC-THREE-VARIANTS ｜ Blocked-by: 11

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "14",
  "decisionIds": [
    "DEC-THREE-VARIANTS"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [
    "X-THREE-VARIANTS-EDITABLE"
  ],
  "blockedBy": [
    "11"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **复用与血缘在 ContentPackage 通道整体空白（2026-07-15 复核）**：`grep -rn "reuse_content_package\|content_package_lineage\|ContentPackage"` 在 `apps/`、`packages/`、`mkfast-template-main/src` 源码命中 0 条——票 01 的冻结合同尚未落地，spec 用户故事 15「复用一个历史成品作为新创作的起点……能看到复用血缘」（`docs/specs/contentpackage-productization-spec.md:71`）、§6 血缘查询与复用命令（`:160-161`）、§4「复用血缘」一等字段（`:132`）今天没有任何实现。提示锚点复核：ADR-0011 聚合形态含 `reuse lineage`（`docs/adr/0011-contentpackage-sole-content-aggregate.md:40`）未漂移。
- **唯一现存"复用"挂在旧事实源上，血缘只进审计、合规顺带洗白（商户可见断裂）**：内容库「做同款」按钮（`mkfast-template-main/src/routes/dashboard/content.tsx:546-556`）发 `remix_content` → `apps/core/src/product/product-service.ts:2049-2081` 对旧 `ContentItem` 做 `structuredClone` 换 id，三处断裂：
  - 来源只写进审计事件 `content.remixed` 的 `sourceId`（`:2079`），克隆对象上零来源字段——旧合同 `ContentItem`（`packages/contracts/src/product.ts:117-130`）没有任何 lineage 槽位，商户在任何界面都看不到"这条从哪来"，来源也看不到"被谁复用"。
  - `complianceStatus` 被硬置 `'clear'`、`warning` 清空（`:2076-2077`）——复用即洗白，来源上的权利/警示随克隆蒸发，与 spec「权利/合规态是 ContentPackage 的一等字段；撤权作用于 ContentPackage」（`:137`）背道而驰。
  - 写入的是 `state.contents` 旧第一套事实（`content.tsx:100` 读它；D06 判只读迁移来源）——P1 新采用链的成品（`creativeContents`）连复用动作都不存在。
- **新链成品无血缘容身之处**：`CreativeContent` 全字段（`apps/core/src/p1/operations/types.ts:731-741`）无 lineage；创作起点引用 `CreativeSourceReference`（`:482-486`）kind 只有 task/asset/content/template/work，且 `normalizedSourceReferences`（`application-service.ts:4315-4331`）只做格式校验不做存在性解析——"从成品继续创作"即便硬塞引用也不产生任何商户可见血缘。
- **全产品唯一真血缘先例在内部执行对象上，且不可导航**：视频分镜 `derivedFromWorkflowId`（`apps/core/src/p1/model-supply/index.ts:2828-2843` 拒自引用 + 同 actor/Work 守卫、`:2852` 一次性写入）属 DurableVideoWorkflow——ADR-0011 已判其降为内部执行审计对象；前端只渲染"来自分镜 vN"纯文本（`video-workflow-panel.tsx:375,393-399`），Work 级 `derivedFrom`（`types.ts:664`）在详情页只是一枚无链接 Badge（`creative-object-page.tsx:225-229`）。成品层"可点回来源、可见被复用"的血缘为 0。
- **票界**：本票=复用命令 + 血缘记录/查询 + 商户可见"从历史成品继续创作并看到来源"。三平台 variants 生成归票 11、版本编辑/回滚归票 12、导出归票 13、手机承载面归票 16、旧 `remix_content` 冻结归票 17；参考解构台/结构继承清单是 CONTEXT.md 另有词条的独立能力，不得借本票冒进。D4 不重开——复用作用于成品、不改文案 3 选 1 单选采用；状态用语只用「创作中 / 可使用 / 需处理」（D14）。

## 现状代码入口（实核 file:line）

- `packages/contracts/src/content-package.ts`（票 01 交付，暂不存在）：冻结的 `reuse_content_package` 命令、`lineage`（reusedFromPackageId）字段、`content_package_lineage` 查询 schema——本票只消费不重定义；实现中发现字段缺口走票 01 冻结变更记录，不静默改。
- `apps/core/src/p1/foundation/application-service.ts:282-303`：`executeModule` seam 幂等（replay / in_progress / 同 key 异 payload `IDEMPOTENCY_CONFLICT`）——复用命令免费继承，禁自造第二套幂等。
- `apps/core/src/p1/operations/foundation-module.ts:433-437,712-724`：命令 case（`accept_creative_asset` 形态）与 query dispatch（`creative_workbench` case 在 `:723`）——新命令/查询各加一个 case 的现成形态。
- `apps/core/src/p1/operations/application-service.ts:5572-5666`：`acceptCreativeAsset` 的 authorize → mutate → `this.audit` + `creationEvent` 全形态参照；票 06 在同一 Application Service 上落 `adopt_into_content_package`，复用方法与其同栖，不新增 seam。
- `apps/core/src/product/product-service.ts:2049-2081`：旧 remix 反面教材（克隆 + 洗白 + audit-only 血缘）——本票**不改它**，旧路径维持原样，冻结归票 17。
- `mkfast-template-main/src/routes/dashboard/content.tsx:100,546-556`：旧内容库读源与旧「做同款」入口——随票 07 切换退出主路径，本票不碰；商户用语「做同款」（`project.inlang/messages/zh.json` 的 `dashboard_content_remix`）保留复用到新动作上。
- `apps/core/src/p1/model-supply/index.ts:2828-2843`：分镜血缘域守卫先例（自引用拒绝在 `:2832-2834`）——守卫形态可借鉴；对象错层，不得直接挪用为成品血缘。
- `apps/core/src/p1/operations/postgres-repository.ts:236-245`：`p1_creative_contents` 的 jsonb 模式与表达式索引先例——票 01 的 `p1_content_packages` 沿用，被复用反查索引照此落。
- `packages/contracts/src/uiux.ts:373-384`：`requiredP1Capability`——`reuse_content_package` 走默认 `content.create`、`content_package_lineage` 走默认 `workspace.read`，零改动。
- `mkfast-template-main/src/routes/api/core/p1/commands.ts` / `query.ts`：BFF 通用 module+action 代理——零新路由。
- 测试形态：`apps/core/src/p1/operations/application-service.test.ts:24-46`（Memory repo + Recorded adapters，直调 service 外部行为）。

## 改造方案（步骤级）

垂直切片：合同核对（contracts）→ 域守卫与血缘构造（core domain）→ Application Service 命令/查询 → 注册与授权 → 持久层反查 → BFF/UI 复用动作与血缘展示 → 契约测试与留证。

1. **合同核对（`packages/contracts/src/content-package.ts`，票 01 冻结版）**：逐字段核对 `reuse_content_package` payload（`sourcePackageId` + workspace-scoped idempotency key；冻结版若含可选 versionId 则实现为"显式所选版本"，缺省=来源 `currentVersionId`）与 `lineage.reusedFromPackageId`；核对 `content_package_lineage` 返回形状=向上来源链（直接来源→根，每级 id/标题/kind/用户可见状态/createdAt）+ 向下直接子代（被复用列表）。缺字段走冻结变更记录并通知票 01/07 负责人，不得静默扩。
2. **域规则（`apps/core/src/p1/operations/content-package.ts`，票 01 落的域层内追加）**：
   - 受理守卫：来源须同 workspace 存在；仅「可使用」组（review_ready/accepted）受理复用；`rights.state=revoked` 或 needs_replacement → `REUSE_SOURCE_REVOKED` conflict——撤权语义传导到复用，堵死"复用绕道洗白"（旧 remix `:2076-2077` 的病根）；其余态 conflict 带规范化类别。与票 01 冻结文本冲突时走冻结变更记录，不各自解释。
   - 新包构造：新 id、kind=来源 kind、`lineage.reusedFromPackageId` 创建时一次性写入且此后不可变（转换表无任何事件可改它，自引用拒绝形态同 `index.ts:2832-2834`）；v1 种子=来源当前版本 title/body/orderedAssetIds（**引用**同一批 owned Asset，不复制字节、不造第二 Asset）+ source facts 引用继承；`childRuns`、variants、`exportReceipts` 全空——血缘是引用不是拷贝。种子齐备落 review_ready（可使用起点），引用素材已永久删除仅剩 tombstone → needs_input（需处理），不静默丢弃（对齐 spec §5 解析失败同款语义）。
3. **Application Service 命令/查询（`application-service.ts` 追加，不碰既有方法）**：`reuseContentPackage(context, input)`——authorize → 读源 → 域守卫 → 新包落库 + `this.audit('content_package.reused', ...)`（含来源与新包双 id）+ `creationEvent`；幂等经 seam，同 key replay 返回同一新包。`getContentPackageLineage(context, packageId)`：向上链有界（深度上限 20，超限截断并标注）+ 向下子代按 createdAt 排序；内容库列表/详情投影补「复用自」摘要与「被复用 N」计数——票 07 列表项预留的"来源血缘摘要"槽位在此接实。
4. **注册与授权**：`foundation-module.ts` 命令 switch 与 query switch 各加 1 case（照 `:433-437` / `:723` 形态）；`uiux.ts` 零改动（默认映射即正确）。
5. **持久层**：票 01 的 `p1_content_packages` jsonb 模式够用，零建表；被复用反查先以 payload 查询 + 契约测试锁行为，出现真实列表量证据再加 `(workspace_id, (payload->'lineage'->>'reusedFromPackageId'))` 表达式索引（纯加法，模式照 `:236-245`），不提前优化。
6. **BFF/前端（挂票 07 的内容库卡与详情面）**：
   - 「可使用」成品卡/详情加主动作「做同款」（沿用商户既有用语，语义=复用为新创作）：点击 → BFF 通用代理发 `reuse_content_package`（幂等键=点击时生成）→ 成功导航到新包详情作为继续创作起点（版本编辑面归票 12、「生成三平台版本」归票 11 的既有入口），并按「受信返回锚」携带来源上下文可回。
   - 新包详情顶部「复用自〈来源标题〉」**可点击**链接回来源详情；来源详情加「被复用」区（子代列表：标题/三态/时间，逐条可入详情）。对照反例：`creative-object-page.tsx:225-229` 无链接 Badge、`video-workflow-panel.tsx:393-399` 纯文本——血缘必须可导航，不是装饰徽章。
   - 已撤权/需处理来源：复用动作禁用 + 中文说明（「权利已撤回，无法复用」）；状态徽章唯一来自票 01 `contentPackageStatusGroup` 纯函数，不自算第二套映射。
   - 核验新内容库与新详情面零 `remix_content` 引用（防双复用通道并存）。
7. **契约测试与留证（打 Application Service 外部行为，照 `application-service.test.ts:24-46` setup）**：复用成功（新包 kind/v1 内容/lineage 正确、列表立即可见，来源 versions/variants/exportReceipts 逐项断言未变）；A→B→C 两跳链血缘查询（C 向上=B→A、A 子代含 B、深度截断行为）；撤权阻断（revoke 后复用 → conflict、零新包——旧 remix 洗白行为的防回归测试）；幂等（同 key replay 返回同一新包且列表数量不变，同 key 异 payload → `IDEMPOTENCY_CONFLICT`）；workspace 隔离（B 工作区复用不了 A 的包、查不到 A 的血缘）；不吞并（新包 versions 恰 1、回执与 childRuns 空）。`postgres-repository.test.ts` 扩真实事务血缘持久化与反查。证据落 `docs/evidence/contentpackage/ticket-14/`。测试是工程护栏，不是关票理由。

## DoD（全部必须是用户可见行为）

- **复用即刻可见（主对照证据，当前 vs 改造后）**：商户在真实 dev 环境（真实 Postgres，非 fixture）的内容库对一个「可使用」成品点「做同款」→ 内容库立即出现一个新成品，点开详情=来源当前版本的文案 + 同组有序图为起点，可直接继续编辑（票 12 面）与生成三平台版本（票 11 面）。对照当前：旧「做同款」克隆写旧事实源、新卡片与来源之间零可见关联，商户复用两次后已分不清哪条从哪来。改造前后录屏/截图各一份落 evidence。
- **血缘双向可见**：新成品详情显示「复用自〈来源〉」且可点回来源；来源详情显示「被复用」列表并含新成品；A→B→C 连续复用后，C 的详情能看到直至根的来源链。对照当前：来源关系只存在于审计日志（`product-service.ts:2079`），商户任何界面不可见。
- **撤权不可绕道**：对已撤权成品，复用动作禁用并给出说明；强行经命令通道提交得到明确 conflict 而非新成品——对照当前 remix 把合规态硬置 `'clear'` 的洗白行为（`:2076`）。
- **复用不吞并历史**：复用后打开来源详情，其版本历史、三平台版本、导出记录原样完整；新成品从自己的 v1 开始、导出记录为空——"血缘是引用不是拷贝"在两份详情并排可见。
- **重复动作不产生重复成品**：同一幂等键重放复用命令，内容库成品数量不变。
- 全程状态用语只出现「创作中 / 可使用 / 需处理」，无内部状态码泄漏。
- **关票边界（禁止项）**：不得以"命令注册""血缘字段落库""fixture 绿"关票——必须真实运行服务上从内容库出发的完整 UI 操作留证（复用 → 编辑起点 → 血缘双向回看）三段齐备。本票关闭 ≠ 真实链路完成：北极星"真实跑通链路数"仍由票 22（D01 硬 Gate）计数；对外口径受 ADR-0011 约束，迁移与真实验收完成前不得宣称已上线。

## Blocked-by / Blocks

- **Blocked-by**：票 11（decision-ticket-map 登记的直接前置，经其传导 01→06→07 链：票 01 合同冻结是全局 gate 且 `reuse_content_package`/`content_package_lineage`/`lineage` 字段以其冻结版为准；票 06 才有可复用的真实成品；票 07 的内容库/详情面是复用动作与血缘展示的商户可见容器）。票 12/13 同波次相邻非前置——复用只读来源 `currentVersionId` 与既有事实，不依赖编辑/导出命令。
- **Blocks**：无直接下游票（map 零登记）。但本票与 11/12/13 共同构成 E4 建设面（X-THREE-VARIANTS-EDITABLE 必达合同）——按 ADR-0009 单发布闸，缺一不面世；票 17 迁移差异校验须覆盖复用血缘（spec `:193`），其对账口径消费本票的血缘投影（协调项，非硬阻塞）；票 16 手机侧的血缘可见以本票查询为同一数据源。

## 风险与回退

- **血缘链环与深链**：构造上无环——lineage 创建时一次性指向已存在的包、此后不可变，自引用在域守卫拒绝（形态同 `index.ts:2832-2834`）；深链查询有界 + 截断标注，先 jsonb 逐级查、有量级证据再优化，不提前上递归 SQL。
- **复用语义膨胀**：选历史版本复用、跨 kind 复用、字段级结构继承（结构继承清单/参考解构台）全部不做——冻结 payload 之外的选项等真实商户证据走票 01 冻结变更记录；本票只交付"以来源当前版本为起点"。
- **撤权守卫口径争议**：撤权来源是否可"只复用文字、剥离素材"——本票取全阻断（安全侧，与「撤权阻止新导出」同向）；放宽须回票 01 冻结评审记录确认，不在实现中途各自解释。
- **洗白回潮**：新包 rights 初始 authorized 的前提=来源可使用且素材可解析；域守卫 + 撤权阻断防回归测试锁死——旧 remix 的 `'clear'` 重置模式是明令禁止复刻的病根。
- **双复用通道并存**：迁移完成前旧页面「做同款」仍指 `remix_content` 写旧事实源。控制：新内容库唯一复用入口发 `reuse_content_package`；旧命令冻结归票 17，期间旧入口随票 07 切换退出主路径；本票核验项=新库零 `remix_content` 引用。
- **幂等旁路**：复用若绕过 `executeModule` 自写去重会造第二套真相；禁止该旁路，契约测试显式断言 replay/conflict 来自 seam 既有机制。
- **回退**：命令/查询注册、UI 动作、反查索引全部纯增量，revert 即回票 11/12/13 交付态；已产生的复用包与血缘是既成事实，保留不删不改写（新系统产生的事实由新 Owner 保有，同「模型供应入口回滚」语义）。
