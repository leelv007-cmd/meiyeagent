/**
 * Pure-node coverage for the Spec E / #382 E2E user_selected seed fixture.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import {
  E2E_TENANT_ISOLATED_SKILL_ID,
  E2E_USER_SELECTED_SKILL_ID,
  E2E_USER_SELECTED_WORKFLOW_REF,
  E2EUserSelectedSkillFixture,
} from './e2e-user-selected-skill-fixture.js';
import { MemorySkillRepository } from './repository.js';
import { SkillService } from './service.js';

const NOW = '2026-08-07T12:00:00.000Z';
const WORKSPACE_A = 'workspace-e2e-a';
const WORKSPACE_B = 'workspace-e2e-b';

const promptSnapshotsByReference = new Map<string, HarnessFrozenPrompt>();

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function promptKey(reference: {
  contentHash: string;
  name: string;
  version: string;
}) {
  return `${reference.name}\u0000${reference.version}\u0000${reference.contentHash}`;
}

function makePrompt(content: string): HarnessFrozenPrompt {
  const prompt: HarnessFrozenPrompt = {
    content,
    contentHash: sha256(content),
    isFallback: true,
    fallbackReason: 'unconfigured',
    label: 'production',
    name: 'harness/copy-candidate',
    source: 'builtin',
    version: '1',
  };
  promptSnapshotsByReference.set(promptKey(prompt), prompt);
  return prompt;
}

function createStack(prompt: HarnessFrozenPrompt) {
  const repository = new MemorySkillRepository();
  const service = new SkillService(repository, () => NOW, {
    async capture(reference) {
      const snapshot = promptSnapshotsByReference.get(promptKey(reference));
      assert.ok(snapshot, 'prompt snapshot must be registered');
      return snapshot;
    },
  });
  // Published catalog port is optional for e2e fixture; leave unset so
  // workflow refs are not filtered against empty recipe tables in pure memory.
  const fixture = new E2EUserSelectedSkillFixture({
    clock: () => NOW,
    prompt,
    repository,
    service,
  });
  return { fixture, repository, service };
}

test('e2e user_selected fixture publishes selectable skill and injects only when selected', async () => {
  const prompt = makePrompt('copy candidate fixture body');
  const { fixture, service } = createStack(prompt);

  const first = await fixture.seed({ workspaceId: WORKSPACE_A });
  assert.equal(first.ready, true);
  assert.equal(first.publicSkill.skillId, E2E_USER_SELECTED_SKILL_ID);
  assert.equal(first.tenantIsolatedSkill, null);

  const second = await fixture.seed({ workspaceId: WORKSPACE_A });
  assert.equal(
    second.publicSkill.skillRevisionRef,
    first.publicSkill.skillRevisionRef,
  );

  const projectionA = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  const item = projectionA.items.find(
    (entry) => entry.skillId === E2E_USER_SELECTED_SKILL_ID,
  );
  assert.ok(item);
  assert.equal(item.presentationPolicy, 'user_selectable');
  assert.equal(item.selectionEligible, true);
  assert.equal(item.skillRevisionRef, first.publicSkill.skillRevisionRef);

  const unselected = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [],
    workflowRevisionRef: E2E_USER_SELECTED_WORKFLOW_REF,
  });
  assert.equal(
    unselected.allowlist.some(
      (entry) => entry.skillRevisionRef === first.publicSkill.skillRevisionRef,
    ),
    false,
  );

  const selected = await service.resolveStage({
    stage: 'intent_naming',
    userSelectedSkillRefs: [first.publicSkill.skillRevisionRef],
    workflowRevisionRef: E2E_USER_SELECTED_WORKFLOW_REF,
  });
  assert.equal(
    selected.allowlist.some(
      (entry) => entry.skillRevisionRef === first.publicSkill.skillRevisionRef,
    ),
    true,
  );
});

test('e2e tenant-isolated skill is invisible outside its tenant workspace', async () => {
  const prompt = makePrompt('tenant isolation fixture body');
  const { fixture, service } = createStack(prompt);

  const seeded = await fixture.seed({
    workspaceId: WORKSPACE_A,
    foreignWorkspaceId: WORKSPACE_B,
  });
  assert.ok(seeded.tenantIsolatedSkill);
  assert.equal(seeded.tenantIsolatedSkill.skillId, E2E_TENANT_ISOLATED_SKILL_ID);
  assert.equal(seeded.tenantIsolatedSkill.tenantWorkspaceId, WORKSPACE_B);

  const ownerView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_B,
    lensId: 'copy',
  });
  assert.equal(
    ownerView.items.some((item) => item.skillId === E2E_TENANT_ISOLATED_SKILL_ID),
    true,
  );
  assert.equal(
    ownerView.items.some((item) => item.skillId === E2E_USER_SELECTED_SKILL_ID),
    true,
  );

  const strangerView = await service.projectMerchantSkills({
    workspaceId: WORKSPACE_A,
    lensId: 'copy',
  });
  assert.equal(
    strangerView.items.some(
      (item) => item.skillId === E2E_TENANT_ISOLATED_SKILL_ID,
    ),
    false,
  );
  assert.equal(
    strangerView.items.some((item) => item.skillId === E2E_USER_SELECTED_SKILL_ID),
    true,
  );
});
