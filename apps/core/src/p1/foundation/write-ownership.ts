export const P1_WRITE_OWNERSHIP_TABLE = 'p1_write_ownership';
export const CONTENT_PACKAGE_WRITE_OWNERSHIP_TABLE =
  'content_package_write_ownership';

export type P1WriteOwner = 'legacy' | 'frozen' | 'p1';
export type ContentPackageWriteOwner = 'legacy' | 'frozen' | 'contentpackage';
export type WriteOwnershipSemantic = 'p1' | 'contentpackage';

export const NEW_ACCOUNT_P1_WRITE_OWNER = 'p1' as const satisfies P1WriteOwner;
export const NEW_ACCOUNT_CONTENT_PACKAGE_WRITE_OWNER =
  'contentpackage' as const satisfies ContentPackageWriteOwner;

export const WRITE_OWNERSHIP_MISSING = 'WRITE_OWNERSHIP_MISSING' as const;

export type WriteOwnershipDecision<
  TOwner extends string,
  TCode extends string,
> =
  | { decision: 'allow'; owner: TOwner; code?: never }
  | { decision: 'reject'; owner: TOwner | null; code: TCode };

export function explicitWriteOwner<T extends string>(
  owner: T | null | undefined
): T | null {
  return owner ?? null;
}

export function newAccountWriteOwnershipFacts(workspaceId: string) {
  return {
    p1: {
      table: P1_WRITE_OWNERSHIP_TABLE,
      workspaceId,
      owner: NEW_ACCOUNT_P1_WRITE_OWNER,
    },
    contentPackage: {
      table: CONTENT_PACKAGE_WRITE_OWNERSHIP_TABLE,
      workspaceId,
      owner: NEW_ACCOUNT_CONTENT_PACKAGE_WRITE_OWNER,
    },
  } as const;
}

export function writeOwnershipMissingMessage(
  semantic: WriteOwnershipSemantic
): string {
  return semantic === 'p1'
    ? 'Product write ownership is missing; an explicit p1_write_ownership row is required.'
    : 'ContentPackage write ownership is missing; an explicit content_package_write_ownership row is required.';
}

export function writeOwnershipMissingError(semantic: WriteOwnershipSemantic) {
  return {
    code: WRITE_OWNERSHIP_MISSING,
    message: writeOwnershipMissingMessage(semantic),
    semantic,
    status: 409 as const,
  };
}

export function decideP1SideEffectWrite(
  owner: P1WriteOwner | null | undefined
): WriteOwnershipDecision<
  P1WriteOwner,
  typeof WRITE_OWNERSHIP_MISSING | 'COMMANDS_FROZEN' | 'P1_WRITE_DISABLED'
> {
  const explicit = explicitWriteOwner(owner);
  if (explicit == null) {
    return {
      decision: 'reject',
      owner: null,
      code: WRITE_OWNERSHIP_MISSING,
    };
  }
  if (explicit === 'p1') return { decision: 'allow', owner: explicit };
  if (explicit === 'frozen') {
    return { decision: 'reject', owner: explicit, code: 'COMMANDS_FROZEN' };
  }
  return { decision: 'reject', owner: explicit, code: 'P1_WRITE_DISABLED' };
}

export function decideAcceptedProductWrite(
  owner: P1WriteOwner | null | undefined,
  accepted: 'legacy' | 'p1'
): WriteOwnershipDecision<
  P1WriteOwner,
  | typeof WRITE_OWNERSHIP_MISSING
  | 'COMMANDS_FROZEN'
  | 'LEGACY_WRITE_DISABLED'
  | 'P1_WRITE_DISABLED'
> {
  const explicit = explicitWriteOwner(owner);
  if (explicit == null) {
    return {
      decision: 'reject',
      owner: null,
      code: WRITE_OWNERSHIP_MISSING,
    };
  }
  if (explicit === accepted) return { decision: 'allow', owner: explicit };
  if (explicit === 'frozen') {
    return { decision: 'reject', owner: explicit, code: 'COMMANDS_FROZEN' };
  }
  return {
    decision: 'reject',
    owner: explicit,
    code:
      accepted === 'legacy' ? 'LEGACY_WRITE_DISABLED' : 'P1_WRITE_DISABLED',
  };
}

