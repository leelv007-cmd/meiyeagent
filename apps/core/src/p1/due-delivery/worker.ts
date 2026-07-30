import { randomUUID } from 'node:crypto';

export type DueDeliveryType = 'daily_recommendation' | 'task_recall';

export type DueDeliverySuppressionReason =
  | 'rest_day'
  | 'stale_business_date'
  | 'workspace_inactive';

export interface DailyRecommendationPayload {
  schemaVersion: 'daily-recommendation/v1';
  businessDate: string;
}

export interface TaskRecallPayload {
  schemaVersion: 'task-recall/v1';
  taskId: string;
  title: string;
  nextStep?: string;
}

export type DueDeliveryPayload =
  | DailyRecommendationPayload
  | TaskRecallPayload;

export interface DueDeliveryClaim {
  attemptCount: number;
  businessDate?: string;
  claimToken: string;
  dueAt: string;
  id: string;
  payload: DueDeliveryPayload;
  taskId: string;
  type: DueDeliveryType;
  workspaceId: string;
}

export interface DueDeliveryClaimIdentity {
  claimToken: string;
  dueId: string;
  workspaceId: string;
}

export interface NextDailyRecommendationDue {
  businessDate: string;
  dueAt: string;
  payload: DailyRecommendationPayload;
  taskId: string;
}

export interface DueDeliveryRepository {
  beginDelivery(input: {
    identity: DueDeliveryClaimIdentity;
    taskId: string;
    type: DueDeliveryType;
  }): Promise<{ runId: string } | null>;
  claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<DueDeliveryClaim[]>;
  settleDelivered(input: {
    identity: DueDeliveryClaimIdentity;
    nextDue?: NextDailyRecommendationDue;
    output: Record<string, unknown>;
    runId: string;
  }): Promise<boolean>;
  settleSuppressed(input: {
    identity: DueDeliveryClaimIdentity;
    nextDue?: NextDailyRecommendationDue;
    reason: DueDeliverySuppressionReason;
    suppressedAt: Date;
  }): Promise<boolean>;
  settleFailed(input: {
    deadLetter: boolean;
    error: string;
    failedAt: Date;
    identity: DueDeliveryClaimIdentity;
    retryAt: Date;
    runId?: string;
  }): Promise<boolean>;
}

export interface DueDeliveryEligibility {
  evaluate(claim: DueDeliveryClaim): Promise<{
    isRestDay: boolean;
    workspaceActive: boolean;
  }>;
}

export interface DueDeliveryPort {
  deliver(input: DueDeliveryClaim & {
    actorId: 'system:due-scanner';
    generationRequested: false;
    idempotencyKey: string;
    runId: string;
  }): Promise<{ output: Record<string, unknown> }>;
}

export interface DueDeliveryWorkerSummary {
  claimed: number;
  deadLettered: number;
  delivered: number;
  lost: number;
  retried: number;
  suppressed: number;
}

