import {
  contentPackageSchema,
  type ContentPackage,
  type ContentPackageExportReceipt,
  type ContentPackageKind,
  type ContentPackageSource,
  type ContentPackageStatus,
  type ContentPackageVersion,
  type ContentPackageVersionSourceRef,
} from '@meiye/contracts';

export type ContentPackageEvent =
  | {
      failedRunIds: string[];
      succeededRunIds: string[];
      type: 'child_runs_partially_completed';
    }
  | { type: 'cancel_requested' }
  | { type: 'cancellation_confirmed' }
  | { type: 'input_missing' }
  | { type: 'quality_review_required' }
  | { receipt: ContentPackageExportReceipt; type: 'export_failed' }
  | { receipt: ContentPackageExportReceipt; type: 'export_succeeded' }
  | { type: 'generation_started' }
  | { type: 'provider_completed' }
  | { ownedAssetId: string; type: 'provider_url_expired' }
  | { runIds: string[]; type: 'retry_failed_child_runs' }
  | { type: 'save_outcome_unknown' }
  | {
      originalIdempotencyKey: string;
      type: 'save_replayed';
      versionId: string;
    }
  | {
      originalIdempotencyKey: string;
      recovery: 'query_only';
      type: 'submission_outcome_unknown';
    }
  | { type: 'adopted'; version: ContentPackageVersion }
  | { at: string; reason?: string; type: 'rights_revoked' };

export const CONTENT_PACKAGE_TRANSITIONS = {
  adopted: {
    draft: 'accepted',
    review_ready: 'accepted',
  },
  cancel_requested: {
    accepted: 'cancelling',
    draft: 'cancelling',
    export_failed: 'cancelling',
    generating: 'cancelling',
    needs_input: 'cancelling',
    needs_replacement: 'cancelling',
    partial: 'cancelling',
    review_ready: 'cancelling',
    save_unknown: 'cancelling',
    verifying: 'cancelling',
  },
  cancellation_confirmed: {
    cancelling: 'cancelled',
  },
  child_runs_partially_completed: {
    generating: 'partial',
    verifying: 'partial',
  },
  export_failed: {
    accepted: 'export_failed',
    export_failed: 'export_failed',
  },
  export_succeeded: {
    accepted: 'accepted',
    export_failed: 'accepted',
  },
  generation_started: {
    draft: 'generating',
  },
  input_missing: {
    draft: 'needs_input',
    generating: 'needs_input',
    needs_input: 'needs_input',
    verifying: 'needs_input',
  },
  provider_completed: {
    generating: 'review_ready',
    needs_input: 'review_ready',
    partial: 'review_ready',
    verifying: 'review_ready',
  },
  provider_url_expired: {
    accepted: 'accepted',
    cancelled: 'cancelled',
    cancelling: 'cancelling',
    draft: 'draft',
    export_failed: 'export_failed',
    generating: 'generating',
    needs_input: 'needs_input',
    needs_replacement: 'needs_replacement',
    partial: 'partial',
    review_ready: 'review_ready',
    save_unknown: 'save_unknown',
    verifying: 'verifying',
  },
  quality_review_required: {
    generating: 'needs_input',
    verifying: 'needs_input',
  },
  retry_failed_child_runs: {
    partial: 'generating',
  },
  rights_revoked: {
    accepted: 'needs_replacement',
    draft: 'needs_replacement',
    export_failed: 'needs_replacement',
    generating: 'needs_replacement',
    needs_input: 'needs_replacement',
    partial: 'needs_replacement',
    review_ready: 'needs_replacement',
    save_unknown: 'needs_replacement',
    verifying: 'needs_replacement',
  },
  save_outcome_unknown: {
    accepted: 'save_unknown',
    review_ready: 'save_unknown',
  },
  save_replayed: {
    save_unknown: 'accepted',
  },
  submission_outcome_unknown: {
    generating: 'verifying',
    verifying: 'verifying',
  },
} as const satisfies Record<
  ContentPackageEvent['type'],
  Partial<Record<ContentPackageStatus, ContentPackageStatus>>
>;

export class ContentPackageTransitionError extends Error {}

