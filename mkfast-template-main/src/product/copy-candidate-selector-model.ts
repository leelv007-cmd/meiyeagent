import type {
  ContentPackage,
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
  CreativeWork,
} from '@meiye/contracts';
import { m } from '@/locale/paraglide/messages';

const CANDIDATE_LABELS = ['A', 'B', 'C'] as const;
const MAX_QUALITY_RETRIES = 2;

export function toggleOrderedVisualAsset(
  orderedAssetIds: string[],
  assetId: string
) {
  return orderedAssetIds.includes(assetId)
    ? orderedAssetIds.filter((currentId) => currentId !== assetId)
    : [...orderedAssetIds, assetId];
}

export function moveOrderedVisualAsset(
  orderedAssetIds: string[],
  assetId: string,
  offset: -1 | 1
) {
  const currentIndex = orderedAssetIds.indexOf(assetId);
  const nextIndex = currentIndex + offset;
  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= orderedAssetIds.length
  ) {
    return orderedAssetIds;
  }
  const next = [...orderedAssetIds];
  [next[currentIndex], next[nextIndex]] = [
    next[nextIndex]!,
    next[currentIndex]!,
  ];
  return next;
}

export function currentCreativeJobForWork(
  work: CreativeWork | undefined,
  jobs: CreativeJob[]
) {
  if (!work) return undefined;
  const workJobs = jobs.filter((job) => job.workId === work.id);
  if (work.currentJobId) {
    return workJobs.find((job) => job.id === work.currentJobId);
  }
  return workJobs.reduce<CreativeJob | undefined>(
    (current, job) =>
      !current || job.updatedAt >= current.updatedAt ? job : current,
    undefined
  );
}

export interface CopyCandidateOption {
  accepted: boolean;
  asset: CreativeAssetProjection;
  label: (typeof CANDIDATE_LABELS)[number];
}

export interface CopyCandidateSelectorModel {
  acceptedAssetId?: string;
  acceptedPackageId?: string;
  batchLabel: string;
  candidates: CopyCandidateOption[];
  canAccept: boolean;
  canPaidReroll: boolean;
  canQualityRetry: boolean;
  currentUsageLabel: string;
  paidUsageLabel: string;
  qualityUsageLabel: string;
  remainingQualityRetries: number;
  selectedAssetId?: string;
  status: 'accepted' | 'invalid' | 'ready';
  usedQualityRetries: number;
}

