export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CanvasNode {
  data: Record<string, JsonValue>;
  id: string;
  type: string;
}

export interface CanvasEdge {
  id?: string;
  source: string;
  target: string;
  type?: string;
}

export interface CanvasGraph {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  schemaVersion: 1;
}

export interface AdvancedCanvasProject {
  createdAt: string;
  createdBy: string;
  deletedAt?: string;
  draftVersion: number;
  graph: CanvasGraph;
  id: string;
  name: string;
  updatedAt: string;
  workspaceId: string;
}

export interface AdvancedCanvasRevision {
  createdAt: string;
  createdBy: string;
  draftVersion: number;
  graph: CanvasGraph;
  id: string;
  label?: string;
  projectId: string;
  reason: 'adoption' | 'agent' | 'checkpoint';
  workspaceId: string;
}

export interface AdvancedCanvasContext {
  userId: string;
  workspaceId: string;
}

export interface AdvancedCanvasAuditEvent {
  action: 'project_access_denied';
  actorId: string;
  createdAt: string;
  projectId: string;
  workspaceId: string;
}

export type DraftWriteResult =
  | { kind: 'saved'; project: AdvancedCanvasProject }
  | { kind: 'conflict' }
  | { kind: 'not_found' };

export type RevisionWriteResult =
  | { kind: 'created'; revision: AdvancedCanvasRevision }
  | { kind: 'conflict' }
  | { kind: 'not_found' };

export interface AdvancedCanvasProjectRepository {
  appendAudit(event: AdvancedCanvasAuditEvent): Promise<void>;
  createCheckpoint(input: {
    expectedDraftVersion: number;
    revision: Omit<AdvancedCanvasRevision, 'draftVersion' | 'graph'>;
  }): Promise<RevisionWriteResult>;
  getProject(
    workspaceId: string,
    projectId: string
  ): Promise<AdvancedCanvasProject | null>;
  getRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string
  ): Promise<AdvancedCanvasRevision | null>;
  insertProject(project: AdvancedCanvasProject): Promise<void>;
  listProjects(workspaceId: string): Promise<AdvancedCanvasProject[]>;
  listRevisions(
    workspaceId: string,
    projectId: string
  ): Promise<AdvancedCanvasRevision[]>;
  renameProject(input: {
    name: string;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }): Promise<AdvancedCanvasProject | null>;
  saveDraft(input: {
    expectedDraftVersion: number;
    graph: CanvasGraph;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }): Promise<DraftWriteResult>;
  softDeleteProject(input: {
    deletedAt: string;
    projectId: string;
    workspaceId: string;
  }): Promise<boolean>;
  /**
   * Hard-delete soft-deleted projects whose deletedAt is older than the cutoff.
   * Returns the purged project ids.
   */
  purgeExpiredDeletedProjects(input: {
    cutoffIso: string;
    workspaceId?: string;
  }): Promise<string[]>;
}

export type AdvancedCanvasProjectErrorCode =
  | 'DRAFT_VERSION_CONFLICT'
  | 'INVALID_INPUT'
  | 'NOT_FOUND';

export class AdvancedCanvasProjectError extends Error {
  constructor(
    readonly code: AdvancedCanvasProjectErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdvancedCanvasProjectError';
  }
}

/** Soft-deleted projects remain recoverable until this retention window elapses. */
export const DEFAULT_ADVANCED_CANVAS_SOFT_DELETE_RETENTION_DAYS = 30;

interface AdvancedCanvasProjectServiceOptions {
  clock?: () => Date;
  nextId?: (kind: 'project' | 'revision') => string;
  repository: AdvancedCanvasProjectRepository;
  /** Soft-delete retention window in days. Defaults to 30. */
  softDeleteRetentionDays?: number;
}

export class AdvancedCanvasProjectService {
  private readonly clock: () => Date;
  private readonly nextId: (kind: 'project' | 'revision') => string;
  private readonly softDeleteRetentionDays: number;

  constructor(private readonly options: AdvancedCanvasProjectServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.nextId =
      options.nextId ?? ((kind) => `${kind}-${crypto.randomUUID()}`);
    this.softDeleteRetentionDays =
      options.softDeleteRetentionDays ??
      DEFAULT_ADVANCED_CANVAS_SOFT_DELETE_RETENTION_DAYS;
  }

