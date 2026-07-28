# 票 16 · 桌面/手机同一 ContentPackage + 状态机
> 建设面: E5 跨设备 ｜ 决策: DEC-DESKTOP-MOBILE ｜ Blocked-by: 06

> 合同变更通知（2026-07-17）：票 01 冻结后的 `needs_replacement` 允许动作已增加 `edit_text`；移动端与桌面端必须消费同一允许动作集合与同一版本冲突守卫。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "16",
  "decisionIds": [
    "DEC-DESKTOP-MOBILE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-TWO-PRODUCTS"
  ],
  "contractIds": [
    "X-SAME-OBJECT-CROSS-DEVICE"
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

- **桌面与手机是两套产品（confirmed，ADR-0011 Context 第 4 条 + spec Problem Statement 第 4 条）**：同一路由 `/dashboard` 按视口分叉——桌面渲染 `UnifiedCreationWorkbench`、手机渲染 `MobileActionBook`（`mkfast-template-main/src/routes/dashboard/index.tsx:41-50`，分叉条件 `useIsMobile()` 为纯视口/触点判断，`mkfast-template-main/src/hooks/use-mobile.ts:3-11`）。分叉本身不是病——按设备换布局正是 E5 要的形态；病在两侧读写**不同的事实宇宙**。
- **桌面采用结果进不了手机后续（confirmed）**：桌面采用走 P1 `accept_creative_asset`（`unified-creation-workbench.tsx:2356-2360`）写 `state.creativeContents`（`apps/core/src/p1/operations/application-service.ts:5641`）；而手机的轻编辑、结果决策与交接阶段读的是旧 Product `product.state.contents` 与 `handoffPackages`（`mkfast-template-main/src/product/mobile-action-book.tsx:391-400`）——两个集合零交集。商户在桌面采用一条文案后打开手机，交接页命中「暂无已接受内容」空态（`mobile-action-book.tsx:1534-1543`），轻编辑（`:1484-1489` 旧 `quick_edit`）与内容决策（`:1262-1265` 旧 `select_content`）全部只作用于旧事实。ADR-0011 所述"P1 采用结果不能可靠进入手机后续"逐字成立，组件名锚点未漂移。
- **手机"轻编辑"是假编辑且写旧事实**：旧 `quick_edit` 在服务端把固定话术后缀拼进正文（`apps/core/src/product/product-service.ts:1963-1983`，`body: ${version.body}\n${labels[...]}。`），版本只进旧 ContentItem 的 variant 数组，永远进不了 ContentPackage 版本体系。
- **跨设备中继链自身跨宇宙**：手机"回桌面继续"卡片把旧 Product contentId 塞进 `/dashboard/content/$contentId`（`mobile-action-book.tsx:1599-1603`），而该详情页同时 find 两套事实源并把两边 assetIds 合并渲染（`mkfast-template-main/src/product/canonical-history-page.tsx:549-571`）——换设备的落点页本身就是 ADR-0011 判定的投影拼接。
- **唯一已同源的点反证了方向**：3 选 1 文案决策组件 `CopyCandidateSelector` 桌面手机共用同一命令 `accept_creative_asset`（`mkfast-template-main/src/product/copy-candidate-selector-model.ts:204`；手机挂载 `mobile-action-book.tsx:1413-1423`）——凡是打同一 Application Service 命令的面，两端天然同对象同状态。断裂只发生在采用之后的读写面，收敛路径因此明确：手机全部读写切到与桌面相同的 ContentPackage 查询与命令。
- **票界**：票 06 让采用写 ContentPackage（命令侧）、票 07 让内容库与三态映射只读 ContentPackage（桌面读侧）、票 12 落编辑版本命令；本票落**设备维度收敛**——手机的成品读面与写面全部切到同一 ContentPackage + 同一状态机，交付"桌面采用→手机继续"的端到端旅程。L1/L3 发布路线切换与旧交接链不在本票（票 13 导出回执、票 17 迁移接管）；手机拍摄上传素材链（`mobile-upload-session`）已走 Asset 唯一输入源，本票不动。
- **锁定边界**：不重开 D4——手机上的结果决策仍是 3 选 1 单选；D17 手机=轻编辑 + 结果决策、精确版式留桌面，本票不做移动画布、不做全功能对齐（CONTEXT「移动任务面」明令不假装全功能同等）；最高 seam 仍是 Product Core Application Service，本票 Application Service 层**零新增命令/查询**——这正是"设备只改布局"的架构断言本身；状态用语只有「创作中 / 可使用 / 需处理」。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/index.tsx:34-50`：设备分叉点。`:35` `useIsMobile()`；`:38-40` 桌面才有 `view` 搜索参数进历史页；`:41-50` isMobile 三元渲染两套组件。改造后此分叉保留（只改布局），但两侧数据源必须同一。
- `mkfast-template-main/src/hooks/use-mobile.ts:3-11`：`MOBILE_BREAKPOINT = 768` + coarse-pointer 960 两条件——E2E 双视口驱动的依据。
- `mkfast-template-main/src/product/mobile-action-book.tsx:96`：手机三阶段 `action | progress | handoff`；`:281-293` 已有 P1 `inbox`/`creative_workbench` 查询（进行中阶段的 Job 观察走 P1，证明手机接 P1 查询的管道现成）；`:391-400` 交接阶段的 `acceptedContents`/`candidateContents`/`currentContent`/`currentHandoff` 全部读旧 Product 投影；`:1262-1265` 旧 `select_content`；`:1484-1489` 旧 `quick_edit`；`:1534-1543` 空态告警；`:1585-1607` 桌面中继卡（`:1599-1603` 链接构造）；`:536-539` job 命令幂等键为每次点击 `crypto.randomUUID()` 新键。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:2356-2360`：桌面采用命令；`:423-441` 桌面 `creative_workbench` 查询挂法——手机切读源按同形态（`mkfast-template-main/src/p1/client.ts:99` `operationsQuery`）。
- `apps/core/src/p1/operations/application-service.ts:5572-5667`：`acceptCreativeAsset`，`:5631` `assetIds: [asset.id]` 单元素（票 06 改），`:5641` push 进 `creativeContents`（与票 07 复核一致，ADR-0011 所引 `:5638` 已漂移至此）；命令分发 `apps/core/src/p1/operations/foundation-module.ts:433-437`。
- `apps/core/src/product/product-service.ts:1924-1931`：旧 `select_content`；`:1963-1983` 旧 `quick_edit`——两者是手机决策/轻编辑现状的服务端真身，本票后手机不再触达（实现保留，票 17 冻结）。
- `mkfast-template-main/src/product/canonical-history-page.tsx:543-573`：`CanonicalContentDetailPage` 双源 find（`:549-551` P1、`:552-554` 旧 Product）+ assetIds 合并（`:566-571`）——跨设备中继落点的双源残留。
- `mkfast-template-main/src/product/copy-candidate-selector-model.ts:179-204`：两端共用的候选决策模型与 `accept_creative_asset` 命令构造，本票的"结果决策"写通道直接沿用。

## 改造方案（步骤级）

垂直切片顺序：契约 → Application Service 验证性收口 → 手机读面 → 手机写面 → 跨设备中继 → 测试。每层以"桌面采用的成品在手机是同一对象、同一状态、可轻编辑"这一条行为为轴。

1. **契约层（packages/contracts）**：消费票 01 冻结的十条状态契约与票 07 的三态映射单点导出。若"状态 → 商户可执行动作"（哪些状态允许轻编辑 / 结果决策 / 只读 / 需处理恢复动作）尚未单点导出，则在 contracts 补一份由十条状态契约"必须行为"推导的动作映射并导出，桌面手机共同消费——禁止 `MobileActionBook` 自建第二份状态→动作表（D14"映射不得成为另一套状态机"对动作映射同样适用）。具体落点对齐票 01/07 实际产物，本 brief 不把尚不存在的文件路径冒充现状。
2. **Application Service 层（零新增，验证性收口）**：不新增任何命令/查询。工作有二：a) 确认票 07 的内容库列表/成品详情查询与票 12 的编辑版本命令对手机入口等价可用——同 workspace 门禁、同状态机、无 device 参数；b) 手机轻编辑提交遵守 spec §6 写命令合同（workspace-scoped idempotency key + canonical payload hash，同 key 不同 payload 返回 conflict），幂等键按"成品 + 版本基线 + 动作"派生，替换 `:536-539` 每次点击随机新键的形态（随机键在弱网重复点击下会产生重复版本）。
3. **手机读面切换**：`MobileActionBook` 交接与决策阶段的 `currentContent` 等读源从 `product.state.contents`/`handoffPackages` 切到与桌面相同的 ContentPackage 查询（票 07 交付，经 `operationsQuery` 同形态挂 TanStack Query）；成品卡显示三态徽章（contracts 单点映射），组成（copy + 有序视觉 / 视频封面）随票 06/08 的聚合形态渲染；旧 Product contents 上的 `select_content`/`quick_edit` 按钮不再渲染，旧内容在手机降为只读呈现（镜像票 07 对桌面旧写按钮的处理；服务端实现不动）。
4. **手机写面（轻编辑 + 结果决策，D17 边界内）**：a) 结果决策——`CopyCandidateSelector` 保持 3 选 1 单选（D4），随票 06 改造后自动落 ContentPackage，本票断言其手机挂载路径不回归；「需处理」状态的成品在手机提供十条状态契约允许的决策动作（如保留成功子任务、只重试失败项），全部经既有命令，不造新命令。b) 轻编辑——手机提供标题/正文文本级直改（textarea + 保存），提交走票 12 的编辑版本命令，在同一 ContentPackage 上产生新版本；删除假 AI 话术拼接入口；不提供画布/版式编辑，替之以「精确版式回桌面完成」引导。
5. **跨设备中继与稳定地址**：手机"回桌面继续"与桌面侧的成品链接统一指向 ContentPackage 详情稳定对象地址（`/dashboard/content/{packageId}`，路由不分设备、布局自适应）；`CanonicalContentDetailPage` 的双源 find + assetIds 合并（`:549-571`）收敛为 ContentPackage 单源（若票 07 已切详情读源，本票只清移动侧与该页残留；旧 Product id 落明确标注的只读历史呈现，不与 ContentPackage 详情混渲染）。
6. **测试（打 Application Service 外部行为 + 跨设备 E2E）**：a) seam 测试：同一 workspace 下"采用 → 列表/详情查询 → 编辑版本 → 详情查询"命令序列结果与调用场景无关；轻编辑幂等（同 key 同 payload 只产生一个版本、同 key 不同 payload conflict）；状态→动作映射对 12 个状态字面量全覆盖、无第四种用户用语。b) Playwright 跨设备旅程（`useIsMobile` 是视口判断，单 spec 可双视口驱动）：桌面视口采用 → 切手机视口（<768px 与 coarse-pointer 两分支各跑一次）刷新 → 同 packageId 同三态状态可见 → 手机轻编辑保存 → 切回桌面视口 → 同成品新版本可见、版本历史连续。测试只作工程护栏，不作为 DoD。

