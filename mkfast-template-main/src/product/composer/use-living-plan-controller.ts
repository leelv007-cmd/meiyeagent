import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { telemetryFetch } from '@/lib/product-telemetry';
import { getAgentWorkbenchHostStore } from '@/product/agent-workbench';

function activePlanRevision(): number | null {
  const workbench = getAgentWorkbenchHostStore().getState();
  const activePlan = workbench.activePlanId
    ? workbench.plans[workbench.activePlanId]
    : undefined;
  return activePlan?.revisions.at(-1)?.revision ?? null;
}

export function useLivingPlanController(input: {
  taskId: string | null;
  focusIntent(): void;
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
      void telemetryFetch(
        `/api/core/p1/composer/tasks/${encodeURIComponent(input.taskId)}/start`,
        {
          body: JSON.stringify({ planRevision: revision }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }
      ).then((response) => {
        if (!response.ok) toast.error('开始制作失败，请重试');
      });
    },
    [input]
  );

  const submitRevision = useCallback(
    (merchantInstruction: string): boolean => {
      if (!revising) return false;
      const revision = activePlanRevision();
      const instruction = merchantInstruction.trim();
      if (!input.taskId || !revision || !instruction) {
        toast.error('请先写下方案调整要求');
        return true;
      }
      void telemetryFetch(
        `/api/core/p1/composer/tasks/${encodeURIComponent(input.taskId)}/revise`,
        {
          body: JSON.stringify({
            planRevision: revision,
            merchantInstruction: instruction,
          }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }
      ).then((response) => {
        if (response.ok) setRevising(false);
        else toast.error('方案调整失败，请重试');
      });
      return true;
    },
    [input.taskId, revising]
  );

  return { onCommitAction, submitRevision };
}