export class DueDeliveryWorker {
  private readonly batchSize: number;
  private readonly claimToken: () => string;
  private readonly clock: () => Date;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly repository: DueDeliveryRepository,
    private readonly eligibility: DueDeliveryEligibility,
    private readonly delivery: DueDeliveryPort,
    options: {
      batchSize?: number;
      claimToken?: () => string;
      clock?: () => Date;
      leaseMs?: number;
      maxAttempts?: number;
      maxRetryDelayMs?: number;
      retryDelayMs?: number;
    } = {},
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.claimToken = options.claimToken ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5 * 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
  }

  async runOnce(workerId: string): Promise<DueDeliveryWorkerSummary> {
    const summary: DueDeliveryWorkerSummary = {
      claimed: 0,
      deadLettered: 0,
      delivered: 0,
      lost: 0,
      retried: 0,
      suppressed: 0,
    };

    for (let index = 0; index < this.batchSize; index += 1) {
      const claimed = await this.repository.claimBatch({
        claimToken: this.claimToken(),
        leaseMs: this.leaseMs,
        limit: 1,
        now: this.clock(),
        workerId,
      });
      const item = claimed[0];
      if (!item) break;
      summary.claimed += 1;
      const identity: DueDeliveryClaimIdentity = {
        claimToken: item.claimToken,
        dueId: item.id,
        workspaceId: item.workspaceId,
      };
      let runId: string | undefined;
      try {
        const eligibility = await this.eligibility.evaluate(item);
        const evaluatedAt = this.clock();
        const staleBusinessDate = isStaleDailyRecommendation(
          item,
          evaluatedAt,
        );
        if (
          !eligibility.workspaceActive ||
          staleBusinessDate ||
          eligibility.isRestDay
        ) {
          const settled = await this.repository.settleSuppressed({
            identity,
            ...(!eligibility.workspaceActive
              ? {}
              : { nextDue: nextDailyRecommendation(item) }),
            reason: !eligibility.workspaceActive
              ? 'workspace_inactive'
              : staleBusinessDate
                ? 'stale_business_date'
                : 'rest_day',
            suppressedAt: evaluatedAt,
          });
          settled ? (summary.suppressed += 1) : (summary.lost += 1);
          continue;
        }

        const nextDue = nextDailyRecommendation(item);
        const run = await this.repository.beginDelivery({
          identity,
          taskId: item.taskId,
          type: item.type,
        });
        if (!run) {
          summary.lost += 1;
          continue;
        }
        runId = run.runId;
        const result = await this.delivery.deliver({
          ...item,
          actorId: 'system:due-scanner',
          generationRequested: false,
          idempotencyKey: runId,
          runId,
        });
        const settled = await this.repository.settleDelivered({
          identity,
          nextDue,
          output: result.output,
          runId,
        });
        settled ? (summary.delivered += 1) : (summary.lost += 1);
      } catch (error) {
        const failedAt = this.clock();
        const deadLetter = item.attemptCount >= this.maxAttempts;
        const retryDelay = Math.min(
          this.retryDelayMs * 2 ** Math.max(0, item.attemptCount - 1),
          this.maxRetryDelayMs,
        );
        const settled = await this.repository.settleFailed({
          deadLetter,
          error: error instanceof Error ? error.message : String(error),
          failedAt,
          identity,
          retryAt: new Date(failedAt.getTime() + retryDelay),
          ...(runId ? { runId } : {}),
        });
        if (!settled) {
          summary.lost += 1;
        } else if (deadLetter) {
          summary.deadLettered += 1;
        } else {
          summary.retried += 1;
        }
      }
    }

    return summary;
  }
}

function nextDailyRecommendation(
  claim: DueDeliveryClaim,
): NextDailyRecommendationDue | undefined {
  const current = dailyRecommendationBusinessDate(claim);
  if (current === undefined) {
    return undefined;
  }
  const businessDate = new Date(current + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    businessDate,
    dueAt: `${businessDate}T00:00:00.000Z`,
    payload: {
      businessDate,
      schemaVersion: 'daily-recommendation/v1',
    },
    taskId: `daily-rec_${claim.workspaceId}_${businessDate}`,
  };
}

function isStaleDailyRecommendation(claim: DueDeliveryClaim, now: Date) {
  const businessDate = dailyRecommendationBusinessDate(claim);
  return (
    businessDate !== undefined &&
    businessDate <
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function dailyRecommendationBusinessDate(
  claim: DueDeliveryClaim,
): number | undefined {
  if (claim.type !== 'daily_recommendation') {
    return undefined;
  }
  if (
    claim.payload.schemaVersion !== 'daily-recommendation/v1' ||
    !claim.businessDate ||
    claim.payload.businessDate !== claim.businessDate
  ) {
    throw new Error('Daily recommendation due payload is invalid.');
  }
  const current = Date.parse(`${claim.businessDate}T00:00:00.000Z`);
  if (!Number.isFinite(current)) {
    throw new Error('Daily recommendation businessDate is invalid.');
  }
  return current;
}
