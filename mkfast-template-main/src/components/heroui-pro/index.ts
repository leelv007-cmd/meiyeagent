/**
 * Single import surface for HeroUI Pro V3 components (D-130).
 *
 * Consumers import from `@/components/heroui-pro`, never from `./vendor/*`:
 * the vendor tree is regenerated wholesale by `pnpm --filter @meiye/web
 * heroui:sync`, so this barrel is the only place a rename in an upstream
 * release has to be absorbed.
 *
 * Pages must also pull in the Glass stylesheet — see ./README.md.
 *
 * Each component here answers to a named consumer ticket (U01 registration,
 * D-150①). Anything still unconsumed when its ticket closes leaves both this
 * barrel and `components.json` rather than sitting in the tree "for later":
 *
 *   AI Chat 族   → U03 对话流容器替换
 *   表单族       → U05 admin 表单族重组（D-107）
 *   可视化族     → U06 admin 可视化三面板
 *
 * `Sheet` is deliberately absent: `./vendor/components/sheet` is still
 * vendored because `sidebar` imports it for its mobile drawer, but this app's
 * own sheet surface is the shadcn one, so exporting it here only invited a
 * second answer to the same question.
 */

/* ── AI Chat 族 (→ U03) ── */
export { ChainOfThought } from './vendor/components/chain-of-thought';
export { ChatConversation } from './vendor/components/chat-conversation';
export { ChatLoader } from './vendor/components/chat-loader';
export { ChatMessage } from './vendor/components/chat-message';
export { CodeBlock } from './vendor/components/code-block';
export { Markdown, StreamMarkdown } from './vendor/components/markdown';
export { PromptInput } from './vendor/components/prompt-input';
export { TextShimmer } from './vendor/components/text-shimmer';

/* ── 表单族 (→ U05) ── */
export { CellColorPicker } from './vendor/components/cell-color-picker';
export { CellSelect } from './vendor/components/cell-select';
export { CellSlider } from './vendor/components/cell-slider';
export { CellSwitch } from './vendor/components/cell-switch';
export { DataGrid } from './vendor/components/data-grid';
export type { DataGridColumn } from './vendor/components/data-grid';
export { InlineSelect } from './vendor/components/inline-select';
export { NativeSelect } from './vendor/components/native-select';
export { NumberStepper } from './vendor/components/number-stepper';
export { RichTextEditor } from './vendor/components/rich-text-editor';

/* ── 可视化族 (→ U06) ── */
export { AreaChart } from './vendor/components/area-chart';
export { BarChart } from './vendor/components/bar-chart';
export { ChartTooltip } from './vendor/components/chart-tooltip';
export { KPI } from './vendor/components/kpi';
export { KPIGroup } from './vendor/components/kpi-group';
export { LineChart } from './vendor/components/line-chart';
export { PieChart } from './vendor/components/pie-chart';
export { Stepper } from './vendor/components/stepper';
export { Timeline } from './vendor/components/timeline';

/* ── 壳与卡片（既有采用面 + U04 接手的卡片家族） ── */
export { EmptyState } from './vendor/components/empty-state';
export { ItemCard } from './vendor/components/item-card';
export { ItemCardGroup } from './vendor/components/item-card-group';
export { ListView } from './vendor/components/list-view';
export { PromptSuggestion } from './vendor/components/prompt-suggestion';
export { Segment } from './vendor/components/segment';
export { Sidebar, useSidebar } from './vendor/components/sidebar';
export { TrendChip } from './vendor/components/trend-chip';
export { Widget } from './vendor/components/widget';
