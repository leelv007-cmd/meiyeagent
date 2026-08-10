import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';
import { getAgentWorkbenchHostStore } from '@/product/agent-workbench';
import { composerSubmissionResultSchema } from '@/product/composer/composer-submission-client';
import { decideExecutionConfirmation } from '@/product/harness-client';

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
    .pendingInterrupts.some((item) => item.interruptType === 'answer_question');
}

export function useLivingPlanController(input: {
  taskId: string | null;
  /** Authority the paid plan is waiting on; absent for an exempt (copy) plan. */
  executionConfirmationRequestId?: string | null;
  focusIntent(): void;
  decideConfirmation?: typeof decideExecutionConfirmation;
}) {
  const [revising, setRevising] = useState(false);

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
      setRevising(false);
      const taskId = input.taskId;
      const requestId = input.executionConfirmationRequestId;
      const decide = input.decideConfirmation ?? decideExecutionConfirmation;
      void (async () => {
        // The strip already showed the reserved credits and the refund rule, so
        // pressing 开始制作 is the merchant's billing consent. Record that
        // immutable decision first: the confirmation authority rejects any paid
        // start whose request is not already `decided`, which is why this strip
        // could not start a paid plan at all before the decision was wired.
        if (requestId) {
          try {
            await decide(requestId, {
              decisionId: `living-plan-commit:${requestId}`,
              decision: 'confirmed',
              decidedAt: new Date().toISOString(),
            });
          } catch {
            toast.error('方案确认失败，请重试');
            return;
          }
        }
        try {
          const response = await telemetryFetch(
            `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/start`,
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
            'Composer start failed.'
          );
        } catch {
          toast.error('开始制作失败，请重试');
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
          `/api/core/p1/composer/tasks/${encodeURIComponent(input.taskId)}/answer`,
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
            `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/revise`,
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
          setRevising(false);
        } catch {
          toast.error('方案调整失败，请重试');
        }
      })();
      return true;
    },
    [input.taskId, revising]
  );

  return { onCommitAction, revising, submitPlanCommand };
}
