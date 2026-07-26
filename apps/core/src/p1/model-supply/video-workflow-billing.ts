import { P1DomainError } from '../foundation/domain.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import type { BillingLifecyclePort } from '../product-billing/lifecycle-port.js';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';

export type DurableInitialVideoBilling = ProductBillingApplicationPort &
  BillingLifecyclePort;

export interface VideoWorkflowTerminalObserver {
  settle(workflow: DurableVideoWorkflow): Promise<unknown> | unknown;
}

/** Settles the parent Operations quote only when the initial video run is terminal. */
export function createInitialVideoTerminalObserver(options: {
  billing: DurableInitialVideoBilling;
}): VideoWorkflowTerminalObserver {
  return {
    async settle(workflow) {
      const taskId = workflow.billingTaskId;
      if (!taskId || !workflow.billingQuoteRevision) return null;
      if (!isTerminal(workflow.status)) return null;

      const quote = await options.billing.getQuoteByTask(
        taskId,
        workflow.workspaceId,
      );
      if (!quote) {
        throw new P1DomainError(
          'NOT_FOUND',
          `Product quote for initial video task ${taskId} was not found.`,
        );
      }
      if (quote.revision !== workflow.billingQuoteRevision) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Product quote ${quote.quoteId} revision no longer matches the initial video contract.`,
        );
      }
      if (
        quote.lifecycleStatus === 'settled' ||
        quote.lifecycleStatus === 'refunded'
      ) {
        return {
          quote,
          usage: await options.billing.getUsage(
            taskId,
            workflow.workspaceId,
          ),
        };
      }

      const attempt = workflow.attempts.at(-1);
      if (!attempt) {
        if (workflow.status === 'completed') {
          throw new P1DomainError(
            'INVALID_STATE',
            'A completed initial video workflow requires real attempt evidence.',
          );
        }
        return options.billing.failAndRefund({
          quoteId: quote.quoteId,
          reason:
            workflow.status === 'cancelled'
              ? 'initial_video_cancelled_before_attempt'
              : 'initial_video_failed_before_attempt',
          workspaceId: workflow.workspaceId,
        });
      }

      await options.billing.settleTask({
        attemptId: attempt.id,
        deploymentId: attempt.deploymentId,
        providerCost: initialVideoProviderCost(workflow, attempt.id),
        status: workflow.status === 'completed' ? 'completed' : 'failed',
        taskId,
        workspaceId: workflow.workspaceId,
      });
      return {
        quote: await options.billing.getQuoteByTask(
          taskId,
          workflow.workspaceId,
        ),
        usage: await options.billing.getUsage(taskId, workflow.workspaceId),
      };
    },
  };
}

/** Runs independent terminal observers in order so replay preserves settlement ordering. */
export function composeVideoTerminalObservers(
  ...observers: VideoWorkflowTerminalObserver[]
): VideoWorkflowTerminalObserver {
  return {
    async settle(workflow) {
      const results = [];
      for (const observer of observers) {
        results.push(await observer.settle(workflow));
      }
      return results;
    },
  };
}

function initialVideoProviderCost(
  workflow: DurableVideoWorkflow,
  attemptId: string,
) {
  const candidate = workflow.shots
    .flatMap((shot) => shot.candidates)
    .find((item) => item.attempts.some((attempt) => attempt.id === attemptId));
  if (!candidate) return undefined;
  const route = workflow.routeSnapshot?.allowedCandidates?.find(
    (item) => item.deploymentId === candidate.attempt.deploymentId,
  );
  const cost = candidate.providerCost;
  return {
    currency: cost.currency,
    ...(cost.status === 'observed'
      ? {
          observedCostMicros: Math.max(
            0,
            Math.round(cost.amount * 1_000_000),
          ),
        }
      : {
          estimatedCostMicros: Math.max(
            0,
            Math.round(cost.amount * 1_000_000),
          ),
        }),
    evidence: `composedVideoProviderCost=${cost.id}`,
    evidenceKind:
      cost.status === 'observed'
        ? ('provider_bill' as const)
        : ('estimated' as const),
    payer:
      workflow.routeSnapshot?.credentialMode === 'byok_strict'
        ? ('workspace_byok' as const)
        : ('platform' as const),
    supplierPriceRevision:
      route?.priceRevision ??
      workflow.routeSnapshot?.priceRevision ??
      'unknown',
    unit: route?.unit ?? 'request',
    unitPriceMicros: route?.unitPriceMicros ?? 0,
    ...(cost.usage.mediaUnits !== undefined
      ? { usageQuantity: cost.usage.mediaUnits, usageUnit: 'media_unit' }
      : {}),
  };
}

function isTerminal(status: DurableVideoWorkflow['status']) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
