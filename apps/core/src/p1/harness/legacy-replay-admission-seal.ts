/**
 * Explicit legacy-replay admission seal (V31-26a).
 *
 * The U14 installation ledger proves "this installation never carried legacy
 * replay history". It is *evidence*, not a gate: the presence of its table says
 * nothing about whether the paid snapshot chain is wired, so keying admission on
 * schema presence closes the branch production still runs on.
 *
 * Admission is therefore closed only by an explicit, append-only seal row that
 * an operator inserts once every branch genuinely produces an
 * ExecutionPlanSnapshot. Until that row exists the legacy branch stays open.
 */

export const LEGACY_REPLAY_ADMISSION_SEAL_TABLE =
  'p1_legacy_replay_admission_seal' as const;

export const LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID =
  'v31-26a-legacy-replay-admission-seal-v1' as const;

/**
 * Audit event type the seal proof must carry. The runtime request path never
 * writes this event type, so the seal cannot be produced by ordinary traffic.
 */
export const LEGACY_REPLAY_ADMISSION_SEAL_AUDIT_EVENT_TYPE =
  'legacy_replay_admission_seal' as const;

/** Minimal query surface satisfied by both `Pool` and a transaction client. */
export interface LegacyReplaySealQueryable {
  query<Row extends Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

/**
 * True only when the seal table exists *and* carries the matching deployment
 * row. A missing table, a missing row, or a foreign deployment id all mean
 * "legacy replay admission is still open" — fail open for the live branch.
 */
export async function isLegacyReplayAdmissionSealed(
  client: LegacyReplaySealQueryable,
): Promise<boolean> {
  const installed = await client.query<{ installed: boolean }>(
    `select to_regclass('public.${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}')
              is not null as installed`,
  );
  if (installed.rows[0]?.installed !== true) return false;
  const sealed = await client.query<{ sealed: boolean }>(
    `select exists (
       select 1 from ${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}
        where singleton=true and deployment_id=$1
     ) as sealed`,
    [LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID],
  );
  return sealed.rows[0]?.sealed === true;
}
