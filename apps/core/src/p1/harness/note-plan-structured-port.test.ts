import assert from 'node:assert/strict';
import test from 'node:test';

import { FixtureAiStructuredObjectExecutor } from '../model-supply/ai-sdk-runner.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import { ModelSupplyNotePlanStructuredPort } from './note-plan-structured-port.js';

test('NotePlan model runners consume the three frozen prompt contents', async () => {
  const runner = new RecordingFixtureRunner();
  const port = new ModelSupplyNotePlanStructuredPort(
    runner,
    'workflow-note-prompts',
    () => '2026-07-29T00:00:00.000Z',
    undefined,
    {
      notePlan: frozenPrompt('harness/note-plan', 'frozen:note-plan'),
      noteTextBlock: frozenPrompt(
        'harness/note-text-block',
        'frozen:note-text-block',
      ),
      noteConsistency: frozenPrompt(
        'harness/note-consistency',
        'frozen:note-consistency',
      ),
      xhsNoteGen: frozenPrompt(
        'harness/xhs-note-gen',
        'frozen:xhs-note-gen {topic} {tone} {roleBlock}',
      ),
    },
  );

  const plan = await port.plan({
    intent: '介绍护理项目',
    factRefs: [],
    rightsRefs: [],
  });
  const page = plan.pages[0]!;
  await port.draftPage({
    page,
    style: {
      id: 'practical_guide',
      name: '干货科普版',
      writingGuide: '先讲问题，再讲方法。',
    },
    themeAnchor: plan.themeAnchor,
  });
  await port.evaluate({ plan, attempt: 'initial' });

  assert.deepEqual(
    runner.requests.map(({ instructions }) => instructions),
    [
      'frozen:note-plan',
      'frozen:note-text-block',
      'frozen:note-consistency',
    ],
  );
});

test('XHS NotePlan text generation consumes the frozen beauty voice prompt', async () => {
  const runner = new RecordingFixtureRunner();
  const port = new ModelSupplyNotePlanStructuredPort(
    runner,
    'workflow-xhs-voice',
    () => '2026-08-02T00:00:00.000Z',
    undefined,
    {
      noteTextBlock: frozenPrompt(
        'harness/note-text-block',
        'frozen:note-text-block',
      ),
      xhsNoteGen: frozenPrompt(
        'harness/xhs-note-gen',
        'frozen:xhs-note-gen {topic} {tone} {roleBlock}',
      ),
    },
    {
      beautyVoiceRole: 'customer',
      topic: '介绍夏日控油护理',
    },
  );

  await port.draftPage({
    page: notePlanPage(),
    style: {
      id: 'practical_guide',
      name: '干货科普版',
      writingGuide: '先讲问题，再讲方法。',
    },
    themeAnchor: '夏日控油护理',
  });

  const request = runner.requests.at(-1)!;
  assert.match(request.instructions, /frozen:xhs-note-gen/u);
  assert.match(request.instructions, /介绍夏日控油护理/u);
  assert.match(request.instructions, /闺蜜聊天/u);
  assert.match(request.instructions, /到店体验顾客/u);
  assert.doesNotMatch(request.instructions, /\{topic\}|\{tone\}|\{roleBlock\}/u);
  assert.match(request.instructions, /frozen:note-text-block/u);
  assert.equal(request.promptKey, 'xhsNoteGen');
});

test('XHS NotePlan uses the frozen MarketingIdentity when free mode has no role override', async () => {
  const runner = new RecordingFixtureRunner();
  const port = new ModelSupplyNotePlanStructuredPort(
    runner,
    'workflow-xhs-default-identity',
    () => '2026-08-02T00:00:00.000Z',
    undefined,
    {
      noteTextBlock: frozenPrompt(
        'harness/note-text-block',
        'frozen:note-text-block',
      ),
      xhsNoteGen: frozenPrompt(
        'harness/xhs-note-gen',
        'frozen:xhs-note-gen {topic} {tone} {roleBlock}',
      ),
    },
    {
      marketingIdentityContext:
        '{"displayName":"夏日美研社","expressionSamples":["专业、克制、不夸大"]}',
      topic: '介绍夏日控油护理',
    },
  );

  await port.draftPage({
    page: notePlanPage(),
    style: {
      id: 'practical_guide',
      name: '干货科普版',
      writingGuide: '先讲问题，再讲方法。',
    },
    themeAnchor: '夏日控油护理',
  });

  const request = runner.requests.at(-1)!;
  assert.equal(request.promptKey, 'xhsNoteGen');
  assert.match(request.instructions, /门店 MarketingIdentity 默认表达/u);
  assert.match(request.instructions, /夏日美研社/u);
  assert.match(request.instructions, /专业、克制、不夸大/u);
  assert.doesNotMatch(request.instructions, /美容师口吻|店主口吻|顾客口吻/u);
});

class RecordingFixtureRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];
  private readonly executor = new FixtureAiStructuredObjectExecutor();

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    const result = await this.executor.generate(request);
    return {
      ...result,
      attempts: 1,
      replayed: false,
    };
  }
}

function frozenPrompt(name: string, content: string) {
  return {
    name,
    version: '6',
    content,
    contentHash: '6'.repeat(64),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };
}

function notePlanPage() {
  return {
    id: 'page-1',
    order: 1,
    revision: 1,
    pageRole: 'cover' as const,
    pagePurpose: 'capture_attention' as const,
    imageIntent: {
      operation: 'image.generate' as const,
      purpose: '控油护理封面',
      subject: '夏日控油护理',
      scene: '门店护理区',
      composition: '竖版主视觉',
      references: [],
      exactText: [],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' as const },
    },
    textBlock: {
      title: '夏日控油',
      body: '控油护理正文',
      exactText: [],
    },
    dependencies: [],
  };
}
