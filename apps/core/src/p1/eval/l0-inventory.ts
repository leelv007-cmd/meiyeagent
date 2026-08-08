/**
 * L0 contract-test inventory (V31-23 / §31.1).
 * Inventory-only: catalogs existing seams; gaps listed for follow-up, not rebuilt.
 */

export type L0InventoryStatus = 'covered' | 'partial' | 'gap';

export type L0InventoryEntry = {
  id: string;
  area: string;
  description: string;
  status: L0InventoryStatus;
  /** Representative test or module paths (repo-relative). */
  evidence: readonly string[];
  notes?: string;
};

/**
 * Snapshot of L0 contract/deterministic coverage as of V31-23.
 * "盘点即可，缺口列清单" — do not invent new L0 suites here unless marked gap.
 */
export const L0_CONTRACT_INVENTORY: readonly L0InventoryEntry[] = [
  {
    id: 'l0.zod-agent-domain',
    area: 'schema',
    description: 'Agent-domain Zod contracts (thread/run/plan/release/…)',
    status: 'covered',
    evidence: [
      'packages/contracts/src/agent-domain.test.ts',
      'packages/contracts/src/agent-domain.ts',
    ],
  },
  {
    id: 'l0.identifiers-branded',
    area: 'schema',
    description: 'Branded identifier schemas',
    status: 'covered',
    evidence: ['packages/contracts/src/identifiers.test.ts'],
  },
  {
    id: 'l0.evidence-refs',
    area: 'evidence',
    description: 'Outcome evidence + recipe evaluation evidence lifecycle',
    status: 'covered',
    evidence: [
      'packages/contracts/src/agent-domain.test.ts',
      'apps/core/src/contracts/eval-run.test.ts',
    ],
  },
  {
    id: 'l0.fact-refs',
    area: 'facts',
    description: 'Fact satisfaction + context bundle fact refs',
    status: 'covered',
    evidence: [
      'apps/core/src/p1/harness/fact-satisfaction.ts',
      'apps/core/src/evals/fact-satisfaction/cases.ts',
      'packages/contracts/src/context-bundle.test.ts',
    ],
  },
  {
    id: 'l0.rights-refs',
    area: 'rights',
    description: 'Rights basis contract tests',
    status: 'covered',
    evidence: ['packages/contracts/src/rights-basis.test.ts'],
  },
  {
    id: 'l0.quote',
    area: 'quote',
    description: 'Product quote contracts',
    status: 'covered',
    evidence: ['packages/contracts/src/product-quote.test.ts'],
  },
  {
    id: 'l0.revision-occ',
    area: 'revision',
    description: 'Content package OCC / revision identity',
    status: 'covered',
    evidence: ['packages/contracts/src/content-package-occ.test.ts'],
  },
  {
    id: 'l0.idempotency',
    area: 'idempotency',
    description: 'Put-once registries and harness release immutability',
    status: 'covered',
    evidence: [
      'apps/core/src/p1/harness/harness-release.test.ts',
      'apps/core/src/p1/harness/eval-run-registry.test.ts',
    ],
  },
  {
    id: 'l0.interrupt-resume',
    area: 'interrupt',
    description: 'Interaction resume / hold resume paths',
    status: 'covered',
    evidence: [
      'apps/core/src/p1/harness/interaction-service.test.ts',
      'apps/core/src/p1/harness/resume-reconciler.test.ts',
    ],
  },
  {
    id: 'l0.state-patch',
    area: 'state',
    description: 'Session state machine + plan store OCC patches',
    status: 'partial',
    evidence: [
      'apps/core/src/p1/agent-session/session-harness-core.test.ts',
      'apps/core/src/p1/agent-session/postgres-plan-store.postgres.test.ts',
    ],
    notes: 'Plan OCC covered; cross-thread state patch matrix still thin.',
  },
  {
    id: 'l0.fallback',
    area: 'fallback',
    description: 'Structured node deterministic fallback signals',
    status: 'partial',
    evidence: ['apps/core/src/p1/harness/structured-nodes.test.ts'],
    notes: 'Fallback signal present; end-to-end fallback taxonomy gaps remain.',
  },
  {
    id: 'l0.billing-settlement',
    area: 'billing',
    description: 'Credit FEFO settlement + product billing settlement',
    status: 'covered',
    evidence: [
      'apps/core/src/p1/harness/product-billing-settlement.test.ts',
      'apps/core/src/p1/credit-billing/credit-plan-catalog.postgres.test.ts',
    ],
  },
  {
    id: 'l0.harness-release-pin',
    area: 'release',
    description: 'HarnessRelease publish/resolve/rollback contracts',
    status: 'covered',
    evidence: [
      'apps/core/src/p1/harness/harness-release.test.ts',
      'apps/core/src/p1/harness/postgres-harness-release.postgres.test.ts',
    ],
  },
  {
    id: 'l0.eval-layers-verdict',
    area: 'eval',
    description: 'Gates/thresholds/verdict three-state contracts (this ticket)',
    status: 'covered',
    evidence: [
      'packages/contracts/src/eval-layers.test.ts',
      'apps/core/src/p1/eval/verdict.test.ts',
    ],
  },
  {
    id: 'l0.intent-ambiguity-matrix',
    area: 'intent',
    description: 'Full Intent should-ask / high-risk assumption matrix',
    status: 'gap',
    evidence: ['apps/core/src/p1/agent-session/intent-retrieval.test.ts'],
    notes:
      'Partial unit coverage exists; L1 fixtures hold baseline cases — expand L0 matrix later.',
  },
  {
    id: 'l0.memory-cross-merchant-leak',
    area: 'memory',
    description: 'Cross-merchant memory leak constructive tests',
    status: 'gap',
    evidence: [],
    notes: 'Depends on V31-18 memory platform close-out; tracked as L0 gap.',
  },
] as const;

export function listL0Inventory(status?: L0InventoryStatus): L0InventoryEntry[] {
  if (!status) return [...L0_CONTRACT_INVENTORY];
  return L0_CONTRACT_INVENTORY.filter((entry) => entry.status === status);
}

export function listL0Gaps(): L0InventoryEntry[] {
  return listL0Inventory('gap');
}
