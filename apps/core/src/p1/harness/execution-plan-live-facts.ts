/**
 * Production reader for ExecutionPlanSnapshot live fence facts (V31-14).
 *
 * Binds V31-12's resolveExecutionPlanLiveFacts seam to rights / quote / fact
 * heads so DBOS pre-run and mid-execution fences see real revocation and drift.
 */

import {
  asRightsPlatform,
  type ExecutionPlanSnapshot,
  type Platform,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';

import { isOfficialNeutralIdentity } from '../execution-spine/creation-execution-snapshot.js';
import type { MarketingIdentityRepository } from '../operations/marketing-identity.js';
import {
  isStoreFactActive,
  type StoreFactLedger,
} from '../operations/store-fact-ledger.js';
import type { SnapshotLiveFacts } from './execution-plan-admission.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export type RightsLiveHead = {
  /** Frozen coordinate this authoritative lookup answered. */
  frozenRevisionId?: string;
  revisionId: string;
  revoked: boolean;
};

export type QuoteLiveHead = {
  quoteId: string;
  revision: number | string;
};

export type FactLiveHead = {
  /** Frozen coordinate this authoritative lookup answered. */
  frozenRevisionId?: string;
  factRevisionId: string;
  /** When set, fact payload carries price/date material change vs freeze. */
  materialPriceOrDateChanged?: boolean;
};

export type AuthoritativeExecutionPlanLiveFactsDependencies = {
  facts: Pick<StoreFactLedger, 'history' | 'listActive'>;
  identities?: Pick<MarketingIdentityRepository, 'listActive'>;
  request: HarnessWorkflowInput;
  rights: {
    resolve(input: {
      workspaceId: string;
      assetIds: string[];
      platform?: Platform;
    }): Promise<{
      knownAssetIds?: string[];
      unauthorizedAssetIds: string[];
    }>;
    resolveWithRevision?(input: {
      workspaceId: string;
      assetIds: string[];
      platform?: Platform;
    }): Promise<{
      knownAssetIds?: string[];
      rightsRevision: string;
      unauthorizedAssetIds: string[];
    }>;
  };
  now?: () => string;
};

const STORE_FACT_REVISION_REF = /^store_fact:(.+):(\d+)$/u;
/**
 * Canonical freeze coords plus optional live baselining suffixes produced when
 * a prior fence refresh rewrote factRevisionRefs from live heads:
 * - identity:…@rev:identity-head:N
 * - brief:…@rev:material-head:<16-hex>
 * Without parsing the suffix, reconfirm freezes those live ids and the next
 * admit permanently sees unresolved fact heads → infinite reconfirm (§37.4-E).
 */
const IDENTITY_REVISION_REF =
  /^identity:([^@]+)@([^:]+?)(?::identity-head:(.+))?$/u;
const BRIEF_REVISION_REF =
  /^brief:([^@]+)@([^:]+?)(?::material-head:([a-f0-9]{16}))?$/u;
const MATERIAL_FACT_KINDS = new Set(['price', 'group_buy', 'discount']);

/**
 * The facts §37.4-E is about: a price/promotion value, or anything carrying a
 * validity window. The freeze side (composer-submission-gate binds these as
 * `store_fact:<id>:<rev>` so admission has something to compare) and the drift
 * side (materialFactHeads below) must agree on this set, so both read it here.
 */
export function isMaterialStoreFact(fact: {
  kind: string;
  expiresAt: string | null;
}): boolean {
  return MATERIAL_FACT_KINDS.has(fact.kind) || fact.expiresAt !== null;
}

