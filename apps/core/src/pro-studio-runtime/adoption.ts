import { createHash } from 'node:crypto';

export interface AdvancedCanvasAdoptionContext {
  userId: string;
  workspaceId: string;
  correlationId: string;
}

export type AdvancedCanvasRevisionNode =
  | { id: string; kind: 'text'; text: string }
  | {
      id: string;
      kind: 'image' | 'video' | 'audio';
      assetId: string;
      jobId: string;
      sourceAssetIds: string[];
      custody: 'owned' | 'external';
      deliveryStatus: 'completed' | 'accepted' | 'failed';
    };

export interface AdvancedCanvasRevision {
  id: string;
  createdAt: string;
  nodes: AdvancedCanvasRevisionNode[];
}

export interface AdvancedCanvasAdoptionProject {
  id: string;
  workspaceId: string;
  draftVersion: number;
  draftNodes: AdvancedCanvasRevisionNode[];
  revisions: AdvancedCanvasRevision[];
}

export interface AdvancedCanvasContentPackageVersion {
  id: string;
  body?: string;
  orderedAssetIds: string[];
  childJobIds: string[];
  sourceAssetIds: string[];
  sourceRef: {
    advancedCanvas?: {
      projectId: string;
      revisionId: string;
      selectedNodeIds: string[];
      orderedMediaNodeIds: string[];
      schemaVersion: 1;
    };
  };
  createdAt: string;
}

export interface AdvancedCanvasContentPackage {
  id: string;
  workspaceId: string;
  kind: 'image_text' | 'video';
  source: { assetIds: string[] };
  versions: AdvancedCanvasContentPackageVersion[];
}

interface AdvancedCanvasAdoptionRelation {
  id: string;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  businessKey: string;
  selectedNodeIds: string[];
  orderedMediaNodeIds: string[];
  packageId: string;
  versionId: string;
  createdAt: string;
}

interface AdvancedCanvasAdoptionReceipt {
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  result: AdvancedCanvasAdoptionResult;
}

interface AdvancedCanvasAdoptionAuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  correlationId: string;
  projectId: string;
  revisionId: string;
  packageId: string;
  versionId: string;
  createdAt: string;
}

export interface AdvancedCanvasAdoptionWorkspaceState {
  projects: AdvancedCanvasAdoptionProject[];
  packages: AdvancedCanvasContentPackage[];
  adoptions: AdvancedCanvasAdoptionRelation[];
  receipts: AdvancedCanvasAdoptionReceipt[];
  auditEvents: AdvancedCanvasAdoptionAuditEvent[];
}

export function createEmptyAdvancedCanvasAdoptionState(): AdvancedCanvasAdoptionWorkspaceState {
  return {
    projects: [],
    packages: [],
    adoptions: [],
    receipts: [],
    auditEvents: [],
  };
}

export interface AdvancedCanvasAdoptionSeed {
  projects: AdvancedCanvasAdoptionProject[];
  packages: AdvancedCanvasContentPackage[];
}

export interface AdvancedCanvasAdoptionCommand {
  projectId: string;
  revisionRef:
    | { kind: 'frozen'; revisionId: string }
    | { kind: 'freeze_current_draft'; expectedDraftVersion: number };
  selection: {
    textNodeId?: string;
    orderedMediaNodeIds: string[];
  };
  target:
    | { kind: 'new_package' }
    | {
        kind: 'existing_package';
        packageId: string;
        baseVersionId: string;
      };
  idempotencyKey: string;
}

export interface AdvancedCanvasAdoptionResult {
  packageId: string;
  versionId: string;
  projectId: string;
  revisionId: string;
  selectedNodeIds: string[];
  orderedMediaNodeIds: string[];
}

export interface AdvancedCanvasAdoptionPort {
  adopt(
    context: AdvancedCanvasAdoptionContext,
    command: AdvancedCanvasAdoptionCommand,
  ): Promise<AdvancedCanvasAdoptionResult>;
  listAdoptions(
    context: AdvancedCanvasAdoptionContext,
    projectId: string,
  ): Promise<AdvancedCanvasAdoptionResult[]>;
}

