import { p1HttpPath } from '@meiye/contracts';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';
import { reconnectAgentWorkbench } from '@/product/agent-workbench/agent-event-client';
import { getAgentWorkbenchHostStore } from '@/product/agent-workbench/agent-event-store';
import { loadAgentWorkbenchReplay } from '@/product/agent-workbench/agent-event-transport';
import { listPendingInterrupts } from '@/product/agent-workbench/typed-interrupt-client';
import { composerSubmissionResultSchema } from '@/product/composer/composer-submission-client';
import { decideExecutionConfirmation } from '@/product/harness-client';
import { isComposerClarificationInterrupt } from './composer-pending-interrupt-gate';

/** Revise/answer-style command bodies vary; drain + error-envelope only. */
const livingPlanReviseResultSchema = z.unknown();

function activePlanRevision(): number | null {
  const workbench = getAgentWorkbenchHostStore().getState();
  const activePlan = workbench.activePlanId
    ? workbench.plans[workbench.activePlanId]
    : undefined;
  return activePlan?.revisions.at(-1)?.revision ?? null;
}

function hasPendingPlanClarification(): boolean {
  return getAgentWorkbenchHostStore()
    .getState()
    .pendingInterrupts.some(isComposerClarificationInterrupt);
}

const LIVING_PLAN_REPLAY_RETRY_MS = 400;
const LIVING_PLAN_REPLAY_ATTEMPTS = 6;

/**
 * After /revise or /start the Thread may already have plan.revised in the
 * store/outbox. Reconnect is the same recovery entry the live loop uses, so
 * Living Plan / plan-diff update even if the SSE frame is still in flight.
 * The outbox can lag the start transaction by ~1s; retry until the revision
 * we expect is in the workbench (or the attempts run out).
 */
async function refreshLivingPlanReplayOnce(): Promise<void> {
  const store = getAgentWorkbenchHostStore();
  const session = store.getState().session;
  if (!session?.threadId) return;
  await reconnectAgentWorkbench({
    store,
    loadReplay: loadAgentWorkbenchReplay,
    resourceId: session.resourceId,
    threadId: session.threadId,
  });
  try {
    const pending = await listPendingInterrupts({ threadId: session.threadId });
    store.dispatch({
      type: 'set_pending_interrupts',
      interrupts: pending.map((interrupt) => ({
        interruptId: interrupt.interruptId,
        interruptType: interrupt.action,
        description: interrupt.description,
        revision: interrupt.revision,
        schemaVersion: interrupt.schemaVersion,
        allowAccept: interrupt.config.allowAccept,
        allowReject: interrupt.config.allowReject,
        streamOffset: '0',
      })),
    });
  } catch {
    // Replay already applied. A missing interrupt list must not undo the plan.
  }
}

async function refreshLivingPlanReplay(
  minRevision?: number | null
): Promise<void> {
  await refreshLivingPlanReplayOnce();
  if (minRevision == null) return;
  if (!getAgentWorkbenchHostStore().getState().session?.threadId) return;
  for (let attempt = 0; attempt < LIVING_PLAN_REPLAY_ATTEMPTS; attempt++) {
    const revision = activePlanRevision();
    if (revision != null && revision >= minRevision) return;
    await new Promise((resolve) =>
      setTimeout(resolve, LIVING_PLAN_REPLAY_RETRY_MS)
    );
    await refreshLivingPlanReplayOnce();
  }
}

