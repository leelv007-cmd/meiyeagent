import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1DomainError, REGISTER_GIFT_GRANT_KEY } from './domain.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import {
  WorkspaceProvisionService,
  type PlatformDefaultModelPort,
} from './workspace-provision.js';

const owner = {
  workspaceId: 'workspace-provision',
  userId: 'owner-provision',
  correlationId: 'corr-provision',
};

function setup(modelDefaults?: PlatformDefaultModelPort) {
  const clock = () => new Date('2026-07-11T12:00:00.000Z');
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
    clock,
  );
  const provisioner = new WorkspaceProvisionService(entitlements, {
    clock,
    modelDefaults,
  });
  return { entitlements, provisioner, repository };
}

describe('WorkspaceProvisionService', () => {
  it('grants trial once and is idempotent under workspace-provision:trial:v1', async () => {
    const { provisioner, repository } = setup();
    const first = await provisioner.provisionTrial(owner);
    assert.equal(first.plan?.tier, 'trial');
    assert.deepEqual(
      {
        copy: first.usage.copy.allowance,
        image: first.usage.image.allowance,
        video: first.usage.video.allowance,
      },
      { copy: 5, image: 5, video: 1 },
    );

    const second = await provisioner.provisionTrial(owner);
    assert.equal(second.usage.copy.allowance, 5);

    const events = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.equal(
      events.filter(
        (event) =>
          event.kind === 'plan_activated' &&
          event.grantKey === REGISTER_GIFT_GRANT_KEY,
      ).length,
      1,
    );
  });

  it('sets platform default model preferences without BYOK credentials', async () => {
    const written: Array<{
      workspaceId: string;
      operation: string;
      modelId: string;
    }> = [];
    const validated: Array<{ operation: string; modelId: string }> = [];
    const modelDefaults: PlatformDefaultModelPort = {
      async getDefaults() {
        return {
          audio: 'platform-audio-model',
          copy: 'platform-copy-model',
          image: 'platform-image-model',
          video: 'platform-video-model',
        };
      },
      async validateDefault(operation, modelId) {
        validated.push({ modelId, operation });
      },
      async setWorkspaceDefault(workspaceId, operation, modelId) {
        written.push({ workspaceId, operation, modelId });
      },
    };
    const { provisioner } = setup(modelDefaults);
    const result = await provisioner.provisionModelDefaults(owner);
    assert.equal(result.applied, true);
    assert.deepEqual(result.defaults, {
      audio: 'platform-audio-model',
      copy: 'platform-copy-model',
      image: 'platform-image-model',
      video: 'platform-video-model',
    });
    assert.deepEqual(validated, [
      { modelId: 'platform-copy-model', operation: 'copy.generate' },
      { modelId: 'platform-image-model', operation: 'image.generate' },
      { modelId: 'platform-video-model', operation: 'video.generate' },
      { modelId: 'platform-audio-model', operation: 'audio.speech' },
    ]);
    assert.deepEqual(written, [
      {
        workspaceId: owner.workspaceId,
        operation: 'copy.generate',
        modelId: 'platform-copy-model',
      },
      {
        workspaceId: owner.workspaceId,
        operation: 'image.generate',
        modelId: 'platform-image-model',
      },
      {
        workspaceId: owner.workspaceId,
        operation: 'video.generate',
        modelId: 'platform-video-model',
      },
      {
        workspaceId: owner.workspaceId,
        operation: 'audio.speech',
        modelId: 'platform-audio-model',
      },
    ]);
  });

  it('validates all platform defaults before writing any preference', async () => {
    let writes = 0;
    const modelDefaults: PlatformDefaultModelPort = {
      async getDefaults() {
        return {
          audio: 'platform-audio-model',
          copy: 'platform-copy-model',
          image: 'inactive-image-model',
          video: 'platform-video-model',
        };
      },
      async validateDefault(_operation, modelId) {
        if (modelId === 'inactive-image-model') {
          throw new P1DomainError(
            'INVALID_STATE',
            'Platform default model is not live verified.'
          );
        }
      },
      async setWorkspaceDefault() {
        writes += 1;
      },
    };
    const { provisioner } = setup(modelDefaults);

    await assert.rejects(
      provisioner.provisionModelDefaults(owner),
      /not live verified/u
    );
    assert.equal(writes, 0);
  });

  it('skips zero-allowance modalities without a platform default (audio)', async () => {
    const written: Array<{ operation: string; modelId: string }> = [];
    const modelDefaults: PlatformDefaultModelPort = {
      async getDefaults() {
        return {
          copy: 'platform-copy-model',
          image: 'platform-image-model',
          video: 'platform-video-model',
        };
      },
      async validateDefault(operation, modelId) {
        if (operation === 'audio.speech') {
          throw new Error('should not validate unset audio default');
        }
        void modelId;
      },
      async setWorkspaceDefault(_workspaceId, operation, modelId) {
        written.push({ operation, modelId });
      },
    };
    const { provisioner } = setup(modelDefaults);
    const result = await provisioner.provisionModelDefaults(owner);
    assert.equal(result.applied, true);
    assert.deepEqual(result.defaults, {
      copy: 'platform-copy-model',
      image: 'platform-image-model',
      video: 'platform-video-model',
    });
    assert.deepEqual(
      written.map((entry) => entry.operation),
      ['copy.generate', 'image.generate', 'video.generate'],
    );
  });

  it('still fails when a modality with trial allowance has no default', async () => {
    const modelDefaults: PlatformDefaultModelPort = {
      async getDefaults() {
        return {
          audio: 'platform-audio-model',
          copy: 'platform-copy-model',
          image: 'platform-image-model',
        };
      },
      async validateDefault() {},
      async setWorkspaceDefault() {
        throw new Error('should not write when a required default is missing');
      },
    };
    const { provisioner } = setup(modelDefaults);
    await assert.rejects(
      provisioner.provisionModelDefaults(owner),
      /Platform default model video is not configured/u,
    );
  });

  it('still provisions trial when platform default models are unset', async () => {
    const modelDefaults: PlatformDefaultModelPort = {
      async getDefaults() {
        return {};
      },
      async validateDefault() {
        throw new Error('should not validate when defaults are empty');
      },
      async setWorkspaceDefault() {
        throw new Error('should not set when defaults are empty');
      },
    };
    const { provisioner } = setup(modelDefaults);
    const trial = await provisioner.provisionTrial(owner);
    assert.equal(trial.plan?.tier, 'trial');
    await assert.rejects(
      provisioner.provisionModelDefaults(owner),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE',
    );
  });
});
