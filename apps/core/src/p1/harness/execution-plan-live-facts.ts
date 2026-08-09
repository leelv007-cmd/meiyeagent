/**
 * Production reader for ExecutionPlanSnapshot live fence facts (V31-14).
 *
 * Binds V31-12's resolveExecutionPlanLiveFacts seam to rights / quote / fact
 * heads so DBOS pre-run and mid-execution fences see real revocation and drift.
 */

import type { ExecutionPlanSnapshot, Platform } from '@meiye/contracts';
import { createHash } from 'node:crypto';

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
const IDENTITY_REVISION_REF = /^identity:(.+)@(.+)$/u;
const BRIEF_REVISION_REF = /^brief:(.+)@(.+)$/u;
const MATERIAL_FACT_KINDS = new Set(['price', 'group_buy', 'discount']);

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
  'resolveRightsHeads' | 'resolveFactHeads'
> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    async resolveRightsHeads({ workspaceId, rightsRevisionRefs }) {
      const assetIds = [...new Set(dependencies.request.intent.assetReferences)];
      const requestedPlatform =
        dependencies.request.executionPlanSnapshot?.deliverables.find(
          (deliverable) => deliverable.platform,
        )?.platform;
      const platform: Platform | undefined =
        requestedPlatform === 'xiaohongshu' || requestedPlatform === 'douyin'
          ? requestedPlatform
          : undefined;
      const rightsInput = {
        workspaceId,
        assetIds,
        ...(platform ? { platform } : {}),
      };
      if (!dependencies.rights.resolveWithRevision) return [];
      const decision = await dependencies.rights.resolveWithRevision(
        rightsInput,
      );
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
    },
    async resolveFactHeads({ workspaceId, factRevisionRefs }) {
      const heads: FactLiveHead[] = [];
      for (const frozenRevisionId of factRevisionRefs) {
        const identityMatch = IDENTITY_REVISION_REF.exec(frozenRevisionId);
        if (identityMatch) {
          const [, identityId, revision] = identityMatch;
          const active = dependencies.identities
            ? await dependencies.identities.listActive(workspaceId, now())
            : [];
          if (
            active.some(
              (identity) =>
                identity.identityId === identityId &&
                String(identity.version) === revision,
            )
          ) {
            heads.push({ frozenRevisionId, factRevisionId: frozenRevisionId });
          }
          continue;
        }
        const briefMatch = BRIEF_REVISION_REF.exec(frozenRevisionId);
        if (briefMatch) {
          const [, briefId, revision] = briefMatch;
          const brief = dependencies.request.executionSnapshot?.briefContext;
          if (
            brief !== undefined &&
            brief.id === briefId &&
            String(brief.revision) === revision
          ) {
            const scope =
              dependencies.request.factScope ?? { storeId: workspaceId };
            const frozenAt =
              dependencies.request.executionSnapshot!.createdAt;
            const [frozenFacts, currentFacts] = await Promise.all([
              dependencies.facts.listActive({
                workspaceId,
                scope,
                at: frozenAt,
              }),
              dependencies.facts.listActive({
                workspaceId,
                scope,
                at: now(),
              }),
            ]);
            const frozenMaterial = materialFactHeads(frozenFacts);
            const currentMaterial = materialFactHeads(currentFacts);
            const materialChanged = frozenMaterial !== currentMaterial;
            heads.push({
              frozenRevisionId,
              factRevisionId: materialChanged
                ? `${frozenRevisionId}:material-head:${createHash('sha256')
                    .update(currentMaterial)
                    .digest('hex')
                    .slice(0, 16)}`
                : frozenRevisionId,
              ...(materialChanged
                ? { materialPriceOrDateChanged: true }
                : {}),
            });
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
            (MATERIAL_FACT_KINDS.has(current.kind) ||
              current.expiresAt !== null),
        });
      }
      return heads;
    },
  };
}
function materialFactHeads(
  facts: Awaited<ReturnType<StoreFactLedger['listActive']>>,
) {
  return facts
    .filter(
      (fact) => MATERIAL_FACT_KINDS.has(fact.kind) || fact.expiresAt !== null,
    )
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
