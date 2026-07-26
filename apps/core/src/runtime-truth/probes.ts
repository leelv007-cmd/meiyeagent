import type { Pool } from 'pg';
import type { ReadinessCheckResult } from './types.js';
import {
  objectStorageModeReadinessFromEnv,
  providerModeReadinessFromEnv,
} from './readiness.js';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Business PostgreSQL connectivity probe. */
export function postgresqlProbe(pool: Queryable): () => Promise<ReadinessCheckResult> {
  return async () => {
    await pool.query('SELECT 1');
    return { name: 'postgresql', status: 'pass', detail: 'SELECT 1 ok' };
  };
}

/** DBOS system database connectivity (separate from business Postgres). */
export function dbosSystemDbProbe(
  pool: Queryable,
): () => Promise<ReadinessCheckResult> {
  return async () => {
    await pool.query('SELECT 1');
    return { name: 'dbos', status: 'pass', detail: 'DBOS system DB reachable' };
  };
}

/**
 * Schema compatibility: critical relations must exist after migration preflight.
 * Defaults cover business + harness markers commonly required for delivery.
 *
 * T40/E-01: the owned-asset marker used to read `public.model_owned_assets`, a
 * relation that exists in no migration and nowhere else in this repository —
 * `git grep` finds it only here. It survived because this probe was never
 * wired into the assembly, so nothing ever ran it. Wiring it (T40) turned that
 * stale constant into a permanent `not_ready` for every protected environment,
 * since the probe can never find the table. The real P1 owned-asset relation is
 * `public.p1_owned_assets`; the harness marker `public.p1_worker_metric_samples`
 * was already correct.
 */
export function schemaCompatibilityProbe(
  pool: Queryable,
  relations: string[] = [
    'public.p1_worker_metric_samples',
    'public.p1_owned_assets',
  ],
): () => Promise<ReadinessCheckResult> {
  return async () => {
    const missing: string[] = [];
    for (const relation of relations) {
      const result = await pool.query('SELECT to_regclass($1) AS reg', [
        relation,
      ]);
      const row = result.rows[0] as { reg: string | null } | undefined;
      if (!row?.reg) missing.push(relation);
    }
    if (missing.length > 0) {
      return {
        name: 'schema',
        status: 'fail',
        detail: `Missing relations: ${missing.join(', ')}`,
      };
    }
    return {
      name: 'schema',
      status: 'pass',
      detail: `Compatible relations present (${relations.length})`,
    };
  };
}

