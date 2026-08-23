import type { ContentPackage } from '@meiye/contracts';

import type {
  CanvasWork,
  ContentTask,
  CreativeAssetProjection,
  CreativeJob,
  CreativeWork,
  OperationsAuditEvent,
  SearchDocument,
  SearchQuery,
  SearchResult,
  TaskEvent,
} from './types.js';

/**
 * ARCH-03 / R-P1-15 — Operations hot-path repositories.
 *
 * Cross-collection atomic invariants and the canonical transaction owner
 * for each group. Delivery / pending / result callers depend on these
 * owners instead of loadWorkspace / saveWorkspace.
 *
 * 1. ContentPackage aggregate OCC
 *    Collections: p1_content_packages payload (versions, deliveryEvents,
 *    approvalReceipts / requests, resultSignals, nested exportReceipts)
 *    plus the matching append-only p1_operations_audit_events row.
 *    Owner: ContentPackageRevisionWritePort (generation write) and
 *    OperationsHotPathRepository.saveContentPackageRevision (delivery
 *    mutations). Both take the package advisory lock
 *    hashtext(`${workspaceId}:${packageId}`) and write through
 *    updateContentPackageRow. They do not take the workspace lock and
 *    do not rewrite sibling collections.
 *
 * 2. ApprovalReceipt idempotencyKey uniqueness (workspace-scoped)
 *    Owner: the same ContentPackage OCC transaction. Lookup scans only
 *    p1_content_packages; it never materializes tasks, works, or search.
 *
 * 3. Live asset rights
 *    Owner: ContentPackageRightsResolverPort, acquired inside
 *    ContentPackageRevisionWritePort when present (workspace lock +
 *    package lock). Delivery hot path mutates an already-accepted
 *    package and does not re-resolve rights.
 *
 * 4. Usage / billing
 *    Owner: P1 GrantLot + ProductUsageLedger (D-172). Not written here.
 *    Dual-truth red line (D-061) still applies.
 *
 * 5. Search projection (rebuildable)
 *    Owner: SearchProjectionWriter — p1_search_documents +
 *    p1_search_projection_heads. Snapshot OCC is the projection head,
 *    not the workspace lock.
 *
 * 6. Task inbox
 *    Owner: TaskInboxReader — p1_content_tasks + p1_task_events.
 *
 * 7. CreativeWork slice
 *    Owner: CreativeWorkReader — p1_creative_works + p1_creative_jobs +
 *    p1_creative_assets.
 *
 * 8. Legacy canvas archive
 *    Owner: LegacyCanvasArchiveReader — p1_canvas_works only.
 *    Historical rows stay readable; this path never DROPs or rewrites
 *    applied migrations.
 */
export type ContentPackageRevisionSave = {
  auditEvents?: OperationsAuditEvent[];
  contentPackage: ContentPackage;
  expectedRevision: number;
};

/**
 * A record the system kept on the merchant's behalf, written into the package
 * row without moving the revision their own writes compare against (V31-106).
 * `contentPackage` carries the whole aggregate as it should now read; what a
 * caller may actually change is enforced by
 * `validateContentPackageAuxiliaryWrite`, not by this type.
 */
export type ContentPackageAuxiliarySave = {
  auditEvents?: OperationsAuditEvent[];
  contentPackage: ContentPackage;
};

export interface ContentPackageReader {
  getContentPackage(
    workspaceId: string,
    packageId: string,
  ): Promise<ContentPackage | null>;
  listContentPackages(workspaceId: string): Promise<ContentPackage[]>;
}

export interface ContentPackageHotPath extends ContentPackageReader {
  saveContentPackageAuxiliaryRecord(
    input: ContentPackageAuxiliarySave,
  ): Promise<ContentPackage>;
  saveContentPackageRevision(
    input: ContentPackageRevisionSave,
  ): Promise<ContentPackage>;
  withHotPathLock<T>(
    workspaceId: string,
    scope: string,
    action: (repository: OperationsHotPathRepository) => Promise<T>,
  ): Promise<T>;
}

