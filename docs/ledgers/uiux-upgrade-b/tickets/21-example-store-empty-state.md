# 票 21 · 示例美甲店空态渲染（后端已备零消费）+ spec 对齐
> 阶段: Phase 4 · 开场与骨架 ｜ 差距: P2-3 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "21",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P2-3"
  ],
  "contractIds": [
    "I01"
  ],
  "blockedBy": [
    "03"
  ],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P2-3（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:234`）确认：只读“弥鹿美甲示例店”已进入 `ProductState`，前端却零消费；E0 仍明确告诉用户“没有示例”，与 P0 spec 的首次价值承诺冲突。
- 该缺口同时命中根因二、三：验收曾停在“能力存在”，且后端状态与主工作台呈现断层（差距报告 `:24-26`）。本票只修示例终态的主路径接线与口径，不扩成新 onboarding 系统。
- P0 spec 当前口径明确且无需重开：首次用户应看到只读示例店与高质量示例内容（`:38-39`）；示例含完整档案、4 份已授权素材、3 张内容卡、1 个发布包，并且只读、不计用量、可隐藏（`:161`）；示例旅程不得与正式 workspace 数据混写（`:323`）。
- 票 03 已裁决 `exampleStore` 为“接线”：只在真实 E0 且 `hidden=false` 时展示；“做同款”只带入必要结构，不把示例门店、价格或素材复制成真实事实（`.scratch/uiux-upgrade-b/tickets/03-built-unwired-adjudication.md:24,36`）。
- 锁定边界：保留 D3“对话式外壳、结构化内核”，示例采用工作台内结构化终态预览，不做 chat clone；D4 仍是 3 选 1 单选；本票不新增链接抓取、不触碰 L-1 de-scope，也不引入任何跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `apps/core/src/product/product-service.ts:109-134`：`initialState` 建立“弥鹿美甲示例店”，含只读/隐藏标志、杭州·透亮猫眼·确认价 ¥299、4 个授权素材预览、3 个内容预览和 1 个发布包预览；报告锚点 `:113` 仍准确。实核纠偏：当前 `profile` 只是城市/项目/确认价摘要，素材与内容预览也只有标签/标题，没有媒体 URL，不能把报告中的“完整档案”误写成前端可展开的全量档案。
- `apps/core/src/product/product-service.ts:191-197`：状态归一化会保留 `exampleStore`；`:1793-1795` 的 `hide_example` 写入隐藏状态并记录可见性变更。
- `packages/contracts/src/product.ts:388-404`：`ExampleStore` 与 `ProductState.exampleStore` 已包含页面所需字段；`:484-485` 已有 `hide_example` 命令。`packages/contracts/src/product-schema.ts:86-87` 已校验该命令。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:109-117,238-241`：工作台已请求完整 `ProductState`；`:271-284` 只消费真实素材作为来源，当前文件仍零 `exampleStore` 命中。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:481-483,531-540`：无 Work 时直接进入“一句话开工”，只按真实来源标记 E0/E1；`:678-686` 跳过后明确渲染“这里没有示例 Task、Work、Asset 或 Content”。报告锚点 `:682` 仍准确。
- `mkfast-template-main/src/product/client.ts:73-97` 与 `mkfast-template-main/src/routes/api/core/product/commands.ts:4-8`：现有 typed command 路径可执行隐藏动作，无需新建平行端点。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts:109-140`：现有 E0 旅程只断言空对象与跳过后的空页，尚未覆盖示例可见、只读、不计量、隐藏和不混写。
- 旧口径漂移位于 `.scratch/creatok-uiux-wayfinding/issues/14-lock-cold-start-onboarding.md:31-38`、`.scratch/creatok-uiux-wayfinding/assets/14-cold-start-onboarding-prototype-record.md:18-22`、`.scratch/creatok-uiux-wayfinding/assets/13-uiux-acceptance-matrix.md:29-40` 及 `.scratch/creatok-uiux-wayfinding/map.md:40`：它们把“不注入 canonical 示例事实”写成了“不展示示例”。

## 改造方案（步骤级 + 涉及文件清单）

1. 在 `UnifiedCreationWorkbench` 汇总真实 E0：Task、Work、Asset、Content 均为空，相关查询已成功，且 `exampleStore.hidden=false`；加载中、查询失败或 E1 不抢先闪出示例。
2. 保留“一句话开工”为唯一主动作，在其下方增加次级“先看一个做好的例子”终态区：显示只读/零消耗标识、门店档案摘要、4 份授权素材、3 张内容卡和发布包；直接映射 `exampleStore`，不复制为 canonical 列表项，也不以假缩略图补齐当前合同没有的媒体。
3. 为每张示例内容提供单选聚焦与“看示例·做同款”次动作；点击后只把内容角度/结构预填进现有意图框，仍须用户点击“建立创作记录”才创建 Work，不带入“弥鹿”、¥299 或示例素材为本店事实。
4. “隐藏示例”复用 `hide_example`；成功后刷新同一 ProductState 并移除示例区，刷新/重登不再自动出现。失败时保留示例并给可重试说明，不用本地假成功遮蔽服务端状态。
5. 一旦出现任一真实 Task/Work/Asset/Content，示例区退出主工作台，且不出现在真实历史、资产库、内容库、数量统计或来源 chips 中；真实 E0 对象边界继续成立。
6. 改写当前 E0 用户文案，移除“E0”“对象”“这里没有示例 Task/Work/Asset/Content”等工程术语；示例区与开场共同保持 D3 的结构化记录形态。
7. 对齐文档但保留历史：在已关闭 issue/原型记录追加“由 ADR-0010/P2-3 修正”的说明，不抹掉 2026-07-12 的历史选择；将验收矩阵 C01 与 map 摘要改为“可展示只读示例投影，但不得注入/复制 canonical 事实”。P0 spec 已是正确口径，不改写。
8. 扩充现有 E0 浏览器旅程，覆盖首次可见、做同款预填、隐藏持久、产生真实对象后退出，以及桌面/390px 两种布局；断言仍围绕用户看到与操作到的结果。

