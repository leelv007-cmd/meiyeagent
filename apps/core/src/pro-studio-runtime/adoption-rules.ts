import { createHash } from 'node:crypto';

export interface AdoptionCommandLike {
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

export interface AdoptionResultLike {
  packageId: string;
  versionId: string;
  projectId: string;
  revisionId: string;
  selectedNodeIds: string[];
  orderedMediaNodeIds: string[];
}

export interface AdoptionReceiptLike<TResult extends AdoptionResultLike> {
  idempotencyKey: string;
  payloadHash: string;
  result: TResult;
}

export interface AdoptionRuleNode {
  id: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  text?: string;
  assetId?: string;
  jobId?: string;
  sourceAssetIds?: string[];
  deliverable?: boolean;
}

export interface ResolvedAdoptionSelection {
  kind: 'image_text' | 'video';
  body?: string;
  orderedAssetIds: string[];
  orderedJobIds: string[];
  childJobIds: string[];
  sourceAssetIds: string[];
  selectedNodeIds: string[];
}

export interface AdoptionIdentity {
  businessKey: string;
  packageId: string;
  payloadHash: string;
  versionId: string;
}

type ErrorDefinition = { code: string; message: string };

export interface AdoptionRuleProfile {
  command: {
    emptySelection: ErrorDefinition;
    validateSelectedNodeIds: boolean;
  };
  identity: {
    omitUndefined: boolean;
    revisionId(input: {
      digest: string;
      projectId: string;
      workspaceId?: string;
    }): string;
    versionId(input: { businessKey: string; packageId: string }): string;
  };
  selection: {
    audioUnsupported: ErrorDefinition;
    invalid: ErrorDefinition;
    mediaNodeMissing: ErrorDefinition;
    mediaNotDeliverable: ErrorDefinition;
    textAsMedia: ErrorDefinition;
    textNodeInvalid: ErrorDefinition;
    textRequired: ErrorDefinition;
    validateInlineDelivery: boolean;
  };
}

export const memoryAdoptionRuleProfile: AdoptionRuleProfile = {
  command: {
    emptySelection: {
      code: 'MEDIA_SELECTION_REQUIRED',
      message: 'At least one media node must be selected.',
    },
    validateSelectedNodeIds: true,
  },
  identity: {
    omitUndefined: true,
    revisionId: ({ digest }) => `advanced-canvas-revision-${digest.slice(0, 24)}`,
    versionId: ({ businessKey }) =>
      `content-version-${businessKey.slice(0, 24)}`,
  },
  selection: {
    audioUnsupported: {
      code: 'AUDIO_PACKAGE_NOT_SUPPORTED',
      message: 'Standalone audio content packages are out of scope.',
    },
    invalid: {
      code: 'TEXT_NODE_REQUIRED',
      message: 'Image-text adoption requires a text node.',
    },
    mediaNodeMissing: {
      code: 'MEDIA_NODE_NOT_FOUND',
      message: 'Selected media node was not found in the revision.',
    },
    mediaNotDeliverable: {
      code: 'MEDIA_NOT_DELIVERABLE',
      message: 'Selected media is not an owned deliverable.',
    },
    textAsMedia: {
      code: 'MEDIA_NODE_NOT_FOUND',
      message: 'Selected media node was not found in the revision.',
    },
    textNodeInvalid: {
      code: 'TEXT_NODE_REQUIRED',
      message: 'Image-text adoption requires a text node.',
    },
    textRequired: {
      code: 'TEXT_NODE_REQUIRED',
      message: 'Image-text adoption requires a text node.',
    },
    validateInlineDelivery: true,
  },
};

export const postgresAdoptionRuleProfile: AdoptionRuleProfile = {
  command: {
    emptySelection: {
      code: 'SELECTION_INVALID',
      message: 'Adoption requires ordered media nodes.',
    },
    validateSelectedNodeIds: false,
  },
  identity: {
    omitUndefined: false,
    revisionId: ({ digest }) => `revision-${digest.slice(0, 24)}`,
    versionId: ({ businessKey, packageId }) =>
      `${packageId}-v-${businessKey.slice(0, 16)}`,
  },
  selection: {
    audioUnsupported: {
      code: 'CONTENT_KIND_INVALID',
      message: 'Adoption supports image-text or video output; audio is not standalone.',
    },
    invalid: {
      code: 'CONTENT_KIND_INVALID',
      message: 'Adoption supports image-text or video output; audio is not standalone.',
    },
    mediaNodeMissing: {
      code: 'SELECTION_INVALID',
      message: 'Every selected media node must belong to the frozen revision.',
    },
    mediaNotDeliverable: {
      code: 'SELECTION_INVALID',
      message: 'Every selected media node must belong to the frozen revision.',
    },
    textAsMedia: {
      code: 'CONTENT_KIND_INVALID',
      message: 'Adoption supports image-text or video output; audio is not standalone.',
    },
    textNodeInvalid: {
      code: 'SELECTION_INVALID',
      message: 'The selected text node is invalid.',
    },
    textRequired: {
      code: 'CONTENT_KIND_INVALID',
      message: 'Adoption supports image-text or video output; audio is not standalone.',
    },
    validateInlineDelivery: false,
  },
};

export class AdvancedCanvasAdoptionError extends Error {
  readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdvancedCanvasAdoptionError';
    this.status = adoptionErrorStatus(code);
  }
}

