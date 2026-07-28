# 票 07 · 内容库只读 ContentPackage
> 建设面: E1 成品收敛 ｜ 决策: DEC-CONTENTPACKAGE-SOLE, DEC-NAV-COLLAPSE ｜ Blocked-by: 06

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

> 合同变更通知（2026-07-17）：票 01 冻结后的 `needs_replacement` 允许动作已增加 `edit_text`；内容库详情应继续呈现文字抢救入口，但导出/复用仍受撤权守卫阻断。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "07",
  "decisionIds": [
    "DEC-CONTENTPACKAGE-SOLE",
    "DEC-NAV-COLLAPSE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-SPLIT-FACTS"
  ],
  "contractIds": [
    "X-ADOPT-VISIBLE"
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

- **"采用了却看到 0 条内容"（confirmed，spec Problem Statement 第 1 条）**：商户在工作台采用一条文案，写入的是 P1 事实 `state.creativeContents`（`apps/core/src/p1/operations/application-service.ts:5641`，ADR-0011 引用的 `:5638` 已漂移 3 行，现指向该方法内 `workId` 字段行，写入点实为 `:5641` `state.creativeContents.push(content)`）；而内容库页面 `/dashboard/content` 读的是另一套事实 `ProductState.contents`（`mkfast-template-main/src/routes/dashboard/content.tsx:100` `state?.contents.find(...)`，锚点未漂移）。两套事实没有任何桥接，商户采用后打开内容库命中空态渲染（`content.tsx:215-231` WarmEmptyState + 示例画廊），"我的成品去哪了"无解。
- **双源投影拼接（confirmed）**：同一个"内容"概念在不同页面读不同事实源——内容库读 Product `contents`（`content.tsx:136-143`），历史视图读 P1 `creativeContents`（`mkfast-template-main/src/product/canonical-history-model.ts:395`），生成工作台干脆把两源**相加**来算内容数（`mkfast-template-main/src/product/unified-creation-workbench.tsx:1148-1149` `(productQuery.data?.contents.length ?? 0) + projection.contents.length`）。这正是 ADR-0011 判定的病灶："靠投影拼接成看起来像一个内容库"。视频成片是第三套事实（`ProductState.videoJobs/videoArtifacts`，`packages/contracts/src/product.ts:410-414`），根本不进内容库网格。
- **一级导航违反 D07（confirmed）**：商家一级导航当前 6 项 workbench/tasks/assets/content/leads/store（`mkfast-template-main/src/lib/uiux/navigation.ts:5-48`），移动底栏 4+1 项含 tasks（`mkfast-template-main/src/components/product/mobile-nav.tsx:12-33`）。ADR-0011 D07 拍板一级导航只留**创作 / 内容 / 素材 / 门店**，任务与线索退回 owning context。
- **状态用语违反 D14**：内容库只有 drafts/published 两 Tab（`content.tsx:239-248`），既不是 ContentPackage 十条状态契约的内部状态，也不是用户可见三态「创作中 / 可使用 / 需处理」。
- **票界**：票 06 落"采用写 ContentPackage"（命令侧），本票落读侧——内容库、成品计数、导航的唯一事实源切到 ContentPackage；票 08 落视频成片入同一 Package（本票交付 kind 双形态渲染合同，视频入库的用户可见证据由票 08 回挂）；票 17 做旧三套 backfill/冻结/切换（本票不做数据迁移、不删旧命令实现）。
- **锁定边界**：不重开 D4（3 选 1 单选采用不变）；不新增 seam（查询挂现有 Product Core Application Service）；`ContentPackage` 全仓当前零命中（已复核，与 ADR-0011 "真实空白"一致），本票消费票 01 冻结的聚合合同，不自造第二份状态机。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/content.tsx:100`：`state?.contents.find(...)` 定位来源内容，报告所引锚点未漂移；`:136-143` drafts/published 过滤自 `state.contents`；`:144` 交接区读 `state.handoffPackages.at(-1)`；`:215-231` 空态；`:249-264` 两 Tab；`:449-607` ContentGrid 渲染 ContentItem.variants 并暴露旧写命令按钮（create_douyin_variant `:506-527`、quick_edit `:528-545`、remix_content `:546-556`、undo_edit/revert_to_ai/create_weekly_set `:558-603`）。
- `mkfast-template-main/src/product/client.ts:78-110`：`useProductState` 拉 `/api/core/product/state`，BFF 转发到 core `GET /v1/workspaces/:id/state`（`apps/core/src/server.ts:697-703` → `productService.bootstrap`）。
- `packages/contracts/src/product.ts:409`：`contents: ContentItem[]` 是旧 Product 事实投影；写入方为旧文案生成 `apps/core/src/product/product-service.ts:1074` `state.contents.push(...candidates)`。
- `apps/core/src/p1/operations/application-service.ts:5572-5667`：`acceptCreativeAsset` 采用命令，`:5631` `assetIds: [asset.id]` 写死单元素（票 06 改），`:5641` push 进 `creativeContents`；命令经 `apps/core/src/p1/operations/foundation-module.ts:433-437`（`accept_creative_asset`）分发。
- `apps/core/src/p1/operations/application-service.ts:4380-4389`：`getCreativeWorkbench` 把 `creativeContents` 投影为 `contents`（`:4384`）；`:4465-4468` `getCanonicalHistory` 同样投影。查询经 `foundation-module.ts:722-733`（`creative_workbench` / `canonical_history`）分发——这就是现有 Application Service 查询挂点形态，本票的 ContentPackage 内容库查询按同形态挂入，不新增 seam。
- `mkfast-template-main/src/p1/client.ts:99`：`operationsQuery` 是前端 P1 查询封装（打 `/api/core/p1/query`），生成工作台经它拉 `creative_workbench`（`unified-creation-workbench.tsx:423-441`）。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:1148-1149`：示例店可见性用双源相加计数，读源切换后须一并收敛。
- `mkfast-template-main/src/lib/uiux/navigation.ts:5-48`：`BUSINESS_NAVIGATION` 六项；图标映射 `mkfast-template-main/src/config/sidebar-config.ts:32-42`；移动底栏 `mobile-nav.tsx:12-33`；路由常量 `mkfast-template-main/src/lib/routes.ts:29,31,32`（TaskInbox / ContentLibrary / LeadLedger）。
- `mkfast-template-main/src/product/operations-rail.tsx:132`：运营上下文栏已链接 `/dashboard/tasks` 完整收件箱——任务退出一级导航后的 owning-context 入口**已存在**；线索（leads）当前只有一级导航一个入口，收束后需补二级入口。

## 改造方案（步骤级）

垂直切片顺序：契约 → Application Service 查询 → BFF/前端读源切换 → 导航收束 → 测试。每层都以"商户在内容库看到自己的全部成品"这一条行为为轴。

1. **契约层（packages/contracts）**：新增 ContentPackage 内容库查询投影类型——列表项含 `id / kind(image_text|video) / 标题 / 用户可见状态 / 平台 variant 摘要 / 封面引用 / 来源血缘摘要 / createdAt / updatedAt`，详情投影含组成（copy + 有序视觉 / 视频）、版本指针、权利合规态。**用户可见状态由票 01 冻结的十条状态契约单点映射为「创作中 / 可使用 / 需处理」**，映射函数放 contracts 单一实现并导出，前端与测试都消费它——D14 明令"映射不得成为另一套状态机"，禁止任何页面自带第二份映射表。具体文件落点对齐票 01/06 的实际产出（本 brief 不把尚不存在的文件路径冒充现状）。
2. **Application Service 查询**：在票 06 落定的 ContentPackage 模块上新增内容库列表与成品详情查询（workspace-scoped、分页、按 `updatedAt` 降序），经现有查询分发形态挂入（对照 `foundation-module.ts:722-733` 的 `creative_workbench` 形态）。查询只读 ContentPackage 事实，不 join 旧三套、不做兼容拼接——旧数据可见性由第 4 步的只读历史区独立承担，直到票 17 backfill。
3. **BFF/前端读源切换**：`/dashboard/content` 主列表区从 `useProductState().contents` 切换到 ContentPackage 查询（经 `p1/client.ts:99` 的 `operationsQuery` 同形态封装）。列表按三态分组替代 drafts/published 两 Tab（`content.tsx:239-264`）；图文与视频 kind 同列表渲染（视频卡最小形态：封面 + 时长 + 三态，数据由票 08 写入）；成品卡点开进 ContentPackage 详情只读视图（组成、来源、状态；编辑/版本/回滚入口留给票 12 接管，本票不做编辑）。空态判断（`:215`）与页头计数（`:154-157`）改以 ContentPackage 计数为准。QuotaMeter 与 L3 交接区（`:144,268-390`）沿用现有投影不动——交接链属票 13/17 范围。
4. **旧内容降只读历史区**：旧 `state.contents` 不再是主列表，收进页面底部明确标注「历史内容（只读）」的折叠区：保留查看与复制，**不再渲染** quick_edit / create_douyin_variant / remix_content / undo_edit / revert_to_ai / create_weekly_set 等旧写命令按钮（`content.tsx:506-603`）；后端旧命令实现不动、不冻结（票 17 的活）。`unified-creation-workbench.tsx:1148-1149` 的双源相加改为 ContentPackage 计数 + 旧历史计数，保证老工作区不被误判为空而重现示例店。
5. **一级导航收束（D07）**：`BUSINESS_NAVIGATION`（`navigation.ts:5-48`）6 项收束为 创作 / 内容 / 素材 / 门店 4 项；`sidebar-config.ts:32-42` 图标映射与 `mobile-nav.tsx:12-33` 同步（移动底栏 tasks 位撤下、store 补入，中央创建按钮不动）。`/dashboard/tasks` 与 `/dashboard/leads` 的稳定对象地址与页面**保留**（直接输入 URL 仍可达，符合「稳定对象地址」词条）；任务经运营上下文栏既有链接（`operations-rail.tsx:132`）到达；线索在门店页补一个明确的二级入口。不做路由重命名迁移。
6. **测试（打 Application Service 外部行为 + 前端 E2E）**：a) 复现并防回主缺陷——执行票 06 的采用命令后，内容库列表查询立即返回该成品（spec Testing Decisions 第一条"复现并防回采用了看到 0 条"）；b) kind=video 的 Package 出现在同一列表查询（配合票 08 的合同断言）；c) 三态映射全覆盖断言：12 个状态字面量逐一映射、不存在第四种用户可见用语；d) workspace 隔离与分页；e) Playwright：采用 → 跳内容库 → 成品卡可见、一级导航恰为 4 项、`/dashboard/tasks`/`/dashboard/leads` 直达仍可用。测试只作工程护栏，不作为 DoD。

