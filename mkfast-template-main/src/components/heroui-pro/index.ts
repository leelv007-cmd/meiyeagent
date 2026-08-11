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
 * `Sheet` is deliberately absent: `./vendor/components/sheet` is still
 * vendored because `sidebar` imports it for its mobile drawer, but this app's
 * own sheet surface is the shadcn one, so exporting it here only invited a
 * second answer to the same question.
 */

/* ── AI Chat 族 (→ U03) ── */
export { ChainOfThought } from './vendor/components/chain-of-thought';
export { ChatConversation } from './vendor/components/chat-conversation';
export { ChatLoader } from './vendor/components/chat-loader';
export { CodeBlock } from './vendor/components/code-block';
export { Markdown, StreamMarkdown } from './vendor/components/markdown';
export { PromptInput } from './vendor/components/prompt-input';
export { TextShimmer } from './vendor/components/text-shimmer';

/* ── 壳与卡片 ── */
export { EmptyState } from './vendor/components/empty-state';
export { ItemCard } from './vendor/components/item-card';
export { ItemCardGroup } from './vendor/components/item-card-group';
export { ListView } from './vendor/components/list-view';
export { PromptSuggestion } from './vendor/components/prompt-suggestion';
export { Segment } from './vendor/components/segment';
export { Sidebar, useSidebar } from './vendor/components/sidebar';
export { Widget } from './vendor/components/widget';
