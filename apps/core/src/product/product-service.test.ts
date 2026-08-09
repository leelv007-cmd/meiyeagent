import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError, ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';
import type { ProductNotification } from './notifier.js';
import type {
  CopyProviderRequest,
  CopyProviderRegistry,
} from './copy-provider.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
  ModelSupplyApplicationService,
  ProductCopyProviderBridge,
  RecordedProviderExecutionPort,
} from '../p1/model-supply/index.js';
import { ModelSupplyProductCopyProvider } from './model-supply-copy-provider.js';
import type { ProductQualityEvent } from './quality-sink.js';
import type { LegacyInFlightDecision } from './legacy-inflight-decision.js';
import type { HandoffPackage, ProductState } from '@meiye/contracts';
import { pinnedPromptResolver } from '../p1/model-supply/prompt-pin.testing.js';

const merchant = {
  actor: 'user' as const,
  correlationId: 'corr-golden-journey',
  userId: 'user-a',
  workspaceId: 'workspace-a',
};

const worker = {
  ...merchant,
  actor: 'worker' as const,
};

describe('product golden journey', () => {
  it('strips retired ledger keys from historical ProductState JSON', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    const service = new ProductService({ repository });
    const historicalState = await service.bootstrap(merchant);
    Object.assign(
      historicalState as ProductState & Record<string, unknown>,
      {
        insights: [
          {
            createdAt: '2026-07-01T00:00:00.000Z',
            id: 'historical-insight',
            kind: 'manual_note',
            note: 'retired',
          },
        ],
        leads: [{ id: 'historical-lead' }],
      }
    );
    await repository.save(historicalState);

    const normalized = await service.bootstrap(merchant);

    assert.equal(Object.hasOwn(normalized, 'insights'), false);
    assert.equal(Object.hasOwn(normalized, 'leads'), false);
  });

  it('persists complete restricted-asset authorization and rejects incomplete or expired grants', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    const service = new ProductService({ repository });
    await addRealAsset(service, 'asset-restricted-rights');
    await service.execute(
      merchant,
      {
        assetId: 'asset-restricted-rights',
        category: 'before_after',
        containsPerson: true,
        containsSensitiveData: false,
        minorStatus: 'none',
        rightsOwner: '暮色美甲',
        tags: [],
        type: 'update_asset_metadata',
      },
      'mark-restricted-rights'
    );

    await assert.rejects(
      service.execute(
        merchant,
        {
          assetId: 'asset-restricted-rights',
          consentScope: 'public_marketing',
          rightsEvidence: 'consent/archive-2026-0718',
          type: 'authorize_asset',
        },
        'authorize-restricted-incomplete'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'RIGHTS_AUTHORIZATION_DETAILS_REQUIRED' &&
        error.status === 422
    );

    await assert.rejects(
      service.execute(
        merchant,
        {
          assetId: 'asset-restricted-rights',
          consentScope: 'public_marketing',
          rightsEvidence: 'consent/archive-2026-0718',
          rightsNoFixedExpiry: false,
          rightsPlatforms: ['xiaohongshu'],
          rightsValidUntil: '2020-01-01T00:00:00.000Z',
          type: 'authorize_asset',
        },
        'authorize-restricted-expired'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'RIGHTS_AUTHORIZATION_EXPIRED' &&
        error.status === 422
    );

    const authorized = await service.execute(
      merchant,
      {
        assetId: 'asset-restricted-rights',
        consentScope: 'public_marketing',
        rightsEvidence: 'consent/archive-2026-0718',
        rightsNoFixedExpiry: true,
        rightsPlatforms: ['xiaohongshu', 'douyin'],
        type: 'authorize_asset',
      },
      'authorize-restricted-complete'
    );
    assert.deepEqual(authorized.state.assets[0]?.rightsPlatforms, [
      'xiaohongshu',
      'douyin',
    ]);
    assert.equal(authorized.state.assets[0]?.rightsNoFixedExpiry, true);
    assert.equal(authorized.state.assets[0]?.rightsValidUntil, undefined);
    assert.match(
      authorized.state.assets[0]?.rightsAuthorizedAt ?? '',
      /^\d{4}-\d{2}-\d{2}T/u
    );
  });

  it('requires evidence before a real asset becomes publicly usable and accepts historical evidence repair', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    const service = new ProductService({ repository });
    await addRealAsset(service, 'asset-rights-invariant');

    await assert.rejects(
      service.execute(
        merchant,
        {
          assetId: 'asset-rights-invariant',
          consentScope: 'public_marketing',
          type: 'authorize_asset',
        },
        'rights-invariant-missing-evidence'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'RIGHTS_EVIDENCE_REQUIRED' &&
        error.status === 422
    );
    assert.equal(
      (await service.bootstrap(merchant)).assets[0]?.authorizationStatus,
      'pending'
    );

    const historicalState = await service.bootstrap(merchant);
    historicalState.assets[0]!.authorizationStatus = 'authorized';
    historicalState.assets[0]!.consentScope = 'public_marketing';
    historicalState.assets[0]!.rightsEvidence = undefined;
    await repository.save(historicalState);

    const repaired = await service.execute(
      merchant,
      {
        assetId: 'asset-rights-invariant',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-archive-001',
        type: 'authorize_asset',
      },
      'rights-invariant-repair-evidence'
    );
    assert.equal(repaired.state.assets[0]?.authorizationStatus, 'authorized');
    assert.equal(
      repaired.state.assets[0]?.rightsEvidence,
      'owner-consent-archive-001'
    );

    const updated = await service.execute(
      merchant,
      {
        assetId: 'asset-rights-invariant',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-archive-001-revised',
        type: 'authorize_asset',
      },
      'rights-invariant-update-evidence'
    );
    assert.equal(
      updated.state.assets[0]?.rightsEvidence,
      'owner-consent-archive-001-revised'
    );
  });

  it('propagates authorization loss from metadata updates and internal-only downgrades', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    const propagatedAssetIds: string[] = [];
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      packageRightsPropagation: {
        async revokePackagesUsingAsset(_context, assetId) {
          propagatedAssetIds.push(assetId);
          return { revokedPackageIds: [] };
        },
      },
    });

    await addRealAsset(service, 'asset-minor-flip');
    await service.execute(
      merchant,
      {
        assetId: 'asset-minor-flip',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-minor-flip',
        type: 'authorize_asset',
      },
      'authorize-minor-flip'
    );
    assert.deepEqual(propagatedAssetIds, []);

    // 元数据标记未成年 → blocked：撤权必须传播到引用包
    await service.execute(
      merchant,
      {
        assetId: 'asset-minor-flip',
        category: 'store',
        containsPerson: true,
        containsSensitiveData: false,
        minorStatus: 'minor',
        rightsOwner: '暮色美甲',
        tags: [],
        type: 'update_asset_metadata',
      },
      'metadata-minor-flip'
    );
    assert.deepEqual(propagatedAssetIds, ['asset-minor-flip']);

    // 授权降级为 internal_only → pending：同样必须传播
    await addRealAsset(service, 'asset-scope-downgrade');
    await service.execute(
      merchant,
      {
        assetId: 'asset-scope-downgrade',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-downgrade',
        type: 'authorize_asset',
      },
      'authorize-scope-downgrade'
    );
    await service.execute(
      merchant,
      {
        assetId: 'asset-scope-downgrade',
        consentScope: 'internal_only',
        type: 'authorize_asset',
      },
      'downgrade-scope-internal'
    );
    assert.deepEqual(propagatedAssetIds, [
      'asset-minor-flip',
      'asset-scope-downgrade',
    ]);
  });

  it('propagates withdrawal after commit and retries it without duplicating the Product withdrawal', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    let workspaceLocked = false;
    const withWorkspaceLock = repository.withWorkspaceLock.bind(repository);
    repository.withWorkspaceLock = (workspaceId, action) =>
      withWorkspaceLock(workspaceId, async (lockedRepository) => {
        workspaceLocked = true;
        try {
          return await action(lockedRepository);
        } finally {
          workspaceLocked = false;
        }
      });
    let propagationAttempts = 0;
    const propagatedAssetIds: string[] = [];
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      packageRightsPropagation: {
        async revokePackagesUsingAsset(_context, assetId) {
          assert.equal(workspaceLocked, false);
          propagationAttempts += 1;
          propagatedAssetIds.push(assetId);
          if (propagationAttempts === 1) {
            throw new Error('operations temporarily unavailable');
          }
          return { revokedPackageIds: ['package-revoked-on-retry'] };
        },
      },
    });
    await addRealAsset(service, 'asset-withdraw-retry');

    await assert.rejects(
      service.execute(
        merchant,
        { assetId: 'asset-withdraw-retry', type: 'withdraw_asset' },
        'withdraw-retry-command'
      ),
      /operations temporarily unavailable/
    );
    assert.equal(
      (await service.bootstrap(merchant)).assets[0]?.authorizationStatus,
      'withdrawn'
    );

    const replayed = await service.execute(
      merchant,
      { assetId: 'asset-withdraw-retry', type: 'withdraw_asset' },
      'withdraw-retry-command-new-client-key'
    );
    assert.equal(replayed.state.assets[0]?.authorizationStatus, 'withdrawn');
    assert.equal(propagationAttempts, 2);
    assert.deepEqual(propagatedAssetIds, [
      'asset-withdraw-retry',
      'asset-withdraw-retry',
    ]);
    assert.equal(
      replayed.state.auditEvents.filter(
        (event) => event.action === 'asset.consent_withdrawn'
      ).length,
      1
    );
  });

  it('does not replay an old withdrawal into packages after the asset was reauthorized', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    let propagationAttempts = 0;
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      packageRightsPropagation: {
        async revokePackagesUsingAsset() {
          propagationAttempts += 1;
          return { revokedPackageIds: ['package-with-real-photo'] };
        },
      },
    });
    await addRealAsset(service, 'asset-reauthorized');

    await service.execute(
      merchant,
      { assetId: 'asset-reauthorized', type: 'withdraw_asset' },
      'withdraw-before-reauthorize'
    );
    await service.execute(
      merchant,
      {
        assetId: 'asset-reauthorized',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-after-withdrawal',
        type: 'authorize_asset',
      },
      'reauthorize-after-withdrawal'
    );
    await service.execute(
      merchant,
      { assetId: 'asset-reauthorized', type: 'withdraw_asset' },
      'withdraw-before-reauthorize'
    );

    assert.equal(propagationAttempts, 1);
    assert.equal(
      (await service.bootstrap(merchant)).assets[0]?.authorizationStatus,
      'authorized'
    );
  });

  it('freezes every legacy content write but keeps the delivery ledger available after ContentPackage cutover', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    let owner: 'legacy' | 'frozen' | 'contentpackage' = 'frozen';
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      contentWriteOwnership: { get: async () => owner },
    });
    const legacyContentCommands = [
      { type: 'generate_copy' },
      { type: 'select_content' },
      { type: 'create_douyin_variant' },
      { type: 'quick_edit' },
      { type: 'undo_edit' },
      { type: 'revert_to_ai' },
      { type: 'create_weekly_set' },
      { type: 'remix_content' },
      { type: 'abandon_content' },
      { type: 'create_storyboard' },
      { type: 'replace_storyboard_shot' },
      { type: 'confirm_storyboard' },
      { type: 'start_video' },
    ];

    for (const [index, command] of legacyContentCommands.entries()) {
      await assert.rejects(
        service.execute(
          merchant,
          command as never,
          `frozen-content-command-${index}`
        ),
        (error) =>
          error instanceof DomainError &&
          error.code === 'CONTENT_COMMANDS_FROZEN' &&
          error.status === 409
      );
    }

    // 交付台账链是票 17 显式例外：无论 frozen 还是 contentpackage owner，
    // 都不得被迁移冻结/只读守卫拦截（交付不断供）。
    const handoffLedgerCommands = [
      'create_handoff',
      'record_handoff_export',
      'report_handoff_result',
      'mark_published',
    ] as const;
    for (const ownerState of ['frozen', 'contentpackage'] as const) {
      owner = ownerState;
      for (const [index, type] of handoffLedgerCommands.entries()) {
        await service
          .execute(merchant, { type } as never, `handoff-${ownerState}-${index}`)
          .catch((error) => {
            assert.ok(
              !(
                error instanceof DomainError &&
                (error.code === 'CONTENT_COMMANDS_FROZEN' ||
                  error.code === 'LEGACY_CONTENT_READ_ONLY')
              ),
              `${type} must stay available under ${ownerState} owner (delivery ledger exception)`
            );
          });
      }
    }

    owner = 'contentpackage';
    await assert.rejects(
      service.execute(
        merchant,
        { type: 'select_content' } as never,
        'read-only-content-command'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'LEGACY_CONTENT_READ_ONLY' &&
        error.details?.nextPath === '/dashboard/content'
    );

    await service.execute(
      merchant,
      {
        asset: {
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'read-only-exempt-asset',
          mediaType: 'image',
          minorStatus: 'none',
          objectKey: 'workspace-a/assets/read-only-exempt.png',
          rightsOwner: '暮色美甲',
          sourceType: 'real',
          tags: [],
        },
        type: 'add_asset',
      },
      'read-only-exempt-command'
    );
  });

  it('updates the rebuildable search projection only after a committed command', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    const projected: string[][] = [];
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      searchProjection: {
        async sync(state) {
          projected.push(state.assets.map((asset) => asset.id));
        },
      },
    });

    await service.execute(
      merchant,
      {
        asset: {
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'search-asset-a',
          mediaType: 'image',
          minorStatus: 'none',
          objectKey: 'workspace-a/assets/search-a.png',
          rightsOwner: '暮色美甲',
          sourceType: 'real',
          tags: ['检索素材'],
        },
        type: 'add_asset',
      },
      'search-projection-asset'
    );

    assert.deepEqual(projected, [['search-asset-a']]);

    await service.bootstrap(merchant);
    assert.deepEqual(projected, [['search-asset-a'], ['search-asset-a']]);
  });

  it('retires the independent legacy video quota path for P1 workspaces', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(merchant.userId, merchant.workspaceId);
    repository.setFutureWriteOwner(merchant.workspaceId, 'p1');
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'p1',
      legacyVideoPath: 'disabled',
    });
    const state = await service.bootstrap(merchant);
    state.storyboards.push({
      confirmedAt: new Date().toISOString(),
      contentId: 'content-p1-video',
      id: 'storyboard-p1-video',
      shots: [],
      status: 'confirmed',
      version: 1,
    });
    await repository.save(state);

    await assert.rejects(
      service.execute(
        merchant,
        { storyboardId: 'storyboard-p1-video', type: 'start_video' },
        'p1-legacy-video-start'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'LEGACY_VIDEO_PATH_RETIRED'
    );
    assert.equal((await service.bootstrap(merchant)).usageEvents.length, 0);
  });

  it('rejects a non-owner P1 generation before writing pending Product facts', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('operator-a', merchant.workspaceId, 'operator');
    repository.setFutureWriteOwner(merchant.workspaceId, 'p1');
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'p1',
    });

    await assert.rejects(
      service.execute(
        { ...merchant, userId: 'operator-a' },
        copyCommand('非 Owner 不应进入账本'),
        'operator-p1-copy'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'GENERATION_OWNER_REQUIRED'
    );
    assert.equal(await repository.load(merchant.workspaceId), null);
  });

  it('persists one workspace-scoped path from confirmed facts to a published handoff', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    repository.grantMembership('user-b', 'workspace-b');
    const notifications: ProductNotification[] = [];
    const service = new ProductService({
      repository,
      notifier: {
        async notify(notification) {
          notifications.push(notification);
        },
      },
    });

    const initial = await service.bootstrap(merchant);
    assert.equal(initial.exampleStores.length, 3);
    assert.ok(initial.exampleStores.every((example) => example.readOnly));
    assert.ok(initial.exampleStores.every((example) => example.hidden));
    assert.equal(initial.entitlement.content.remaining, 100);
    assert.equal(initial.entitlement.image.remaining, 40);
    assert.equal(initial.entitlement.concurrencyLimit, 1);

    await service.execute(
      merchant,
      {
        type: 'confirm_store',
        store: {
          name: '暮色美甲',
          city: '杭州',
          district: '拱墅区',
          address: '湖墅南路 88 号',
          booking: '提前一天预约',
          brandVoice: '专业、克制、像熟客推荐',
          prohibitions: ['不承诺疗效', '不虚构价格'],
          accounts: [{ platform: 'xiaohongshu', nickname: '暮色美甲杭州店' }],
          projects: [
            {
              id: 'project-cat-eye',
              name: '透亮猫眼',
              price: 299,
              durationMinutes: 90,
              confirmed: true,
            },
          ],
          regulated: false,
        },
      },
      'confirm-store'
    );

    const assetResult = await service.execute(
      merchant,
      {
        type: 'add_asset',
        asset: {
          id: 'asset-real-1',
          objectKey: 'workspace-a/assets/cat-eye.jpg',
          mediaType: 'image',
          sourceType: 'real',
          tags: ['猫眼', '显白'],
          rightsOwner: '暮色美甲',
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          minorStatus: 'none',
        },
      },
      'asset-upload'
    );
    assert.equal(assetResult.state.assets[0]?.authorizationStatus, 'pending');

    const generated = await service.execute(
      merchant,
      {
        type: 'generate_copy',
        brief: {
          assetIds: ['asset-real-1'],
          conversionGoal: '预约到店',
          hook: '阴天也透亮的猫眼',
          platform: 'xiaohongshu',
          projectId: 'project-cat-eye',
          scenario: '项目种草',
          tone: '口语、克制',
        },
      },
      'copy-before-consent'
    );

    await service.execute(
      merchant,
      {
        type: 'authorize_asset',
        assetId: 'asset-real-1',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-asset-real-1',
      },
      'asset-consent'
    );

    assert.equal(generated.output.candidateIds?.length, 3);
    assert.equal(generated.state.entitlement.content.remaining, 99);
    assert.equal(generated.state.agentRuns.at(-1)?.status, 'completed');
    assert.equal(generated.state.toolCalls.at(-1)?.status, 'completed');
    assert.equal(
      generated.state.complianceResults.filter(
        (result) => result.stage === 'post_generation'
      ).length,
      0
    );

    const duplicate = await service.execute(
      merchant,
      {
        type: 'generate_copy',
        brief: {
          assetIds: ['asset-real-1'],
          conversionGoal: '预约到店',
          hook: '阴天也透亮的猫眼',
          platform: 'xiaohongshu',
          projectId: 'project-cat-eye',
          scenario: '项目种草',
          tone: '口语、克制',
        },
      },
      'copy-before-consent'
    );
    assert.deepEqual(duplicate.output, generated.output);
    assert.equal(duplicate.state.entitlement.content.remaining, 99);

    const contentId = generated.output.candidateIds?.[0];
    assert.ok(contentId);
    await service.execute(
      merchant,
      { type: 'select_content', contentId },
      'copy-select'
    );
    await service.execute(
      merchant,
      { type: 'create_douyin_variant', contentId, durationSeconds: 30 },
      'douyin-variant'
    );
    await service.execute(
      merchant,
      { type: 'quick_edit', contentId, instruction: 'weaker_advertising' },
      'copy-edit'
    );
    await service.execute(
      merchant,
      { type: 'create_weekly_set', contentId },
      'weekly-set'
    );

    const storyboardResult = await service.execute(
      merchant,
      { type: 'create_storyboard', contentId },
      'storyboard-create'
    );
    const storyboardId = storyboardResult.output.storyboardId;
    assert.ok(storyboardId);
    assert.equal(storyboardResult.state.entitlement.video.remaining, 3);
    await service.execute(
      merchant,
      { type: 'confirm_storyboard', storyboardId },
      'storyboard-confirm'
    );

    const started = await service.execute(
      merchant,
      { type: 'start_video', storyboardId },
      'video-start'
    );
    const jobId = started.output.jobId;
    assert.ok(jobId);
    assert.equal(started.state.entitlement.video.remaining, 2);
    assert.equal(started.state.agentRuns.at(-1)?.workflow, 'video.generate');
    assert.equal(started.state.videoArtifactShells.at(-1)?.jobId, jobId);
    const duplicateStart = await service.execute(
      merchant,
      { type: 'start_video', storyboardId },
      'video-start-business-duplicate'
    );
    assert.equal(duplicateStart.output.jobId, jobId);
    assert.equal(duplicateStart.state.entitlement.video.remaining, 2);
    await service.execute(
      worker,
      { type: 'claim_video', jobId, workerId: 'worker-a', leaseSeconds: 30 },
      'video-claim'
    );
    await assert.rejects(
      service.execute(
        worker,
        { type: 'claim_video', jobId, workerId: 'worker-b', leaseSeconds: 30 },
        'video-competing-claim'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'VIDEO_LEASE_HELD'
    );
    await service.execute(
      worker,
      {
        type: 'heartbeat_video',
        jobId,
        workerId: 'worker-a',
        leaseSeconds: 30,
      },
      'video-heartbeat'
    );
    await service.execute(
      worker,
      {
        type: 'transition_video',
        jobId,
        workerId: 'worker-a',
        nextStatus: 'running',
      },
      'video-running'
    );
    await service.execute(
      worker,
      {
        type: 'transition_video',
        jobId,
        workerId: 'worker-a',
        nextStatus: 'needs_action',
      },
      'video-needs-action'
    );
    await service.execute(
      merchant,
      { type: 'resume_video', jobId, constraint: '字幕更克制' },
      'video-resume'
    );
    const rendered = await service.execute(
      worker,
      {
        type: 'record_video_render',
        jobId,
        workerId: 'worker-a',
        evidence: {
          sourceAssetId: 'asset-real-1',
          fileSha256: 'a'.repeat(64),
          fileSizeBytes: 4096,
          provider: 'uploaded-asset-ffmpeg',
          model: 'ffmpeg-thin-compose-v1',
          durationSeconds: 15,
          aspectRatio: '9:16',
          providerCostCents: 0,
          latencyMs: 1250,
          usableQuality: { usable: true, reason: 'validated fixture' },
          firstFrameManifest: { sourceAssetId: 'asset-real-1' },
          clipManifest: [{ shotId: 'shot-1' }],
          composeManifest: { ffmpeg: true },
        },
      },
      'video-render-evidence'
    );
    const renderEvidenceId = rendered.output.renderEvidenceId;
    assert.ok(renderEvidenceId);
    await assert.rejects(
      service.execute(
        worker,
        {
          type: 'complete_video',
          jobId,
          renderEvidenceId,
          storage: {
            objectKey: 'workspace-a/videos/cat-eye-labeled.mp4',
            storageEtag: 'etag-mismatch',
            fileSha256: 'b'.repeat(64),
            fileSizeBytes: 4096,
            contentType: 'video/mp4',
            storageVerifiedAt: '2026-07-10T00:00:00.000Z',
          },
        },
        'video-complete-mismatched-storage'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'STORAGE_EVIDENCE_INVALID'
    );
    const completed = await service.execute(
      worker,
      {
        type: 'complete_video',
        jobId,
        renderEvidenceId,
        storage: {
          objectKey: 'workspace-a/videos/cat-eye-labeled.mp4',
          storageEtag: 'etag-1',
          fileSha256: 'a'.repeat(64),
          fileSizeBytes: 4096,
          contentType: 'video/mp4',
          storageVerifiedAt: '2026-07-10T00:00:00.000Z',
        },
      },
      'video-complete'
    );
    const artifactId = completed.output.artifactId;
    assert.ok(artifactId);
    assert.equal(completed.state.videoArtifacts[0]?.visibleLabel, false);
    assert.equal(completed.state.videoArtifacts[0]?.implicitMetadata, false);
    assert.equal(
      completed.state.videoArtifacts[0]?.reservationId,
      started.state.videoJobs[0]?.reservationId
    );
    assert.equal(completed.state.videoArtifacts[0]?.storyboardVersion, 1);
    assert.equal(completed.state.entitlement.storageMb.remaining, 1023);
    const videoUsage = completed.state.usageEvents.filter(
      (event) =>
        event.reservationId === started.state.videoJobs[0]?.reservationId
    );
    assert.deepEqual(
      videoUsage.map((event) => event.status),
      ['reserved', 'committed']
    );
    assert.ok(
      completed.state.usageEvents.some(
        (event) =>
          event.resource === 'storage' &&
          event.status === 'committed' &&
          !event.reservationId
      )
    );
    assert.deepEqual(
      notifications.map((notification) => notification.status),
      ['needs_action', 'completed']
    );
    await assert.rejects(
      service.execute(
        worker,
        {
          type: 'transition_video',
          jobId,
          workerId: 'worker-a',
          nextStatus: 'failed',
        },
        'video-terminal-overwrite'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'VIDEO_ALREADY_TERMINAL'
    );

    const retryOne = await service.execute(
      merchant,
      { type: 'retry_video', jobId },
      'video-quality-retry-1'
    );
    const duplicateActiveRetry = await service.execute(
      merchant,
      { type: 'retry_video', jobId },
      'video-quality-retry-active-duplicate'
    );
    assert.equal(duplicateActiveRetry.output.jobId, retryOne.output.jobId);
    const retryOneJob = retryOne.state.videoJobs.find(
      (item) => item.id === retryOne.output.jobId
    );
    assert.ok(retryOneJob);
    retryOneJob.status = 'completed';
    await repository.save(retryOne.state);
    const retryTwo = await service.execute(
      merchant,
      { type: 'retry_video', jobId: retryOne.output.jobId! },
      'video-quality-retry-2'
    );
    const retryTwoJob = retryTwo.state.videoJobs.find(
      (item) => item.id === retryTwo.output.jobId
    );
    assert.ok(retryTwoJob);
    retryTwoJob.status = 'completed';
    await repository.save(retryTwo.state);
    const retryThree = await service.execute(
      merchant,
      { type: 'retry_video', jobId: retryTwo.output.jobId! },
      'video-quality-retry-3'
    );
    assert.equal(retryOne.state.entitlement.video.remaining, 2);
    assert.equal(retryTwo.state.entitlement.video.remaining, 2);
    assert.equal(retryThree.state.entitlement.video.remaining, 1);

    const packaged = await service.execute(
      merchant,
      {
        type: 'create_handoff',
        contentId,
        artifactId,
        platform: 'xiaohongshu',
      },
      'handoff-create'
    );
    const packageId = packaged.output.packageId;
    assert.ok(packageId);
    const packageFact = packaged.state.handoffPackages.at(-1);
    assert.equal(packageFact?.route, 'L3_HANDOFF_PACKAGE');
    assert.equal(packageFact?.accountNickname, '暮色美甲杭州店');
    assert.equal(packageFact?.operatorUserId, merchant.userId);
    assert.equal(packageFact?.version, 1);
    assert.ok(packageFact?.contentVersionId);
    assert.equal(packageFact?.exportEvents[0]?.type, 'package_created');
    assert.equal(packaged.state.entitlement.package.remaining, 19);
    const duplicatePackage = await service.execute(
      merchant,
      {
        type: 'create_handoff',
        contentId,
        artifactId,
        platform: 'xiaohongshu',
      },
      'handoff-business-duplicate'
    );
    assert.equal(duplicatePackage.output.packageId, packageId);
    assert.equal(duplicatePackage.state.entitlement.package.remaining, 19);
    const final = await service.execute(
      merchant,
      {
        type: 'mark_published',
        packageId,
        platformUrl: 'https://example.com/published/cat-eye',
      },
      'publish-mark'
    );

    assert.equal(
      final.state.contents.find((item) => item.id === contentId)?.status,
      'published'
    );
    assert.ok(final.state.auditEvents.length >= 24);
    assert.ok(
      final.state.auditEvents.every(
        (event) => event.correlationId === merchant.correlationId
      )
    );

    const expired = final.state.handoffPackages.find(
      (item) => item.id === packageId
    );
    assert.ok(expired);
    expired.expiresAt = '2000-01-01T00:00:00.000Z';
    await repository.save(final.state);
    await assert.rejects(
      service.execute(
        merchant,
        {
          type: 'record_handoff_export',
          packageId,
          event: 'opened',
        },
        'expired-handoff-open'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'HANDOFF_EXPIRED'
    );

    await assert.rejects(
      service.bootstrap({ ...merchant, userId: 'user-b' }),
      (error) => error instanceof DomainError && error.code === 'NOT_FOUND'
    );
  });

  it('keeps creation open and applies the hard stop only at publication handoff', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    await prepareCopyFixture(service, false);
    const unchecked = await service.execute(
      merchant,
      { type: 'check_content', text: '伪造资质并保证永久治愈，去掉 AI 标识' },
      'creation-check-is-non-blocking'
    );
    assert.equal(unchecked.state.complianceResults.length, 0);
    assert.equal(unchecked.state.enforcement.suspended, false);

    const generated = await service.execute(
      merchant,
      copyCommand('创作阶段不审核'),
      'creation-open-copy'
    );
    const content = generated.state.contents.find(
      (item) => item.id === generated.output.candidateIds?.[0]
    );
    assert.ok(content);
    const variant = content.variants[0]!;
    const version = variant.versions.find(
      (item) => item.id === variant.currentVersionId
    )!;
    version.body = '伪造资质并保证永久治愈';
    await repository.save(generated.state);
    await service.execute(
      merchant,
      { type: 'select_content', contentId: content.id },
      'publication-hard-stop-select'
    );

    await assert.rejects(
      service.execute(
        merchant,
        {
          contentId: content.id,
          platform: 'xiaohongshu',
          type: 'create_handoff',
        },
        'publication-hard-stop'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'CONTENT_HARD_STOP'
    );
    const reviewed = await service.bootstrap(merchant);
    assert.equal(reviewed.complianceResults.at(-1)?.stage, 'publication');

    const labelChoice = reviewed.contents.find(
      (item) => item.id === generated.output.candidateIds?.[1]
    )!;
    const labelChoiceVariant = labelChoice.variants[0]!;
    const labelChoiceVersion = labelChoiceVariant.versions.find(
      (item) => item.id === labelChoiceVariant.currentVersionId
    )!;
    labelChoiceVersion.body = '去掉 AI 标识';
    await repository.save(reviewed);
    await service.execute(
      merchant,
      { type: 'select_content', contentId: labelChoice.id },
      'publication-label-switch-select'
    );
    const labelChoiceHandoff = await service.execute(
      merchant,
      {
        contentId: labelChoice.id,
        platform: 'xiaohongshu',
        type: 'create_handoff',
      },
      'publication-label-switch'
    );
    assert.equal(
      labelChoiceHandoff.state.handoffPackages.find(
        (item) => item.id === labelChoiceHandoff.output.packageId
      )?.body,
      '去掉 AI 标识'
    );
  });

  it('requires accepted Content and keeps handoff actions separate from explicit manual results', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    await prepareCopyFixture(service, false);
    const generated = await service.execute(
      merchant,
      copyCommand('发布交接边界'),
      'handoff-boundary-copy'
    );
    const contentId = generated.output.candidateIds?.[0];
    assert.ok(contentId);

    await assert.rejects(
      service.execute(
        merchant,
        { type: 'create_handoff', contentId, platform: 'xiaohongshu' },
        'handoff-before-acceptance'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'CONTENT_NOT_ACCEPTED'
    );

    await service.execute(
      merchant,
      { type: 'select_content', contentId },
      'handoff-accept-content'
    );
    const packaged = await service.execute(
      merchant,
      { type: 'create_handoff', contentId, platform: 'xiaohongshu' },
      'handoff-after-acceptance'
    );
    const packageId = packaged.output.packageId;
    assert.ok(packageId);

    for (const event of ['opened', 'downloaded', 'shared', 'copied'] as const) {
      const acted = await service.execute(
        merchant,
        {
          type: 'record_handoff_export',
          packageId,
          event,
        },
        `handoff-action-${event}`
      );
      const handoff: HandoffPackage | undefined =
        acted.state.handoffPackages.find(
          (candidate) => candidate.id === packageId
        );
      assert.equal(handoff?.status, 'ready');
      assert.equal(
        acted.state.contents.find((candidate) => candidate.id === contentId)
          ?.status,
        'draft'
      );
    }

    for (const outcome of ['not_published', 'failed'] as const) {
      const reported = await service.execute(
        merchant,
        {
          type: 'report_handoff_result',
          packageId,
          outcome,
          note: `${outcome} by operator`,
        },
        `handoff-result-${outcome}`
      );
      const handoff: HandoffPackage | undefined =
        reported.state.handoffPackages.find(
          (candidate) => candidate.id === packageId
        );
      assert.equal(handoff?.status, 'ready');
      assert.equal(handoff?.manualReports.at(-1)?.outcome, outcome);
    }

    const published = await service.execute(
      merchant,
      {
        type: 'report_handoff_result',
        packageId,
        outcome: 'published',
        platformUrl: 'https://example.com/real-post',
      },
      'handoff-result-published'
    );
    const handoff = published.state.handoffPackages.find(
      (candidate) => candidate.id === packageId
    );
    assert.equal(handoff?.status, 'published');
    assert.equal(handoff?.manualReports.at(-1)?.outcome, 'published');
    assert.equal(handoff?.platformUrl, 'https://example.com/real-post');
  });

  it('records regulated Preflight and store responsibility before handoff', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });

    await service.execute(
      merchant,
      {
        type: 'confirm_store',
        store: {
          name: '合规医美门店',
          city: '杭州',
          district: '拱墅区',
          address: '湖墅南路 88 号',
          booking: '预约制',
          brandVoice: '中性、可核验',
          prohibitions: ['不承诺疗效'],
          accounts: [{ platform: 'xiaohongshu', nickname: '合规医美门店' }],
          projects: [
            {
              id: 'project-skin',
              name: '皮肤管理',
              price: 399,
              durationMinutes: 60,
              confirmed: true,
            },
          ],
          regulated: true,
        },
      },
      'regulated-store'
    );
    await service.execute(
      merchant,
      {
        type: 'confirm_qualification',
        qualification: {
          admitted: false,
          institutionLicense: 'LICENSE-001',
          treatmentScope: '皮肤管理',
          platformCertification: 'PLATFORM-001',
          intakeAt: '2026-07-10',
        },
      },
      'regulated-qualification-denied'
    );
    await service.execute(
      merchant,
      {
        type: 'add_asset',
        asset: {
          id: 'regulated-asset',
          objectKey: 'workspace-a/assets/room.jpg',
          mediaType: 'image',
          sourceType: 'real',
          tags: ['门店环境'],
          rightsOwner: '合规医美门店',
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          minorStatus: 'none',
        },
      },
      'regulated-asset'
    );
    await service.execute(
      merchant,
      {
        type: 'authorize_asset',
        assetId: 'regulated-asset',
        consentScope: 'public_marketing',
        rightsEvidence: 'owner-consent-regulated-asset',
      },
      'regulated-asset-authorize'
    );

    const generated = await service.execute(
      merchant,
      {
        type: 'generate_copy',
        brief: {
          assetIds: ['regulated-asset'],
          conversionGoal: '预约咨询',
          hook: '基于真实门店环境介绍服务流程',
          platform: 'xiaohongshu',
          projectId: 'project-skin',
          scenario: '项目种草',
          tone: '中性、可核验',
        },
      },
      'regulated-copy-before-admission'
    );
    assert.equal(generated.state.qualification?.admitted, false);
    const contentId = generated.output.candidateIds![0]!;
    await service.execute(
      merchant,
      { type: 'select_content', contentId },
      'regulated-select'
    );

    await assert.rejects(
      service.execute(
        merchant,
        { type: 'create_handoff', contentId, platform: 'xiaohongshu' },
        'regulated-handoff-too-early'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'REGULATED_CONFIRMATION_REQUIRED'
    );
    await service.execute(
      merchant,
      { type: 'display_preflight', contentId, trigger: 'handoff' },
      'regulated-preflight'
    );
    await service.execute(
      merchant,
      { type: 'confirm_responsibility', contentId },
      'regulated-responsibility'
    );
    const handoff = await service.execute(
      merchant,
      { type: 'create_handoff', contentId, platform: 'xiaohongshu' },
      'regulated-handoff'
    );

    assert.ok(handoff.output.packageId);
    assert.match(
      handoff.state.preflightEvents[0]?.warnings.join(' ') ?? '',
      /医疗广告审查证明/
    );
    assert.match(
      handoff.state.responsibilityConfirmations[0]?.statement ?? '',
      /内容由本店负责/
    );
  });

  it('rejects legacy apply_plan for every actor and protects worker facts', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });

    await assert.rejects(
      service.execute(
        merchant,
        {
          type: 'apply_plan',
          plan: 'growth',
          eventId: 'forged-payment',
          effectiveAt: '2026-07-10T00:00:00.000Z',
        },
        'forged-payment'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COMMAND_ACTOR_FORBIDDEN'
    );

    await assert.rejects(
      service.execute(
        { ...merchant, actor: 'payment' },
        {
          type: 'apply_plan',
          plan: 'growth',
          eventId: 'payment-event-1',
          effectiveAt: '2026-07-10T00:00:00.000Z',
        },
        'payment-event-1'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'COMMAND_ACTOR_FORBIDDEN' &&
        /entitlements\.payment_grant/.test(error.message)
    );

    await assert.rejects(
      service.execute(
        merchant,
        {
          type: 'claim_video',
          jobId: 'forged-job',
          workerId: 'browser',
          leaseSeconds: 30,
        },
        'forged-worker-command'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COMMAND_ACTOR_FORBIDDEN'
    );
  });

  it('rejects an idempotency key reused with a different command payload', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    const command = {
      type: 'confirm_store' as const,
      store: {
        accounts: [],
        address: '测试路 1 号',
        booking: '预约制',
        brandVoice: '中性、克制',
        city: '杭州',
        district: '拱墅区',
        name: '测试门店',
        prohibitions: [],
        projects: [],
        regulated: false,
      },
    };
    await service.execute(merchant, command, 'same-key');

    await assert.rejects(
      service.execute(
        merchant,
        { ...command, store: { ...command.store, name: '另一家门店' } },
        'same-key'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'IDEMPOTENCY_CONFLICT'
    );
  });

  it('freezes new legacy commands while keeping write ownership reversible', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    repository.setFutureWriteOwner('workspace-a', 'frozen');
    await assert.rejects(
      service.execute(
        merchant,
        { hidden: true, type: 'hide_example' },
        'frozen-command'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COMMANDS_FROZEN'
    );
    repository.setFutureWriteOwner('workspace-a', 'p1');
    await assert.rejects(
      service.execute(
        merchant,
        { hidden: true, type: 'hide_example' },
        'p1-owned-command'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'LEGACY_WRITE_DISABLED'
    );
    repository.setFutureWriteOwner('workspace-a', 'legacy');
    const resumed = await service.execute(
      merchant,
      { hidden: true, type: 'hide_example' },
      'legacy-resumed-command'
    );
    assert.ok(resumed.state.exampleStores.every((example) => example.hidden));
  });

  it('rechecks write ownership after acquiring the workspace lock', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    let releaseLock = () => {};
    let markAcquired = () => {};
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holding = repository.withWorkspaceLock('workspace-a', async () => {
      markAcquired();
      await gate;
    });
    await acquired;
    const command = service.execute(
      merchant,
      { hidden: true, type: 'hide_example' },
      'racing-cutover-command'
    );
    repository.setFutureWriteOwner('workspace-a', 'frozen');
    releaseLock();
    await holding;

    await assert.rejects(
      command,
      (error) =>
        error instanceof DomainError && error.code === 'COMMANDS_FROZEN'
    );
  });

  it('rechecks ContentPackage ownership inside the locked copy reservation', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    let contentOwner: 'legacy' | 'frozen' | 'contentpackage' = 'legacy';
    let markInitialOwnerRead = () => {};
    const initialOwnerRead = new Promise<void>((resolve) => {
      markInitialOwnerRead = resolve;
    });
    let ownerReads = 0;
    let providerCalls = 0;
    const provider = {
      model: 'copy-cutover-v1',
      name: 'copy-cutover',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        providerCalls += 1;
        return [1, 2, 3].map((index) => ({
          assetOrder: request.brief.assetIds,
          body: `不应生成的候选 ${index}`,
          conversionHook: '预约到店',
          title: `候选 ${index}`,
          topics: ['杭州美业'],
        }));
      },
    };
    const service = new ProductService({
      repository,
      copyProviders: { domestic: provider, standard: provider },
      acceptedWriteOwner: 'legacy',
      contentWriteOwnership: {
        async get() {
          ownerReads += 1;
          if (ownerReads === 1) markInitialOwnerRead();
          return contentOwner;
        },
      },
    });
    await prepareCopyFixture(service, false);
    let releaseLock = () => {};
    let markLockAcquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holding = repository.withWorkspaceLock('workspace-a', async () => {
      markLockAcquired();
      await lockGate;
    });
    await lockAcquired;

    const command = service.execute(
      merchant,
      copyCommand('锁内复查 ContentPackage owner'),
      'copy-content-owner-race'
    );
    await initialOwnerRead;
    contentOwner = 'frozen';
    releaseLock();
    await holding;

    await assert.rejects(
      command,
      (error) =>
        error instanceof DomainError &&
        error.code === 'CONTENT_COMMANDS_FROZEN'
    );
    assert.equal(providerCalls, 0);
    assert.equal((await service.bootstrap(merchant)).agentRuns.length, 0);
  });

  it('lets only explicitly owned legacy worker tasks continue after cutover', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    repository.setFutureWriteOwner('workspace-a', 'p1');
    const decisions = new Map<string, LegacyInFlightDecision>();
    const service = new ProductService({
      repository,
      inFlightDecisions: {
        async get(workspaceId, jobId) {
          assert.equal(workspaceId, 'workspace-a');
          return decisions.get(jobId) ?? null;
        },
      },
    });
    const state = await service.bootstrap(merchant);
    state.videoJobs.push({
      agentRunId: 'agent-inflight',
      artifactShellId: 'shell-inflight',
      committedSteps: [],
      correlationId: 'corr-inflight',
      createdAt: '2026-07-11T00:00:00.000Z',
      id: 'legacy-video-inflight',
      qualityRetryCount: 0,
      reservationId: 'reservation-inflight',
      status: 'queued',
      step: '等待 legacy worker 收尾',
      storyboardId: 'storyboard-inflight',
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
    await repository.save(state);

    await assert.rejects(
      service.execute(
        worker,
        {
          jobId: 'legacy-video-inflight',
          leaseSeconds: 30,
          type: 'claim_video',
          workerId: 'legacy-worker',
        },
        'unowned-inflight-claim'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'LEGACY_INFLIGHT_DECISION_REQUIRED'
    );

    decisions.set('legacy-video-inflight', {
      allowRegeneration: false,
      decision: 'manual',
      jobId: 'legacy-video-inflight',
      owner: 'cutover-operator',
      preserveOriginalTaskRef: true,
      reason: '留给人工处理',
      status: 'queued',
    });
    await assert.rejects(
      service.execute(
        worker,
        {
          jobId: 'legacy-video-inflight',
          leaseSeconds: 30,
          type: 'claim_video',
          workerId: 'legacy-worker',
        },
        'manual-inflight-claim'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'LEGACY_INFLIGHT_MANUAL'
    );

    decisions.set('legacy-video-inflight', {
      allowRegeneration: false,
      decision: 'legacy_drain',
      jobId: 'legacy-video-inflight',
      owner: 'cutover-operator',
      preserveOriginalTaskRef: true,
      reason: '原 legacy worker 只收尾原任务',
      status: 'queued',
    });
    const claimed = await service.execute(
      worker,
      {
        jobId: 'legacy-video-inflight',
        leaseSeconds: 30,
        type: 'claim_video',
        workerId: 'legacy-worker',
      },
      'owned-inflight-claim'
    );
    assert.equal(claimed.state.videoJobs[0]?.leaseOwner, 'legacy-worker');

    decisions.set('legacy-video-inflight', {
      allowRegeneration: false,
      decision: 'new_owner_recovery',
      jobId: 'legacy-video-inflight',
      owner: 'cutover-operator',
      preserveOriginalTaskRef: true,
      reason: '只查询原 provider task 并回存产物',
      status: 'running',
    });
    await assert.rejects(
      service.prepareVideoRender(worker, 'legacy-video-inflight'),
      (error) =>
        error instanceof DomainError &&
        error.code === 'LEGACY_REGENERATION_FORBIDDEN'
    );
  });

  it('enforces governed storage without writing the retired storage bucket', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'legacy',
      legacyBillingReadOnly: true,
      storageEntitlements: {
        async resolve() {
          return { storageMb: 1 };
        },
      },
    });
    const state = await service.bootstrap(merchant);
    state.videoJobs.push({
      agentRunId: 'agent-storage',
      artifactShellId: 'shell-storage',
      committedSteps: [],
      correlationId: 'corr-storage',
      createdAt: '2026-07-11T00:00:00.000Z',
      id: 'legacy-video-storage',
      qualityRetryCount: 0,
      reservationId: 'reservation-storage',
      status: 'running',
      step: '保存产物',
      storyboardId: 'storyboard-storage',
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
    state.videoRenderEvidence.push({
      aspectRatio: '9:16',
      clipManifest: [],
      composeManifest: {},
      correlationId: 'corr-storage',
      createdAt: '2026-07-11T00:00:00.000Z',
      durationSeconds: 15,
      fileSha256: 'b'.repeat(64),
      fileSizeBytes: 1_048_576,
      firstFrameManifest: {},
      id: 'evidence-storage-new',
      jobId: 'legacy-video-storage',
      latencyMs: 1,
      model: 'legacy-video-model',
      provider: 'legacy-video-provider',
      providerCostCents: 0,
      sourceAssetId: 'asset-storage',
      usableQuality: { reason: 'verified', usable: true },
      workerId: 'legacy-worker',
    });
    state.videoArtifacts.push({
      aspectRatio: '9:16',
      compliancePassed: true,
      contentType: 'video/mp4',
      correlationId: 'corr-storage-existing',
      createdAt: '2026-07-10T00:00:00.000Z',
      durationSeconds: 15,
      fileSha256: 'a'.repeat(64),
      fileSizeBytes: 1_048_576,
      id: 'artifact-storage-existing',
      implicitMetadata: false,
      jobId: 'legacy-video-storage-existing',
      model: 'legacy-video-model',
      objectKey: 'workspace-a/videos/existing.mp4',
      provider: 'legacy-video-provider',
      providerCostCents: 0,
      renderEvidenceId: 'evidence-storage-existing',
      reservationId: 'reservation-storage-existing',
      status: 'completed',
      storageEtag: 'etag-existing',
      storageVerifiedAt: '2026-07-10T00:00:00.000Z',
      storyboardVersion: 1,
      visibleLabel: false,
    });
    await repository.save(state);

    await assert.rejects(
      service.execute(
        worker,
        {
          jobId: 'legacy-video-storage',
          renderEvidenceId: 'evidence-storage-new',
          storage: {
            contentType: 'video/mp4',
            fileSha256: 'b'.repeat(64),
            fileSizeBytes: 1_048_576,
            objectKey: 'workspace-a/videos/new.mp4',
            storageEtag: 'etag-new',
            storageVerifiedAt: '2026-07-11T00:00:00.000Z',
          },
          type: 'complete_video',
        },
        'legacy-storage-governed'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'STORAGE_QUOTA_EXHAUSTED'
    );
    assert.equal(
      (await service.bootstrap(merchant)).entitlement.storageMb.remaining,
      state.entitlement.storageMb.remaining
    );
  });

  for (const cutover of [
    { code: 'CONTENT_COMMANDS_FROZEN', owner: 'frozen' },
    { code: 'LEGACY_CONTENT_READ_ONLY', owner: 'contentpackage' },
  ] as const) {
    it(`does not finalize a reserved copy generation after ownership becomes ${cutover.owner}`, async () => {
      const repository = new MemoryProductRepository();
      repository.grantMembership('user-a', 'workspace-a');
      let contentOwner: 'legacy' | 'frozen' | 'contentpackage' = 'legacy';
      let markStarted = () => {};
      let finishProvider = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const providerGate = new Promise<void>((resolve) => {
        finishProvider = resolve;
      });
      const provider = {
        model: 'cutover-recorded-v1',
        name: 'cutover-recorded',
        region: 'local' as const,
        async generate(request: CopyProviderRequest) {
          markStarted();
          await providerGate;
          return [1, 2, 3].map((index) => ({
            assetOrder: request.brief.assetIds,
            body: `已预留任务候选 ${index}`,
            conversionHook: '预约到店',
            title: `候选 ${index}`,
            topics: ['杭州美业'],
          }));
        },
      };
      const service = new ProductService({
        repository,
        copyProviders: { domestic: provider, standard: provider },
        acceptedWriteOwner: 'legacy',
        contentWriteOwnership: {
          async get() {
            return contentOwner;
          },
        },
      });
      await prepareCopyFixture(service, false);
      const command = service.execute(
        merchant,
        copyCommand('切换窗口内已提交的文案'),
        `copy-finalize-after-${cutover.owner}`
      );
      await started;
      contentOwner = cutover.owner;
      finishProvider();

      await assert.rejects(
        command,
        (error) =>
          error instanceof DomainError && error.code === cutover.code
      );
      const state = await service.bootstrap(merchant);
      assert.equal(state.contents.length, 0);
      assert.equal(state.agentRuns.at(-1)?.status, 'failed');
      assert.equal(state.toolCalls.at(-1)?.status, 'failed');
      assert.deepEqual(
        state.usageEvents.map((event) => event.status),
        ['reserved', 'refunded']
      );
    });
  }

  it('refunds one content reservation when the copy provider fails', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const failedProvider = {
      name: 'failed-copy-provider',
      model: 'failed-v1',
      region: 'local' as const,
      async generate() {
        throw new Error('provider unavailable');
      },
    };
    const providers: CopyProviderRegistry = {
      standard: failedProvider,
      domestic: failedProvider,
    };
    const service = new ProductService({
      repository,
      copyProviders: providers,
    });
    await prepareCopyFixture(service, false);

    await assert.rejects(
      service.execute(
        merchant,
        copyCommand('普通门店内容'),
        'provider-failure'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COPY_PROVIDER_FAILED'
    );
    await assert.rejects(
      service.execute(
        merchant,
        copyCommand('普通门店内容'),
        'provider-failure'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COPY_PROVIDER_FAILED'
    );
    const state = await service.bootstrap(merchant);
    assert.equal(state.entitlement.content.remaining, 100);
    assert.deepEqual(
      state.usageEvents.map((event) => event.status),
      ['reserved', 'refunded']
    );
    assert.equal(state.contents.length, 0);
    assert.equal(state.agentRuns.at(-1)?.status, 'failed');
  });

  it('uses the Foundation copy ledger as the only P1 usage authority and mirrors its projection', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    repository.setFutureWriteOwner('workspace-a', 'p1');
    const service = new ProductService({
      repository,
      acceptedWriteOwner: 'p1',
      copyUsageAuthority: 'foundation_ledger',
      productEntitlements: {
        async getProjection() {
          return { usage: { copy: { allowance: 100, available: 99 } } };
        },
      },
    });
    await prepareCopyFixture(service, false);

    const generated = await service.execute(
      merchant,
      copyCommand('P1 单一产品账'),
      'p1-foundation-usage'
    );

    assert.equal(generated.state.entitlement.content.allowance, 100);
    assert.equal(generated.state.entitlement.content.remaining, 99);
    assert.deepEqual(generated.state.usageEvents, []);
  });

  it('calls the copy provider outside the workspace transaction', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    let workspaceLocked = false;
    const withWorkspaceLock = repository.withWorkspaceLock.bind(repository);
    repository.withWorkspaceLock = (workspaceId, action) =>
      withWorkspaceLock(workspaceId, async (lockedRepository) => {
        workspaceLocked = true;
        try {
          return await action(lockedRepository);
        } finally {
          workspaceLocked = false;
        }
      });
    const provider = {
      name: 'lock-proof-provider',
      model: 'lock-proof-v1',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        assert.equal(workspaceLocked, false);
        return ['到店体验', '服务细节', '预约行动'].map((angle) => ({
          assetOrder: request.brief.assetIds,
          body: `${request.brief.hook}，重点介绍${angle}。`,
          conversionHook: angle,
          title: `${request.brief.hook}｜${angle}`,
          topics: ['杭州美业'],
        }));
      },
    };
    const service = new ProductService({
      repository,
      copyProviders: {
        domestic: provider,
        standard: provider,
      },
    });
    await prepareCopyFixture(service, false);

    const result = await service.execute(
      merchant,
      copyCommand('锁外生成测试'),
      'copy-outside-lock'
    );
    assert.equal(result.output.candidateIds?.length, 3);
  });

  it('reclaims a stale copy execution without creating another provider job or quota reservation', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    let clock = new Date('2026-07-11T00:00:00.000Z');
    let releaseFirstCall = () => {};
    let markFirstCallStarted = () => {};
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const firstCallStarted = new Promise<void>((resolve) => {
      markFirstCallStarted = resolve;
    });
    const providerCalls: CopyProviderRequest[] = [];
    const providerJobs = new Map<
      string,
      Awaited<ReturnType<CopyProviderRegistry['standard']['generate']>>
    >();
    let billedJobs = 0;
    const provider = {
      name: 'recoverable-copy-provider',
      model: 'recoverable-copy-v1',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        providerCalls.push(structuredClone(request));
        let job = providerJobs.get(request.idempotencyKey);
        if (!job) {
          billedJobs += 1;
          job = ['facts', 'experience', 'booking'].map((angle) => ({
            assetOrder: request.brief.assetIds,
            body: `${request.brief.hook} ${angle}`,
            conversionHook: angle,
            title: `${request.brief.hook}-${angle}`,
            topics: ['杭州美业'],
          }));
          providerJobs.set(request.idempotencyKey, job);
        }
        if (providerCalls.length === 1) {
          markFirstCallStarted();
          await firstCallGate;
        }
        return job;
      },
    };
    const providers: CopyProviderRegistry = {
      domestic: provider,
      standard: provider,
    };
    const options = {
      copyExecutionClock: () => clock,
      copyExecutionLeaseMs: 1_000,
    };
    const firstService = new ProductService({
      repository,
      copyProviders: providers,
      acceptedWriteOwner: 'legacy',
      ...options,
    });
    const recoveryService = new ProductService({
      repository,
      copyProviders: providers,
      acceptedWriteOwner: 'legacy',
      ...options,
    });
    await prepareCopyFixture(firstService, false);

    const original = firstService.execute(
      merchant,
      copyCommand('可恢复生成'),
      'recover-stale-copy'
    );
    await firstCallStarted;
    await assert.rejects(
      recoveryService.execute(
        merchant,
        copyCommand('可恢复生成'),
        'recover-stale-copy'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'COMMAND_IN_PROGRESS'
    );

    clock = new Date('2026-07-11T00:00:02.000Z');
    const recovered = await recoveryService.execute(
      merchant,
      copyCommand('可恢复生成'),
      'recover-stale-copy'
    );
    releaseFirstCall();
    const originalReplay = await original;

    assert.deepEqual(originalReplay.output, recovered.output);
    assert.equal(billedJobs, 1);
    assert.equal(providerCalls.length, 2);
    assert.deepEqual(
      providerCalls.map((request) => request.idempotencyKey),
      ['recover-stale-copy', 'recover-stale-copy']
    );
    assert.equal(recovered.state.contents.length, 3);
    assert.equal(
      recovered.state.agentRuns.filter(
        (run) => run.workflow === 'content.generate_copy'
      ).length,
      1
    );
    assert.deepEqual(
      recovered.state.usageEvents.map((event) => event.status),
      ['reserved', 'committed']
    );
    assert.equal(recovered.state.entitlement.content.remaining, 99);
  });

  it('persists requested and actual model evidence from the model supply copy bridge', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const modelSupply = new ModelSupplyApplicationService({
      promptResolver: pinnedPromptResolver,
      deployments: createDefaultDeployments({
        activatedDeploymentIds: [
          'openai-direct-recorded',
          'anthropic-direct-recorded',
          'gemini-direct-recorded',
          'domestic-llm-direct-recorded',
        ],
      }),
      execution: new RecordedProviderExecutionPort(),
      models: createDefaultCatalogModels(),
    });
    const bridge = new ProductCopyProviderBridge(modelSupply);
    const qualityEvents: ProductQualityEvent[] = [];
    const service = new ProductService({
      repository,
      copyProviders: {
        domestic: new ModelSupplyProductCopyProvider(
          bridge,
          { catalogModelId: 'llm-domestic', mode: 'fixed' },
          'domestic'
        ),
        standard: new ModelSupplyProductCopyProvider(
          bridge,
          { mode: 'auto', profile: 'quality' },
          'overseas'
        ),
      },
      qualitySink: {
        async record(_workspaceId, event) {
          qualityEvents.push(event);
        },
      },
    });
    await prepareCopyFixture(service, false);

    const generated = await service.execute(
      merchant,
      copyCommand('统一模型主链'),
      'model-supply-copy'
    );
    const content = generated.state.contents.find(
      (item) => item.id === generated.output.candidateIds?.[0]
    );
    const variant = content?.variants[0];
    const version = variant?.versions.find(
      (item) => item.id === variant.currentVersionId
    );
    assert.equal(version?.generationEvidence?.requestedModel, 'auto');
    assert.equal(version?.generationEvidence?.actualModel, 'llm-anthropic');
    assert.equal(
      version?.generationEvidence?.promptRevision,
      'beauty-copy-prompt-v1'
    );
    assert.equal(
      version?.generationEvidence?.templateRevision,
      'beauty-copy-template-v1'
    );
    assert.equal(version?.generationEvidence?.providerCost.status, 'observed');
    assert.equal(
      new Set(
        generated.state.contents.map(
          (item) => item.variants[0]?.versions[0]?.body
        )
      ).size,
      3
    );

    const fixed = await service.execute(
      merchant,
      {
        ...copyCommand('显式选择模型'),
        brief: {
          ...copyCommand('显式选择模型').brief,
          requestedSelection: {
            catalogModelId: 'llm-openai',
            mode: 'fixed',
          },
        },
      },
      'model-supply-copy-fixed'
    );
    const fixedVersion = fixed.state.contents.find(
      (item) => item.id === fixed.output.candidateIds?.[0]
    )?.variants[0]?.versions[0];
    assert.equal(
      fixedVersion?.generationEvidence?.requestedModel,
      'llm-openai'
    );
    assert.equal(
      fixedVersion?.generationEvidence?.actualModel,
      'llm-openai'
    );

    await service.execute(
      merchant,
      { contentId: content!.id, type: 'select_content' },
      'quality-direct-adoption'
    );
    assert.deepEqual(qualityEvents[0], {
      catalogModelId: version!.generationEvidence!.actualModel,
      contentId: content!.id,
      createdAt: qualityEvents[0]!.createdAt,
      exampleSetRevision: version!.generationEvidence!.exampleSetRevision,
      id: `content-quality:${content!.id}:${version!.id}:adopted_directly`,
      outcome: 'adopted_directly',
      promptRevision: version!.generationEvidence!.promptRevision,
      scenario: content!.scenario,
      templateRevision: version!.generationEvidence!.templateRevision,
    });

    await service.execute(
      merchant,
      {
        contentId: content!.id,
        instruction: 'conversational',
        type: 'quick_edit',
      },
      'quality-small-edit'
    );
    const handoff = await service.execute(
      merchant,
      {
        contentId: content!.id,
        platform: 'xiaohongshu',
        type: 'create_handoff',
      },
      'quality-handoff'
    );
    assert.equal(qualityEvents.length, 2);
    await service.execute(
      merchant,
      { packageId: handoff.output.packageId!, type: 'mark_published' },
      'quality-published'
    );
    assert.equal(qualityEvents[1]?.outcome, 'adopted_with_small_edit');
    assert.ok((qualityEvents[1]?.editDistance ?? 0) > 0);
    assert.equal(
      qualityEvents[1]?.catalogModelId,
      version!.generationEvidence!.actualModel
    );
    assert.equal(
      qualityEvents[1]?.promptRevision,
      version!.generationEvidence!.promptRevision
    );
    assert.equal(qualityEvents[1]?.scenario, content!.scenario);
    assert.equal(qualityEvents[2]?.outcome, 'published');

    const abandonedContent = generated.state.contents.find(
      (item) => item.id === generated.output.candidateIds?.[1]
    );
    const abandonedVersion = abandonedContent?.variants[0]?.versions[0];
    const abandoned = await service.execute(
      merchant,
      {
        contentId: abandonedContent!.id,
        type: 'abandon_content',
      },
      'quality-abandoned'
    );
    assert.equal(
      abandoned.state.contents.find((item) => item.id === abandonedContent!.id)
        ?.status,
      'abandoned'
    );
    assert.ok(
      abandoned.state.contents.find((item) => item.id === abandonedContent!.id)
        ?.abandonedAt
    );
    assert.equal(
      abandoned.state.auditEvents.at(-1)?.action,
      'content.abandoned'
    );
    assert.deepEqual(qualityEvents[3], {
      catalogModelId: abandonedVersion!.generationEvidence!.actualModel,
      contentId: abandonedContent!.id,
      createdAt: qualityEvents[3]!.createdAt,
      exampleSetRevision:
        abandonedVersion!.generationEvidence!.exampleSetRevision,
      id: `content-quality:${abandonedContent!.id}:${abandonedVersion!.id}:abandoned`,
      outcome: 'abandoned',
      promptRevision: abandonedVersion!.generationEvidence!.promptRevision,
      scenario: abandonedContent!.scenario,
      templateRevision: abandonedVersion!.generationEvidence!.templateRevision,
    });
  });

  it('persists the requested platform and defers warning annotation until publishing', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const provider = {
      name: 'copy-contract-provider',
      model: 'copy-contract-v1',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        return [
          {
            title: '第一次来店也能轻松沟通',
            body: '第一次体验前可以先说明日常习惯。',
            topics: ['杭州美业'],
            conversionHook: '预约到店',
            assetOrder: request.brief.assetIds,
          },
          {
            title: '门店项目介绍',
            body: '不使用全网第一等无法核验的表达。',
            topics: ['杭州美业'],
            conversionHook: '预约到店',
            assetOrder: request.brief.assetIds,
          },
          {
            title: '真实门店记录',
            body: '基于真实素材介绍项目特点。',
            topics: ['杭州美业'],
            conversionHook: '预约到店',
            assetOrder: request.brief.assetIds,
          },
        ];
      },
    };
    const providers: CopyProviderRegistry = {
      standard: provider,
      domestic: provider,
    };
    const service = new ProductService({
      repository,
      copyProviders: providers,
    });
    await prepareCopyFixture(service, false);

    const result = await service.execute(
      merchant,
      {
        ...copyCommand('普通门店内容'),
        brief: {
          ...copyCommand('普通门店内容').brief,
          platform: 'douyin',
        },
      },
      'copy-platform-and-warning-boundary'
    );

    assert.ok(
      result.state.contents.every(
        (content) => content.variants[0]?.platform === 'douyin'
      )
    );
    assert.equal(
      result.state.auditEvents.find(
        (event) => event.action === 'content.generated'
      )?.details?.requestedPlatform,
      'douyin'
    );
    const firstVisit = result.state.contents.find(
      (content) =>
        content.variants[0]?.versions[0]?.title === '第一次来店也能轻松沟通'
    );
    assert.equal(firstVisit?.complianceStatus, 'clear');
    assert.equal(firstVisit?.variants[0]?.versions.length, 1);
    assert.equal(
      firstVisit?.variants[0]?.versions[0]?.body,
      '第一次体验前可以先说明日常习惯。'
    );
    const warning = result.state.contents.find((content) =>
      content.variants[0]?.versions[0]?.body.includes('全网第一')
    );
    await service.execute(
      merchant,
      { contentId: warning!.id, type: 'select_content' },
      'copy-warning-select'
    );
    assert.equal(warning?.complianceStatus, 'clear');
    assert.equal(warning?.variants[0]?.versions.length, 1);
    assert.equal(
      warning?.variants[0]?.versions[0]?.body,
      '不使用全网第一等无法核验的表达。'
    );
    const publishedCheck = await service.execute(
      merchant,
      {
        contentId: warning!.id,
        platform: 'douyin',
        type: 'create_handoff',
      },
      'copy-warning-publish-check'
    );
    const checked = publishedCheck.state.contents.find(
      (content) => content.id === warning?.id
    );
    const handoff = publishedCheck.state.handoffPackages.find(
      (item) => item.id === publishedCheck.output.packageId
    );
    assert.equal(checked?.complianceStatus, 'warning');
    assert.equal(
      checked?.variants[0]?.versions[0]?.body,
      '不使用全网第一等无法核验的表达。'
    );
    assert.equal(handoff?.title, warning?.variants[0]?.versions[0]?.title);
    assert.equal(handoff?.body, warning?.variants[0]?.versions[0]?.body);
    assert.equal(
      handoff?.checklist.some((item) => item.includes('AI 生成标识')),
      false
    );
  });

  it('routes sensitive copy domestically without exposing sensitive asset fields', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    let domesticRequest: CopyProviderRequest | undefined;
    const providers: CopyProviderRegistry = {
      standard: {
        name: 'overseas-provider',
        model: 'overseas-v1',
        region: 'overseas',
        async generate() {
          throw new Error('standard route must not be used');
        },
      },
      domestic: {
        name: 'domestic-provider',
        model: 'domestic-v1',
        region: 'domestic',
        async generate(request) {
          domesticRequest = request;
          return [1, 2, 3].map((index) => ({
            title: `候选 ${index}`,
            body: '基于真实门店事实的中性介绍。',
            topics: ['杭州美业'],
            conversionHook: '预约到店',
            assetOrder: request.brief.assetIds,
          }));
        },
      },
    };
    const service = new ProductService({
      repository,
      copyProviders: providers,
    });
    await prepareCopyFixture(service, true);

    const result = await service.execute(
      merchant,
      copyCommand('手机号 13800138000 仅用于路由判断'),
      'domestic-route'
    );
    assert.equal(result.output.candidateIds?.length, 3);
    assert.equal(result.state.toolCalls.at(-1)?.provider, 'domestic-provider');
    assert.ok(domesticRequest);
    assert.deepEqual(Object.keys(domesticRequest.assets[0]!).sort(), [
      'aigcStatus',
      'id',
      'tags',
    ]);
    assert.deepEqual(domesticRequest.dataClasses, ['pii']);
  });

  it('enforces video task business idempotency, lease expiry, and terminal state', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    const state = await service.bootstrap(merchant);
    state.storyboards.push({
      id: 'storyboard-lease',
      contentId: 'content-lease',
      version: 1,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      shots: [],
    });
    await repository.save(state);

    const started = await service.execute(
      merchant,
      { type: 'start_video', storyboardId: 'storyboard-lease' },
      'lease-start'
    );
    const jobId = started.output.jobId!;
    const duplicate = await service.execute(
      merchant,
      { type: 'start_video', storyboardId: 'storyboard-lease' },
      'lease-start-duplicate'
    );
    assert.equal(duplicate.output.jobId, jobId);
    assert.equal(duplicate.state.videoJobs.length, 1);
    assert.equal(duplicate.state.videoArtifactShells.length, 1);
    await assert.rejects(
      service.execute(
        worker,
        {
          type: 'transition_video',
          jobId,
          workerId: 'worker-a',
          nextStatus: 'needs_action',
        },
        'lease-invalid-transition'
      ),
      (error) =>
        error instanceof DomainError &&
        error.code === 'VIDEO_STATE_TRANSITION_INVALID'
    );

    const claimed = await service.execute(
      worker,
      { type: 'claim_video', jobId, workerId: 'worker-a', leaseSeconds: 5 },
      'lease-claim-a'
    );
    claimed.state.videoJobs[0]!.leaseExpiresAt = '2000-01-01T00:00:00.000Z';
    await repository.save(claimed.state);
    await assert.rejects(
      service.execute(
        worker,
        {
          type: 'heartbeat_video',
          jobId,
          workerId: 'worker-a',
          leaseSeconds: 5,
        },
        'lease-expired-heartbeat'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'VIDEO_LEASE_NOT_OWNED'
    );
    await service.execute(
      worker,
      { type: 'claim_video', jobId, workerId: 'worker-b', leaseSeconds: 5 },
      'lease-claim-b'
    );
    await service.execute(
      worker,
      {
        type: 'transition_video',
        jobId,
        workerId: 'worker-b',
        nextStatus: 'running',
      },
      'lease-running'
    );
    const failed = await service.execute(
      worker,
      {
        type: 'transition_video',
        jobId,
        workerId: 'worker-b',
        nextStatus: 'failed',
        reason: 'reservation_expired',
      },
      'lease-expired'
    );
    assert.deepEqual(
      failed.state.usageEvents.map((event) => event.status),
      ['reserved', 'expired']
    );
    await assert.rejects(
      service.execute(
        worker,
        {
          type: 'transition_video',
          jobId,
          workerId: 'worker-b',
          nextStatus: 'queued',
        },
        'lease-terminal-overwrite'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'VIDEO_ALREADY_TERMINAL'
    );
    await assert.rejects(
      service.execute(
        merchant,
        { type: 'retry_video', jobId },
        'lease-invalid-retry'
      ),
      (error) =>
        error instanceof DomainError && error.code === 'VIDEO_RETRY_NOT_ALLOWED'
    );
  });

  it('strips reserved-namespace material from whatever any command path returns', async () => {
    // Path-agnostic: this pins the invariant at the public exit, not one
    // command. A fourth return path added inside executeCommand is covered by
    // construction — it cannot reach a caller without passing through here.
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const service = new ProductService({ repository });
    await service.execute(
      merchant,
      {
        asset: {
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'merchant-own-asset',
          mediaType: 'image',
          minorStatus: 'none',
          objectKey: 'workspace-a/assets/merchant-own.png',
          rightsOwner: '暮色美甲',
          sourceType: 'real',
          tags: [],
        },
        type: 'add_asset',
      },
      'any-path-seed'
    );
    const persisted = (await repository.load('workspace-a'))!;
    // Clone the merchant's own asset rather than hand-rolling one: the injected
    // row differs from a legitimate asset only by its reserved-namespace id,
    // which is exactly the distinction the filter is supposed to make.
    persisted.assets.push({
      ...persisted.assets[0]!,
      id: 'platform-sample:asset/any-path',
    });

    class LeakyProductService extends ProductService {
      protected override async executeCommand() {
        return { output: {}, state: persisted };
      }
    }
    const leaky = new LeakyProductService({ repository });
    const result = await leaky.execute(
      merchant,
      { type: 'hide_example', hidden: false },
      'any-path-invariant'
    );
    assert.deepEqual(
      result.state.assets
        .map((asset) => asset.id)
        .filter((id) => id.startsWith('platform-sample:')),
      []
    );
    // Selectivity, not emptiness: the merchant's own asset must survive the
    // same exit the injected one was stripped at.
    assert.ok(
      result.state.assets.some((asset) => asset.id === 'merchant-own-asset'),
      'the merchant own asset must stay in the projection'
    );
    // The example stores themselves are merchant-facing on purpose — the
    // showcase renders them; only reserved-namespace workspace material goes.
    assert.equal(result.state.exampleStores.length, 3);
  });

  it('keeps reserved-namespace material out of every merchant-facing result', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership('user-a', 'workspace-a');
    const provider = {
      name: 'isolation-copy-provider',
      model: 'isolation-copy-v1',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        return ['facts', 'experience', 'booking'].map((angle) => ({
          assetOrder: request.brief.assetIds,
          body: `${request.brief.hook} ${angle}`,
          conversionHook: angle,
          title: `${request.brief.hook}-${angle}`,
          topics: ['杭州美业'],
        }));
      },
    };
    const providers: CopyProviderRegistry = {
      domestic: provider,
      standard: provider,
    };
    const service = new ProductService({
      repository,
      copyProviders: providers,
    });
    await prepareCopyFixture(service, false);

    // Deliberate injection: reserved-namespace material sitting in the
    // workspace arrays is exactly what the projection filter exists to strip.
    const persisted = (await repository.load('workspace-a'))!;
    persisted.assets.push({
      ...persisted.assets[0]!,
      id: 'platform-sample:asset/leak',
    });
    await repository.save(persisted);

    const generated = await service.execute(
      merchant,
      copyCommand('隔离回归'),
      'sample-isolation-generate-copy'
    );
    assert.deepEqual(
      generated.state.assets
        .map((asset) => asset.id)
        .filter((id) => id.startsWith('platform-sample:')),
      []
    );
    // Positive control: the merchant's own asset survives the same filter.
    assert.ok(
      generated.state.assets.some((asset) => asset.id === 'asset-copy'),
      'the merchant own asset must stay in the projection'
    );
    // The persisted state keeps everything — samples are never written away.
    const after = (await repository.load('workspace-a'))!;
    assert.ok(
      after.assets.some((asset) => asset.id === 'platform-sample:asset/leak'),
      'persisted state stays authoritative'
    );
  });

});

