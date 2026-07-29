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
