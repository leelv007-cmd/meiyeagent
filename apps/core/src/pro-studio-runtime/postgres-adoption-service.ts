import { contentPackageSchema, type ContentPackage } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import {
  buildContentPackage,
  transitionContentPackage,
} from '../p1/operations/content-package.js';
import { revisionConflictAuditId } from '../p1/operations/repository.js';
import type {
  AdvancedCanvasAdoptionCommand,
  AdvancedCanvasAdoptionContext,
  AdvancedCanvasAdoptionResult,
} from './adoption.js';
import {
  AdvancedCanvasAdoptionError,
  adoptionPayloadHash,
  assertAdoptionTarget,
  assertDraftVersion,
  createAdoptionAuditDetails,
  createAdoptionIdentity,
  createAdoptionResult,
  createAdoptionRevisionId,
  postgresAdoptionRuleProfile,
  resolveAdoptionSelection,
  resolveIdempotencyReplay,
  sameAdoptionSelection,
  validateAdoptionCommand,
} from './adoption-rules.js';
import {
  readCanvasGenerationOrigin,
  type CanvasGenerationWorkspaceState,
} from './generation-runtime.js';

interface ProjectGraph {
  schemaVersion: 1;
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
  }>;
  edges: unknown[];
}

interface RevisionRow {
  id: string;
  graph: ProjectGraph;
  draft_version: string | number;
}

interface AdoptionReceipt {
  idempotencyKey: string;
  payloadHash: string;
  result: AdvancedCanvasAdoptionResult;
}

interface AdoptionState {
  receipts: AdoptionReceipt[];
}

type CanvasGenerationJobLike = CanvasGenerationWorkspaceState['jobs'][number];

export class PostgresAdvancedCanvasAdoptionService {
  constructor(
    private readonly pool: Pool,
    private readonly options: { clock?: () => Date } = {}
  ) {}