export class AdvancedCanvasAdoptionError extends Error {
  readonly status: number;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdvancedCanvasAdoptionError';
    this.status = adoptionErrorStatus(code);
  }
}

function adoptionErrorStatus(code: string) {
  if (code === 'WORKSPACE_FORBIDDEN') return 403;
  if (code.includes('NOT_FOUND')) return 404;
  if (code.includes('CONFLICT')) return 409;
  return 400;
}

export interface AdvancedCanvasAdoptionRepository {
  read(workspaceId: string): Promise<AdvancedCanvasAdoptionWorkspaceState>;
  transact<T>(
    workspaceId: string,
    action: (state: AdvancedCanvasAdoptionWorkspaceState) => T,
  ): Promise<T>;
}

export class MemoryAdvancedCanvasAdoptionRepository
  implements AdvancedCanvasAdoptionRepository
{
  private readonly states = new Map<string, AdvancedCanvasAdoptionWorkspaceState>();

  constructor(seed: AdvancedCanvasAdoptionSeed = { projects: [], packages: [] }) {
    const workspaceIds = new Set([
      ...seed.projects.map((project) => project.workspaceId),
      ...seed.packages.map((contentPackage) => contentPackage.workspaceId),
    ]);
    for (const workspaceId of workspaceIds) {
      this.states.set(workspaceId, {
        projects: structuredClone(
          seed.projects.filter((project) => project.workspaceId === workspaceId),
        ),
        packages: structuredClone(
          seed.packages.filter(
            (contentPackage) => contentPackage.workspaceId === workspaceId,
          ),
        ),
        adoptions: [],
        receipts: [],
        auditEvents: [],
      });
    }
  }

  async read(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  async transact<T>(
    workspaceId: string,
    action: (state: AdvancedCanvasAdoptionWorkspaceState) => T,
  ) {
    const draft = structuredClone(this.state(workspaceId));
    const result = action(draft);
    this.states.set(workspaceId, draft);
    return structuredClone(result);
  }

  snapshot(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  private state(workspaceId: string) {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = createEmptyAdvancedCanvasAdoptionState();
      this.states.set(workspaceId, state);
    }
    return state;
  }
}

export class AdvancedCanvasAdoptionApplicationService {
  constructor(
    private readonly repository: AdvancedCanvasAdoptionRepository,
    private readonly options: { clock?: () => Date } = {},
  ) {}

  async adopt(
    context: AdvancedCanvasAdoptionContext,
    command: AdvancedCanvasAdoptionCommand,
  ) {
    validateCommand(command);
    const payloadHash = digest(canonical(command));
    return this.repository.transact(context.workspaceId, (state) => {
      const project = state.projects.find(
        (candidate) => candidate.id === command.projectId,
      );
      if (!project) {
        throw new AdvancedCanvasAdoptionError(
          'PROJECT_NOT_FOUND',
          'Advanced canvas project was not found.',
        );
      }
      const revision = resolveRevision(project, command.revisionRef, this.now());
      const selectedNodeIds = [
        ...(command.selection.textNodeId ? [command.selection.textNodeId] : []),
        ...command.selection.orderedMediaNodeIds,
      ];
      const businessKey = digest(
        canonical({
          projectId: project.id,
          revisionId: revision.id,
          textNodeId: command.selection.textNodeId,
          orderedMediaNodeIds: command.selection.orderedMediaNodeIds,
        }),
      );
      const existingAdoption = state.adoptions.find(
        (candidate) => candidate.businessKey === businessKey,
      );
      if (existingAdoption) return relationResult(existingAdoption);
      const receipt = state.receipts.find(
        (candidate) => candidate.idempotencyKey === command.idempotencyKey,
      );
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) {
          throw new AdvancedCanvasAdoptionError(
            'IDEMPOTENCY_CONFLICT',
            'Adoption key was reused with another payload.',
          );
        }
        return receipt.result;
      }

      const selection = resolveSelection(revision, command.selection);
      const createdAt = this.now().toISOString();
      const packageId =
        command.target.kind === 'new_package'
          ? `content-package-${businessKey.slice(0, 24)}`
          : command.target.packageId;
      let contentPackage = state.packages.find(
        (candidate) => candidate.id === packageId,
      );
      if (command.target.kind === 'existing_package') {
        if (!contentPackage) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_PACKAGE_NOT_FOUND',
            'Target content package was not found.',
          );
        }
        if (contentPackage.versions.at(-1)?.id !== command.target.baseVersionId) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_VERSION_CONFLICT',
            'Target content package version is stale.',
          );
        }
        if (contentPackage.kind !== selection.kind) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_KIND_CONFLICT',
            'Canvas selection does not match the target content kind.',
          );
        }
      } else {
        contentPackage = {
          id: packageId,
          workspaceId: context.workspaceId,
          kind: selection.kind,
          source: { assetIds: [] },
          versions: [],
        };
        state.packages.push(contentPackage);
      }
      const versionId = `content-version-${businessKey.slice(0, 24)}`;
      const version: AdvancedCanvasContentPackageVersion = {
        id: versionId,
        ...(selection.body ? { body: selection.body } : {}),
        orderedAssetIds: [...selection.orderedAssetIds],
        childJobIds: [...selection.childJobIds],
        sourceAssetIds: [...selection.sourceAssetIds],
        sourceRef: {
          advancedCanvas: {
            projectId: project.id,
            revisionId: revision.id,
            selectedNodeIds: [...selectedNodeIds],
            orderedMediaNodeIds: [
              ...command.selection.orderedMediaNodeIds,
            ],
            schemaVersion: 1,
          },
        },
        createdAt,
      };
      contentPackage.source.assetIds = [...selection.orderedAssetIds];
      contentPackage.versions.push(version);
      const relation: AdvancedCanvasAdoptionRelation = {
        id: `advanced-canvas-adoption-${businessKey.slice(0, 24)}`,
        workspaceId: context.workspaceId,
        projectId: project.id,
        revisionId: revision.id,
        businessKey,
        selectedNodeIds: [...selectedNodeIds],
        orderedMediaNodeIds: [...command.selection.orderedMediaNodeIds],
        packageId,
        versionId,
        createdAt,
      };
      state.adoptions.push(relation);
      const result = relationResult(relation);
      state.receipts.push({
        workspaceId: context.workspaceId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        result,
      });
      state.auditEvents.push({
        id: `advanced-canvas-adoption-audit-${businessKey.slice(0, 24)}`,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        correlationId: context.correlationId,
        projectId: project.id,
        revisionId: revision.id,
        packageId,
        versionId,
        createdAt,
      });
      return result;
    });
  }

  async listAdoptions(
    context: AdvancedCanvasAdoptionContext,
    projectId: string,
  ) {
    const state = await this.repository.read(context.workspaceId);
    return structuredClone(
      state.adoptions
        .filter((relation) => relation.projectId === projectId)
        .map(relationResult),
    );
  }

  private now() {
    return this.options.clock?.() ?? new Date();
  }
}

