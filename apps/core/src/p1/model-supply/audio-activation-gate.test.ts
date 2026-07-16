import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_SFX_PROVIDER_CATALOG_MODEL_ID,
  AUDIO_SPEECH_PROVIDER_CATALOG_MODEL_ID,
  audioProductionActivationBlockers,
  isAudioProductionGenerationAllowed,
} from './audio-activation-gate.js';
import { createDefaultDeployments } from './catalog.js';

const liveEvidence = {
  configurationRevision: 'a'.repeat(64),
  evidenceRef: `activation-probe-${'b'.repeat(24)}`,
  status: 'live_verified' as const,
  verifiedAt: '2026-07-16T08:00:00.000Z',
};

test('default audio catalog stays inactive and production generation is closed', () => {
  const deployments = createDefaultDeployments();
  const speech = deployments.find(
    (deployment) => deployment.id === 'seed-tts-2-volcengine-direct',
  );
  const sfxFixture = deployments.find(
    (deployment) => deployment.id === 'audio-sfx-fixture-recorded',
  );
  const speechFixture = deployments.find(
    (deployment) => deployment.id === 'audio-speech-fixture-recorded',
  );

  assert.equal(speech?.status, 'inactive');
  assert.equal(speech?.unitPrice, undefined);
  assert.equal(speech?.priceRevision, 'seed-tts-2:price-unavailable');
  assert.equal(sfxFixture?.status, 'inactive');
  assert.equal(speechFixture?.status, 'inactive');
  assert.equal(AUDIO_SFX_PROVIDER_CATALOG_MODEL_ID, null);
  assert.equal(AUDIO_SPEECH_PROVIDER_CATALOG_MODEL_ID, 'seed-tts-2');

  assert.deepEqual(
    audioProductionActivationBlockers({
      operation: 'audio.speech',
      deployment: speech,
    }).sort(),
    [
      'approved_price_missing',
      'catalog_inactive',
      'live_probe_missing_or_failed',
      'price_revision_missing',
    ],
  );
  assert.deepEqual(
    audioProductionActivationBlockers({
      operation: 'audio.sfx',
      deployment: sfxFixture,
    }).sort(),
    [
      'catalog_inactive',
      'live_probe_missing_or_failed',
      'provider_not_selected',
    ],
  );
  assert.equal(
    isAudioProductionGenerationAllowed({
      operation: 'audio.speech',
      deployment: speech,
    }),
    false,
  );
  assert.equal(
    isAudioProductionGenerationAllowed({
      operation: 'audio.sfx',
      deployment: sfxFixture,
    }),
    false,
  );
});

test('missing price keeps seed-tts closed even with live_verified probe claims', () => {
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: ['seed-tts-2-volcengine-direct'],
    activationEvidenceByDeploymentId: {
      'seed-tts-2-volcengine-direct': liveEvidence,
    },
  });
  const speech = deployments.find(
    (deployment) => deployment.id === 'seed-tts-2-volcengine-direct',
  );

  assert.equal(speech?.status, 'inactive');
  assert.equal(speech?.unitPrice, undefined);
  assert.equal(speech?.unavailableReason, 'activation_evidence_missing');
  assert.ok(
    audioProductionActivationBlockers({
      operation: 'audio.speech',
      deployment: speech,
      activationEvidence: liveEvidence,
    }).includes('approved_price_missing'),
  );
  assert.equal(
    isAudioProductionGenerationAllowed({
      operation: 'audio.speech',
      deployment: speech,
      activationEvidence: liveEvidence,
    }),
    false,
  );
});

test('failed or missing live probe keeps speech closed after pricing is present', () => {
  const pricedInactive = createDefaultDeployments({
    activatedDeploymentIds: ['seed-tts-2-volcengine-direct'],
    activationEvidenceStatus: 'recorded',
    deploymentPricingById: {
      'seed-tts-2-volcengine-direct': {
        priceRevision: 'tts-price-approved-v1',
        unitPrice: {
          amountMicros: 2_000,
          currency: 'CNY',
          unit: 'text_word',
        },
      },
    },
  }).find((deployment) => deployment.id === 'seed-tts-2-volcengine-direct');

  assert.equal(pricedInactive?.status, 'inactive');
  assert.equal(pricedInactive?.unavailableReason, 'activation_evidence_missing');
  assert.ok(
    audioProductionActivationBlockers({
      operation: 'audio.speech',
      deployment: pricedInactive,
    }).includes('live_probe_missing_or_failed'),
  );

  const failedProbe = createDefaultDeployments({
    activatedDeploymentIds: ['seed-tts-2-volcengine-direct'],
    activationEvidenceByDeploymentId: {
      'seed-tts-2-volcengine-direct': {
        configurationRevision: 'a'.repeat(64),
        evidenceRef: 'probe-failed-not-live',
        status: 'recorded',
        verifiedAt: '2026-07-16T08:00:00.000Z',
      },
    },
    deploymentPricingById: {
      'seed-tts-2-volcengine-direct': {
        priceRevision: 'tts-price-approved-v1',
        unitPrice: {
          amountMicros: 2_000,
          currency: 'CNY',
          unit: 'text_word',
        },
      },
    },
  }).find((deployment) => deployment.id === 'seed-tts-2-volcengine-direct');

  assert.equal(failedProbe?.status, 'inactive');
  assert.ok(
    audioProductionActivationBlockers({
      operation: 'audio.speech',
      deployment: failedProbe,
    }).includes('live_probe_missing_or_failed'),
  );
});

test('SFX fixture cannot open production generation even with synthetic live evidence', () => {
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: ['audio-sfx-fixture-recorded'],
    activationEvidenceByDeploymentId: {
      'audio-sfx-fixture-recorded': liveEvidence,
    },
  });
  const sfx = deployments.find(
    (deployment) => deployment.id === 'audio-sfx-fixture-recorded',
  );

  // Catalog may mark the recorded fixture active for e2e, but the production
  // gate still rejects fixtures because no real SFX provider is selected.
  assert.equal(sfx?.status, 'active');
  assert.deepEqual(
    audioProductionActivationBlockers({
      operation: 'audio.sfx',
      deployment: sfx,
    }).sort(),
    ['provider_not_selected'],
  );
  assert.equal(
    isAudioProductionGenerationAllowed({
      operation: 'audio.sfx',
      deployment: sfx,
    }),
    false,
  );
});

test('speech opens production gate only with provider + price + live_verified', () => {
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: ['seed-tts-2-volcengine-direct'],
    activationEvidenceByDeploymentId: {
      'seed-tts-2-volcengine-direct': liveEvidence,
    },
    deploymentPricingById: {
      'seed-tts-2-volcengine-direct': {
        priceRevision: 'tts-price-approved-v1',
        unitPrice: {
          amountMicros: 2_000,
          currency: 'CNY',
          unit: 'text_word',
        },
      },
    },
  });
  const speech = deployments.find(
    (deployment) => deployment.id === 'seed-tts-2-volcengine-direct',
  );

  assert.equal(speech?.status, 'active');
  assert.deepEqual(
    audioProductionActivationBlockers({
      operation: 'audio.speech',
      deployment: speech,
    }),
    [],
  );
  assert.equal(
    isAudioProductionGenerationAllowed({
      operation: 'audio.speech',
      deployment: speech,
    }),
    true,
  );
});
