# 票 17 · 旧三套迁移只读 + 切换 + 回滚
> 建设面: D06 单向迁移 ｜ 决策: DEC-LEGACY-READ-ONLY ｜ Blocked-by: 07, 08

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "17",
  "decisionIds": [
    "DEC-LEGACY-READ-ONLY"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-SPLIT-FACTS"
  ],
  "contractIds": [],
  "blockedBy": [
    "07",
    "08"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **D06 已拍板"只迁移只读、不再双写"，但旧三套写路径今天全部活着（confirmed，逐条实核）**：
  - 旧 Product `ContentItem`：`apps/core/src/product/product-service.ts` 里仍有一整排创建/改写 `state.contents` 的活命令——`generate_copy`（`:1917`，`:1074` push 3 候选）、`select_content`（`:1924`）、`create_douyin_variant`（`:1933`）、`quick_edit`（`:1963`）、`undo_edit`（`:1984`）、`revert_to_ai`（`:1993`）、`create_weekly_set`（`:2000`，`:2041` push 卡片）、`remix_content`（`:2049`，`:2078` push 克隆）、`abandon_content`（`:2082`）。移动端 UI 仍在直发其中两个：`mkfast-template-main/src/product/mobile-action-book.tsx:1263`（select_content）、`:1485`（quick_edit）。
  - P1 `CreativeContent`：`accept_creative_asset` 仍注册在 seam 上（`apps/core/src/p1/operations/foundation-module.ts:433-437`）并写 `state.creativeContents`（`apps/core/src/p1/operations/application-service.ts:5641` push；`:5631` 单元素数组）。票 06 把前端主链切到 ContentPackage 后，这条命令依旧可调——不冻结就是 ADR-0011 警告的"收敛一半又长出新分叉"。
  - 独立完成视频：票 08 只接**新**完成（confirm 开包 + 交付落包）；历史 completed `DurableVideoWorkflow` 的成片仍只挂在 workflow 自己身上（`apps/core/src/p1/model-supply/index.ts:3528` 置 completed 后仅存 checkpoint 即 return，`composedAsset` 在 `:2592`），商户的历史视频在新内容库数量恒为 0。
- **迁移工具零存在**：spec §6 拍板的 Migration commands（旧三套 inspect / backfill / 差异校验 / 冻结 / 切换）在 ContentPackage 侧全仓零命中；票 01 只冻结了 `legacySource` 字段合同（sourceType ∈ 旧三套 + sourceId + mappingConfidence ∈ exact/partial/unknown，unknown 不补造），没有任何票落"把旧事实搬进来"的通道。
- **旧数据在新库不可见（商户体感"内容变少"）**：票 07 把 `/dashboard/content` 主列表切到只读 ContentPackage 后，老工作区迁移前的全部内容只剩页面底部"历史内容（只读）"折叠区——票 07 风险第 1 条明确把解药指到本票 backfill。不做本票，老商户的主内容库对自己的历史成品永远是空的。
- **票界**：本票 = 旧三套 → ContentPackage 的**单向迁移全链**（inspect / 可重复 backfill / 差异校验 / 冻结 / 切换 / 回滚）+ 旧数据只读可见 + contract 收缩（删掉"还能往旧三套写成品事实"的最后通路）。不改采用链（票 06）、不改内容库读源与导航（票 07）、不接视频新完成链（票 08）、不做包侧导出/回执（票 13）、不动 Asset 域与授权（ADR-0001 输入事实不变）。
- **锁定边界**：不重开 D4（未被选中的旧候选不迁移成成品，见方案第 4 步）；状态用语只经票 01 冻结的三态映射呈现「创作中 / 可使用 / 需处理」；最高 seam = Product Core Application Service，迁移命令挂现有 seam 的 admin 门禁下，不新增 seam；unknown 字段保持 unknown，不为旧数据补造 provider/model/route/cost 事实（spec §4）。

## 现状代码入口（实核 file:line）

- **旧三套写路径（冻结对象）**：`apps/core/src/product/product-service.ts:1917,1924,1933,1963,1984,1993,2000,2049,2082` 九个成品写命令 case（写点 `:1074,:2041,:2078`，均实核未漂移）；`apps/core/src/p1/operations/application-service.ts:5572-5667` `acceptCreativeAsset`（`:5641` push，ADR-0011 所引 `:5638` 已漂移 3 行，以 `:5641` 为准）。`generate_copy` 与旧 P0 storyboard/video 命令族在 `mkfast-template-main/src` 已零 UI 调用（实核 grep），仅 API 可达。
- **交付台账链（显式不冻结，见方案第 3 步）**：`product-service.ts:2641`（create_handoff）、`:2780`（record_handoff_export）、`:2814`（report_handoff_result）、`:2887`（mark_published）；后两者 published 分支回写 `ContentItem.status`（`:2874,:2916`），是切换后旧库状态漂移的唯一合法来源。UI 活调用：`mkfast-template-main/src/routes/dashboard/content.tsx:377`、`mkfast-template-main/src/routes/dashboard/handoff/$token.tsx:62,133,147,159`。
- **三源存储与读取**：旧 Product 状态经 `apps/core/src/product/relational-product-repository.ts:119-137` `load()`（legacy `product_states` jsonb 基线 + `p1_relation_facts` 重建）——backfill 的第一源读点；P1 `p1_creative_contents` 表（`apps/core/src/p1/operations/postgres-repository.ts:236-245`）——第二源；`model_video_workflows` 表（`apps/core/src/p1/model-supply/postgres-repository.ts:130`，store 类 `:678`）——第三源。目标表 = 票 01 expand 的 `p1_content_packages`。
- **仓内既有单窗切换先例（成熟组件优先，整套形态可复用）**：`apps/core/src/p1/cutover/execution-service.ts:634` `P1CutoverExecutionService`——`:745` plan、`:791` backup、`:862` rehearseRestore、`:994` freeze、`:1058` dryRun、`:1078` backfill、`:1124` activate、`:1214` rollbackFutureWrites、`:1402` inspect，run 级 revision 断言 + backup/restore 演练前置；差异报告形状 `CutoverDifferenceReport`（`:23-60`：countsByKind/状态/版本序/平台/用量分节）。`apps/core/src/p1/cutover/legacy-mapper.ts:16` mappingConfidence（词面为 exact/inferred/unknown，与票 01 冻结的 exact/partial/unknown 有词差——以票 01 合同为准做桥接，不留双词表）。CLI：`apps/core/src/p1/cutover/cli.ts:5-15` 九动作，`apps/core/package.json:12` + 根 `package.json:20`（`pnpm uiux:cutover`）。
- **写属主与冻结既有形态**：`apps/core/src/product/postgres-repository.ts:40` `p1_write_ownership` 表（owner ∈ legacy/frozen/p1）；守卫 `product-service.ts:1183-1266` `requireLegacyWriteOwner`（`:1250` frozen → `COMMANDS_FROZEN` 409）；路由 `apps/core/src/product/cutover-product-service.ts:29`；装配 `apps/core/src/main.ts:412,421`（legacy 与 relational 都是 `ProductService` 实例——守卫加在 `ProductService` 内即双路生效）、`:450-455`、`:534-541`。**该表语义属旧 Product→P1 关系投影切换，本票不复用其行，另立同形态新表**（见风险）。
- **admin 门禁先例**：`apps/core/src/p1/operations/foundation-module.ts:283-293`（adminActorIds + `context.actor !== "admin"` 拒绝）——迁移命令的门禁形态。
- **前端消费点**：票 07 交付的内容库只读历史区与 ContentPackage 主列表（`mkfast-template-main/src/routes/dashboard/content.tsx`，落点以 07 合入产物为准）；`mkfast-template-main/src/product/unified-creation-workbench.tsx:1148-1149` 双源相加计数（07 已改为"包计数 + 旧历史计数"，本票 backfill 后需再收敛一次口径）。
- **稳定 ID 派生先例**：`application-service.ts:5625-5628` `creative-content-` + sha256 截断——迁移包 ID 用同形态从 legacySource 确定性派生，保证 backfill 幂等可重复。

## 改造方案（步骤级）

垂直切片：契约（迁移命令 + 映射规则 + 差异报告）→ Application Service 迁移命令与写属主守卫 → 持久层（属主表 + 迁移事实）→ 前端只读可见与规范化拒绝 → 迁移测试。轴 = "商户的旧内容以只读身份完整出现在唯一内容库，且旧三套从此写不进任何成品事实"。

1. **契约层（packages/contracts，挂进票 01 的 content-package 合同文件旁，不另开体系）**：新增迁移命令 payload schema——`content_package_migration_inspect` / `content_package_migration_dry_run` / `content_package_migration_freeze` / `content_package_migration_backfill` / `content_package_migration_activate` / `content_package_migration_rollback`，查询 `content_package_migration_status` / `content_package_migration_report`。差异报告形状按 spec §9 七项分节：对象数（按源分 countsByKind）、稳定 ID（missing/unexpected/mismatched）、状态、内容版本序、Asset receipt（assetIds 与成片 objectKey 可解析性）、三平台 variant、复用血缘。全部命令要求 workspace-scoped idempotency key + runId，同 key 异 payload 返回 conflict（沿 seam 既有幂等，不自造第二套）。
2. **映射规则表（合同即代码，随差异报告可审计）**：
   - 旧 `ContentItem`（`packages/contracts/src/product.ts:117-130`）：**迁移范围 = `selected === true` 或 status ∈ draft/published/abandoned**；`status === 'candidate'` 且未选中的两条落选候选**不迁移**（D4 不重开——未采用的候选不是成品，留在旧库作只读证据）。kind 判定：`artifactId` 可解析出已持久 `VideoArtifact` → `video`（P0 成片），否则 `image_text`。状态映射：selected candidate → review_ready、draft → accepted、published → accepted（发布事实经交付台账链可查）、abandoned → cancelled。variants（xiaohongshu/douyin）逐平台带 versions 序与 currentVersionId 迁入包 variants；video_account 旧库不存在，缺位不补造。`remix_content` 的 audit 事实（`content.remixed` + sourceId）映射进 lineage.reusedFromPackageId，源未迁移时 mappingConfidence=partial。
   - P1 `CreativeContent`（`apps/core/src/p1/operations/types.ts:731-741`，status 仅 'accepted'）：→ kind=image_text、accepted，title/body/assetIds 构成首版本，workId/jobId 进 childRuns（runType=creative_job）。
   - 完成视频：`model_video_workflows` 中 `status='completed'` 且有 `composedAsset` 且**未被票 08 新链落包**（以 childRun workflowId 去重）→ kind=video、accepted，composedAsset（owned objectKey，禁临时 URL）为 generated asset + 首版本；运行中/待选镜的历史 workflow 不迁移——它们完成时会经票 08 的交付落包端口自然落包。
   - 每个迁移包写 `legacySource`（sourceType/sourceId/mappingConfidence，字面以票 01 冻结合同为准）；包 ID = `content-package-` + sha256(workspaceId + sourceType + sourceId) 截断，确定性派生保证可重复 backfill 幂等 upsert；provider/model/route/cost 未知的保持 unknown。
3. **Application Service 迁移命令 + 写属主守卫（apps/core）**：
   - 新建 `ContentPackageMigrationService`（operations 域），run 生命周期照 `P1CutoverExecutionService` 形态：plan/inspect → dry-run（产差异报告不写包）→ backup + restore 演练（旧三套快照，activate 硬前置）→ freeze → backfill（可重复）→ 差异校验 → activate → rollback。命令经 `OperationsFoundationModule` 注册并走 adminActorIds 门禁（`:283-293` 形态）；同时提供 CLI driver（照 `cutover/cli.ts` 九动作 + 根 package.json 脚本形态，如 `pnpm contentpackage:cutover`），CLI 只是 seam 的调用方，不旁路业务规则。
   - 新表 `content_package_write_ownership`（workspace_id PK / owner ∈ legacy|frozen|contentpackage / updated_at，照 `p1_write_ownership` `:40` 形态但**独立成表**，不与旧 Product→P1 切换的属主行混叠）。
   - 冻结守卫：`ProductService` 内新增 `requireLegacyContentWrite`（照 `requireLegacyWriteOwner:1183` 形态），挂在九个成品写命令 case 前——frozen → `CONTENT_COMMANDS_FROZEN`、contentpackage → `LEGACY_CONTENT_READ_ONLY`（409，规范化错误信息给出"旧内容已迁移为只读历史，请到内容库的新成品上操作"与新入口路径）；`acceptCreativeAsset` 加同一守卫（operations 侧读同一属主表）。legacy/relational 两个 `ProductService` 实例（`main.ts:412,421`）经同一守卫双路生效。
   - **交付台账链显式例外（不冻结）**：create_handoff / record_handoff_export / report_handoff_result / mark_published 与 lead/insight 继续对旧内容可用——它们是 L3 发布阶段与台账对象，不产生新成品事实；冻结它们会在票 13/15 包侧导出未就绪时掐断商户对既有内容的交付。其对 `ContentItem.status='published'` 的回写（`:2874,:2916`）用**单向 re-backfill 同步**收口：重跑 backfill 时，仅当迁移包在新系统无后续写（版本数仍为迁移首版、无 variant 编辑/导出）才同步状态到包；包已有新事实则只记入差异报告人工裁决，绝不静默覆盖——与"回滚不覆盖新事实"同一原则。该例外与移除条件（票 13/15 完成包侧导出与合规链后随 D18 收口）写进迁移 runbook。
4. **切换与回滚语义（spec §9 逐条落地）**：activate 前置 = backup 存在 + restore 演练通过 + 最新差异报告七项差异数为 0；activate 把 owner 置 contentpackage，旧三套自此只读。rollback 仅把 owner 拨回 legacy（恢复旧写命令受理）并冻结迁移 run；**新系统已产生的 ContentPackage、版本、导出回执原样保留、继续由新 Owner 恢复与可查，不用旧快照覆盖新事实**；re-activate 后 re-backfill 以 legacySource 幂等 upsert，不重复包、不覆盖商户在包上的新编辑。
5. **前端只读可见（消费票 07 的页面骨架）**：
   - backfill 后，商户旧内容以 ContentPackage 身份进入内容库主列表（票 07 的查询自然返回，本票不改查询合同），成品卡与详情显示来源徽标「历史迁移」+ legacySource 摘要；mappingConfidence=partial/unknown 的字段显示「部分来源信息未知」，不补造。
   - 票 07 的"历史内容（只读）"折叠区每条旧 content 增加「已迁移 · 查看新成品」链接（经 legacySource 反查映射），点击跳到同一迁移包详情——旧→新是同一份真相的两个视图；未迁移的落选候选不出现该链接。
   - 残余旧写入口（`mobile-action-book.tsx:1263,1485` 等，票 16 前仍在）触发冻结后收到规范化状态标签形态的错误提示与新入口指引，不白屏、不静默失败；`unified-creation-workbench.tsx:1148-1149` 计数在 backfill 后复核一次，防止旧历史计数与迁移包重复计入导致示例店可见性误判。
6. **迁移测试（打 Application Service 外部行为，spec Testing Decisions"Migration tests"逐条）**：a) dry-run 产出七项差异报告且不写包；b) backfill 幂等——同源重跑包数量不变、versions 不重复；c) 差异校验——人为制造缺对象/错状态/乱版本序/丢 receipt/缺 variant/断血缘，报告逐项命中；d) freeze 后九命令 + accept_creative_asset 返回规范化 409，交付台账链仍可用；e) activate 后旧写保持拒绝、迁移包与票 06 新采用包并存于同一列表查询；f) **回滚不覆盖新事实**——activate 后新建包/编辑版本，rollback，断言旧写恢复受理且新包、新版本、legacy 包全部原样可查；g) 落选候选不迁移、workspace 隔离、published 状态 re-backfill 单向同步与"有新写只记差异"。真实 Postgres 事务沿既有 repository test 形态。测试是工程护栏，不作关票依据。

