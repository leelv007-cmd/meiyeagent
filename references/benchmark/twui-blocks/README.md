# twui-blocks — Tailwind Plus 参考组件快照（2026-07-13）

> 来源: https://tailwindui.starxg.com/plus（镜像站，Inertia data-page JSON 提取，React/JSX 官方源码）
> 选型依据: `../tailwind-plus-ui-blocks-selection-2026-07-13.md` ｜ 共 37 个组件 / 19 类
> **用途**: 第二轮视觉打磨的**设计模式参考**。逐字搬运需官方 license；本轮做法 = 取布局/间距/层次的 TW 类组合，交互原语与图标换成仓内已有件，演示内容一律不落地。

## 翻译约定（codex 执行时强制）

| 参考里出现 | 换成 |
|---|---|
| `@heroicons/react` | `@tabler/icons-react`（仓内已装） |
| `@headlessui/react` | `src/components/ui/` 下 Base UI shadcn 件（checkbox/radio-group/combobox/command/dialog/drawer…） |
| 抽屉 Dialog/Transition | `components/ui/drawer.tsx`（vaul） |
| 命令面板自绘 | `components/ui/command.tsx`（cmdk） |
| Inter 字体/演示文案（Hobby/$40/英文 marketing 句） | 仓内现有中文文案与真实数据 props——**演示内容落地=P0-2 品牌残留重犯** |
| `dark:` 变体 | 按目标文件现状：文件已有 dark: 才保留，没有则剔除 |

## 组件 → 目标文件映射（打磨包 P1-P14）

| 包 | 参考组件 | 目标文件 | 票 |
|---|---|---|---|
| P1 | progress-bars/panels-with-border, circles-with-text, bullets-and-text | `src/product/video-workflow-panel.tsx` | 16/09 步骤态指示 |
| P2 | notifications/with-actions-below, condensed | `src/product/async-task-center.tsx` | 10 完成通知双动作 |
| P3 | badges/flat-with-dot, flat-pill-with-dot, small-flat-with-dot | `src/components/uiux/product-status.tsx` | 状态徽章统一 |
| P4 | checkboxes/list-with-description, list-with-checkbox-on-right | `src/product/content-module-builder.tsx` | 14 成套多选 |
| P5 | radio-groups/stacked-cards, small-cards | `src/product/copy-candidate-selector.tsx` | 18 D4 三选一 |
| P6 | comboboxes/with-image, with-status-indicator | `src/product/model-card-picker.tsx` | 15 模型视觉卡 |
| P7 | category-previews/with-image-backgrounds + product-lists/× 2 | `src/product/creation-shelf.tsx` | 12 L0 场景货架 |
| P8 | grid-lists/images-with-details + product-quickviews/with-color-and-size-selector | `src/product/canonical-media-gallery.tsx` | 17 画廊+快速预览 |
| P9 | empty-states/with-starting-points, with-templates, with-recommendations-grid | `src/product/example-store-preview.tsx` | 21/19 空态+建议 |
| P10 | command-palettes/with-groups, with-icons + input-groups/× 2 | `src/product/global-command-palette.tsx` | 20 ⌘K 双组 |
| P11 | stacked-lists/× 2 + feeds/× 2 | `src/p1/content-task-inbox.tsx` | 任务列表+时间线 |
| P12 | stats/simple-in-cards, with-trending | `src/p1/weekly-operations.tsx` + `src/product/account-usage-panel.tsx` | 周运营数据卡 |
| P13 | action-panels/with-toggle, with-button-on-right | `src/p1/entitlement-byok-panels.tsx` | 设置面板行 |
| P14 | description-lists/left-aligned-in-card | `src/components/uiux/object-evidence.tsx` | D3 结构化详情 |
| 备用 | drawers/create-project-form-example, file-details-example | （未指派——重构风险高，待后续票裁决） | 12 渐进展开备选 |

## 纪律（每包同守）

1. 只换视觉标记（布局/间距/边框/层次/图标），**不动 props、hooks、handlers、状态机、data-testid、aria、i18n key 与中文文案**；
2. 无新依赖；参考文件顶部注释即翻译指令；
3. 交付仍以对应票 DoD 截图对照收口（验收矩阵 I 区不变）。
