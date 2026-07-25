import assert from 'node:assert/strict';
import test from 'node:test';
import { copyCandidatesSchemaFor } from '@meiye/contracts';

import { copyCandidateBodiesAreDistinct } from './ledger-contracts.js';

test('explicit three-candidate quality checks retain meaningful body distinctness', () => {
  const output = copyCandidatesSchemaFor(3).parse({
    candidates: [
      {
        title: '方向一',
        body: '突出真实到店体验。',
        conversionHook: '私信预约',
      },
      {
        title: '方向二',
        body: '说明护理前沟通重点。',
        conversionHook: '收藏备用',
      },
      {
        title: '方向三',
        body: '介绍适合本地熟客的预约方式。',
        conversionHook: '留言咨询',
      },
    ],
  });

  assert.equal(output.candidates.length, 3);
  assert.equal(copyCandidateBodiesAreDistinct(output.candidates), true);
  assert.equal(
    copyCandidateBodiesAreDistinct([
      output.candidates[0]!,
      { ...output.candidates[1]!, body: '  突出真实到店体验。  ' },
      output.candidates[2]!,
    ]),
    false,
  );
});
