import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ModelExecutionRuntimeMode } from '../p1/model-supply/adapters.js';
import {
  NOTE_ENHANCEMENT_JUDGE_BY_MODE,
  noteEnhancementJudgeResolverForMode,
} from './note-enhancement-judge.js';

const ALL_MODES: readonly ModelExecutionRuntimeMode[] = [
  'disabled',
  'recorded',
  'fixture',
  'gateway',
  'direct',
] as const;

const UNCONFIGURED_MODES: readonly ModelExecutionRuntimeMode[] = [
  'disabled',
  'recorded',
  'fixture',
] as const;

const CONFIGURED_MODES: readonly ModelExecutionRuntimeMode[] = [
  'gateway',
  'direct',
] as const;

test('note enhancement judge selection table covers all five runtime modes', () => {
  assert.deepEqual(
    Object.keys(NOTE_ENHANCEMENT_JUDGE_BY_MODE).sort(),
    [...ALL_MODES].sort()
  );
  assert.deepEqual(
    [...UNCONFIGURED_MODES, ...CONFIGURED_MODES].sort(),
    [...ALL_MODES].sort()
  );
});

test('gateway and direct modes resolve configured judge', async () => {
  for (const mode of CONFIGURED_MODES) {
    const state = await noteEnhancementJudgeResolverForMode(mode).resolve({
      workflowId: 'wf-test',
      workspaceId: 'ws-test',
    });
    assert.equal(state.status, 'configured', `mode ${mode}`);
  }
});

test('disabled, recorded, and fixture modes resolve unconfigured judge with honest reason', async () => {
  for (const mode of UNCONFIGURED_MODES) {
    const state = await noteEnhancementJudgeResolverForMode(mode).resolve({
      workflowId: 'wf-test',
      workspaceId: 'ws-test',
    });
    assert.deepEqual(
      state,
      {
        status: 'unconfigured',
        reason: 'self_correction_judge_unconfigured',
      },
      `mode ${mode}`
    );
  }
});

test('api-runtime production assembly wires noteEnhancementJudge via mode selection table', async () => {
  const source = await readFile(
    new URL('./api-runtime.ts', import.meta.url),
    'utf8'
  );
  assert.match(
    source,
    /noteEnhancementJudge:\s*noteEnhancementJudgeResolverForMode\([\s\S]*?env\.APP_ENV === 'e2e' \? 'gateway' : modelRuntime\.mode[\s\S]*?\)/
  );
  assert.doesNotMatch(
    source,
    /noteEnhancementJudge:\s*unconfiguredNotePlanEnhancementJudgeResolver/
  );
});
