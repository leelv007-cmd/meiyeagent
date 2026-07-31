import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ZodType } from 'zod';

import { FixtureAiStructuredObjectExecutor } from '../model-supply/ai-sdk-runner.js';
import type { StructuredObjectExecutor } from '../model-supply/index.js';
import {
  StructuredComposerDestinationMapper,
} from './composer-destination-mapper.js';

test('maps explicit natural language into platform and delivery fields through the structured model seam', async () => {
  const executor = new RecordingExecutor({
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  const mapper = new StructuredComposerDestinationMapper(executor);

  const result = await mapper.map({
    destination: '发到小红书，生成后我自己复制',
  });

  assert.deepEqual(result, {
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.schemaName, 'composer_destination_mapping_v1');
  assert.match(executor.calls[0]?.prompt ?? '', /小红书/u);
  assert.doesNotMatch(
    JSON.stringify(result),
    /creationMode|intent/u,
    'the preflight mapper must not mutate the separately signed intent fields',
  );
});

test('destination mapping consumes the request-pinned prompt and does not swallow resolver failure', async () => {
  const executor = new RecordingExecutor({
    contentPackagePlatform: 'douyin',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  const mapper = new StructuredComposerDestinationMapper(executor, {
    async resolve() {
      return frozenPrompt('frozen:destination-mapping');
    },
  });

  await mapper.map({ destination: '发到抖音，生成后手动复制' });

  assert.equal(executor.calls[0]?.instructions, 'frozen:destination-mapping');

  const unavailable = new StructuredComposerDestinationMapper(executor, {
    async resolve() {
      throw new Error('pinned prompt unavailable');
    },
  });
  await assert.rejects(
    unavailable.map({ destination: '发到小红书' }),
    /pinned prompt unavailable/u,
  );
  assert.equal(executor.calls.length, 1);
});

test('destination mapping persists pilot fallback lineage before provider invocation', async () => {
  const executor = new RecordingExecutor({
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  const audits: Array<Record<string, unknown>> = [];
  const fallback = {
    ...frozenPrompt('builtin:destination-mapping'),
    version: 'builtin-v1',
    source: 'builtin' as const,
    isFallback: true,
    fallbackReason: 'http_503',
  };
  const mapper = new StructuredComposerDestinationMapper(
    executor,
    {
      async resolve() {
        return fallback;
      },
    },
    {
      async appendPromptAudit(event) {
        audits.push(
          structuredClone(event) as unknown as Record<string, unknown>,
        );
      },
    },
  );

  await mapper.map({
    destination: '发到小红书，生成后手动复制',
    idempotencyKey: 'destination-map-stable-1',
    workspaceId: 'workspace-1',
  });
  await mapper.map({
    destination: '发到小红书，生成后手动复制',
    idempotencyKey: 'destination-map-stable-1',
    workspaceId: 'workspace-1',
  });

  assert.equal(executor.calls[0]?.instructions, fallback.content);
  assert.deepEqual(audits.map(({ eventType }) => eventType), [
    'langfuse_prompt_fallback',
    'langfuse_prompt_fallback',
  ]);
  assert.equal(audits[0]?.id, audits[1]?.id);
  assert.equal(JSON.stringify(audits).includes(fallback.content), false);
  assert.deepEqual(
    (audits[0]?.payload as { prompt?: Record<string, unknown> }).prompt,
    {
      name: 'harness/destination-mapping',
      version: 'builtin-v1',
      contentHash: fallback.contentHash,
      label: 'production',
      source: 'builtin',
      isFallback: true,
      fallbackReason: 'http_503',
    },
  );
});

test('destination mapping rejects the wrong prompt name or content hash before provider I/O', async () => {
  for (const prompt of [
    {
      ...frozenPrompt('wrong prompt name'),
      name: 'harness/copy-generation',
    },
    {
      ...frozenPrompt('wrong prompt hash'),
      contentHash: 'f'.repeat(64),
    },
  ]) {
    const executor = new RecordingExecutor({
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      status: 'mapped',
    });
    const mapper = new StructuredComposerDestinationMapper(executor, {
      async resolve() {
        return prompt;
      },
    });

    await assert.rejects(
      mapper.map({ destination: '发到小红书，生成后手动复制' }),
      /Prompt binding/u,
    );
    assert.equal(executor.calls.length, 0);
  }
});

test('fixture Day-0 mappings cover Moments handoff and offline export without treating Moments as a variant', async () => {
  const mapper = new StructuredComposerDestinationMapper(
    new FixtureAiStructuredObjectExecutor(),
  );

  assert.deepEqual(
    await mapper.map({ destination: '朋友圈给同事协助发' }),
    {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'assisted_handoff',
      status: 'mapped',
    },
  );
  assert.deepEqual(await mapper.map({ destination: '做店内立牌，导出文件' }), {
    contentPackagePlatform: 'offline_material',
    distributionTarget: 'export',
    status: 'mapped',
  });
  assert.deepEqual(await mapper.map({ destination: '直接发布到小红书' }), {
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
});

test('conflicting Day-0 input returns a focused clarification instead of guessing', async () => {
  const mapper = new StructuredComposerDestinationMapper(
    new FixtureAiStructuredObjectExecutor(),
  );

  const result = await mapper.map({
    destination: '小红书还是抖音都可以，怎么发也无所谓',
  });

  assert.equal(result.status, 'needs_clarification');
  if (result.status === 'needs_clarification') {
    assert.match(result.question, /哪里|哪个/u);
    assert.ok(result.options.length > 0);
  }
});

test('empty input and invalid model output fail closed to guidance rather than a hard error', async () => {
  const executor = new RecordingExecutor({
    contentPackagePlatform: 'wechat_moments',
    distributionTarget: 'automatic_publish',
    status: 'mapped',
  });
  const mapper = new StructuredComposerDestinationMapper(executor);

  const empty = await mapper.map({ destination: '   ' });
  assert.equal(empty.status, 'needs_clarification');
  assert.equal(executor.calls.length, 0);

  const incompatible = await mapper.map({ destination: '发朋友圈' });
  assert.equal(incompatible.status, 'needs_clarification');
  assert.equal(executor.calls.length, 1);
});

class RecordingExecutor implements StructuredObjectExecutor {
  readonly calls: Array<{
    instructions: string;
    prompt: string;
    schemaName: string;
  }> = [];

  constructor(private readonly output: unknown) {}

  supportsCatalogModel() {
    return true;
  }

  async generate<Output>(input: {
    instructions: string;
    prompt: string;
    schema: ZodType<Output>;
    schemaName: string;
  }) {
    this.calls.push({
      instructions: input.instructions,
      prompt: input.prompt,
      schemaName: input.schemaName,
    });
    return {
      output: input.schema.parse(this.output),
      providerTaskRef: 'fixture-destination-map',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return { amount: 0, currency: 'USD' as const, usage };
  }
}

function frozenPrompt(content: string) {
  return {
    name: 'harness/destination-mapping',
    version: '17',
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };
}
