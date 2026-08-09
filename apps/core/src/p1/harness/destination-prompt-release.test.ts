/**
 * destinationMapping release pin resolution (V31-21 / U10 send-back).
 *
 * Seam: the composer destination mapper resolved its release with
 * resolveForRun({}) — no workspace — so a canary-allowlisted workspace silently
 * mapped destinations on the production prompt. These tests fail if that
 * regresses, and if a workspace-less resolve is ever accepted again.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDestinationMappingPrompt } from './destination-prompt-release.js';
import {
  HarnessReleaseService,
  MemoryHarnessReleaseStore,
} from './harness-release.js';
import type { HarnessPromptResolver } from './langfuse-prompts.js';
import {
  SEED_HARNESS_RELEASE_ID,
  ensureSeedProductionRelease,
  seedHarnessReleaseManifest,
} from './seed-harness-release.js';

const TS = '2026-08-09T12:00:00.000Z';
const PRODUCTION_PIN = '1';
const CANARY_PIN = 'canary-dm-9';

/**
 * Echoes back whichever exact version it was asked to pin, so the assertions
 * read the release that was actually selected rather than a fixture constant.
 */
const echoingPromptResolver: HarnessPromptResolver = {
  async resolve() {
    throw new Error('Full-registry resolve must not be used for a single pin.');
  },
  async resolveKeys(keys, exactVersions) {
    return Object.fromEntries(
      keys.map((key) => {
        const version = String(exactVersions?.[key] ?? 'unpinned');
        return [
          key,
          {
            name: `harness/${key}`,
            version,
            content: `content@${version}`,
            contentHash: `hash@${version}`,
            label: 'production',
            source: 'langfuse' as const,
            isFallback: false,
          },
        ];
      }),
    );
  },
};

async function createReleases() {
  const store = new MemoryHarnessReleaseStore();
  const service = new HarnessReleaseService(store);
  await ensureSeedProductionRelease({ store, service });
  return { store, service };
}

async function publishCanary(service: HarnessReleaseService) {
  const seed = seedHarnessReleaseManifest();
  await service.publishArtifact({
    ...seed,
    releaseId: 'canary-destination-mapping',
    version: 2,
    createdAt: TS,
    promptBindings: {
      ...seed.promptBindings,
      destinationMapping: {
        key: 'destinationMapping',
        version: CANARY_PIN,
      },
    },
  });
  for (const toStatus of ['evaluating', 'canary'] as const) {
    await service.transitionLifecycle({
      releaseId: 'canary-destination-mapping',
      toStatus,
      now: TS,
    });
  }
}

test('a canary-allowlisted workspace maps destinations on the canary pin, not production', async () => {
  const { service } = await createReleases();
  await publishCanary(service);
  await service.updateRollout({
    releaseId: 'canary-destination-mapping',
    workspaceAllowlist: ['ws-canary'],
    now: TS,
  });

  // Guard the fixture itself: the two releases must differ on this pin, or the
  // assertions below would pass even with the workspace dropped.
  assert.equal(
    (await service.resolveForRun({ workspaceId: 'ws-canary' })).releaseId,
    'canary-destination-mapping',
  );
  assert.equal(
    (await service.resolveForRun({ workspaceId: 'ws-other' })).releaseId,
    SEED_HARNESS_RELEASE_ID,
  );

  const canary = await resolveDestinationMappingPrompt({
    releases: service,
    prompts: echoingPromptResolver,
    workspaceId: 'ws-canary',
  });
  assert.equal(canary.version, CANARY_PIN);

  const other = await resolveDestinationMappingPrompt({
    releases: service,
    prompts: echoingPromptResolver,
    workspaceId: 'ws-other',
  });
  assert.equal(other.version, PRODUCTION_PIN);
});

test('destinationMapping resolution fails closed without a workspace', async () => {
  const { service } = await createReleases();
  for (const workspaceId of ['', '   ']) {
    await assert.rejects(
      resolveDestinationMappingPrompt({
        releases: service,
        prompts: echoingPromptResolver,
        workspaceId,
      }),
      /requires a workspaceId/u,
    );
  }
});

test('destinationMapping resolution fails closed when the release has no exact pin', async () => {
  const { service } = await createReleases();
  const stripped = {
    resolveForRun: async () => {
      const resolved = await service.resolveForRun({
        workspaceId: 'ws-any',
      });
      const promptBindings = { ...resolved.artifact.promptBindings };
      delete promptBindings.destinationMapping;
      return {
        ...resolved,
        artifact: { ...resolved.artifact, promptBindings },
      };
    },
  };

  await assert.rejects(
    resolveDestinationMappingPrompt({
      releases: stripped,
      prompts: echoingPromptResolver,
      workspaceId: 'ws-any',
    }),
    /missing exact prompt pin destinationMapping/u,
  );
});