function copyCommand(hook: string) {
  return {
    type: 'generate_copy' as const,
    brief: {
      assetIds: ['asset-copy'],
      conversionGoal: '预约到店',
      hook,
      platform: 'xiaohongshu' as const,
      projectId: 'project-copy',
      scenario: '项目种草',
      tone: '中性、克制',
    },
  };
}

async function addRealAsset(service: ProductService, assetId: string) {
  await service.execute(
    merchant,
    {
      asset: {
        category: 'store',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        id: assetId,
        mediaType: 'image',
        minorStatus: 'none',
        objectKey: `workspace-a/assets/${assetId}.png`,
        rightsOwner: '暮色美甲',
        sourceType: 'real',
        tags: [],
      },
      type: 'add_asset',
    },
    `${assetId}-add`
  );
}

async function prepareCopyFixture(
  service: ProductService,
  containsSensitiveData: boolean
) {
  await service.execute(
    merchant,
    {
      type: 'confirm_store',
      store: {
        name: '测试门店',
        city: '杭州',
        district: '拱墅区',
        address: '测试路 1 号',
        booking: '预约制',
        brandVoice: '中性、克制',
        prohibitions: [],
        accounts: [],
        projects: [
          {
            id: 'project-copy',
            name: '测试项目',
            price: 299,
            durationMinutes: 60,
            confirmed: true,
          },
        ],
        regulated: false,
      },
    },
    `copy-store-${containsSensitiveData}`
  );
  await service.execute(
    merchant,
    {
      type: 'add_asset',
      asset: {
        id: 'asset-copy',
        objectKey: 'workspace-a/assets/copy.jpg',
        mediaType: 'image',
        sourceType: 'real',
        category: 'store',
        tags: ['门店实拍'],
        rightsOwner: '测试门店',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData,
        minorStatus: 'none',
      },
    },
    `copy-asset-${containsSensitiveData}`
  );
  await service.execute(
    merchant,
    {
      type: 'authorize_asset',
      assetId: 'asset-copy',
      consentScope: 'public_marketing',
      rightsEvidence: 'owner-consent-asset-copy',
    },
    `copy-authorize-${containsSensitiveData}`
  );
}
