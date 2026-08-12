/**
 * V31-26a constructive zero-consumer proof matrix (grep-level + assembly wiring).
 * Companion narrative: docs/ops/v31-26-retirement-proof-matrix.md
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../../..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function sourceFiles(roots: string[]): string[] {
  return roots
    .flatMap((root) => filesUnder(resolve(repositoryRoot, root)))
    .filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.tsx')) &&
        !file.includes(`${'node_modules'}`) &&
        !file.endsWith('.d.ts'),
    )
    .map((file) => relative(repositoryRoot, file))
    .sort();
}

function countMatches(
  files: string[],
  pattern: RegExp,
  excludeTest = false,
): { count: number; files: string[] } {
  const hits: string[] = [];
  let count = 0;
  for (const file of files) {
    if (excludeTest && /\.test\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    const matches = source.match(pattern);
    if (matches && matches.length > 0) {
      count += matches.length;
      hits.push(file);
    }
  }
  return { count, files: hits };
}

const codeRoots = [
  'apps/core/src',
  'mkfast-template-main/src',
  'packages/contracts/src',
];

test('matrix R1 Thread=Work glue still has production consumers (openLegacyWorkThread)', () => {
  const files = sourceFiles(codeRoots);
  const hits = countMatches(files, /openLegacyWorkThread/g, true);
  // Production path must remain until pilot retires historical work open.
  assert.ok(
    hits.count >= 2,
    `expected openLegacyWorkThread production refs, got ${hits.count} in ${hits.files.join(',')}`,
  );
  assert.ok(
    hits.files.some((file) => file.includes('agent-session')),
    'expected agent-session production consumer',
  );
});

test('matrix R2 old result conversation glue still has production consumers', () => {
  const files = sourceFiles(['mkfast-template-main/src']);
  const hits = countMatches(files, /ComposerConversation|composer-conversation/g, true);
  assert.ok(
    hits.count >= 1,
    'ComposerConversation still mounted — not deletable in 26a',
  );
});

test('matrix R3 PlanProposal DTO still consumed by plan compiler path', () => {
  const files = sourceFiles(['apps/core/src']);
  const hits = countMatches(files, /\bPlanProposal\b/g, true);
  assert.ok(hits.count >= 1, 'PlanProposal still has production refs');
});

test('matrix R4 second prompt pack map: private copy collapsed to LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION', () => {
  const langfuse = readFileSync(
    resolve(
      repositoryRoot,
      'apps/core/src/p1/harness/langfuse-prompts.ts',
    ),
    'utf8',
  );
  // Private literal table must not be re-introduced.
  assert.doesNotMatch(
    langfuse,
    /const MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION = \{\s*["']copy\.generate["']/,
  );
  assert.match(langfuse, /LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION/);
});

test('matrix R5 tool allowlist: registry is sole agent tool policy surface (still has consumers)', () => {
  const files = sourceFiles(['apps/core/src/p1/agent-session']);
  const hits = countMatches(files, /toKernelTools|approvedToolNames/g, true);
  assert.ok(hits.count >= 1, 'tool registry allowlist still live');
});

test('matrix R6 legacy harness interaction projection still accepts v1 for replay', () => {
  const interaction = readFileSync(
    resolve(
      repositoryRoot,
      'apps/core/src/p1/harness/interaction-service.ts',
    ),
    'utf8',
  );
  assert.match(interaction, /legacyHarnessInteractionPendingProjectionSchema/);
});

test('matrix R7 old card stream UI still mounted via composer-conversation', () => {
  const conversation = readFileSync(
    resolve(
      repositoryRoot,
      'mkfast-template-main/src/product/composer/composer-conversation.tsx',
    ),
    'utf8',
  );
  assert.match(conversation, /ComposerProgressCard/);
  assert.match(conversation, /ComposerDeliveryCard/);
});

test('matrix X1: legacy five-stage runner stays deleted (V31-26b executed 2026-08-12)', () => {
  // User decision 2026-08-12: retire the runner on the compiled executor's own
  // evidence (runner-convergence baselines + DBOS durable smoke) instead of
  // waiting for the merchant pilot. Constructive zero-consumer proof inverted:
  // neither the kill switch nor the frozen runner may reappear in production
  // source. (The MAKE_LEGACY_FIVE_STAGE_TRACE_MODE 'legacy_llm' trace value for
  // snapshot-less runs is a different concept and intentionally not matched.)
  const files = sourceFiles(codeRoots);
  const hits = countMatches(
    files,
    /force_legacy_five_stage|forceLegacyFiveStage|runFrozenLegacyFiveStage|legacy_five_stage_runner/g,
    true,
  );
  assert.deepEqual(
    hits.files,
    [],
    `legacy five-stage runner references reappeared: ${hits.files.join(',')}`,
  );
});

test('assembly wires U14 inventory + kill-switch admin-config mirror (consumer proof)', () => {
  const apiRuntime = readFileSync(
    resolve(repositoryRoot, 'apps/core/src/assembly/api-runtime.ts'),
    'utf8',
  );
  assert.match(apiRuntime, /PostgresLegacyReplayInventory/);
  assert.match(apiRuntime, /legacyReplayInventory:/);
  assert.match(apiRuntime, /killSwitchAdminConfigMirror:/);
  assert.match(apiRuntime, /legacy_replay|legacy\.replay\.archive_ops_buffer_days/);
});

test('ops-console foundation exposes U14 + flag inventory queries', () => {
  const foundation = readFileSync(
    resolve(
      repositoryRoot,
      'apps/core/src/p1/ops-console/foundation-module.ts',
    ),
    'utf8',
  );
  assert.match(foundation, /legacy_replay_archive_gate/);
  assert.match(foundation, /export_legacy_replay_audit/);
  assert.match(foundation, /list_v31_feature_flags/);
});
