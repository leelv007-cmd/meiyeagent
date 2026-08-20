/**
 * Legacy durable replay admission seal (V31-26a) + U14 archive (RET-06).
 *
 * Two layers, different jobs:
 *
 * 1. Code-level U14 archive. Snapshot-less new claims and old durable replay
 *    fail closed. Production 30d hold / audit export / rollback drill remain
 *    ops proofs (see `U14_REMAINING_OPS_PROOFS`). Empty fixture inventory must
 *    not throw — it is the allow-archive path for the inventory code gate.
 *
 * 2. Operator-recorded seal row. Extra evidence that an installation stopped
 *    admitting snapshot-less tasks. Presence of the table or installation
 *    ledger is still not a gate: only the append-only seal row plus the
 *    code-level refuse below close the branch.
 *
 * Keep read-only history islands (ContentPackage / jobs/history readers,
 * interaction v1 projection, shadow observation). Do not DROP tables.
 */

/**
 * The seal row lives in the harness schema and is created by the same migration
 * as `harness_runtime.task_requests`, so it is guaranteed to exist everywhere
 * `claim()` runs. That is deliberate: probing for a table with `to_regclass`
 * would make admission depend on schema presence again, which is the exact
 * mistake this module exists to undo.
 */
export const LEGACY_REPLAY_ADMISSION_SEAL_TABLE =
  'harness_runtime.legacy_replay_admission_seal' as const;

export const LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID =
  'v31-26a-legacy-replay-admission-seal-v1' as const;

/**
 * Audit event type the seal proof must carry. The runtime request path never
 * writes this event type, so the seal cannot be produced by ordinary traffic.
 */
export const LEGACY_REPLAY_ADMISSION_SEAL_AUDIT_EVENT_TYPE =
  'legacy_replay_admission_seal' as const;

/** U14 RET-06: code-level archive of snapshot-less durable replay. */
export const LEGACY_DURABLE_REPLAY_ARCHIVE_SEALED = true as const;

export const LEGACY_REPLAY_CLOSED_MESSAGE =
  'Legacy durable replay is archived fail-closed (U14).' as const;

/** Minimal query surface satisfied by both `Pool` and a transaction client. */
export interface LegacyReplaySealQueryable {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

/**
 * Snapshot-less request with no pending freeze: the U14 legacy durable replay
 * population. Paid pending confirmation and admitted ExecutionPlanSnapshot
 * paths are not this branch.
 */
export function isUnarchivedLegacyDurableReplay(
  request: object | null | undefined,
): boolean {
  if (!request) return true;
  const candidate = request as {
    executionPlanSnapshot?: unknown;
    pendingExecutionPlanSnapshot?: unknown;
  };
  return (
    candidate.executionPlanSnapshot == null &&
    candidate.pendingExecutionPlanSnapshot == null
  );
}

/**
 * Fail closed on new or old snapshot-less durable replay after the U14 archive.
 * Snapshot and pending-confirmation requests pass through.
 */
export function refuseUnarchivedLegacyDurableReplay(
  request: object | null | undefined,
): void {
  if (!LEGACY_DURABLE_REPLAY_ARCHIVE_SEALED) return;
  if (isUnarchivedLegacyDurableReplay(request)) {
    throw new Error(LEGACY_REPLAY_CLOSED_MESSAGE);
  }
}

/**
 * True when the recorded operator seal row for this deployment is present.
 * Missing row or a foreign deployment id means the operator evidence is
 * absent; U14 code-level refuse still closes snapshot-less replay.
 */
export async function isLegacyReplayAdmissionSealed(
  client: LegacyReplaySealQueryable,
): Promise<boolean> {
  const sealed = await client.query<{ sealed: boolean }>(
    `select exists (
       select 1 from ${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}
        where singleton=true and deployment_id=$1
     ) as sealed`,
    [LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID],
  );
  return sealed.rows[0]?.sealed === true;
}