  async listProjects(context: AdvancedCanvasContext) {
    requireContext(context);
    return this.options.repository.listProjects(context.workspaceId);
  }

  async createProject(
    context: AdvancedCanvasContext,
    input: { graph?: CanvasGraph; name: string }
  ) {
    requireContext(context);
    const name = validateName(input.name);
    const graph = validateGraph(input.graph ?? emptyGraph());
    const timestamp = this.clock().toISOString();
    const project: AdvancedCanvasProject = {
      createdAt: timestamp,
      createdBy: context.userId,
      draftVersion: 1,
      graph: clone(graph),
      id: this.nextId('project'),
      name,
      updatedAt: timestamp,
      workspaceId: context.workspaceId,
    };
    await this.options.repository.insertProject(project);
    return clone(project);
  }

  async loadProject(context: AdvancedCanvasContext, projectId: string) {
    requireContext(context);
    requireId(projectId, 'projectId');
    const project = await this.options.repository.getProject(
      context.workspaceId,
      projectId
    );
    if (!project) return this.notFound(context, projectId);
    return project;
  }

  async renameProject(
    context: AdvancedCanvasContext,
    input: { name: string; projectId: string }
  ) {
    requireContext(context);
    requireId(input.projectId, 'projectId');
    const project = await this.options.repository.renameProject({
      name: validateName(input.name),
      projectId: input.projectId,
      updatedAt: this.clock().toISOString(),
      workspaceId: context.workspaceId,
    });
    if (!project) return this.notFound(context, input.projectId);
    return project;
  }

  async duplicateProject(
    context: AdvancedCanvasContext,
    input: { name?: string; projectId: string }
  ) {
    const source = await this.loadProject(context, input.projectId);
    return this.createProject(context, {
      graph: source.graph,
      name: input.name ?? `${source.name} copy`,
    });
  }

  async deleteProject(context: AdvancedCanvasContext, projectId: string) {
    requireContext(context);
    requireId(projectId, 'projectId');
    const deleted = await this.options.repository.softDeleteProject({
      deletedAt: this.clock().toISOString(),
      projectId,
      workspaceId: context.workspaceId,
    });
    if (!deleted) return this.notFound(context, projectId);
    return {
      projectId,
      retentionDays: this.softDeleteRetentionDays,
    };
  }

  /**
   * Purge soft-deleted projects past the retention window.
   * Callable by janitor / ops; scoped to workspace when context is provided.
   */
  async purgeExpiredDeletedProjects(context?: AdvancedCanvasContext) {
    if (context) requireContext(context);
    const cutoff = new Date(this.clock());
    cutoff.setUTCDate(cutoff.getUTCDate() - this.softDeleteRetentionDays);
    return this.options.repository.purgeExpiredDeletedProjects({
      cutoffIso: cutoff.toISOString(),
      ...(context ? { workspaceId: context.workspaceId } : {}),
    });
  }

  async saveProjectDraft(
    context: AdvancedCanvasContext,
    input: {
      expectedDraftVersion: number;
      graph: CanvasGraph;
      projectId: string;
    }
  ) {
    requireContext(context);
    requireId(input.projectId, 'projectId');
    requireVersion(input.expectedDraftVersion);
    const result = await this.options.repository.saveDraft({
      expectedDraftVersion: input.expectedDraftVersion,
      graph: validateGraph(input.graph),
      projectId: input.projectId,
      updatedAt: this.clock().toISOString(),
      workspaceId: context.workspaceId,
    });
    if (result.kind === 'not_found') {
      return this.notFound(context, input.projectId);
    }
    if (result.kind === 'conflict') {
      throw new AdvancedCanvasProjectError(
        'DRAFT_VERSION_CONFLICT',
        'Canvas draft changed since it was loaded.'
      );
    }
    return result.project;
  }

