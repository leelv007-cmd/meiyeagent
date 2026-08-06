/**
 * Spec E / #381 — pure binding matrix: specificity, mode application, conflict codes.
 * Server-side only; no browser ordering.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKILL_BINDING_CONFLICT_CODE,
  SkillBindingConflictError,
  bindingTriggerSpecificity,
  isWinningBindingInjected,
  selectHighestCertaintyBindings,
} from './binding-matrix.js';
import type { SkillBinding, SkillBindingMode } from './types.js';

const WORKFLOW = 'workflow.matrix@1';
const STAGE = 'intent_naming' as const;

function binding(input: {
  bindingId: string;
  skillId?: string;
  skillRevisionRef?: string;
  mode: SkillBindingMode;
  industryCategory?: string | null;
  tenantId?: string | null;
}): SkillBinding {
  return {
    bindingId: input.bindingId,
    workflowRevisionRef: WORKFLOW,
    triggerCondition: {
      harnessStage: STAGE,
      industryCategory: input.industryCategory ?? null,
      tenantId: input.tenantId ?? null,
    },
    skillId: input.skillId ?? 'skill.shared',
    skillRevisionRef: input.skillRevisionRef ?? 'skill.shared@1',
    mode: input.mode,
    status: 'active',
    supersededAt: null,
    supersededByBindingId: null,
    createdAt: '2026-08-07T00:00:00.000Z',
  };
}

test('specificity ranks tenant over industry over global (workflow/stage scoped by caller)', () => {
  assert.equal(
    bindingTriggerSpecificity({
      harnessStage: STAGE,
      industryCategory: null,
      tenantId: null,
    }),
    0,
  );
  assert.equal(
    bindingTriggerSpecificity({
      harnessStage: STAGE,
      industryCategory: 'hair',
      tenantId: null,
    }),
    1,
  );
  assert.equal(
    bindingTriggerSpecificity({
      harnessStage: STAGE,
      industryCategory: null,
      tenantId: 'workspace-a',
    }),
    2,
  );
  assert.equal(
    bindingTriggerSpecificity({
      harnessStage: STAGE,
      industryCategory: 'hair',
      tenantId: 'workspace-a',
    }),
    3,
  );
});

test('tenant-specific binding wins over global for the same skillId', () => {
  const winners = selectHighestCertaintyBindings([
    binding({
      bindingId: 'binding.global',
      mode: 'required',
      skillRevisionRef: 'skill.shared@1',
    }),
    binding({
      bindingId: 'binding.tenant',
      mode: 'required',
      skillRevisionRef: 'skill.shared@2',
      tenantId: 'workspace-a',
    }),
  ]);
  assert.equal(winners.get('skill.shared')?.bindingId, 'binding.tenant');
  assert.equal(
    winners.get('skill.shared')?.skillRevisionRef,
    'skill.shared@2',
  );
});

test('required + user_selected selection of the same revision injects once as required', () => {
  const required = binding({
    bindingId: 'binding.required',
    mode: 'required',
    skillId: 'skill.once',
    skillRevisionRef: 'skill.once@1',
  });
  const winners = selectHighestCertaintyBindings([required]);
  const winner = winners.get('skill.once')!;
  assert.equal(winner.mode, 'required');
  const selected = new Set(['skill.once@1']);
  assert.equal(isWinningBindingInjected(winner, selected), true);
  assert.equal(isWinningBindingInjected(winner, new Set()), true);
  // Selection cannot flip mode: still required path (always inject, once).
  assert.equal(winner.mode, 'required');
});

test('user selection only injects user_selected mode; disabled blocks selection', () => {
  const userSelected = binding({
    bindingId: 'binding.user',
    mode: 'user_selected',
    skillId: 'skill.opt',
    skillRevisionRef: 'skill.opt@1',
  });
  const disabled = binding({
    bindingId: 'binding.disabled',
    mode: 'disabled',
    skillId: 'skill.off',
    skillRevisionRef: 'skill.off@1',
  });

  assert.equal(
    isWinningBindingInjected(userSelected, new Set(['skill.opt@1'])),
    true,
  );
  assert.equal(
    isWinningBindingInjected(userSelected, new Set()),
    false,
  );
  assert.equal(
    isWinningBindingInjected(disabled, new Set(['skill.off@1'])),
    false,
  );
});

test('disabled winner at higher specificity blocks a lower user_selected binding', () => {
  const winners = selectHighestCertaintyBindings([
    binding({
      bindingId: 'binding.user-global',
      mode: 'user_selected',
      skillRevisionRef: 'skill.shared@1',
    }),
    binding({
      bindingId: 'binding.disabled-tenant',
      mode: 'disabled',
      skillRevisionRef: 'skill.shared@1',
      tenantId: 'workspace-a',
    }),
  ]);
  const winner = winners.get('skill.shared')!;
  assert.equal(winner.mode, 'disabled');
  assert.equal(
    isWinningBindingInjected(winner, new Set(['skill.shared@1'])),
    false,
  );
});

test('equal-specificity mode mismatch returns SKILL_BINDING_CONFLICT', () => {
  assert.throws(
    () =>
      selectHighestCertaintyBindings([
        binding({
          bindingId: 'binding.a',
          mode: 'required',
          skillRevisionRef: 'skill.shared@1',
          industryCategory: 'hair',
        }),
        binding({
          bindingId: 'binding.b',
          mode: 'user_selected',
          skillRevisionRef: 'skill.shared@1',
          industryCategory: 'hair',
        }),
      ]),
    (error: unknown) => {
      assert.ok(error instanceof SkillBindingConflictError);
      assert.equal(error.code, SKILL_BINDING_CONFLICT_CODE);
      assert.equal(error.status, 400);
      assert.equal(error.reason, 'mode_mismatch');
      assert.equal(error.skillId, 'skill.shared');
      assert.deepEqual(error.details.bindingIds, ['binding.a', 'binding.b']);
      assert.match(error.message, /绑定冲突/);
      return true;
    },
  );
});

test('equal-specificity revision mismatch returns SKILL_BINDING_CONFLICT', () => {
  assert.throws(
    () =>
      selectHighestCertaintyBindings([
        binding({
          bindingId: 'binding.rev-b',
          mode: 'required',
          skillRevisionRef: 'skill.shared@2',
          tenantId: 'workspace-a',
        }),
        binding({
          bindingId: 'binding.rev-a',
          mode: 'required',
          skillRevisionRef: 'skill.shared@1',
          tenantId: 'workspace-a',
        }),
      ]),
    (error: unknown) => {
      assert.ok(error instanceof SkillBindingConflictError);
      assert.equal(error.code, SKILL_BINDING_CONFLICT_CODE);
      assert.equal(error.reason, 'revision_mismatch');
      // Deterministic binding id order in details.
      assert.deepEqual(error.details.bindingIds, [
        'binding.rev-a',
        'binding.rev-b',
      ]);
      return true;
    },
  );
});

test('identical equal-specificity bindings collapse deterministically by bindingId', () => {
  const winners = selectHighestCertaintyBindings([
    binding({
      bindingId: 'binding.z',
      mode: 'required',
      skillRevisionRef: 'skill.shared@1',
    }),
    binding({
      bindingId: 'binding.a',
      mode: 'required',
      skillRevisionRef: 'skill.shared@1',
    }),
  ]);
  assert.equal(winners.get('skill.shared')?.bindingId, 'binding.a');
});

test('distinct skillIds keep independent winners (no cross-skill collapse)', () => {
  const winners = selectHighestCertaintyBindings([
    binding({
      bindingId: 'binding.req',
      mode: 'required',
      skillId: 'skill.required',
      skillRevisionRef: 'skill.required@1',
    }),
    binding({
      bindingId: 'binding.user',
      mode: 'user_selected',
      skillId: 'skill.user',
      skillRevisionRef: 'skill.user@1',
    }),
  ]);
  assert.equal(winners.size, 2);
  assert.equal(winners.get('skill.required')?.mode, 'required');
  assert.equal(winners.get('skill.user')?.mode, 'user_selected');
});
