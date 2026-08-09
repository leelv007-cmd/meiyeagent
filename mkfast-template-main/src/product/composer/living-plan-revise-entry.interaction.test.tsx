/**
 * 返回修改 asked the merchant for the next instruction and then handed them a
 * disabled box. PromptInput locks its textarea whenever the bar is `running`
 * (vendored `lockInputOnRun` defaults true), and a presented plan keeps the
 * session in `running` — so the revise entry was dead on arrival.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { COMPOSER_INTENT_INPUT_TESTID } from './composer-conversation';
import { ComposerPromptBar } from './composer-conversation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

afterEach(cleanup);

function promptBar(running: boolean) {
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      controlDensity="idle-compact"
      destination={null}
      destinationCapability={null}
      disabled={false}
      lensRequired={false}
      lensSlot={null}
      lensSummary="图文"
      onDestinationChange={() => {}}
      onReuseChip={() => {}}
      onSubmit={() => {}}
      onValueChange={() => {}}
      placeholder="说说想发什么"
      reuseChips={[]}
      running={running}
      signedPreview={null}
      submitDisabled={false}
      submitHint={null}
      submitLabel="开始创作"
      value="把三条改成两条"
    />
  );
}

test('the run lock is what makes the intent box unusable', () => {
  render(promptBar(true));
  expect(screen.getByTestId(COMPOSER_INTENT_INPUT_TESTID)).toBeDisabled();
  cleanup();
  render(promptBar(false));
  expect(screen.getByTestId(COMPOSER_INTENT_INPUT_TESTID)).toBeEnabled();
});