function materialHeadHash(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * Data sources for authoritative fact/context head resolution. Extracted from
 * AuthoritativeExecutionPlanLiveFactsDependencies so V31-63's transaction-aware
 * successor rebuild can resolve the same head semantics on transaction-bound
 * fact reads without dragging the rights port along.
 */
export type AuthoritativeFactHeadSources = {
  facts: Pick<StoreFactLedger, 'history' | 'listActive'>;
  identities?: Pick<MarketingIdentityRepository, 'listActive'>;
  request: HarnessWorkflowInput;
  now?: () => string;
};

export type AuthoritativeRightsHeadSources = Pick<
  AuthoritativeExecutionPlanLiveFactsDependencies,
  'request' | 'rights'
>;

/**
 * Production rights/fact head adapter. Rights are re-authorized against the
 * Product asset repository; store_fact refs are resolved from the append-only
 * ledger. Unknown coordinates return no head and are therefore fail-closed by
 * resolveExecutionPlanLiveFactsFromPorts.
 */
export function createAuthoritativeExecutionPlanLiveFactsPorts(
  dependencies: AuthoritativeExecutionPlanLiveFactsDependencies,
): Pick<
  ExecutionPlanLiveFactsPorts,
  'resolveRightsHeads' | 'resolveFactHeads' | 'resolveAuthorityHeads'
> {
  const resolveFactHeads = createAuthoritativeFactHeadResolver(dependencies);
  return {
    resolveRightsHeads: createAuthoritativeRightsHeadResolver(dependencies),
    resolveFactHeads,
    resolveAuthorityHeads: ({ workspaceId, authorityRevisionRefs }) =>
      resolveFactHeads({
        workspaceId,
        factRevisionRefs: authorityRevisionRefs,
      }),
  };
}

export function createAuthoritativeRightsHeadResolver(
  dependencies: AuthoritativeRightsHeadSources,
): NonNullable<ExecutionPlanLiveFactsPorts['resolveRightsHeads']> {
  return async ({ workspaceId, rightsRevisionRefs }) => {
    const assetIds = [...new Set(dependencies.request.intent.assetReferences)];
    const requestedPlatform =
      dependencies.request.executionPlanSnapshot?.deliverables.find(
        (deliverable) => deliverable.platform,
      )?.platform ??
      dependencies.request.pendingExecutionPlanSnapshot?.content.deliverables.find(
        (deliverable) => deliverable.platform,
      )?.platform;
    const platform: Platform | undefined = asRightsPlatform(requestedPlatform);
    const rightsInput = {
      workspaceId,
      assetIds,
      ...(platform ? { platform } : {}),
    };
    if (!dependencies.rights.resolveWithRevision) return [];
    const decision = await dependencies.rights.resolveWithRevision(rightsInput);
    const currentRevision = decision.rightsRevision;
    const known = new Set(decision.knownAssetIds ?? []);
    const unauthorized = new Set(decision.unauthorizedAssetIds);
    const revoked = assetIds.some(
      (assetId) => !known.has(assetId) || unauthorized.has(assetId),
    );
    return rightsRevisionRefs.map((frozenRevisionId) => ({
      frozenRevisionId,
      revisionId: currentRevision,
      revoked,
    }));
  };
}

/**
 * Authoritative fact/context head resolver over the given fact/identity
 * sources. The gate's admission fence uses it pool-bound (via
 * createAuthoritativeExecutionPlanLiveFactsPorts); the V31-63 repriced
 * successor rebuild uses it with transaction-bound fact reads so the
 * successor's baseline comes from heads current inside its own admission
 * transaction.
 */
export function createAuthoritativeFactHeadResolver(
  dependencies: AuthoritativeFactHeadSources,
): NonNullable<ExecutionPlanLiveFactsPorts['resolveFactHeads']> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return async ({ workspaceId, factRevisionRefs }) => {
      const heads: FactLiveHead[] = [];
      for (const frozenRevisionId of factRevisionRefs) {
        const identityMatch = IDENTITY_REVISION_REF.exec(frozenRevisionId);
        if (identityMatch) {
          const [, identityId, revision, baselinedHeadVersion] = identityMatch;
          const baseRef = `identity:${identityId}@${revision}`;
          if (
            isOfficialNeutralIdentity({
              id: identityId!,
              revision: revision!,
            })
          ) {
            heads.push({ frozenRevisionId, factRevisionId: frozenRevisionId });
            continue;
          }
          const identitySourceAvailable = dependencies.identities !== undefined;
          const active = dependencies.identities
            ? await dependencies.identities.listActive(workspaceId, now())
            : [];
          const sameIdentity = active.find(
            (identity) => identity.identityId === identityId,
          );
          if (baselinedHeadVersion !== undefined) {
            // Reconfirm freeze already baselined to an identity head. Stay
            // current while the live version still matches that head.
            if (
              sameIdentity &&
              String(sameIdentity.version) === baselinedHeadVersion
            ) {
              heads.push({
                frozenRevisionId,
                factRevisionId: frozenRevisionId,
              });
            } else if (sameIdentity) {
              heads.push({
                frozenRevisionId,
                factRevisionId: `${baseRef}:identity-head:${sameIdentity.version}`,
                materialPriceOrDateChanged: true,
              });
            } else if (baselinedHeadVersion === 'missing') {
              heads.push({
                frozenRevisionId,
                factRevisionId: frozenRevisionId,
              });
            } else if (identitySourceAvailable) {
              heads.push({
                frozenRevisionId,
                factRevisionId: `${baseRef}:identity-head:missing`,
                materialPriceOrDateChanged: true,
              });
            } else {
              heads.push({
                frozenRevisionId,
                factRevisionId: frozenRevisionId,
              });
            }
            continue;
          }
          const matched = active.find(
            (identity) =>
              identity.identityId === identityId &&
              String(identity.version) === revision,
          );
          if (sameIdentity && !matched) {
            // A genuinely resolved value that differs from the frozen one —
            // the only case this ref can actually detect as drift.
            heads.push({
              frozenRevisionId,
              factRevisionId: `${baseRef}:identity-head:${sameIdentity.version}`,
              materialPriceOrDateChanged: true,
            });
          } else if (!sameIdentity && identitySourceAvailable) {
            heads.push({
              frozenRevisionId,
              factRevisionId: `${baseRef}:identity-head:missing`,
              materialPriceOrDateChanged: true,
            });
          } else {
            // Either the exact identity matches, or this legacy caller did not
            // wire an identity source. A wired source with no active match is
            // handled above as a material missing head.
            heads.push({ frozenRevisionId, factRevisionId: frozenRevisionId });
          }
          continue;
        }
        const briefMatch = BRIEF_REVISION_REF.exec(frozenRevisionId);
        if (briefMatch) {
          const [, briefId, revision, baselinedMaterialHead] = briefMatch;
          const brief = dependencies.request.executionSnapshot?.briefContext;
          if (
            brief !== undefined &&
            brief.id === briefId &&
            String(brief.revision) === revision
          ) {
            const scope =
              dependencies.request.factScope ?? { storeId: workspaceId };
            const baseRef = `brief:${briefId}@${revision}`;
            const currentFacts = await dependencies.facts.listActive({
              workspaceId,
              scope,
              at: now(),
            });
            const currentMaterial = materialFactHeads(currentFacts);
            const currentHead = materialHeadHash(currentMaterial);
            if (baselinedMaterialHead !== undefined) {
              // Live material-head ids are what refreshLiveBindings freezes
              // after the first drift. Matching head → reconfirm can admit;
              // a new head → another reconfirm (not an infinite same-head loop).
              if (baselinedMaterialHead === currentHead) {
                heads.push({
                  frozenRevisionId,
                  factRevisionId: frozenRevisionId,
                });
              } else {
                heads.push({
                  frozenRevisionId,
                  factRevisionId: `${baseRef}:material-head:${currentHead}`,
                  materialPriceOrDateChanged: true,
                });
              }
            } else {
              const frozenAt =
                dependencies.request.executionSnapshot!.createdAt;
              const frozenFacts = await dependencies.facts.listActive({
                workspaceId,
                scope,
                at: frozenAt,
              });
              const frozenMaterial = materialFactHeads(frozenFacts);
              const materialChanged = frozenMaterial !== currentMaterial;
              heads.push({
                frozenRevisionId,
                factRevisionId: materialChanged
                  ? `${baseRef}:material-head:${currentHead}`
                  : frozenRevisionId,
                ...(materialChanged
                  ? { materialPriceOrDateChanged: true }
                  : {}),
              });
            }
          }
          continue;
        }
        const match = STORE_FACT_REVISION_REF.exec(frozenRevisionId);
        if (!match) continue;
        const [, factId, frozenRevisionText] = match;
        if (!factId || !frozenRevisionText) continue;
        const history = await dependencies.facts.history(workspaceId, factId);
        const current = history
          .filter((fact) => Date.parse(fact.effectiveFrom) <= Date.parse(now()))
          .sort((left, right) => right.revision - left.revision)[0];
        if (!current || !isStoreFactActive(current, now())) continue;
        const frozenRevision = Number(frozenRevisionText);
        heads.push({
          frozenRevisionId,
          factRevisionId: `store_fact:${factId}:${current.revision}`,
          materialPriceOrDateChanged:
            current.revision !== frozenRevision &&
            isMaterialStoreFact(current),
        });
      }
      return heads;
  };
}
function materialFactHeads(
  facts: Awaited<ReturnType<StoreFactLedger['listActive']>>,
) {
  return facts
    .filter((fact) => isMaterialStoreFact(fact))
    .map((fact) => `${fact.factId}:${fact.revision}:${fact.expiresAt ?? ''}`)
    .sort()
    .join('|');
}

