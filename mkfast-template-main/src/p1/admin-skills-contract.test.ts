import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReferenceOnlySkillPayload,
  redactSkillCommandResult,
} from './admin-skills-contract';

test('admin Skill writes reject content only in prompt DTOs', () => {
  assert.throws(
    () =>
      assertReferenceOnlySkillPayload({
        promptReference: {
          content: 'caller-controlled prompt',
          name: 'harness/intent-naming',
          version: '42',
        },
      }),
    /不能包含 content/u
  );
  assert.doesNotThrow(() =>
    assertReferenceOnlySkillPayload({
      frontmatter: {
        metadata: {
          content: 'A valid standard metadata value.',
        },
      },
      instruction: 'Portable SKILL.md instructions.',
    })
  );
});

test('admin Skill writes require a real pinned prompt reference', () => {
  assert.throws(
    () =>
      assertReferenceOnlySkillPayload({
        promptReference: {
          contentHash: '<sha256>',
          name: 'harness/intent-naming',
          version: '<pinned-version>',
        },
      }),
    /固定引用/u
  );
  assert.doesNotThrow(() =>
    assertReferenceOnlySkillPayload({
      promptReference: {
        contentHash: 'a'.repeat(64),
        name: 'harness/intent-naming',
        version: 'builtin-v1',
      },
    })
  );
  for (const promptReference of [null, 'pinned', 42]) {
    assert.throws(
      () => assertReferenceOnlySkillPayload({ promptReference }),
      /固定引用/u
    );
  }
});

test('admin Skill results omit new and legacy prompt content fields', () => {
  assert.deepEqual(
    redactSkillCommandResult({
      formatVersion: 1,
      instruction: 'legacy instruction',
      prompt: {
        content: 'legacy prompt',
        fallbackContent: 'frozen fallback',
        contentHash: 'hash',
        name: 'harness/intent-naming',
        version: '42',
      },
    }),
    {
      formatVersion: 1,
      prompt: {
        contentHash: 'hash',
        name: 'harness/intent-naming',
        version: '42',
      },
    }
  );
  assert.deepEqual(
    redactSkillCommandResult({
      formatVersion: 2,
      manifest: {
        metadata: {
          content: 'A valid standard metadata value.',
        },
      },
      prompt: {
        content: 'hidden prompt',
        contentHash: 'hash',
        name: 'harness/intent-naming',
        version: '42',
      },
    }),
    {
      formatVersion: 2,
      manifest: {
        metadata: {
          content: 'A valid standard metadata value.',
        },
      },
      prompt: {
        contentHash: 'hash',
        name: 'harness/intent-naming',
        version: '42',
      },
    }
  );
});