export interface CreativeWorkReader {
  listCreativeAssets(workspaceId: string): Promise<CreativeAssetProjection[]>;
  listCreativeJobs(workspaceId: string): Promise<CreativeJob[]>;
  listCreativeWorks(workspaceId: string): Promise<CreativeWork[]>;
}

export interface TaskInboxReader {
  listTaskEvents(workspaceId: string): Promise<TaskEvent[]>;
  listTasks(workspaceId: string): Promise<ContentTask[]>;
}

export interface SearchProjectionWriter {
  replaceSearchDocuments(
    workspaceId: string,
    kinds: SearchDocument['kind'][],
    documents: SearchDocument[],
    snapshotUpdatedAt: string,
    projectionOwner: string,
  ): Promise<void>;
  searchDocuments(
    workspaceId: string,
    query: SearchQuery,
  ): Promise<SearchResult[]>;
}

export interface LegacyCanvasArchiveReader {
  listLegacyCanvasWorks(workspaceId: string): Promise<CanvasWork[]>;
}

export interface OperationsAuditHotPath {
  appendAuditEvent(event: OperationsAuditEvent): Promise<void>;
  listAuditEvents(
    workspaceId: string,
    action?: string,
  ): Promise<OperationsAuditEvent[]>;
}

export interface OperationsHotPathRepository
  extends
    ContentPackageHotPath,
    CreativeWorkReader,
    TaskInboxReader,
    SearchProjectionWriter,
    LegacyCanvasArchiveReader,
    OperationsAuditHotPath {}

export type OperationsDeliveryStore = OperationsHotPathRepository & {
  hasMembership(userId: string, workspaceId: string): Promise<boolean>;
  recordContentPackageRevisionConflict(conflict: {
    actorId: string;
    correlationId: string;
    currentRevision: number;
    expectedRevision: number;
    occurredAt: string;
    packageId: string;
    workspaceId: string;
  }): Promise<void>;
};

export type OperationsInboxFacts = {
  contentPackages: ContentPackage[];
  creativeJobs: CreativeJob[];
  creativeWorks: CreativeWork[];
  taskEvents: TaskEvent[];
  tasks: ContentTask[];
};

export type OperationsResultFacts = OperationsInboxFacts & {
  creativeAssets: CreativeAssetProjection[];
  legacyCanvasWorks: CanvasWork[];
};

export type OperationsProjectionReader = CreativeWorkReader &
  TaskInboxReader &
  Pick<ContentPackageReader, 'listContentPackages'> &
  LegacyCanvasArchiveReader;

export async function loadOperationsInboxFacts(
  repository: CreativeWorkReader &
    TaskInboxReader &
    Pick<ContentPackageReader, 'listContentPackages'>,
  workspaceId: string,
): Promise<OperationsInboxFacts> {
  const [contentPackages, creativeJobs, creativeWorks, taskEvents, tasks] =
    await Promise.all([
      repository.listContentPackages(workspaceId),
      repository.listCreativeJobs(workspaceId),
      repository.listCreativeWorks(workspaceId),
      repository.listTaskEvents(workspaceId),
      repository.listTasks(workspaceId),
    ]);
  return {
    contentPackages,
    creativeJobs,
    creativeWorks,
    taskEvents,
    tasks,
  };
}

export async function loadOperationsResultFacts(
  repository: OperationsProjectionReader,
  workspaceId: string,
): Promise<OperationsResultFacts> {
  const [inbox, creativeAssets, legacyCanvasWorks] = await Promise.all([
    loadOperationsInboxFacts(repository, workspaceId),
    repository.listCreativeAssets(workspaceId),
    repository.listLegacyCanvasWorks(workspaceId),
  ]);
  return { ...inbox, creativeAssets, legacyCanvasWorks };
}
