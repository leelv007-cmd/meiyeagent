import type {
  AskMerchantQuestionRequest,
  ExecutionConfirmationRequest,
  QuestionCard,
  WorkflowProgressEnvelope,
} from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ReactNode, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { ExecutionConfirmationInteractionCard } from './execution-confirmation-interaction-card';

import type { ConfirmationDecideResult } from '@/product/harness-client';
import {
  bindComposerTask,
  createComposerSession,
  type ComposerSession,
} from './composer-session';
import {
  type ComposerInteractionTransports,
  useComposerInteractions,
  type WorkflowEventSource,
} from './use-composer-interactions';

const TASK = { packageId: 'package-1', taskId: 'task-1', workId: 'work-1' };
const QUESTION: QuestionCard = {
  questionId: 'question-1',
  workflowId: TASK.taskId,
  workflowRevision: 2,
  question: '这次主推哪个项目？',
  options: [{ id: 'option-1', label: '头皮护理' }],
  freeText: { enabled: true },
  response: { field: 'service', reason: '补充创作事实' },
  unattended: 'continue',
  scope: 'current_task',
};
const ASK_REQUEST: AskMerchantQuestionRequest = {
  requestId: 'ask-1',
  runId: TASK.taskId,
  step: 'intent_naming',
  revision: 3,
  kind: 'ask_merchant',
  questions: [
    {
      itemId: 'service',
      question: '这次主推哪个项目？',
      fallback: { kind: 'deferred' },
    },
  ],
  groupSkip: true,
  presentation: {
    blocking: 'none',
    carriers: ['conversation'],
    notification: 'none',
    renderer: 'ask_merchant_group',
  },
};
const EXECUTION_REQUEST: ExecutionConfirmationRequest = {
  requestId: 'execution-1',
  runId: TASK.taskId,
  step: 'execution_selection',
  revision: 4,
  kind: 'execution_confirmation',
  frozen: {
    condition: {
      kind: 'external_action',
      required: true,
      serverEvaluated: true,
    },
    debitPreview: [],
    executionSnapshotRef: { id: 'snapshot-1', revision: 1 },
    params: [],
    quoteRevision: 'quote-1',
    timeoutPolicy: {
      kind: 'hold',
      reason: 'external_action',
      serverEvaluated: true,
    },
  },
  presentation: {
    carriers: ['conversation'],
    notification: 'none',
    renderer: 'execution_confirmation',
  },
};

afterEach(() => vi.restoreAllMocks());

function idleStream(): ReturnType<WorkflowEventSource> {
  return {
    activeWorkflowId: TASK.taskId,
    copyCandidates: [],
    harnessCancellation: undefined,
    harnessDelivery: undefined,
    harnessExperienceBasis: undefined,
    latestProgress: undefined,
    merchantReport: undefined,
    transportStatus: 'open',
    workflowState: undefined,
  };
}

function createTransports(
  input: {
    interaction?: AskMerchantQuestionRequest | ExecutionConfirmationRequest;
    interactionMessage?: ExecutionConfirmationRequest;
    question?: QuestionCard;
    decideRejects?: boolean;
  } = {}
) {
  const decide = vi.fn<
    ComposerInteractionTransports['decideExecutionConfirmation']
  >(async () => {
    if (input.decideRejects) {
      throw new Error('decide unavailable');
    }
    return {
      decision: {
        schemaVersion: 'plan-confirmation-decision/v1',
        decisionId: 'dec-1',
        requestId: input.interaction?.requestId ?? 'execution-1',
        actorId: 'user-1',
        decision: 'confirmed',
        decidedAt: '2026-08-08T12:00:00.000Z',
      },
      request: {
        schemaVersion: 'agent-execution-confirmation-request/v1',
        requestId: input.interaction?.requestId ?? 'execution-1',
        workspaceId: 'ws-1',
        planId: 'plan-1',
        planRevision: 1,
        snapshotHash: 'snap-hash-1',
        quoteRef: { id: 'quote-1', revision: 'r1' },
        reservationIdempotencyKey: 'reserve-1',
        createdAt: '2026-08-08T11:00:00.000Z',
        holdExpiresAt: '2026-08-09T11:00:00.000Z',
        status: 'decided',
      },
      merchantMessage: null,
      refundedCredits: 0,
    } as ConfirmationDecideResult;
  });
  return {
    acknowledgeRenderer: vi.fn(async () => undefined),
    decideExecutionConfirmation: decide,
    readDecision: vi.fn(async () => ({
      exists: Boolean(input.question),
      question: input.question ?? null,
      reservationReleased: false,
      resolutionSource: null,
      status: input.question ? ('pending' as const) : ('absent' as const),
      timeoutSeconds: null,
    })),
    readInteraction: vi.fn(async () => input.interaction ?? null),
    readInteractionMessage: vi.fn(async () => input.interactionMessage ?? null),
    submitDecision: vi.fn(async () => ({
      eventId: 'event-1',
      replayed: false,
    })),
    submitInteraction: vi.fn(async () => undefined),
    submitMerchantMessage: vi.fn(async () => undefined),
  } satisfies ComposerInteractionTransports;
}