  async adopt(
    context: AdvancedCanvasAdoptionContext,
    command: AdvancedCanvasAdoptionCommand
  ): Promise<AdvancedCanvasAdoptionResult> {
    validateAdoptionCommand(command, postgresAdoptionRuleProfile);
    const payloadHash = adoptionPayloadHash(command, postgresAdoptionRuleProfile);
    const client = await this.pool.connect();
    let revisionConflict:
      | { currentRevision: number; expectedRevision: number; packageId: string }
      | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        context.workspaceId,
      ]);
      await this.assertMembership(client, context);
      const state = await this.lockState(client, context.workspaceId);
      const replay = resolveIdempotencyReplay(
        state.receipts,
        command.idempotencyKey,
        payloadHash
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      const revision = await this.resolveRevision(client, context, command);
      const selection = await this.resolveSelection(
        client,
        context.workspaceId,
        command,
        revision
      );
      const identity = createAdoptionIdentity(
        command,
        revision.id,
        postgresAdoptionRuleProfile
      );
      const existing = await this.findExistingAdoption(
        client,
        context.workspaceId,
        command,
        revision.id
      );
      if (existing) {
        state.receipts.push({
          idempotencyKey: command.idempotencyKey,
          payloadHash,
          result: existing,
        });
        await this.saveState(client, context.workspaceId, state);
        await client.query('COMMIT');
        return existing;
      }

      const timestamp = this.now().toISOString();
      const packageRow = await client.query<{
        payload: ContentPackage;
        revision: string;
      }>(
        `SELECT payload, revision::text AS revision
         FROM p1_content_packages
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [context.workspaceId, identity.packageId]
      );
      const packageRowValue = packageRow.rows[0];
      const current = packageRowValue?.payload
        ? contentPackageSchema.parse(packageRowValue.payload)
        : null;
      if (
        current &&
        current.revision !== Number(packageRowValue?.revision)
      ) {
        throw new Error(
          `ContentPackage ${current.id} revision column does not match its payload.`,
        );
      }
      assertAdoptionTarget(
        current
          ? {
              kind: current.kind,
              currentVersionId: current.currentVersionId ?? '',
            }
          : null,
        command,
        selection.kind
      );
      if (current && command.target.kind === 'existing_package') {
        if (current.revision !== command.target.expectedRevision) {
          revisionConflict = {
            currentRevision: current.revision,
            expectedRevision: command.target.expectedRevision,
            packageId: current.id,
          };
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_PACKAGE_REVISION_CONFLICT',
            `ContentPackage revision changed from ${command.target.expectedRevision} to ${current.revision}. Refresh and retry.`,
            revisionConflict,
          );
        }
      }

      const version = {
        body: selection.body ?? '',
        createdAt: timestamp,
        createdBy: context.userId,
        id: identity.versionId,
        orderedAssetIds: selection.orderedAssetIds,
        sourceRef: {
          advancedCanvas: {
            orderedMediaNodeIds: [...command.selection.orderedMediaNodeIds],
            projectId: command.projectId,
            revisionId: revision.id,
            schemaVersion: 1 as const,
            selectedNodeIds: selection.selectedNodeIds,
          },
        },
        title:
          selection.kind === 'video' ? 'Pro Studio video' : 'Pro Studio output',
        topics: [],
      };
      const childRunIds = new Set(
        current?.generated.childRuns.map((run) => run.runId) ?? []
      );
      const newChildRuns = selection.childJobIds.flatMap((runId) => {
        if (childRunIds.has(runId)) return [];
        childRunIds.add(runId);
        return [
          {
            runId,
            runType: 'model_job' as const,
            status: 'succeeded' as const,
            assetIds: selection.jobAssetIds.get(runId) ?? [],
          },
        ];
      });
      const contentPackage = current
        ? contentPackageSchema.parse({
            ...current,
            currentVersionId: identity.versionId,
            generated: {
              ...current.generated,
              childRuns: [...current.generated.childRuns, ...newChildRuns],
            },
            revision: current.revision + 1,
            source: {
              ...current.source,
              assetIds: unique([
                ...current.source.assetIds,
                ...selection.sourceAssetIds,
                ...selection.orderedAssetIds,
              ]),
            },
            updatedAt: timestamp,
            versions: [...current.versions, version],
          })
        : transitionContentPackage(
            {
              ...buildContentPackage({
                id: identity.packageId,
                kind: selection.kind,
                source: {
                  assetIds: unique([
                    ...selection.sourceAssetIds,
                    ...selection.orderedAssetIds,
                  ]),
                },
                sourceRef: version.sourceRef,
                timestamp,
                workspaceId: context.workspaceId,
              }),
              generated: {
                assetIds: [...selection.orderedAssetIds],
                childRuns: newChildRuns,
              },
            },
            { type: 'adopted', version },
            timestamp
          );
      if (current && command.target.kind === 'existing_package') {
        const updated = await client.query(
          `UPDATE p1_content_packages
              SET payload = $3::jsonb,
                  revision = $4,
                  updated_at = $5
            WHERE workspace_id = $1
              AND id = $2
              AND revision = $6`,
          [
            context.workspaceId,
            identity.packageId,
            contentPackage,
            contentPackage.revision,
            timestamp,
            command.target.expectedRevision,
          ],
        );
        if (updated.rowCount !== 1) {
          const observed = await client.query<{ revision: string }>(
            `SELECT revision::text AS revision
               FROM p1_content_packages
              WHERE workspace_id = $1 AND id = $2`,
            [context.workspaceId, identity.packageId],
          );
          revisionConflict = {
            currentRevision: Number(observed.rows[0]?.revision ?? -1),
            expectedRevision: command.target.expectedRevision,
            packageId: identity.packageId,
          };
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_PACKAGE_REVISION_CONFLICT',
            'ContentPackage changed during Pro Studio adoption.',
            revisionConflict,
          );
        }
      } else {
        await client.query(
          `INSERT INTO p1_content_packages
             (workspace_id, id, payload, revision, updated_at)
           VALUES ($1, $2, $3::jsonb, 0, $4)`,
          [context.workspaceId, identity.packageId, contentPackage, timestamp],
        );
      }

      const result = createAdoptionResult(
        command,
        revision.id,
        identity,
        selection.selectedNodeIds
      );
      state.receipts.push({
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        result,
      });
      await client.query(
        `INSERT INTO pro_studio_audit_events
         (workspace_id, action, project_id, actor_id, detail, created_at)
         VALUES ($1, 'adopt_advanced_canvas_output', $2, $3, $4, $5)`,
        [
          context.workspaceId,
          command.projectId,
          context.userId,
          createAdoptionAuditDetails(context, result),
          timestamp,
        ]
      );
      await this.saveState(client, context.workspaceId, state);
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) {
      await client.query('ROLLBACK');
      if (revisionConflict) {
        await this.recordRevisionConflict(
          client,
          context,
          revisionConflict,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordRevisionConflict(
    client: PoolClient,
    context: AdvancedCanvasAdoptionContext,
    conflict: {
      currentRevision: number;
      expectedRevision: number;
      packageId: string;
    },
  ) {
    const occurredAt = this.now().toISOString();
    const id = revisionConflictAuditId({
      correlationId: context.correlationId,
      expectedRevision: conflict.expectedRevision,
      packageId: conflict.packageId,
    });
    const event = {
      action: 'content_package.revision_conflict',
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: occurredAt,
      details: {
        correlationId: context.correlationId,
        currentRevision: conflict.currentRevision,
        expectedRevision: conflict.expectedRevision,
      },
      entityId: conflict.packageId,
      entityType: 'content_package',
      id,
      workspaceId: context.workspaceId,
    };
    await client.query(
      `INSERT INTO p1_operations_audit_events
         (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [context.workspaceId, id, event, occurredAt],
    );
  }

  async listAdoptions(
    context: AdvancedCanvasAdoptionContext,
    projectId: string
  ) {
    const client = await this.pool.connect();
    try {
      await this.assertMembership(client, context);
      return this.listPackageAdoptions(client, context.workspaceId, projectId);
    } finally {
      client.release();
    }
  }

  private async assertMembership(
    client: PoolClient,
    context: AdvancedCanvasAdoptionContext
  ) {
    const membership = await client.query(
      `SELECT 1 FROM workspace_memberships
       WHERE workspace_id = $1 AND user_id = $2`,
      [context.workspaceId, context.userId]
    );
    if (membership.rowCount !== 1) {
      throw new AdvancedCanvasAdoptionError(
        'WORKSPACE_FORBIDDEN',
        'Workspace membership is required.'
      );
    }
  }

  private async lockState(client: PoolClient, workspaceId: string) {
    const empty: AdoptionState = { receipts: [] };
    await client.query(
      `INSERT INTO pro_studio_workspace_state
       (namespace, workspace_id, state, updated_at)
       VALUES ('adoption_v1', $1, $2, now())
       ON CONFLICT (namespace, workspace_id) DO NOTHING`,
      [workspaceId, empty]
    );
    const locked = await client.query<{ state: AdoptionState }>(
      `SELECT state FROM pro_studio_workspace_state
       WHERE namespace = 'adoption_v1' AND workspace_id = $1
       FOR UPDATE`,
      [workspaceId]
    );
    return {
      receipts: structuredClone(locked.rows[0]?.state.receipts ?? []),
    };
  }

  private async findExistingAdoption(
    client: PoolClient,
    workspaceId: string,
    command: AdvancedCanvasAdoptionCommand,
    revisionId: string
  ) {
    const selectedNodeIds = [
      ...(command.selection.textNodeId ? [command.selection.textNodeId] : []),
      ...command.selection.orderedMediaNodeIds,
    ];
    return (
      await this.listPackageAdoptions(client, workspaceId, command.projectId)
    ).find((candidate) =>
      sameAdoptionSelection(
        candidate,
        revisionId,
        selectedNodeIds,
        command.selection.orderedMediaNodeIds
      )
    );
  }

  private async listPackageAdoptions(
    client: PoolClient,
    workspaceId: string,
    projectId: string
  ) {
    const rows = await client.query<{
      payload: ContentPackage;
      revision: string;
    }>(
      `SELECT payload, revision::text AS revision FROM p1_content_packages
       WHERE workspace_id = $1
       ORDER BY updated_at, id`,
      [workspaceId]
    );
    return rows.rows.flatMap(({ payload, revision }) => {
      const contentPackage = contentPackageSchema.parse(payload);
      if (contentPackage.revision !== Number(revision)) {
        throw new Error(
          `ContentPackage ${contentPackage.id} revision column does not match its payload.`
        );
      }
      return contentPackage.versions.flatMap((version) => {
        const source = version.sourceRef?.advancedCanvas;
        if (!source || source.projectId !== projectId) return [];
        return [
          {
            orderedMediaNodeIds: [...source.orderedMediaNodeIds],
            packageId: contentPackage.id,
            projectId: source.projectId,
            revisionId: source.revisionId,
            selectedNodeIds: [...source.selectedNodeIds],
            versionId: version.id,
          },
        ];
      });
    });
  }

  private async saveState(
    client: PoolClient,
    workspaceId: string,
    state: AdoptionState
  ) {
    await client.query(
      `UPDATE pro_studio_workspace_state
       SET state = $2, updated_at = now()
       WHERE namespace = 'adoption_v1' AND workspace_id = $1`,
      [workspaceId, state]
    );
  }

  private async resolveRevision(
    client: PoolClient,
    context: AdvancedCanvasAdoptionContext,
    command: AdvancedCanvasAdoptionCommand
  ): Promise<RevisionRow> {
    if (command.revisionRef.kind === 'frozen') {
      const revision = await client.query<RevisionRow>(
        `SELECT id, graph, draft_version
         FROM advanced_canvas_revisions
         WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
        [context.workspaceId, command.projectId, command.revisionRef.revisionId]
      );
      if (!revision.rows[0]) {
        throw new AdvancedCanvasAdoptionError(
          'REVISION_NOT_FOUND',
          'Advanced canvas revision was not found.'
        );
      }
      return revision.rows[0];
    }
    const project = await client.query<{
      graph: ProjectGraph;
      draft_version: string | number;
    }>(
      `SELECT graph, draft_version
       FROM advanced_canvas_projects
       WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [context.workspaceId, command.projectId]
    );
    const row = project.rows[0];
    if (!row) {
      throw new AdvancedCanvasAdoptionError(
        'PROJECT_NOT_FOUND',
        'Advanced canvas project was not found.'
      );
    }
    assertDraftVersion(
      Number(row.draft_version),
      command.revisionRef.expectedDraftVersion
    );
    const revisionId = createAdoptionRevisionId(
      {
        workspaceId: context.workspaceId,
        projectId: command.projectId,
        draftVersion: Number(row.draft_version),
        graph: row.graph,
      },
      postgresAdoptionRuleProfile
    );
    const timestamp = this.now().toISOString();
    await client.query(
      `INSERT INTO advanced_canvas_revisions
       (workspace_id, project_id, id, graph, draft_version, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'adoption', $6, $7)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        context.workspaceId,
        command.projectId,
        revisionId,
        row.graph,
        row.draft_version,
        context.userId,
        timestamp,
      ]
    );
    return {
      id: revisionId,
      graph: row.graph,
      draft_version: row.draft_version,
    };
  }

  private async resolveSelection(
    client: PoolClient,
    workspaceId: string,
    command: AdvancedCanvasAdoptionCommand,
    revision: RevisionRow
  ) {
    const selection = resolveAdoptionSelection(
      revision.graph.nodes.map((node) => ({
        id: node.id,
        kind:
          node.type === 'text' ||
          node.type === 'image' ||
          node.type === 'video' ||
          node.type === 'audio'
            ? node.type
            : 'audio',
        ...(typeof node.data.text === 'string'
          ? { text: node.data.text }
          : {}),
        ...(typeof node.data.assetId === 'string'
          ? { assetId: node.data.assetId }
          : {}),
        ...(typeof node.data.jobId === 'string'
          ? { jobId: node.data.jobId }
          : {}),
        sourceAssetIds: Array.isArray(node.data.sourceAssetIds)
          ? node.data.sourceAssetIds.filter(
              (value): value is string => typeof value === 'string'
            )
          : [],
      })),
      command.selection,
      postgresAdoptionRuleProfile
    );
    const requiredOwnedAssetIds = unique(selection.orderedAssetIds);
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM (
         SELECT id
           FROM pro_studio_owned_assets
          WHERE workspace_id = $1 AND id = ANY($2::text[])
         UNION
         SELECT id
           FROM p1_owned_assets
          WHERE workspace_id = $1
            AND id = ANY($2::text[])
            AND media_type IN (
              'image/jpeg', 'image/png', 'image/webp',
              'video/mp4', 'audio/mpeg', 'audio/wav'
            )
       ) AS owned_assets`,
      [workspaceId, requiredOwnedAssetIds]
    );
    if (owned.rows.length !== requiredOwnedAssetIds.length) {
      throw new AdvancedCanvasAdoptionError(
        'ASSET_NOT_OWNED',
        'Every adopted media node must reference a workspace-owned asset.'
      );
    }
    const canonicalJobs = await client.query<{
      job_id: string;
      status: string;
      result: unknown;
    }>(
      `SELECT job_id, status, result
         FROM model_generation_jobs
        WHERE workspace_id = $1 AND job_id = ANY($2::text[])`,
      [workspaceId, selection.orderedJobIds]
    );
    const canonicalJobById = new Map(
      canonicalJobs.rows.map((row) => [row.job_id, row])
    );
    const fallbackJobById = new Map<string, CanvasGenerationJobLike>();
    if (
      selection.orderedJobIds.some((jobId) => !canonicalJobById.has(jobId))
    ) {
      const generation = await client.query<{
        state: CanvasGenerationWorkspaceState;
      }>(
        `SELECT state FROM pro_studio_workspace_state
         WHERE namespace = 'generation' AND workspace_id = $1`,
        [workspaceId]
      );
      for (const job of generation.rows[0]?.state.jobs ?? []) {
        fallbackJobById.set(job.id, job);
      }
    }
    const originRevisionIds = unique([
      ...canonicalJobs.rows
        .map((row) => canonicalOriginRevisionId(row))
        .filter((value): value is string => value !== null),
      ...[...fallbackJobById.values()]
        .map((job) => readCanvasGenerationOrigin(job.origin)?.revisionId)
        .filter((value): value is string => value !== undefined),
      revision.id,
    ]);
    const validOriginRevisions = await client.query<{ id: string }>(
      `SELECT id FROM advanced_canvas_revisions
        WHERE workspace_id = $1
          AND project_id = $2
          AND id = ANY($3::text[])`,
      [workspaceId, command.projectId, originRevisionIds]
    );
    const allowedOriginRevisionIds = new Set(
      validOriginRevisions.rows.map((row) => row.id)
    );
    const jobAssetIds = new Map<string, string[]>();
    for (const [index, jobId] of selection.orderedJobIds.entries()) {
      const canonical = canonicalJobById.get(jobId);
      if (canonical) {
        if (!canonicalGenerationDelivered(
          canonical,
          jobId,
          command.projectId,
          selection.orderedAssetIds[index] as string,
          allowedOriginRevisionIds
        )) {
          throw new AdvancedCanvasAdoptionError(
            'JOB_NOT_DELIVERED',
            'Every adopted media node must have a completed canonical generation job.'
          );
        }
      } else {
        const job = fallbackJobById.get(jobId);
        const origin = readCanvasGenerationOrigin(job?.origin);
        if (
          !job ||
          job.status !== 'completed' ||
          job.outputAssetId !== selection.orderedAssetIds[index] ||
          origin?.projectId !== command.projectId ||
          !origin ||
          !allowedOriginRevisionIds.has(origin.revisionId)
        ) {
          throw new AdvancedCanvasAdoptionError(
            'JOB_NOT_DELIVERED',
            'Every adopted media node must have a completed canonical generation job.'
          );
        }
      }
      jobAssetIds.set(jobId, [selection.orderedAssetIds[index] as string]);
    }
    return {
      ...selection,
      jobAssetIds,
    };
  }

  private now() {
    return this.options.clock?.() ?? new Date();
  }
}

function canonicalGenerationDelivered(
  row: { status: string; result: unknown },
  jobId: string,
  projectId: string,
  assetId: string,
  allowedOriginRevisionIds: ReadonlySet<string>
) {
  const result = objectRecord(row.result);
  const origin = objectRecord(result?.origin);
  const asset = objectRecord(result?.asset);
  return (
    row.status === 'completed' &&
    result?.jobId === jobId &&
    result.status === 'completed' &&
    origin?.kind === 'advanced_canvas' &&
    origin.projectId === projectId &&
    typeof origin.revisionId === 'string' &&
    allowedOriginRevisionIds.has(origin.revisionId) &&
    asset?.id === assetId
  );
}

function canonicalOriginRevisionId(row: { result: unknown }) {
  const result = objectRecord(row.result);
  const origin = objectRecord(result?.origin);
  return typeof origin?.revisionId === 'string' ? origin.revisionId : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