涉及文件清单：

- 主实现：`mkfast-template-main/src/product/unified-creation-workbench.tsx`；复用命令封装时仅收窄修改 `mkfast-template-main/src/product/client.ts`。
- 旅程验证：`mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`。
- 口径对齐：`.scratch/creatok-uiux-wayfinding/issues/14-lock-cold-start-onboarding.md`、`.scratch/creatok-uiux-wayfinding/assets/14-cold-start-onboarding-prototype-record.md`、`.scratch/creatok-uiux-wayfinding/assets/13-uiux-acceptance-matrix.md`、`.scratch/creatok-uiux-wayfinding/map.md`。
- 只读依据、不改动：`docs/specs/beauty-content-agent-p0-spec.md`、`apps/core/src/product/product-service.ts`、`packages/contracts/src/product.ts`、`packages/contracts/src/product-schema.ts`。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 新注册商家首次进入真实空工作区时，在“一句话开工”主动作下能看到“弥鹿美甲示例店”只读终态：档案摘要、4 份授权素材、3 张内容卡和 1 个发布包均有清楚分区，且页面不再出现 E0/Task/Work/Asset/Content 等工程黑话。
- 示例区明确显示“只读 · 浏览不消耗额度”；浏览、切换三张示例内容、打开发布包摘要或执行“做同款”前后，页面上的可用额度数字不变化，且没有编辑、删除、发布示例的控件。
- 用户选择一张示例内容并点击“看示例·做同款”后，现有意图框得到可编辑的内容角度/结构，门店名、¥299 和示例素材不会被带成本店事实；界面仍要求显式点击“建立创作记录”。
- 用户点击“隐藏示例”后，示例区立即退出；刷新和重新登录后仍保持隐藏，真实“一句话开工”入口继续可用。隐藏失败时页面保留示例并提供重试，不出现“已隐藏”的假状态。
- 用户开始第一条真实创作、上传真实素材或保存真实内容后，主工作台只呈现真实创作路径；示例不会出现在来源 chips、历史、资产库、内容库或真实数量中。
- 在 390px 宽度下，示例档案、素材、内容卡和两个次动作可完整阅读与触达，无横向溢出；桌面端不挤压右侧任务区域。
- 截图对照：同一桌面视口并排提交当前产品 `docs/evidence/browser-dogfood-2026-07-13/screenshots/initial-dashboard.png`、对标产品 `.scratch/creatok-uiux-wayfinding/assets/screenshots/01-dashboard-desktop-live.jpg` 与升级后工作台截图；肉眼可见从“空 prompt 等用户填写”升级为“主动作 + 可浏览示例终态”，同时不照搬 CreatOK 的电商首页或聊天壳。

## Blocked-by / Blocks

- Blocked-by：票 03；必须沿用其“接线、不复制事实、不进真实历史”的裁决。
- 全局关票闸：票 02 未完成时，本票不得关票。
- Blocks：无直接后续编号票；本票关闭后计入 Phase 4 与 Path B Exit milestone 的逐屏截图验收。

## 风险与回退

- 示例污染真实业务对象或指标：以“展示投影”和 canonical 列表硬分层。若发现混写，立即撤下示例区并恢复真实 E0；保留后端只读种子，不删数据、不把示例迁入历史。
- 多查询到达顺序造成示例闪现后消失：只有 Task/Work/Asset/Content 查询均成功后才判定真实 E0；任一失败沿用可重试错误态，不把“未知”当“空”。
- `hide_example` 在 cutover 写路由中失败：回退为示例仍可见且提示重试，不使用 localStorage 伪造持久隐藏；修复现有命令路由，不新建旁路。
- 示例区喧宾夺主或退化成后台统计卡：保持“一句话开工”为唯一主 CTA，示例只作次级终态预览；若截图对照不达标，回退该呈现层后重排，不回退到“无示例”口径。
- “做同款”误带示例事实：只预填内容角度/结构；若无法可靠剥离门店事实，先回退为“查看示例”而非复制，绝不静默写入真实档案、价格或素材。
- 当前示例合同没有媒体 URL：本票不得用假图制造“高质量成品”证据；若逐屏截图仍因缺真实媒体不达标，应回 ADR-0010 追加有明确差距映射的媒体合同范围，不在票 21 静默扩后端。