function renderInteractions(input: {
  eventSource?: WorkflowEventSource;
  session?: ComposerSession;
  transports: ComposerInteractionTransports;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      const [session, setSession] = useState(
        input.session ??
          bindComposerTask(createComposerSession('session-1'), TASK)
      );
      const interactions = useComposerInteractions(TASK.taskId, {
        costFeedbackPresent: false,
        eventSource: input.eventSource,
        executionConfirmOpen: false,
        lensId: 'copy',
        session,
        setSession,
        transports: input.transports,
      });
      return { interactions, session };
    },
    { wrapper }
  );
}

test('applies fake stream progress to the bound composer session', async () => {
  const progress: WorkflowProgressEnvelope = {
    eventId: 'event-progress-1',
    message: '已整理本次创作资料',
    occurredAt: '2026-08-04T08:00:00.000Z',
    sequence: 1,
    stage: 'context_injection',
    state: 'success',
    workflowId: TASK.taskId,
    workflowType: 'creation',
  };
  const eventSource = vi.fn(() => ({
    ...idleStream(),
    latestProgress: progress,
  })) as WorkflowEventSource;
  const view = renderInteractions({
    eventSource,
    transports: createTransports(),
  });

  await waitFor(() =>
    expect(view.result.current.session.progressSequence).toBe(1)
  );
  expect(eventSource).toHaveBeenCalledWith({
    enabled: true,
    workflowId: TASK.taskId,
    workflowQueryKey: ['harness', 'workflow', TASK.taskId],
  });
  expect(
    view.result.current.session.turns.some(
      (turn) => turn.kind === 'stage' && turn.message === progress.message
    )
  ).toBe(true);
});

test('projects experience only from the fake current-task stream carrier', () => {
  const eventSource = vi.fn(() => ({
    ...idleStream(),
    harnessExperienceBasis: {
      taskId: TASK.taskId,
      contextBundleId: 'bundle-1',
      contextBundleRevision: 2,
      confirmedPreferences: [
        {
          label: '少促销感',
          sourceRef: 'preference:tone:r1',
          value: '少促销感',
        },
      ],
    },
  })) as WorkflowEventSource;
  const view = renderInteractions({
    eventSource,
    transports: createTransports(),
  });

  expect(view.result.current.interactions.experienceBasis).toEqual({
    chips: [{ id: 'preference:tone:r1', label: '少促销感' }],
    state: 'ready',
  });
});

test('submits the generic question through the injected decision transport', async () => {
  const transports = createTransports({ question: QUESTION });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(view.result.current.interactions.pendingQuestion).toEqual(QUESTION)
  );

  await act(() =>
    view.result.current.interactions.answerQuestion({
      settlement: 'answered',
      value: '头皮护理',
    })
  );

  expect(transports.submitDecision).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      idempotencyKey: 'composer-decision:question-1:answered',
    })
  );
});

test('submits ask-merchant answers through the injected interaction transport', async () => {
  const transports = createTransports({ interaction: ASK_REQUEST });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(view.result.current.interactions.pendingAskRequest).toEqual(
      ASK_REQUEST
    )
  );

  await act(() =>
    view.result.current.interactions.answerAskMerchant(ASK_REQUEST, {
      kind: 'skipped',
    })
  );

  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      idempotencyKey: 'composer-interaction:ask-1:r3:merchant',
      requestId: 'ask-1',
    })
  );
});