export interface ObjectStorageProbeTarget {
  /** Optional real R/W probe (preferred in production assembly). */
  probeReadWrite?: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

export interface ObjectStorageReadWriteTarget {
  bytes: Uint8Array;
  createObjectKey(): string;
  deleteObject(objectKey: string): Promise<void>;
  putObject(objectKey: string, bytes: Uint8Array): Promise<void>;
  readObject(objectKey: string): Promise<Uint8Array>;
}

/** Isolated object round trip; each invocation owns and deletes one unique key. */
export function objectStorageReadWriteRoundTrip(
  target: ObjectStorageReadWriteTarget,
): () => Promise<void> {
  return async () => {
    const objectKey = target.createObjectKey();
    await target.putObject(objectKey, target.bytes);
    try {
      const stored = await target.readObject(objectKey);
      if (
        stored.byteLength !== target.bytes.byteLength ||
        stored.some((byte, index) => byte !== target.bytes[index])
      ) {
        throw new Error('Object storage returned different bytes than were written.');
      }
    } finally {
      await target.deleteObject(objectKey);
    }
  };
}

/** Shared object storage: mode gate + optional live R/W probe. */
export function objectStorageProbe(
  target: ObjectStorageProbeTarget = {},
): () => Promise<ReadinessCheckResult> {
  return async () => {
    const mode = objectStorageModeReadinessFromEnv(target.env);
    if (mode.status === 'fail') return mode;
    if (!target.probeReadWrite) {
      return mode;
    }
    try {
      await target.probeReadWrite();
      return {
        name: 'objectStorage',
        status: 'pass',
        detail: 'Object storage read/write probe ok',
      };
    } catch (error) {
      return {
        name: 'objectStorage',
        status: 'fail',
        detail:
          error instanceof Error
            ? error.message
            : 'Object storage probe failed',
      };
    }
  };
}

export interface WorkerFreshnessSource {
  latestHeartbeatAt(): Promise<string | null>;
  now?: () => Date;
  staleAfterMs?: number;
}

/** Worker lease freshness based on latest heartbeat sample. */
export function workerFreshnessProbe(
  source: WorkerFreshnessSource,
): () => Promise<ReadinessCheckResult> {
  const staleAfterMs = source.staleAfterMs ?? 30_000;
  return async () => {
    const heartbeatAt = await source.latestHeartbeatAt();
    if (!heartbeatAt) {
      return {
        name: 'workerFreshness',
        status: 'fail',
        detail: 'No worker heartbeat sample is available.',
      };
    }
    const ageMs =
      (source.now?.() ?? new Date()).getTime() - Date.parse(heartbeatAt);
    if (!Number.isFinite(ageMs) || ageMs > staleAfterMs) {
      return {
        name: 'workerFreshness',
        status: 'fail',
        detail: `Worker heartbeat is stale (ageMs=${String(ageMs)}).`,
      };
    }
    return {
      name: 'workerFreshness',
      status: 'pass',
      detail: `Worker heartbeat ageMs=${ageMs}`,
    };
  };
}

export function providerModeProbe(
  env: NodeJS.ProcessEnv = process.env,
): () => ReadinessCheckResult {
  return () => providerModeReadinessFromEnv(env);
}

export interface OutboxBacklogSource {
  /** Count of critical ready-but-unprocessed outbox rows. */
  criticalBacklog(): Promise<number>;
  maxBacklog?: number;
}

/** Critical outbox backlog threshold (fail when stuck work piles up). */
export function outboxBacklogProbe(
  source: OutboxBacklogSource,
): () => Promise<ReadinessCheckResult> {
  const maxBacklog = source.maxBacklog ?? 500;
  return async () => {
    const backlog = await source.criticalBacklog();
    if (backlog > maxBacklog) {
      return {
        name: 'outbox',
        status: 'fail',
        detail: `Critical outbox backlog ${backlog} exceeds ${maxBacklog}.`,
      };
    }
    return {
      name: 'outbox',
      status: 'pass',
      detail: `Critical outbox backlog ${backlog}`,
    };
  };
}

export interface CanvasReachabilityOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  serviceToken?: string;
  timeoutMs?: number;
}

/** Canvas private health reachability. */
export function canvasReachabilityProbe(
  options: CanvasReachabilityOptions,
): () => Promise<ReadinessCheckResult> {
  return async () => {
    const base = options.baseUrl.replace(/\/+$/u, '');
    if (!base) {
      return {
        name: 'canvas',
        status: 'fail',
        detail: 'CANVAS_SERVICE_URL is not configured.',
      };
    }
    const fetcher = options.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 3_000,
    );
    try {
      const response = await fetcher(`${base}/api/internal/health`, {
        headers: options.serviceToken
          ? { 'x-canvas-service-token': options.serviceToken }
          : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          name: 'canvas',
          status: 'fail',
          detail: `Canvas health returned HTTP ${response.status}.`,
        };
      }
      return {
        name: 'canvas',
        status: 'pass',
        detail: 'Canvas private health reachable',
      };
    } catch (error) {
      return {
        name: 'canvas',
        status: 'fail',
        detail:
          error instanceof Error
            ? error.message
            : 'Canvas reachability probe failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Optional helper: postgres pool typed without forcing pg import at call sites. */
export type PostgresPool = Pool;
