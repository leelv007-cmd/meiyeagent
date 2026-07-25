import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copyCandidatesSchemaFor,
  DEFAULT_COPY_CANDIDATE_COUNT,
  generatedCopyCandidatesSchema,
} from './p1.js';

const candidate = {
  title: '主推荐',
  body: '基于已确认资料生成的正文。',
  conversionHook: '私信预约',
};

test('default copy output requires exactly one primary candidate', () => {
  assert.equal(DEFAULT_COPY_CANDIDATE_COUNT, 1);
  assert.equal(
    generatedCopyCandidatesSchema.parse({ candidates: [candidate] }).candidates
      .length,
    1,
  );
  assert.equal(
    generatedCopyCandidatesSchema.safeParse({
      candidates: [candidate, { ...candidate, title: '备选' }],
    }).success,
    false,
  );
});

test('explicit multi-candidate mechanisms retain an exact requested count', () => {
  const explicitThree = copyCandidatesSchemaFor(3);
  assert.equal(
    explicitThree.parse({
      candidates: [
        candidate,
        { ...candidate, title: '备选一', body: '备选正文一。' },
        { ...candidate, title: '备选二', body: '备选正文二。' },
      ],
    }).candidates.length,
    3,
  );
  assert.equal(
    explicitThree.safeParse({ candidates: [candidate] }).success,
    false,
  );
});