export type ExecutionPlanLiveFactsPorts = {
  /**
   * Resolve live rights heads for freeze rightsRevisionRefs.
   * Missing refs are treated as revoked (fail closed).
   */
  resolveRightsHeads?(input: {
    workspaceId: string;
    rightsRevisionRefs: readonly string[];
    /** Frozen plan coordinate, for adapters that re-read the plan revision. */
    snapshot?: ExecutionPlanSnapshot;
  }): Promise<readonly RightsLiveHead[]>;
  resolveQuoteHead?(input: {
    workspaceId: string;
    quoteId: string;
  }): Promise<QuoteLiveHead | null>;
  resolveFactHeads?(input: {
    workspaceId: string;
    factRevisionRefs: readonly string[];
  }): Promise<readonly FactLiveHead[]>;
  resolveAuthorityHeads?(input: {
    workspaceId: string;
    authorityRevisionRefs: readonly string[];
  }): Promise<readonly FactLiveHead[]>;
};

/**
 * Build SnapshotLiveFacts from freeze + live ports.
 * Pure aggregation — ports own IO.
 */
export async function resolveExecutionPlanLiveFactsFromPorts(input: {
  snapshot: ExecutionPlanSnapshot;
  workspaceId: string;
  ports: ExecutionPlanLiveFactsPorts;
}): Promise<SnapshotLiveFacts> {
  const { snapshot, workspaceId, ports } = input;
  const live: SnapshotLiveFacts = {};

  const quote = ports.resolveQuoteHead
    ? await ports
        .resolveQuoteHead({ workspaceId, quoteId: snapshot.quoteRef.id })
        .catch(() => null)
    : null;
  if (quote && quote.quoteId === snapshot.quoteRef.id) {
    live.quoteRevision = quote.revision;
  } else {
    live.quoteRevision = `unresolved:${snapshot.quoteRef.id}`;
    live.quoteMissing = true;
  }

  if (snapshot.rightsRevisionRefs.length > 0) {
    const heads = ports.resolveRightsHeads
      ? await ports
          .resolveRightsHeads({
            workspaceId,
            rightsRevisionRefs: snapshot.rightsRevisionRefs,
            snapshot,
          })
          .catch(() => [])
      : [];
    const headByFrozenRef = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.revisionId, head]),
    );
    const liveRefs: string[] = [];
    let revoked = false;
    for (const ref of snapshot.rightsRevisionRefs) {
      const head = headByFrozenRef.get(ref);
      if (!head || head.revoked) {
        revoked = true;
        continue;
      }
      liveRefs.push(head.revisionId);
    }
    live.rightsRevisionRefs = liveRefs;
    if (revoked || liveRefs.length !== snapshot.rightsRevisionRefs.length) {
      live.rightsRevoked = true;
    }
  }

  if (snapshot.factRevisionRefs.length > 0) {
    const heads = ports.resolveFactHeads
      ? await ports
          .resolveFactHeads({
            workspaceId,
            factRevisionRefs: snapshot.factRevisionRefs,
          })
          .catch(() => [])
      : [];
    const headByFrozenRef = new Map(
      heads.map((head) => [
        head.frozenRevisionId ?? head.factRevisionId,
        head,
      ]),
    );
    live.factRevisionRefs = snapshot.factRevisionRefs.flatMap((ref) => {
      const head = headByFrozenRef.get(ref);
      return head ? [head.factRevisionId] : [];
    });
    if (
      live.factRevisionRefs.length !== snapshot.factRevisionRefs.length ||
      heads.some((h) => h.materialPriceOrDateChanged === true)
    ) {
      live.contextDrifted = true;
    }
  }

  if ((snapshot.authorityRevisionRefs?.length ?? 0) > 0) {
    const frozenAuthorityRefs = snapshot.authorityRevisionRefs ?? [];
    const heads = ports.resolveAuthorityHeads
      ? await ports
          .resolveAuthorityHeads({
            workspaceId,
            authorityRevisionRefs: frozenAuthorityRefs,
          })
          .catch(() => [])
      : [];
    const headByFrozenRef = new Map(
      heads.map((head) => [
        head.frozenRevisionId ?? head.factRevisionId,
        head,
      ]),
    );
    live.authorityRevisionRefs = frozenAuthorityRefs.flatMap((ref) => {
      const head = headByFrozenRef.get(ref);
      return head ? [head.factRevisionId] : [];
    });
    if (
      live.authorityRevisionRefs.length !== frozenAuthorityRefs.length ||
      heads.some((head) => head.materialPriceOrDateChanged === true)
    ) {
      live.contextDrifted = true;
    }
  }

  return live;
}

/**
 * DBOS option callback factory — plugs into registerHarnessDbosWorkflow.
 */
export function createResolveExecutionPlanLiveFacts(
  ports: ExecutionPlanLiveFactsPorts,
): (input: {
  workflowId: string;
  request: HarnessWorkflowInput;
}) => Promise<SnapshotLiveFacts | undefined> {
  return async ({ request }) => {
    const snapshot = request.executionPlanSnapshot;
    if (!snapshot) return undefined;
    return resolveExecutionPlanLiveFactsFromPorts({
      snapshot,
      workspaceId: request.workspaceId,
      ports,
    });
  };
}