  async createCheckpoint(
    context: AdvancedCanvasContext,
    input: {
      expectedDraftVersion: number;
      label?: string;
      projectId: string;
    }
  ) {
    requireContext(context);
    requireId(input.projectId, 'projectId');
    requireVersion(input.expectedDraftVersion);
    const result = await this.options.repository.createCheckpoint({
      expectedDraftVersion: input.expectedDraftVersion,
      revision: {
        createdAt: this.clock().toISOString(),
        createdBy: context.userId,
        id: this.nextId('revision'),
        ...(input.label?.trim() ? { label: input.label.trim() } : {}),
        projectId: input.projectId,
        reason: 'checkpoint',
        workspaceId: context.workspaceId,
      },
    });
    if (result.kind === 'not_found') {
      return this.notFound(context, input.projectId);
    }
    if (result.kind === 'conflict') {
      throw new AdvancedCanvasProjectError(
        'DRAFT_VERSION_CONFLICT',
        'Canvas draft changed before the checkpoint was created.'
      );
    }
    return result.revision;
  }

  async listRevisions(context: AdvancedCanvasContext, projectId: string) {
    await this.loadProject(context, projectId);
    return this.options.repository.listRevisions(
      context.workspaceId,
      projectId
    );
  }

  async getRevision(
    context: AdvancedCanvasContext,
    projectId: string,
    revisionId: string
  ) {
    requireContext(context);
    requireId(projectId, 'projectId');
    requireId(revisionId, 'revisionId');
    const revision = await this.options.repository.getRevision(
      context.workspaceId,
      projectId,
      revisionId
    );
    if (!revision) return this.notFound(context, projectId);
    return revision;
  }

  async restoreRevision(
    context: AdvancedCanvasContext,
    input: {
      expectedDraftVersion: number;
      projectId: string;
      revisionId: string;
    }
  ) {
    const revision = await this.getRevision(
      context,
      input.projectId,
      input.revisionId
    );
    return this.saveProjectDraft(context, {
      expectedDraftVersion: input.expectedDraftVersion,
      graph: revision.graph,
      projectId: input.projectId,
    });
  }

  private async notFound(
    context: AdvancedCanvasContext,
    projectId: string
  ): Promise<never> {
    await this.options.repository.appendAudit({
      action: 'project_access_denied',
      actorId: context.userId,
      createdAt: this.clock().toISOString(),
      projectId,
      workspaceId: context.workspaceId,
    });
    throw new AdvancedCanvasProjectError(
      'NOT_FOUND',
      'Canvas project was not found.'
    );
  }
}

