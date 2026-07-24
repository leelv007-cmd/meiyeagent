import { createHash } from 'node:crypto';
import {
  CONTEXT_DIMENSIONS,
  CONTEXT_PRIORITY_LAYERS,
  CONTEXT_SOURCE_REVISION_KEYS,
  contextBundlePayloadSchema,
  contextContributionSchema,
  contextSourceRevisionsSchema,
  type ContextBundlePayload,
  type ContextContribution,
  type ContextDimension,
  type ContextSourceRevisions,
} from '@meiye/contracts';

export const CONTEXT_BUNDLE_SERIALIZER_VERSION =
  'context-bundle-c14n-v1' as const;

export interface CompileContextBundleInput {
  workspaceId: string;
  taskId: string;
  sourceRevisions: ContextSourceRevisions;
  contributions: readonly ContextContribution[];
}

export interface CompiledContextBundle {
  payload: ContextBundlePayload;
  hash: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalContextJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function hashContextBundlePayload(payload: ContextBundlePayload) {
  return createHash('sha256')
    .update(canonicalContextJson(payload))
    .digest('hex');
}

function priority(contribution: ContextContribution) {
  return CONTEXT_PRIORITY_LAYERS.indexOf(contribution.layer);
}

function eligible(contribution: ContextContribution) {
  if (contribution.pool !== 'current_signal') return true;
  if (contribution.layer === 'current_instruction') return true;
  return (
    contribution.capabilityStatus === 'verified' ||
    contribution.capabilityStatus === 'assisted'
  );
}

function compareContributions(
  left: ContextContribution,
  right: ContextContribution,
) {
  if (left.factSnapshot && right.factSnapshot) {
    const factOrder =
      Date.parse(right.factSnapshot.effectiveFrom) -
        Date.parse(left.factSnapshot.effectiveFrom) ||
      right.factSnapshot.revision - left.factSnapshot.revision;
    if (factOrder !== 0) return factOrder;
  }
  return (
    priority(left) - priority(right) ||
    left.sourceRef.localeCompare(right.sourceRef) ||
    canonicalContextJson(left.value).localeCompare(
      canonicalContextJson(right.value),
    )
  );
}

export function compileContextBundle(
  input: CompileContextBundleInput,
): CompiledContextBundle {
  const contributions = input.contributions.map((item) =>
    contextContributionSchema.parse(item),
  );
  const dimensions = Object.fromEntries(
    CONTEXT_DIMENSIONS.map((dimension) => [dimension, {}]),
  ) as Record<ContextDimension, Record<string, never>>;
  const selectedFacts = new Map<string, number>();

  for (const dimension of CONTEXT_DIMENSIONS) {
    const candidates = contributions
      .filter((item) => item.dimension === dimension && eligible(item))
      .sort((left, right) =>
        left.key.localeCompare(right.key) || compareContributions(left, right),
      );
    for (const candidate of candidates) {
      if (candidate.key in dimensions[dimension]) continue;
      Object.assign(dimensions[dimension], {
        [candidate.key]: {
          value: canonicalize(candidate.value),
          layer: candidate.layer,
          pool: candidate.pool,
          sourceRef: candidate.sourceRef,
          ...(candidate.factSnapshot
            ? { factSnapshot: candidate.factSnapshot }
            : {}),
        },
      });
      if (candidate.factRevision) {
        selectedFacts.set(
          candidate.factRevision.factId,
          candidate.factRevision.revision,
        );
      }
    }
  }

  const payload = contextBundlePayloadSchema.parse({
    serializerVersion: CONTEXT_BUNDLE_SERIALIZER_VERSION,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    sourceRevisions: contextSourceRevisionsSchema.parse(input.sourceRevisions),
    dimensions,
    referencedFactRevisions: [...selectedFacts]
      .map(([factId, revision]) => ({ factId, revision }))
      .sort((left, right) => left.factId.localeCompare(right.factId)),
  });
  return { payload, hash: hashContextBundlePayload(payload) };
}

export function contextSourceChanges(
  frozen: ContextSourceRevisions,
  current: ContextSourceRevisions,
) {
  return CONTEXT_SOURCE_REVISION_KEYS.filter(
    (key) => frozen[key] !== current[key],
  );
}

export function requiresContextRecompile(
  frozen: ContextSourceRevisions,
  current: ContextSourceRevisions,
) {
  return contextSourceChanges(frozen, current).length > 0;
}
