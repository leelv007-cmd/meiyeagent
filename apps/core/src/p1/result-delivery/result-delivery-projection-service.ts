import type {
  ActionableInboxItem,
  PendingAction,
  RecentActivitySource,
  RecentProjectionItem,
  RecentViewport,
  ResultTarget,
  ResultTargetResolveOutcome,
} from '@meiye/contracts';

import type { OperationsRepository } from '../operations/repository.js';
import type {
  CreativeJob,
  CreativeWork,
  OperationsWorkspaceState,
} from '../operations/types.js';
import { projectActionableInbox } from './actionable-inbox.js';
import {
  deliveryStatusOf,
  projectInboxEventSources,
} from './inbox-sources.js';
import { projectRecent } from './recent-projection.js';
import {
  resolveResultTarget,
  type ResolverLegacyPackage,
  type ResolverWorkRecord,
} from './result-target-resolver.js';

export type ResultDeliveryOperationsReader = Pick<
  OperationsRepository,
  'hasMembership' | 'loadWorkspace'
>;

export interface ResultDeliveryPendingActionsReader {
  list(input: { userId: string; workspaceId: string }): Promise<PendingAction[]>;
}

function mediumFor(work: CreativeWork): RecentActivitySource['medium'] {
  if (work.operation === 'video.generate') return 'video';
  if (work.operation === 'image.generate' || work.operation === 'image.edit') {
    return 'image_text';
  }
  return 'copy';
}

function latestJobFor(
  state: OperationsWorkspaceState,
  work: CreativeWork,
): CreativeJob | undefined {
  const jobs = state.creativeJobs.filter((job) => job.workId === work.id);
  return (
    jobs.find((job) => job.id === work.currentJobId) ??
    jobs.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    )[0]
  );
}

function phaseFor(
  work: CreativeWork,
  job: CreativeJob | undefined,
  delivered: boolean,
): RecentActivitySource['phase'] {
  if (delivered) return 'delivered';
  if (job?.status === 'failed' || work.status === 'failed') return 'failed';
  if (job?.status === 'recoverable' || job?.status === 'unknown') {
    return 'needs_input';
  }
  if (
    job?.status === 'running' ||
    job?.status === 'submitting' ||
    work.status === 'running'
  ) {
    return 'running';
  }
  return 'ready';
}

function resolverFacts(state: OperationsWorkspaceState): {
  works: ResolverWorkRecord[];
  legacyPackages: ResolverLegacyPackage[];
} {
  const packagesByWork = new Map<
    string,
    OperationsWorkspaceState['contentPackages']
  >();
  const legacyPackages: ResolverLegacyPackage[] = [];
  for (const contentPackage of state.contentPackages) {
    const workId = contentPackage.source.workId;
    if (!workId) {
      legacyPackages.push({
        contentId: contentPackage.id,
        workspaceId: contentPackage.workspaceId,
        versionIds: contentPackage.versions.map((version) => version.id),
        hasSourceWork: false,
      });
      continue;
    }
    const current = packagesByWork.get(workId) ?? [];
    current.push(contentPackage);
    packagesByWork.set(workId, current);
  }

  return {
    works: state.creativeWorks.map((work) => {
      const packages = packagesByWork.get(work.id) ?? [];
      return {
        workId: work.id,
        workspaceId: work.workspaceId,
        contentIds: packages.map((contentPackage) => contentPackage.id),
        versionIdsByContentId: Object.fromEntries(
          packages.map((contentPackage) => [
            contentPackage.id,
            contentPackage.versions.map((version) => version.id),
          ]),
        ),
        allowedFocusKeys: state.creativeAssets
          .filter((asset) => asset.workId === work.id)
          .map((asset) => asset.id),
        origin: 'native' as const,
      };
    }),
    legacyPackages,
  };
}

function recentSources(state: OperationsWorkspaceState): RecentActivitySource[] {
  return state.creativeWorks.map((work) => {
    const job = latestJobFor(state, work);
    const contentPackages = state.contentPackages.filter(
      (contentPackage) => contentPackage.source.workId === work.id,
    );
    const latestPackage = [...contentPackages].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    )[0];
    const delivered = contentPackages.some((contentPackage) =>
      (contentPackage.deliveryEvents ?? []).some(
        (event) => deliveryStatusOf(event) === 'published',
      ),
    );
    const phase = phaseFor(work, job, delivered);
    const effectiveActivityAt = [
      work.updatedAt,
      job?.updatedAt,
      ...contentPackages.map((contentPackage) => contentPackage.updatedAt),
      ...contentPackages.flatMap((contentPackage) =>
        (contentPackage.deliveryEvents ?? []).map((event) => event.occurredAt),
      ),
    ]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)!;
    const versionId =
      latestPackage?.currentVersionId ?? latestPackage?.versions.at(-1)?.id;
    return {
      workId: work.id,
      workspaceId: work.workspaceId,
      title: work.intent,
      medium: mediumFor(work),
      phase,
      effectiveActivityAt,
      ...(latestPackage ? { contentId: latestPackage.id } : {}),
      ...(versionId ? { versionId } : {}),
      panel: delivered ? 'delivery' : phase === 'running' ? 'run' : 'result',
    };
  });
}

function inboxSources(state: OperationsWorkspaceState) {
  // Single shared classifier — same rules as the platform pending-actions
  // assembler (see inbox-sources.ts).
  return projectInboxEventSources({
    workspaceId: state.workspaceId,
    contentPackages: state.contentPackages,
    tasks: state.tasks,
    taskEvents: state.taskEvents,
    creativeWorks: state.creativeWorks,
    creativeJobs: state.creativeJobs,
  });
}

export class ResultDeliveryProjectionService {
  constructor(
    private readonly operations: ResultDeliveryOperationsReader,
    private readonly pendingActions?: ResultDeliveryPendingActionsReader,
  ) {}

  private async loadAuthorized(input: { userId: string; workspaceId: string }) {
    const hasMembership = await this.operations.hasMembership(
      input.userId,
      input.workspaceId,
    );
    const state = hasMembership
      ? await this.operations.loadWorkspace(input.workspaceId)
      : null;
    return { hasMembership, state };
  }

  async resolveTarget(input: {
    userId: string;
    workspaceId: string;
    target: ResultTarget;
  }): Promise<ResultTargetResolveOutcome> {
    const { hasMembership, state } = await this.loadAuthorized(input);
    const facts = state
      ? resolverFacts(state)
      : { works: [], legacyPackages: [] };
    return resolveResultTarget({
      request: input.target,
      viewer: { userId: input.userId, workspaceId: input.workspaceId },
      hasMembership,
      works: facts.works,
      legacyPackages: facts.legacyPackages,
    });
  }

  async listRecent(input: {
    userId: string;
    workspaceId: string;
    viewport: RecentViewport;
  }): Promise<RecentProjectionItem[]> {
    const { hasMembership, state } = await this.loadAuthorized(input);
    if (!hasMembership || !state) return [];
    return projectRecent(recentSources(state), input.viewport);
  }

  async listActionableInbox(input: {
    userId: string;
    workspaceId: string;
  }): Promise<ActionableInboxItem[]> {
    const { hasMembership, state } = await this.loadAuthorized(input);
    if (!hasMembership || !state) return [];
    const sources = inboxSources(state);
    const pendingActions = this.pendingActions
      ? await this.pendingActions.list(input)
      : [];
    return projectActionableInbox({ ...sources, pendingActions });
  }
}
