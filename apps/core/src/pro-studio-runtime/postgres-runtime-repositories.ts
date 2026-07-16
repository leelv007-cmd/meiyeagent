import type {
  AdvancedCanvasAdoptionRepository,
  AdvancedCanvasAdoptionWorkspaceState,
} from './adoption.js';
import { createEmptyAdvancedCanvasAdoptionState } from './adoption.js';
import type {
  AgentAuditEvent,
  AgentConfirmation,
  AgentPlan,
  CanvasAgentGraph,
  CanvasAgentRepository,
  CanvasAgentTransactionContext,
  CanvasAgentTransactionalAuthorizationPort,
  CanvasAgentWorkspaceState,
} from './canvas-agent.js';
import {
  canvasAgentRevisionId,
  CanvasAgentError,
  createEmptyCanvasAgentState,
} from './canvas-agent.js';
import type {
  CanvasGenerationRepository,
  CanvasGenerationWorkspaceState,
} from './generation-runtime.js';
import { createEmptyCanvasGenerationState } from './generation-runtime.js';
import type {
  ProStudioEntitlementRepository,
  ProStudioEntitlementState,
} from './entitlement.js';
import { createEmptyProStudioEntitlementState } from './entitlement.js';
import {
  PostgresWorkspaceStateRepository,
  type WorkspaceStatePool,
} from './postgres-workspace-state.js';
import { canvasOwnedAssetVersionUnionSql } from './canvas-owned-asset-union.js';

export function createPostgresCanvasGenerationRepository(
  pool: WorkspaceStatePool
): CanvasGenerationRepository {
  return new PostgresWorkspaceStateRepository<CanvasGenerationWorkspaceState>(
    pool,
    {
      createInitialState: createEmptyCanvasGenerationState,
      namespace: 'generation',
    }
  );
}

export function createPostgresProStudioEntitlementRepository(
  pool: WorkspaceStatePool
): ProStudioEntitlementRepository {
  return new PostgresWorkspaceStateRepository<ProStudioEntitlementState>(pool, {
    createInitialState: createEmptyProStudioEntitlementState,
    namespace: 'entitlement',
  });
}

export function createPostgresAdvancedCanvasAdoptionRepository(
  pool: WorkspaceStatePool
): AdvancedCanvasAdoptionRepository {
  return new PostgresWorkspaceStateRepository<AdvancedCanvasAdoptionWorkspaceState>(
    pool,
    {
      createInitialState: createEmptyAdvancedCanvasAdoptionState,
      namespace: 'adoption',
    }
  );
}

export class PostgresCanvasAgentRepository implements CanvasAgentRepository {
  private readonly state: PostgresWorkspaceStateRepository<CanvasAgentWorkspaceState>;

  constructor(
    private readonly pool: WorkspaceStatePool,
    private readonly transactionalAuthorization?: CanvasAgentTransactionalAuthorizationPort
  ) {
    this.state = new PostgresWorkspaceStateRepository(pool, {
      createInitialState: createEmptyCanvasAgentState,
      namespace: 'agent',
    });
  }