export function validateAdoptionCommand(
  command: AdoptionCommandLike,
  profile: AdoptionRuleProfile,
) {
  requireText(command.projectId, 'projectId');
  requireText(command.idempotencyKey, 'idempotencyKey');
  if (
    !Array.isArray(command.selection.orderedMediaNodeIds) ||
    command.selection.orderedMediaNodeIds.length === 0
  ) {
    fail(profile.command.emptySelection);
  }
  if (profile.command.validateSelectedNodeIds) {
    for (const nodeId of command.selection.orderedMediaNodeIds) {
      requireText(nodeId, 'orderedMediaNodeId');
    }
    if (command.selection.textNodeId) {
      requireText(command.selection.textNodeId, 'textNodeId');
    }
  }
}

export function adoptionPayloadHash(
  command: AdoptionCommandLike,
  profile: AdoptionRuleProfile,
) {
  return digest(canonical(command, profile.identity.omitUndefined));
}

export function resolveIdempotencyReplay<TResult extends AdoptionResultLike>(
  receipts: readonly AdoptionReceiptLike<TResult>[],
  idempotencyKey: string,
  payloadHash: string,
) {
  const receipt = receipts.find(
    (candidate) => candidate.idempotencyKey === idempotencyKey,
  );
  if (!receipt) return undefined;
  if (receipt.payloadHash !== payloadHash) {
    throw new AdvancedCanvasAdoptionError(
      'IDEMPOTENCY_CONFLICT',
      'Adoption key was reused with another payload.',
    );
  }
  return structuredClone(receipt.result);
}

export function assertDraftVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw new AdvancedCanvasAdoptionError(
      'DRAFT_VERSION_CONFLICT',
      'Advanced canvas draft changed before adoption.',
    );
  }
}

export function createAdoptionRevisionId(
  input: {
    graph?: unknown;
    projectId: string;
    draftVersion: number;
    workspaceId?: string;
  },
  profile: AdoptionRuleProfile,
) {
  const revisionDigest = digest(
    canonical(
      profile === postgresAdoptionRuleProfile
        ? {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            draftVersion: input.draftVersion,
            graph: input.graph,
          }
        : {
            projectId: input.projectId,
            draftVersion: input.draftVersion,
          },
      profile.identity.omitUndefined,
    ),
  );
  return profile.identity.revisionId({
    digest: revisionDigest,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
}

export function resolveAdoptionSelection(
  nodes: readonly AdoptionRuleNode[],
  selection: AdoptionCommandLike['selection'],
  profile: AdoptionRuleProfile,
): ResolvedAdoptionSelection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const mediaNodes = selection.orderedMediaNodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) fail(profile.selection.mediaNodeMissing);
    return node;
  });
  const textNode = selection.textNodeId
    ? nodeById.get(selection.textNodeId)
    : undefined;
  if (selection.textNodeId && textNode?.kind !== 'text') {
    fail(profile.selection.textNodeInvalid);
  }
  for (const node of mediaNodes) {
    if (node.kind === 'text') fail(profile.selection.textAsMedia);
    if (profile.selection.validateInlineDelivery && !node.deliverable) {
      fail(profile.selection.mediaNotDeliverable);
    }
    if (node.kind === 'audio') fail(profile.selection.audioUnsupported);
  }

  const mediaKinds = mediaNodes.map((node) => node.kind);
  const kind = textNode
    ? mediaKinds.every((mediaKind) => mediaKind === 'image')
      ? ('image_text' as const)
      : null
    : mediaKinds.every((mediaKind) => mediaKind === 'video')
      ? ('video' as const)
      : null;
  if (!kind) {
    fail(textNode ? profile.selection.invalid : profile.selection.textRequired);
  }

  const orderedAssetIds = mediaNodes.map((node) =>
    requireSelectionText(node.assetId, 'assetId', profile),
  );
  const orderedJobIds = mediaNodes.map((node) =>
    requireSelectionText(node.jobId, 'jobId', profile),
  );
  return {
    kind,
    ...(textNode?.kind === 'text'
      ? { body: requireSelectionText(textNode.text, 'text', profile) }
      : {}),
    orderedAssetIds,
    orderedJobIds,
    childJobIds: stableUnique(orderedJobIds),
    sourceAssetIds: stableUnique(
      mediaNodes.flatMap((node) => node.sourceAssetIds ?? []),
    ),
    selectedNodeIds: [
      ...(selection.textNodeId ? [selection.textNodeId] : []),
      ...selection.orderedMediaNodeIds,
    ],
  };
}