export class MemoryAdvancedCanvasProjectRepository
  implements AdvancedCanvasProjectRepository
{
  private readonly audits: AdvancedCanvasAuditEvent[] = [];
  private readonly projects = new Map<string, AdvancedCanvasProject>();
  private readonly revisions = new Map<string, AdvancedCanvasRevision>();

  private key(workspaceId: string, id: string) {
    return `${workspaceId}\0${id}`;
  }

  async appendAudit(event: AdvancedCanvasAuditEvent) {
    this.audits.push(clone(event));
  }

  async insertProject(project: AdvancedCanvasProject) {
    this.projects.set(
      this.key(project.workspaceId, project.id),
      clone(project)
    );
  }

  async listProjects(workspaceId: string) {
    return clone(
      [...this.projects.values()]
        .filter(
          (project) => project.workspaceId === workspaceId && !project.deletedAt
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    );
  }

  async getProject(workspaceId: string, projectId: string) {
    const project = this.projects.get(this.key(workspaceId, projectId));
    return project && !project.deletedAt ? clone(project) : null;
  }

  async renameProject(input: {
    name: string;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }) {
    const key = this.key(input.workspaceId, input.projectId);
    const project = this.projects.get(key);
    if (!project || project.deletedAt) return null;
    project.name = input.name;
    project.updatedAt = input.updatedAt;
    return clone(project);
  }

  async softDeleteProject(input: {
    deletedAt: string;
    projectId: string;
    workspaceId: string;
  }) {
    const project = this.projects.get(
      this.key(input.workspaceId, input.projectId)
    );
    if (!project || project.deletedAt) return false;
    project.deletedAt = input.deletedAt;
    project.updatedAt = input.deletedAt;
    return true;
  }

  async purgeExpiredDeletedProjects(input: {
    cutoffIso: string;
    workspaceId?: string;
  }) {
    const purged: string[] = [];
    for (const [key, project] of [...this.projects.entries()]) {
      if (input.workspaceId && project.workspaceId !== input.workspaceId) {
        continue;
      }
      if (!project.deletedAt) continue;
      if (project.deletedAt >= input.cutoffIso) continue;
      this.projects.delete(key);
      for (const [revisionKey, revision] of [...this.revisions.entries()]) {
        if (
          revision.workspaceId === project.workspaceId &&
          revision.projectId === project.id
        ) {
          this.revisions.delete(revisionKey);
        }
      }
      purged.push(project.id);
    }
    return purged;
  }

  async saveDraft(input: {
    expectedDraftVersion: number;
    graph: CanvasGraph;
    projectId: string;
    updatedAt: string;
    workspaceId: string;
  }): Promise<DraftWriteResult> {
    const project = this.projects.get(
      this.key(input.workspaceId, input.projectId)
    );
    if (!project || project.deletedAt) return { kind: 'not_found' };
    if (project.draftVersion !== input.expectedDraftVersion) {
      return { kind: 'conflict' };
    }
    project.draftVersion += 1;
    project.graph = clone(input.graph);
    project.updatedAt = input.updatedAt;
    return { kind: 'saved', project: clone(project) };
  }

  async createCheckpoint(input: {
    expectedDraftVersion: number;
    revision: Omit<AdvancedCanvasRevision, 'draftVersion' | 'graph'>;
  }): Promise<RevisionWriteResult> {
    const project = this.projects.get(
      this.key(input.revision.workspaceId, input.revision.projectId)
    );
    if (!project || project.deletedAt) return { kind: 'not_found' };
    if (project.draftVersion !== input.expectedDraftVersion) {
      return { kind: 'conflict' };
    }
    const revision: AdvancedCanvasRevision = {
      ...clone(input.revision),
      draftVersion: project.draftVersion,
      graph: clone(project.graph),
    };
    this.revisions.set(this.key(revision.workspaceId, revision.id), revision);
    return { kind: 'created', revision: clone(revision) };
  }

  async listRevisions(workspaceId: string, projectId: string) {
    return clone(
      [...this.revisions.values()]
        .filter(
          (revision) =>
            revision.workspaceId === workspaceId &&
            revision.projectId === projectId
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    );
  }

  async getRevision(
    workspaceId: string,
    projectId: string,
    revisionId: string
  ) {
    const revision = this.revisions.get(this.key(workspaceId, revisionId));
    return revision?.projectId === projectId ? clone(revision) : null;
  }

  inspectProjects() {
    return clone([...this.projects.values()]);
  }

  inspectAudit() {
    return clone(this.audits);
  }
}

function emptyGraph(): CanvasGraph {
  return { edges: [], nodes: [], schemaVersion: 1 };
}

function validateGraph(graph: CanvasGraph) {
  if (
    graph.schemaVersion !== 1 ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    throw new AdvancedCanvasProjectError(
      'INVALID_INPUT',
      'Canvas graph schema is invalid.'
    );
  }
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      !node.id.trim() ||
      typeof node.type !== 'string' ||
      !node.type.trim() ||
      !node.data ||
      typeof node.data !== 'object' ||
      Array.isArray(node.data)
    ) {
      throw new AdvancedCanvasProjectError(
        'INVALID_INPUT',
        'Canvas graph contains an invalid node.'
      );
    }
    if (nodeIds.has(node.id)) {
      throw new AdvancedCanvasProjectError(
        'INVALID_INPUT',
        'Canvas node IDs must be unique.'
      );
    }
    nodeIds.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new AdvancedCanvasProjectError(
        'INVALID_INPUT',
        'Canvas edges must reference existing nodes.'
      );
    }
  }
  return clone(graph);
}

function validateName(name: string) {
  const value = name.trim();
  if (!value || value.length > 120) {
    throw new AdvancedCanvasProjectError(
      'INVALID_INPUT',
      'Project name must be between 1 and 120 characters.'
    );
  }
  return value;
}

function requireContext(context: AdvancedCanvasContext) {
  requireId(context.userId, 'userId');
  requireId(context.workspaceId, 'workspaceId');
}

function requireId(value: string, field: string) {
  if (!value.trim()) {
    throw new AdvancedCanvasProjectError(
      'INVALID_INPUT',
      `${field} is required.`
    );
  }
}

function requireVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new AdvancedCanvasProjectError(
      'INVALID_INPUT',
      'expectedDraftVersion must be a positive integer.'
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
