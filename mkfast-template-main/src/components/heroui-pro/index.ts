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
 *   表单族       → U05 admin 表单族重组（D-107）— 已结，见下
 *   可视化族     → U06 admin 可视化三面板 — 已结，见下
 *
 * U05/U06 关票时撤下六件，理由随件记在这里，不留「以后可能用得上」：
 *   rich-text-editor  受控配置里的长文（写作要点、结构模板）按契约是纯文本，
 *                     富文本编辑器会往值里塞标记，编译器读到的就不是运营写的那句话。
 *                     随件退掉八个 @tiptap 依赖。
 *   cell-color-picker 19 个受控配置里没有一个是颜色值。
 *   inline-select     选择器已经按稠密度分了工：成表单的用 native-select，
 *                     行内格子的用 cell-select；再放一个只是给同一个问题第三个答案。
 *   area-chart        运营三面接的三条投影都是快照，没有时间序列。
 *   line-chart        同上；折线只能靠造点连起来。
 *   stepper           三面里没有分步推进的东西可画（策略 stage 是状态，不是流程条）。
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

/* ── 表单族 (U05 已消费) ── */
export { CellSelect } from './vendor/components/cell-select';
export { CellSlider } from './vendor/components/cell-slider';
export { CellSwitch } from './vendor/components/cell-switch';
export { DataGrid } from './vendor/components/data-grid';
export type { DataGridColumn } from './vendor/components/data-grid';
export { NativeSelect } from './vendor/components/native-select';
export { NumberStepper } from './vendor/components/number-stepper';

/* ── 可视化族 (U06 已消费) ── */
export { BarChart } from './vendor/components/bar-chart';
export { ChartTooltip } from './vendor/components/chart-tooltip';
export { KPI } from './vendor/components/kpi';
export { KPIGroup } from './vendor/components/kpi-group';
export { PieChart } from './vendor/components/pie-chart';
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
