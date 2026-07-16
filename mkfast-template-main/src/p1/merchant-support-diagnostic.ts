export interface SupportUsageProjection {
  allowance: number;
  available: number;
  committed: number;
  released: number;
  reserved: number;
}

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
  entitlement: { usage: Record<string, SupportUsageProjection> };
  jobs: SupportJob[];
}

function quotaProjectionIsConsistent(usage: SupportUsageProjection) {
  return usage.available === usage.allowance - usage.reserved - usage.committed;
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
        refunded:
          run?.productUsage?.status === 'refunded'
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
    ledgerConsistent: Object.values(input.entitlement.usage).every(
      quotaProjectionIsConsistent
    ),
    quota: structuredClone(input.entitlement.usage),
  };
}