涉及文件：`packages/contracts/src/`（状态→动作映射，落点随票 01/07）、`mkfast-template-main/src/product/mobile-action-book.tsx`（读写面切换主体）、`mkfast-template-main/src/product/canonical-history-page.tsx`（详情单源收敛）、`mkfast-template-main/src/product/copy-candidate-selector-model.ts`（如需对齐票 06 后的命令形态）、`mkfast-template-main/src/p1/client.ts`（如需扩查询封装）、`mkfast-template-main/src/routes/dashboard/index.tsx`（仅确认分叉不携带数据差异，预计零改或极小改）、对应 seam 测试与 Playwright spec。Application Service 与 core 侧预期零业务改动（幂等语义已在票 01/06/12 合同内）。

## DoD（全部必须是用户可见行为；至少 1 条对照证据）

- 商户在桌面工作台采用一条文案（+多图，随票 06 形态；仍是 3 选 1 单选，D4 不变）后，打开手机上的产品，在手机上直接看到**同一条成品**：同标题、同组成、同「创作中 / 可使用 / 需处理」状态；不再出现"桌面已采用、手机却提示暂无已接受内容"。
- **对照证据（当前 vs 改造后）**：同一操作序列（桌面采用 → 手机打开 `/dashboard` 决策/交接阶段）各留三帧截图/录屏——改造前"桌面采用成功 → 手机空态告警（`mobile_action_no_accepted_content`）→ 手机轻编辑无对象可编"，改造后"桌面采用成功 → 手机同成品同状态 → 手机轻编辑生效"。至少一组用真机（非仅 DevTools 视口模拟）录制，存 `docs/evidence/contentpackage/`。
- 商户在手机改标题/正文并保存后，回到桌面刷新，看到同一成品出现新版本、版本历史连续（回滚入口在桌面，票 12 交付）；全程两端状态徽章一字不差，对象 ID 与详情地址一致。
- 商户在手机完成 3 选 1 结果决策后，成品同时出现在手机与桌面的同一内容库，无需任何手工"同步"动作；「需处理」成品在手机能执行十条状态契约允许的决策动作且不重复计费、不重做成功子任务。
- 手机上不出现画布/精确版式编辑入口；出现的是明确的「精确版式回桌面完成」引导，其链接（复制到桌面打开）直达**同一成品**的详情稳定地址，不落首页、不落旧事实详情页（D17 + 稳定对象地址词条）。
- 状态用语两端一致且仅有三态；12 个状态英文码、Work/Job/Asset/模型/RouteSnapshot 等技术对象不出现在手机一级界面（D07/D14）。
- 商户的旧内容（迁移前旧 Product contents）在手机仍可见但为只读；不会经历"升级后手机上旧内容凭空消失"，也不再被引导对旧事实做写操作。
- 仅组件渲染截图、仅视口模拟绿、仅 fixture 数据演示、或后端查询可用但真实手机旅程未走通，一律不得关票（D01 口径）。