## DoD（全部必须是用户可见行为）

- **老商户旧内容回到唯一内容库（主对照证据，当前 vs 改造后）**：取一个迁移前已有内容的真实工作区（含旧图文、已发布内容、至少一条历史完成视频成片），切换前打开 `/dashboard/content` 主列表——旧成品不在主列表、历史视频数量为 0；执行 inspect→dry-run→backup→freeze→backfill→差异校验→activate 后，同一商户刷新同一页：旧图文与历史视频成片全部以成品卡出现在主列表，状态只显示「创作中 / 可使用 / 需处理」，视频卡可点开播放（owned 存储，非临时 URL）。两组录屏/截图 + 差异报告（七项差异 = 0）落 `docs/evidence/contentpackage/ticket-17/`。
- **旧→新同一份真相**：商户在"历史内容（只读）"区点任一条旧内容的「已迁移 · 查看新成品」，到达的成品详情与主列表点开的是同一个 ContentPackage（同 ID、同状态、同组成），来源区可见「历史迁移」与来源摘要；未被采用过的落选候选不会变成成品出现在库里（D4 口径可见）。
- **旧三套从此写不进成品**：切换后，商户在残余旧入口（如移动端旧快捷编辑）操作旧内容，得到明确的"旧内容已迁移为只读历史"提示与新入口指引——不是白屏、不是静默无反应；旧内容本身仍可查看、复制。经 API 直发九个旧写命令或 `accept_creative_asset` 得到规范化 409。对照证据：冻结前同一操作成功写入旧库 vs 冻结后被拒且旧库对象数不再增长。
- **交付不断供**：切换后，商户对既有内容的 L3 交接（二维码转移、复制、导出记录、结果上报）全程可用；上报"已发布"后，内容库中对应迁移包状态正确呈现，且商户在包上已做的任何新编辑不被回写覆盖。
- **回滚演练留证（管理员可见）**：在演练工作区执行 activate → 用票 06 新链再采用一条新成品 → rollback：旧写恢复受理的同时，新采用的包、迁移包及其版本在内容库**全部仍可见可查**——"回滚仅切换入口、不覆盖新事实"以真实操作录屏留证，不以单测绿代替。
- **关票边界（禁止项）**：不得以"迁移脚本跑完""fixture 对账绿""CLI 输出 0 差异"关票——必须有真实工作区的商户视角前后对照 + 差异报告 + 回滚演练三件证据。本票关闭不改变北极星口径：真实跑通链路数仍由票 22 留证；对外不得将迁移完成表述为产品面世（ADR-0009 单发布闸，E1–E6 一起过）。

