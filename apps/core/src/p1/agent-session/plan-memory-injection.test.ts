import assert from 'node:assert/strict';
import test from 'node:test';
import type { RetrievalExperience } from './context-retrieval.js';
import { compilePlanMemoryContext } from './plan-memory-injection.js';

const REF = {
  harnessReleaseId: 'composer-plan-surface-v1',
  runId: 'run_0123456789abcdef01234567',
  taskId: 'task-1',
};

function confirmed(
  memoryId: string,
  instruction: string,
  revision = 1,
): RetrievalExperience {
  return {
    instruction,
    ref: `experience:${memoryId}`,
    revision,
    status: 'confirmed',
  } as RetrievalExperience;
}

test('a recognised preference becomes a constraint and is not reported as missed', () => {
  const context = compilePlanMemoryContext({
    ...REF,
    entries: [confirmed('pref-1', '文案保持简洁克制', 5)],
  });
  assert.ok(context);
  assert.deepEqual(context.styleConstraints.tones, ['concise', 'restrained']);
  assert.deepEqual(context.unmapped, []);
});

/**
 * The regression this module exists for.
 *
 * Both statements below are things a merchant actually confirmed, and neither
 * matches either recogniser. Before, they were joined into one string, tested,
 * and dropped — the plan carried `tones: []` and `forbiddenPhrases: []` while
 * MemoryInjectionReceipt recorded both memories as injected. Reference and
 * effect read identically from the receipt, which is the whole problem.
 */
test('an unrecognised preference is carried as a miss, not silently dropped', () => {
  const context = compilePlanMemoryContext({
    ...REF,
    entries: [
      confirmed('pref-punct', '别用感叹号'),
      confirmed('pref-price', '客单价别写死'),
    ],
  });
  assert.ok(context);

  // Still referenced — the receipt's view of the world is unchanged.
  assert.deepEqual(
    context.entries.map((entry) => entry.memoryId),
    ['pref-punct', 'pref-price'],
  );
  // And now visibly without effect.
  assert.deepEqual(context.styleConstraints.tones, []);
  assert.deepEqual(context.styleConstraints.forbiddenPhrases, []);
  assert.deepEqual(context.unmapped, [
    { memoryId: 'pref-punct', statement: '别用感叹号' },
    { memoryId: 'pref-price', statement: '客单价别写死' },
  ]);
});

test('a mixed set separates what landed from what did not', () => {
  const context = compilePlanMemoryContext({
    ...REF,
    entries: [
      confirmed('pref-short', '标题要简短'),
      confirmed('pref-punct', '别用感叹号'),
    ],
  });
  assert.ok(context);
  assert.deepEqual(context.styleConstraints.tones, ['concise']);
  assert.deepEqual(context.unmapped, [
    { memoryId: 'pref-punct', statement: '别用感叹号' },
  ]);
});

/**
 * Both recognisers are single alternations containing no newline, so testing
 * each statement separately cannot differ from testing them joined by '\n'.
 * This pins that equivalence: 简 ends one statement and 洁 starts the next, and
 * the joined string 「保持简\n洁一点」 does not match /简洁/ either. If a
 * recogniser ever grows a pattern that could span a boundary, this fails and
 * the per-entry split has to be revisited rather than quietly changing meaning.
 */
test('splitting the statements did not change what the recognisers see', () => {
  const context = compilePlanMemoryContext({
    ...REF,
    entries: [confirmed('pref-a', '保持简'), confirmed('pref-b', '洁一点')],
  });
  assert.ok(context);
  assert.deepEqual(context.styleConstraints.tones, []);
  assert.equal(context.unmapped?.length, 2);
});

test('no confirmed experience yields no context at all', () => {
  assert.equal(
    compilePlanMemoryContext({
      ...REF,
      entries: [
        { instruction: '随口一说', ref: 'session:draft-1', revision: 1, status: 'confirmed' },
        { instruction: '还没确认', ref: 'experience:pref-x', revision: 1, status: 'candidate' },
      ] as RetrievalExperience[],
    }),
    null,
  );
});