export function decideLegacyContentWrite(
  owner: ContentPackageWriteOwner | null | undefined
): WriteOwnershipDecision<
  ContentPackageWriteOwner,
  | typeof WRITE_OWNERSHIP_MISSING
  | 'CONTENT_COMMANDS_FROZEN'
  | 'LEGACY_CONTENT_READ_ONLY'
> {
  const explicit = explicitWriteOwner(owner);
  if (explicit == null) {
    return {
      decision: 'reject',
      owner: null,
      code: WRITE_OWNERSHIP_MISSING,
    };
  }
  if (explicit === 'legacy') return { decision: 'allow', owner: explicit };
  if (explicit === 'frozen') {
    return {
      decision: 'reject',
      owner: explicit,
      code: 'CONTENT_COMMANDS_FROZEN',
    };
  }
  return {
    decision: 'reject',
    owner: explicit,
    code: 'LEGACY_CONTENT_READ_ONLY',
  };
}

export function decideContentPackageCanonicalWrite(
  owner: ContentPackageWriteOwner | null | undefined
): WriteOwnershipDecision<
  ContentPackageWriteOwner,
  typeof WRITE_OWNERSHIP_MISSING | 'CONTENT_COMMANDS_FROZEN'
> {
  const explicit = explicitWriteOwner(owner);
  if (explicit == null) {
    return {
      decision: 'reject',
      owner: null,
      code: WRITE_OWNERSHIP_MISSING,
    };
  }
  if (explicit === 'frozen') {
    return {
      decision: 'reject',
      owner: explicit,
      code: 'CONTENT_COMMANDS_FROZEN',
    };
  }
  return { decision: 'allow', owner: explicit };
}

export function routeProductWriteOwner(
  owner: P1WriteOwner | null | undefined
): WriteOwnershipDecision<P1WriteOwner, typeof WRITE_OWNERSHIP_MISSING> {
  const explicit = explicitWriteOwner(owner);
  if (explicit == null) {
    return {
      decision: 'reject',
      owner: null,
      code: WRITE_OWNERSHIP_MISSING,
    };
  }
  return { decision: 'allow', owner: explicit };
}

export type WriteOwnershipWorkspaceFixture = {
  id: string;
  createdAt?: string;
};

export type ContentPackageBackfillPlan = {
  workspaceId: string;
  plannedOwner: ContentPackageWriteOwner | null;
};

export type WriteOwnershipInventory = {
  workspaces: number;
  p1Present: number;
  contentPackagePresent: number;
  missingP1: string[];
  missingContentPackage: string[];
  contentPackageBackfill: ContentPackageBackfillPlan[];
  unclassifiedContentPackage: string[];
};

export function inventoryWriteOwnership(input: {
  workspaces: readonly WriteOwnershipWorkspaceFixture[];
  p1Owners: ReadonlyMap<string, P1WriteOwner>;
  contentPackageOwners: ReadonlyMap<string, ContentPackageWriteOwner>;
  contentPackageBaselineCompletedAt?: string | null;
}): WriteOwnershipInventory {
  const missingP1: string[] = [];
  const missingContentPackage: string[] = [];
  const contentPackageBackfill: ContentPackageBackfillPlan[] = [];
  const unclassifiedContentPackage: string[] = [];
  let p1Present = 0;
  let contentPackagePresent = 0;

  for (const workspace of input.workspaces) {
    if (input.p1Owners.has(workspace.id)) p1Present += 1;
    else missingP1.push(workspace.id);

    if (input.contentPackageOwners.has(workspace.id)) {
      contentPackagePresent += 1;
      continue;
    }
    missingContentPackage.push(workspace.id);
    const plannedOwner = classifyContentPackageBackfillOwner(
      workspace.createdAt,
      input.contentPackageBaselineCompletedAt
    );
    contentPackageBackfill.push({
      workspaceId: workspace.id,
      plannedOwner,
    });
    if (plannedOwner == null) unclassifiedContentPackage.push(workspace.id);
  }

  return {
    workspaces: input.workspaces.length,
    p1Present,
    contentPackagePresent,
    missingP1,
    missingContentPackage,
    contentPackageBackfill,
    unclassifiedContentPackage,
  };
}