涉及文件：`packages/contracts/src/`（ContentPackage 查询投影 + 三态映射，落点随票 01）、票 06 落定的 ContentPackage Application Service 模块（新增查询）、`apps/core/src/p1/operations/foundation-module.ts`（或票 01 确定的查询分发点）、`mkfast-template-main/src/routes/dashboard/content.tsx`、`mkfast-template-main/src/p1/client.ts`（如需扩查询封装）、`mkfast-template-main/src/product/unified-creation-workbench.tsx`（计数收敛）、`mkfast-template-main/src/lib/uiux/navigation.ts`、`mkfast-template-main/src/config/sidebar-config.ts`、`mkfast-template-main/src/components/product/mobile-nav.tsx`、门店页（线索二级入口）、对应测试与 E2E spec。

## DoD（全部必须是用户可见行为；至少 1 条对照证据）

- 商户在真实 `/dashboard` 工作台采用一条文案（仍是 3 选 1 单选，D4 不变）后打开内容库，**立即**看到这条成品卡，标题与正文与采用的候选一致；不再出现"采用成功但内容库 0 条"的空态。
- **对照证据（当前 vs 改造后）**：同一操作序列（生成 → 采用 → 打开 `/dashboard/content`）各留三帧截图/录屏——改造前"采用成功 → 内容库空态 + 示例画廊 →（同一数据在）历史视图却可见"，改造后"采用成功 → 内容库成品卡即刻可见 → 点开详情为同一对象"。证据存 `docs/evidence/contentpackage/`；对标口径为 CreatOK"我的作品"单一列表（诊断已证其价值=真实闭环，我方此前是投影壳）。
- 每张成品卡的状态只可能是「创作中 / 可使用 / 需处理」三种之一，无 drafts/published、无 12 个内部状态英文码泄漏到用户界面；点开成品详情能看到它的组成（文案 + 有序图，随票 06 的采用形态）与来源。
- 内容库、成品详情、（票 12 起的）编辑与版本入口指向**同一个 ContentPackage 对象**：从内容库卡片进详情、从生成工作台结果进同一成品，两条路径看到同一状态、同一内容（spec User Story 4）。
- 商户在桌面侧栏与手机底栏看到的一级导航恰好是 创作 / 内容 / 素材 / 门店 四项；任务从生成工作台的运营上下文栏一跳可达，线索从门店页一跳可达；直接访问 `/dashboard/tasks`、`/dashboard/leads` 不 404、不重定向丢失。
- 商户的旧内容（迁移前产生的 Product contents）在内容库底部「历史内容（只读）」区仍全量可见、可复制，但不再提供改写类按钮；商户不会经历"升级后旧内容凭空消失"。
- 视频成片入库的用户可见行为由票 08 回挂本合同验证：票 08 完成后，商户在同一内容库看到视频成品卡与图文成品并列，无需去任何第二个列表——本票先以行为测试锁死该查询与渲染合同，不以"合同就绪"单独宣称视频可见。
- 仅后端查询存在、curl 返回、单测/fixture 全绿、或只有截图没有真实 `/dashboard` 操作路径，一律不得关票（D01 口径）。

