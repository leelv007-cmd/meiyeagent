import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Pool } from 'pg';
import { z } from 'zod';

import type { FoundationStore } from '../foundation/ports.js';
import {
  recordedRequest,
  type OpenAiCompatibleLlmExecutionOptions,
} from '../model-supply/adapters.js';
import type { TuziMediaExecutionOptions } from '../model-supply/tuzi-media-adapter.js';
import {
  assertIssue255RecordedMatrix,
  canonicalRecordedMatrixDigest,
} from './issue-255-calibration-guard.js';
import {
  createIssue255DirectCopyPort,
  createIssue255TuziMediaPort,
  type Issue255ReceiptFence,
} from './issue-255-provider-attempt-fence.js';
import {
  PostgresIssue255LiveReceiptRepository,
  type Issue255LiveReceipt,
} from './issue-255-postgres-live-receipt.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const approvedQuoteMicros = {
  copy: 100_000,
  image_text: 500_000,
  video: 1_620_000,
} as const;
const COPY_GENERATION_REQUEST_BYTE_LIMIT = 4_096;
const COPY_INSTRUCTIONS =
  'Return exactly 3 materially distinct beauty-business copy candidates. Every candidate must include a non-empty title, body, and conversionHook.';

type Modality = (typeof modalities)[number];
type ProviderUsageEvidenceKind = 'provider_reported' | 'response_derived';

type ProviderTerminal = {
  providerTaskRef: string;
  amountMicros: number;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    mediaUnits?: number;
  };
  usageEvidenceKind: ProviderUsageEvidenceKind;
};

class Issue255ProviderExecutionError extends Error {
  constructor(
    readonly errorCode: string,
    readonly errorMessage: string,
  ) {
    super(errorMessage);
    this.name = 'Issue255ProviderExecutionError';
  }
}

export type Issue255LiveExecutor = {
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
  catalogModelId: string;
  configurationRevision: string;
  credentialRevision: string;
  deploymentId: string;
  modality: Modality;
  priceRevision: string;
  promptHash: string;
  quoteAmountMicros: number;
  quoteBasis: Readonly<Record<string, number>>;
  execute(identity: {
    effectId: string;
    requestFingerprint: string;
    runNonce: string;
  }): Promise<ProviderTerminal>;
};

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runNonceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    recordedMatrixDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    authorization: z
      .object({
        generationSubmitCap: z.union([z.literal(1), z.literal(3)]),
        probeCapMicros: z.literal(3_600_000),
        globalCapMicros: z.literal(5_000_000),
        configuredProviderCapMicros: z.number().int().positive().max(5_000_000),
        effectiveCapMicros: z.number().int().positive().max(3_600_000),
        currency: z.literal('CNY'),
      })
      .strict(),
    samples: z
      .array(
        z
          .object({
            modality: z.enum(modalities),
            adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
            catalogModelId: z.string().trim().min(1),
            deploymentId: z.string().trim().min(1),
            evidenceKind: z.literal('live'),
            loopEvidence: z.enum([
              'bounded_single_pass',
              'non_limit_loop',
            ]),
            artifactRef: z.string().startsWith('live://issue-255/'),
            effectId: z.string().regex(/^[a-f0-9]{64}$/u),
            requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
            providerTaskRefHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/u)
              .nullable(),
            usageEvidenceKind: z.enum([
              'provider_reported',
              'response_derived',
              'price_card_reconciled',
            ]),
            evidenceGap: z
              .enum([
                'tuzi_image_response_omits_usage',
                'tuzi_image_usage_missing_and_task_ref_not_persisted',
              ])
              .optional(),
            configurationRevision: z.string().trim().min(1),
            priceRevision: z.string().trim().min(1),
            exchangeRevision: z.literal('native-cny-v1'),
            reservedAmountMicros: z.number().int().positive(),
            actualAmountMicros: z.number().int().positive(),
            generationSubmitCount: z.literal(1),
            providerHttpRequestCount: z.number().int().positive(),
            wallClockMs: z.number().int().positive(),
            usage: z
              .object({
                inputTokens: z.number().int().nonnegative().optional(),
                outputTokens: z.number().int().nonnegative().optional(),
                mediaUnits: z.number().int().nonnegative().optional(),
              })
              .strict()
              .refine((usage) => Object.keys(usage).length > 0),
          })
          .strict(),
      )
      .min(1)
      .max(3)
      .refine(
        (samples) =>
          new Set(samples.map((sample) => sample.modality)).size ===
          samples.length,
        'Issue 255 manifest samples must have unique modalities.',
      ),
    totalActualAmountMicros: z.number().int().positive().max(3_600_000),
    cleanup: z
      .object({
        databaseResidueCount: z.literal(0),
        localGeneratedArtifactCount: z.literal(0),
        status: z.literal('completed'),
      })
      .strict(),
  })
  .strict();

export type Issue255LiveManifest = z.infer<typeof manifestSchema>;

