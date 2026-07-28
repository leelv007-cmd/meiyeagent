/**
 * #240① — the platform default model has one source, and it reaches the client.
 *
 * The browser used to answer "which model when nobody picked one?" from a
 * constant compiled into its own bundle. Operations edit
 * `platform.defaultModel.<configKey>`; Day-0 provisioning writes that value and
 * activation evidence validates it — none of which could ever reach a hardcoded
 * table in a client. These tests pin the wire that replaced it: the preference
 * projection carries the platform default, it comes from the injected source
 * rather than from any built-in, and it is simply absent when the platform has
 * configured none.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from './foundation-module.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './index.js';
import type { PlatformDefaultModelSourcePort } from '../foundation/workspace-provision.js';

function controlPlane(platformDefaultModels?: PlatformDefaultModelSourcePort) {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const application = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments(),
    execution: new RecordedProviderExecutionPort(),
  });
  return {
    repository,
    service: new ModelSupplyControlPlaneService({
      application,
      repository,
      ...(platformDefaultModels ? { platformDefaultModels } : {}),
    }),
  };
}

const configuredSource: PlatformDefaultModelSourcePort = {
  async getDefaults() {
    return {
      audio: 'audio-from-admin-config',
      copy: 'copy-from-admin-config',
      image: 'image-from-admin-config',
      video: 'video-from-admin-config',
    };
  },
};

test('the preference projection carries the operation platform default', async () => {
  const { service } = controlPlane(configuredSource);
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'image.generate'))
      .platformDefault,
    'image-from-admin-config',
    'a client asking about image generation must be told the image default'
  );
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'copy.generate'))
      .platformDefault,
    'copy-from-admin-config'
  );
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'video.generate'))
      .platformDefault,
    'video-from-admin-config'
  );
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'audio.speech'))
      .platformDefault,
    'audio-from-admin-config'
  );
});

test('the platform default is whatever the source says, never a built-in', async () => {
  // The retired browser constant said image → seedream-5-pro. If any built-in
  // survived anywhere on this path, an operator moving the admin-config value
  // would be silently ignored — which is the whole defect.
  const { service } = controlPlane({
    async getDefaults() {
      return { image: 'operator-moved-me-here' };
    },
  });
  const view = await service.getPreferences(
    'workspace-a',
    'owner-a',
    'image.generate'
  );
  assert.equal(view.platformDefault, 'operator-moved-me-here');
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'copy.generate'))
      .platformDefault,
    undefined,
    'an operation the platform left unconfigured has no default to report'
  );
});

test('no configured source means no platform default, not a substitute', async () => {
  const { service } = controlPlane();
  const view = await service.getPreferences(
    'workspace-a',
    'owner-a',
    'image.generate'
  );
  assert.equal(view.platformDefault, undefined);
  assert.deepEqual(view.favorites, []);
});

test('operations with no platform default concept never grow one', async () => {
  const { service } = controlPlane(configuredSource);
  // `copy.adapt` has no `platform.defaultModel.*` key; reusing the copy default
  // for it would be exactly the silent substitution this ticket removes.
  assert.equal(
    (await service.getPreferences('workspace-a', 'owner-a', 'copy.adapt'))
      .platformDefault,
    undefined
  );
});

test('the platform default never overwrites what the workspace or user chose', async () => {
  const { repository, service } = controlPlane(configuredSource);
  await repository.setWorkspaceDefault(
    'workspace-a',
    'image.generate',
    'workspace-picked'
  );
  await repository.setUserDefault(
    'workspace-a',
    'owner-a',
    'image.generate',
    'owner-picked'
  );
  const view = await service.getPreferences(
    'workspace-a',
    'owner-a',
    'image.generate'
  );
  assert.deepEqual(
    {
      platformDefault: view.platformDefault,
      userDefault: view.userDefault,
      workspaceDefault: view.workspaceDefault,
    },
    {
      platformDefault: 'image-from-admin-config',
      userDefault: 'owner-picked',
      workspaceDefault: 'workspace-picked',
    },
    'the three defaults are three distinct facts — the client ranks them'
  );
});