## Blocked-by / Blocks

- **Blocked-by**：票 07（内容库只读 ContentPackage——backfill 的对账读面与旧数据"回到主列表"的呈现面）、票 08（视频成片进同一 ContentPackage——新完成链成立后才能界定"历史完成视频"的迁移集合并冻结旧终点）。传导前置：01（聚合合同与 legacySource 字段，全局 gate：01 未关本票不得关）、06（采用写包，经 07 传导）。运维排程建议（非机制依赖）：activate 尽量排在票 16 合入后，减少移动端残余旧写入口吃 409 的窗口。
- **Blocks**：不阻塞任何实施票（本票是 expand→migrate→contract 链的 contract 终点；票 22 的最小真实链路 blocked-by 06/09/11，不含本票）。但本票是 E1 建设面"迁移旧三套"的收口件——ADR-0009 单发布闸下，一次面世的 Gate 检查表含本票完成；D18 遗留清理（移除旧三套 legacy evidence 的明确条件）以本票的只读化为起点。

## 风险与回退

- **映射规则争议（最大不确定性）**：candidate 迁移范围、draft→accepted、artifactId→video 判定都可能在实施评审中被推翻。控制：映射规则表进契约常量 + 差异报告首节回显规则版本，dry-run 先行给 07/12/13 负责人签收后才允许 backfill；规则变更走版本化变更记录，重跑 backfill 幂等收敛，不手改数据。
- **属主表语义混叠**：复用 `p1_write_ownership` 会让旧 Product→P1 切换与本次成品切换互相踩（该表 owner 已被 `CutoverProductService:29` 与 `main.ts:534-541` 消费）。控制：独立 `content_package_write_ownership` 表 + 独立错误码；测试断言两套属主互不影响。回退：新表纯增量，revert 即回改造前。
- **交付台账例外被误读成"双写复活"**：mark_published/report_handoff_result 回写旧 `ContentItem.status` 是唯一放行的旧库变更。控制：例外范围白名单写死在守卫里（仅发布结果回写），re-backfill 单向同步 + "有新写只记差异"规则有测试锁死；例外的移除条件（票 13/15 后随 D18）写进 runbook，防止无限期滞留。
- **差异校验过不去（历史脏数据）**：旧库存在断链 assetIds、过期 handoff、半截 storyboard 属正常。控制：差异分"阻断级"（对象数/稳定 ID/版本序错）与"记录级"（receipt 不可解析→包状态映射为需处理并标注，不算阻断）；两轮评审熔断（D04）适用——第三轮要么真跑修复要么标 open 冻结 activate，不降标准放行。
- **冻结窗口体验**：freeze→activate 之间旧写被拒而新库尚未 backfill 完，商户短暂两头不能写。控制：单工作区窗口化执行（run 按 workspace 粒度），freeze 前 dry-run 已过、backfill 幂等可快速重放，窗口以分钟计；封闭付费 Beta 商户逐个排程（Beta 准入审批本就按商户粒度）。
- **回滚被误用成删数据**：回滚只拨属主，绝不删迁移包、不用 backup 快照覆盖新事实（backup 仅用于 restore 演练与灾难恢复旧三套本体）。控制：rollback 命令实现里没有任何 delete 包/版本的路径，测试 f) 断言全量可查。
- **性能与规模**：backfill 逐 workspace 读 `relational-product-repository.load()` 重建全量状态，老工作区大 jsonb 可能慢。控制：按 workspace 分批 + run 可断点重放（幂等 upsert 天然支持）；不为迁移提前上批处理框架，出现真实瓶颈再按证据优化（成熟组件优先）。