test('submits the answer for the request the card rendered even before the own poll lands', async () => {
  // V31-28: the slot can render from the snapshot read leg a beat before this
  // hook's interaction poll returns; the answer must still reach Core instead
  // of being silently dropped while the option already shows as pressed.
  const transports = createTransports({});
  const view = renderInteractions({ transports });
  expect(view.result.current.interactions.pendingAskRequest).toBeNull();

  await act(() =>
    view.result.current.interactions.answerAskMerchant(ASK_REQUEST, {
      kind: 'skipped',
    })
  );

  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      idempotencyKey: 'composer-interaction:ask-1:r3:merchant',
      requestId: 'ask-1',
    })
  );
});

test('handles confirmation answer, continuation message, and renderer ack', async () => {
  const transports = createTransports({
    interaction: EXECUTION_REQUEST,
    interactionMessage: EXECUTION_REQUEST,
  });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(
      view.result.current.interactions.pendingExecutionConfirmation
    ).toEqual(EXECUTION_REQUEST)
  );
  await waitFor(() =>
    expect(
      view.result.current.session.turns.some(
        (turn) =>
          turn.kind === 'execution_confirm' &&
          turn.confirmId === EXECUTION_REQUEST.requestId
      )
    ).toBe(true)
  );

  await act(() =>
    view.result.current.interactions.answerExecutionConfirmation({
      kind: 'approved',
    })
  );
  await act(() =>
    view.result.current.interactions.answerExecutionWaitingMessage(
      EXECUTION_REQUEST,
      '继续执行'
    )
  );
  await act(() =>
    view.result.current.interactions.acknowledgeAskMerchantRenderer(
      EXECUTION_REQUEST
    )
  );

  expect(transports.decideExecutionConfirmation).toHaveBeenCalledWith(
    'execution-1',
    expect.objectContaining({
      decision: 'confirmed',
      decisionId: 'composer-confirmation-decision:execution-1',
    })
  );
  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      idempotencyKey: 'composer-interaction:execution-1:r4:merchant',
    })
  );
  expect(transports.submitMerchantMessage).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      idempotencyKey: 'composer-interaction:execution-1:r4:merchant-message',
      message: '继续执行',
    })
  );
  expect(transports.acknowledgeRenderer).toHaveBeenCalledWith(TASK.taskId, {
    carrier: 'conversation',
    requestId: 'execution-1',
    revision: 4,
    step: 'execution_selection',
  });
});

test('confirmation answer records a rejected decide with the refund message', async () => {
  const transports = createTransports({ interaction: EXECUTION_REQUEST });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(
      view.result.current.interactions.pendingExecutionConfirmation
    ).toEqual(EXECUTION_REQUEST)
  );

  await act(() =>
    view.result.current.interactions.answerExecutionConfirmation({
      kind: 'rejected',
      feedback: '换一个稳妥的模型',
    })
  );

  expect(transports.decideExecutionConfirmation).toHaveBeenCalledWith(
    'execution-1',
    expect.objectContaining({ decision: 'rejected' })
  );
  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      requestId: 'execution-1',
      revision: 4,
      response: { kind: 'rejected', feedback: '换一个稳妥的模型' },
    })
  );
});

test('an approved reprice-successor answer binds the thread onto the successor run (V31-63)', async () => {
  const successorCard: ExecutionConfirmationRequest = {
    ...EXECUTION_REQUEST,
    requestId: 'execution-1:r:1',
    runId: 'task-succ:plan:2:hash-succ',
  };
  const transports: ComposerInteractionTransports = {
    ...createTransports({ interaction: successorCard }),
    submitInteraction: vi.fn<
      ComposerInteractionTransports['submitInteraction']
    >(async () => ({
      kind: 'resumed',
      replayed: false,
      successorTask: {
        taskId: 'task-succ',
        workId: 'work-succ',
        packageId: 'package-succ',
      },
    })),
  };
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(
      view.result.current.interactions.pendingExecutionConfirmation
    ).toEqual(successorCard)
  );

  await act(() =>
    view.result.current.interactions.answerExecutionConfirmation({
      kind: 'approved',
    })
  );

  // The answer posts to the ORIGINAL thread while naming the successor run.
  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({
      requestId: 'execution-1:r:1',
      resume: {
        runId: 'task-succ:plan:2:hash-succ',
        step: 'execution_selection',
      },
    })
  );
  // The returned handle re-binds the conversation onto the successor task so
  // its progress and delivery land in this same thread.
  await waitFor(() =>
    expect(view.result.current.session.task).toEqual({
      taskId: 'task-succ',
      workId: 'work-succ',
      packageId: 'package-succ',
    })
  );
});