export function useLivingPlanController(input: {
  taskId: string | null;
  /** Authority the paid plan is waiting on; absent for an exempt (copy) plan. */
  executionConfirmationRequestId?: string | null;
  /**
   * Paid merchant_confirmed plans must record decide before /start. Copy stays
   * exempt (D-043). When true, a missing request id must not POST start.
   */
  requiresMerchantConfirmation?: boolean;
  focusIntent(): void;
  decideConfirmation?: typeof decideExecutionConfirmation;
}) {
  const [revising, setRevising] = useState(false);
  const startingTaskIdRef = useRef<string | null>(null);
  /**
   * V31-105 §10 — the task whose start Core has already accepted.
   *
   * `startingTaskIdRef` only covers the POST itself and is cleared in the
   * `finally`; the run outlives it by minutes. This is the browser's own record
   * that 开始制作 has been spent, and it is what stops the strip from offering
   * the button again during a window where Core answers
   * `COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE`.
   */
  const [startedTaskId, setStartedTaskId] = useState<string | null>(null);

  const onCommitAction = useCallback(
    (action: 'revise' | 'start') => {
      if (action === 'revise') {
        setRevising(true);
        input.focusIntent();
        return;
      }
      const revision = activePlanRevision();
      if (!input.taskId || !revision) {
        toast.error('方案还没有准备好，请稍后重试');
        return;
      }
      const requestId = input.executionConfirmationRequestId?.trim() ?? '';
      if (input.requiresMerchantConfirmation === true && !requestId) {
        toast.error('方案确认还没落实，请稍等一下再开始。');
        return;
      }
      if (startingTaskIdRef.current === input.taskId) return;
      startingTaskIdRef.current = input.taskId;
      setRevising(false);
      const taskId = input.taskId;
      const decide = input.decideConfirmation ?? decideExecutionConfirmation;
      void (async () => {
        // The strip already showed the reserved credits and the refund rule, so
        // pressing 开始制作 is the merchant's billing consent. Record that
        // immutable decision first: the confirmation authority rejects any paid
        // start whose request is not already `decided`, which is why this strip
        // could not start a paid plan at all before the decision was wired.
        try {
          if (requestId) {
            try {
              const decided = await decide(requestId, {
                decisionId: `living-plan-commit:${requestId}`,
                decision: 'confirmed',
                decidedAt: new Date().toISOString(),
              });
              if (
                decided.request.status !== 'decided' ||
                decided.decision.decision !== 'confirmed'
              ) {
                toast.error('方案确认还没落实，请稍等一下再开始。');
                return;
              }
            } catch {
              toast.error('方案确认失败，请重试');
              return;
            }
          }
          try {
            const response = await telemetryFetch(
              p1HttpPath('composer.start_task', { taskId }),
              {
                body: JSON.stringify({ planRevision: revision }),
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                method: 'POST',
              }
            );
            await readP1Envelope(
              response,
              composerSubmissionResultSchema,
              // Merchant-visible, not a log line. merchantMessageFromP1 returns
              // this fallback whenever the envelope carries a code it does not
              // map and a message it will not render (anything with Latin words
              // in it), so leaving it in English would have published "Composer
              // start failed." to the merchant the moment we began surfacing
              // this message at all.
              '开始制作失败，请重试。'
            );
          } catch (error) {
            // Core distinguishes fifteen reasons a start can be refused and ships
            // merchant-ready copy with each (V31-91); readP1Envelope has already
            // turned the envelope into that merchant message. Discarding it here
            // was what made all fifteen arrive as one generic retry prompt —
            // "先确认方案" and "这次制作已经在跑了" told the merchant the same
            // unhelpful thing.
            toast.error(
              error instanceof Error ? error.message : '开始制作失败，请重试'
            );
            return;
          }
          // Accepted. From here until the Work is delivered or failed a second
          // start is a refusal, so the strip must stop offering one.
          setStartedTaskId(taskId);
          // Price-drift successor (V31-63) appends plan.revised in the start
          // transaction via the outbox. Replay until the next revision is
          // visible — a single shot races the ~1s outbox loop.
          //
          // This is deliberately outside the catch above. The start has already
          // been accepted by the time we get here, so a replay failure is the
          // view failing to catch up, not the work failing to begin. Reporting it
          // as a start failure invited the merchant to press 开始制作 again on a
          // run that was already going.
          try {
            const seen = activePlanRevision();
            await refreshLivingPlanReplay(seen == null ? 2 : seen + 1);
          } catch {
            toast.warning('已开始制作，但页面没能刷新，请稍后重新打开方案。');
          }
        } finally {
          if (startingTaskIdRef.current === taskId) {
            startingTaskIdRef.current = null;
          }
        }
      })();
    },
    [input]
  );

  const submitPlanCommand = useCallback(
    (merchantInstruction: string): boolean => {
      const instruction = merchantInstruction.trim();
      if (hasPendingPlanClarification()) {
        if (!input.taskId || !instruction) {
          toast.error('请先写下补充信息');
          return true;
        }
        void telemetryFetch(
          p1HttpPath('composer.answer_task', { taskId: input.taskId }),
          {
            body: JSON.stringify({ merchantAnswer: instruction }),
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }
        ).then((response) => {
          if (!response.ok) toast.error('补充信息提交失败，请重试');
        });
        return true;
      }
      if (!revising) return false;
      const revision = activePlanRevision();
      if (!input.taskId || !revision || !instruction) {
        toast.error('请先写下方案调整要求');
        return true;
      }
      const taskId = input.taskId;
      void (async () => {
        try {
          const response = await telemetryFetch(
            p1HttpPath('composer.revise_task', { taskId }),
            {
              body: JSON.stringify({
                planRevision: revision,
                merchantInstruction: instruction,
              }),
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              method: 'POST',
            }
          );
          await readP1Envelope(
            response,
            livingPlanReviseResultSchema,
            'Composer revise failed.'
          );
          const seen = activePlanRevision();
          await refreshLivingPlanReplay(seen == null ? 2 : seen + 1);
          setRevising(false);
        } catch {
          toast.error('方案调整失败，请重试');
        }
      })();
      return true;
    },
    [input.taskId, revising]
  );

  return {
    onCommitAction,
    revising,
    /** True while this task's accepted start has not reported back. */
    startInFlight: startedTaskId !== null && startedTaskId === input.taskId,
    submitPlanCommand,
  };
}
