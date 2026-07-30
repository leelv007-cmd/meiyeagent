import { createHash } from 'node:crypto';

import {
  BOUNDED_EXECUTION_LIMITS,
  boundedExecutionSnapshotSchema,
  type BoundedExecutionLimitName,
  type BoundedExecutionSnapshot,
} from '@meiye/contracts';
import { z } from 'zod';

import {
  BoundedExecutionResumeError,
  type BoundedExecutionSuspension,
} from './bounded-execution-controller.js';
import type { RouteSnapshot } from '../model-supply/route-contracts.js';

const mediaAttemptCheckpointSchema = z
  .object({
    jobId: z.string().trim().min(1),
    role: z.enum(['primary', 'exact_text_retry']),
    status: z.literal('completed'),
  })
  .strict();

const receiptDigestSchema = z
  .object({
    id: z.string().trim().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const exactTextRouteSnapshotSchema = z.custom<RouteSnapshot>((input) => {
  if (!input || typeof input !== 'object') return false;
  const route = input as Partial<RouteSnapshot>;
  const candidate = route.allowedCandidates?.[0];
  return (
    route.requestedSelection?.mode === 'fixed' &&
    typeof route.requestedSelection.catalogModelId === 'string' &&
    route.requestedSelection.catalogModelId.length > 0 &&
    route.requestedSelection.fallbackConsent === false &&
    route.candidateCatalogModelIds?.length === 1 &&
    route.candidateCatalogModelIds[0] === route.actualCatalogModelId &&
    route.requestedSelection.catalogModelId === route.actualCatalogModelId &&
    route.maxAttempts === 1 &&
    route.fallbackAuthorized === false &&
    route.fallbackConsent === false &&
    route.allowedCandidates?.length === 1 &&
    candidate?.catalogModelId === route.actualCatalogModelId &&
    candidate.deploymentId === route.deploymentId &&
    candidate.modelOperations.includes('text.respond')
  );
}, 'A frozen exact-text route must be fixed to one text.respond candidate without fallback.');

const exactTextRouteSchema = z
  .object({
    snapshot: exactTextRouteSnapshotSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((route, context) => {
    if (mediaBoundedRequestFingerprint(route.snapshot) !== route.digest) {
      context.addIssue({
        code: 'custom',
        message: 'The frozen exact-text route digest does not match its snapshot.',
        path: ['digest'],
      });
    }
  });

export const mediaBoundedCurrentBestSchema = z
  .object({
    schemaVersion: z.literal('harness-media-current-best/v1'),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    executionRootFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    kind: z.enum(['image', 'video']),
    phase: z.enum([
      'before_submit',
      'provider_route_suspended',
      'next_effect',
      'ready',
      'verify_primary',
      'exact_text_retry',
      'verify_retry',
      'exact_text_failed',
    ]),
    attempts: z.array(mediaAttemptCheckpointSchema).max(2),
    asset: z
      .object({
        id: z.string().trim().min(1),
        sha256: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    countedAttemptIds: z.array(z.string().trim().min(1)),
    countedProviderCostIds: z.array(z.string().trim().min(1)),
    attemptReceiptDigests: z.array(receiptDigestSchema),
    providerCostReceiptDigests: z.array(receiptDigestSchema),
    providerRoute: z
      .object({
        jobId: z.string().trim().min(1),
        resultDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        lifecycleBaselineMs: z.number().int().nonnegative().safe(),
      })
      .strict()
      .optional(),
    exactTextRoute: exactTextRouteSchema.optional(),
    exactTextFailure: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const jobIds = checkpoint.attempts.map(({ jobId }) => jobId);
    const roles = checkpoint.attempts.map(({ role }) => role);
    const attemptDigestIds = checkpoint.attemptReceiptDigests.map(({ id }) => id);
    const costDigestIds = checkpoint.providerCostReceiptDigests.map(({ id }) => id);
    if (
      new Set(jobIds).size !== jobIds.length ||
      new Set(roles).size !== roles.length ||
      new Set(checkpoint.countedAttemptIds).size !==
        checkpoint.countedAttemptIds.length ||
      new Set(checkpoint.countedProviderCostIds).size !==
        checkpoint.countedProviderCostIds.length ||
      new Set(attemptDigestIds).size !== attemptDigestIds.length ||
      new Set(costDigestIds).size !== costDigestIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Media bounded checkpoint receipt identifiers must be unique.',
      });
    }
    if (
      [...checkpoint.countedAttemptIds].sort().join('\n') !==
        [...attemptDigestIds].sort().join('\n') ||
      [...checkpoint.countedProviderCostIds].sort().join('\n') !==
        [...costDigestIds].sort().join('\n')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Media bounded counted receipts require matching digests.',
      });
    }
    if (
      roles[0] !== undefined &&
      (roles[0] !== 'primary' ||
        (roles[1] !== undefined && roles[1] !== 'exact_text_retry'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Media bounded checkpoint attempts must follow the primary/retry order.',
        path: ['attempts'],
      });
    }
    if (
      checkpoint.phase === 'before_submit' &&
      (checkpoint.attempts.length !== 0 ||
        checkpoint.asset !== undefined ||
        checkpoint.exactTextRoute !== undefined ||
        checkpoint.exactTextFailure !== undefined ||
        checkpoint.countedAttemptIds.length !== 0 ||
        checkpoint.countedProviderCostIds.length !== 0 ||
        checkpoint.attemptReceiptDigests.length !== 0 ||
        checkpoint.providerCostReceiptDigests.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A pre-submit media checkpoint cannot contain provider receipts.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase === 'provider_route_suspended' &&
      (checkpoint.attempts.length !== 0 ||
        checkpoint.asset !== undefined ||
        checkpoint.exactTextRoute !== undefined ||
        checkpoint.exactTextFailure !== undefined ||
        checkpoint.providerRoute === undefined ||
        checkpoint.countedAttemptIds.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A provider-route suspension requires one durable job and consumed provider attempts.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase !== 'provider_route_suspended' &&
      checkpoint.providerRoute !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A provider-route checkpoint is valid only while the route is suspended.',
        path: ['providerRoute'],
      });
    }
    if (
      checkpoint.phase === 'next_effect' &&
      (checkpoint.attempts.length !== 0 ||
        checkpoint.asset !== undefined ||
        checkpoint.exactTextRoute !== undefined ||
        checkpoint.exactTextFailure !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A next-effect checkpoint can carry only prior receipt facts.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase !== 'before_submit' &&
      checkpoint.phase !== 'provider_route_suspended' &&
      checkpoint.phase !== 'next_effect' &&
      (checkpoint.attempts.length === 0 || checkpoint.asset === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A post-submit media checkpoint requires a durable job.',
        path: ['attempts'],
      });
    }
    if (
      checkpoint.phase === 'verify_primary' &&
      (checkpoint.kind !== 'image' ||
        checkpoint.exactTextFailure !== undefined ||
        checkpoint.attempts.length !== 1 ||
        checkpoint.attempts[0]?.role !== 'primary')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A primary verification checkpoint requires one completed image.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase === 'exact_text_retry' &&
      (!checkpoint.exactTextFailure ||
        checkpoint.attempts.length !== 1 ||
        checkpoint.attempts[0]?.role !== 'primary')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An exact-text retry checkpoint requires the failed assessment.',
        path: ['exactTextFailure'],
      });
    }
    if (
      checkpoint.phase === 'verify_retry' &&
      (checkpoint.kind !== 'image' ||
        !checkpoint.exactTextFailure ||
        checkpoint.attempts.length !== 2 ||
        checkpoint.attempts[1]?.role !== 'exact_text_retry')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A retry verification checkpoint requires both completed image attempts.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase === 'exact_text_failed' &&
      (!checkpoint.exactTextFailure ||
        checkpoint.attempts.length !== 2 ||
        checkpoint.attempts[1]?.role !== 'exact_text_retry')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A failed exact-text checkpoint requires both completed attempts.',
        path: ['exactTextFailure'],
      });
    }
    if (
      checkpoint.kind === 'video' &&
      (checkpoint.phase === 'exact_text_retry' ||
        checkpoint.phase === 'exact_text_failed' ||
        checkpoint.phase === 'verify_primary' ||
        checkpoint.phase === 'verify_retry' ||
        checkpoint.exactTextRoute !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Video checkpoints cannot enter image exact-text phases.',
        path: ['phase'],
      });
    }
    if (
      checkpoint.phase !== 'before_submit' &&
      checkpoint.phase !== 'provider_route_suspended' &&
      checkpoint.phase !== 'next_effect' &&
      (checkpoint.attemptReceiptDigests.length === 0 ||
        checkpoint.providerCostReceiptDigests.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A completed media checkpoint requires attempt and cost receipt facts.',
      });
    }
    if (
      checkpoint.phase === 'ready' &&
      (checkpoint.exactTextFailure !== undefined ||
        ![1, 2].includes(checkpoint.attempts.length))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A ready media checkpoint requires a complete attempt sequence.',
        path: ['phase'],
      });
    }
  });

