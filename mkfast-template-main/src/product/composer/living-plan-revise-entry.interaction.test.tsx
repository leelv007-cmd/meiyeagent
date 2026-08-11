/**
 * 返回修改 asked the merchant for the next instruction and then handed them a
 * disabled box. PromptInput locks its textarea whenever the bar is `running`
 * (vendored `lockInputOnRun` defaults true), and a presented plan keeps the
 * session in `running` — so the revise entry was dead on arrival.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  __resetAgentWorkbenchHostStoreForTests,
  createAgentEventStore,
} from '@/product/agent-workbench/agent-event-store';
import {
  createEmptyAgentWorkbenchState,
} from '@/product/agent-workbench/agent-event-reducer';
import { CommitStrip } from '@/product/agent-workbench/plan/commit-strip';
import { projectCommitStrip } from '@/product/agent-workbench/plan/commit-strip-model';
import { COMPOSER_INTENT_INPUT_TESTID } from './composer-conversation';
import { ComposerPromptBar } from './composer-conversation';
import { useLivingPlanController } from './use-living-plan-controller';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetAgentWorkbenchHostStoreForTests();
});

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

function seedPreparedPlan() {
  __resetAgentWorkbenchHostStoreForTests(
    createAgentEventStore({
      ...createEmptyAgentWorkbenchState(),
      activePlanId: 'plan-original',
      plans: {
        'plan-original': {
          planId: 'plan-original',
          latestRevision: 1,
          revisions: [
            {
              planId: 'plan-original',
              revision: 1,
              goal: { summary: '端午套餐上新' },
              deliverables: [
                { kind: 'note', platform: 'xiaohongshu', quantity: 6 },
              ],
              expression: {},
              factsAssets: {},
              costDuration: {},
              readiness: 'ready',
            },
          ],
        },
      },
    })
  );
}

function PreparedPlanPublicUi({
  onNewSubmission,
}: {
  onNewSubmission(): void;
}) {
  const [value, setValue] = useState('');
  const controller = useLivingPlanController({
    taskId: 'task-original',
    focusIntent: () => {},
  });
  return (
    <>
      <CommitStrip
        onAction={controller.onCommitAction}
        view={projectCommitStrip({
          creditCost: 6,
          hasPlan: true,
          readiness: 'ready',
        })}
      />
      <ComposerPromptBar
        ariaLabel="描述调整要求"
        controlDensity="idle-compact"
        destination={null}
        destinationCapability={null}
        disabled={false}
        lensRequired={false}
        lensSlot={null}
        lensSummary="图文"
        onDestinationChange={() => {}}
        onReuseChip={() => {}}
        onSubmit={() => {
          if (!controller.submitPlanCommand(value)) onNewSubmission();
        }}
        onValueChange={setValue}
        placeholder="写下调整要求"
        reuseChips={[]}
        running={!controller.revising}
        signedPreview={null}
        submitDisabled={false}
        submitHint={null}
        submitLabel="发送调整"
        value={value}
      />
    </>
  );
}

test('返回修改 keeps the prepared task and sends its revision instead of opening a new submission', async () => {
  seedPreparedPlan();
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: {
            makeReady: true,
            runId: 'run-revise-entry',
            threadId: 'thread-revise-entry',
          },
          meta: { correlationId: 'corr-revise-entry' },
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }
      )
  );
  vi.stubGlobal('fetch', fetchSpy);
  const onNewSubmission = vi.fn();
  const user = userEvent.setup();
  render(<PreparedPlanPublicUi onNewSubmission={onNewSubmission} />);

  await user.click(screen.getByTestId('agent-commit-strip-revise'));
  const intent = screen.getByTestId(COMPOSER_INTENT_INPUT_TESTID);
  await user.type(intent, '只做小红书，减到 4 页');
  await user.click(screen.getByTestId('composer-submit'));

  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/core/p1/composer/tasks/task-original/revise'
  );
  expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
    merchantInstruction: '只做小红书，减到 4 页',
    planRevision: 1,
  });
  expect(onNewSubmission).not.toHaveBeenCalled();

  // ComposerHome owns the production draft callback. A presented plan keeps the
  // lens frozen, so the revision edit must guard the ordinary new-attempt rebind
  // that would clear the task handle this public interaction just used.
  const home = readFileSync(
    resolve(process.cwd(), 'src/product/composer/composer-home.tsx'),
    'utf8'
  );
  const handler = home.indexOf('const handleIntentChange = (value: string) =>');
  const guard = home.indexOf('!livingPlanController.revising &&', handler);
  const rebind = home.indexOf('rebindComposerSession(', handler);
  expect(handler).toBeGreaterThanOrEqual(0);
  expect(guard).toBeGreaterThan(handler);
  expect(guard).toBeLessThan(rebind);
});
