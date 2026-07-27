import { createHash } from 'node:crypto';
import type { ProductState } from '@meiye/contracts';
import type {
  RelationFactKind,
  UsageAction,
  UsageResource,
} from '../foundation/domain.js';

export interface LegacyMigrationFact {
  id: string;
  kind: RelationFactKind;
  parentId?: string;
  sequence?: number;
  data: Record<string, unknown>;
  legacySource: string;
  mappingConfidence: 'exact' | 'inferred' | 'unknown';
  createdAt: string;
}

export interface LegacyMigrationManifest {
  schemaVersion: 1;
  workspaceId: string;
  sourceRevision: string;
  targetRevision: 'p1-relation-v1';
  generatedAt: string;
  factsHash: string;
  factCount: number;
  countsByKind: Partial<Record<RelationFactKind, number>>;
  factIds: string[];
  versionSequences: Record<string, string[]>;
  quotaSnapshot: Partial<
    Record<UsageResource, { allowance: number; remaining: number }>
  >;
  inFlightJobIds: string[];
  unknownEvidence: string[];
}

export interface LegacyUsageLedgerSeed {
  id: string;
  resource: UsageResource;
  action: UsageAction;
  amount: number;
  reservationId?: string;
  reason: string;
  createdAt: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

export function legacyStateRevision(state: ProductState) {
  return createHash('sha256')
    .update(JSON.stringify(stable(state)))
    .digest('hex');
}

export function migrationFactsHash(facts: LegacyMigrationFact[]) {
  return createHash('sha256')
    .update(JSON.stringify(stable(facts)))
    .digest('hex');
}

export function mapLegacyUsageLedgerSeeds(
  state: ProductState,
  generatedAt = new Date().toISOString()
) {
  const seeds: LegacyUsageLedgerSeed[] = [];
  const resourceMap = {
    content: 'copy',
    image: 'image',
    video: 'video',
  } as const;
  const statusMap: Partial<
    Record<ProductState['usageEvents'][number]['status'], UsageAction>
  > = {
    committed: 'commit',
    expired: 'expire',
    refunded: 'refund',
    reserved: 'reserve',
  };
  const earliestEventAt = state.usageEvents
    .map((event) => event.createdAt)
    .sort()[0];
  const openingAt = earliestEventAt ?? state.updatedAt ?? generatedAt;
  const entitlement = state.entitlement;
  if (entitlement) {
    for (const [resource, bucket] of [
      ['copy', entitlement.content],
      ['image', entitlement.image],
      ['video', entitlement.video],
    ] as Array<
      [UsageResource, { allowance: number; remaining: number } | undefined]
    >) {
      if (
        bucket &&
        Number.isInteger(bucket.allowance) &&
        bucket.allowance !== 0
      ) {
        const openingRevision = createHash('sha256')
          .update(
            JSON.stringify(
              stable({
                allowance: bucket.allowance,
                plan: entitlement.plan ?? 'legacy',
                resource,
                sourceEventId: entitlement.sourceEventId ?? null,
                sourceUpdatedAt: entitlement.sourceUpdatedAt ?? null,
              })
            )
          )
          .digest('hex')
          .slice(0, 16);
        seeds.push({
          action: 'adjust',
          amount: bucket.allowance,
          createdAt: openingAt,
          id: `legacy:usage:opening:${resource}:${openingRevision}`,
          reason: [
            `plan_opening:${entitlement.plan ?? 'legacy'}:legacy-migration`,
            `plan_allowance=${bucket.allowance}`,
            'addons=none',
            'addon_quantity=0',
            'migration=legacy',
          ].join(';'),
          resource,
        });
      }
    }
  }
  for (const event of state.usageEvents) {
    const resource =
      event.resource === 'content' ||
      event.resource === 'image' ||
      event.resource === 'video'
        ? resourceMap[event.resource]
        : undefined;
    const action = statusMap[event.status];
    if (
      !resource ||
      !action ||
      !Number.isInteger(event.amount) ||
      event.amount === 0
    ) {
      continue;
    }
    seeds.push({
      action,
      amount: event.amount,
      createdAt: event.createdAt,
      id: event.id.startsWith('foundation:')
        ? event.id.slice('foundation:'.length)
        : `legacy:usage:${event.id}`,
      reason: event.reason,
      reservationId: event.reservationId,
      resource,
    });
  }
  return seeds.sort((left, right) => {
    const chronological = left.createdAt.localeCompare(right.createdAt);
    if (chronological !== 0) return chronological;
    const leftOpening = left.id.includes(':opening:');
    const rightOpening = right.id.includes(':opening:');
    if (leftOpening !== rightOpening) return leftOpening ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function legacyInFlightTaskIds(state: ProductState) {
  const videoJobIds = state.videoJobs
    .filter((job) => ['queued', 'running', 'needs_action'].includes(job.status))
    .map((job) => job.id);
  const coveredAgentRunIds = new Set(
    state.videoJobs.map((job) => job.agentRunId).filter(Boolean)
  );
  const videoJobIdsWithShells = new Set(state.videoJobs.map((job) => job.id));
  const orphanShellIds = (state.videoArtifactShells ?? [])
    .filter(
      (shell) =>
        ['queued', 'running', 'needs_action'].includes(shell.status) &&
        !videoJobIdsWithShells.has(shell.jobId)
    )
    .map((shell) => `artifact-shell:${shell.id}`);
  const standaloneAgentRunIds = state.agentRuns
    .filter(
      (run) =>
        ['queued', 'running'].includes(run.status) &&
        !coveredAgentRunIds.has(run.id)
    )
    .map((run) => `agent-run:${run.id}`);
  return [...videoJobIds, ...orphanShellIds, ...standaloneAgentRunIds].sort();
}

function factId(kind: RelationFactKind, sourceId: string) {
  return `legacy:${kind}:${sourceId}`;
}

const sensitiveKeys = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'token',
]);

function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return [
        key,
        sensitiveKeys.has(normalized)
          ? '[REDACTED]'
          : redactSensitiveData(item),
      ];
    })
  );
}

