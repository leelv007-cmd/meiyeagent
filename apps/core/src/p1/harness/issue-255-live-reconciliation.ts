import { createHash } from 'node:crypto';
import { link, lstat, unlink, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import type { FoundationStore } from '../foundation/ports.js';
import { recordedRequest } from '../model-supply/adapters.js';
import type { TuziMediaExecutionOptions } from '../model-supply/tuzi-media-adapter.js';
import { assertIssue255SanitizedManifest } from './issue-255-live-collector.js';
import { createIssue255TuziMediaPort } from './issue-255-provider-attempt-fence.js';
import type {
  Issue255LiveReceipt,
  PostgresIssue255LiveReceiptRepository,
} from './issue-255-postgres-live-receipt.js';

const coordinatorV5RunNonce =
  'issue-255-live-anchors-2026-07-30-v5';
const coordinatorV6RunNonce =
  'issue-255-live-anchors-2026-07-31-v6';
const coordinatorV2RunNonce =
  'issue-255-live-anchors-2026-07-30-v2';

const closeoutSampleSchema = z
  .object({
    modality: z.enum(['copy', 'image_text', 'video']),
    sourceRunNonceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    effectId: z.string().regex(/^[a-f0-9]{64}$/u),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
    deploymentId: z.string().trim().min(1),
    amountMicros: z.number().int().positive(),
    usageEvidenceKind: z.enum([
      'provider_reported',
      'response_derived',
      'price_card_reconciled',
    ]),
    receiptEvidenceRef: z.string().startsWith('live://issue-255/receipt/'),
    generationSubmitCount: z.literal(1),
    providerHttpRequestCount: z.number().int().positive(),
    status: z.literal('completed'),
    providerTaskRefHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  })
  .strict();

const videoRecoverySchema = z
  .object({
    reason: z.literal('relay_completed_without_per_task_usage'),
    providerStatusSequence: z.tuple([
      z.literal('unknown'),
      z.literal('completed'),
    ]),
    normalizedStatusSequence: z.tuple([
      z.literal('queued'),
      z.literal('completed'),
    ]),
    taskDetailGetCount: z.number().int().positive(),
    contentRetrievalGetCount: z.literal(1),
    contentType: z.literal('video/mp4'),
    contentByteCount: z.number().int().positive(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    providerCreatedAtEpochSeconds: z.number().int().nonnegative(),
    providerCreatedAtIso: z.string().datetime(),
    providerSignedUrlTimestamp: z.string().regex(/^\d{8}T\d{6}Z$/u),
    providerSignedUrlTimestampIso: z.string().datetime(),
    wallClockUpperBoundMs: z.number().int().positive(),
    wallClockDerivation: z.literal(
      'provider_signed_url_timestamp - provider_created_at',
    ),
    billingNote: z.literal(
      'relay_completed_without_per_task_usage; frozen_price_card_reconciled',
    ),
  })
  .strict();

export const issue255LiveAnchorsV5ManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    issue: z.literal(255),
    samples: z.tuple([
      closeoutSampleSchema.extend({ modality: z.literal('copy') }).strict(),
      closeoutSampleSchema.extend({ modality: z.literal('image_text') }).strict(),
      closeoutSampleSchema
        .extend({
          modality: z.literal('video'),
          recovery: videoRecoverySchema,
        })
        .strict(),
    ]),
    totalActualAmountMicros: z.number().int().positive(),
    currency: z.literal('CNY'),
  })
  .strict();

const wallClockEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('durable_receipt_timestamp_delta'),
      wallClockMs: z.number().int().positive(),
      startedAtIso: z.string().datetime(),
      finishedAtIso: z.string().datetime(),
      derivation: z.literal('receipt.updated_at - receipt.created_at'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('provider_http_timing'),
      wallClockMs: z.number().int().positive(),
      requestStartedAtIso: z.string().datetime(),
      responseFinishedAtIso: z.string().datetime(),
      derivation: z.literal(
        'provider_response_finished_at - provider_request_started_at',
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('provider_signed_url_upper_bound'),
      wallClockMs: z.number().int().positive(),
      providerCreatedAtEpochSeconds: z.number().int().nonnegative(),
      providerCreatedAtIso: z.string().datetime(),
      providerSignedUrlTimestamp: z.string().regex(/^\d{8}T\d{6}Z$/u),
      providerSignedUrlTimestampIso: z.string().datetime(),
      derivation: z.literal(
        'provider_signed_url_timestamp - provider_created_at',
      ),
    })
    .strict(),
]);

const v6CloseoutSampleSchema = closeoutSampleSchema
  .extend({
    wallClockEvidence: wallClockEvidenceSchema,
  })
  .strict();

export const issue255LiveAnchorsV6ManifestSchema = z
  .object({
    schemaVersion: z.literal(3),
    issue: z.literal(255),
    supersedes: z.literal(
      'references/evidence/issue-255/live-anchors-v5.json',
    ),
    samples: z.tuple([
      v6CloseoutSampleSchema.extend({ modality: z.literal('copy') }).strict(),
      v6CloseoutSampleSchema
        .extend({ modality: z.literal('image_text') })
        .strict(),
      v6CloseoutSampleSchema
        .extend({
          modality: z.literal('video'),
          recovery: videoRecoverySchema,
        })
        .strict(),
    ]),
    totalActualAmountMicros: z.number().int().positive(),
    currency: z.literal('CNY'),
  })
  .strict();

export async function reconcileIssue255LiveRun(input: {
  foundation: FoundationStore;
  receipts: PostgresIssue255LiveReceiptRepository;
  runNonce: string;
}) {
  const runNonce = z.string().trim().min(1).parse(input.runNonce);
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v1') {
    await input.receipts.migrateLegacyRejectedBeforeBillingV1();
    return input.receipts.confirmFailedBeforeBilling(
      runNonce,
      input.foundation,
    );
  }
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v2') {
    return [await input.receipts.reconcileLegacyAcceptedImageWithoutTaskRefV2()];
  }
  if (runNonce === 'issue-255-live-anchors-2026-07-30-v3') {
    await input.receipts.prepareCoordinatorVideoV3FailedBeforeBilling();
    return input.receipts.confirmFailedBeforeBilling(
      runNonce,
      input.foundation,
    );
  }
  const unknown = (await input.receipts.listRun(runNonce)).filter(
    ({ status }) => status === 'unknown',
  );
  if (unknown.length === 0) {
    throw new Error(
      'Issue 255 reconciliation requires at least one unknown receipt.',
    );
  }
  const reconciled = [];
  for (const receipt of unknown) {
    reconciled.push(
      await input.receipts.reconcileFromProviderLedger(
        {
          runNonce,
          modality: receipt.modality,
          effectId: receipt.effectId,
          requestFingerprint: receipt.requestFingerprint,
        },
        input.foundation,
      ),
    );
  }
  return reconciled;
}