export function buildCopyCandidateSelectorModel(input: {
  assets: CreativeAssetProjection[];
  contents: CreativeContent[];
  job: CreativeJob;
  packages?: ContentPackage[];
  selectedAssetId?: string;
}): CopyCandidateSelectorModel {
  const copyAssets = input.assets
    .filter((asset) => asset.jobId === input.job.id && asset.kind === 'text')
    .sort(
      (left, right) =>
        (left.candidateIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.candidateIndex ?? Number.MAX_SAFE_INTEGER)
    );
  const completeBatch =
    input.job.status === 'completed' &&
    input.job.contract.operation === 'copy.generate' &&
    input.job.outputAssetIds.length === CANDIDATE_LABELS.length &&
    copyAssets.length === CANDIDATE_LABELS.length &&
    copyAssets.every(
      (asset, index) =>
        asset.candidateIndex === index &&
        input.job.outputAssetIds.includes(asset.id)
    );
  const batchNumber =
    Number.isInteger(input.job.batchNumber) && (input.job.batchNumber ?? 0) > 0
      ? input.job.batchNumber
      : undefined;
  const usedQualityRetries = Math.min(
    MAX_QUALITY_RETRIES,
    Math.max(0, input.job.qualityRetryNumber ?? 0)
  );
  const remainingQualityRetries = MAX_QUALITY_RETRIES - usedQualityRetries;
  const currentUsageLabel =
    input.job.productUsageQuantity === 1
      ? m.copy_candidate_usage_paid_batch()
      : input.job.productUsageQuantity === 0
        ? m.copy_candidate_usage_quality_retry()
        : m.copy_candidate_usage_unavailable();
  const qualityUsageLabel =
    remainingQualityRetries > 0
      ? m.copy_candidate_quality_usage_remaining({
          maximum: MAX_QUALITY_RETRIES,
          remaining: remainingQualityRetries,
        })
      : m.copy_candidate_quality_usage_exhausted({
          maximum: MAX_QUALITY_RETRIES,
        });
  const base = {
    batchLabel: batchNumber
      ? m.copy_candidate_batch({ number: batchNumber })
      : m.copy_candidate_historical_batch(),
    currentUsageLabel,
    paidUsageLabel: m.copy_candidate_paid_usage(),
    qualityUsageLabel,
    remainingQualityRetries,
    usedQualityRetries,
  };

  if (!completeBatch) {
    return {
      ...base,
      candidates: [],
      canAccept: false,
      canPaidReroll: false,
      canQualityRetry: false,
      status: 'invalid',
    };
  }

  const jobContents = input.contents.filter(
    (content) => content.jobId === input.job.id
  );
  const adoptedPackage = input.packages?.find(
    (contentPackage) => contentPackage.source.workId === input.job.workId
  );
  const acceptedAssetId = copyAssets.find(
    (asset) =>
      adoptedPackage?.source.assetIds.includes(asset.id) ||
      jobContents.some((content) => content.assetIds.includes(asset.id))
  )?.id;
  const hasAcceptedContent =
    Boolean(adoptedPackage) ||
    jobContents.length > 0 ||
    input.job.outputContentIds.length > 0;
  const requestedSelection = copyAssets.some(
    (asset) => asset.id === input.selectedAssetId
  )
    ? input.selectedAssetId
    : undefined;
  const selectedAssetId = acceptedAssetId ?? requestedSelection;
  const status = hasAcceptedContent ? 'accepted' : 'ready';
  const candidates = copyAssets.map((asset, index) => ({
    accepted: asset.id === acceptedAssetId,
    asset,
    label: CANDIDATE_LABELS[index]!,
  }));

  return {
    ...base,
    ...(acceptedAssetId ? { acceptedAssetId } : {}),
    ...(adoptedPackage ? { acceptedPackageId: adoptedPackage.id } : {}),
    candidates,
    canAccept: status === 'ready' && Boolean(selectedAssetId),
    canPaidReroll: status === 'ready',
    canQualityRetry: status === 'ready' && remainingQualityRetries > 0,
    ...(selectedAssetId ? { selectedAssetId } : {}),
    status,
  };
}

export type CopyCandidateCommandInput =
  | {
      action: 'accept';
      assetId: string;
      clickToken: string;
      jobId: string;
      visualAssetIds: string[];
      workId: string;
    }
  | {
      action: 'paid-reroll' | 'quality-retry';
      clickToken: string;
      jobId: string;
    };

export function copyCandidateActionErrorMessage(
  action: CopyCandidateCommandInput['action']
) {
  if (action === 'accept') {
    return m.copy_candidate_accept_failed();
  }
  if (action === 'paid-reroll') {
    return m.copy_candidate_paid_reroll_failed();
  }
  return m.copy_candidate_quality_retry_failed();
}

export interface CopyCandidateCommand {
  action:
    | 'adopt_into_content_package'
    | 'quality_retry_creative_job'
    | 'reroll_creative_job';
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export function createCopyCandidateCommand(
  input: CopyCandidateCommandInput
): CopyCandidateCommand {
  if (!input.clickToken.trim() || !input.jobId.trim()) {
    throw new Error('A job id and one stable click token are required.');
  }
  const idempotencyKey = [
    'copy-candidate',
    input.action,
    input.jobId,
    input.clickToken,
  ].join(':');

  if (input.action === 'accept') {
    if (!input.assetId.trim() || !input.workId.trim()) {
      throw new Error('A Work and selected candidate Asset are required.');
    }
    return {
      action: 'adopt_into_content_package',
      idempotencyKey,
      payload: {
        copyCandidateAssetId: input.assetId,
        visualAssetIds: input.visualAssetIds,
        workId: input.workId,
      },
    };
  }

  return {
    action:
      input.action === 'paid-reroll'
        ? 'reroll_creative_job'
        : 'quality_retry_creative_job',
    idempotencyKey,
    payload: {
      jobId: input.jobId,
      submissionKey: idempotencyKey,
    },
  };
}
