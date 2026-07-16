import { createHash } from 'node:crypto';
import { contentPackageSchema, type ContentPackage } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import {
  buildContentPackage,
  transitionContentPackage,
} from '../p1/operations/content-package.js';
import type {
  AdvancedCanvasAdoptionCommand,
  AdvancedCanvasAdoptionContext,
  AdvancedCanvasAdoptionResult,
} from './adoption.js';
import { AdvancedCanvasAdoptionError } from './adoption.js';
import type { CanvasGenerationWorkspaceState } from './generation-runtime.js';

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
    validateCommand(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        context.workspaceId,
      ]);
      await this.assertMembership(client, context);
      const state = await this.lockState(client, context.workspaceId);
      const payloadHash = digest(canonical(command));
      const priorReceipt = state.receipts.find(
        (receipt) => receipt.idempotencyKey === command.idempotencyKey
      );
      if (priorReceipt) {
        if (priorReceipt.payloadHash !== payloadHash) {
          throw new AdvancedCanvasAdoptionError(
            'IDEMPOTENCY_CONFLICT',
            'Adoption key was reused with another payload.'
          );
        }
        await client.query('COMMIT');
        return structuredClone(priorReceipt.result);
      }

      const revision = await this.resolveRevision(client, context, command);
      const selection = await this.resolveSelection(
        client,
        context.workspaceId,
        command,
        revision
      );
      const businessKey = digest(
        canonical({
          projectId: command.projectId,
          revisionId: revision.id,
          textNodeId: command.selection.textNodeId,
          orderedMediaNodeIds: command.selection.orderedMediaNodeIds,
        })
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
      const packageId =
        command.target.kind === 'new_package'
          ? `content-package-${businessKey.slice(0, 24)}`
          : command.target.packageId;
      const packageRow = await client.query<{ payload: ContentPackage }>(
        `SELECT payload
         FROM p1_content_packages
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE`,
        [context.workspaceId, packageId]
      );
      const current = packageRow.rows[0]?.payload
        ? contentPackageSchema.parse(packageRow.rows[0].payload)
        : null;
      if (command.target.kind === 'existing_package') {
        if (!current) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_PACKAGE_NOT_FOUND',
            'Target content package was not found.'
          );
        }
        if (current.currentVersionId !== command.target.baseVersionId) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_VERSION_CONFLICT',
            'Target content package version is stale.'
          );
        }
        if (current.kind !== selection.kind) {
          throw new AdvancedCanvasAdoptionError(
            'CONTENT_KIND_CONFLICT',
            'Canvas selection does not match the target content kind.'
          );
        }
      } else if (current) {
        throw new AdvancedCanvasAdoptionError(
          'CONTENT_PACKAGE_CONFLICT',
          'The deterministic ContentPackage already exists without its matching advanced canvas source.'
        );
      }

      const versionId = `${packageId}-v-${businessKey.slice(0, 16)}`;
      const version = {
        body: selection.body,
        createdAt: timestamp,
        createdBy: context.userId,
        id: versionId,
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
            currentVersionId: versionId,
            generated: {
              ...current.generated,
              childRuns: [...current.generated.childRuns, ...newChildRuns],
            },
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
                id: packageId,
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
      await client.query(
        `INSERT INTO p1_content_packages (workspace_id, id, payload, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [context.workspaceId, packageId, contentPackage, timestamp]
      );

      const result: AdvancedCanvasAdoptionResult = {
        packageId,
        versionId,
        projectId: command.projectId,
        revisionId: revision.id,
        selectedNodeIds: selection.selectedNodeIds,
        orderedMediaNodeIds: [...command.selection.orderedMediaNodeIds],
      };
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
          {
            correlationId: context.correlationId,
            orderedMediaNodeIds: result.orderedMediaNodeIds,
            packageId: result.packageId,
            revisionId: result.revisionId,
            selectedNodeIds: result.selectedNodeIds,
            versionId: result.versionId,
          },
          timestamp,
        ]
      );
      await this.saveState(client, context.workspaceId, state);
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    ).find(
      (candidate) =>
        candidate.revisionId === revisionId &&
        sameOrder(candidate.selectedNodeIds, selectedNodeIds) &&
        sameOrder(
          candidate.orderedMediaNodeIds,
          command.selection.orderedMediaNodeIds
        )
    );
  }

  private async listPackageAdoptions(
    client: PoolClient,
    workspaceId: string,
    projectId: string
  ) {
    const rows = await client.query<{ payload: ContentPackage }>(
      `SELECT payload FROM p1_content_packages
       WHERE workspace_id = $1
       ORDER BY updated_at, id`,
      [workspaceId]
    );
    return rows.rows.flatMap(({ payload }) => {
      const contentPackage = contentPackageSchema.parse(payload);
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
    if (
      Number(row.draft_version) !== command.revisionRef.expectedDraftVersion
    ) {
      throw new AdvancedCanvasAdoptionError(
        'DRAFT_VERSION_CONFLICT',
        'Canvas draft changed before adoption.'
      );
    }
    const revisionId = `revision-${digest(
      canonical({
        workspaceId: context.workspaceId,
        projectId: command.projectId,
        draftVersion: Number(row.draft_version),
        graph: row.graph,
      })
    ).slice(0, 24)}`;
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
    const nodeById = new Map(
      revision.graph.nodes.map((node) => [node.id, node])
    );
    const mediaNodes = command.selection.orderedMediaNodeIds.map((id) =>
      nodeById.get(id)
    );
    if (mediaNodes.some((node) => !node)) {
      throw new AdvancedCanvasAdoptionError(
        'SELECTION_INVALID',
        'Every selected media node must belong to the frozen revision.'
      );
    }
    const textNode = command.selection.textNodeId
      ? nodeById.get(command.selection.textNodeId)
      : undefined;
    if (command.selection.textNodeId && textNode?.type !== 'text') {
      throw new AdvancedCanvasAdoptionError(
        'SELECTION_INVALID',
        'The selected text node is invalid.'
      );
    }
    const resolvedMedia = mediaNodes as NonNullable<
      (typeof mediaNodes)[number]
    >[];
    const mediaTypes = resolvedMedia.map((node) => node.type);
    const kind = textNode
      ? mediaTypes.every((type) => type === 'image')
        ? ('image_text' as const)
        : null
      : mediaTypes.every((type) => type === 'video')
        ? ('video' as const)
        : null;
    if (!kind || mediaTypes.includes('audio')) {
      throw new AdvancedCanvasAdoptionError(
        'CONTENT_KIND_INVALID',
        'Adoption supports image-text or video output; audio is not standalone.'
      );
    }
    const orderedAssetIds = resolvedMedia.map((node) =>
      stringData(node, 'assetId')
    );
    const requiredOwnedAssetIds = unique(orderedAssetIds);
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
    const childJobIds = resolvedMedia.map((node) => stringData(node, 'jobId'));
    const canonicalJobs = await client.query<{
      job_id: string;
      status: string;
      result: unknown;
    }>(
      `SELECT job_id, status, result
         FROM model_generation_jobs
        WHERE workspace_id = $1 AND job_id = ANY($2::text[])`,
      [workspaceId, childJobIds]
    );
    const canonicalJobById = new Map(
      canonicalJobs.rows.map((row) => [row.job_id, row])
    );
    const fallbackJobById = new Map<string, CanvasGenerationJobLike>();
    if (childJobIds.some((jobId) => !canonicalJobById.has(jobId))) {
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
      ...[...fallbackJobById.values()].map((job) => job.origin.revisionId),
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
    for (const [index, jobId] of childJobIds.entries()) {
      const canonical = canonicalJobById.get(jobId);
      if (canonical) {
        if (!canonicalGenerationDelivered(
          canonical,
          jobId,
          command.projectId,
          orderedAssetIds[index] as string,
          allowedOriginRevisionIds
        )) {
          throw new AdvancedCanvasAdoptionError(
            'JOB_NOT_DELIVERED',
            'Every adopted media node must have a completed canonical generation job.'
          );
        }
      } else {
        const job = fallbackJobById.get(jobId);
        if (
          !job ||
          job.status !== 'completed' ||
          job.outputAssetId !== orderedAssetIds[index] ||
          job.origin.kind !== 'advanced_canvas' ||
          job.origin.id !== command.projectId ||
          !allowedOriginRevisionIds.has(job.origin.revisionId)
        ) {
          throw new AdvancedCanvasAdoptionError(
            'JOB_NOT_DELIVERED',
            'Every adopted media node must have a completed canonical generation job.'
          );
        }
      }
      jobAssetIds.set(jobId, [orderedAssetIds[index] as string]);
    }
    const sourceAssetIds = unique(
      resolvedMedia.flatMap((node) =>
        Array.isArray(node.data.sourceAssetIds)
          ? node.data.sourceAssetIds.filter(
              (value): value is string => typeof value === 'string'
            )
          : []
      )
    );
    return {
      body: textNode ? stringData(textNode, 'text') : '',
      childJobIds,
      jobAssetIds,
      kind,
      orderedAssetIds,
      selectedNodeIds: [
        ...(command.selection.textNodeId ? [command.selection.textNodeId] : []),
        ...command.selection.orderedMediaNodeIds,
      ],
      sourceAssetIds,
    };
  }

  private now() {
    return this.options.clock?.() ?? new Date();
  }
}

function validateCommand(command: AdvancedCanvasAdoptionCommand) {
  if (!command.projectId?.trim() || !command.idempotencyKey?.trim()) {
    throw new AdvancedCanvasAdoptionError(
      'INPUT_INVALID',
      'projectId and idempotencyKey are required.'
    );
  }
  if (
    command.selection.orderedMediaNodeIds.length === 0
  ) {
    throw new AdvancedCanvasAdoptionError(
      'SELECTION_INVALID',
      'Adoption requires ordered media nodes.'
    );
  }
}

function stringData(node: { data: Record<string, unknown> }, key: string) {
  const value = node.data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdvancedCanvasAdoptionError(
      'SELECTION_INVALID',
      `Selected node has no ${key}.`
    );
  }
  return value;
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

function sameOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