export function transitionContentPackage(
  contentPackage: ContentPackage,
  event: ContentPackageEvent,
  timestamp: string
): ContentPackage {
  const transitions = CONTENT_PACKAGE_TRANSITIONS[event.type];
  const nextStatus = transitions?.[
    contentPackage.status as keyof (typeof CONTENT_PACKAGE_TRANSITIONS)[typeof event.type]
  ] as ContentPackageStatus | undefined;
  if (!nextStatus) {
    throw new ContentPackageTransitionError(
      `ContentPackage cannot apply ${event.type} from ${contentPackage.status}.`
    );
  }
  if (
    event.type === 'submission_outcome_unknown' &&
    (!event.originalIdempotencyKey.trim() || event.recovery !== 'query_only')
  ) {
    throw new ContentPackageTransitionError(
      'Unknown submissions must be queried with the original idempotency key.'
    );
  }
  let generated = contentPackage.generated;
  if (event.type === 'child_runs_partially_completed') {
    const succeeded = new Set(event.succeededRunIds);
    const failed = new Set(event.failedRunIds);
    const knownRunIds = new Set(
      contentPackage.generated.childRuns.map((run) => run.runId)
    );
    const mentioned = [...succeeded, ...failed];
    if (
      succeeded.size === 0 ||
      failed.size === 0 ||
      mentioned.length !== succeeded.size + failed.size ||
      mentioned.some((runId) => !knownRunIds.has(runId))
    ) {
      throw new ContentPackageTransitionError(
        'Partial completion must identify distinct known successful and failed child runs.'
      );
    }
    generated = {
      ...contentPackage.generated,
      childRuns: contentPackage.generated.childRuns.map((run) => ({
        ...run,
        ...(succeeded.has(run.runId)
          ? { status: 'succeeded' as const }
          : failed.has(run.runId)
            ? { status: 'failed' as const }
            : {}),
      })),
    };
  }
  if (event.type === 'retry_failed_child_runs') {
    const failedRunIds = contentPackage.generated.childRuns
      .filter((run) => run.status === 'failed')
      .map((run) => run.runId)
      .sort();
    const requestedRunIds = [...new Set(event.runIds)].sort();
    if (
      failedRunIds.length === 0 ||
      requestedRunIds.length !== event.runIds.length ||
      JSON.stringify(requestedRunIds) !== JSON.stringify(failedRunIds)
    ) {
      throw new ContentPackageTransitionError(
        'Partial recovery must retry exactly the failed child runs.'
      );
    }
    generated = {
      ...contentPackage.generated,
      childRuns: contentPackage.generated.childRuns.map((run) =>
        failedRunIds.includes(run.runId)
          ? { ...run, status: 'pending' as const }
          : run
      ),
    };
  }
  let versions = contentPackage.versions;
  let currentVersionId = contentPackage.currentVersionId;
  if (event.type === 'adopted') {
    if (versions.some((version) => version.id === event.version.id)) {
      throw new ContentPackageTransitionError(
        'Adoption cannot create a duplicate ContentPackage version.'
      );
    }
    versions = [...versions, event.version];
    currentVersionId = event.version.id;
  }
  if (event.type === 'save_replayed') {
    if (
      !event.originalIdempotencyKey.trim() ||
      !versions.some((version) => version.id === event.versionId)
    ) {
      throw new ContentPackageTransitionError(
        'Unknown saves must replay the existing version with the original idempotency key.'
      );
    }
    currentVersionId = event.versionId;
  }
  let exportReceipts = contentPackage.exportReceipts;
  if (event.type === 'export_failed') {
    if (event.receipt.status !== 'failed') {
      throw new ContentPackageTransitionError(
        'An export_failed transition requires a failed receipt.'
      );
    }
    exportReceipts = [...exportReceipts, event.receipt];
  }
  if (event.type === 'export_succeeded') {
    if (
      event.receipt.status !== 'succeeded' ||
      event.receipt.contentType !== 'application/zip'
    ) {
      throw new ContentPackageTransitionError(
        'An export_succeeded transition requires a succeeded ZIP receipt.'
      );
    }
    exportReceipts = [...exportReceipts, event.receipt];
  }
  if (event.type === 'provider_url_expired') {
    const ownedAssetIds = new Set([
      ...contentPackage.source.assetIds,
      ...contentPackage.generated.assetIds,
      ...contentPackage.versions.flatMap((version) => version.orderedAssetIds),
      ...contentPackage.variants.flatMap((variant) =>
        variant.versions.flatMap((version) => version.orderedAssetIds)
      ),
      ...contentPackage.exportReceipts.flatMap((receipt) =>
        receipt.artifactAssetId ? [receipt.artifactAssetId] : []
      ),
    ]);
    if (!ownedAssetIds.has(event.ownedAssetId)) {
      throw new ContentPackageTransitionError(
        'An expired provider URL must resolve to an owned archive Asset.'
      );
    }
  }
  const rights =
    event.type === 'rights_revoked'
      ? {
          ...(event.reason ? { reason: event.reason } : {}),
          revokedAt: event.at,
          state: 'revoked' as const,
        }
      : contentPackage.rights;
  return contentPackageSchema.parse({
    ...contentPackage,
    ...(currentVersionId ? { currentVersionId } : {}),
    exportReceipts,
    generated,
    rights,
    status: nextStatus,
    updatedAt: timestamp,
    versions,
  });
}

export function assertContentPackageExportAllowed(
  contentPackage: ContentPackage
) {
  if (
    contentPackage.rights.state === 'revoked' ||
    contentPackage.status === 'needs_replacement'
  ) {
    throw new ContentPackageTransitionError(
      'Revoked ContentPackage rights block new exports.'
    );
  }
  if (!['accepted', 'export_failed'].includes(contentPackage.status)) {
    throw new ContentPackageTransitionError(
      'Only an accepted ContentPackage can start a new export.'
    );
  }
}

export function buildContentPackage(input: {
  id: string;
  kind: ContentPackageKind;
  source: ContentPackageSource;
  sourceRef?: ContentPackageVersionSourceRef;
  timestamp: string;
  workspaceId: string;
}): ContentPackage {
  const hasSource =
    input.source.assetIds.length > 0 ||
    Boolean(input.sourceRef?.advancedCanvas) ||
    Boolean(
      input.source.briefId ||
        input.source.groundingId ||
        input.source.storeProfileId ||
        input.source.workId ||
        input.source.workflowId
    );
  return contentPackageSchema.parse({
    compliance: {
      aigcLabelEnabled: false,
      watermarkEnabled: false,
    },
    createdAt: input.timestamp,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: input.id,
    kind: input.kind,
    lineage: {},
    rights: { state: 'authorized' },
    source: input.source,
    status: hasSource ? 'draft' : 'needs_input',
    updatedAt: input.timestamp,
    variants: [],
    versions: [],
    workspaceId: input.workspaceId,
  });
}
