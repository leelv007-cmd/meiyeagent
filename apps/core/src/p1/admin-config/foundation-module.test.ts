import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
import { z } from 'zod';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';
import { createDefaultDeployments } from '../model-supply/catalog.js';
import { BOUNDED_EXECUTION_LIMITS_CONFIG_KEY } from './bounded-execution-limits.js';
import {
  AdminConfigFoundationModule,
  DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  MemoryAdminConfigRepository,
} from './foundation-module.js';

/** Explicit bypass for tests of AdminConfigFoundationModule's own scope rules. */
const moduleScopeAuthorizer: PermissionAuthorizerPort = {
  decide: () => ({ allow: true, required: null, reason: 'capability_granted' }),
  authorize: () => undefined,
};

describe('Admin config application seam', () => {
  const context = {
    workspaceId: 'workspace-a',
    userId: 'platform-admin',
    correlationId: 'config-apply-1',
    actor: 'admin' as const,
  };

  it('lets an admin persist a config value while keeping the boot-time effective value honest', async () => {
    const foundation = new MemoryFoundationRepository();
    const config = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(foundation, {
      operations: [
        new AdminConfigFoundationModule(config, {
          adminActorIds: ['platform-admin'],
          runtime: {
            'model.execution.mode': 'recorded',
          },
          activationEvidenceStatus: 'recorded_only',
        }),
      ],
    });
    const applied = await service.executeModule(
      context,
      'admin-config',
      {
        action: 'config_apply',
        payload: {
          key: 'model.execution.mode',
          value: 'direct',
          expectedRevision: null,
          reason: 'Prepare direct execution',
        },
      },
      'config-apply-1',
    );
    const projected = await service.queryModule(
      context,
      'admin-config',
      {
        action: 'config_get',
        payload: { key: 'model.execution.mode' },
      },
    );

    assert.deepEqual(applied, projected);
    assert.deepEqual(projected, {
      key: 'model.execution.mode',
      scope: 'global',
      storedValue: 'direct',
      effectiveValue: 'recorded',
      wired: false,
      activationEvidenceStatus: 'recorded_only',
      revision: 1,
      status: 'applied',
      rolledBackToRevision: null,
      actorId: 'platform-admin',
      reason: 'Prepare direct execution',
      correlationId: 'config-apply-1',
      createdAt: (projected as { createdAt: string }).createdAt,
    });
    assert.equal(
      Number.isFinite(
        Date.parse((projected as { createdAt: string }).createdAt),
      ),
      true,
    );
  });

  it('lists every registered config key before any stored value exists', async () => {
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository(), {
          runtime: {
            'model.execution.mode': 'recorded',
            'model.media.execution.mode': 'recorded',
          },
        }),
      ],
    });

    const projected = await service.queryModule<
      Record<string, unknown>,
      Array<{
        key: string;
        storedValue: unknown;
        effectiveValue: unknown;
        wired: boolean;
      }>
    >(context, 'admin-config', {
      action: 'config_list',
      payload: {},
    });

    assert.deepEqual(
      projected.map((item) => item.key),
      [
        ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
        'byok.adapter.assembly',
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
        'douyin.adapter.assembly',
        DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
        BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
        HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
        NOTE_STYLE_CONFIG_KEY,
        'harness.outbox.langfuse',
        HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
        HARNESS_WOZ_RECIPE_CONFIG_KEY,
        ...createDefaultDeployments()
          .map(
            (deployment) =>
              `model.activation.evidence.${deployment.id}`,
          )
          .sort(),
        'model.execution.mode',
        'model.media.execution.mode',
        'plan.addons',
        'plan.allowances.growth',
        'plan.allowances.pro',
        'plan.allowances.starter',
        'plan.allowances.trial',
        'plan.payment-mapping',
        'plan.trial.enabled',
        'platform.defaultModel.audio',
        'platform.defaultModel.copy',
        'platform.defaultModel.image',
        'platform.defaultModel.video',
      ],
    );
    assert.ok(
      projected.every(
        (item) => item.storedValue === null && item.wired === false,
      ),
    );
    assert.equal(
      projected.find((item) => item.key === 'model.execution.mode')
        ?.effectiveValue,
      'recorded',
    );
  });

  it('projects mode assemblability and missing requirements from the apply validator', async () => {
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository(), {
          valueValidators: {
            'model.media.execution.mode': (value) => {
              if (value === 'tuzi' || value === 'ark,tuzi') {
                throw new Error('TUZI_MEDIA_API_KEY is required.');
              }
            },
          },
        }),
      ],
    });

    const projected = await service.queryModule<
      Record<string, unknown>,
      Array<{
        key: string;
        modeAvailability?: Array<{
          assemblable: boolean;
          missingRequirements: string[];
          value: string;
        }>;
      }>
    >(context, 'admin-config', {
      action: 'config_list',
      payload: {},
    });
    const media = projected.find(
      (item) => item.key === 'model.media.execution.mode'
    );

    assert.deepEqual(media?.modeAvailability, [
      { assemblable: true, missingRequirements: [], value: 'disabled' },
      { assemblable: true, missingRequirements: [], value: 'ark' },
      {
        assemblable: false,
        missingRequirements: ['TUZI_MEDIA_API_KEY'],
        value: 'tuzi',
      },
      {
        assemblable: false,
        missingRequirements: ['TUZI_MEDIA_API_KEY'],
        value: 'ark,tuzi',
      },
    ]);
  });

  it('does not create a new revision when an admin reapplies the same value', async () => {
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository()),
      ],
    });
    const command = (expectedRevision: number | null) => ({
      action: 'config_apply',
      payload: {
        key: 'compliance.watermark.default',
        value: true,
        expectedRevision,
        reason: 'Keep the approved default',
      },
    });

    const first = await service.executeModule(
      context,
      'admin-config',
      command(null),
      'watermark-apply-1',
    );
    const second = await service.executeModule(
      context,
      'admin-config',
      command(1),
      'watermark-apply-2',
    );
    const history = await service.queryModule<
      Record<string, unknown>,
      Array<{ revision: number }>
    >(context, 'admin-config', {
      action: 'config_history',
      payload: { key: 'compliance.watermark.default' },
    });

    assert.deepEqual(second, first);
    assert.deepEqual(
      history.map((revision) => revision.revision),
      [1],
    );
  });

  it('governs the global trial switch with CAS and audited history', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [new AdminConfigFoundationModule(repository)],
    });
    const apply = (value: boolean, expectedRevision: number | null) =>
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: 'plan.trial.enabled',
            value,
            expectedRevision,
            reason: `Set new workspace trials to ${String(value)}`,
          },
        },
        `trial-switch-${String(value)}-${String(expectedRevision)}`,
      );

    await apply(false, null);
    await assert.rejects(apply(true, null), /Config head changed/u);
    await apply(true, 1);
    const history = await repository.history(
      'global',
      '__global__',
      'plan.trial.enabled',
    );
    assert.deepEqual(
      history.map(({ actorId, revision, value }) => ({
        actorId,
        revision,
        value,
      })),
      [
        { actorId: 'platform-admin', revision: 1, value: false },
        { actorId: 'platform-admin', revision: 2, value: true },
      ],
    );
  });

  it('governs confirmation-card timeout with CAS and audited history', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [new AdminConfigFoundationModule(repository)],
    });
    const apply = (value: number, expectedRevision: number | null) =>
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
            value,
            expectedRevision,
            reason: `Set confirmation-card timeout to ${String(value)} seconds`,
          },
        },
        `confirmation-timeout-${String(value)}-${String(expectedRevision)}`,
      );

    await apply(30, null);
    await assert.rejects(apply(45, null), /Config head changed/u);
    await apply(45, 1);
    await assert.rejects(
      apply(3_601, 2),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE',
    );
    const history = await repository.history(
      'global',
      '__global__',
      HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
    );
    assert.deepEqual(
      history.map(({ actorId, revision, value }) => ({
        actorId,
        revision,
        value,
      })),
      [
        { actorId: 'platform-admin', revision: 1, value: 30 },
        { actorId: 'platform-admin', revision: 2, value: 45 },
      ],
    );
  });

  it('accepts only bounded positive integer due-delivery retention days', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(repository, {
          hotReadKeys: [DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY],
          wiredKeys: [DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY],
        }),
      ],
    });
    const apply = (value: number, correlationId: string) =>
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
            value,
            expectedRevision: null,
            reason: 'Set due-delivery terminal retention.',
          },
        },
        correlationId,
      );

    await apply(7, 'due-retention-valid');
    for (const [value, correlationId] of [
      [0, 'due-retention-zero'],
      [3_651, 'due-retention-over-max'],
      [1.5, 'due-retention-fraction'],
    ] as const) {
      await assert.rejects(
        apply(value, correlationId),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'INVALID_STATE',
      );
    }
  });

  it('applies the confirmation hold timeout through the wired hot-read control', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(repository, {
          hotReadKeys: [HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY],
          runtime: {
            [HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY]: 172_800,
          },
          wiredKeys: [HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY],
        }),
      ],
    });

    await service.executeModule(
      context,
      'admin-config',
      {
        action: 'config_apply',
        payload: {
          key: HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
          value: 86_400,
          expectedRevision: null,
          reason: 'Set the confirmation hold timeout.',
        },
      },
      'confirmation-hold-timeout-1',
    );
    const projected = (await service.queryModule(
      context,
      'admin-config',
      {
        action: 'config_get',
        payload: {
          key: HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
        },
      },
    )) as {
      effectiveValue: unknown;
      storedValue: unknown;
      wired: boolean;
    };

    assert.equal(projected.storedValue, 86_400);
    assert.equal(projected.effectiveValue, 86_400);
    assert.equal(projected.wired, true);
    await assert.rejects(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
            value: 3_599,
            expectedRevision: 1,
            reason: 'Reject an unsafe confirmation hold timeout.',
          },
        },
        'confirmation-hold-timeout-floor',
      ),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'INVALID_STATE',
    );
    await assert.rejects(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
            value: 172_801,
            expectedRevision: 1,
            reason: 'Set an invalid confirmation hold timeout.',
          },
        },
        'confirmation-hold-timeout-2',
      ),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'INVALID_STATE',
    );
  });

  it('projects HTTP and worker effective modes independently for runtime keys', async () => {
    const repository = new MemoryAdminConfigRepository();
    await repository.apply({
      actorId: context.userId,
      correlationId: context.correlationId,
      expectedRevision: null,
      key: 'model.execution.mode',
      reason: 'switch after restart',
      scope: 'global',
      value: 'disabled',
      workspaceId: '__global__',
    });
    await repository.upsertEffectiveSnapshot({
      bootedAt: '2026-07-15T10:00:00.000Z',
      executionMode: 'recorded',
      executionSource: { source: 'db_revision', revision: 1 },
      fallbackReason: null,
      mediaMode: 'disabled',
      mediaSource: { source: 'env_fallback' },
      processKind: 'http',
    });
    await repository.upsertEffectiveSnapshot({
      bootedAt: '2026-07-15T10:01:00.000Z',
      executionMode: 'disabled',
      executionSource: { source: 'db_revision', revision: 2 },
      fallbackReason: null,
      mediaMode: 'disabled',
      mediaSource: { source: 'env_fallback' },
      processKind: 'job-worker',
    });
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(repository, {
          runtime: { 'model.execution.mode': 'recorded' },
          wiredKeys: ['model.execution.mode'],
        }),
      ],
    });

    const projected = await service.queryModule<
      Record<string, unknown>,
      { effectiveSnapshots: Array<Record<string, unknown>> }
    >(context, 'admin-config', {
      action: 'config_get',
      payload: { key: 'model.execution.mode' },
    });

    assert.deepEqual(projected.effectiveSnapshots, [
      {
        bootedAt: '2026-07-15T10:00:00.000Z',
        effectiveValue: 'recorded',
        fallbackReason: null,
        processKind: 'http',
        source: { source: 'db_revision', revision: 1 },
      },
      {
        bootedAt: '2026-07-15T10:01:00.000Z',
        effectiveValue: 'disabled',
        fallbackReason: null,
        processKind: 'job-worker',
        source: { source: 'db_revision', revision: 2 },
      },
    ]);
  });

  it('rolls back by appending an audited revision without rewriting history', async () => {
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository()),
      ],
    });
    const apply = (value: boolean, expectedRevision: number | null) =>
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: 'compliance.aigc_label.default',
            value,
            expectedRevision,
            reason: `Set default to ${value}`,
          },
        },
        `aigc-apply-${String(value)}`,
      );
    await apply(false, null);
    await apply(true, 1);

    const rolledBack = await service.executeModule<
      Record<string, unknown>,
      { revision: number; storedValue: boolean; rolledBackToRevision: number }
    >(
      context,
      'admin-config',
      {
        action: 'config_rollback',
        payload: {
          key: 'compliance.aigc_label.default',
          targetRevision: 1,
          expectedRevision: 2,
          reason: 'Restore the launch default',
        },
      },
      'aigc-rollback-1',
    );
    const history = await service.queryModule<
      Record<string, unknown>,
      Array<{
        revision: number;
        storedValue: boolean;
        status: string;
        rolledBackToRevision: number | null;
      }>
    >(context, 'admin-config', {
      action: 'config_history',
      payload: { key: 'compliance.aigc_label.default' },
    });

    assert.deepEqual(
      {
        revision: rolledBack.revision,
        storedValue: rolledBack.storedValue,
        rolledBackToRevision: rolledBack.rolledBackToRevision,
      },
      { revision: 3, storedValue: false, rolledBackToRevision: 1 },
    );
    assert.deepEqual(
      history.map((revision) => ({
        revision: revision.revision,
        storedValue: revision.storedValue,
        status: revision.status,
        rolledBackToRevision: revision.rolledBackToRevision,
      })),
      [
        {
          revision: 1,
          storedValue: false,
          status: 'applied',
          rolledBackToRevision: null,
        },
        {
          revision: 2,
          storedValue: true,
          status: 'applied',
          rolledBackToRevision: null,
        },
        {
          revision: 3,
          storedValue: false,
          status: 'rolled_back',
          rolledBackToRevision: 1,
        },
      ],
    );
  });

  it('rejects secret-shaped values before they can enter config history', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [new AdminConfigFoundationModule(repository)],
    });

    await assert.rejects(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key: 'model.execution.mode',
            value: 'sk-test-secret-value',
            expectedRevision: null,
            reason: 'Must be rejected',
          },
        },
        'secret-shaped-config',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE' &&
        /secret/i.test(error.message),
    );
    assert.deepEqual(
      await repository.history(
        'global',
        '__global__',
        'model.execution.mode',
      ),
      [],
    );
  });

  it('rejects operationally unsafe plan and add-on upper bounds', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [new AdminConfigFoundationModule(repository)],
    });
    const unsafeConfigs = [
      {
        key: 'plan.allowances.growth',
        value: {
          allowance: { audio: 0, copy: 1_000_001, image: 40, video: 20 },
          concurrencyLimit: 4,
          queuePriority: 5,
          supportLabel: 'priority',
        },
      },
      {
        key: 'plan.allowances.starter',
        value: {
          allowance: { audio: 0, copy: 30, image: 10, video: 5 },
          concurrencyLimit: 1,
          expireDays: 7,
          queuePriority: 1,
          supportLabel: 'standard',
        },
      },
      {
        key: 'plan.allowances.growth',
        value: {
          allowance: { audio: 0, copy: 100, image: 40, video: 20 },
          concurrencyLimit: 101,
          queuePriority: 5,
          supportLabel: 'priority',
        },
      },
      {
        key: 'plan.addons',
        value: [
          {
            id: 'copy-unbounded',
            resource: 'copy',
            quantity: 20,
            amountMicros: 1_000_000_000_001,
            currency: 'CNY',
          },
        ],
      },
      {
        key: 'plan.addons',
        value: Array.from({ length: 101 }, (_, index) => ({
          id: `copy-${index}`,
          resource: 'copy',
          quantity: 20,
          amountMicros: 990_000,
          currency: 'CNY',
        })),
      },
    ];

    for (const [index, config] of unsafeConfigs.entries()) {
      await assert.rejects(
        service.executeModule(
          context,
          'admin-config',
          {
            action: 'config_apply',
            payload: {
              ...config,
              expectedRevision: null,
              reason: 'Reject unsafe commercial configuration',
            },
          },
          `unsafe-commercial-config-${index}`,
        ),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'INVALID_STATE',
      );
    }

    await assert.doesNotReject(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            expectedRevision: null,
            key: 'plan.allowances.growth',
            reason: 'Accept the documented commercial boundary',
            value: {
              allowance: {
                audio: 1_000_000,
                copy: 1_000_000,
                image: 1_000_000,
                video: 1_000_000,
              },
              concurrencyLimit: 100,
              queuePriority: 100,
              supportLabel: 'priority',
            },
          },
        },
        'commercial-config-at-boundary',
      ),
    );
    await assert.doesNotReject(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            expectedRevision: null,
            key: 'plan.allowances.trial',
            reason: 'Accept the fixed-days trial boundary',
            value: {
              allowance: { audio: 0, copy: 5, image: 5, video: 1 },
              concurrencyLimit: 1,
              expireDays: 366,
              queuePriority: 1,
              supportLabel: 'standard',
            },
          },
        },
        'trial-expire-days-at-boundary',
      ),
    );
    await assert.doesNotReject(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            expectedRevision: null,
            key: 'plan.addons',
            reason: 'Accept the add-on catalog boundary',
            value: Array.from({ length: 100 }, (_, index) => ({
              id: `copy-boundary-${index}`,
              resource: 'copy',
              quantity: 1_000_000,
              amountMicros: 1_000_000_000_000,
              currency: 'CNY',
            })),
          },
        },
        'add-on-config-at-boundary',
      ),
    );
  });

  it('rejects hand-written activation evidence through config_apply', async () => {
    const repository = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [new AdminConfigFoundationModule(repository)],
    });
    const key = 'model.activation.evidence.openai-direct-recorded';

    await assert.rejects(
      service.executeModule(
        context,
        'admin-config',
        {
          action: 'config_apply',
          payload: {
            key,
            value: {
              configurationRevision: 'f'.repeat(64),
              evidenceRef: `activation-probe-${'a'.repeat(28)}`,
              status: 'live_verified',
              verifiedAt: '2026-07-15T00:00:00.000Z',
            },
            expectedRevision: null,
            reason: 'Must come from a probe',
          },
        },
        'manual-activation-evidence',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE' &&
        /activation_probe_run/.test(error.message),
    );
    assert.deepEqual(await repository.history('global', '__global__', key), []);
  });

  it('keeps workspace-scoped config isolated while denying global config to merchant roles', async () => {
    const foundation = new MemoryFoundationRepository();
    foundation.grantOwner('workspace-a', 'owner-a');
    foundation.grantOwner('workspace-b', 'owner-b');
    const service = new P1ApplicationService(foundation, {
      authorizer: moduleScopeAuthorizer,
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository(), {
          additionalDefinitions: [
            {
              key: 'workspace.test.setting',
              scope: 'workspace',
              description: 'Workspace isolation test setting.',
              valueSchema: z.boolean(),
            },
          ],
        }),
      ],
    });
    const ownerA = {
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      correlationId: 'workspace-a-config',
      actor: 'owner' as const,
    };
    const ownerB = {
      workspaceId: 'workspace-b',
      userId: 'owner-b',
      correlationId: 'workspace-b-config',
      actor: 'owner' as const,
    };

    await service.executeModule(
      ownerA,
      'admin-config',
      {
        action: 'config_apply',
        payload: {
          key: 'workspace.test.setting',
          value: true,
          expectedRevision: null,
          reason: 'Workspace A setting',
        },
      },
      'workspace-a-setting',
    );
    const visibleToA = await service.queryModule<
      Record<string, unknown>,
      { storedValue: unknown }
    >(ownerA, 'admin-config', {
      action: 'config_get',
      payload: { key: 'workspace.test.setting' },
    });
    const invisibleToB = await service.queryModule<
      Record<string, unknown>,
      { storedValue: unknown }
    >(ownerB, 'admin-config', {
      action: 'config_get',
      payload: { key: 'workspace.test.setting' },
    });

    assert.equal(visibleToA.storedValue, true);
    assert.equal(invisibleToB.storedValue, null);
    await assert.rejects(
      service.queryModule(ownerA, 'admin-config', {
        action: 'config_get',
        payload: { key: 'model.execution.mode' },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
    );

    const defaultService = new P1ApplicationService(foundation, {
      authorizer: moduleScopeAuthorizer,
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository()),
      ],
    });
    const workspaceVisible = await defaultService.queryModule<
      Record<string, unknown>,
      Array<{ key: string }>
    >(ownerA, 'admin-config', {
        action: 'config_list',
        payload: {},
      });
    assert.deepEqual(
      workspaceVisible.map((item) => item.key),
      [HARNESS_WOZ_RECIPE_CONFIG_KEY],
    );
  });

  it('exposes only effective compliance defaults to workspace members', async () => {
    const foundation = new MemoryFoundationRepository();
    foundation.grantOwner('workspace-a', 'merchant-owner');
    const config = new MemoryAdminConfigRepository();
    await config.apply({
      scope: 'global',
      workspaceId: '__global__',
      key: 'compliance.regulated_mode.default',
      value: true,
      expectedRevision: null,
      actorId: 'platform-admin',
      reason: 'Default regulated mode',
      correlationId: 'config-defaults-1',
    });
    const service = new P1ApplicationService(foundation, {
      operations: [
        new AdminConfigFoundationModule(config, {
          runtime: {
            'compliance.aigc_label.default': true,
            'compliance.regulated_mode.default': false,
            'compliance.watermark.default': false,
          },
        }),
      ],
    });

    const result = await service.queryModule(
      {
        workspaceId: 'workspace-a',
        userId: 'merchant-owner',
        correlationId: 'config-defaults-query',
        actor: 'owner',
      },
      'admin-config',
      { action: 'config_defaults', payload: {} },
    );

    assert.deepEqual(result, {
      'compliance.aigc_label.default': true,
      'compliance.regulated_mode.default': true,
      'compliance.watermark.default': false,
    });
    assert.equal(JSON.stringify(result).includes('actorId'), false);
  });

  it('reports hot-read commerce config as effective immediately', async () => {
    const config = new MemoryAdminConfigRepository();
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(config, {
          hotReadKeys: ['plan.allowances.growth'],
          runtime: {
            'plan.allowances.growth': {
              allowance: { audio: 0, copy: 100, image: 40, video: 20 },
              concurrencyLimit: 4,
              queuePriority: 5,
              supportLabel: 'priority',
            },
          },
          wiredKeys: ['plan.allowances.growth'],
        }),
      ],
    });
    const value = {
      allowance: { audio: 0, copy: 120, image: 48, video: 24 },
      concurrencyLimit: 5,
      queuePriority: 6,
      supportLabel: 'priority',
    };
    await service.executeModule(
      context,
      'admin-config',
      {
        action: 'config_apply',
        payload: {
          expectedRevision: null,
          key: 'plan.allowances.growth',
          reason: 'Apply the new growth package immediately',
          value,
        },
      },
      'hot-growth-config',
    );

    const projected = (await service.queryModule(
      context,
      'admin-config',
      {
        action: 'config_get',
        payload: { key: 'plan.allowances.growth' },
      },
    )) as { effectiveValue: unknown; storedValue: unknown; wired: boolean };

    assert.deepEqual(projected.storedValue, value);
    assert.deepEqual(projected.effectiveValue, value);
    assert.equal(projected.wired, true);
  });

  it('reports platform model defaults as wired hot-read config with global activation evidence', async () => {
    const config = new MemoryAdminConfigRepository();
    const key = 'platform.defaultModel.image';
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(config, {
          activationEvidenceStatus: 'live_verified',
          hotReadKeys: [key],
          wiredKeys: [key],
        }),
      ],
    });
    await service.executeModule(
      context,
      'admin-config',
      {
        action: 'config_apply',
        payload: {
          expectedRevision: null,
          key,
          reason: 'Set the platform image default for new workspaces',
          value: 'gpt-image-2',
        },
      },
      'platform-default-image-config',
    );

    const projected = (await service.queryModule(
      context,
      'admin-config',
      { action: 'config_get', payload: { key } },
    )) as {
      activationEvidenceStatus: string | null;
      effectiveValue: unknown;
      storedValue: unknown;
      wired: boolean;
    };

    assert.equal(projected.storedValue, 'gpt-image-2');
    assert.equal(projected.effectiveValue, 'gpt-image-2');
    assert.equal(projected.wired, true);
    assert.equal(projected.activationEvidenceStatus, 'live_verified');
  });

  it('returns built-in boolean compliance defaults when no config has been written', async () => {
    const foundation = new MemoryFoundationRepository();
    foundation.grantOwner('workspace-a', 'merchant-owner');
    const service = new P1ApplicationService(foundation, {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository()),
      ],
    });

    assert.deepEqual(
      await service.queryModule(
        {
          workspaceId: 'workspace-a',
          userId: 'merchant-owner',
          correlationId: 'default-compliance-query',
          actor: 'owner',
        },
        'admin-config',
        { action: 'config_defaults', payload: {} },
      ),
      {
        'compliance.aigc_label.default': true,
        'compliance.regulated_mode.default': false,
        'compliance.watermark.default': false,
      },
    );
  });

  it('exposes the injected Cloudflare read-only inventory without fixture fallback', async () => {
    const inventory = {
      mappingRef: 'production-worker',
      capturedAt: '2026-07-20T08:00:00.000Z',
      freshness: 'unknown' as const,
      deployments: {
        status: 'unknown' as const,
        reason: 'token_missing' as const,
        freshness: 'unknown' as const,
      },
      versions: {
        status: 'unknown' as const,
        reason: 'token_missing' as const,
        freshness: 'unknown' as const,
      },
      resources: [],
      cloudflareQueuesEnabled: false as const,
      graphqlAnalyticsDeferred: true as const,
      cache: { hit: false, ttlMs: 120_000, ageMs: null },
    };
    const service = new P1ApplicationService(new MemoryFoundationRepository(), {
      operations: [
        new AdminConfigFoundationModule(new MemoryAdminConfigRepository(), {
          cloudflareInventory: {
            async getInventory() {
              return inventory;
            },
          },
          cloudflareSelfProbes: async () => [
            {
              kind: 'database_connectivity',
              status: 'ok',
              businessImpact: '业务库连通',
              observedAt: '2026-07-20T08:00:01.000Z',
              mutatesCloudflare: false,
            },
          ],
        }),
      ],
    });

    assert.deepEqual(
      await service.queryModule(context, 'admin-config', {
        action: 'cloudflare_inventory',
        payload: {},
      }),
      {
        inventory,
        probes: [
          {
            kind: 'database_connectivity',
            status: 'ok',
            businessImpact: '业务库连通',
            observedAt: '2026-07-20T08:00:01.000Z',
            mutatesCloudflare: false,
          },
        ],
      },
    );
  });
});
