import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAdminCatalogDraftJson,
  createRouteSimulationPayload,
  createSafeModelDraftJson,
  normalizeAdminCatalogControl,
  normalizeAdminCatalog,
  normalizeAdminRouteSimulation,
  normalizeAdminTemplateHistory,
  parseCanvasDocument,
  parseAdminCatalogDraft,
  parseRolloutPercent,
  parseSafeModelDraft,
} from './admin-view-model';

describe('P1 admin view model', () => {
  it('round-trips the complete admin provider-channel catalog without secrets', () => {
    const control = normalizeAdminCatalogControl({
      catalog: {
        capabilities: [
          {
            catalogModelId: 'gpt-image-2',
            id: 'gpt-image-2:image.generate:capability-v1',
            operation: 'image.generate',
            revision: 1,
          },
        ],
        deployments: [
          {
            activationEvidence: { status: 'recorded' },
            allowedDataClasses: ['public'],
            apiCounterparty: 'OpenAI',
            apiFamily: 'image',
            canvasGenerationCapabilities: [
              {
                inputAssetRoles: ['reference_image', 'mask'],
                operation: 'image.edit',
                parameters: ['width', 'height', 'strength'],
              },
            ],
            catalogModelId: 'gpt-image-2',
            channel: 'managed',
            credentialMode: 'platform',
            credentialOwner: 'provider_managed',
            credentialVersion: 'recorded-credential-v1',
            endpointRevision: 'openai-compatible-v2',
            executionChannelId: 'channel-openai-image-managed',
            id: 'gpt-image-2-managed',
            lifecycleRevision: 'deployment-v1',
            policyRevision: 'data-class-policy-v1',
            priceRevision: 'gpt-image-2:price-v1',
            providerModel: 'gpt-image-2-provider',
            providerProfileId: 'provider-openai',
            region: 'overseas',
            status: 'active',
            unitPrice: {
              amountMicros: 120_000,
              currency: 'USD',
              unit: 'recorded_media_unit',
            },
          },
        ],
        executionChannels: [
          {
            apiCounterparty: 'OpenAI',
            apiFamily: 'image',
            channel: 'managed',
            credentialOwner: 'provider_managed',
            id: 'channel-openai-image-managed',
            providerProfileId: 'provider-openai',
            region: 'overseas',
            revision: 1,
          },
        ],
        models: [
          {
            capabilities: ['image.generate', 'image.edit'],
            displayName: 'GPT Image 2',
            id: 'gpt-image-2',
            manufacturer: 'OpenAI',
            modality: 'image',
            operations: ['image.generate', 'image.edit'],
            qualityRank: 95,
            stableModelName: 'gpt-image-2',
            version: '2',
          },
          {
            capabilities: ['audio.speech', 'audio.sfx'],
            displayName: 'Audio Studio',
            id: 'audio-studio',
            manufacturer: 'ByteDance',
            modality: 'audio',
            operations: ['audio.speech', 'audio.sfx'],
            qualityRank: 90,
            stableModelName: 'audio-studio',
            version: '1',
          },
        ],
        prices: [
          {
            amount: 0.12,
            catalogModelId: 'gpt-image-2',
            currency: 'USD',
            id: 'gpt-image-2:price-v1',
            revision: 1,
            unit: 'recorded_media_unit',
          },
        ],
        providerProfiles: [
          {
            apiCounterparty: 'OpenAI',
            id: 'provider-openai',
            lifecycle: 'recorded',
            manufacturer: 'OpenAI',
            revision: 1,
          },
        ],
        routes: [
          {
            catalogModelId: 'gpt-image-2',
            id: 'gpt-image-2:image.generate:route-v1',
            operation: 'image.generate',
            revision: 1,
          },
        ],
      },
      revisionId: 'recorded-default-v1',
      stage: 'recorded',
      workspaceId: 'workspace-a',
    });

    const draft = parseAdminCatalogDraft(createAdminCatalogDraftJson(control));
    assert.equal(draft.providerProfiles[0]?.lifecycle, 'recorded');
    assert.equal(draft.executionChannels[0]?.revision, 1);
    assert.equal(draft.deployments[0]?.lifecycleRevision, 'deployment-v1');
    assert.equal(
      draft.deployments[0]?.endpointRevision,
      'openai-compatible-v2'
    );
    assert.equal(draft.deployments[0]?.providerModel, 'gpt-image-2-provider');
    assert.deepEqual(draft.deployments[0]?.canvasGenerationCapabilities, [
      {
        inputAssetRoles: ['reference_image', 'mask'],
        operation: 'image.edit',
        parameters: ['width', 'height', 'strength'],
      },
    ]);
    assert.equal(draft.capabilities[0]?.revision, 1);
    assert.equal(draft.prices[0]?.revision, 1);
    assert.equal(draft.routes[0]?.revision, 1);
    assert.equal(draft.models[1]?.modality, 'audio');
    assert.equal(JSON.stringify(draft).includes('apiKey'), false);

    const customControl = normalizeAdminCatalogControl({
      ...control,
      catalog: {
        ...control.catalog,
        deployments: control.catalog.deployments.map((deployment) => ({
          ...deployment,
          apiFamily: 'custom',
        })),
        executionChannels: control.catalog.executionChannels.map((channel) => ({
          ...channel,
          apiFamily: 'custom',
        })),
      },
    });
    assert.equal(customControl.catalog.deployments[0]?.apiFamily, 'custom');
    assert.equal(
      parseAdminCatalogDraft(createAdminCatalogDraftJson(customControl))
        .deployments[0]?.apiFamily,
      'custom'
    );

    const audioControl = normalizeAdminCatalogControl({
      ...control,
      catalog: {
        ...control.catalog,
        deployments: control.catalog.deployments.map((deployment) => ({
          ...deployment,
          apiFamily: 'audio',
        })),
        executionChannels: control.catalog.executionChannels.map((channel) => ({
          ...channel,
          apiFamily: 'audio',
        })),
      },
    });
    assert.equal(audioControl.catalog.deployments[0]?.apiFamily, 'audio');

    assert.throws(
      () =>
        normalizeAdminCatalogControl({
          ...control,
          catalog: {
            ...control.catalog,
            providerProfiles: [
              {
                ...control.catalog.providerProfiles[0],
                apiKey: 'must-not-pass',
              },
            ],
          },
        }),
      /Unrecognized key/
    );
  });

  it('validates route simulator inputs and normalizes a safe result', () => {
    assert.deepEqual(
      createRouteSimulationPayload({
        catalogModelId: '',
        dataClass: 'pii',
        failureScenario: 'rejected_before_accept',
        fallbackConsent: true,
        operation: 'copy.generate',
        selectionMode: 'auto',
        unavailableDeploymentIds: 'openai-direct, gemini-direct\nopenai-direct',
      }),
      {
        dataClass: ['pii'],
        failureScenario: 'rejected_before_accept',
        operation: 'copy.generate',
        selection: {
          fallbackConsent: true,
          mode: 'auto',
          profile: 'quality',
        },
        unavailableDeploymentIds: ['gemini-direct', 'openai-direct'],
      }
    );
    assert.throws(
      () =>
        createRouteSimulationPayload({
          catalogModelId: '',
          dataClass: 'public',
          failureScenario: 'success',
          fallbackConsent: false,
          operation: 'image.generate',
          selectionMode: 'fixed',
          unavailableDeploymentIds: '',
        }),
      /固定模式必须选择模型/
    );

    const result = normalizeAdminRouteSimulation({
      candidateEvaluations: [
        {
          catalogModelId: 'llm-openai',
          channel: 'direct',
          costEstimate: {
            amountMicros: 20_000,
            currency: 'USD',
            source: 'recorded_estimate',
            unit: 'request',
          },
          deploymentId: 'openai-direct',
          eligible: false,
          exclusionReasons: ['simulated_unavailable'],
          qualityRank: 95,
          region: 'overseas',
        },
      ],
      catalogRevisionId: 'recorded-default-v1',
      dataClass: [],
      estimatedMaximumCost: null,
      expectedOutcome: {
        action: 'awaiting_selection',
        attemptLimit: 2,
        expectedAttempts: 0,
        reason: 'no_eligible_candidate',
      },
      failureScenario: 'success',
      operation: 'copy.generate',
      rankedCandidates: [],
      selection: { mode: 'auto', profile: 'quality' },
    });
    assert.equal(result.candidateEvaluations[0]?.eligible, false);
    assert.deepEqual(result.candidateEvaluations[0]?.exclusionReasons, [
      'simulated_unavailable',
    ]);

    assert.equal(
      createRouteSimulationPayload({
        catalogModelId: 'audio-studio',
        dataClass: 'public',
        failureScenario: 'success',
        fallbackConsent: false,
        operation: 'audio.speech',
        selectionMode: 'fixed',
        unavailableDeploymentIds: '',
      }).operation,
      'audio.speech'
    );
    assert.equal(
      createRouteSimulationPayload({
        catalogModelId: 'audio-studio',
        dataClass: 'public',
        failureScenario: 'success',
        fallbackConsent: false,
        operation: 'audio.sfx',
        selectionMode: 'fixed',
        unavailableDeploymentIds: '',
      }).operation,
      'audio.sfx'
    );
  });

  it('validates template rollout and canvas input before commands are sent', () => {
    assert.equal(parseRolloutPercent('25'), 25);
    assert.throws(() => parseRolloutPercent('25.5'), /0 到 100/);
    assert.deepEqual(
      parseCanvasDocument(
        JSON.stringify({
          height: 1350,
          pages: [{ elements: [], id: 'page-1' }],
          width: 1080,
        })
      ),
      {
        height: 1350,
        pages: [{ elements: [], id: 'page-1' }],
        width: 1080,
      }
    );
    assert.throws(
      () => parseCanvasDocument('{"height":0,"pages":[],"width":0}'),
      /画布文档校验失败/
    );

    const history = normalizeAdminTemplateHistory({
      templates: [
        {
          createdAt: '2026-07-11T00:00:00.000Z',
          family: 'price_card',
          id: 'official-price-card',
          name: '价格卡',
          publicationStatus: 'published',
          tags: ['价格'],
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      ],
      versions: [
        {
          createdAt: '2026-07-11T00:00:00.000Z',
          createdBy: 'admin-1',
          documentSummary: {
            elementCount: 2,
            height: 1350,
            pageCount: 1,
            width: 1080,
          },
          id: 'official-price-card-v2',
          revision: 2,
          rolloutPercent: 20,
          status: 'draft',
          templateId: 'official-price-card',
        },
      ],
      workspaceId: 'workspace-1',
    });
    assert.equal(history.versions[0]?.revision, 2);
    assert.equal(history.versions[0]?.documentSummary.elementCount, 2);
    assert.equal(history.workspaceId, 'workspace-1');
  });

  it('allowlists frontend-safe model evidence and omits provider internals', () => {
    const snapshot = normalizeAdminCatalog(
      {
        models: [
          {
            activationEvidence: {
              evidenceRef: 'evidence/model-1',
              status: 'recorded',
            },
            availability: 'recorded',
            channel: 'must-not-leak',
            dataClasses: {
              allowed: ['public'],
              denied: ['contains_face', 'pii', 'medical'],
            },
            displayName: 'Model 1',
            endpoint: 'must-not-leak',
            id: 'model-1',
            manufacturer: 'Vendor',
            modality: 'image',
            operations: ['image.generate'],
            qualityRank: 90,
            secret: 'must-not-leak',
            stableModelName: 'model-1-stable',
            version: '1',
          },
        ],
        revisionId: 'revision-1',
        stage: 'recorded',
      },
      'image.generate'
    );
    const visible = JSON.stringify(snapshot);
    assert.equal(visible.includes('must-not-leak'), false);
    assert.equal(snapshot.models[0]?.activationEvidence.status, 'recorded');
    assert.deepEqual(snapshot.models[0]?.allowedDataClasses, ['public']);
    assert.deepEqual(snapshot.models[0]?.deniedDataClasses, [
      'contains_face',
      'pii',
      'medical',
    ]);

    const editor = createSafeModelDraftJson([snapshot]);
    assert.equal(editor.includes('channel'), false);
    assert.equal(editor.includes('endpoint'), false);
    assert.equal(editor.includes('secret'), false);
    const patch = parseSafeModelDraft(editor);
    assert.equal(patch.models[0]?.id, 'model-1');
    assert.equal(patch.models[0]?.lifecycle, 'recorded');
    assert.equal(JSON.stringify(patch).includes('deployments'), false);
  });

  it('keeps audio modality in the admin catalog projection', () => {
    const catalog = normalizeAdminCatalog(
      {
        models: [
          {
            activationEvidence: { status: 'recorded' },
            availability: 'recorded',
            dataClasses: { allowed: ['public'], denied: [] },
            displayName: 'Audio Studio',
            id: 'audio-studio',
            modality: 'audio',
            operations: ['audio.speech', 'audio.sfx'],
            qualityRank: 90,
          },
        ],
        revisionId: 'catalog-audio-v1',
        stage: 'recorded',
      },
      'audio.speech'
    );

    assert.equal(catalog.models[0]?.modality, 'audio');
    assert.deepEqual(catalog.models[0]?.operations, [
      'audio.speech',
      'audio.sfx',
    ]);
  });

  it('rejects unsafe or contradictory model draft input', () => {
    const base = {
      activationEvidence: { status: 'documented' },
      allowedDataClasses: ['public'],
      deniedDataClasses: ['pii'],
      id: 'unsafe',
      lifecycle: 'available',
    };
    assert.throws(
      () => parseSafeModelDraft(JSON.stringify({ models: [base] })),
      /available requires live_verified/
    );
    assert.throws(
      () =>
        parseSafeModelDraft(
          JSON.stringify({
            models: [
              {
                ...base,
                activationEvidence: { status: 'live_verified' },
              },
            ],
          })
        ),
      /live_verified requires complete activation evidence/
    );
    assert.throws(
      () =>
        parseSafeModelDraft(
          JSON.stringify({
            models: [
              {
                ...base,
                activationEvidence: { status: 'recorded' },
                allowedDataClasses: ['public'],
                deniedDataClasses: [],
                lifecycle: 'recorded',
              },
            ],
          })
        ),
      /complete non-overlapping policy/
    );
    assert.throws(
      () =>
        parseSafeModelDraft(
          JSON.stringify({
            models: [
              {
                ...base,
                activationEvidence: {
                  configurationRevision: 'runtime-openai-v1',
                  evidenceRef: 'staging://model-activation/openai',
                  status: 'live_verified',
                  verifiedAt: '2026-07-12T12:00:00.000Z',
                },
                channel: 'direct',
              },
            ],
          })
        ),
      /模型目录校验失败/
    );
  });
});