  async readGraph(workspaceId: string, projectId: string) {
    const client = await this.pool.connect();
    try {
      const project = await client.query<CanvasProjectRow>(
        `SELECT id, graph, draft_version
				 FROM advanced_canvas_projects
				 WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [workspaceId, projectId]
      );
      const row = project.rows[0];
      if (!row) return null;
      return projectRowToAgentGraph(
        workspaceId,
        row,
        await readAssetVersions(client, workspaceId)
      );
    } finally {
      client.release();
    }
  }

  async savePlan(workspaceId: string, plan: AgentPlan) {
    await this.state.transact(workspaceId, (state) => {
      if (!state.plans.some((candidate) => candidate.id === plan.id)) {
        state.plans.push(structuredClone(plan));
      }
    });
  }

  async readPlan(workspaceId: string, planId: string) {
    const state = await this.state.read(workspaceId);
    return cloneOrNull(
      state.plans.find((candidate) => candidate.id === planId)
    );
  }

  async readConfirmation(workspaceId: string, confirmationId: string) {
    const state = await this.state.read(workspaceId);
    return cloneOrNull(
      state.confirmations.find((candidate) => candidate.id === confirmationId)
    );
  }

  async listConfirmations(workspaceId: string) {
    const state = await this.state.read(workspaceId);
    return structuredClone(state.confirmations);
  }

  async saveConfirmation(workspaceId: string, confirmation: AgentConfirmation) {
    await this.state.transact(workspaceId, (state) => {
      if (
        !state.confirmations.some(
          (candidate) => candidate.id === confirmation.id
        )
      ) {
        state.confirmations.push(structuredClone(confirmation));
      }
    });
  }

  transact<Result>(
    workspaceId: string,
    action: (
      state: CanvasAgentWorkspaceState,
      transaction?: CanvasAgentTransactionContext
    ) => Result | Promise<Result>
  ) {
    return this.transactWithProjects(workspaceId, action);
  }

  async appendAudit(workspaceId: string, event: AgentAuditEvent) {
    await this.state.transact(workspaceId, (state) => {
      state.auditEvents.push(structuredClone(event));
    });
  }

  private async transactWithProjects<Result>(
    workspaceId: string,
    action: (
      state: CanvasAgentWorkspaceState,
      transaction?: CanvasAgentTransactionContext
    ) => Result | Promise<Result>
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO pro_studio_workspace_state
				   (namespace, workspace_id, state, updated_at)
				 VALUES ('agent', $1, $2, now())
				 ON CONFLICT (namespace, workspace_id) DO NOTHING`,
        [workspaceId, createEmptyCanvasAgentState()]
      );
      const stored = await client.query<{ state: CanvasAgentWorkspaceState }>(
        `SELECT state
				 FROM pro_studio_workspace_state
				 WHERE namespace = 'agent' AND workspace_id = $1
				 FOR UPDATE`,
        [workspaceId]
      );
      const projects = await client.query<CanvasProjectRow>(
        `SELECT id, graph, draft_version
				 FROM advanced_canvas_projects
				 WHERE workspace_id = $1 AND deleted_at IS NULL
				 FOR UPDATE`,
        [workspaceId]
      );
      const assetVersions = await readAssetVersions(client, workspaceId);
      const state = structuredClone(
        stored.rows[0]?.state ?? createEmptyCanvasAgentState()
      );
      state.graphs = projects.rows.map((row) =>
        projectRowToAgentGraph(workspaceId, row, assetVersions)
      );
      const auditEventCount = state.auditEvents.length;
      const transaction: CanvasAgentTransactionContext = {
        resolveAuthorization: (input) => {
          if (!this.transactionalAuthorization) {
            throw new CanvasAgentError(
              'AGENT_TRANSACTION_AUTHORITY_UNAVAILABLE',
              'Canvas Agent transaction authorization is unavailable.'
            );
          }
          return this.transactionalAuthorization.resolveInTransaction(
            client,
            input
          );
        },
      };
      const result = await action(state, transaction);
      for (const row of projects.rows) {
        const graph = state.graphs.find(
          (candidate) => candidate.projectId === row.id
        );
        if (!graph || graph.revision === Number(row.draft_version)) continue;
        if (graph.revision !== Number(row.draft_version) + 1) {
          throw new CanvasAgentError(
            'REVISION_CONFLICT',
            'Agent revision did not advance exactly once.'
          );
        }
        const storedGraph = agentGraphToProjectGraph(graph, row.graph);
        const updated = await client.query<{ id: string }>(
          `UPDATE advanced_canvas_projects
					 SET graph = $4, draft_version = $3, updated_at = now()
					 WHERE workspace_id = $1 AND id = $2
					   AND draft_version = $5 AND deleted_at IS NULL
					 RETURNING id`,
          [
            workspaceId,
            row.id,
            graph.revision,
            storedGraph,
            row.draft_version,
          ]
        );
        if (!updated.rows[0]) {
          throw new CanvasAgentError(
            'REVISION_CONFLICT',
            'Canvas revision changed during Agent execution.'
          );
        }
        const audit = state.auditEvents
          .slice(auditEventCount)
          .find(
            (event) =>
              event.projectId === graph.projectId && event.operationHash
          );
        if (!audit?.operationHash) {
          throw new CanvasAgentError(
            'CONFIRMATION_INVALID',
            'Agent revision is missing its confirmed operation hash.'
          );
        }
        await client.query(
          `INSERT INTO advanced_canvas_revisions
				 (workspace_id, project_id, id, graph, draft_version, reason,
				  label, created_by, created_at)
			 VALUES ($1, $2, $3, $4, $5, 'agent', NULL, $6, $7::timestamptz)`,
          [
            workspaceId,
            graph.projectId,
            canvasAgentRevisionId({
              operationHash: audit.operationHash,
              projectId: graph.projectId,
              revision: graph.revision,
              workspaceId,
            }),
            storedGraph,
            graph.revision,
            audit.userId,
            audit.createdAt,
          ]
        );
      }
      state.graphs = [];
      await client.query(
        `UPDATE pro_studio_workspace_state
				 SET state = $2, updated_at = now()
				 WHERE namespace = 'agent' AND workspace_id = $1`,
        [workspaceId, state]
      );
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface CanvasProjectRow {
  id: string;
  draft_version: string | number;
  graph: {
    schemaVersion: 1;
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{
      id?: string;
      source: string;
      target: string;
      type?: string;
    }>;
  };
}

function projectRowToAgentGraph(
  workspaceId: string,
  row: CanvasProjectRow,
  assetVersions: Record<string, string>
): CanvasAgentGraph {
  return {
    workspaceId,
    projectId: row.id,
    revision: Number(row.draft_version),
    nodes: row.graph.nodes.map((node) => ({
      id: node.id,
      kind: agentNodeKind(node.type),
      data: structuredClone(node.data),
    })),
    edges: row.graph.edges.map((edge) => ({
      id: edge.id ?? `edge-${edge.source}-${edge.target}`,
      from: edge.source,
      to: edge.target,
    })),
    assetVersions: structuredClone(assetVersions),
  };
}

function agentGraphToProjectGraph(
  graph: CanvasAgentGraph,
  original: CanvasProjectRow['graph']
): CanvasProjectRow['graph'] {
  const originalTypes = new Map(
    original.nodes.map((node) => [node.id, node.type])
  );
  return {
    schemaVersion: 1,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type:
        node.kind === 'config' && originalTypes.get(node.id)
          ? (originalTypes.get(node.id) as string)
          : node.kind,
      data: structuredClone(node.data),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
    })),
  };
}

function agentNodeKind(
  type: string
): CanvasAgentGraph['nodes'][number]['kind'] {
  return ['text', 'image', 'video', 'audio', 'config'].includes(type)
    ? (type as CanvasAgentGraph['nodes'][number]['kind'])
    : 'config';
}

async function readAssetVersions(
  client: Awaited<ReturnType<WorkspaceStatePool['connect']>>,
  workspaceId: string
) {
  const assets = await client.query<{ id: string; sha256: string }>(
    canvasOwnedAssetVersionUnionSql('$1'),
    [workspaceId]
  );
  return Object.fromEntries(
    assets.rows.map((asset) => [asset.id, asset.sha256])
  );
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : structuredClone(value);
}
