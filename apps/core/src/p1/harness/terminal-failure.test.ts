import assert from 'node:assert/strict';
import test from 'node:test';

import { StructuredNodeRunError } from '../model-supply/structured-node-runner.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import { HarnessSelectionError } from './execution-selection.js';
import { HarnessDeliveryError } from './postgres-store.js';
import { HarnessCopyScopeError } from './production-stage-ports.js';

test('terminal failures retain only controlled workflow details', () => {
  assert.deepEqual(
    normalizeHarnessTerminalFailure(new HarnessCopyScopeError()),
    { code: 'HARNESS_COPY_ONLY', status: 409 },
  );
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new HarnessSelectionError(
        ['image_exact_text'],
        '图片中的价格没有通过逐字核对，这张图没有交付。',
      ),
    ),
    {
      code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
      status: 409,
      gateIds: ['image_exact_text'],
      merchantMessage: '图片中的价格没有通过逐字核对，这张图没有交付。',
    },
  );
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new HarnessSelectionError(['critical_fact_source']),
    ),
    {
      code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
      status: 409,
      gateIds: ['critical_fact_source'],
    },
  );
  const sensitiveViolation = {
    gateId: 'sensitive_words' as const,
    reason: '候选文案含有违禁词，已停止该候选。',
    alternativePath: ['明显改善'],
    sensitiveCheckBar: {
      schemaVersion: 'sensitive-check-bar/v1' as const,
      status: 'hits' as const,
      summary: '检出 1 处违禁词，请按建议替换后再交付。',
      items: [
        {
          wordId: 'sw-extreme-001',
          word: '根治',
          category: 'extreme' as const,
          snippet: '承诺根治色斑',
          replacements: ['明显改善'],
        },
      ],
    },
  };
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new HarnessSelectionError(
        ['sensitive_words'],
        sensitiveViolation.reason,
        [],
        sensitiveViolation.alternativePath,
        [sensitiveViolation],
      ),
    ),
    {
      code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
      status: 409,
      gateIds: ['sensitive_words'],
      merchantMessage: sensitiveViolation.reason,
      violations: [sensitiveViolation],
    },
  );
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new HarnessDeliveryError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'The package was not found.',
      ),
    ),
    { code: 'CONTENT_PACKAGE_NOT_FOUND', status: 409 },
  );
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new HarnessDeliveryError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        'The package revision changed.',
        2,
        0,
        'package-1',
      ),
    ),
    {
      code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
      status: 409,
      currentRevision: 2,
      expectedRevision: 0,
      packageId: 'package-1',
    },
  );
  assert.deepEqual(
    normalizeHarnessTerminalFailure(
      new StructuredNodeRunError('unknown', 'acceptance_unknown'),
    ),
    {
      code: 'STRUCTURED_NODE_RUN_FAILED',
      acceptance: 'acceptance_unknown',
    },
  );
});
