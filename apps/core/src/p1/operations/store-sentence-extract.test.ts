import assert from 'node:assert/strict';
import test from 'node:test';

import type { ZodType } from 'zod';

import {
  STORE_SENTENCE_EXTRACT_SCHEMA_NAME,
  type ExtractStoreSentenceResult,
} from '@meiye/contracts';

import { FixtureAiStructuredObjectExecutor } from '../model-supply/index.js';
import type { StructuredObjectExecutor } from '../model-supply/index.js';
import { compileFixtureStoreSentenceExtract } from '../model-supply/store-sentence-extract-fixture.js';
import type { StructuredNodeRunnerRequest } from '../model-supply/structured-node-runner.js';
import {
  STORE_SENTENCE_EXTRACT_SCHEMA_REVISION,
  StructuredStoreSentenceExtractor,
  type StoreSentenceExtractRunnerFactory,
} from './store-sentence-extract.js';

const FULL_SENTENCE =
  '我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元';
const NON_TEMPLATE_SENTENCE =
  '盘点美发工作室开在杭州，染发套餐价格三百八十八';
const HALF_SENTENCE = '店名叫青禾美业';
const UNCLEAR_SENTENCE = '回头再说吧今天先看看';

function extractor(executor: StructuredObjectExecutor) {
  return new StructuredStoreSentenceExtractor(runnerFactory(executor));
}

function runnerFactory(
  executor: StructuredObjectExecutor,
): StoreSentenceExtractRunnerFactory {
  return {
    create: () => ({
      async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
        const result = await executor.generate(request);
        return {
          ...result,
          attempts: 1,
          replayed: false,
        };
      },
    }),
  };
}

function extract(
  port: StructuredStoreSentenceExtractor,
  sentence: string,
): Promise<ExtractStoreSentenceResult> {
  return port.extract({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    effectIdempotencyKey: 'store-sentence-extract-test',
    sentence,
  });
}

function values(result: ExtractStoreSentenceResult) {
  return Object.fromEntries(
    result.suggestions.map((item) => [item.id, item.value]),
  );
}

test('canned full sentence yields name, city, project and price', () => {
  const canned = compileFixtureStoreSentenceExtract(FULL_SENTENCE);
  assert.equal(canned.name?.value, '盘点美发工作室');
  assert.equal(canned.city?.value, '市中心');
  assert.equal(canned.projectName?.value, '染发套餐');
  assert.equal(canned.projectPrice?.value, '388');
});

test('canned non-template wording still fills the four Day-0 fields', () => {
  const canned = compileFixtureStoreSentenceExtract(NON_TEMPLATE_SENTENCE);
  assert.equal(canned.name?.value, '盘点美发工作室');
  assert.equal(canned.city?.value, '杭州');
  assert.equal(canned.projectName?.value, '染发套餐');
  assert.equal(canned.projectPrice?.value, '388');
});

test('canned half sentence only returns what was said', () => {
  const canned = compileFixtureStoreSentenceExtract(HALF_SENTENCE);
  assert.equal(canned.name?.value, '青禾美业');
  assert.equal(canned.city, null);
  assert.equal(canned.projectName, null);
  assert.equal(canned.projectPrice, null);
});

test('a district never carries the verb that introduced it or repeats the city', () => {
  const canned = compileFixtureStoreSentenceExtract(
    '我这家店叫晨昕美睫，开在成都高新区，做一次日式接睫毛收两百六',
  );
  assert.equal(canned.name?.value, '晨昕美睫');
  // 「开在成都高新区」 names one place with one verb in front. Splitting it is
  // guesswork, but prefilling 开在成都高新区 as the district is not a guess —
  // it is wrong data one nod away from the profile. Say nothing instead.
  assert.equal(canned.district, null);
  assert.ok(!canned.city?.value.includes('开在'));
});

test('a separately stated district still comes through', () => {
  const canned = compileFixtureStoreSentenceExtract(
    '我们店叫青藤美甲，在杭州，门店在西湖区，日式美甲 268 元',
  );
  assert.equal(canned.city?.value, '杭州');
  assert.equal(canned.district?.value, '西湖区');
});

test('canned unclear sentence returns nothing', () => {
  const canned = compileFixtureStoreSentenceExtract(UNCLEAR_SENTENCE);
  assert.equal(canned.name, null);
  assert.equal(canned.city, null);
  assert.equal(canned.projectName, null);
  assert.equal(canned.projectPrice, null);
});

test('fixture extractor maps canned full sentences onto suggestion rows', async () => {
  const result = await extract(
    extractor(new FixtureAiStructuredObjectExecutor()),
    FULL_SENTENCE,
  );
  assert.equal(result.status, 'suggested');
  assert.deepEqual(values(result), {
    name: '盘点美发工作室',
    city: '市中心',
    projectName: '染发套餐',
    projectPrice: '388',
    industry: 'hair_care',
  });
  assert.ok(
    result.suggestions.every(
      (item) =>
        item.provenance === 'ai_suggestion' && item.source === 'spoken_sentence',
    ),
  );
});

test('fixture extractor keeps a half sentence as a partial suggestion', async () => {
  const result = await extract(
    extractor(new FixtureAiStructuredObjectExecutor()),
    HALF_SENTENCE,
  );
  assert.equal(result.status, 'suggested');
  assert.deepEqual(values(result), { name: '青禾美业' });
});

test('fixture extractor stays empty when the sentence said nothing usable', async () => {
  const result = await extract(
    extractor(new FixtureAiStructuredObjectExecutor()),
    UNCLEAR_SENTENCE,
  );
  assert.equal(result.status, 'empty');
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.errorCode, null);
});

test('a provider failure returns empty suggestions and does not throw', async () => {
  const failing: StructuredObjectExecutor = {
    supportsCatalogModel: () => true,
    generate: () => Promise.reject(new Error('provider unavailable')),
    providerCost: (usage) => ({ amount: 0, currency: 'USD' as const, usage }),
  };
  const result = await extract(extractor(failing), FULL_SENTENCE);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'model_execution_failed');
  assert.deepEqual(result.suggestions, []);
});

test('the extract command reaches the model under one governed schema name', async () => {
  const seen: string[] = [];
  const fixture = new FixtureAiStructuredObjectExecutor();
  const recording: StructuredObjectExecutor = {
    supportsCatalogModel: () => true,
    generate<Output>(input: {
      abortSignal?: AbortSignal;
      instructions: string;
      onPartialOutput?: (partial: unknown) => Promise<void> | void;
      prompt: string;
      schema: ZodType<Output>;
      schemaName: string;
    }) {
      seen.push(input.schemaName);
      return fixture.generate(input);
    },
    providerCost: (usage) => ({ amount: 0, currency: 'USD' as const, usage }),
  };
  const result = await extract(extractor(recording), HALF_SENTENCE);
  assert.deepEqual(seen, [STORE_SENTENCE_EXTRACT_SCHEMA_NAME]);
  assert.equal(result.suggestions[0]?.value, '青禾美业');
  assert.equal(
    STORE_SENTENCE_EXTRACT_SCHEMA_REVISION,
    'store-sentence-extract-v1',
  );
});