test('confirmation answer stays suspended when the domain decision is unavailable', async () => {
  const transports = createTransports({
    interaction: EXECUTION_REQUEST,
    decideRejects: true,
  });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(
      view.result.current.interactions.pendingExecutionConfirmation
    ).toEqual(EXECUTION_REQUEST)
  );

  await expect(
    act(() =>
      view.result.current.interactions.answerExecutionConfirmation({
        kind: 'approved',
      })
    )
  ).rejects.toThrow('The execution confirmation could not be submitted.');

  expect(transports.decideExecutionConfirmation).toHaveBeenCalledTimes(1);
  expect(transports.submitInteraction).not.toHaveBeenCalled();
});

/**
 * V31-28, pinning the status quo — deliberately not a fix.
 *
 * `answerAskMerchant` above takes its request from the caller because the
 * ask-merchant slot can render from the snapshot read leg before this hook's
 * own interaction poll lands: two legs, so the guard could be stale relative
 * to the card and clicks were silently swallowed.
 *
 * The execution confirmation has no second leg. `pendingExecutionConfirmation`
 * is derived from `interactionQuery`, the card mounts only when that value is
 * truthy, and it is handed that same value as `request` — so the guard cannot
 * be null while the card exists. That is why `answerExecutionConfirmation`
 * keeps its `if (!pendingExecutionConfirmation) return;` guard and does not
 * need the caller-supplied-request shape. This case exists so a future edit
 * that adds a second render leg for this card breaks here instead of
 * reintroducing the swallowed-click bug quietly.
 */
test('the execution confirmation card and its submit guard read one leg, so a rendered card always submits', async () => {
  const transports = createTransports({ interaction: EXECUTION_REQUEST });
  const view = renderInteractions({ transports });
  await waitFor(() =>
    expect(
      view.result.current.interactions.pendingExecutionConfirmation
    ).toEqual(EXECUTION_REQUEST)
  );

  // Leg 1 of the invariant: the card is rendered from the same value the guard
  // reads, and clicking it reaches Core.
  const request = view.result.current.interactions.pendingExecutionConfirmation;
  expect(request).not.toBeNull();
  render(
    <ExecutionConfirmationInteractionCard
      onRendererReady={async () => undefined}
      onSubmit={view.result.current.interactions.answerExecutionConfirmation}
      request={request!}
    />
  );
  await act(async () => {
    screen.getByRole('button', { name: '确认执行' }).click();
  });
  expect(transports.submitInteraction).toHaveBeenCalledWith(
    TASK.taskId,
    expect.objectContaining({ requestId: EXECUTION_REQUEST.requestId })
  );

  // Leg 2 of the invariant: there is exactly one mount of the card in the
  // product, and it is gated on — and passed — the same
  // `pendingExecutionConfirmation` the callback guards. A second mount fed by
  // any other read leg would make the guard staleable, which is precisely the
  // ask-merchant bug.
  const home = readFileSync(
    resolve(process.cwd(), 'src/product/composer/composer-home.tsx'),
    'utf8'
  );
  const mounts = home.match(/<ExecutionConfirmationInteractionCard\b/gu) ?? [];
  expect(mounts).toHaveLength(1);
  const mount = home.slice(
    home.indexOf('<ExecutionConfirmationInteractionCard')
  );
  expect(mount.slice(0, mount.indexOf('/>'))).toMatch(
    /request=\{pendingExecutionConfirmation\}/u
  );
  expect(
    home.slice(0, home.indexOf('<ExecutionConfirmationInteractionCard'))
  ).toMatch(/\{pendingExecutionConfirmation \? \($/mu);
});
