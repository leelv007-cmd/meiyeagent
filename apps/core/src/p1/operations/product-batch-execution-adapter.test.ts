import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProductService } from '../../product/product-service.js';
import { MemoryProductRepository } from '../../product/repository.js';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  ProductOperationsBatchExecutionAdapter,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  type BatchExecutionRequest,
  type ContentTask,
  type OperationContext,
  type WeeklyBatchAction,
} from './index.js';

const owner: OperationContext = {
  actor: 'owner',
  correlationId: 'weekly-batch-real-effects',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('weekly batch actions create queryable Product and Operations facts exactly once', async () => {
  const productRepository = new MemoryProductRepository();
  productRepository.grantMembership(owner.userId, owner.workspaceId);
  const product = new ProductService(productRepository);
  const productContext = { ...owner, actor: 'user' as const };
  await product.execute(
    productContext,
    {
      type: 'confirm_store',
      store: {
        accounts: [{ nickname: '暮色美甲杭州店', platform: 'xiaohongshu' }],
        address: '湖墅南路 88 号',
        booking: '提前一天预约',
        brandVoice: '专业、克制、像熟客推荐',
        city: '杭州',
        district: '拱墅区',
        name: '暮色美甲',
        prohibitions: ['不承诺效果'],
        projects: [
          {
            confirmed: true,
            durationMinutes: 90,
            id: 'project-cat-eye',
            name: '透亮猫眼',
            price: 299,
          },
        ],
        regulated: false,
      },
    },
    'weekly-batch-store'
  );
  const generated = await product.execute(
    productContext,
    {
      type: 'generate_copy',
      brief: {
        assetIds: [],
        conversionGoal: '预约到店',
        hook: '阴天也透亮的猫眼细节',
        platform: 'xiaohongshu',
        projectId: 'project-cat-eye',
        scenario: '项目种草',
        tone: '真实克制',
      },
    },
    'weekly-batch-source-copy'
  );
  const sourceContentId = generated.output.candidateIds?.[0];
  assert.ok(sourceContentId);

  const operationsRepository = new MemoryOperationsRepository();
  operationsRepository.grantMembership(owner.userId, owner.workspaceId);
  let operations: OperationsApplicationService;
  const adapter = new ProductOperationsBatchExecutionAdapter(
    product,
    () => operations
  );
  operations = new OperationsApplicationService(operationsRepository, {
    batchExecutor: adapter,
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  await operations.seedOfficialTemplateFamilies({
    actor: 'admin',
    correlationId: 'seed-weekly-batch-templates',
    userId: 'admin-a',
    workspaceId: '__system__',
  });

  const task = (id: string, title: string): ContentTask => ({
    createdAt: '2026-07-11T00:00:00.000Z',
    dueAt: '2026-07-14T09:00:00.000Z',
    executable: true,
    id,
    relatedObject: { id: sourceContentId, kind: 'content' },
    risk: 'normal',
    source: 'weekly_batch',
    status: 'todo',
    title,
    updatedAt: '2026-07-11T00:00:00.000Z',
    workspaceId: owner.workspaceId,
  });
  const request = (
    action: WeeklyBatchAction,
    executionId: string,
    contentTask: ContentTask
  ): BatchExecutionRequest => ({
    action,
    actorId: owner.userId,
    attempt: 1,
    correlationId: owner.correlationId,
    executionId,
    task: contentTask,
    workspaceId: owner.workspaceId,
  });

  const beforeCreate = (await product.bootstrap(productContext)).contents
    .length;
  const createTask = await operations.createTask(owner, {
    dueAt: '2026-07-14T09:00:00.000Z',
    executable: true,
    relatedObject: { id: sourceContentId, kind: 'content' },
    risk: 'normal',
    source: 'weekly_batch',
    title: '创建本周内容',
  });
  const batchResult = await operations.executeWeeklyBatch(owner, {
    action: 'create',
    taskIds: [createTask.id],
  });
  assert.equal(batchResult.completed[0]?.status, 'done');
  const [createExecution] = await operations.listWeeklyBatchExecutions(
    owner,
    createTask.id
  );
  assert.equal(createExecution?.status, 'completed');
  assert.ok(createExecution?.output);
  assert.deepEqual(batchResult.completed[0]?.relatedObject, {
    id: createExecution.output.artifactId,
    kind: 'content',
  });
  const createdAgain = await adapter.execute({
    action: createExecution.action,
    actorId: createExecution.actorId,
    attempt: createExecution.attempt,
    correlationId: createExecution.correlationId,
    executionId: createExecution.id,
    task: createTask,
    workspaceId: createExecution.workspaceId,
  });
  assert.equal(createdAgain.status, 'completed');
  assert.deepEqual(createdAgain.output, createExecution.output);
  const afterCreate = await product.bootstrap(productContext);
  assert.equal(afterCreate.contents.length, beforeCreate + 1);
  assert.ok(
    afterCreate.contents.some(
      (content) => content.id === createExecution.output?.artifactId
    )
  );

  const sourceBeforeRevision = (
    await product.bootstrap(productContext)
  ).contents.find((content) => content.id === sourceContentId)!;
  const versionsBefore = sourceBeforeRevision.variants[0]!.versions.length;
  const reviseRequest = request(
    'revise',
    'weekly-revise-effect',
    task('task-revise', '修改本周内容')
  );
  const revised = await adapter.execute(reviseRequest);
  await adapter.execute(reviseRequest);
  assert.equal(revised.status, 'completed');
  const sourceAfterRevision = (
    await product.bootstrap(productContext)
  ).contents.find((content) => content.id === sourceContentId)!;
  assert.equal(
    sourceAfterRevision.variants[0]!.versions.length,
    versionsBefore + 1
  );
  assert.equal(revised.output.artifactId, sourceContentId);

  const draftRequest = request(
    'prepare_draft',
    'weekly-draft-effect',
    task('task-draft', '准备本周草稿')
  );
  const draft = await adapter.execute(draftRequest);
  await adapter.execute(draftRequest);
  assert.equal(draft.status, 'completed');
  const afterDraft = await product.bootstrap(productContext);
  assert.equal(
    afterDraft.contents.filter(
      (content) => content.id === draft.output.artifactId
    ).length,
    1
  );
  assert.equal(
    afterDraft.contents.find(
      (content) => content.id === draft.output.artifactId
    )?.status,
    'draft'
  );

  const templateRequest = request(
    'apply_template',
    'weekly-template-effect',
    task('task-template', '制作本周图文')
  );
  const templated = await adapter.execute(templateRequest);
  const templatedAgain = await adapter.execute(templateRequest);
  assert.equal(templated.status, 'completed');
  assert.deepEqual(templatedAgain, templated);
  const work = await operations.getWork(owner, templated.output.artifactId);
  assert.equal(work.id, templated.output.artifactId);
  assert.ok(work.templateId);
  assert.ok(work.templateVersionId);
});
