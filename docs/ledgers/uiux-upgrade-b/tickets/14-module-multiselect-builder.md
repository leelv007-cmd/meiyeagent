# 票 14 · 成套模块多选构建器 + 继承字段 A/B 默认勾 4 项
> 阶段: Phase 2 · 参数形态与 CheckBox ｜ 差距: P1-7 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "14",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-7"
  ],
  "contractIds": [
    "I07"
  ],
  "blockedBy": [
    "13"
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

- 差距报告 `P1-7`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:198-201`）已定性为「已核实」：主 Composer 只能单选文案/图片/视频 operation，没有内容模块多选、默认组合和提交前成套结构预览。
- 报告§2.2（`:46-60`）明确区分两种 CheckBox：本票做「生成前组合内容模块」，不做「生成后多选候选」。ADR-0010:9 锁定 D4=每次 3 条、3 选 1 单选采用、换一批、免费重试 ≤2，不得借本票重开。
- 报告§一根因①②（`:20-25`）命中本票：「A+ 模块构建器→美业内容套组」拍板没有进工程票，且旧验收只问控件是否存在，没问是否进主路径和数据流。
- 对标合同：CreatOK A+ LIVE 实测为 16 模块、默认 5/16，提交前展示模块组合与 6 张示例角色（`.scratch/creatok-uiux-wayfinding/assets/01-creatok-core-journey-audit.md:241-247`）。本项目只采用「先看成套结构、再勾选组合」机制，不照搬电商 A+、SKU、平台/市场/语种字段。
- 继承默认值已锁定（`.scratch/creatok-uiux-wayfinding/assets/08-tool-template-remix-prototype-record.md:69-76`）：A 货架/B「添加到创作」默认勾「内容结构、版式槽位、文案骨架、输出规格」；「视觉风格」默认不勾；C 参考解构台仍从 0 项开始。
- 已锁边界继续生效：D3 是对话式外壳+结构化内核，不做 chat clone；L-1 贴链接抓取已 de-scope；模型仍须显式选定，禁止跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:66-90,211-217`：operation 仍是文案/图片/视频三选一状态；没有套组模块状态。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:365-408`：提交只组装单一 `CreativeExecutionContract`，没有模块组合或继承快照；报价确认与任务发起都从这里进入。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:725-750`：当前 Work 只显示来源 `kind/id`，然后挂载 `CreationShelf`；用户看不到每个来源继承了哪些字段。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:752-776`：报告引用未漂移，Composer 仍是 operation 大按钮单选，无提交前套组多选与结构预览。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:895-932`：报告的 `:897 quoteAccepted` 仍准确；该 checkbox 只是执行合同确认门，不是内容模块构建器。
- `mkfast-template-main/src/product/creation-shelf.tsx:94-100,110-126`：5 个继承项只以中文字符串定义，`selectedFields` 初始为 `[]`；尚无稳定字段 ID 或 A/B/C 默认值合同。
- `mkfast-template-main/src/product/creation-shelf.tsx:248-260,324-345,403-410,455-490`：A 快捷位/展开货架与 B 命令面板最终都走 `choose(entry)`，模板/参考会直接 `onInsertReference(entry.reference)`，没有默认勾 4 项的轻确认。
- `mkfast-template-main/src/product/creation-shelf.tsx:492-580`：C 参考解构台正确从 0 项开始，但勾选只影响按钮禁用态和「带入 N 项」文案；`:572-575` 确认时仍只传 reference，所选字段被丢弃。
- `packages/contracts/src/uiux.ts:12-15,43-55`：`CreativeSourceReference` 只有 `{id, kind}`，`CreativeWork` 也没有模块组合；这是勾选无法进入共享草稿的类型断点。
- `apps/core/src/p1/operations/foundation-module.ts:94-100,218-242`：命令入口会把来源解析回 `{id, kind}`，create/derive/submit 都不接收模块或继承选择。
- `apps/core/src/p1/operations/application-service.ts:4052-4076,4183-4280,4439-4513`：来源去重会保留完整 reference，但现有类型/解析已先丢字段；Work 创建/派生只持久来源，Job 只快照执行合同。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:94-127`：执行器只把 `intent`、尺寸/时长与单一 operation 送入生成，尚未消费模块结构或继承选择。
- `mkfast-template-main/src/components/ui/checkbox.tsx:8-25`：已有 Base UI Checkbox 及焦点/点按区样式，本票复用，不再造第三套原生 checkbox。

## 改造方案（步骤级 + 涉及文件清单）

1. **锁定两类多选的语义**：「本次内容套组」选的是将要生成的结构模块；「从来源继承」选的是带入共享草稿的结构字段。两者与 D4 生成后 3 选 1 候选明确分区，文案、标题、控件不混用。
2. **建立稳定数据合同**：在共享合同中增加稳定英文 ID 的模块选择与继承字段类型；中文只做展示标签。`CreativeSourceReference` 携带所选继承字段，Work 共享草稿保存套组模块和顺序，提交时 Job 保留不可变快照，刷新/重试不重置。
3. **由票 13 的命名预设提供套组初始组合**：本票渲染预设声明的可用模块、默认勾选和输入缺口，不另造一套硬编码预设。无命名预设时显示可理解空态，不暗示一次可生成未被当前 operation/模型支持的模块。
4. **在 Composer 加入成套模块构建器**：放在票 13 预设/传图引导之后、报价确认之前；用 Base UI Checkbox 多选，显示已选数量、模块顺序、所需素材/不可用原因和「本次成套结构」预览。至少保留 1 个可执行模块，不兼做拖拽排序或电商 A+ 参数。
5. **把选择真正接入草稿与执行**：勾选变更写入当前 Work，撤销旧报价确认，提交卡快照当时结构；执行器只能对当前 operation/模型真实可兑现的模块组装结构化上下文。模块数如改变输出数/费用，必须先在可见报价里同步；禁止只存 ID 却仍按旧 prompt 生成。
6. **补齐 A/B 继承确认**：A 快捷货架和 B 命令面板选中模板/参考后，先打开同一个轻确认层，四个结构字段默认勾送，视觉风格默认不勾；用户可逐项改。C 继续 0 项起步，不受 A/B 默认值污染。
7. **保住事实边界**：门店名称、价格、联系方式、营销事实、发布账号/状态始终不因结构字段勾选而静默覆盖；视觉风格只能由用户显式勾选。确认后在 Work 来源段持续显示「从谁、继承什么」。
8. **做数据流与可见旅程回归**：覆盖 A/B/C 默认值、创建/派生 Work、刷新恢复、改模块后重确认报价、提交 Job 快照、键盘焦点与 390px 窄屏。测试是保护手段，关票仍以下方用户可见 DoD 为准。

涉及文件清单：

- 修改：`packages/contracts/src/uiux.ts`、`apps/core/src/p1/operations/types.ts`、`apps/core/src/p1/operations/foundation-module.ts`、`apps/core/src/p1/operations/application-service.ts`、`apps/core/src/p1/operations/model-supply-creation-adapter.ts`。
- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/creation-shelf.tsx`；复用 `mkfast-template-main/src/components/ui/checkbox.tsx`。
- 回归：`apps/core/src/p1/operations/creative-work.test.ts`、`apps/core/src/p1/operations/foundation-module.test.ts`、`mkfast-template-main/tests/e2e/specs/uiux-operations-reuse.spec.ts`、`mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`。
- 不新建平行 Composer、模板目录、候选多选器或跨品牌 Auto 路由。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家选中票 13 的命名预设后，在同一 Composer 中看到「本次内容套组」、默认已选模块数和成套结构预览；可勾选多个模块，不再只能在文案/图片/视频大按钮中单发一项。
- 商家勾选/取消模块时，已选数量、顺序、素材需求、成套预览和可见报价立即一致更新；旧报价确认明确失效，不会「看到 A、提交 B」。
- 商家在提交前能完整说出「这次会产出哪些模块、顺序如何、缺什么素材」；不兼容模块显示原因而非假装可选。刷新后同一 Work 的选择与预览不丢失。
- 商家从 A 快捷货架或 B「添加到创作」带入模板/参考时，确认层初始明确勾中内容结构、版式槽位、文案骨架、输出规格 4 项，视觉风格未勾；用户可改后再确认。
- 商家从 C 参考解构台进入时，5 项仍全未勾选，必须逐项选择；A/B 的 4 项默认不会渗透到 C。
- 带入后，商家在当前 Work 来源段看到来源对象与已继承字段；刷新、返回该 Work 或发起 Job 后仍一致，不再出现「按钮说带入 N 项，实际只存来源」。
- 来源中的门店名称、价格、联系方式、营销事实、发布账号/状态不会静默覆盖当前值；只有用户显式勾选时才继承视觉风格。
- 生成后的候选区仍每次只有 3 条且只能单选 1 条采用；页面文案与控件让用户清楚区分「提交前多选模块」和「生成后单选候选」。
- 键盘用户能按顺序遍历、勾选模块/继承字段并确认，重绘后焦点不丢；390px 窄屏无横向溢出，已选数、预览和主确认动作可发现。
- 截图对照：在同一桌面视口并排标注当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/05-video-models-desktop-live.jpg`、升级后「默认套组/自定义套组/提交前预览」三态，以及对标 `references/creatok/screenshots/app-image-product-listing-aplus.png` 的模块组合+成套示例。对标图须标注为 2026-07-07 历史视觉对照，LIVE 数量事实另引审计 `:241-247`，不冒充本轮 LIVE 截图。

## Blocked-by / Blocks

- Blocked-by：票 13。本票必须消费票 13 接入主路径的命名预设及其「该传什么图」元数据，不平行再造预设模型。按 MAP `12 → 13 → 14`，票 12 为间接前置。
- 全局关票闸：Phase 0 未完成前不进 frontier；票 02 的体验合同 `I07` 未验绿时，即使代码和截图存在也不得关票。
- Blocks：MAP 无后续票级硬依赖；本票为 Path B Exit milestone 的 CheckBox 完整层与 24 条差距回写提供必需证据。

## 风险与回退

- **只加控件、数据仍丢失**：当前 C 已经是现成反例。控制：验收必须从勾选追到 Work 可见来源、刷新恢复和 Job 快照；回退时整体关闭新构建器，不保留会误导用户的空壳 checkbox。
- **套组数量与报价/模型能力不符**：多勾模块可能改变输出量和成本。控制：不支持的模块不可选且说明原因，改组合必须撤销旧确认并重算可见报价；无可信报价时回退为单一可执行模块，不伪造免费套组。
- **A/B 默认值造成静默覆盖**：控制：默认 4 项仅限结构，视觉风格与门店/价格/发布事实不自动继承；若发生边界回归，先回退 A/B 为全不勾选的显式确认，C 始终保持从 0。
- **候选多选偷渡 D4**：控制：构建器只出现在提交前，候选区仍使用单选语义；如果两者在视觉上无法区分，回退构建器展示，不改 D4。
- **与票 13 重复状态**：预设、传图引导、模块默认如果各存一份会出现「选中一张卡、提交另一套」。控制：票 13 是唯一预设源，本票只管模块组合和快照；回退时撤下套组 UI，不复制票 13 的预设。
