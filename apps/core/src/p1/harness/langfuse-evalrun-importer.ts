import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';

import {
  LANGFUSE_DATASET_ITEM_FIELDS,
  type LangfuseHttpSenderOptions,
} from './langfuse-sender.js';
import type { EvalRunRegistryPort } from './eval-run-registry.js';

export const LANGFUSE_EVAL_RUN_DATASET_ITEM_FIELDS = [
  'id',
  'datasetName',
  'input',
  'expectedOutput',
  'metadata',
] as const satisfies ReadonlyArray<
  (typeof LANGFUSE_DATASET_ITEM_FIELDS)[number]
>;

export interface EvalRunImportResult {
  datasetName: string;
  importedItems: number;
  runId: string;
}

export class LangfuseEvalRunImporter {
  private readonly datasetItemsUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    private readonly options: LangfuseHttpSenderOptions,
    private readonly registry: EvalRunRegistryPort,
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.datasetItemsUrl = `${options.baseUrl.replace(/\/$/u, '')}/api/public/dataset-items`;
  }

  async importArtifact(artifactPath: string): Promise<EvalRunImportResult> {
    const run = await readEvalRunArtifact(artifactPath);
    const datasetName = `harness-evalrun:${run.suiteId}`;

    for (const result of run.results) {
      await this.postDatasetItem(projectDatasetItem(run, result, datasetName));
    }
    await this.registry.putImmutable(run.runId, run);

    return {
      datasetName,
      importedItems: run.results.length,
      runId: run.runId,
    };
  }

  /**
   * Observability-only push (no registry write). Used after local put+issue so
   * Langfuse downtime cannot block Spec I receipt issuance (#396).
   */
  async pushDatasetItems(run: EvalRun): Promise<{
    datasetName: string;
    pushedItems: number;
  }> {
    const datasetName = `harness-evalrun:${run.suiteId}`;
    for (const result of run.results) {
      await this.postDatasetItem(projectDatasetItem(run, result, datasetName));
    }
    return { datasetName, pushedItems: run.results.length };
  }

  private async postDatasetItem(body: unknown) {
    const response = await this.fetch(this.datasetItemsUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.options.publicKey}:${this.options.secretKey}`,
        ).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    if (!response.ok) {
      throw new Error(
        `Langfuse dataset item import failed with HTTP ${response.status}.`,
      );
    }
    const responseBody = await response.json().catch(() => null);
    if (
      isRecord(responseBody) &&
      Array.isArray(responseBody.errors) &&
      responseBody.errors.length > 0
    ) {
      throw new Error(
        'Langfuse dataset item import reported one or more errors.',
      );
    }
  }
}

export function langfuseEvalRunImporterFromEnv(
  env: Record<string, string | undefined> = process.env,
  registry: EvalRunRegistryPort,
) {
  const missing = [
    'LANGFUSE_BASE_URL',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
  ].filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `EvalRun importer is not configured: ${missing.join(', ')}.`,
    );
  }

  return new LangfuseEvalRunImporter(
    {
      baseUrl: env.LANGFUSE_BASE_URL!,
      publicKey: env.LANGFUSE_PUBLIC_KEY!,
      secretKey: env.LANGFUSE_SECRET_KEY!,
      ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
        ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
        : {}),
    },
    registry,
  );
}

export async function readEvalRunArtifact(artifactPath: string) {
  try {
    return evalRunSchema.parse(JSON.parse(await readFile(artifactPath, 'utf8')));
  } catch (error) {
    throw new Error(
      `EvalRun artifact validation failed for ${artifactPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

function projectDatasetItem(
  run: EvalRun,
  result: EvalRun['results'][number],
  datasetName: string,
) {
  // `reason` is unconstrained free text and `memoryDiff` contains complete
  // preference state. Neither is exported because both may carry prompt,
  // customer, or preference details; version and pass/fail facts are sufficient
  // for baseline and drift monitoring.
  return exactFields(LANGFUSE_EVAL_RUN_DATASET_ITEM_FIELDS, {
    id: stableUuid(`dataset-item:eval-run:${run.runId}:${result.caseId}`),
    datasetName,
    input: {
      caseId: result.caseId,
      gateId: result.gateId,
      promptRevision: result.promptRevision,
      ...(result.skillRevisionRef
        ? { skillRevisionRef: result.skillRevisionRef }
        : {}),
      scorerRevision: result.scorerRevision,
    },
    expectedOutput: { passed: result.passed },
    metadata: {
      schemaVersion: run.schemaVersion,
      runId: run.runId,
      suiteId: run.suiteId,
      suiteRevision: run.suiteRevision,
      mode: run.mode,
      createdAt: run.createdAt,
      runPassed: run.passed,
    },
  });
}

function exactFields<const Fields extends readonly string[]>(
  fields: Fields,
  input: Record<Fields[number], unknown>,
) {
  return Object.fromEntries(
    fields.map((field) => [field, input[field as Fields[number]]]),
  );
}

function stableUuid(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('LANGFUSE_REQUEST_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}