export function classifyContentPackageBackfillOwner(
  workspaceCreatedAt: string | undefined,
  baselineCompletedAt: string | null | undefined
): ContentPackageWriteOwner | null {
  if (!workspaceCreatedAt || !baselineCompletedAt) return null;
  return workspaceCreatedAt < baselineCompletedAt
    ? 'legacy'
    : 'contentpackage';
}

export async function insertNewAccountWriteOwnership(
  client: {
    query(sql: string, params?: readonly unknown[]): Promise<unknown>;
  },
  workspaceId: string
) {
  const facts = newAccountWriteOwnershipFacts(workspaceId);
  await client.query(
    `INSERT INTO ${facts.p1.table} (workspace_id, owner)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [facts.p1.workspaceId, facts.p1.owner]
  );
  await client.query(
    `INSERT INTO ${facts.contentPackage.table} (workspace_id, owner)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [facts.contentPackage.workspaceId, facts.contentPackage.owner]
  );
}

export class MemoryWriteOwnershipLedger {
  readonly p1 = new Map<string, P1WriteOwner>();
  readonly contentPackage = new Map<string, ContentPackageWriteOwner>();
  private failOn: WriteOwnershipSemantic | null = null;

  failNext(semantic: WriteOwnershipSemantic) {
    this.failOn = semantic;
  }

  bootstrapNewAccount(workspaceId: string) {
    const facts = newAccountWriteOwnershipFacts(workspaceId);
    const previousP1 = this.p1.get(workspaceId);
    const previousContentPackage = this.contentPackage.get(workspaceId);
    try {
      this.writeP1(workspaceId, facts.p1.owner);
      this.writeContentPackage(workspaceId, facts.contentPackage.owner);
    } catch (error) {
      if (previousP1 === undefined) this.p1.delete(workspaceId);
      else this.p1.set(workspaceId, previousP1);
      if (previousContentPackage === undefined) {
        this.contentPackage.delete(workspaceId);
      } else {
        this.contentPackage.set(workspaceId, previousContentPackage);
      }
      throw error;
    }
  }

  readP1(workspaceId: string) {
    return this.p1.get(workspaceId) ?? null;
  }

  readContentPackage(workspaceId: string) {
    return this.contentPackage.get(workspaceId) ?? null;
  }

  private writeP1(workspaceId: string, owner: P1WriteOwner) {
    if (this.failOn === 'p1') {
      this.failOn = null;
      throw new Error('p1 write ownership insert failed.');
    }
    this.p1.set(workspaceId, owner);
  }

  private writeContentPackage(
    workspaceId: string,
    owner: ContentPackageWriteOwner
  ) {
    if (this.failOn === 'contentpackage') {
      this.failOn = null;
      throw new Error('content-package write ownership insert failed.');
    }
    this.contentPackage.set(workspaceId, owner);
  }
}

