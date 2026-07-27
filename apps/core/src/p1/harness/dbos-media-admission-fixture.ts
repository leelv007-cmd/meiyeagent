import { DBOS } from '@dbos-inc/dbos-sdk';
import type { ModelSupplyResult } from '../model-supply/index.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  ModelSupplyHarnessMediaExecutionPort,
} from './unified-media-stage-ports.js';
import type { NoteMediaAdmissionPort } from './note-media-admission.js';
import type { ExecutionBrief } from './structured-nodes.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

export type MediaAdmissionWorkflowInput = {
  workflowId: string;
  request: HarnessWorkflowInput;
};

export type MediaAdmissionCrashMode = 'wait' | 'after-claim';

export function mediaAdmissionRequest(
  workflowId: string,
  workspaceId: string,
): MediaAdmissionWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-s6-admission',
      workspaceId,
      idempotencyKey: `submission-${workflowId}`,
      taskId: workflowId,
      workId: `work-${workflowId}`,
      contentPackageId: `package-${workflowId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作一组夏日护理图文笔记配图',
      surface: { id: 'surface-s6-admission', revision: 'surface-r1' },
      recipe: { id: 'recipe-s6-admission', revision: 'recipe-r1' },
      lens: 'image_text_note',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'note',
        quantity: 1,
        aspectRatio: '9:16',
        notePageBound: 3,
      },
      deliverables: [
        {
          id: 'note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          notePageBound: 3,
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-s6-admission', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-s6-admission',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: {
        id: 'model-s6-admission',
        revision: 'model-r1',
      },
      quote: { id: 'quote-s6-admission', revision: 'quote-r1' },
      route: { id: 'route-s6-admission', revision: 'route-r1' },
      briefContext: { id: 'brief-s6-admission', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-28T00:00:00.000Z',
  );
  return {
    workflowId,
    request: {
      actorId: snapshot.actorId,
      workspaceId,
      packageId: snapshot.contentPackage.id,
      expectedRevision: snapshot.contentPackage.expectedRevision,
      workflowRevision: snapshot.revision,
      creationMode: snapshot.creationMode,
      rawInput: snapshot.intent.text,
      intent: {
        context: {
          workId: snapshot.work.id,
          intent: snapshot.intent.text,
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot: snapshot,
    },
  };
}

export function createMediaAdmissionWorkflow(
  noteAdmission: NoteMediaAdmissionPort,
  crashMode?: MediaAdmissionCrashMode,
) {
  const observedAdmission = crashMode
    ? crashAdmission(noteAdmission, crashMode)
    : noteAdmission;
  const adapter = new ModelSupplyHarnessMediaExecutionPort(
    {
      async submit() {
        return completedImageResult();
      },
    },
    undefined,
    observedAdmission,
  );
  return DBOS.registerWorkflow(
    async ({ workflowId, request }: MediaAdmissionWorkflowInput) =>
      adapter.execute({
        brief: mediaAdmissionBrief(),
        context: mediaAdmissionContext(workflowId, request.workspaceId),
        request,
        workflowId,
        runStep(effectKey, operation) {
          return DBOS.runStep(operation, {
            name: effectKey.replaceAll(':', '-'),
          });
        },
      }),
    { name: 's6MediaAdmissionWorkflow' },
  );
}

function crashAdmission(
  noteAdmission: NoteMediaAdmissionPort,
  mode: MediaAdmissionCrashMode,
) {
  let signalled = false;
  return {
    async claim(input: Parameters<NoteMediaAdmissionPort['claim']>[0]) {
      const token = await noteAdmission.claim(input);
      const shouldCrash =
        (mode === 'wait' && !token) || (mode === 'after-claim' && token);
      if (shouldCrash && !signalled) {
        signalled = true;
        process.stdout.write(
          token ? 'ADMISSION_CLAIMED\n' : 'ADMISSION_WAITING\n',
          () => {
            process.kill(process.pid, 'SIGKILL');
          },
        );
        await new Promise<void>(() => {});
      }
      return token;
    },
    markRunning: noteAdmission.markRunning.bind(noteAdmission),
    markTerminal: noteAdmission.markTerminal.bind(noteAdmission),
  } satisfies NoteMediaAdmissionPort;
}

function mediaAdmissionBrief(): Extract<ExecutionBrief, { kind: 'image' }> {
  return {
    kind: 'image',
    intent: {
      operation: 'image.generate',
      purpose: '夏日护理项目图文笔记配图',
      subject: '夏日护理项目',
      scene: '门店护理区',
      composition: '竖版主视觉',
      references: [],
      exactText: [],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' },
    },
    prompt: '为夏日护理项目生成竖版图文笔记配图，保留门店服务氛围。',
    referenceAssetIds: [],
    parameters: { ratio: '9:16', resolution: '1080p' },
    constraints: ['不得编造价格'],
  };
}

function mediaAdmissionContext(
  workflowId: string,
  workspaceId: string,
): HarnessContextSnapshot {
  return {
    bundle: {
      bundleId: `bundle-${workflowId}`,
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1',
      workspaceId,
      taskId: workflowId,
      frozenAt: '2026-07-28T00:00:00.000Z',
      frozenBy: 'owner-s6-admission',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 0,
        assets: 0,
        identity: 1,
        rights: 1,
        preferences: 0,
        recipe: 1,
        platformRules: 1,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {},
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    activeFacts: [],
    policyReferences: {
      sourceRefs: [],
      rightsRefs: [],
      identityRefs: [],
    },
  };
}

function completedImageResult(): ModelSupplyResult {
  const attempt = {
    acceptance: 'accepted' as const,
    catalogModelId: 'model-s6-admission',
    createdAt: '2026-07-28T00:00:00.000Z',
    deploymentId: 'deployment-s6-admission',
    id: 'attempt-s6-admission',
    jobId: 'job-s6-admission',
    status: 'completed' as const,
  };
  const providerCost = {
    amount: 1,
    currency: 'CNY' as const,
    id: 'cost-s6-admission',
    status: 'observed' as const,
    usage: { mediaUnits: 1 },
  };
  return {
    jobId: 'job-s6-admission',
    status: 'completed',
    snapshot: {
      actualCatalogModelId: 'model-s6-admission',
      catalogRevisionId: 'model-r1',
      deploymentId: 'deployment-s6-admission',
      id: 'route-s6-admission',
    } as ModelSupplyResult['snapshot'],
    attempt,
    attempts: [attempt],
    asset: {
      contentType: 'image/png',
      id: 'image-s6-admission',
      objectKey: 'owned/image-s6-admission',
      sha256: 's6-admission-sha',
      sizeBytes: 1024,
      sourceTaskRef: 'provider-task-s6-admission',
    },
    usage: {
      id: 'usage-s6-admission',
      quantity: 0,
      status: 'committed',
    },
    providerCost,
    providerCosts: [providerCost],
  };
}