export function createAdoptionIdentity(
  command: AdoptionCommandLike,
  revisionId: string,
  profile: AdoptionRuleProfile,
): AdoptionIdentity {
  const businessKey = digest(
    canonical(
      {
        projectId: command.projectId,
        revisionId,
        textNodeId: command.selection.textNodeId,
        orderedMediaNodeIds: command.selection.orderedMediaNodeIds,
      },
      profile.identity.omitUndefined,
    ),
  );
  const packageId =
    command.target.kind === 'new_package'
      ? `content-package-${businessKey.slice(0, 24)}`
      : command.target.packageId;
  return {
    businessKey,
    packageId,
    payloadHash: adoptionPayloadHash(command, profile),
    versionId: profile.identity.versionId({ businessKey, packageId }),
  };
}

export function assertAdoptionTarget(
  current: { kind: 'image_text' | 'video'; currentVersionId: string } | null,
  command: AdoptionCommandLike,
  selectionKind: 'image_text' | 'video',
) {
  if (command.target.kind === 'existing_package') {
    if (!current) {
      throw new AdvancedCanvasAdoptionError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'Target content package was not found.',
      );
    }
    if (current.currentVersionId !== command.target.baseVersionId) {
      throw new AdvancedCanvasAdoptionError(
        'CONTENT_VERSION_CONFLICT',
        'Target content package version is stale.',
      );
    }
    if (current.kind !== selectionKind) {
      throw new AdvancedCanvasAdoptionError(
        'CONTENT_KIND_CONFLICT',
        'Canvas selection does not match the target content kind.',
      );
    }
  } else if (current) {
    throw new AdvancedCanvasAdoptionError(
      'CONTENT_PACKAGE_CONFLICT',
      'The deterministic ContentPackage already exists without its matching advanced canvas source.',
    );
  }
}

export function createAdoptionResult(
  command: AdoptionCommandLike,
  revisionId: string,
  identity: Pick<AdoptionIdentity, 'packageId' | 'versionId'>,
  selectedNodeIds: string[],
): AdoptionResultLike {
  return {
    packageId: identity.packageId,
    versionId: identity.versionId,
    projectId: command.projectId,
    revisionId,
    selectedNodeIds: [...selectedNodeIds],
    orderedMediaNodeIds: [...command.selection.orderedMediaNodeIds],
  };
}

export function createAdoptionAuditDetails(
  context: { correlationId: string },
  result: AdoptionResultLike,
) {
  return {
    correlationId: context.correlationId,
    orderedMediaNodeIds: [...result.orderedMediaNodeIds],
    packageId: result.packageId,
    revisionId: result.revisionId,
    selectedNodeIds: [...result.selectedNodeIds],
    versionId: result.versionId,
  };
}

export function sameAdoptionSelection(
  candidate: AdoptionResultLike,
  revisionId: string,
  selectedNodeIds: string[],
  orderedMediaNodeIds: string[],
) {
  return (
    candidate.revisionId === revisionId &&
    sameOrder(candidate.selectedNodeIds, selectedNodeIds) &&
    sameOrder(candidate.orderedMediaNodeIds, orderedMediaNodeIds)
  );
}

function adoptionErrorStatus(code: string) {
  if (code === 'WORKSPACE_FORBIDDEN') return 403;
  if (code.includes('NOT_FOUND')) return 404;
  if (code.includes('CONFLICT')) return 409;
  return 400;
}

function requireSelectionText(
  value: string | undefined,
  field: string,
  profile: AdoptionRuleProfile,
) {
  if (typeof value !== 'string' || !value.trim()) {
    if (profile === postgresAdoptionRuleProfile) {
      throw new AdvancedCanvasAdoptionError(
        'SELECTION_INVALID',
        `Selected node has no ${field}.`,
      );
    }
    throw new AdvancedCanvasAdoptionError(
      'INPUT_INVALID',
      `${field} is required.`,
    );
  }
  return value;
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AdvancedCanvasAdoptionError(
      'INPUT_INVALID',
      `${field} is required.`,
    );
  }
}

function stableUnique(values: string[]) {
  return [...new Set(values)];
}

function sameOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function fail(definition: ErrorDefinition): never {
  throw new AdvancedCanvasAdoptionError(definition.code, definition.message);
}

function canonical(value: unknown, omitUndefined: boolean): string {
  if (Array.isArray(value)) {
    return `[${value.map((nested) => canonical(nested, omitUndefined)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => !omitUndefined || nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonical(nested, omitUndefined)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
