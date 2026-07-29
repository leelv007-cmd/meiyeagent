import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKILL_SCHEMA_REFS,
  dailyIndustrySkillInputSchema,
  intentDecisionSkillOutputSchema,
  listSkillSchemaRefs,
  parseSkillSchema,
  resolveSkillSchema,
} from './index.js';

const EXPECTED_SKILL_SCHEMA_REFS = [
  'skill-input.daily-industry@1',
  'skill-output.intent-decision@1',
] as const;

test('lists every concrete Skill schema ref used by current manifests and eval fixtures', () => {
  assert.deepEqual(SKILL_SCHEMA_REFS, EXPECTED_SKILL_SCHEMA_REFS);
  assert.deepEqual(listSkillSchemaRefs(), EXPECTED_SKILL_SCHEMA_REFS);

  assert.throws(
    () =>
      (SKILL_SCHEMA_REFS as unknown as string[]).push(
        'skill-input.not-registered@1',
      ),
    TypeError,
  );
  assert.deepEqual(SKILL_SCHEMA_REFS, EXPECTED_SKILL_SCHEMA_REFS);

  const firstList = listSkillSchemaRefs() as string[];
  firstList.pop();
  assert.deepEqual(listSkillSchemaRefs(), EXPECTED_SKILL_SCHEMA_REFS);
});

test('resolves registered refs to their executable Zod schemas', () => {
  assert.equal(
    resolveSkillSchema('skill-output.intent-decision@1'),
    intentDecisionSkillOutputSchema,
  );
  assert.equal(
    resolveSkillSchema('skill-input.daily-industry@1'),
    dailyIndustrySkillInputSchema,
  );
});

test('parses the daily-industry input and intent-decision output contracts', () => {
  const input = {
    context: {
      workId: 'work-1',
      intent: '为今天的团购写一条行业内容',
      scene: '日常项目曝光',
      sourceSummaries: ['门店价目表'],
    },
    assetReferences: ['asset-1'],
  };
  assert.deepEqual(
    parseSkillSchema('skill-input.daily-industry@1', input),
    input,
  );
  assert.throws(
    () =>
      parseSkillSchema('skill-input.daily-industry@1', {
        ...input,
        context: null,
      }),
    /Invalid input/u,
  );
  assert.throws(
    () => {
      const { assetReferences: _assetReferences, ...missingField } = input;
      parseSkillSchema('skill-input.daily-industry@1', missingField);
    },
    /assetReferences/u,
  );
  assert.throws(
    () =>
      parseSkillSchema('skill-input.daily-industry@1', {
        ...input,
        undeclared: true,
      }),
    /Unrecognized key/u,
  );
  assert.throws(
    () =>
      parseSkillSchema('skill-input.daily-industry@1', {
        ...input,
        context: {
          ...input.context,
          undeclared: true,
        },
      }),
    /Unrecognized key/u,
  );

  const output = {
    normalizedIntent: '为今天的团购写一条行业内容',
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['product_service', 'industry_category'],
    usedAssetCategories: ['industry_category'],
    route: 'customized',
    implicitConstraints: ['只使用已确认的行业事实'],
    blockingGap: null,
  };
  assert.deepEqual(
    parseSkillSchema('skill-output.intent-decision@1', output),
    output,
  );
  assert.throws(
    () =>
      parseSkillSchema('skill-output.intent-decision@1', {
        ...output,
        usedAssetCategories: ['store'],
      }),
    /Used asset categories must also be relevant/u,
  );
  assert.throws(
    () => {
      const { taskType: _taskType, ...missingField } = output;
      parseSkillSchema('skill-output.intent-decision@1', missingField);
    },
    /taskType/u,
  );
  assert.throws(
    () =>
      parseSkillSchema('skill-output.intent-decision@1', {
        ...output,
        undeclared: true,
      }),
    /Unrecognized key/u,
  );
});

test('fails closed for malformed and unknown Skill schema refs', () => {
  for (const ref of [
    'daily-industry@1',
    'skill-input.daily-industry',
    'skill-input.DailyIndustry@1',
    'skill-input.daily-industry@0',
  ]) {
    assert.throws(
      () => resolveSkillSchema(ref),
      new RegExp(`Invalid Skill schema ref: ${ref.replaceAll('.', '\\.')}`, 'u'),
    );
  }

  assert.throws(
    () => resolveSkillSchema('skill-input.not-registered@1'),
    /Unknown Skill schema ref: skill-input\.not-registered@1/u,
  );
  assert.throws(
    () => parseSkillSchema('skill-output.not-registered@1', {}),
    /Unknown Skill schema ref: skill-output\.not-registered@1/u,
  );
});
