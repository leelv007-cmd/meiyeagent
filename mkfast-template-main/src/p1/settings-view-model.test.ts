import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  readCurrentModelSelection,
  writeCurrentModelSelection,
} from './model-current-selection';
import {
  canReconcileFeishuIntent,
  eligibleDouyinPublishAnchorKinds,
  normalizeCatalog,
  normalizeConnections,
  normalizeDouyinContentSnapshots,
  normalizeDouyinIntegrationStatus,
  normalizeDouyinOperationsSnapshot,
  normalizeFeishuActivity,
  normalizeFeishuRecoveryIntents,
  normalizeFeishuShortcuts,
  normalizeFeishuTools,
  normalizeIntegrationAudit,
  normalizePreferences,
  selectAvailableCatalogModel,
} from './settings-view-model';

describe('P1 settings view models', () => {
  it('normalizes the runtime Douyin integration status without inventing live capability', () => {
    assert.deepEqual(
      normalizeDouyinIntegrationStatus({
        provider: 'douyin',
        integrated: false,
        executionMode: 'recorded',
      }),
      {
        provider: 'douyin',
        integrated: false,
        executionMode: 'recorded',
      }
    );
    assert.deepEqual(
      normalizeDouyinIntegrationStatus({
        provider: 'douyin',
        integrated: true,
        executionMode: 'live',
      }),
      {
        provider: 'douyin',
        integrated: true,
        executionMode: 'live',
      }
    );
  });

  it('keeps the current generation override separate in session storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };

    storage.setItem(
      'meiye:p1:model-selection:v1:copy.generate',
      JSON.stringify({ mode: 'auto' })
    );
    writeCurrentModelSelection(
      'image.generate',
      { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      storage
    );

    assert.equal(
      readCurrentModelSelection('copy.generate', storage),
      undefined
    );
    assert.equal(
      storage.getItem('meiye:p1:model-selection:v1:copy.generate'),
      null
    );
    assert.deepEqual(readCurrentModelSelection('image.generate', storage), {
      catalogModelId: 'gpt-image-2',
      mode: 'fixed',
    });
    assert.equal(
      readCurrentModelSelection('video.generate', storage),
      undefined
    );
  });

  it('derives a complete public catalog without leaking routing details', () => {
    const catalog = normalizeCatalog(
      {
        models: [
          {
            id: 'llm-openai',
            displayName: 'OpenAI Direct',
            modality: 'llm',
            operations: ['copy.generate'],
            qualityRank: 95,
          },
          {
            id: 'llm-gemini',
            displayName: 'Gemini Direct',
            modality: 'llm',
            operations: ['copy.generate'],
            qualityRank: 88,
          },
        ],
        deployments: [
          {
            catalogModelId: 'llm-openai',
            status: 'active',
            activationEvidence: { status: 'live_verified' },
            priceRevision: 'llm-openai:price-v1',
            unitPrice: {
              amountMicros: 20_000,
              currency: 'USD',
              unit: 'request',
            },
            channel: 'direct',
            endpoint: 'https://private.example.test',
          },
          {
            catalogModelId: 'llm-gemini',
            status: 'inactive',
            channel: 'managed',
            unavailableReason: 'credential_unavailable',
          },
        ],
      },
      'copy.generate'
    );

    assert.equal('supportsAuto' in catalog, false);
    assert.deepEqual(catalog.models, [
      {
        available: true,
        availabilityKind: 'production',
        capabilityLabels: ['文案生成'],
        displayName: 'OpenAI',
        id: 'llm-openai',
        modality: 'llm',
        qualityRank: 95,
        unitPrice: {
          amountMicros: 20_000,
          currency: 'USD',
          revision: 'llm-openai:price-v1',
          unit: 'request',
        },
      },
      {
        available: false,
        availabilityKind: 'unavailable',
        capabilityLabels: ['文案生成'],
        displayName: 'Google Gemini',
        id: 'llm-gemini',
        modality: 'llm',
        qualityRank: 88,
        unavailableReason: '缺少可用凭据',
      },
    ]);
    assert.equal(JSON.stringify(catalog).includes('channel'), false);
    assert.equal(JSON.stringify(catalog).includes('endpoint'), false);
  });

  it('keeps defaults, favorites and recent choices independent', () => {
    assert.deepEqual(
      normalizePreferences({
        workspaceDefault: 'llm-openai',
        userDefault: 'llm-gemini',
        favorites: ['llm-gemini'],
        recent: ['llm-openai', 'llm-gemini'],
      }),
      {
        workspaceDefault: 'llm-openai',
        userDefault: 'llm-gemini',
        favorites: ['llm-gemini'],
        recent: ['llm-openai', 'llm-gemini'],
      }
    );
  });

  it('keeps a recorded catalog unavailable without exposing activation evidence', () => {
    const catalog = normalizeCatalog(
      {
        models: [
          {
            id: 'seedream-5-pro',
            displayName: 'Seedream 5.0 Pro',
            modality: 'image',
            operations: ['image.generate', 'image.edit'],
            capabilities: ['image.generate', 'image.edit'],
            availability: 'recorded',
            activationEvidence: { status: 'recorded' },
            manufacturer: 'ByteDance',
            stableModelName: 'Seedream 5.0 Pro',
            version: '5.0',
            qualityRank: 88,
          },
        ],
      },
      'image.generate'
    );

    assert.equal(catalog.models[0]?.available, false);
    assert.equal(catalog.models[0]?.unavailableReason, '尚未完成可用性验证');
    assert.equal(catalog.models[0]?.manufacturer, 'ByteDance');
    assert.equal(catalog.models[0]?.version, '5.0');
    assert.equal(JSON.stringify(catalog).includes('activationEvidence'), false);
  });

  it('keeps audio models and both audio operations in the public catalog', () => {
    const payload = {
      models: [
        {
          activationEvidence: { status: 'live_verified' },
          availability: 'available',
          displayName: 'Audio Studio',
          id: 'audio-studio',
          modality: 'audio',
          operations: ['audio.speech', 'audio.sfx'],
          qualityRank: 90,
        },
      ],
    };
    const speech = normalizeCatalog(payload, 'audio.speech');
    const sfx = normalizeCatalog(payload, 'audio.sfx');

    assert.equal(speech.models[0]?.modality, 'audio');
    assert.deepEqual(speech.models[0]?.capabilityLabels, [
      '语音生成',
      '音效生成',
    ]);
    assert.equal(sfx.models[0]?.modality, 'audio');
  });

  it('removes recorded-only model identifiers from the public catalog', () => {
    const catalog = normalizeCatalog(
      {
        models: [
          {
            activationEvidence: { status: 'recorded' },
            availability: 'recorded',
            displayName: 'OpenAI Direct',
            id: 'llm-openai',
            manufacturer: 'OpenAI',
            modality: 'llm',
            operations: ['copy.generate'],
            stableModelName: 'recorded-openai-copy',
            version: 'recorded-v1',
          },
          {
            activationEvidence: { status: 'live_verified' },
            availability: 'available',
            displayName: 'GPT-4.1 Direct',
            id: 'llm-public-version',
            manufacturer: 'OpenAI',
            modality: 'llm',
            operations: ['copy.generate'],
            stableModelName: 'gpt-4.1',
            version: '2025-04-14',
          },
        ],
      },
      'copy.generate'
    );

    assert.equal(catalog.models[0]?.manufacturer, 'OpenAI');
    assert.equal('stableModelName' in catalog.models[0]!, false);
    assert.equal('version' in catalog.models[0]!, false);
    assert.equal(catalog.models[1]?.manufacturer, 'OpenAI');
    assert.equal(catalog.models[1]?.stableModelName, 'gpt-4.1');
    assert.equal(catalog.models[1]?.version, '2025-04-14');
    assert.doesNotMatch(JSON.stringify(catalog), /recorded-/i);
  });

  it('accepts an explicit local-fixture execution flag without claiming live evidence', () => {
    const catalog = normalizeCatalog(
      {
        models: [
          {
            id: 'llm-openai',
            displayName: 'OpenAI',
            modality: 'llm',
            operations: ['copy.generate'],
            availability: 'recorded',
            activationEvidence: { status: 'recorded' },
            available: true,
          },
        ],
      },
      'copy.generate'
    );

    assert.equal(catalog.models[0]?.available, true);
    assert.equal(catalog.models[0]?.availabilityKind, 'local_fixture');
    assert.equal(catalog.models[0]?.unavailableReason, undefined);
    assert.equal(JSON.stringify(catalog).includes('activationEvidence'), false);
  });

  it('labels live-verified models as production available', () => {
    const catalog = normalizeCatalog(
      {
        models: [
          {
            id: 'llm-openai',
            displayName: 'OpenAI',
            modality: 'llm',
            operations: ['copy.generate'],
            availability: 'available',
            activationEvidence: { status: 'live_verified' },
            available: true,
          },
        ],
      },
      'copy.generate'
    );

    assert.equal(catalog.models[0]?.available, true);
    assert.equal(catalog.models[0]?.availabilityKind, 'production');
  });

  it('selects an available operation model without depending on a catalog id', () => {
    assert.equal(
      selectAvailableCatalogModel({
        models: [
          {
            available: false,
            availabilityKind: 'unavailable',
            capabilityLabels: ['文案改写'],
            displayName: 'Unavailable default',
            id: 'llm-openai',
            modality: 'llm',
            qualityRank: 100,
          },
          {
            available: true,
            availabilityKind: 'production',
            capabilityLabels: ['文案改写'],
            displayName: 'Workspace model',
            id: 'workspace-copy-adapt',
            modality: 'llm',
            qualityRank: 90,
          },
        ],
      })?.id,
      'workspace-copy-adapt'
    );
  });

  it('returns write-only connection projections without secret references', () => {
    const connections = normalizeConnections([
      {
        id: 'douyin-main',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish', 'observe', 'publish.poi'],
        grantedCapabilities: ['publish', 'observe', 'publish.poi'],
        capabilityEvidence: {
          observe: {
            endpoint: 'https://private.example.test',
            revision: '2026-07',
            verifiedAt: '2026-07-11T00:00:00.000Z',
          },
          'publish.poi': {
            qualified: true,
            revision: '2026-07-poi',
            verifiedAt: '2026-07-11T00:00:00.000Z',
          },
        },
        degradedCapabilities: { publish: 'permission_missing' },
        refreshReauthorizationReminder: true,
        status: 'degraded',
        subject: '@beauty',
        secretRef: 'secret://must-not-leak',
        credential: {
          mask: '••••••••',
          scope: ['publish', 'observe'],
          status: 'active',
          version: 2,
        },
      },
    ]);

    assert.deepEqual(connections[0], {
      activeCapabilities: ['observe', 'publish.poi'],
      credential: {
        mask: '••••••••',
        scope: ['publish', 'observe'],
        status: 'active',
        version: 2,
      },
      degradedCapabilities: { publish: 'permission_missing' },
      grantedCapabilities: ['publish', 'observe', 'publish.poi'],
      id: 'douyin-main',
      identityMode: 'oauth_user',
      provider: 'douyin',
      refreshReauthorizationReminder: true,
      qualifiedCapabilities: ['publish.poi'],
      requestedCapabilities: ['publish', 'observe', 'publish.poi'],
      status: 'degraded',
      subject: '@beauty',
    });
    assert.equal(JSON.stringify(connections).includes('secret'), false);
    assert.equal(JSON.stringify(connections).includes('endpoint'), false);
    assert.deepEqual(eligibleDouyinPublishAnchorKinds(connections[0]!), [
      'poi',
    ]);
    assert.deepEqual(
      eligibleDouyinPublishAnchorKinds({
        ...connections[0]!,
        grantedCapabilities: ['publish', 'observe'],
      }),
      []
    );

    const stopped = normalizeConnections([
      {
        id: 'douyin-stopped',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['observe'],
        grantedCapabilities: ['observe'],
        capabilityEvidence: { observe: { revision: 'provider-v1' } },
        degradedCapabilities: { observe: 'disabled_by_owner' },
        status: 'degraded',
        credential: { scope: ['observe'], status: 'active', version: 1 },
      },
    ]);
    assert.deepEqual(stopped[0]?.activeCapabilities, []);
    assert.deepEqual(stopped[0]?.qualifiedCapabilities, []);
  });

  it('projects BYOK audit evidence without exposing secret-bearing details', () => {
    const audit = normalizeIntegrationAudit({
      events: [
        {
          action: 'byok.completed',
          actorId: 'workspace-owner',
          connectionId: 'byok-main',
          correlationId: 'correlation-byok-1',
          createdAt: '2026-07-15T12:00:00.000Z',
          details: {
            apiKey: 'must-not-surface',
            catalogModelId: 'llm-domestic',
            credentialVersion: 3,
            endpointProfileId: 'openai-compatible-default',
            providerCostStatus: 'must-not-surface',
            secretRef: 'must-not-surface',
            usageStatus: 'committed',
          },
          id: 'audit-byok-1',
        },
        {
          action: 'connection.created',
          connectionId: 'byok-main',
          createdAt: '2026-07-15T11:00:00.000Z',
          details: { apiKey: 'must-not-surface' },
          id: 'audit-connection-1',
        },
      ],
    });

    assert.deepEqual(audit[0], {
      action: 'byok.completed',
      actorId: 'workspace-owner',
      connectionId: 'byok-main',
      correlationId: 'correlation-byok-1',
      createdAt: '2026-07-15T12:00:00.000Z',
      details: {
        catalogModelId: 'llm-domestic',
        credentialVersion: 3,
        endpointProfileId: 'openai-compatible-default',
        usageStatus: 'committed',
      },
      id: 'audit-byok-1',
    });
    assert.equal('details' in audit[1]!, false);
    assert.doesNotMatch(
      JSON.stringify(audit),
      /apiKey|secretRef|must-not-surface/
    );

    const nonSuccessOutcomes = normalizeIntegrationAudit([
      {
        action: 'byok.failed',
        details: { usageStatus: 'refunded' },
        id: 'audit-byok-failed',
      },
      {
        action: 'byok.unknown',
        details: { usageStatus: 'reserved' },
        id: 'audit-byok-unknown',
      },
    ]);
    assert.deepEqual(
      nonSuccessOutcomes.map((event) => ({
        action: event.action,
        usageStatus: event.details?.usageStatus,
      })),
      [
        { action: 'byok.failed', usageStatus: 'refunded' },
        { action: 'byok.unknown', usageStatus: 'reserved' },
      ]
    );
  });

  it('normalizes only the product-safe Feishu catalog, shortcuts, and activity fields', () => {
    const tools = normalizeFeishuTools([
      {
        discoveredAt: '2026-07-11T00:00:00.000Z',
        id: 'doc.create',
        inputSchema: { secret: true },
        revision: 'r1',
        risk: 'write',
        source: 'https://internal.example.test',
        status: 'published',
      },
    ]);
    const shortcuts = normalizeFeishuShortcuts([
      { hidden: false, order: 2, toolId: 'doc.create' },
    ]);
    const activities = normalizeFeishuActivity([
      {
        executedAt: '2026-07-11T01:00:00.000Z',
        externalUrl: 'https://example.feishu.cn/docx/a',
        id: 'activity-1',
        intentId: 'must-not-surface',
        providerLogId: 'must-not-surface',
        status: 'completed',
        toolId: 'doc.create',
      },
      {
        executedAt: '2026-07-11T01:01:00.000Z',
        externalUrl: 'javascript:alert(1)',
        id: 'activity-2',
        status: 'failed',
        toolId: 'doc.create',
      },
    ]);

    assert.deepEqual(tools[0], {
      discoveredAt: '2026-07-11T00:00:00.000Z',
      id: 'doc.create',
      revision: 'r1',
      risk: 'write',
      status: 'published',
    });
    assert.deepEqual(shortcuts, [
      { hidden: false, order: 2, toolId: 'doc.create' },
    ]);
    assert.equal(
      activities[0]?.externalUrl,
      'https://example.feishu.cn/docx/a'
    );
    assert.equal(JSON.stringify(tools).includes('inputSchema'), false);
    assert.equal(JSON.stringify(activities).includes('intentId'), false);
    assert.equal(activities[1]?.externalUrl, undefined);
  });

  it('normalizes Douyin reconciliation snapshots and Feishu recovery without private payloads', () => {
    const douyin = normalizeDouyinOperationsSnapshot({
      connectionId: 'douyin-a',
      observeSnapshots: [
        {
          evidenceRevision: 'observe-r1',
          externalId: 'item-a',
          fields: { privateMetric: 99 },
          missingReasons: { comments: 'not_granted' },
          observedAt: '2026-07-11T02:00:00.000Z',
          platformTime: '2026-07-11T01:00:00.000Z',
          source: 'product',
        },
      ],
      observeState: {
        connectionId: 'douyin-a',
        evidenceRevision: 'observe-r1',
        lastAttemptAt: '2026-07-11T02:00:00.000Z',
        nextSyncAt: '2026-07-11T03:00:00.000Z',
        reason: 'rate_limited',
        status: 'unknown',
        workspaceId: 'must-not-surface',
      },
      publishJobs: [
        {
          acceptance: 'acceptance_unknown',
          confirmationId: 'confirmation-a',
          effectState: 'reconciliation_required',
          id: 'job-a',
          lastErrorCode: 'transport_unknown',
          payloadHash: 'must-not-surface',
          status: 'unknown',
          updatedAt: '2026-07-11T02:00:00.000Z',
        },
      ],
      refreshedAt: '2026-07-11T02:01:00.000Z',
    });
    const feishu = normalizeFeishuRecoveryIntents([
      {
        argumentHash: 'must-not-surface',
        createdAt: '2026-07-11T02:00:00.000Z',
        effectState: 'reconciliation_required',
        id: 'intent-a',
        lastErrorCode: 'process_interrupted_after_effect_claim',
        lastReconciledAt: '2026-07-11T02:05:00.000Z',
        nextReconcileAt: '2026-07-11T02:10:00.000Z',
        outcomeStatus: 'unknown',
        reconciliationAttempts: 2,
        status: 'unknown',
        toolId: 'doc.create',
      },
    ]);

    assert.equal(douyin.publishJobs[0]?.status, 'unknown');
    assert.equal(douyin.observeSnapshots[0]?.missingFieldCount, 1);
    assert.deepEqual(douyin.observeState, {
      evidenceRevision: 'observe-r1',
      lastAttemptAt: '2026-07-11T02:00:00.000Z',
      nextSyncAt: '2026-07-11T03:00:00.000Z',
      reason: 'rate_limited',
      status: 'unknown',
    });
    assert.equal(JSON.stringify(douyin).includes('privateMetric'), false);
    assert.equal(JSON.stringify(douyin).includes('payloadHash'), false);
    assert.equal(feishu[0]?.effectState, 'reconciliation_required');
    assert.equal(canReconcileFeishuIntent(feishu[0]!), true);
    assert.equal(
      canReconcileFeishuIntent({ ...feishu[0]!, status: 'executed' }),
      false
    );
    assert.equal(feishu[0]?.reconciliationAttempts, 2);
    assert.equal(feishu[0]?.nextReconcileAt, '2026-07-11T02:10:00.000Z');
    assert.equal(JSON.stringify(feishu).includes('argumentHash'), false);
  });

  it('normalizes only selectable Product-backed Douyin content snapshots', () => {
    const snapshots = normalizeDouyinContentSnapshots([
      {
        artifactId: 'artifact-a',
        body: 'must-not-surface',
        contentId: 'content-a',
        contentVersionId: 'version-a',
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'handoff-a',
        platform: 'douyin',
        revision: 'revision-a',
        source: 'product_handoff',
        title: '真实门店视频',
      },
      { id: 'missing-product-fields' },
    ]);

    assert.deepEqual(snapshots, [
      {
        artifactId: 'artifact-a',
        contentId: 'content-a',
        contentVersionId: 'version-a',
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'handoff-a',
        revision: 'revision-a',
        title: '真实门店视频',
      },
    ]);
    assert.equal(JSON.stringify(snapshots).includes('must-not-surface'), false);
  });
});
