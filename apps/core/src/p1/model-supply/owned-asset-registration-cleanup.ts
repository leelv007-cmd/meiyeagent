import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type {
  AssetStorageReceipt,
  OwnedAssetRegistrationFailureRecord,
  S3CompatibleAssetStorage,
} from './s3-asset-storage.js';
import type { PostgresOwnedAssetCleanupClaimCoordinator } from './postgres-owned-asset-cleanup-claim.js';

export const S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND =
  'model-supply.s3-asset-registration-cleanup';
export const S3_ASSET_REGISTRATION_CLEANUP_SCHEDULE_ID =
  'model-supply.s3-asset-registration-cleanup.v1';
/** Gives an indeterminate database transaction time to settle before deletion. */
export const S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS = 10 * 60 * 1_000;

export interface ObjectReferenceVerifier {
  isReferenced(input: {
    assetId: string;
    receipt: AssetStorageReceipt;
    workspaceId: string;
  }): Promise<boolean>;
}

type CleanupClaimCoordinator = Pick<
  PostgresOwnedAssetCleanupClaimCoordinator,
  'cleanup'
>;

export interface FoundationOwnedAssetReadPort {
  getOwnedAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<{
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  } | null>;
}

export class FoundationOwnedAssetReferenceVerifier
  implements ObjectReferenceVerifier
{
  constructor(private readonly assets: FoundationOwnedAssetReadPort) {}

  async isReferenced(input: {
    assetId: string;
    receipt: AssetStorageReceipt;
    workspaceId: string;
  }) {
    const asset = await this.assets.getOwnedAsset(input.workspaceId, input.assetId);
    return Boolean(
      asset &&
        asset.objectKey === input.receipt.objectKey &&
        asset.sha256 === input.receipt.sha256 &&
        asset.sizeBytes === input.receipt.sizeBytes,
    );
  }
}

export interface S3AssetRegistrationCleanupSummary {
  alertCount: number;
  deferredCount: number;
  deletedCount: number;
  failedCount: number;
  referencedCount: number;
  targetCount: number;
}

/** Replays explicit failed registrations after checking the committed receipt. */
export class S3AssetRegistrationCleanupRunner {
  constructor(
    private readonly storage: S3CompatibleAssetStorage,
    private readonly references: ObjectReferenceVerifier,
    private readonly claims?: CleanupClaimCoordinator,
  ) {}

  async run(at = new Date().toISOString()): Promise<S3AssetRegistrationCleanupSummary> {
    const failures = await this.storage.listOwnedAssetRegistrationFailures();
    const summary: S3AssetRegistrationCleanupSummary = {
      alertCount: 0,
      deferredCount: 0,
      deletedCount: 0,
      failedCount: 0,
      referencedCount: 0,
      targetCount: failures.length,
    };
    for (const failure of failures) {
      const outcome = await this.replay(failure, at);
      if (outcome === 'deferred') summary.deferredCount += 1;
      else if (outcome === 'deleted') summary.deletedCount += 1;
      else if (outcome === 'referenced') summary.referencedCount += 1;
      else {
        summary.failedCount += 1;
        summary.alertCount += 1;
      }
    }
    return summary;
  }

  private async replay(
    failure: OwnedAssetRegistrationFailureRecord,
    at: string,
  ): Promise<'deferred' | 'deleted' | 'failed' | 'referenced'> {
    const elapsed = Date.parse(at) - Date.parse(failure.recordedAt);
    if (
      !Number.isFinite(elapsed) ||
      elapsed < S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS
    ) {
      return 'deferred';
    }
    if (this.claims) {
      const outcome = await this.claims.cleanup(failure);
      if (outcome === 'deleted' || outcome === 'referenced') {
        return this.resolve(failure, outcome, at);
      }
      return outcome;
    }
    try {
      if (!failure.storageRevision) {
        throw new Error('Shared asset cleanup has no receipt storage revision.');
      }
      const state = await this.storage.inspectSharedObject(failure.objectKey);
      if (!state.objectExists && !state.receipt) {
        return this.resolve(failure, 'deleted', at);
      }
      if (!state.receipt) {
        throw new Error('Shared asset object is present without a durable receipt.');
      }
      if (state.receipt.storageRevision !== failure.storageRevision) {
        if (!state.objectExists) {
          throw new Error('Shared asset receipt has no matching object generation.');
        }
        await this.storage.readReceipt(failure.objectKey);
        return this.resolve(failure, 'referenced', at);
      }
      const receipt = state.objectExists
        ? await this.storage.readReceipt(failure.objectKey)
        : state.receipt;
      const reference = {
        assetId: failure.assetId,
        receipt,
        workspaceId: failure.workspaceId,
      };
      if (await this.references.isReferenced(reference)) {
        return this.resolve(failure, 'referenced', at);
      }
      // Re-check immediately before deletion so a just-committed asset wins.
      if (await this.references.isReferenced(reference)) {
        return this.resolve(failure, 'referenced', at);
      }
      await this.storage.deleteSharedObject(failure.objectKey);
      const afterDelete = await this.storage.inspectSharedObject(failure.objectKey);
      if (afterDelete.objectExists || afterDelete.receipt) {
        throw new Error('Shared asset deletion did not remove its object and receipt together.');
      }
      return this.resolve(failure, 'deleted', at);
    } catch (error) {
      const state = await this.storage.inspectSharedObject(failure.objectKey);
      if (!state.objectExists && !state.receipt) {
        return this.resolve(failure, 'deleted', at);
      }
      return 'failed';
    }
  }

  private async resolve(
    failure: OwnedAssetRegistrationFailureRecord,
    outcome: 'deleted' | 'referenced',
    at: string,
  ) {
    await this.storage.resolveOwnedAssetRegistrationFailure({
      failure,
      outcome,
      resolvedAt: at,
    });
    return outcome;
  }
}

export function createS3AssetRegistrationCleanupJobHandler(
  runner: Pick<S3AssetRegistrationCleanupRunner, 'run'>,
): JobRuntimeHandler {
  return async (envelope, worker) => {
    if (envelope.kind !== S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND) {
      return { output: { code: 'UNSUPPORTED_JOB_KIND' }, status: 'dead_letter' };
    }
    try {
      const summary = await runner.run(worker.claimedAt);
      return {
        output: {
          ...summary,
          ...(summary.failedCount > 0
            ? { alertCode: 'S3_ASSET_CLEANUP_RETRY_REQUIRED' }
            : {}),
        },
        status: summary.failedCount > 0 ? 'retry' : 'completed',
      };
    } catch (error) {
      return {
        output: {
          alertCode: 'S3_ASSET_CLEANUP_RETRY_REQUIRED',
          message: error instanceof Error ? error.message : 'Unknown cleanup error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerS3AssetRegistrationCleanupSchedule(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
) {
  return runtime.scheduleRecurring({
    cron: '*/5 * * * *',
    kind: S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND,
    payload: {},
    scheduleId: S3_ASSET_REGISTRATION_CLEANUP_SCHEDULE_ID,
    timezone: 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