function record(value: object) {
  return structuredClone(redactSensitiveData(value)) as Record<string, unknown>;
}

export function mapLegacyProductState(
  state: ProductState,
  generatedAt = new Date().toISOString()
) {
  const legacySource = `product_states:${state.workspaceId}`;
  const facts: LegacyMigrationFact[] = [];
  const add = (
    kind: RelationFactKind,
    sourceId: string,
    data: object,
    options: {
      parentId?: string;
      sequence?: number;
      confidence?: LegacyMigrationFact['mappingConfidence'];
      createdAt?: string;
    } = {}
  ) => {
    facts.push({
      createdAt: options.createdAt ?? generatedAt,
      data: record(data),
      id: factId(kind, sourceId),
      kind,
      legacySource,
      mappingConfidence: options.confidence ?? 'exact',
      parentId: options.parentId,
      sequence: options.sequence,
    });
  };

  if (state.store) {
    add('store', 'profile', state.store, {
      createdAt: state.store.confirmedAt,
    });
    for (const [sequence, project] of state.store.projects.entries()) {
      add('project', project.id, project, {
        parentId: factId('store', 'profile'),
        sequence,
      });
    }
  }
  if (state.qualification) {
    add('store', 'qualification', state.qualification, {
      createdAt: state.qualification.intakeAt,
      parentId: state.store ? factId('store', 'profile') : undefined,
      sequence: 1,
    });
  }
  for (const [sequence, asset] of state.assets.entries()) {
    add('asset_rights', asset.id, asset, {
      createdAt: asset.createdAt,
      sequence,
    });
  }
  for (const [contentSequence, content] of state.contents.entries()) {
    add('content', content.id, content, {
      createdAt: content.createdAt,
      sequence: contentSequence,
    });
    for (const [variantSequence, variant] of content.variants.entries()) {
      add('platform_variant', variant.id, variant, {
        parentId: factId('content', content.id),
        sequence: variantSequence,
      });
      for (const [versionSequence, version] of variant.versions.entries()) {
        add('content_version', version.id, version, {
          createdAt: version.createdAt,
          parentId: factId('platform_variant', variant.id),
          sequence: versionSequence,
        });
      }
    }
  }
  for (const [sequence, storyboard] of state.storyboards.entries()) {
    add('storyboard', storyboard.id, storyboard, {
      parentId: factId('content', storyboard.contentId),
      sequence,
    });
  }
  for (const [sequence, job] of state.videoJobs.entries()) {
    add('video_job', job.id, job, {
      createdAt: job.createdAt,
      parentId: factId('storyboard', job.storyboardId),
      sequence,
    });
  }
  for (const [sequence, shell] of (state.videoArtifactShells ?? []).entries()) {
    add(
      'video_job',
      `artifact-shell:${shell.id}`,
      { ...shell, legacyRecordType: 'video_artifact_shell' },
      {
        createdAt: shell.createdAt,
        parentId: factId('storyboard', shell.storyboardId),
        sequence: state.videoJobs.length + sequence,
      }
    );
  }
  for (const [sequence, evidence] of state.videoRenderEvidence.entries()) {
    add('video_render_evidence', evidence.id, evidence, {
      createdAt: evidence.createdAt,
      parentId: factId('video_job', evidence.jobId),
      sequence,
    });
  }
  for (const [sequence, asset] of state.videoArtifacts.entries()) {
    add('owned_asset', asset.id, asset, {
      createdAt: asset.createdAt,
      parentId: factId('video_job', asset.jobId),
      sequence,
    });
  }
  for (const [sequence, handoff] of state.handoffPackages.entries()) {
    add('publish_package', handoff.id, handoff, {
      createdAt: handoff.createdAt,
      parentId: factId('content', handoff.contentId),
      sequence,
    });
    if (handoff.status === 'published') {
      add('publish_record', handoff.id, handoff, {
        createdAt: handoff.publishedAt ?? handoff.createdAt,
        parentId: factId('publish_package', handoff.id),
        sequence,
      });
    }
  }
  for (const [sequence, event] of state.usageEvents.entries()) {
    add('usage_event', event.id, event, {
      createdAt: event.createdAt,
      sequence,
    });
  }
  for (const [sequence, event] of state.auditEvents.entries()) {
    add('audit', `audit:${event.id}`, event, {
      createdAt: event.createdAt,
      sequence,
    });
  }
  for (const [sequence, result] of state.complianceResults.entries()) {
    add('audit', `compliance:${result.id}`, result, {
      createdAt: result.createdAt,
      sequence: state.auditEvents.length + sequence,
    });
  }
  let auditSequence = state.auditEvents.length + state.complianceResults.length;
  for (const run of state.agentRuns) {
    add('audit', `agent-run:${run.id}`, run, {
      createdAt: run.startedAt,
      sequence: auditSequence++,
    });
  }
  for (const call of state.toolCalls) {
    add('audit', `tool-call:${call.id}`, call, {
      createdAt: call.createdAt,
      parentId: factId('audit', `agent-run:${call.agentRunId}`),
      sequence: auditSequence++,
    });
  }
  for (const event of state.preflightEvents ?? []) {
    add('audit', `preflight:${event.id}`, event, {
      createdAt: event.createdAt,
      sequence: auditSequence++,
    });
  }
  for (const confirmation of state.responsibilityConfirmations ?? []) {
    add('audit', `responsibility:${confirmation.id}`, confirmation, {
      createdAt: confirmation.createdAt,
      sequence: auditSequence++,
    });
  }

  facts.sort((left, right) => left.id.localeCompare(right.id));
  const countsByKind: LegacyMigrationManifest['countsByKind'] = {};
  for (const fact of facts) {
    countsByKind[fact.kind] = (countsByKind[fact.kind] ?? 0) + 1;
  }
  const versionSequences: Record<string, string[]> = {};
  for (const fact of facts.filter((item) => item.kind === 'content_version')) {
    const parentId = fact.parentId;
    if (!parentId) continue;
    const ids = versionSequences[parentId] ?? [];
    ids.push(fact.id);
    versionSequences[parentId] = ids;
  }
  for (const [parentId, ids] of Object.entries(versionSequences)) {
    const sequenceById = new Map(
      facts.map((fact) => [fact.id, fact.sequence ?? Number.MAX_SAFE_INTEGER])
    );
    versionSequences[parentId] = ids.sort(
      (left, right) =>
        (sequenceById.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (sequenceById.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right)
    );
  }
  const unknownEvidence = [
    ...(state.agentRuns.length > 0 || state.toolCalls.length > 0
      ? ['historical model route and provider cost may be unknown']
      : []),
    ...(state.contents.some((content) =>
      content.variants.some((variant) =>
        variant.versions.some((version) => !version.generationEvidence)
      )
    )
      ? ['historical requested platform/model evidence is unknown where absent']
      : []),
    ...(state.usageEvents.some(
      (event) => event.resource === 'package' || event.resource === 'storage'
    )
      ? [
          'legacy package/storage usage remains read-only evidence and is not projected into the P1 copy/image/video ledger',
        ]
      : []),
    ...(state.usageEvents.some(
      (event) =>
        event.status === 'failed_no_charge' || event.status === 'quality_retry'
    )
      ? [
          'zero-impact legacy usage events remain relation evidence and do not create billable P1 ledger entries',
        ]
      : []),
  ];
  const manifest: LegacyMigrationManifest = {
    countsByKind,
    factCount: facts.length,
    factsHash: migrationFactsHash(facts),
    factIds: facts.map((fact) => fact.id),
    generatedAt,
    inFlightJobIds: legacyInFlightTaskIds(state),
    quotaSnapshot: state.entitlement
      ? {
          copy: {
            allowance: state.entitlement.content.allowance,
            remaining: state.entitlement.content.remaining,
          },
          ...(state.entitlement.image
            ? {
                image: {
                  allowance: state.entitlement.image.allowance,
                  remaining: state.entitlement.image.remaining,
                },
              }
            : {}),
          video: {
            allowance: state.entitlement.video.allowance,
            remaining: state.entitlement.video.remaining,
          },
        }
      : {},
    schemaVersion: 1,
    sourceRevision: legacyStateRevision(state),
    targetRevision: 'p1-relation-v1',
    unknownEvidence,
    versionSequences,
    workspaceId: state.workspaceId,
  };
  return { facts, manifest };
}
