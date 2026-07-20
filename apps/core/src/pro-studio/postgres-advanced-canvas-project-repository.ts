import type { Pool, QueryResultRow } from 'pg';
import type {
  AdvancedCanvasAuditEvent,
  AdvancedCanvasProject,
  AdvancedCanvasProjectRepository,
  AdvancedCanvasRevision,
  CanvasGraph,
  DraftWriteResult,
  RevisionWriteResult,
} from './advanced-canvas-project.js';

interface ProjectRow extends QueryResultRow {
  createdAt: string;
  createdBy: string;
  deletedAt: string | null;
  draftVersion: string | number;
  graph: CanvasGraph;
  id: string;
  name: string;
  updatedAt: string;
  workspaceId: string;
}

interface RevisionRow extends QueryResultRow {
  createdAt: string;
  createdBy: string;
  draftVersion: string | number;
  graph: CanvasGraph;
  id: string;
  label: string | null;
  projectId: string;
  reason: AdvancedCanvasRevision['reason'];
  workspaceId: string;
}

export class PostgresAdvancedCanvasProjectRepository
  implements AdvancedCanvasProjectRepository
{
  constructor(private readonly pool: Pool) {}

  async appendAudit(event: AdvancedCanvasAuditEvent) {
    await this.pool.query(
      `INSERT INTO pro_studio_audit_events
       (workspace_id, action, project_id, actor_id, detail, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
      [
        event.workspaceId,
        event.action,
        event.projectId ?? null,
        event.actorId,
        JSON.stringify({
          objectId: event.objectId,
          objectKind: event.objectKind,
        }),
        event.createdAt,
      ]
    );
  }

  async insertProject(project: AdvancedCanvasProject) {
    await this.pool.query(
      `INSERT INTO advanced_canvas_projects
       (workspace_id,id,name,graph,draft_version,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::timestamptz,$8::timestamptz)`,
      [
        project.workspaceId,
        project.id,
        project.name,
        JSON.stringify(project.graph),
        project.draftVersion,
        project.createdBy,
        project.createdAt,
        project.updatedAt,
      ]
    );
  }

  async listProjects(workspaceId: string) {
    const result = await this.pool.query<ProjectRow>(
      `${projectSelect()}
         WHERE workspace_id = $1 AND deleted_at IS NULL
         ORDER BY created_at, id`,
      [workspaceId]
    );
    return result.rows.map(mapProject);
  }

  async getProject(workspaceId: string, projectId: string) {
    const result = await this.pool.query<ProjectRow>(
      `${projectSelect()}
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, projectId]
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async renameProject(input: {
    name: string;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }) {
    const result = await this.pool.query<ProjectRow>(
      `UPDATE advanced_canvas_projects
          SET name = $3, updated_at = $4::timestamptz
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING ${projectColumns()}`,
      [input.workspaceId, input.projectId, input.name, input.updatedAt]
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async softDeleteProject(input: {
    deletedAt: string;
    projectId: string;
    workspaceId: string;
  }) {
    const result = await this.pool.query(
      `UPDATE advanced_canvas_projects
          SET deleted_at = $3::timestamptz, updated_at = $3::timestamptz
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [input.workspaceId, input.projectId, input.deletedAt]
    );
    return result.rowCount === 1;
  }

  async purgeExpiredDeletedProjects(input: {
    cutoffIso: string;
    workspaceId?: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const projects = await client.query<{ id: string }>(
        `SELECT id
           FROM advanced_canvas_projects AS project
          WHERE project.deleted_at IS NOT NULL
            AND project.deleted_at < $1::timestamptz
            AND ($2::text IS NULL OR project.workspace_id = $2)
            AND NOT EXISTS (
              SELECT 1
                FROM p1_content_packages AS content_package
               WHERE content_package.workspace_id = project.workspace_id
                 AND EXISTS (
                   SELECT 1
                     FROM jsonb_array_elements(
                       COALESCE(content_package.payload->'versions', '[]'::jsonb)
                     ) AS version
                    WHERE version->'sourceRef'->'advancedCanvas'->>'projectId' = project.id
                 )
            )
          FOR UPDATE`,
        [input.cutoffIso, input.workspaceId ?? null]
      );
      const ids = projects.rows.map((row) => row.id);
      if (ids.length === 0) {
        await client.query('COMMIT');
        return [];
      }
      await client.query(
        `DELETE FROM advanced_canvas_revisions
          WHERE project_id = ANY($1::text[])`,
        [ids]
      );
      await client.query(
        `DELETE FROM advanced_canvas_projects
          WHERE id = ANY($1::text[])`,
        [ids]
      );
      await client.query('COMMIT');
      return ids;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveDraft(input: {
    expectedDraftVersion: number;
    graph: CanvasGraph;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }): Promise<DraftWriteResult> {
    const result = await this.pool.query<ProjectRow>(
      `UPDATE advanced_canvas_projects
          SET graph = $4::jsonb,
              draft_version = draft_version + 1,
              updated_at = $5::timestamptz
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
          AND draft_version = $3
        RETURNING ${projectColumns()}`,
      [
        input.workspaceId,
        input.projectId,
        input.expectedDraftVersion,
        JSON.stringify(input.graph),
        input.updatedAt,
      ]
    );
    if (result.rows[0]) {
      return { kind: 'saved', project: mapProject(result.rows[0]) };
    }
    return (await this.getProject(input.workspaceId, input.projectId))
      ? { kind: 'conflict' }
      : { kind: 'not_found' };
  }

  async createCheckpoint(input: {
    expectedDraftVersion: number;
    revision: Omit<AdvancedCanvasRevision, 'draftVersion' | 'graph'>;
  }): Promise<RevisionWriteResult> {
    const result = await this.pool.query<RevisionRow>(
      `INSERT INTO advanced_canvas_revisions
       (workspace_id,project_id,id,graph,draft_version,reason,label,created_by,created_at)
       SELECT workspace_id,id,$3,graph,draft_version,$5,$6,$7,$8::timestamptz
         FROM advanced_canvas_projects
        WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
          AND draft_version = $4
       RETURNING ${revisionColumns()}`,
      [
        input.revision.workspaceId,
        input.revision.projectId,
        input.revision.id,
        input.expectedDraftVersion,
        input.revision.reason,
        input.revision.label ?? null,
        input.revision.createdBy,
        input.revision.createdAt,
      ]
    );
    if (result.rows[0]) {
      return { kind: 'created', revision: mapRevision(result.rows[0]) };
    }
    return (await this.getProject(
      input.revision.workspaceId,
      input.revision.projectId
    ))
      ? { kind: 'conflict' }
      : { kind: 'not_found' };
  }

  async listRevisions(workspaceId: string, projectId: string) {
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect()}
         WHERE workspace_id = $1 AND project_id = $2
         ORDER BY created_at, id`,
      [workspaceId, projectId]
    );
    return result.rows.map(mapRevision);
  }

  async getRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string
  ) {
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect()}
         WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [workspaceId, projectId, revisionId]
    );
    return result.rows[0] ? mapRevision(result.rows[0]) : null;
  }
}

