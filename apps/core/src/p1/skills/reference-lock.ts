import type { PoolClient } from 'pg';

export function lockSkillReferenceTarget(
  client: PoolClient,
  targetSkillRevisionRef: string,
) {
  return client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('skill-reference-target:' || $1, 0)
     )`,
    [targetSkillRevisionRef],
  );
}