function resolveRevision(
  project: AdvancedCanvasAdoptionProject,
  reference: AdvancedCanvasAdoptionCommand['revisionRef'],
  now: Date,
) {
  if (reference.kind === 'frozen') {
    const revision = project.revisions.find(
      (candidate) => candidate.id === reference.revisionId,
    );
    if (!revision) {
      throw new AdvancedCanvasAdoptionError(
        'REVISION_NOT_FOUND',
        'Advanced canvas revision was not found.',
      );
    }
    return revision;
  }
  if (project.draftVersion !== reference.expectedDraftVersion) {
    throw new AdvancedCanvasAdoptionError(
      'DRAFT_VERSION_CONFLICT',
      'Advanced canvas draft changed before adoption.',
    );
  }
  const revisionId = `advanced-canvas-revision-${digest(
    canonical({ projectId: project.id, draftVersion: project.draftVersion }),
  ).slice(0, 24)}`;
  const existing = project.revisions.find(
    (candidate) => candidate.id === revisionId,
  );
  if (existing) return existing;
  const revision: AdvancedCanvasRevision = {
    id: revisionId,
    createdAt: now.toISOString(),
    nodes: structuredClone(project.draftNodes),
  };
  project.revisions.push(revision);
  return revision;
}

function resolveSelection(
  revision: AdvancedCanvasRevision,
  selection: AdvancedCanvasAdoptionCommand['selection'],
) {
  const mediaNodes = selection.orderedMediaNodeIds.map((nodeId) => {
    const node = revision.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.kind === 'text') {
      throw new AdvancedCanvasAdoptionError(
        'MEDIA_NODE_NOT_FOUND',
        'Selected media node was not found in the revision.',
      );
    }
    if (node.custody !== 'owned' || node.deliveryStatus !== 'completed') {
      throw new AdvancedCanvasAdoptionError(
        'MEDIA_NOT_DELIVERABLE',
        'Selected media is not an owned deliverable.',
      );
    }
    if (node.kind === 'audio') {
      throw new AdvancedCanvasAdoptionError(
        'AUDIO_PACKAGE_NOT_SUPPORTED',
        'Standalone audio content packages are out of scope.',
      );
    }
    return node;
  });
  const textNode = selection.textNodeId
    ? revision.nodes.find(
        (candidate) =>
          candidate.id === selection.textNodeId && candidate.kind === 'text',
      )
    : undefined;
  const kind = mediaNodes.every((node) => node.kind === 'video') && !textNode
    ? ('video' as const)
    : ('image_text' as const);
  if (kind === 'image_text' && (!textNode || textNode.kind !== 'text')) {
    throw new AdvancedCanvasAdoptionError(
      'TEXT_NODE_REQUIRED',
      'Image-text adoption requires a text node.',
    );
  }
  return {
    kind,
    ...(textNode?.kind === 'text' ? { body: textNode.text } : {}),
    orderedAssetIds: mediaNodes.map((node) => node.assetId),
    childJobIds: stableUnique(mediaNodes.map((node) => node.jobId)),
    sourceAssetIds: stableUnique(
      mediaNodes.flatMap((node) => node.sourceAssetIds),
    ),
  };
}

