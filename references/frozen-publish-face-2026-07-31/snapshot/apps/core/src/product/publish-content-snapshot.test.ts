import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductService } from './product-service.js';
import { ProductPublishContentSnapshotPort } from './publish-content-snapshot.js';
import { MemoryProductRepository } from './repository.js';

const context = {
  actor: 'user' as const,
  correlationId: 'snapshot-port-test',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

describe('ProductPublishContentSnapshotPort', () => {
  it('lists only real ready Douyin video handoffs and changes the revision with the payload', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(context.userId, context.workspaceId);
    const state = await new ProductService(repository).bootstrap(context);
    const createdAt = '2026-07-11T00:00:00.000Z';
    state.contents.push({
      assetIds: [],
      complianceStatus: 'clear',
      createdAt,
      id: 'content-a',
      projectId: 'project-a',
      scenario: 'project_intro',
      selected: true,
      status: 'draft',
      variants: [
        {
          aiDefaultVersionId: 'version-a',
          currentVersionId: 'version-a',
          id: 'variant-a',
          platform: 'douyin',
          versions: [
            {
              assetOrder: [],
              body: '真实门店视频正文',
              conversionHook: '预约到店',
              createdAt,
              id: 'version-a',
              source: 'merchant',
              title: '真实门店视频',
              topics: ['门店日常'],
            },
          ],
        },
      ],
    });
    state.videoArtifacts.push({
      aspectRatio: '9:16',
      compliancePassed: true,
      contentType: 'video/mp4',
      correlationId: 'video-correlation-a',
      createdAt,
      durationSeconds: 15,
      fileSha256: 'a'.repeat(64),
      fileSizeBytes: 1024,
      id: 'artifact-a',
      implicitMetadata: false,
      jobId: 'job-a',
      model: 'seedance-2',
      objectKey: 'workspace-a/video/artifact-a.mp4',
      provider: 'recorded',
      providerCostCents: 0,
      renderEvidenceId: 'render-a',
      reservationId: 'reservation-a',
      status: 'completed',
      storageEtag: 'etag-a',
      storageVerifiedAt: createdAt,
      storyboardVersion: 1,
      visibleLabel: false,
    });
    state.handoffPackages.push({
      accountNickname: '暮色美甲',
      artifactId: 'artifact-a',
      body: '真实门店视频正文',
      checklist: ['人工预览全部媒体'],
      complianceResultId: 'compliance-a',
      contentId: 'content-a',
      contentVersionId: 'version-a',
      conversionText: '预约到店',
      createdAt,
      expiresAt: '2026-07-12T00:00:00.000Z',
      exportEvents: [],
      manualReports: [],
      id: 'handoff-a',
      operatorUserId: context.userId,
      platform: 'douyin',
      route: 'L3_HANDOFF_PACKAGE',
      status: 'ready',
      title: '真实门店视频',
      token: 'not-part-of-publish-revision',
      topics: ['门店日常'],
      version: 1,
    });
    state.handoffPackages.push({
      ...state.handoffPackages[0]!,
      artifactId: undefined,
      id: 'handoff-without-video',
    });
    await repository.save(state);

    const port = new ProductPublishContentSnapshotPort(repository);
    const listed = await port.list(context.workspaceId);
    assert.deepEqual(listed.map((snapshot) => snapshot.id), ['handoff-a']);
    const first = await port.resolve(context.workspaceId, 'handoff-a');
    assert.ok(first);
    assert.equal(first.artifactId, 'artifact-a');

    state.handoffPackages[0]!.title = '已修订的真实门店视频';
    await repository.save(state);
    const revised = await port.resolve(context.workspaceId, 'handoff-a');
    assert.ok(revised);
    assert.notEqual(revised.revision, first.revision);

    state.handoffPackages[0]!.status = 'published';
    await repository.save(state);
    assert.equal(
      await port.resolve(context.workspaceId, 'handoff-a'),
      undefined
    );
  });
});