export type MediaBoundedCurrentBest = z.infer<
  typeof mediaBoundedCurrentBestSchema
>;

export function mediaBoundedRequestFingerprint(input: unknown) {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

export function parseMediaBoundedResume(
  suspension: BoundedExecutionSuspension<unknown>,
  nextSnapshot: BoundedExecutionSnapshot,
  expectedFingerprint: string,
  expectedExecutionRootFingerprint: string,
  expectedKind: MediaBoundedCurrentBest['kind'],
) {
  if (
    suspension.state !== 'suspended' ||
    suspension.resumable !== true ||
    suspension.unmetExplanation.trim().length === 0
  ) {
    throw new BoundedExecutionResumeError(
      'Bounded media resume requires a valid resumable suspension.',
    );
  }
  const previous = boundedExecutionSnapshotSchema.parse(suspension.snapshot);
  const next = boundedExecutionSnapshotSchema.parse(nextSnapshot);
  const currentBest = mediaBoundedCurrentBestSchema.parse(
    suspension.currentBest,
  );
  if (currentBest.requestFingerprint !== expectedFingerprint) {
    throw new BoundedExecutionResumeError(
      'The bounded media checkpoint does not match the frozen request.',
    );
  }
  if (
    currentBest.executionRootFingerprint !==
    expectedExecutionRootFingerprint
  ) {
    throw new BoundedExecutionResumeError(
      'The bounded media checkpoint does not match the execution root.',
    );
  }
  if (currentBest.kind !== expectedKind) {
    throw new BoundedExecutionResumeError(
      'The bounded media checkpoint kind does not match the frozen request.',
    );
  }
  assertRaisedSuccessor(previous, next);
  return currentBest;
}

function assertRaisedSuccessor(
  previous: BoundedExecutionSnapshot,
  next: BoundedExecutionSnapshot,
) {
  const limit = previous.triggeredLimit;
  if (previous.stopReason !== 'limit_reached' || limit === null) {
    throw new BoundedExecutionResumeError(
      'Bounded media resume requires a suspended predecessor snapshot.',
    );
  }
  if (next.stopReason !== null || next.triggeredLimit !== null) {
    throw new BoundedExecutionResumeError(
      'Bounded media resume requires a cleared successor snapshot.',
    );
  }
  if (
    next.schemaVersion !== previous.schemaVersion ||
    JSON.stringify(next.requiredLimits) !==
      JSON.stringify(previous.requiredLimits) ||
    JSON.stringify(next.consumption) !== JSON.stringify(previous.consumption)
  ) {
    throw new BoundedExecutionResumeError(
      'Bounded media resume cannot replace frozen consumption or required limits.',
    );
  }
  for (const candidate of BOUNDED_EXECUTION_LIMITS) {
    if (candidate !== limit && next[candidate] !== previous[candidate]) {
      throw new BoundedExecutionResumeError(
        'Bounded media resume can raise only the triggered server limit.',
      );
    }
  }
  const priorValue = previous[limit];
  const nextValue = next[limit];
  if (
    priorValue === 'unset' ||
    consumptionForLimit(previous, limit) < priorValue ||
    typeof nextValue !== 'number' ||
    nextValue <= priorValue ||
    nextValue <= consumptionForLimit(next, limit)
  ) {
    throw new BoundedExecutionResumeError(
      'Bounded media resume requires a strictly raised server limit.',
    );
  }
}

function consumptionForLimit(
  snapshot: BoundedExecutionSnapshot,
  limit: BoundedExecutionLimitName,
) {
  switch (limit) {
    case 'maxIterations':
      return snapshot.consumption.iterations;
    case 'maxCostCents':
      return snapshot.consumption.costCents;
    case 'maxWallClockMs':
      return snapshot.consumption.wallClockMs;
    case 'maxDelegations':
      return snapshot.consumption.delegations;
  }
}

function stableJson(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input
      .map((value) => (value === undefined ? 'null' : stableJson(value)))
      .join(',')}]`;
  }
  if (input && typeof input === 'object') {
    return `{${Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`)
      .join(',')}}`;
  }
  return JSON.stringify(input) ?? 'null';
}