export const WRITE_OWNERSHIP_BACKFILL_SQL = {
  countCheck: `
SELECT
  (SELECT count(*) FROM workspaces) AS workspaces,
  (SELECT count(*) FROM p1_write_ownership) AS p1_present,
  (SELECT count(*) FROM content_package_write_ownership) AS content_package_present,
  (SELECT count(*) FROM workspaces w
     LEFT JOIN p1_write_ownership o ON o.workspace_id = w.id
    WHERE o.workspace_id IS NULL) AS missing_p1,
  (SELECT count(*) FROM workspaces w
     LEFT JOIN content_package_write_ownership o ON o.workspace_id = w.id
    WHERE o.workspace_id IS NULL) AS missing_content_package;
`,
  inventory: `
CREATE TABLE IF NOT EXISTS write_ownership_backfill_audit (
  audit_id bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  batch_id text NOT NULL,
  workspace_id text NOT NULL,
  table_name text NOT NULL
    CHECK (table_name IN ('p1_write_ownership', 'content_package_write_ownership')),
  planned_owner text NOT NULL
    CHECK (planned_owner IN ('legacy', 'frozen', 'p1', 'contentpackage', 'unclassified')),
  action text NOT NULL
    CHECK (action IN ('inventory', 'applied', 'rolled_back'))
);

INSERT INTO write_ownership_backfill_audit (
  batch_id, workspace_id, table_name, planned_owner, action
)
SELECT
  $1,
  w.id,
  'p1_write_ownership',
  'legacy',
  'inventory'
FROM workspaces w
LEFT JOIN p1_write_ownership o ON o.workspace_id = w.id
WHERE o.workspace_id IS NULL;

INSERT INTO write_ownership_backfill_audit (
  batch_id, workspace_id, table_name, planned_owner, action
)
SELECT
  $1,
  w.id,
  'content_package_write_ownership',
  CASE
    WHEN b.completed_at IS NULL OR w.created_at IS NULL THEN 'unclassified'
    WHEN w.created_at < b.completed_at THEN 'legacy'
    ELSE 'contentpackage'
  END,
  'inventory'
FROM workspaces w
LEFT JOIN content_package_write_ownership o ON o.workspace_id = w.id
LEFT JOIN content_package_write_ownership_migrations b
  ON b.id = 'legacy-baseline-v1'
WHERE o.workspace_id IS NULL;
`,
  apply: `
BEGIN;

INSERT INTO p1_write_ownership (workspace_id, owner)
SELECT workspace_id, planned_owner
FROM write_ownership_backfill_audit
WHERE batch_id = $1
  AND action = 'inventory'
  AND table_name = 'p1_write_ownership'
  AND planned_owner = 'legacy'
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO content_package_write_ownership (workspace_id, owner)
SELECT workspace_id, planned_owner
FROM write_ownership_backfill_audit
WHERE batch_id = $1
  AND action = 'inventory'
  AND table_name = 'content_package_write_ownership'
  AND planned_owner IN ('legacy', 'contentpackage')
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO write_ownership_backfill_audit (
  batch_id, workspace_id, table_name, planned_owner, action
)
SELECT batch_id, workspace_id, table_name, planned_owner, 'applied'
FROM write_ownership_backfill_audit
WHERE batch_id = $1
  AND action = 'inventory'
  AND planned_owner <> 'unclassified';

SELECT
  (SELECT count(*) FROM write_ownership_backfill_audit
    WHERE batch_id = $1 AND action = 'inventory'
      AND table_name = 'p1_write_ownership') AS inventoried_p1,
  (SELECT count(*) FROM write_ownership_backfill_audit
    WHERE batch_id = $1 AND action = 'applied'
      AND table_name = 'p1_write_ownership') AS applied_p1,
  (SELECT count(*) FROM write_ownership_backfill_audit
    WHERE batch_id = $1 AND action = 'inventory'
      AND table_name = 'content_package_write_ownership'
      AND planned_owner <> 'unclassified') AS inventoried_content_package,
  (SELECT count(*) FROM write_ownership_backfill_audit
    WHERE batch_id = $1 AND action = 'applied'
      AND table_name = 'content_package_write_ownership') AS applied_content_package,
  (SELECT count(*) FROM write_ownership_backfill_audit
    WHERE batch_id = $1 AND action = 'inventory'
      AND planned_owner = 'unclassified') AS unclassified_left_fail_closed;

COMMIT;
`,
  rollback: `
BEGIN;

DELETE FROM p1_write_ownership AS ownership
USING write_ownership_backfill_audit AS audit
WHERE audit.batch_id = $1
  AND audit.action = 'applied'
  AND audit.table_name = 'p1_write_ownership'
  AND ownership.workspace_id = audit.workspace_id
  AND ownership.owner = audit.planned_owner;

DELETE FROM content_package_write_ownership AS ownership
USING write_ownership_backfill_audit AS audit
WHERE audit.batch_id = $1
  AND audit.action = 'applied'
  AND audit.table_name = 'content_package_write_ownership'
  AND ownership.workspace_id = audit.workspace_id
  AND ownership.owner = audit.planned_owner;

INSERT INTO write_ownership_backfill_audit (
  batch_id, workspace_id, table_name, planned_owner, action
)
SELECT batch_id, workspace_id, table_name, planned_owner, 'rolled_back'
FROM write_ownership_backfill_audit
WHERE batch_id = $1 AND action = 'applied';

COMMIT;
`,
} as const;
