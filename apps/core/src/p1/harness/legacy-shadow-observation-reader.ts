import type { Pool } from 'pg';

import {
  projectLegacyDeterministicFields,
  type ShadowDeterministicFields,
} from './shadow-reconciliation.js';
import { harnessRuntimeId } from './workspace-scope.js';

export interface LegacyShadowObservationReader {
  read(input: {
    workflowId: string;
    workspaceId: string;
  }): Promise<ShadowDeterministicFields | null>;
}

/**
 * Reads the frozen legacy runner projection already persisted by the pilot.
 * It never executes a model, media provider, billing port, or carrier runner.
 */
export class PostgresLegacyShadowObservationReader
  implements LegacyShadowObservationReader
{
  constructor(private readonly pool: Pool) {}

  async read(input: {
    workflowId: string;
    workspaceId: string;
  }): Promise<ShadowDeterministicFields | null> {
    const result = await this.pool.query<{ observation: unknown }>(
      `select payload->'legacyShadowObservation' as observation
         from harness_runtime.decision_traces
        where task_id=$1
          and payload ? 'legacyShadowObservation'
        order by created_at desc
        limit 1`,
      [harnessRuntimeId(input.workspaceId, input.workflowId)],
    );
    return parseLegacyShadowObservation(result.rows[0]?.observation);
  }
}

export function parseLegacyShadowObservation(
  value: unknown,
): ShadowDeterministicFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.deliverables) ||
    !Array.isArray(candidate.factRefs) ||
    !Array.isArray(candidate.rightsRefs) ||
    !candidate.quoteRef ||
    typeof candidate.quoteRef !== 'object' ||
    !candidate.bounds ||
    typeof candidate.bounds !== 'object'
  ) {
    return null;
  }
  try {
    return projectLegacyDeterministicFields(
      candidate as Parameters<typeof projectLegacyDeterministicFields>[0],
    );
  } catch {
    return null;
  }
}
