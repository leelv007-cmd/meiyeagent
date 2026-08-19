import type { MerchantCreditDetail } from '@meiye/contracts';

export interface SupportJob {
  contract: {
    currency: string;
    estimatedAmount: number;
    operation: string;
  };
  failureCode?: string;
  id: string;
  productUsageQuantity?: number;
  status: string;
}

export interface SupportChildRun {
  failureCode?: string;
  productUsage?: { quantity: number; status: string };
  providerCost?: { amount: number; currency: string; status: string };
  runId: string;
  status?: string;
}

export interface MerchantSupportDiagnosticInput {
  contentPackages: Array<{
    generated: { childRuns: SupportChildRun[] };
    id: string;
  }>;
  creditDetail: MerchantCreditDetail;
  jobs: SupportJob[];
}

function projectCreditEvidence(detail: MerchantCreditDetail) {
  const activeBatches = detail.batches.filter(
    (batch) => batch.status === 'active'
  );
  return {
    activeBatchCount: activeBatches.length,
    availableCredits: activeBatches.reduce(
      (total, batch) => total + batch.remainingCredits,
      0
    ),
    recentTransactions: [...detail.transactions]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 20),
  };
}

export function buildMerchantSupportDiagnostic(
  input: MerchantSupportDiagnosticInput
) {
  const childRuns = new Map(
    input.contentPackages.flatMap((contentPackage) =>
      contentPackage.generated.childRuns.map((run) => [run.runId, run] as const)
    )
  );
  return {
    creditEvidence: projectCreditEvidence(input.creditDetail),
    jobs: input.jobs.map((job) => {
      const run = childRuns.get(job.id);
      return {
        ...(run?.providerCost
          ? {
              actual: {
                amount: run.providerCost.amount,
                currency: run.providerCost.currency,
              },
            }
          : { actual: null }),
        estimated: {
          amount: job.contract.estimatedAmount,
          currency: job.contract.currency,
        },
        id: job.id,
        operation: job.contract.operation,
        reason:
          run?.failureCode ??
          job.failureCode ??
          (job.status === 'completed' ? 'completed' : job.status),
        refunded: !run?.productUsage
          ? {
              reason: 'product_usage_refund_evidence_not_wired' as const,
              status: 'unknown' as const,
            }
          : run.productUsage.status === 'refunded'
            ? {
                quantity: run.productUsage.quantity,
                status: 'refunded' as const,
              }
            : {
                quantity: 0,
                status: 'not_refunded' as const,
              },
        status: job.status,
      };
    }),
  };
}