export async function recoverIssue255CoordinatorVideoV5(input: {
  receipts: PostgresIssue255LiveReceiptRepository;
  options: TuziMediaExecutionOptions;
  manifestPath: string;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const [candidate] = await input.receipts.listRun(coordinatorV5RunNonce);
  if (candidate?.status === 'completed') {
    return {
      completed: candidate,
      manifest: await writeIssue255LiveAnchorsV5Manifest({
        receipts: input.receipts,
        manifestPath: input.manifestPath,
      }),
      normalizedStatusSequence: ['queued', 'completed'] as const,
    };
  }
  if (
    !candidate ||
    candidate.modality !== 'video' ||
    candidate.status !== 'unknown' ||
    candidate.generationSubmitCount !== 1 ||
    !candidate.providerTaskId
  ) {
    throw new Error(
      'Issue 255 v5 GET-only recovery requires its single durable unknown video receipt.',
    );
  }
  const providerCreatedAtEpochSeconds = providerCreatedAtFromDurableFailure(
    candidate.failureErrorMessage,
  );
  const providerFetch = input.options.fetch ?? globalThis.fetch;
  const getOnlyFetch: typeof globalThis.fetch = (request, init) => {
    const method = (
      init?.method ?? (request instanceof Request ? request.method : 'GET')
    ).toUpperCase();
    if (method !== 'GET') {
      throw new Error('Issue 255 v5 recovery forbids every non-GET provider request.');
    }
    return providerFetch(request, init);
  };
  const port = createIssue255TuziMediaPort({
    identity: {
      runNonce: candidate.runNonce,
      modality: 'video',
      effectId: candidate.effectId,
      requestFingerprint: candidate.requestFingerprint,
      deploymentId: candidate.deploymentId,
      providerIdempotencyKey: candidate.providerIdempotencyKey,
    },
    options: { ...input.options, fetch: getOnlyFetch },
    receipts: input.receipts,
  });
  const request = {
    ...recordedRequest(
      input.options.video.catalogModelId,
      'video.generate',
      { durationSeconds: 5 },
    ),
    effectIdempotencyKey: candidate.effectId,
  };
  request.submission.idempotencyKey = candidate.effectId;
  request.jobId = candidate.effectId;
  request.submission.prompt =
    '生成一段不含人物肖像和文字的中性美业护理氛围视频。';
  const taskRef = port.recoverVideoTaskRef(
    request,
    candidate.providerTaskId,
  );
  let terminal: Awaited<ReturnType<typeof port.poll>> | undefined;
  const normalizedStatusSequence: Array<
    'queued' | 'running' | 'completed'
  > = ['queued'];
  for (let poll = 0; poll < 60; poll += 1) {
    const state = await port.poll({ ...request, taskRef });
    if (state.status === 'failed' || state.status === 'unknown') {
      throw new Error(
        `Issue 255 v5 GET-only recovery ended as ${state.status}: ${state.errorCode ?? 'provider_failure'}.`,
      );
    }
    normalizedStatusSequence.push(state.status);
    if (state.status === 'completed') {
      terminal = state;
      break;
    }
    await (input.wait ?? defaultWait)(2_000);
  }
  if (
    !terminal ||
    !terminal.providerSignedUrlTimestamp
  ) {
    throw new Error(
      'Issue 255 v5 GET-only recovery lacks completed provider timing evidence.',
    );
  }
  const signedAt = parseTosTimestamp(terminal.providerSignedUrlTimestamp);
  const createdAt = new Date(
    providerCreatedAtEpochSeconds * 1_000,
  );
  const wallClockUpperBoundMs = signedAt.getTime() - createdAt.getTime();
  if (wallClockUpperBoundMs <= 0 || wallClockUpperBoundMs > 86_400_000) {
    throw new Error('Issue 255 v5 provider timing evidence is inconsistent.');
  }
  const downloaded = await port.download({ ...request, taskRef });
  const contentSha256 = createHash('sha256')
    .update(downloaded.bytes)
    .digest('hex');
  const completed = await input.receipts.reconcileCoordinatorVideoV5FromPriceCard({
    runNonce: candidate.runNonce,
    effectId: candidate.effectId,
    requestFingerprint: candidate.requestFingerprint,
    providerTaskId: candidate.providerTaskId,
    providerTaskRef: taskRef,
    providerStatusSequence: ['unknown', 'completed'],
    normalizedStatusSequence: ['queued', 'completed'],
    providerCreatedAtEpochSeconds,
    providerSignedUrlTimestamp: terminal.providerSignedUrlTimestamp,
    wallClockUpperBoundMs,
    contentType: downloaded.contentType as 'video/mp4',
    contentByteCount: downloaded.bytes.byteLength,
    contentSha256,
  });
  const manifest = await writeIssue255LiveAnchorsV5Manifest({
    receipts: input.receipts,
    manifestPath: input.manifestPath,
  });
  return { completed, manifest, normalizedStatusSequence };
}

export async function writeIssue255LiveAnchorsV5Manifest(input: {
  receipts: PostgresIssue255LiveReceiptRepository;
  manifestPath: string;
}) {
  const v2 = await input.receipts.listRun(coordinatorV2RunNonce);
  const v5 = await input.receipts.listRun(coordinatorV5RunNonce);
  const copy = v2.find((receipt) => receipt.modality === 'copy');
  const image = v2.find((receipt) => receipt.modality === 'image_text');
  const video = v5.find((receipt) => receipt.modality === 'video');
  if (
    !copy || copy.status !== 'completed' ||
    !image || image.status !== 'completed' ||
    !video || video.status !== 'completed' ||
    !video.terminalLineage ||
    !('recovery' in video.terminalLineage)
  ) {
    throw new Error('Issue 255 v5 closeout requires completed copy, image, and video receipts.');
  }
  const sample = (
    receipt: typeof copy,
    usageEvidenceKind: 'provider_reported' | 'response_derived' | 'price_card_reconciled',
  ) => ({
    modality: receipt.modality,
    sourceRunNonceHash: hash(receipt.runNonce),
    effectId: receipt.effectId,
    requestFingerprint: receipt.requestFingerprint,
    adapter: receipt.adapter,
    deploymentId: receipt.deploymentId,
    amountMicros: receipt.actualAmountMicros,
    usageEvidenceKind,
    receiptEvidenceRef: `live://issue-255/receipt/${receipt.effectId}`,
    generationSubmitCount: receipt.generationSubmitCount,
    providerHttpRequestCount: receipt.providerHttpRequestCount,
    status: receipt.status,
    providerTaskRefHash:
      receipt.terminalLineage &&
      'attempt' in receipt.terminalLineage &&
      'providerTaskRef' in receipt.terminalLineage.attempt
        ? hash(receipt.terminalLineage.attempt.providerTaskRef)
        : null,
  });
  const recovery = video.terminalLineage.recovery;
  const manifest = issue255LiveAnchorsV5ManifestSchema.parse({
    schemaVersion: 2,
    issue: 255,
    samples: [
      sample(copy, 'provider_reported'),
      sample(image, 'price_card_reconciled'),
      {
        ...sample(video, 'price_card_reconciled'),
        recovery: {
          ...recovery,
          taskDetailGetCount: video.providerHttpRequestCount - 2,
          contentRetrievalGetCount: 1,
          providerCreatedAtIso: new Date(
            recovery.providerCreatedAtEpochSeconds * 1_000,
          ).toISOString(),
          providerSignedUrlTimestampIso: parseTosTimestamp(
            recovery.providerSignedUrlTimestamp,
          ).toISOString(),
          wallClockDerivation:
            'provider_signed_url_timestamp - provider_created_at',
          billingNote:
            'relay_completed_without_per_task_usage; frozen_price_card_reconciled',
        },
      },
    ],
    totalActualAmountMicros:
      copy.actualAmountMicros! +
      image.actualAmountMicros! +
      video.actualAmountMicros!,
    currency: 'CNY',
  });
  const pendingPath = `${input.manifestPath}.pending`;
  try {
    const pending = await lstat(pendingPath);
    if (pending.size !== 0) {
      throw new Error('Issue 255 v5 non-empty pending manifest must be preserved.');
    }
    await unlink(pendingPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await lstat(input.manifestPath);
    throw new Error('Issue 255 v5 final manifest already exists.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  assertIssue255SanitizedManifest(serialized);
  await writeFile(pendingPath, serialized, { flag: 'wx', mode: 0o600 });
  await link(pendingPath, input.manifestPath);
  await unlink(pendingPath);
  return manifest;
}

export async function writeIssue255LiveAnchorsV6Manifest(input: {
  receipts: PostgresIssue255LiveReceiptRepository;
  manifestPath: string;
}) {
  const v2 = await input.receipts.listRun(coordinatorV2RunNonce);
  const v5 = await input.receipts.listRun(coordinatorV5RunNonce);
  const v6 = await input.receipts.listRun(coordinatorV6RunNonce);
  const copy = v2.find((receipt) => receipt.modality === 'copy');
  const image = v6.find((receipt) => receipt.modality === 'image_text');
  const video = v5.find((receipt) => receipt.modality === 'video');
  if (
    !copy ||
    copy.status !== 'completed' ||
    !image ||
    image.status !== 'completed' ||
    !video ||
    video.status !== 'completed' ||
    !video.terminalLineage ||
    !('recovery' in video.terminalLineage)
  ) {
    throw new Error(
      'Issue 255 v6 manifest requires completed copy, v6 image, and video receipts.',
    );
  }

  const imageProviderTaskRefHash = providerTaskRefHash(image);
  if (!imageProviderTaskRefHash) {
    throw new Error(
      'Issue 255 v6 image manifest requires the durable provider task reference.',
    );
  }
  if (
    !image.providerRequestStartedAt ||
    !image.providerResponseFinishedAt ||
    image.providerWallClockMs === null
  ) {
    throw new Error(
      'Issue 255 v6 image manifest requires durable provider HTTP timing.',
    );
  }

  const sample = (
    receipt: Issue255LiveReceipt,
    usageEvidenceKind:
      | 'provider_reported'
      | 'response_derived'
      | 'price_card_reconciled',
  ) => {
    if (receipt.status !== 'completed' || receipt.actualAmountMicros === null) {
      throw new Error('Issue 255 manifest sample requires a completed receipt.');
    }
    return {
      modality: receipt.modality,
      sourceRunNonceHash: hash(receipt.runNonce),
      effectId: receipt.effectId,
      requestFingerprint: receipt.requestFingerprint,
      adapter: receipt.adapter,
      deploymentId: receipt.deploymentId,
      amountMicros: receipt.actualAmountMicros,
      usageEvidenceKind,
      receiptEvidenceRef: `live://issue-255/receipt/${receipt.effectId}`,
      generationSubmitCount: receipt.generationSubmitCount,
      providerHttpRequestCount: receipt.providerHttpRequestCount,
      status: receipt.status,
      providerTaskRefHash: providerTaskRefHash(receipt),
    };
  };

  const recovery = video.terminalLineage.recovery;
  const manifest = issue255LiveAnchorsV6ManifestSchema.parse({
    schemaVersion: 3,
    issue: 255,
    supersedes: 'references/evidence/issue-255/live-anchors-v5.json',
    samples: [
      {
        ...sample(copy, 'provider_reported'),
        wallClockEvidence: {
          kind: 'durable_receipt_timestamp_delta',
          wallClockMs: receiptTimestampDeltaMs(copy),
          startedAtIso: copy.createdAt,
          finishedAtIso: copy.updatedAt,
          derivation: 'receipt.updated_at - receipt.created_at',
        },
      },
      {
        ...sample(image, terminalUsageEvidenceKind(image)),
        providerTaskRefHash: imageProviderTaskRefHash,
        wallClockEvidence: {
          kind: 'provider_http_timing',
          wallClockMs: image.providerWallClockMs,
          requestStartedAtIso: image.providerRequestStartedAt,
          responseFinishedAtIso: image.providerResponseFinishedAt,
          derivation:
            'provider_response_finished_at - provider_request_started_at',
        },
      },
      {
        ...sample(video, 'price_card_reconciled'),
        recovery: {
          ...recovery,
          taskDetailGetCount: video.providerHttpRequestCount - 2,
          contentRetrievalGetCount: 1,
          providerCreatedAtIso: new Date(
            recovery.providerCreatedAtEpochSeconds * 1_000,
          ).toISOString(),
          providerSignedUrlTimestampIso: parseTosTimestamp(
            recovery.providerSignedUrlTimestamp,
          ).toISOString(),
          wallClockDerivation:
            'provider_signed_url_timestamp - provider_created_at',
          billingNote:
            'relay_completed_without_per_task_usage; frozen_price_card_reconciled',
        },
        wallClockEvidence: {
          kind: 'provider_signed_url_upper_bound',
          wallClockMs: recovery.wallClockUpperBoundMs,
          providerCreatedAtEpochSeconds:
            recovery.providerCreatedAtEpochSeconds,
          providerCreatedAtIso: new Date(
            recovery.providerCreatedAtEpochSeconds * 1_000,
          ).toISOString(),
          providerSignedUrlTimestamp: recovery.providerSignedUrlTimestamp,
          providerSignedUrlTimestampIso: parseTosTimestamp(
            recovery.providerSignedUrlTimestamp,
          ).toISOString(),
          derivation:
            'provider_signed_url_timestamp - provider_created_at',
        },
      },
    ],
    totalActualAmountMicros:
      copy.actualAmountMicros! +
      image.actualAmountMicros! +
      video.actualAmountMicros!,
    currency: 'CNY',
  });
  const pendingPath = `${input.manifestPath}.pending`;
  try {
    const pending = await lstat(pendingPath);
    if (pending.size !== 0) {
      throw new Error('Issue 255 v6 non-empty pending manifest must be preserved.');
    }
    await unlink(pendingPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await lstat(input.manifestPath);
    throw new Error('Issue 255 v6 final manifest already exists.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  assertIssue255SanitizedManifest(serialized);
  await writeFile(pendingPath, serialized, { flag: 'wx', mode: 0o600 });
  await link(pendingPath, input.manifestPath);
  await unlink(pendingPath);
  return manifest;
}

function providerTaskRefHash(receipt: Issue255LiveReceipt) {
  const terminal = receipt.terminalLineage;
  if (terminal && 'attempt' in terminal) {
    if ('providerTaskRef' in terminal.attempt) {
      return hash(terminal.attempt.providerTaskRef);
    }
    if (
      'providerTaskRefMissing' in terminal.attempt &&
      terminal.attempt.providerTaskRefMissing
    ) {
      return null;
    }
  }
  throw new Error(
    'Issue 255 manifest receipt has no trusted provider task reference state.',
  );
}

function terminalUsageEvidenceKind(receipt: Issue255LiveReceipt) {
  const terminal = receipt.terminalLineage;
  if (
    terminal &&
    'providerCost' in terminal &&
    'usageEvidenceKind' in terminal.providerCost
  ) {
    return terminal.providerCost.usageEvidenceKind;
  }
  throw new Error(
    'Issue 255 manifest receipt has no trusted provider usage evidence kind.',
  );
}

function receiptTimestampDeltaMs(receipt: Issue255LiveReceipt) {
  const startedAt = new Date(receipt.createdAt).getTime();
  const finishedAt = new Date(receipt.updatedAt).getTime();
  const wallClockMs = Math.ceil(finishedAt - startedAt);
  if (
    !Number.isSafeInteger(wallClockMs) ||
    wallClockMs <= 0 ||
    wallClockMs > 86_400_000
  ) {
    throw new Error('Issue 255 receipt timestamp wall-clock evidence is invalid.');
  }
  return wallClockMs;
}

function parseTosTimestamp(value: string) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  if (!match) throw new Error('Issue 255 v5 signed URL timestamp is invalid.');
  return new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`,
  );
}

function providerCreatedAtFromDurableFailure(value: string | null) {
  const matches = value?.match(/"created_at":(\d{10})/gu) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      'Issue 255 v5 recovery requires one durable provider submission timestamp.',
    );
  }
  const parsed = Number(matches[0]!.slice('"created_at":'.length));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      'Issue 255 v5 durable provider submission timestamp is invalid.',
    );
  }
  return parsed;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultWait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingFile(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