export async function collectIssue255LiveAnchors(input: {
  database: Pool;
  executors: readonly Issue255LiveExecutor[];
  foundation: FoundationStore;
  manifestPath: string;
  providerCapMicros: number;
  recordedSamples: unknown;
  receipts: PostgresIssue255LiveReceiptRepository;
  runNonce: string;
}) {
  const runNonce = z.string().trim().min(1).parse(input.runNonce);
  const recordedSamples = assertIssue255RecordedMatrix(
    input.recordedSamples,
  );
  const recordedMatrixDigest =
    canonicalRecordedMatrixDigest(recordedSamples);
  const providerCapMicros = z
    .number()
    .int()
    .positive()
    .max(5_000_000)
    .parse(input.providerCapMicros);
  const effectiveCapMicros = Math.min(
    3_600_000,
    5_000_000,
    providerCapMicros,
  );
  const executors = validateExecutors(
    input.executors,
    effectiveCapMicros,
  );
  const pendingPath = `${input.manifestPath}.pending`;
  const existingReceipts = await input.receipts.listRun(runNonce);
  const pendingCreated = await reserveManifestPaths(
    input.manifestPath,
    pendingPath,
    existingReceipts.length > 0,
  );
  try {
    await input.receipts.claimOrResumeLiveRunOwner(runNonce);
  } catch (error) {
    if (pendingCreated) await unlink(pendingPath);
    throw error;
  }
  const workspaceId =
    `issue-255-live-${hash(runNonce).slice(0, 24)}`;
  const manifestSamples: Issue255LiveManifest['samples'] = [];
  const existingByModality = new Map(
    existingReceipts.map((receipt) => [receipt.modality, receipt]),
  );
  if (existingByModality.size !== existingReceipts.length) {
    throw new Error('Issue 255 live resume has duplicate durable modalities.');
  }

  for (const executor of executors) {
    const effectId = hash(
      `issue255/v1\0${runNonce}\0${executor.modality}`,
    );
    const requestFingerprint = hash(
      JSON.stringify({
        adapter: executor.adapter,
        catalogModelId: executor.catalogModelId,
        configurationRevision: executor.configurationRevision,
        credentialRevision: executor.credentialRevision,
        deploymentId: executor.deploymentId,
        effectId,
        modality: executor.modality,
        priceRevision: executor.priceRevision,
        promptHash: executor.promptHash,
        quoteAmountMicros: executor.quoteAmountMicros,
        quoteBasis: executor.quoteBasis,
        recordedMatrixDigest,
      }),
    );
    const providerJobId =
      `issue-255-job-${effectId.slice(0, 32)}`;
    const providerAttemptId =
      `issue-255-attempt-${effectId.slice(0, 28)}`;
    const providerCostEventId =
      `issue-255-cost-${effectId.slice(0, 28)}`;
    const existing = existingByModality.get(executor.modality);
    if (existing) {
      assertResumableReceipt({
        executor,
        receipt: existing,
        workspaceId,
        effectId,
        requestFingerprint,
        providerJobId,
        providerAttemptId,
        providerCostEventId,
        recordedMatrixDigest,
      });
      manifestSamples.push(
        manifestSample(executor, existing, receiptWallClockMs(existing)),
      );
      continue;
    }
    await input.receipts.claim({
      workspaceId,
      runNonce,
      modality: executor.modality,
      effectId,
      requestFingerprint,
      adapter: executor.adapter,
      deploymentId: executor.deploymentId,
      providerIdempotencyKey: effectId,
      providerJobId,
      providerAttemptId,
      providerCostEventId,
      recordedMatrixDigest,
      reservedAmountMicros: executor.quoteAmountMicros,
      priceRevision: executor.priceRevision,
      exchangeRevision: 'native-cny-v1',
    });
    await prepareProviderLedger({
      database: input.database,
      deploymentId: executor.deploymentId,
      foundation: input.foundation,
      jobId: providerJobId,
      modality: executor.modality,
      priceRevision: executor.priceRevision,
      providerAttemptId,
      workspaceId,
    });

    const startedAt = performance.now();
    let terminal: ProviderTerminal;
    try {
      terminal = await executor.execute({
        effectId,
        requestFingerprint,
        runNonce,
      });
    } catch (error) {
      const failure = await input.receipts.recordExecutionFailure({
        runNonce,
        modality: executor.modality,
        effectId,
        requestFingerprint,
        ...providerFailureDetails(error),
      });
      if (failure.kind === 'rejected_before_accept') {
        await input.database.query(
          'DELETE FROM workspaces WHERE id = $1',
          [workspaceId],
        );
      }
      throw error;
    }
    if (
      terminal.amountMicros <= 0 ||
      terminal.amountMicros > executor.quoteAmountMicros ||
      !hasTrustedTerminalUsage(executor, terminal)
    ) {
      await input.receipts.recordExecutionFailure({
        runNonce,
        modality: executor.modality,
        effectId,
        requestFingerprint,
        errorCode: 'terminal_cost_or_usage_invalid',
        errorMessage: 'Provider terminal cost or usage was not trustworthy.',
      });
      throw new Error(
        `Issue 255 ${executor.modality} terminal cost or usage is not trustworthy.`,
      );
    }
    await settleProviderLedger({
      amountMicros: terminal.amountMicros,
      adapter: executor.adapter,
      deploymentId: executor.deploymentId,
      effectId,
      foundation: input.foundation,
      jobId: providerJobId,
      priceRevision: executor.priceRevision,
      providerIdempotencyKey: effectId,
      providerAttemptId,
      providerCostEventId,
      providerTaskRef: terminal.providerTaskRef,
      requestFingerprint,
      usage: terminal.usage,
      usageEvidenceKind: terminal.usageEvidenceKind,
      workspaceId,
    });
    const receipt = await input.receipts.completeFromProviderLedger(
      {
        runNonce,
          modality: executor.modality,
          effectId,
          requestFingerprint,
        },
      input.foundation,
    );
    manifestSamples.push(
      manifestSample(
        executor,
        receipt,
        Math.max(1, Math.ceil(performance.now() - startedAt)),
      ),
    );
  }

  const preliminary = manifestSchema.parse({
    schemaVersion: 1,
    runNonceHash: hash(runNonce),
    recordedMatrixDigest,
    authorization: {
      generationSubmitCap: executors.length as 1 | 3,
      probeCapMicros: 3_600_000,
      globalCapMicros: 5_000_000,
      configuredProviderCapMicros: providerCapMicros,
      effectiveCapMicros,
      currency: 'CNY',
    },
    samples: manifestSamples,
    totalActualAmountMicros: manifestSamples.reduce(
      (sum, sample) => sum + sample.actualAmountMicros,
      0,
    ),
    cleanup: {
      databaseResidueCount: 0,
      localGeneratedArtifactCount: 0,
      status: 'completed',
    },
  });
  const evidenceDigests = manifestEvidenceDigests(preliminary);
  await input.receipts.bindManifestEvidence({
    runNonce,
    envelopeDigest: evidenceDigests.envelope,
    samples: preliminary.samples.map((sample) => ({
      effectId: sample.effectId,
      sampleDigest: evidenceDigests.samples.get(sample.effectId)!,
    })),
  });
  const serialized = `${JSON.stringify(preliminary, null, 2)}\n`;
  assertIssue255SanitizedManifest(serialized);
  await writeFile(pendingPath, serialized, { flag: 'w', mode: 0o600 });

  await input.database.query(
    'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
    [runNonce],
  );
  await input.database.query(
    'DELETE FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  const cleanup = await input.database.query<{
    authorization_count: number;
    operational_count: number;
  }>(
    `SELECT
       (
       (SELECT COUNT(*) FROM issue255_live_generation_receipts WHERE run_nonce = $1) +
       (SELECT COUNT(*) FROM workspaces WHERE id = $2) +
       (SELECT COUNT(*) FROM p1_generation_jobs WHERE workspace_id = $2) +
       (SELECT COUNT(*) FROM p1_provider_attempts WHERE workspace_id = $2) +
       (SELECT COUNT(*) FROM p1_provider_cost_events WHERE workspace_id = $2)
       )::int AS operational_count,
       (
         SELECT COUNT(*)
           FROM issue255_live_generation_authorizations
          WHERE run_nonce = $1
       )::int AS authorization_count`,
    [runNonce, workspaceId],
  );
  if (cleanup.rows[0]?.operational_count !== 0) {
    throw new Error('Issue 255 live collector cleanup left database residue.');
  }
  if (cleanup.rows[0]?.authorization_count !== executors.length) {
    throw new Error(
      'Issue 255 live collector did not preserve all durable authorizations.',
    );
  }
  try {
    await link(pendingPath, input.manifestPath);
  } catch (error) {
    if (isFileSystemError(error, 'EEXIST')) {
      throw new Error(
        'Issue 255 final manifest already exists; pending evidence was preserved.',
      );
    }
    throw error;
  }
  await unlink(pendingPath);
  return preliminary;
}

