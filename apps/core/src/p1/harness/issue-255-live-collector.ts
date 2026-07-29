import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
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
  video: 3_000_000,
} as const;

type Modality = (typeof modalities)[number];

type ProviderTerminal = {
  providerTaskRef: string;
  amountMicros: number;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    mediaUnits?: number;
  };
  usageEvidenceKind: 'provider_reported';
};

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
        generationSubmitCap: z.literal(3),
        probeCapMicros: z.literal(3_600_000),
        globalCapMicros: z.literal(5_000_000),
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
            providerTaskRefHash: z.string().regex(/^[a-f0-9]{64}$/u),
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
      .length(3),
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
  const executors = validateExecutors(input.executors);
  const workspaceId =
    `issue-255-live-${hash(runNonce).slice(0, 24)}`;
  const manifestSamples: Issue255LiveManifest['samples'] = [];

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
        recordedMatrixDigest,
      }),
    );
    const providerJobId =
      `issue-255-job-${effectId.slice(0, 32)}`;
    const providerAttemptId =
      `issue-255-attempt-${effectId.slice(0, 28)}`;
    const providerCostEventId =
      `issue-255-cost-${effectId.slice(0, 28)}`;
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
      await input.receipts.markUnknown({
        runNonce,
        modality: executor.modality,
        effectId,
        requestFingerprint,
        reason: 'provider_acceptance_unknown',
      });
      throw error;
    }
    if (
      terminal.amountMicros <= 0 ||
      terminal.amountMicros > executor.quoteAmountMicros ||
      terminal.usageEvidenceKind !== 'provider_reported'
    ) {
      await input.receipts.markUnknown({
        runNonce,
        modality: executor.modality,
        effectId,
        requestFingerprint,
        reason: 'provider_acceptance_unknown',
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

  const pendingPath = `${input.manifestPath}.pending`;
  await mkdir(dirname(input.manifestPath), {
    mode: 0o700,
    recursive: true,
  });
  const preliminary = manifestSchema.parse({
    schemaVersion: 1,
    runNonceHash: hash(runNonce),
    recordedMatrixDigest,
    authorization: {
      generationSubmitCap: 3,
      probeCapMicros: 3_600_000,
      globalCapMicros: 5_000_000,
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
  const serialized = `${JSON.stringify(preliminary, null, 2)}\n`;
  assertIssue255SanitizedManifest(serialized);
  await writeFile(pendingPath, serialized, { flag: 'wx', mode: 0o600 });

  await input.database.query(
    'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
    [runNonce],
  );
  await input.database.query(
    'DELETE FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  const residue = await input.database.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM issue255_live_generation_receipts WHERE run_nonce = $1) +
       (SELECT COUNT(*) FROM workspaces WHERE id = $2)
     )::int AS count`,
    [runNonce, workspaceId],
  );
  if (residue.rows[0]?.count !== 0) {
    throw new Error('Issue 255 live collector cleanup left database residue.');
  }
  await rename(pendingPath, input.manifestPath);
  return preliminary;
}

export function issue255DirectCopyExecutor(input: {
  configurationRevision: string;
  credentialRevision: string;
  deploymentId: string;
  options: OpenAiCompatibleLlmExecutionOptions;
  priceRevision: string;
  receipts: Issue255ReceiptFence;
}): Issue255LiveExecutor {
  const prompt =
    '基于门店已确认事实写三条合规且彼此不同的小红书护理介绍，不添加疗效承诺或虚构优惠。';
  const inputPriceMicrosPerMillion = frozenPriceMicros(
    input.options.inputCostPerMillion,
    'direct input price',
  );
  const outputPriceMicrosPerMillion = frozenPriceMicros(
    input.options.outputCostPerMillion,
    'direct output price',
  );
  return {
    adapter: 'direct-copy',
    catalogModelId: input.options.catalogModelId,
    configurationRevision: input.configurationRevision,
    credentialRevision: input.credentialRevision,
    deploymentId: input.deploymentId,
    modality: 'copy',
    priceRevision: input.priceRevision,
    promptHash: hash(prompt),
    quoteAmountMicros: approvedQuoteMicros.copy,
    async execute(identity) {
      const port = createIssue255DirectCopyPort({
        identity: {
          ...identity,
          deploymentId: input.deploymentId,
          modality: 'copy',
          providerIdempotencyKey: identity.effectId,
        },
        options: input.options,
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
      const result = await port.execute(request);
      if (
        result.kind !== 'completed' ||
        !result.providerTaskRef ||
        result.providerCost.currency !== 'CNY' ||
        (result.providerCost.usage.inputTokens ?? 0) <= 0 ||
        (result.providerCost.usage.outputTokens ?? 0) <= 0
      ) {
        const detail =
          result.kind === 'failure'
            ? `${result.acceptance}:${result.message}`
            : 'terminal_cost_or_usage_invalid';
        throw new Error(
          `Issue 255 direct copy provider did not return a trusted terminal: ${detail}.`,
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
  modality: 'image_text' | 'video';
  options: TuziMediaExecutionOptions;
  priceRevision: string;
  receipts: Issue255ReceiptFence;
  wait?: (milliseconds: number) => Promise<void>;
}): Issue255LiveExecutor {
  const isImage = input.modality === 'image_text';
  const prompt = isImage
    ? '生成一张不含文字、不含人物肖像的中性美业护理氛围图。'
    : '生成一段一秒钟、不含人物肖像和文字的中性美业护理氛围视频。';
  const catalogModelId = isImage
    ? input.options.image.catalogModelId
    : input.options.video.catalogModelId;
  const priceMicros = frozenPriceMicros(
    isImage
      ? input.options.image.costPerImage
      : input.options.video.costPerMillionTokens,
    isImage ? 'Tuzi image price' : 'Tuzi video price',
  );
  return {
    adapter: isImage ? 'tuzi-image' : 'tuzi-video',
    catalogModelId,
    configurationRevision: input.configurationRevision,
    credentialRevision: input.credentialRevision,
    deploymentId: input.deploymentId,
    modality: input.modality,
    priceRevision: input.priceRevision,
    promptHash: hash(prompt),
    quoteAmountMicros: approvedQuoteMicros[input.modality],
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
            : { durationSeconds: 1 },
        ),
        effectIdempotencyKey: identity.effectId,
      };
      request.submission.idempotencyKey = identity.effectId;
      request.jobId = identity.effectId;
      request.submission.prompt = prompt;
      const submitted = await port.submit(request);
      if (submitted.acceptance !== 'accepted' || !submitted.taskRef) {
        throw new Error(
          `Issue 255 ${input.modality} provider did not accept the fixed sample.`,
        );
      }
      if (isImage) {
        if (
          submitted.usageEvidenceKind !== 'provider_reported' ||
          submitted.providerCost.currency !== 'CNY'
        ) {
          throw new Error(
            'Issue 255 image terminal lacks provider-reported usage.',
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
          usageEvidenceKind: 'provider_reported',
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
          throw new Error(
            `Issue 255 video provider ended as ${terminal.status}.`,
          );
        }
        await (input.wait ?? defaultWait)(2_000);
      }
      throw new Error('Issue 255 video provider polling timed out.');
    },
  };
}

function validateExecutors(input: readonly Issue255LiveExecutor[]) {
  const parsed = z
    .array(z.custom<Issue255LiveExecutor>())
    .length(3)
    .parse(input);
  for (const [index, modality] of modalities.entries()) {
    const executor = parsed[index];
    if (
      !executor ||
      executor.modality !== modality ||
      executor.adapter !==
        (modality === 'copy'
          ? 'direct-copy'
          : modality === 'image_text'
            ? 'tuzi-image'
            : 'tuzi-video') ||
      executor.quoteAmountMicros !== approvedQuoteMicros[modality]
    ) {
      throw new Error(
        'Issue 255 live executors must be fixed copy, image_text, video with approved quotes.',
      );
    }
  }
  return parsed;
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
    evidence: 'issue255_provider_reported_terminal',
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
    !terminal
  ) {
    throw new Error(
      'Issue 255 manifest requires a completed durable receipt.',
    );
  }
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
    providerTaskRefHash: hash(terminal.attempt.providerTaskRef),
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

function frozenPriceMicros(amount: number, label: string) {
  const micros = Math.ceil(amount * 1_000_000);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(micros)
  ) {
    throw new Error(`Issue 255 ${label} is not a safe frozen price.`);
  }
  return micros;
}

function requiredUsageQuantity(
  quantity: number | undefined,
  label: string,
) {
  if (!Number.isSafeInteger(quantity) || (quantity ?? 0) <= 0) {
    throw new Error(
      `Issue 255 ${label} is not trusted provider-reported usage.`,
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
