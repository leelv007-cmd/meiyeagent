/**
 * Production reader for ExecutionPlanSnapshot live fence facts (V31-14).
 *
 * Binds V31-12's resolveExecutionPlanLiveFacts seam to rights / quote / fact
 * heads so DBOS pre-run and mid-execution fences see real revocation and drift.
 */

import type { ExecutionPlanSnapshot } from '@meiye/contracts';

import type { SnapshotLiveFacts } from './execution-plan-admission.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export type RightsLiveHead = {
  /** Frozen ref used to look up a head whose current revision has advanced. */
  frozenRevisionId?: string;
  revisionId: string;
  revoked: boolean;
};

export type QuoteLiveHead = {
  quoteId: string;
  revision: number | string;
};

export type FactLiveHead = {
  factRevisionId: string;
  /** When set, fact payload carries price/date material change vs freeze. */
  materialPriceOrDateChanged?: boolean;
};

export type ExecutionPlanLiveFactsPorts = {
  /**
   * Resolve live rights heads for freeze rightsRevisionRefs.
   * Missing refs are treated as revoked (fail closed).
   */
  resolveRightsHeads?(input: {
    workspaceId: string;
    rightsRevisionRefs: readonly string[];
    snapshot: ExecutionPlanSnapshot;
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

  if (ports.resolveQuoteHead) {
    const quote = await ports.resolveQuoteHead({
      workspaceId,
      quoteId: snapshot.quoteRef.id,
    });
    if (quote) {
      live.quoteRevision = quote.revision;
    }
  }

  if (ports.resolveRightsHeads && snapshot.rightsRevisionRefs.length > 0) {
    const heads = await ports.resolveRightsHeads({
      workspaceId,
      rightsRevisionRefs: snapshot.rightsRevisionRefs,
      snapshot,
    });
    const headById = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.revisionId, head]),
    );
    const liveRefs: string[] = [];
    let revoked = false;
    for (const ref of snapshot.rightsRevisionRefs) {
      const head = headById.get(ref);
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

  if (ports.resolveFactHeads && snapshot.factRevisionRefs.length > 0) {
    const heads = await ports.resolveFactHeads({
      workspaceId,
      factRevisionRefs: snapshot.factRevisionRefs,
    });
    live.factRevisionRefs = heads.map((h) => h.factRevisionId);
    if (heads.some((h) => h.materialPriceOrDateChanged === true)) {
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
