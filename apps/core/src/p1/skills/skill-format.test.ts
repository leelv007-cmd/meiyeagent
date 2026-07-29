import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exportSkillPackage,
  importSkillPackage,
  SKILL_FRONTMATTER_FIELDS,
} from './skill-format.js';

const STANDARD_SKILL_MD = `---
name: daily-beauty-context
description: Grounds a daily beauty-business post in current industry context.
license: MIT
allowed-tools: read_context check
metadata:
  author: meiye
  revision: "1"
compatibility: Requires the Meiye deterministic trigger runtime.
---

Use only grounded industry context for the current merchant request.
`;

test('official Skill frontmatter is a closed six-field set', () => {
  assert.deepEqual(SKILL_FRONTMATTER_FIELDS, [
    'name',
    'description',
    'license',
    'allowed-tools',
    'metadata',
    'compatibility',
  ]);

  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD.replace(
            'license: MIT',
            'license: MIT\nbudget:\n  maxCostCents: 5',
          ),
        },
      }),
    /Unknown Skill frontmatter field: budget/u,
  );
});

test('Skill frontmatter requires name and description and string metadata values', () => {
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD.replace(
            'description: Grounds a daily beauty-business post in current industry context.\n',
            '',
          ),
        },
      }),
    /description is required/u,
  );
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD.replace(
            'revision: "1"',
            'revision:\n    nested: value',
          ),
        },
      }),
    /metadata values must be strings/u,
  );
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD.replace(
            'name: daily-beauty-context',
            'name: Daily Beauty Context',
          ),
        },
      }),
    /lowercase letters, numbers, and hyphens/u,
  );
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'different-directory',
        files: { 'SKILL.md': STANDARD_SKILL_MD },
      }),
    /must match its directory/u,
  );
});

test('standard SKILL.md and assets round-trip without platform conversion', () => {
  const logo = new Uint8Array([0, 1, 2, 255]);
  const imported = importSkillPackage({
    directoryName: 'daily-beauty-context',
    files: {
      'SKILL.md': STANDARD_SKILL_MD,
      'assets/logo.png': logo,
      'custom/portable.txt': 'Preserve third-party package additions.',
      'evals/evals.json': JSON.stringify({ cases: [] }),
      'references/voice.md': 'Prefer specific, useful language.',
      'scripts/inspect.sh': '#!/bin/sh\nexit 0\n',
    },
  });

  assert.equal(imported.frontmatter.name, 'daily-beauty-context');
  assert.equal(
    imported.frontmatter['allowed-tools'],
    'read_context check',
  );
  assert.equal(
    imported.instructions,
    'Use only grounded industry context for the current merchant request.',
  );
  assert.deepEqual(imported.files['assets/logo.png'], logo);

  const exported = exportSkillPackage(imported);
  const roundTripped = importSkillPackage({
    directoryName: imported.directoryName,
    files: exported,
  });

  assert.deepEqual(roundTripped, imported);
  assert.deepEqual(
    Object.keys(exported).sort(),
    [
      'SKILL.md',
      'assets/logo.png',
      'custom/portable.txt',
      'evals/evals.json',
      'references/voice.md',
      'scripts/inspect.sh',
    ],
  );
});

test('Skill package paths cannot escape the portable directory', () => {
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD,
          '../secret.txt': 'must not escape',
        },
      }),
    /safe relative path/u,
  );
  assert.throws(
    () =>
      importSkillPackage({
        directoryName: 'daily-beauty-context',
        files: {
          'SKILL.md': STANDARD_SKILL_MD,
          '/tmp/secret.txt': 'must not be absolute',
        },
      }),
    /safe relative path/u,
  );
});