## Blocked-by / Blocks

- **Blocked-by**：票 01（十条状态契约冻结——状态与动作映射的事实源；MAP 全局规则：票 01 完成前本票不得关票）；票 06（采用写 ContentPackage——否则手机新读源恒空，DoD 第一条无法成立）；票 07（内容库/详情查询 + 三态映射单点——手机直接消费同一查询与映射，不自建投影）；票 12（编辑版本命令——手机轻编辑的唯一写通道）。06/07/12 未全部合入时，本票可在其契约分支上叠加开发，但 DoD 验证必须在合入后的真实链路上执行，不得用 fixture 冒充跨设备行为。
- **Blocks**：ADR-0009 单发布闸的 E5 建设面——六建设面一起通过才发布，本票不完成整个产品不得面世；票 11-15（三平台 variants/导出/复用/合规烧录）的产出在手机侧的可见承载面由本票提供（其桌面交付不被本票阻塞）；票 22 主链路（桌面端到端）不被本票阻塞，但"换设备同一成品同状态"的扩展留证以本票为前提。

## 风险与回退

- **移动面漂成第二产品或全功能对齐**：轻编辑容易滑向移动画布与完整工作台复刻，违反 D17 与 CONTEXT「移动任务面」。控制：本票 diff 审查点=手机新增写动作只有"文本级编辑版本 + 既有决策命令"两类，任何更多移动编辑能力须另开票。回退：撤手机写面新入口即可，读面同源不撤。
- **状态/动作映射长成第二套状态机**：手机若自带映射表，换设备"同状态"即告失守。控制：映射在 contracts 单点导出，测试断言 12 个状态字面量全覆盖且 `MobileActionBook` 零本地映射表；code review 检查点入票。
- **票 01/06/07/12 落点冲突**：本票不预设 ContentPackage 模块与详情视图文件路径，实施以其冻结产物为准；若 07 已完成详情页单源化，本票第 5 步缩为移动侧残留清理，不重复动同一文件。
- **旧内容在手机失去操作入口引发困惑**：`select_content`/`quick_edit` 撤下后旧内容只读。控制：与票 07 桌面口径一致（明确标注只读历史）；票 17 backfill 后自然消解。回退：手机读源切换集中在 `MobileActionBook` 的数据 hook 与卡片渲染，可独立还原为旧投影；已产生的 ContentPackage 版本事实不回滚、继续由新查询可见（spec §9"回滚仅切换入口，不用旧快照覆盖新事实"）。
- **视口模拟测试假绿**：Playwright 视口/触点模拟与真机（safe-area、coarse pointer、弱网）行为可能不一致。控制：DoD 强制至少一组真机证据；E2E 覆盖 `use-mobile.ts:3-11` 的两个分叉条件；弱网重复点击保存场景由幂等测试兜底。
- **幂等键派生错误导致重复版本或误吞编辑**：键派生过粗会把两次不同编辑判为重复，过细则失去防重。控制：按"成品 + 版本基线 + 动作 + canonical payload hash"口径与 spec §6 对齐，seam 测试同时断言"重复提交不重复建版"与"内容变更能建新版"两向。
- **中继地址回归双源**：详情页若保留双源 find，旧 id 与新 id 解析到不同宇宙，换设备落点再次分叉。控制：详情单源化纳入本票 E2E 断言（ContentPackage id 单源渲染、旧 Product id 只落只读历史呈现）；全仓 grep `product.state?.contents.find` 复核无第三处混渲染。
