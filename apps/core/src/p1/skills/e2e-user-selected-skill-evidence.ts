/**
 * E2E-only read model for Spec E / #382: frozen admission request + assembly
 * audits for one task in the caller's workspace.
 *
 * Playwright uses this to assert injected skillStages and audit axes without
 * opening Langfuse or admin route-mocks.
 */

import type { Pool } from 'pg';

import { harnessRuntimeId } from '../harness/workspace-scope.js';

export type E2EUserSelectedSkillEvidence = {
  taskId: string;
  workspaceId: string;
  userSelectedSkillRefs: string[];
  skillStages: Record<
    string,
    Array<{
      skillRevisionRef: string;
      contentHash: string;
      promptNameAtVersion: string | null;
    }>
  >;
  rootAxes: {
    skillRevision: string | null;
    promptVersion: string | null;
    catalogRevision: string | null;
    scene: string | null;
  } | null;
  assemblyAudits: Array<{
    primitiveId: string;
    skillRevision: string | null;
    promptVersion: string | null;
    catalogRevision: string | null;
    scene: string | null;
    axisScope: string | null;
  }>;
  /** Flattened stage skill refs for easy Playwright matchers. */
  injectedSkillRevisionRefs: string[];
};

export class E2EUserSelectedSkillEvidenceReader {
  constructor(private readonly pool: Pool) {}

  async read(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<E2EUserSelectedSkillEvidence | null> {
    const workspaceId = input.workspaceId.trim();
    const taskId = input.taskId.trim();
    if (!workspaceId || !taskId) return null;

    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    // audit_events.workflow_id carries the harness runtime id (same value as
    // task_requests.runtime_id), NOT task_requests.workflow_id (raw task id).
    const requestRow = await this.pool.query<{
      runtime_id: string;
      request: unknown;
    }>(
      `select runtime_id, request
         from harness_runtime.task_requests
        where request->>'workspaceId'=$1
          and (task_id=$2 or workflow_id=$3 or runtime_id=$2)
        order by created_at, task_id
        limit 1`,
      [workspaceId, runtimeTaskId, taskId],
    );
    const row = requestRow.rows[0];
    if (!row) return null;

    const request = row.request as {
      workspaceId?: string;
      userSelectedSkillRefs?: string[];
      executionAssembly?: {
        skillStages?: Record<
          string,
          Array<{
            skillRevisionRef?: string;
            contentHash?: string;
            resolvedInstruction?: {
              prompt?: { name?: string; version?: string };
            };
          }>
        >;
        rootAxes?: {
          skillRevision?: { kind?: string; value?: string };
          promptVersion?: { kind?: string; value?: string };
          catalogRevision?: { kind?: string; value?: string };
          scene?: { kind?: string; value?: string };
        };
      };
    };
    if (request.workspaceId !== workspaceId) return null;

    const skillStages: E2EUserSelectedSkillEvidence['skillStages'] = {};
    const injected = new Set<string>();
    for (const [stage, entries] of Object.entries(
      request.executionAssembly?.skillStages ?? {},
    )) {
      skillStages[stage] = (entries ?? []).map((entry) => {
        const ref = entry.skillRevisionRef ?? '';
        if (ref) injected.add(ref);
        const prompt = entry.resolvedInstruction?.prompt;
        return {
          skillRevisionRef: ref,
          contentHash: entry.contentHash ?? '',
          promptNameAtVersion:
            prompt?.name && prompt?.version
              ? `${prompt.name}@${prompt.version}`
              : null,
        };
      });
    }

    const root = request.executionAssembly?.rootAxes;
    const axisValue = (axis?: { kind?: string; value?: string }) =>
      axis?.kind === 'bound' && typeof axis.value === 'string'
        ? axis.value
        : null;

    const auditRows = await this.pool.query<{
      payload: {
        skillRevision?: string | null;
        promptVersion?: string | null;
        catalogRevision?: string | null;
        scene?: string | null;
        axisScope?: string | null;
        payload?: { primitiveId?: string };
      };
    }>(
      `select payload
         from harness_runtime.audit_events
        where workflow_id=$1
          and event_type='agent_primitive.lifecycle'
          and payload->'payload'->>'primitiveId' like 'harness-assembly:%'
        order by created_at, id`,
      [row.runtime_id],
    );

    return {
      taskId,
      workspaceId,
      userSelectedSkillRefs: [...(request.userSelectedSkillRefs ?? [])],
      skillStages,
      rootAxes: root
        ? {
            skillRevision: axisValue(root.skillRevision),
            promptVersion: axisValue(root.promptVersion),
            catalogRevision: axisValue(root.catalogRevision),
            scene: axisValue(root.scene),
          }
        : null,
      assemblyAudits: auditRows.rows.map(({ payload }) => ({
        primitiveId: payload.payload?.primitiveId ?? '',
        skillRevision: payload.skillRevision ?? null,
        promptVersion: payload.promptVersion ?? null,
        catalogRevision: payload.catalogRevision ?? null,
        scene: payload.scene ?? null,
        axisScope: payload.axisScope ?? null,
      })),
      injectedSkillRevisionRefs: [...injected].sort(),
    };
  }
}