## Blocked-by / Blocks

- **Blocked-by**：票 01（ContentPackage 聚合合同与十条状态契约冻结——本票的查询投影与三态映射都是它的消费方；MAP 全局规则：票 01 完成前本票不得关票）；票 06（采用写 ContentPackage——否则新读源恒空，本票 DoD 第一条无法成立）。
- **Blocks**：票 17（旧三套迁移只读 + 切换 + 回滚）——contract 收缩以本票完成读源切换为前提，17 的 backfill 差异校验也以本票的 ContentPackage 列表查询为对账读面。
- 本票不阻塞票 22（北极星链路 blocked-by 06/09/11），但票 22 旅程终点"确认 → 内容库"的用户可见留证将直接落在本票交付的内容库上；本票先行完成可让 22 的证据一次到位。

## 风险与回退

- **票 17 前旧数据未 backfill，商户体感"内容变少"**：主列表只读 ContentPackage，老工作区历史内容不在其中。控制：只读历史区全量保留旧 contents 且入口就在同一页；ADR-0009 单发布闸保证该中间态不面世给真实付费商户。回退：读源切换集中在 `content.tsx` 主列表区与查询层，可单独还原为 `state.contents` 主区；已产生的 ContentPackage 事实不回滚、继续由新查询可见（对齐 spec §9"回滚仅切换入口，不用旧快照覆盖新事实"）。
- **三态映射长成第二套状态机**：各页面若自带映射表，D14 即告失守。控制：映射函数在 contracts 单点导出，测试断言 12 个状态字面量全覆盖且 UI 层零本地映射；code review 检查点写进票内验证清单。
- **导航收束破坏可达性**：先补 owning-context 入口（任务栏链接已存在 `operations-rail.tsx:132`，线索入口先落门店页），再撤一级项；E2E 断言两条稳定地址直达。回退：`BUSINESS_NAVIGATION` 数组还原即恢复 6 项，无数据影响。
- **双源相加计数漏改**：`unified-creation-workbench.tsx:1148-1149` 若漏改，示例店可见性误判（新商户采用后示例店提前消失或老商户误现）。控制：计数收敛纳入本票 diff 与测试；全仓 grep `contents.length` 复核无第三处拼接。
- **查询挂点与票 01/06 落点冲突**：本票不预设 ContentPackage 模块文件路径，实施时以票 01 冻结产物为准；若 06 尚未合入，本票的 Application Service 查询与前端切换可在其分支上叠加开发，但 DoD 验证必须在 06 合入后的真实链路上执行，不得用 fixture 数据冒充采用行为。
- **交接区/额度区误伤**：L3 交接包与 QuotaMeter 仍读旧投影属本票范围外；控制：diff 限定主列表与计数，交接区断言现状行为不变（票 13/17 接管其收敛）。
