# 票 15 · 模型/模板视觉卡画廊接线（缩略图+标签+额度）
> 阶段: Phase 2 · 参数形态与 CheckBox ｜ 差距: P1-9 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "15",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH",
    "DEC-MEDIA-MODEL-EXPLICIT"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-9"
  ],
  "contractIds": [
    "I01",
    "I06"
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

- 差距报告 `P1-9`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:208-211`）的准确口径是：主路径已有模型与模板选择，但仍是原生下拉、图标文字卡和命令搜索；缺的是带缩略图、标签、额度信息的视觉化选择，不得写成“模型/模板选择完全缺失”。
- 报告§一根因②（`:24`）命中本票：`AiImageSelector`、`TemplateCatalog`、`RetrievalSearch` 只由 `p1/index.ts` 导出，核心 `/dashboard` → `UnifiedCreationWorkbench` 看不到这些 UI；“桶导出存在”不等于用户可用。
- ADR-0010:7,11 与 MAP:10-15 规定，只有主路径中的用户可见行为和对标截图可以关票；组件接线、接口返回或代码完成均不能单独作为验收证据。
- 票 03 已裁决：模型层只收窄复用 `AiImageSelector` 的显式单选卡，不整块挂载它自带的提示词/Job 壳；模板层把 `TemplateCatalog` 的视觉卡合入现有 `CreationShelf`，禁止出现第二套目录；`RetrievalSearch` 交票 20，不进入本票。
- 锁定边界：D3 仍是“对话式外壳 + 结构化内核”，不做 chat clone；D4 仍是候选 3 选 1 单选；L-1 贴链接抓取已 de-scope；模型不提供跨品牌 Auto，也不因失败静默换供应商。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/index.tsx:30-40`：桌面 `/dashboard` 当前仍在 `:39` 渲染 `UnifiedCreationWorkbench`；报告入口行号未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:242-270`：主路径已读取同一 ModelSupply catalog，并用 `selectedModelId` 维护明确模型；视觉卡必须复用这份目录与状态，不得另造静态可提交目录。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:743-750,778-798`：模板仍挂在 `CreationShelf`，模型仍是原生 `<select>`；报告所引 `:744`、`:782-793` 均未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:830-875,895-928`：不可用原因、禁止静默换模、预计产出/报价、确认失效与提交门已在主 Composer；富卡必须保留这些真实约束和现有提交语义。
- `mkfast-template-main/src/p1/ai-image-selector.tsx:144-186`：已有 RadioGroup 单选卡，展示厂商、能力、预计产出额度与不可用原因，但卡面纯文字、无缩略图；报告 `:150-185` 锚点准确。`:198-307` 同时包含另一套提示词、提交和 Job UI，所以不能整块挂载。
- `mkfast-template-main/src/p1/settings-view-model.ts:9-30,288-393`：通用 catalog 视图已有厂商、能力标签、可用性和真实单价，尚无预览图字段；模型富卡应由这里的目录事实投影，不从卡面硬编码供应商能力或价格。
- `mkfast-template-main/src/product/account-usage.ts:1-40` 与 `mkfast-template-main/src/product/account-usage-panel.tsx:14-23`：已有文案/图片/视频“产出量”权益投影和查询入口，可复用为卡面的当前可用额度；文案不得改成积分、credit 或 token。
- `mkfast-template-main/src/p1/template-catalog.tsx:179-264,283-317,374-426`：快捷卡和目录卡已有缩略图槽、预览、分类/官方标签；报告所引 `<img>` `:218/:385` 均准确。
- `mkfast-template-main/src/p1/types.ts:133-150` + `operations-view-model.ts:235-295`：视图类型虽有 `thumbnailUrl`，但当前 `templateViews` 没有填充缩略图、描述或 tags；`RawTemplate` 的 tags 在 `operations-view-model.ts:48-56` 已返回却未映射。
- `apps/core/src/p1/operations/application-service.ts:3093-3100`：`creation_catalog` 只组合 templates/userTemplates/shortcuts；模板版本本体已有可渲染 `CanvasDocument`（`:1917-1926`），当前目录响应未携带缩略预览数据。因此“缩略图渲染槽已建”成立，“主路径已有真实缩略图数据”不成立。
- `mkfast-template-main/src/product/creation-shelf.tsx:192-241,324-352,382-446`：已消费同一模板 catalog，但只把模板映射成文字 detail，再渲染快捷按钮与图标文字卡；应在此合并视觉层，而不是旁挂 `TemplateCatalog`。
- `mkfast-template-main/src/p1/index.ts:1,8-9`：三项能力仍仅桶导出；全 `src` 对组件名的实核命中只有定义与该导出，无 routes/product JSX 消费者。行号漂移结论：报告本票锚点仍准确，新增纠偏仅是缩略图数据尚未真正贯通。

## 改造方案（步骤级 + 涉及文件清单）

1. **收窄模型卡能力**：从 `AiImageSelector` 复用/提取纯模型 Radio 卡层，输入统一改为主工作台的 `CatalogModelView` 投影；保留显式单选、不可用禁选与原因，不带入其提示词、提交按钮、进度和结果区。
2. **补可信模型预览**：为当前 catalog 模型配置经授权、与媒介/能力相符的预览缩略图，资产落在既有 `mkfast-template-main/public/`；brief 不预写尚未存在的文件名。卡片缺图或加载失败时显示稳定的媒介占位，不借用对标截图，也不把占位冒充模型真实样片。
3. **把目录事实投影到卡面**：每张模型卡显示公开模型名、厂商、能力标签、可用状态、本次预计产出与对应文案/图片/视频当前可用额度；额度来自既有 entitlements projection，以“条/张/段”表达，价格仍沿用当前真实报价证据。
4. **替换主路径原生下拉**：在 Composer 的模型位挂载富卡组并直接读写现有 `selectedModelId`；切卡继续撤销旧 `quoteAccepted`，卡面、摘要与最终提交使用同一 model id，绝不出现跨品牌 Auto 或暗中 fallback。
5. **补模板预览投影**：让 `creation_catalog` 对当前可用的固定/发布版本返回足以渲染首屏预览的受权 `CanvasDocument` 投影，并把已有 tags 映射到前端视图；不为画廊逐卡触发会写审计的 `preview_template_version` 命令。
6. **合并而非双挂模板目录**：把 `TemplateCatalog` 的缩略图/首屏 SVG、family、官方/我的、tags 与版本标签卡面收敛为可复用视觉层，嵌入 `CreationShelf` 的快捷位和展开目录；保留既有“带入当前 Work/用此创建画布/快捷位”动作及同一 catalog 数据。
7. **控制信息密度与可达性**：桌面模型卡横向或网格可扫，模板画廊保持固定比例；窄屏单列或可控横滑。整卡可聚焦并具备单选/选中语义，图片有可理解替代文本，禁用态不能只靠灰度区分。
8. **守住跨票边界**：票 13 负责“命名预设选中后隐藏提示词 + 该传什么图”，票 20 负责 `RetrievalSearch`，票 24 负责既有设置页内部标识净化；本票只提供可被票 13 复用的模板选择结果，不重做提示词、检索、候选或聊天流。

涉及文件清单：

- 主路径：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/creation-shelf.tsx`。
- 复用与视图投影：`mkfast-template-main/src/p1/ai-image-selector.tsx`、`mkfast-template-main/src/p1/template-catalog.tsx`、`mkfast-template-main/src/p1/types.ts`、`mkfast-template-main/src/p1/operations-view-model.ts`、`mkfast-template-main/src/p1/settings-view-model.ts`。
- 额度投影复用：`mkfast-template-main/src/product/account-usage.ts`、`mkfast-template-main/src/product/account-usage-panel.tsx`。
- 模板目录预览数据：`apps/core/src/p1/operations/application-service.ts`、`apps/core/src/p1/operations/types.ts`。
- 经授权预览资产目录：`mkfast-template-main/public/`；不新增平行模型目录、模板目录或检索页。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家进入桌面 `/dashboard` 并建立 Work 后，模型位直接呈现带预览缩略图、公开模型名、厂商、能力标签和产出额度的视觉卡，不再先看到原生下拉。
- 商家可用鼠标或键盘在模型卡中单选一个明确模型；切换后选中态、预计产出、当前可用额度与报价同步更新，旧确认明确失效，最终提交不会换成另一品牌模型。
- 不可用或缺报价的模型仍可被看见和理解，但不能选中提交；卡面直接说明原因和可采取动作，不只显示灰卡或无解释的禁用按钮。
- 商家在“发现与复用”看到有真实首屏预览、family/官方或我的/tags/版本信息的模板画廊；快捷位和展开目录使用同一套视觉卡，不出现两个模板目录。
- 商家从视觉模板卡执行“带入当前 Work”或“用此创建画布”后，所见模板名与版本和后续页面一致；模板缩略图失败时有稳定占位与可理解文字，不出现破图或空白白框。
- 卡面额度只说“文案条数/图片张数/视频条数”及当前可用量，不出现积分、credit、token；预览图不冒充用户作品或对标产品素材。
- 桌面与移动窄屏均可完整读到缩略图、标签、额度和选中态，无横向溢出；读屏能获知卡名、是否可用、是否选中，视觉状态不只依赖颜色。
- 截图对照：同一桌面视口并排提交当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/05-video-models-desktop-live.jpg`、升级后同路由/同模型截图、对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/18-model-selector-desktop-live.jpg`；标注肉眼可见的“原生 select → 缩略图 + 标签 + 产出额度单选卡”变化。
- 模板补充截图：并排提交当前 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/04-template-preview-desktop-live.jpg`、升级后 CreationShelf 模板画廊、对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/09-gallery-desktop-live.jpg`；升级后必须可见多张非空模板首屏预览与卡面标签。

## Blocked-by / Blocks

- Blocked-by：票 03；必须沿用其“模型卡收窄复用、模板卡合并进 CreationShelf、RetrievalSearch 交票 20”裁决。
- 全局流程闸：Phase 0 未完成前本票不得进入 frontier；票 02 的体验合同 required 条目未验绿前，本票即使有截图也不得关票。
- Blocks：无 MAP 明示下游阻断票。与票 13 共享模板选择结果，但不新增依赖链；若需改 03 的去向，必须回 ADR-0010 重裁。

## 风险与回退

- **整块挂载造成双 Composer**：`AiImageSelector` 自带提示词、提交与 Job UI。控制：只复用 Radio 卡层；回退时恢复原生 select 作为临时入口，也不启用跨品牌 Auto。
- **视觉卡有壳无真实数据**：模板当前不传缩略预览，模型 catalog 也无预览字段。控制：截图验收必须出现真实模板首屏与经授权模型预览；数据缺失时宁可显示明确占位，不以空白框关票。
- **目录响应过重或预览越权**：携带完整模板文档可能放大响应并暴露非当前版本。控制：仅投影当前工作区可使用的固定/发布版本首屏所需字段；若性能回归，回退为按可见卡懒加载只读预览，不调用写审计命令、不放宽版本授权。
- **卡面额度与提交事实漂移**：额度、报价、model id 若来自第二套常量会出现“看 A、交 B”。控制：统一读现有 catalog、entitlements、quote 与 `selectedModelId`；任何一项未知都明示未知，不显示零或猜测值。
- **模板画廊重复与动作分叉**：直接并列 `TemplateCatalog` 会形成双目录。控制：只在 `CreationShelf` 合并视觉层并保留原动作；回退时撤下新视觉层、保留单一文字入口，不保留两套状态。
- **范围外溢**：卡片改造容易顺手复活 URL 抓取、chat clone、候选多选或内部模型 id。控制：发现后删除本票新增入口；D3、D4、L-1 与显式模型边界不随视觉升级改变。
