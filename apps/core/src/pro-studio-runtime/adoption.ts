import {
  AdvancedCanvasAdoptionError,
  adoptionPayloadHash,
  assertAdoptionTarget,
  assertDraftVersion,
  createAdoptionAuditDetails,
  createAdoptionIdentity,
  createAdoptionResult,
  createAdoptionRevisionId,
  memoryAdoptionRuleProfile,
  resolveAdoptionSelection,
  resolveIdempotencyReplay,
  validateAdoptionCommand,
} from './adoption-rules.js';

export { AdvancedCanvasAdoptionError } from './adoption-rules.js';

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
  revision: number;
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
      expectedRevision: number;
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
    private readonly options: {
      accessAudit?: {
        recordAccessDenied(event: {
          actorId: string;
          createdAt?: string;
          objectId: string;
          objectKind: 'package' | 'project';
          projectId?: string;
          workspaceId: string;
        }): Promise<void>;
      };
      clock?: () => Date;
    } = {},
  ) {}

  async adopt(
    context: AdvancedCanvasAdoptionContext,
    command: AdvancedCanvasAdoptionCommand,
  ) {
    validateAdoptionCommand(command, memoryAdoptionRuleProfile);
    const payloadHash = adoptionPayloadHash(command, memoryAdoptionRuleProfile);
    try {
      return await this.repository.transact(context.workspaceId, (state) => {
        const replay = resolveIdempotencyReplay(
          state.receipts,
          command.idempotencyKey,
          payloadHash,
        );
        if (replay) return replay;

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
        const selection = resolveAdoptionSelection(
          revision.nodes.map((node) =>
            node.kind === 'text'
              ? { ...node }
              : {
                  ...node,
                  deliverable:
                    node.custody === 'owned' &&
                    node.deliveryStatus === 'completed',
                },
          ),
          command.selection,
          memoryAdoptionRuleProfile,
        );
        const identity = createAdoptionIdentity(
          command,
          revision.id,
          memoryAdoptionRuleProfile,
        );
        const existingAdoption = state.adoptions.find(
          (candidate) => candidate.businessKey === identity.businessKey,
        );
        if (existingAdoption) {
          const result = relationResult(existingAdoption);
          state.receipts.push({
            workspaceId: context.workspaceId,
            idempotencyKey: command.idempotencyKey,
            payloadHash,
            result,
          });
          return result;
        }

        let contentPackage = state.packages.find(
          (candidate) => candidate.id === identity.packageId,
        );
        assertAdoptionTarget(
          contentPackage
            ? {
                kind: contentPackage.kind,
                currentVersionId: contentPackage.versions.at(-1)?.id ?? '',
              }
            : null,
          command,
          selection.kind,
        );
        if (
          contentPackage &&
          command.target.kind === 'existing_package' &&
          contentPackage.revision !== command.target.expectedRevision
        ) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_PACKAGE_REVISION_CONFLICT',
            `ContentPackage revision changed from ${command.target.expectedRevision} to ${contentPackage.revision}. Refresh and retry.`,
            {
              currentRevision: contentPackage.revision,
              expectedRevision: command.target.expectedRevision,
              packageId: contentPackage.id,
            },
          );
        }
        if (!contentPackage) {
          contentPackage = {
            id: identity.packageId,
            workspaceId: context.workspaceId,
            kind: selection.kind,
            revision: 0,
            source: { assetIds: [] },
            versions: [],
          };
          state.packages.push(contentPackage);
        }
        const version: AdvancedCanvasContentPackageVersion = {
          id: identity.versionId,
          ...(selection.body ? { body: selection.body } : {}),
          orderedAssetIds: [...selection.orderedAssetIds],
          childJobIds: [...selection.childJobIds],
          sourceAssetIds: [...selection.sourceAssetIds],
          sourceRef: {
            advancedCanvas: {
              projectId: project.id,
              revisionId: revision.id,
              selectedNodeIds: [...selection.selectedNodeIds],
              orderedMediaNodeIds: [
                ...command.selection.orderedMediaNodeIds,
              ],
              schemaVersion: 1,
            },
          },
          createdAt: this.now().toISOString(),
        };
        contentPackage.source.assetIds = [...selection.orderedAssetIds];
        contentPackage.versions.push(version);
        if (command.target.kind === 'existing_package') {
          contentPackage.revision += 1;
        }
        const result = createAdoptionResult(
          command,
          revision.id,
          identity,
          selection.selectedNodeIds,
        );
        const createdAt = version.createdAt;
        const relation: AdvancedCanvasAdoptionRelation = {
          id: `advanced-canvas-adoption-${identity.businessKey.slice(0, 24)}`,
          workspaceId: context.workspaceId,
          projectId: result.projectId,
          revisionId: result.revisionId,
          businessKey: identity.businessKey,
          selectedNodeIds: [...result.selectedNodeIds],
          orderedMediaNodeIds: [...result.orderedMediaNodeIds],
          packageId: result.packageId,
          versionId: result.versionId,
          createdAt,
        };
        state.adoptions.push(relation);
        state.receipts.push({
          workspaceId: context.workspaceId,
          idempotencyKey: command.idempotencyKey,
          payloadHash,
          result,
        });
        const audit = createAdoptionAuditDetails(context, result);
        state.auditEvents.push({
          id: `advanced-canvas-adoption-audit-${identity.businessKey.slice(0, 24)}`,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: audit.correlationId,
          projectId: result.projectId,
          revisionId: audit.revisionId,
          packageId: audit.packageId,
          versionId: audit.versionId,
          createdAt,
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof AdvancedCanvasAdoptionError &&
        error.code === 'CONTENT_PACKAGE_NOT_FOUND' &&
        command.target.kind === 'existing_package'
      ) {
        await this.options.accessAudit?.recordAccessDenied({
          actorId: context.userId,
          objectId: command.target.packageId,
          objectKind: 'package',
          projectId: command.projectId,
          workspaceId: context.workspaceId,
        });
      }
      if (
        error instanceof AdvancedCanvasAdoptionError &&
        error.code === 'PROJECT_NOT_FOUND'
      ) {
        await this.options.accessAudit?.recordAccessDenied({
          actorId: context.userId,
          objectId: command.projectId,
          objectKind: 'project',
          projectId: command.projectId,
          workspaceId: context.workspaceId,
        });
      }
      throw error;
    }
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
  assertDraftVersion(project.draftVersion, reference.expectedDraftVersion);
  const revisionId = createAdoptionRevisionId(
    { projectId: project.id, draftVersion: project.draftVersion },
    memoryAdoptionRuleProfile,
  );
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