function projectSelect() {
  return `SELECT ${projectColumns()} FROM advanced_canvas_projects`;
}

function projectColumns() {
  return `id, workspace_id AS "workspaceId", name, graph,
          draft_version AS "draftVersion", created_by AS "createdBy",
          created_at::text AS "createdAt", updated_at::text AS "updatedAt",
          deleted_at::text AS "deletedAt"`;
}

function revisionSelect() {
  return `SELECT ${revisionColumns()} FROM advanced_canvas_revisions`;
}

function revisionColumns() {
  return `id, workspace_id AS "workspaceId", project_id AS "projectId",
          graph, draft_version AS "draftVersion", reason, label,
          created_by AS "createdBy", created_at::text AS "createdAt"`;
}

function mapProject(row: ProjectRow): AdvancedCanvasProject {
  return {
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
    draftVersion: Number(row.draftVersion),
    graph: row.graph,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    workspaceId: row.workspaceId,
  };
}

function mapRevision(row: RevisionRow): AdvancedCanvasRevision {
  return {
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    draftVersion: Number(row.draftVersion),
    graph: row.graph,
    id: row.id,
    ...(row.label ? { label: row.label } : {}),
    projectId: row.projectId,
    reason: row.reason,
    workspaceId: row.workspaceId,
  };
}