export async function recoverIssue255LiveManifest(input: {
  database: Pool;
  manifestPath: string;
}) {
  const pendingPath = `${input.manifestPath}.pending`;
  let finalExists = true;
  try {
    await lstat(input.manifestPath);
  } catch (error) {
    if (!isFileSystemError(error, 'ENOENT')) throw error;
    finalExists = false;
  }
  if (finalExists) {
    throw new Error(
      'Issue 255 final manifest already exists and cannot be recovered over.',
    );
  }
  const serialized = await readFile(pendingPath, 'utf8');
  assertIssue255SanitizedManifest(serialized);
  const manifest = manifestSchema.parse(JSON.parse(serialized));
  const effectIds = manifest.samples.map(({ effectId }) => effectId);
  const authorizations = await input.database.query<{
    adapter: string;
    deployment_id: string;
    evidence_envelope_digest: string | null;
    evidence_sample_digest: string | null;
    effect_id: string;
    modality: Modality;
    price_revision: string;
    recorded_matrix_digest: string;
    request_fingerprint: string;
    reserved_amount_micros: string;
    run_nonce: string;
    workspace_id: string;
  }>(
    `SELECT adapter,
            deployment_id,
            evidence_envelope_digest,
            evidence_sample_digest,
            effect_id,
            modality,
            price_revision,
            recorded_matrix_digest,
            request_fingerprint,
            reserved_amount_micros,
            run_nonce,
            workspace_id
       FROM issue255_live_generation_authorizations
      WHERE effect_id = ANY($1::text[])`,
    [effectIds],
  );
  if (authorizations.rows.length !== manifest.samples.length) {
    throw new Error(
      'Issue 255 pending manifest has no complete durable authorization history.',
    );
  }
  const runNonces = new Set(
    authorizations.rows.map(({ run_nonce }) => run_nonce),
  );
  const workspaceIds = new Set(
    authorizations.rows.map(({ workspace_id }) => workspace_id),
  );
  const evidenceDigests = manifestEvidenceDigests(manifest);
  if (
    runNonces.size !== 1 ||
    workspaceIds.size !== 1 ||
    hash([...runNonces][0]!) !== manifest.runNonceHash
  ) {
    throw new Error(
      'Issue 255 pending manifest combines authorization history across runs.',
    );
  }
  for (const sample of manifest.samples) {
    const authorization = authorizations.rows.find(
      ({ effect_id }) => effect_id === sample.effectId,
    );
    if (
      !authorization ||
      authorization.run_nonce !== [...runNonces][0] ||
      authorization.modality !== sample.modality ||
      authorization.adapter !== sample.adapter ||
      authorization.deployment_id !== sample.deploymentId ||
      authorization.recorded_matrix_digest !==
        manifest.recordedMatrixDigest ||
      authorization.request_fingerprint !== sample.requestFingerprint ||
      Number(authorization.reserved_amount_micros) !==
        sample.reservedAmountMicros ||
      authorization.price_revision !== sample.priceRevision ||
      authorization.evidence_sample_digest !==
        evidenceDigests.samples.get(sample.effectId) ||
      authorization.evidence_envelope_digest !== evidenceDigests.envelope
    ) {
      throw new Error(
        'Issue 255 pending manifest differs from durable terminal evidence truth.',
      );
    }
  }
  const durableWorkspaceIds = [...workspaceIds];
  const residue = await input.database.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*)
          FROM issue255_live_generation_receipts
         WHERE effect_id = ANY($1::text[])) +
       (SELECT COUNT(*)
          FROM workspaces
         WHERE id = ANY($2::text[])) +
       (SELECT COUNT(*)
          FROM p1_generation_jobs
         WHERE workspace_id = ANY($2::text[])) +
       (SELECT COUNT(*)
          FROM p1_provider_attempts
         WHERE workspace_id = ANY($2::text[])) +
       (SELECT COUNT(*)
          FROM p1_provider_cost_events
         WHERE workspace_id = ANY($2::text[]))
     )::int AS count`,
    [effectIds, durableWorkspaceIds],
  );
  if (residue.rows[0]?.count !== 0) {
    throw new Error(
      'Issue 255 pending manifest recovery requires operational cleanup first.',
    );
  }
  try {
    await link(pendingPath, input.manifestPath);
  } catch (error) {
    if (isFileSystemError(error, 'EEXIST')) {
      throw new Error(
        'Issue 255 final manifest appeared during recovery; pending evidence was preserved.',
      );
    }
    throw error;
  }
  await unlink(pendingPath);
  return manifest;
}

async function reserveManifestPaths(
  manifestPath: string,
  pendingPath: string,
  allowExistingPending: boolean,
) {
  await mkdir(dirname(manifestPath), {
    mode: 0o700,
    recursive: true,
  });
  try {
    await writeFile(pendingPath, '', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (isFileSystemError(error, 'EEXIST')) {
      if (allowExistingPending) {
        const pending = await lstat(pendingPath);
        if (pending.isFile() && pending.size === 0) {
          try {
            await lstat(manifestPath);
          } catch (manifestError) {
            if (isFileSystemError(manifestError, 'ENOENT')) return false;
            throw manifestError;
          }
        }
      }
      throw new Error(
        'Issue 255 pending manifest already exists and requires recovery.',
      );
    }
    throw error;
  }
  try {
    await lstat(manifestPath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) return true;
    throw error;
  }
  await unlink(pendingPath);
  throw new Error(
    'Issue 255 final manifest already exists and cannot be replaced.',
  );
}

function isFileSystemError(error: unknown, code: string) {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === code
  );
}

export function issue255DirectCopyExecutor(input: {
  configurationRevision: string;
  credentialRevision: string;
  deploymentId: string;
  frozenPrices: {
    inputCostPerMillionCny: string;
    outputCostPerMillionCny: string;
  };
  options: OpenAiCompatibleLlmExecutionOptions;
  priceRevision: string;
  receipts: Issue255ReceiptFence;
}): Issue255LiveExecutor {
  const prompt =
    '基于门店已确认事实写三条合规且彼此不同的小红书护理介绍，不添加疗效承诺或虚构优惠。';
  const inputPriceMicrosPerMillion = frozenPriceMicros(
    input.frozenPrices.inputCostPerMillionCny,
    'direct input price',
  );
  const outputPriceMicrosPerMillion = frozenPriceMicros(
    input.frozenPrices.outputCostPerMillionCny,
    'direct output price',
  );
  const configuredMaxOutputTokens = z
    .number()
    .int()
    .positive()
    .parse(input.options.maxOutputTokens);
  const inputQuoteMicros = proratedPriceMicros(
    [[inputPriceMicrosPerMillion, COPY_GENERATION_REQUEST_BYTE_LIMIT]],
    1_000_000,
  );
  const affordableOutputTokens = Number(
    (BigInt(approvedQuoteMicros.copy - inputQuoteMicros) *
      1_000_000n) /
      BigInt(outputPriceMicrosPerMillion),
  );
  const maxOutputTokens = Math.min(
    configuredMaxOutputTokens,
    affordableOutputTokens,
  );
  if (maxOutputTokens <= 0) {
    throw new Error(
      'Issue 255 direct prices leave no provider-enforced output budget.',
    );
  }
  const quoteAmountMicros = proratedPriceMicros(
    [
      [inputPriceMicrosPerMillion, COPY_GENERATION_REQUEST_BYTE_LIMIT],
      [outputPriceMicrosPerMillion, maxOutputTokens],
    ],
    1_000_000,
  );
  const probeOptions = {
    ...input.options,
    maxOutputTokens,
  };
  return {
    adapter: 'direct-copy',
    catalogModelId: input.options.catalogModelId,
    configurationRevision: input.configurationRevision,
    credentialRevision: input.credentialRevision,
    deploymentId: input.deploymentId,
    modality: 'copy',
    priceRevision: input.priceRevision,
    promptHash: hash(`${COPY_INSTRUCTIONS}\0${prompt}`),
    quoteAmountMicros,
    quoteBasis: {
      maxInputRequestBytes: COPY_GENERATION_REQUEST_BYTE_LIMIT,
      maxOutputTokens,
    },
    async execute(identity) {
      const port = createIssue255DirectCopyPort({
        identity: {
          ...identity,
          deploymentId: input.deploymentId,
          modality: 'copy',
          providerIdempotencyKey: identity.effectId,
        },
        maxGenerationRequestBytes: COPY_GENERATION_REQUEST_BYTE_LIMIT,
        options: probeOptions,
        receipts: input.receipts,
      });
      const request = recordedRequest(
        input.options.catalogModelId,
        'copy.generate',
      );
      request.submission.idempotencyKey = identity.effectId;
      request.jobId = identity.effectId;
      request.submission.prompt = prompt;
      request.submission.copyCandidateCount = 3;
      request.submission.promptBinding = {
        name: 'issue-255/live-copy',
        version: 'v1',
        content: COPY_INSTRUCTIONS,
        contentHash: hash(COPY_INSTRUCTIONS),
        label: 'issue-255-live',
        source: 'builtin',
        isFallback: false,
      };
      const result = await port.execute(request);
      if (
        result.kind !== 'completed' ||
        !result.providerTaskRef ||
        result.providerCost.currency !== 'CNY' ||
        (result.providerCost.usage.inputTokens ?? 0) <= 0 ||
        (result.providerCost.usage.outputTokens ?? 0) <= 0
      ) {
        throw new Issue255ProviderExecutionError(
          result.kind === 'failure'
            ? `direct_${result.acceptance}`
            : 'terminal_cost_or_usage_invalid',
          result.kind === 'failure'
            ? result.message
            : 'Issue 255 direct copy provider did not return a trusted terminal.',
        );
      }
      const inputTokens = requiredUsageQuantity(
        result.providerCost.usage.inputTokens,
        'direct input tokens',
      );
      const outputTokens = requiredUsageQuantity(
        result.providerCost.usage.outputTokens,
        'direct output tokens',
      );
      if (
        inputTokens > COPY_GENERATION_REQUEST_BYTE_LIMIT ||
        outputTokens > maxOutputTokens
      ) {
        throw new Error(
          'Issue 255 direct provider usage exceeded the frozen quote basis.',
        );
      }
      return {
        providerTaskRef: result.providerTaskRef,
        amountMicros: proratedPriceMicros(
          [
            [
              inputPriceMicrosPerMillion,
              inputTokens,
            ],
            [
              outputPriceMicrosPerMillion,
              outputTokens,
            ],
          ],
          1_000_000,
        ),
        usage: result.providerCost.usage,
        usageEvidenceKind: 'provider_reported',
      };
    },
  };
}

export function issue255TuziExecutor(input: {
  configurationRevision: string;
  credentialRevision: string;
  deploymentId: string;
  frozenPriceCny: string;
  modality: 'image_text' | 'video';
  options: TuziMediaExecutionOptions;
  priceRevision: string;
  receipts: Issue255ReceiptFence;
  wait?: (milliseconds: number) => Promise<void>;
}): Issue255LiveExecutor {
  const isImage = input.modality === 'image_text';
  const prompt = isImage
    ? '生成一张不含文字、不含人物肖像的中性美业护理氛围图。'
    : '生成一段不含人物肖像和文字的中性美业护理氛围视频。';
  const catalogModelId = isImage
    ? input.options.image.catalogModelId
    : input.options.video.catalogModelId;
  const priceMicros = frozenPriceMicros(
    input.frozenPriceCny,
    isImage ? 'Tuzi image price' : 'Tuzi video price',
  );
  const videoQuote = isImage
    ? null
    : issue255VideoQuote({
        estimatedTokensPerSecond:
          input.options.video.estimatedTokensPerSecond,
        frozenPriceCny: input.frozenPriceCny,
      });
  const quoteBasis: Readonly<Record<string, number>> = isImage
    ? { outputCount: 1 }
    : {
        durationSeconds: videoQuote!.durationSeconds,
        estimatedTokensPerSecond: videoQuote!.estimatedTokensPerSecond,
      };
  const quoteAmountMicros = isImage
    ? proratedPriceMicros([[priceMicros, 1]], 1)
    : videoQuote!.amountMicros;
  if (quoteAmountMicros > approvedQuoteMicros[input.modality]) {
    throw new Error(
      `Issue 255 ${input.modality} worst-case quote exceeds its approved cap.`,
    );
  }
  return {
    adapter: isImage ? 'tuzi-image' : 'tuzi-video',
    catalogModelId,
    configurationRevision: input.configurationRevision,
    credentialRevision: input.credentialRevision,
    deploymentId: input.deploymentId,
    modality: input.modality,
    priceRevision: input.priceRevision,
    promptHash: hash(prompt),
    quoteAmountMicros,
    quoteBasis,
    async execute(identity) {
      const port = createIssue255TuziMediaPort({
        identity: {
          ...identity,
          deploymentId: input.deploymentId,
          modality: input.modality,
          providerIdempotencyKey: identity.effectId,
        },
        options: input.options,
        receipts: input.receipts,
      });
      const request = {
        ...recordedRequest(
          catalogModelId,
          isImage ? 'image.generate' : 'video.generate',
          isImage
            ? { height: 2048, width: 2048 }
            : { durationSeconds: videoQuote!.durationSeconds },
        ),
        effectIdempotencyKey: identity.effectId,
      };
      request.submission.idempotencyKey = identity.effectId;
      request.jobId = identity.effectId;
      request.submission.prompt = prompt;
      const submitted = await port.submit(request);
      if (submitted.acceptance !== 'accepted' || !submitted.taskRef) {
        throw new Issue255ProviderExecutionError(
          submitted.errorCode ?? submitted.acceptance,
          submitted.error ??
            `Issue 255 ${input.modality} provider did not accept the fixed sample.`,
        );
      }
      if (isImage) {
        if (
          submitted.providerCost.currency !== 'CNY' ||
          (submitted.usageEvidenceKind !== 'provider_reported' &&
            submitted.usageEvidenceKind !== 'response_derived')
        ) {
          throw new Error(
            'Issue 255 image terminal lacks trusted per-image usage.',
          );
        }
        return {
          providerTaskRef: submitted.taskRef,
          amountMicros: proratedPriceMicros(
            [
              [
                priceMicros,
                requiredUsageQuantity(
                  submitted.providerCost.usage.mediaUnits,
                  'Tuzi image media units',
                ),
              ],
            ],
            1,
          ),
          usage: submitted.providerCost.usage,
          usageEvidenceKind: submitted.usageEvidenceKind,
        };
      }
      for (let poll = 0; poll < 60; poll += 1) {
        const terminal = await port.poll({
          ...request,
          taskRef: submitted.taskRef,
        });
        if (terminal.status === 'completed') {
          if (
            terminal.usageEvidenceKind !== 'provider_reported' ||
            terminal.providerCost.currency !== 'CNY'
          ) {
            throw new Error(
              'Issue 255 video terminal uses estimated rather than provider-reported usage.',
            );
          }
          return {
            providerTaskRef: submitted.taskRef,
            amountMicros: proratedPriceMicros(
              [
                [
                  priceMicros,
                  requiredUsageQuantity(
                    terminal.providerCost.usage.outputTokens,
                    'Tuzi video output tokens',
                  ),
                ],
              ],
              1_000_000,
            ),
            usage: terminal.providerCost.usage,
            usageEvidenceKind: 'provider_reported',
          };
        }
        if (terminal.status === 'failed' || terminal.status === 'unknown') {
          throw new Issue255ProviderExecutionError(
            terminal.errorCode,
            terminal.error,
          );
        }
        await (input.wait ?? defaultWait)(2_000);
      }
      throw new Issue255ProviderExecutionError(
        'video_poll_timeout',
        'Issue 255 video provider polling timed out.',
      );
    },
  };
}

export function issue255VideoQuote(input: {
  estimatedTokensPerSecond: number;
  frozenPriceCny: string;
}) {
  if (
    !Number.isSafeInteger(input.estimatedTokensPerSecond) ||
    input.estimatedTokensPerSecond <= 0
  ) {
    throw new Error(
      'Issue 255 video estimated tokens per second must be a positive integer.',
    );
  }
  const durationSeconds = 5;
  const amountMicros = proratedPriceMicros(
    [
      [
        frozenPriceMicros(input.frozenPriceCny, 'Tuzi video price'),
        durationSeconds * input.estimatedTokensPerSecond,
      ],
    ],
    1_000_000,
  );
  if (amountMicros > approvedQuoteMicros.video) {
    throw new Error(
      'Issue 255 video worst-case quote exceeds its approved cap.',
    );
  }
  return {
    durationSeconds,
    estimatedTokensPerSecond: input.estimatedTokensPerSecond,
    amountMicros,
  };
}

function validateExecutors(
  input: readonly Issue255LiveExecutor[],
  effectiveCapMicros: number,
) {
  const parsed = z
    .array(z.custom<Issue255LiveExecutor>())
    .min(1)
    .max(3)
    .parse(input);
  if (
    (parsed.length !== 1 && parsed.length !== 3) ||
    (parsed.length === 1 && parsed[0]?.modality !== 'video') ||
    (parsed.length === 3 &&
      modalities.some((modality, index) => parsed[index]?.modality !== modality))
  ) {
    throw new Error(
      'Issue 255 live executors must be the complete fixed matrix or one video retry.',
    );
  }
  const seenModalities = new Set<Modality>();
  for (const executor of parsed) {
    const modality = executor.modality;
    if (
      seenModalities.has(modality) ||
      executor.adapter !==
        (modality === 'copy'
          ? 'direct-copy'
          : modality === 'image_text'
            ? 'tuzi-image'
            : 'tuzi-video') ||
      !Number.isSafeInteger(executor.quoteAmountMicros) ||
      executor.quoteAmountMicros <= 0 ||
      executor.quoteAmountMicros > approvedQuoteMicros[modality] ||
      Object.keys(executor.quoteBasis).length === 0
    ) {
      throw new Error(
        'Issue 255 live executors must be fixed copy, image_text, video with approved quotes.',
      );
    }
    seenModalities.add(modality);
    if (
      modality === 'image_text' &&
      (Object.keys(executor.quoteBasis).length !== 1 ||
        executor.quoteBasis.outputCount !== 1)
    ) {
      throw new Error(
        'Issue 255 image response-derived usage requires a per-image quote basis.',
      );
    }
  }
  const totalQuoteMicros = parsed.reduce(
    (total, executor) => total + executor.quoteAmountMicros,
    0,
  );
  if (totalQuoteMicros > effectiveCapMicros) {
    throw new Error(
      'Issue 255 live worst-case quotes exceed the effective provider cap.',
    );
  }
  return parsed;
}

function providerFailureDetails(error: unknown) {
  if (error instanceof Issue255ProviderExecutionError) {
    return {
      errorCode: error.errorCode,
      errorMessage: error.errorMessage,
    };
  }
  return {
    errorCode: 'collector_execution_error',
    errorMessage:
      error instanceof Error ? error.message : 'Provider execution failed.',
  };
}

function hasTrustedTerminalUsage(
  executor: Issue255LiveExecutor,
  terminal: ProviderTerminal,
) {
  if (terminal.usageEvidenceKind === 'provider_reported') return true;
  return (
    executor.modality === 'image_text' &&
    terminal.usageEvidenceKind === 'response_derived' &&
    Number.isSafeInteger(terminal.usage.mediaUnits) &&
    (terminal.usage.mediaUnits ?? 0) > 0
  );
}

async function prepareProviderLedger(input: {
  database: Pool;
  deploymentId: string;
  foundation: FoundationStore;
  jobId: string;
  modality: Modality;
  priceRevision: string;
  providerAttemptId: string;
  workspaceId: string;
}) {
  const routeSnapshotId = `${input.jobId}:route`;
  const now = new Date().toISOString();
  await input.database.query(
    `INSERT INTO workspaces (id, name)
     VALUES ($1, 'Issue 255 live calibration')
     ON CONFLICT (id) DO NOTHING`,
    [input.workspaceId],
  );
  await input.database.query(
    `INSERT INTO p1_route_snapshots (
       workspace_id, id, catalog_revision, policy_revision, price_revision,
       requested_catalog_model_id, selection_mode, data_class, data_classes,
       fallback_consent, allowed_candidates, created_at
     ) VALUES (
       $1, $2, 'issue-255-live-v1', 'issue-255-no-fallback-v1', $3, $4,
       'fixed', 'public', '["public"]'::jsonb, false, $5::jsonb,
       $6::timestamptz
     )`,
    [
      input.workspaceId,
      routeSnapshotId,
      input.priceRevision,
      input.deploymentId,
      JSON.stringify([
        {
          deploymentId: input.deploymentId,
          priceRevision: input.priceRevision,
        },
      ]),
      now,
    ],
  );
  await input.foundation.insertGenerationJob({
    id: input.jobId,
    workspaceId: input.workspaceId,
    operation:
      input.modality === 'copy'
        ? 'copy'
        : input.modality === 'image_text'
          ? 'image'
          : 'video',
    routeSnapshotId,
    usageReservationId: `${input.jobId}:usage`,
    status: 'running',
    createdBy: 'issue-255-live-collector',
    correlationId: `${input.jobId}:correlation`,
    createdAt: now,
    updatedAt: now,
  });
  await input.foundation.insertProviderAttempt({
    id: input.providerAttemptId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    ordinal: 1,
    deploymentId: input.deploymentId,
    acceptance: 'pending',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
}

async function settleProviderLedger(input: {
  amountMicros: number;
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
  deploymentId: string;
  effectId: string;
  foundation: FoundationStore;
  jobId: string;
  priceRevision: string;
  providerIdempotencyKey: string;
  providerAttemptId: string;
  providerCostEventId: string;
  providerTaskRef: string;
  requestFingerprint: string;
  usage: ProviderTerminal['usage'];
  usageEvidenceKind: ProviderUsageEvidenceKind;
  workspaceId: string;
}) {
  const now = new Date().toISOString();
  const attempt = await input.foundation.getProviderAttempt(
    input.workspaceId,
    input.providerAttemptId,
  );
  const job = await input.foundation.getGenerationJob(
    input.workspaceId,
    input.jobId,
  );
  if (!attempt || !job) {
    throw new Error('Issue 255 provider ledger preparation was lost.');
  }
  await input.foundation.updateProviderAttempt({
    ...attempt,
    acceptance: 'accepted',
    providerTaskRef: input.providerTaskRef,
    status: 'completed',
    updatedAt: now,
  });
  await input.foundation.appendProviderCost({
    id: input.providerCostEventId,
    workspaceId: input.workspaceId,
    attemptId: input.providerAttemptId,
    stage: 'observed',
    amountMicros: input.amountMicros,
    currency: 'CNY',
    unit: 'issue255_live_sample',
    evidence:
      input.usageEvidenceKind === 'provider_reported'
        ? 'issue255_provider_reported_terminal'
        : 'issue255_response_derived_image_terminal',
    payer: 'platform',
    billingStatus: 'known',
    actorId: 'issue-255-live-collector',
    correlationId: `${input.jobId}:correlation`,
    createdAt: now,
  });
  await input.foundation.updateGenerationJob({
    ...job,
    status: 'completed',
    result: {
      status: 'completed',
      issue255: {
        workspaceId: input.workspaceId,
        effectId: input.effectId,
        requestFingerprint: input.requestFingerprint,
        adapter: input.adapter,
        deploymentId: input.deploymentId,
        providerIdempotencyKey: input.providerIdempotencyKey,
        providerJobId: input.jobId,
        providerAttemptId: input.providerAttemptId,
        providerCostEventId: input.providerCostEventId,
      },
      attempt: {
        id: input.providerAttemptId,
        deploymentId: input.deploymentId,
        providerTaskRef: input.providerTaskRef,
      },
      providerCost: {
        id: input.providerCostEventId,
        status: 'observed',
        amountMicros: input.amountMicros,
        currency: 'CNY',
        usage: input.usage,
        usageEvidenceKind: input.usageEvidenceKind,
      },
      snapshot: {
        priceRevision: input.priceRevision,
        allowedCandidates: [
          {
            deploymentId: input.deploymentId,
            priceRevision: input.priceRevision,
          },
        ],
      },
    },
    updatedAt: now,
  });
}

function manifestSample(
  executor: Issue255LiveExecutor,
  receipt: Issue255LiveReceipt,
  wallClockMs: number,
): Issue255LiveManifest['samples'][number] {
  const terminal = receipt.terminalLineage;
  if (
    receipt.status !== 'completed' ||
    receipt.generationSubmitCount !== 1 ||
    receipt.actualAmountMicros === null ||
    !terminal ||
    !('usage' in terminal.providerCost)
  ) {
    throw new Error(
      'Issue 255 manifest requires a completed durable receipt.',
    );
  }
  const providerTaskRefHash =
    'providerTaskRef' in terminal.attempt
      ? hash(terminal.attempt.providerTaskRef)
      : 'providerTaskRefMissing' in terminal.attempt &&
          terminal.attempt.providerTaskRefMissing
        ? null
        : (() => {
            throw new Error(
              'Issue 255 manifest receipt has no trusted provider task reference state.',
            );
          })();
  return {
    modality: executor.modality,
    adapter: executor.adapter,
    catalogModelId: executor.catalogModelId,
    deploymentId: executor.deploymentId,
    evidenceKind: 'live',
    loopEvidence:
      executor.modality === 'copy'
        ? 'bounded_single_pass'
        : 'non_limit_loop',
    artifactRef:
      `live://issue-255/${executor.modality}/${receipt.effectId}`,
    effectId: receipt.effectId,
    requestFingerprint: receipt.requestFingerprint,
    providerTaskRefHash,
    usageEvidenceKind: terminal.providerCost.usageEvidenceKind,
    ...(terminal.providerCost.usageEvidenceKind === 'response_derived'
      ? { evidenceGap: 'tuzi_image_response_omits_usage' as const }
      : terminal.providerCost.usageEvidenceKind === 'price_card_reconciled'
        ? {
            evidenceGap:
              'tuzi_image_usage_missing_and_task_ref_not_persisted' as const,
          }
      : {}),
    configurationRevision: executor.configurationRevision,
    priceRevision: receipt.priceRevision,
    exchangeRevision: 'native-cny-v1',
    reservedAmountMicros: receipt.reservedAmountMicros,
    actualAmountMicros: receipt.actualAmountMicros,
    generationSubmitCount: 1,
    providerHttpRequestCount: receipt.providerHttpRequestCount,
    wallClockMs,
    usage: terminal.providerCost.usage,
  };
}

