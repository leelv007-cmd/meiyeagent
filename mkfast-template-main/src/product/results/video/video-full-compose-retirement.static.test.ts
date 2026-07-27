import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

const worksurfaceModel = source('./video-worksurface-model.ts');
const worksurface = source('./video-worksurface.tsx');
const coreRegeneration = source(
  '../../../../../apps/core/src/p1/model-supply/video-regeneration.ts'
);
const postgresRegeneration = source(
  '../../../../../apps/core/src/p1/model-supply/video-regeneration-postgres.ts'
);
const terminalBilling = source(
  '../../../../../apps/core/src/p1/model-supply/video-workflow-billing.ts'
);

test('T23 keeps whole-film recomposition outside every billable production model', () => {
  for (const [name, contents] of [
    ['Web worksurface model', worksurfaceModel],
    ['Web quote request contract', worksurface],
    ['Core regeneration model', coreRegeneration],
    ['Core regeneration persistence', postgresRegeneration],
  ] as const) {
    assert.doesNotMatch(
      contents,
      /['"]full_compose['"]/,
      `${name} must not revive the retired billable scope`
    );
  }

  assert.match(
    worksurfaceModel,
    /videoBillableScopes\s*=\s*\['shot'\]\s+as const/
  );
  assert.doesNotMatch(
    worksurfaceModel,
    /\b(classifyFullRecompose|requestFullRecompose)\b/
  );
  assert.match(postgresRegeneration, /CHECK \(scope = 'shot'\)/);
});

test('T23 preserves shot regeneration and generic terminal billing', () => {
  assert.match(
    coreRegeneration,
    /videoRegenScopes\s*=\s*\['shot'\]\s+as const/
  );
  assert.match(terminalBilling, /createInitialVideoTerminalObserver/);
  assert.match(
    terminalBilling,
    /status:\s*workflow\.status === 'completed' \? 'completed' : 'failed'/
  );
  assert.match(
    terminalBilling,
    /status === 'completed' \|\| status === 'failed' \|\| status === 'cancelled'/
  );
});
