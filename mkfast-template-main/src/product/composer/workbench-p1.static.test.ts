/**
 * Static gates for #313 P1-01 workbench shell + document timeline base
 * (P1-1 / P1-2 / P1-7 + AgentFrame registry path).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8');

test('P1-7: composer-home uses width contract shell, not max-w-3xl', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /WorkbenchShellRoot/u);
  assert.match(home, /resolveWorkbenchWidthMode/u);
  assert.doesNotMatch(home, /max-w-3xl/u);
  const shell = readSource('src/product/composer/workbench-shell.ts');
  assert.match(shell, /WORKBENCH_CONVERSATION_MAX_WIDTH_PX = 800/u);
  assert.match(shell, /WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX = 1240/u);
  assert.match(shell, /max-w-\[800px\]/u);
  assert.match(shell, /max-w-\[1240px\]/u);
});

test('P1-1: dual column uses react-resizable-panels product path', () => {
  const layout = readSource('src/product/composer/workbench-shell-layout.tsx');
  assert.match(layout, /ResizablePanelGroup/u);
  assert.match(layout, /workbench-dual-column/u);
  assert.match(layout, /WorkbenchInspectorSheet/u);
  // Group + stream panel must not become sticky containing blocks (P1-2 residual).
  assert.match(layout, /meiye-workbench-stream-panel/u);
  assert.match(layout, /meiye-workbench-dual-column-group/u);
  assert.match(layout, /data-overflow="visible"/u);
  assert.match(layout, /style=\{\{\s*overflow:\s*['"]visible['"]\s*\}\}/u);
  assert.doesNotMatch(layout, /min-h-\[28rem\]/u);
  const glass = readSource('src/components/heroui-pro/heroui-glass.css');
  assert.match(
    glass,
    /\.meiye-workbench-stream-panel\s*\{[\s\S]*?overflow:\s*visible\s*!important/u
  );
  assert.match(
    glass,
    /\.meiye-workbench-dual-column-group[\s\S]*?overflow:\s*visible\s*!important/u
  );
  assert.match(
    glass,
    /data-slot=['"]resizable-panel-group['"][\s\S]*?:has\(\.meiye-workbench-stream-panel\)[\s\S]*?overflow:\s*visible\s*!important/u
  );
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /isWorkbenchDualColumnEligible/u);
  assert.match(home, /WorkbenchCreateLayout/u);
  assert.match(home, /WorkbenchInspectorPanel/u);
  assert.match(home, /useWorkbenchViewportWidth/u);
  assert.match(layout, /workbench-result-inspector/u);
});

test('P1-2: Active sticky Composer clears mobile-nav (4.25rem family)', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /isWorkbenchComposerSticky/u);
  assert.match(home, /WorkbenchStickyComposerHost/u);
  // Merchant-critical chrome rides the sticky host (quote / grounding / quota).
  assert.match(
    home,
    /WorkbenchStickyComposerHost[\s\S]*composer-quote-line[\s\S]*QuotaBlockingCard[\s\S]*<\/WorkbenchStickyComposerHost>/u
  );
  const shell = readSource('src/product/composer/workbench-shell.ts');
  assert.match(shell, /WORKBENCH_MOBILE_NAV_HEIGHT = '4\.25rem'/u);
  assert.match(shell, /5\.25rem\+env\(safe-area-inset-bottom\)/u);
  assert.match(shell, /bg-background\/95/u);
  assert.match(shell, /backdrop-blur/u);
});

test('frame registry: conversation renders turns via AgentFrame host', () => {
  const conversation = readSource(
    'src/product/composer/composer-conversation.tsx'
  );
  assert.match(conversation, /resolveAgentFrameKind/u);
  assert.match(conversation, /data-agent-frame/u);
  assert.match(conversation, /AgentFrameHost/u);
  // P1-05: execution_confirm is an in-stream DecisionFrame, not sticky-only.
  assert.match(conversation, /execution_confirm/u);
  assert.match(conversation, /executionConfirmSlot/u);
  // Bubble stream retired for agent content (D1 document timeline).
  assert.doesNotMatch(conversation, /ChatMessage\.Assistant/u);
  assert.doesNotMatch(conversation, /ChatMessage\.User/u);
  const registry = readSource('src/product/composer/agent-frame-registry.ts');
  assert.match(registry, /AGENT_FRAME_KINDS/u);
  assert.match(registry, /COMPOSER_SESSION_TURN_KINDS/u);
  assert.match(registry, /execution_confirm/u);
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /executionConfirmSlot/u);
  assert.match(home, /applyComposerPendingInterrupts/u);
  // Residual Brief-cancel feedback is not the paid-media confirm slot.
  assert.match(home, /execution-cost-feedback-slot/u);
});