function assertResumableReceipt(input: {
  executor: Issue255LiveExecutor;
  receipt: Issue255LiveReceipt;
  workspaceId: string;
  effectId: string;
  requestFingerprint: string;
  providerJobId: string;
  providerAttemptId: string;
  providerCostEventId: string;
  recordedMatrixDigest: string;
}) {
  const { executor, receipt } = input;
  if (
    receipt.status !== 'completed' ||
    receipt.workspaceId !== input.workspaceId ||
    receipt.effectId !== input.effectId ||
    receipt.requestFingerprint !== input.requestFingerprint ||
    receipt.adapter !== executor.adapter ||
    receipt.deploymentId !== executor.deploymentId ||
    receipt.providerIdempotencyKey !== input.effectId ||
    receipt.providerJobId !== input.providerJobId ||
    receipt.providerAttemptId !== input.providerAttemptId ||
    receipt.providerCostEventId !== input.providerCostEventId ||
    receipt.recordedMatrixDigest !== input.recordedMatrixDigest ||
    receipt.reservedAmountMicros !== executor.quoteAmountMicros ||
    receipt.priceRevision !== executor.priceRevision ||
    receipt.exchangeRevision !== 'native-cny-v1'
  ) {
    throw new Error(
      `Issue 255 ${executor.modality} durable receipt cannot be resumed with this frozen executor identity.`,
    );
  }
}

