/**
 * 评价条与后续动作 chip 真的到得了商家面前 — D-164⑤.
 *
 * The card had both surfaces and both ports, and the one place the card is
 * actually rendered passed neither, so nothing reached a merchant. That is the
 * failure D-150 names and U04 already removed one component for: a control that
 * exists, is tested, and never mounts. Component tests cannot catch it — they
 * pass the props themselves. This one starts from the container.
 */
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentPackageRevisionDelivery } from '@meiye/contracts';

import {
  hasCall,
  jsxOf,
  parseProductionSource,
} from '../../test-support/ast-boundary';
import { ComposerConversation } from './composer-conversation';
import {
  applyComposerWorkflowState,
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
} from './composer-session';
import { projectResultTokenStream } from '@/product/results/result-token-stream';

afterEach(cleanup);

const REVISION: ContentPackageRevisionDelivery = {
  packageId: 'package-a',
  revision: 2,
  versionId: 'version-a',
};

function delivered() {
  return applyComposerWorkflowState(
    bindComposerTask(
      openComposerTurn(createComposerSession('session-1'), '写一条开业文案'),
      { packageId: 'package-1', taskId: 'task-1', workId: 'work-1' }
    ),
    'success',
    REVISION
  );
}

function renderConversation(
  props: Partial<Parameters<typeof ComposerConversation>[0]> = {}
) {
  const session = delivered();
  render(
    <ComposerConversation
      onOpenDelivery={vi.fn()}
      session={session}
      stream={projectResultTokenStream({
        progressState: 'success',
        workspaceKind: 'copy',
      })}
      {...props}
    />
  );
}

describe('the delivered result carries its own feedback surfaces', () => {
  it('shows the rating bar and the follow-up chips on a delivery', () => {
    renderConversation({
      deliveryLensId: 'image_text',
      onDeliveryFollowUp: vi.fn(),
      onRateDelivery: vi.fn(),
    });

    expect(screen.getByTestId('composer-delivery-rating')).toBeInTheDocument();
    expect(
      screen.getByTestId('composer-delivery-rating-up')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('composer-delivery-followups')
    ).toBeInTheDocument();
  });

  it('hands the rating up with the revision it belongs to', async () => {
    const user = userEvent.setup();
    const onRateDelivery = vi.fn();
    renderConversation({ deliveryLensId: 'copy', onRateDelivery });

    await user.click(screen.getByTestId('composer-delivery-rating-up'));

    // A verdict with no version attached says nothing about which version was
    // good, which is the whole point of collecting it.
    expect(onRateDelivery).toHaveBeenCalledWith({
      transition: {
        action: 'up',
        idempotencyKey: expect.any(String),
        previousVerdict: null,
        nextVerdict: 'up',
      },
      revision: REVISION,
      taskId: 'task-1',
    });
  });

  it('offers nothing it cannot deliver on', () => {
    // No ports means no buttons: a control the container cannot answer is
    // worse than an absent one.
    renderConversation();

    expect(
      screen.queryByTestId('composer-delivery-rating')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('composer-delivery-followups')
    ).not.toBeInTheDocument();
  });
});

/**
 * The last hop the DOM above cannot reach: `ComposerHome` is the only thing
 * that renders the conversation in production, and rendering it here would
 * mean standing up the whole workbench. Read as source instead — the test
 * above proves the container honours the ports, and this proves the container
 * is given them.
 */
describe('the production host supplies those ports', () => {
  it('passes both to the conversation it renders', () => {
    const home = parseProductionSource(
      resolve(process.cwd(), 'src/product/composer/composer-home.tsx')
    );
    const conversation = jsxOf(home, 'ComposerConversation')[0];
    expect(conversation).toBeTruthy();
    expect(Object.hasOwn(conversation?.attrs ?? {}, 'onRateDelivery')).toBe(
      true
    );
    expect(Object.hasOwn(conversation?.attrs ?? {}, 'onDeliveryFollowUp')).toBe(
      true
    );
    expect(Object.hasOwn(conversation?.attrs ?? {}, 'deliveryLensId')).toBe(
      true
    );
    expect(hasCall(home, 'appendObservabilityEvent')).toBe(true);
  });
});
