import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PromotionalMaterialReceiptStatus } from './promotional-material-receipt';

test('shows assisted completion and missing-material markers on export results', () => {
  const assisted = renderToStaticMarkup(
    <PromotionalMaterialReceiptStatus
      receipt={{
        capabilityStatus: 'assisted',
        missingMaterialFallback: 'text_only',
        outputSha256: 'a'.repeat(64),
        provenanceRef: 'canvas-revision-assisted',
      }}
    />
  );
  const missing = renderToStaticMarkup(
    <PromotionalMaterialReceiptStatus
      receipt={{
        capabilityStatus: 'verified',
        missingMaterialFallback: 'brand_safe_placeholder',
        outputSha256: 'b'.repeat(64),
        provenanceRef: 'canvas-revision-missing',
      }}
    />
  );

  assert.match(assisted, /辅助完成/u);
  assert.match(assisted, /文字版/u);
  assert.match(missing, /缺料/u);
  assert.match(missing, /品牌安全占位/u);
});