function receiptWallClockMs(receipt: Issue255LiveReceipt) {
  const terminal = receipt.terminalLineage;
  if (terminal && 'observedWallClockMs' in terminal) {
    return terminal.observedWallClockMs;
  }
  const elapsed = Date.parse(receipt.updatedAt) - Date.parse(receipt.createdAt);
  return Number.isFinite(elapsed) ? Math.max(1, Math.ceil(elapsed)) : 1;
}

function manifestEvidenceDigests(manifest: Issue255LiveManifest) {
  const { samples, ...envelope } = manifest;
  return {
    envelope: hash(JSON.stringify(envelope)),
    samples: new Map(
      samples.map((sample) => [
        sample.effectId,
        hash(JSON.stringify(sample)),
      ]),
    ),
  };
}

export function assertIssue255SanitizedManifest(serialized: string) {
  if (
    /https?:\/\//iu.test(serialized) ||
    /postgres(?:ql)?:\/\//iu.test(serialized) ||
    /bearer\s+[a-z0-9._~-]+/iu.test(serialized) ||
    /"(?:authorization|api[_-]?key|credential[^"]*secret)"\s*:\s*"/iu.test(
      serialized,
    )
  ) {
    throw new Error('Issue 255 manifest secret scan failed.');
  }
}

function hash(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function defaultWait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function frozenPriceMicros(amount: string, label: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(amount.trim());
  if (!match) {
    throw new Error(`Issue 255 ${label} is not a positive frozen price.`);
  }
  const fraction = match[2] ?? '';
  const roundedMicros =
    BigInt(match[1]!) * 1_000_000n +
    BigInt(fraction.slice(0, 6).padEnd(6, '0')) +
    (/[1-9]/u.test(fraction.slice(6)) ? 1n : 0n);
  if (
    roundedMicros <= 0n ||
    roundedMicros > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`Issue 255 ${label} is not a positive frozen price.`);
  }
  return Number(roundedMicros);
}

export function assertIssue255PositiveFrozenPrice(
  amount: string,
  label: string,
) {
  frozenPriceMicros(amount, label);
  return amount.trim();
}

function requiredUsageQuantity(
  quantity: number | undefined,
  label: string,
) {
  if (!Number.isSafeInteger(quantity) || (quantity ?? 0) <= 0) {
    throw new Error(
      `Issue 255 ${label} is not trusted usage.`,
    );
  }
  return quantity!;
}

function proratedPriceMicros(
  components: readonly (readonly [priceMicros: number, quantity: number])[],
  denominator: number,
) {
  const divisor = BigInt(denominator);
  const numerator = components.reduce(
    (total, [priceMicros, quantity]) =>
      total + BigInt(priceMicros) * BigInt(quantity),
    0n,
  );
  const amount = (numerator + divisor - 1n) / divisor;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Issue 255 provider cost exceeds safe integer micros.');
  }
  return Number(amount);
}