function validateCommand(command: AdvancedCanvasAdoptionCommand) {
  requireText(command.projectId, 'projectId');
  requireText(command.idempotencyKey, 'idempotencyKey');
  if (
    !Array.isArray(command.selection.orderedMediaNodeIds) ||
    command.selection.orderedMediaNodeIds.length === 0
  ) {
    throw new AdvancedCanvasAdoptionError(
      'MEDIA_SELECTION_REQUIRED',
      'At least one media node must be selected.',
    );
  }
  for (const nodeId of command.selection.orderedMediaNodeIds) {
    requireText(nodeId, 'orderedMediaNodeId');
  }
  if (command.selection.textNodeId) {
    requireText(command.selection.textNodeId, 'textNodeId');
  }
}

function relationResult(
  relation: AdvancedCanvasAdoptionRelation,
): AdvancedCanvasAdoptionResult {
  return {
    packageId: relation.packageId,
    versionId: relation.versionId,
    projectId: relation.projectId,
    revisionId: relation.revisionId,
    selectedNodeIds: [...relation.selectedNodeIds],
    orderedMediaNodeIds: [...relation.orderedMediaNodeIds],
  };
}

function stableUnique(values: string[]) {
  return [...new Set(values)];
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AdvancedCanvasAdoptionError(
      'INPUT_INVALID',
      `${field} is required.`,
    );
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
