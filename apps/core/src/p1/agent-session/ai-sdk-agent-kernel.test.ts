/**
 * AiSdkAgentKernel production adapter tests (V31-06 gap fix).
 *
 * Mock model via ai/test MockLanguageModelV3 (streamText tool loop), same
 * AI SDK surface model-supply uses. Asserts multi-step tools → strict
 * AgentTurnDecision parse on the real AI SDK tool path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { AgentControlLimits } from '@meiye/contracts';

import {
  AiSdkAgentKernel,
  createSessionAgentKernel,
} from './ai-sdk-agent-kernel.js';
import {
  assertNoDurableCheckpointSurface,
  FixtureAgentKernel,
} from './agent-kernel.js';
import { AgentTurnRunner } from './turn-runner.js';

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 4,
  maxToolCalls: 6,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 0,
  maxSchemaRepairs: 1,
  maxContextTokens: 16_000,
  maxDelegations: 1,
};

const DECISION = {
  merchantMessage: '已检索并完成回合',
  action: { kind: 'finish_turn' as const },
  evidenceRefs: ['fact:1'],
  assumptions: [
    { key: 'platform', statement: '默认小红书', risk: 'low' as const },
  ],
};

function v3Usage(input: number, output: number) {
  return {
    inputTokens: {
      total: input,
      noCache: input,
      cacheRead: undefined as number | undefined,
      cacheWrite: undefined as number | undefined,
    },
    outputTokens: {
      total: output,
      text: output,
      reasoning: undefined as number | undefined,
    },
  };
}

function mockToolThenDecisionModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'response-metadata',
                id: 'id-1',
                modelId: 'mock',
                timestamp: new Date(0),
              },
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'read_context',
                input: JSON.stringify({ q: 'facts' }),
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls' as const, raw: undefined },
                usage: v3Usage(10, 5),
              },
            ],
          }),
        };
      }
      const text = JSON.stringify(DECISION);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'response-metadata',
              id: 'id-2',
              modelId: 'mock',
              timestamp: new Date(0),
            },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: text },
            { type: 'text-end', id: 't1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop' as const, raw: undefined },
              usage: v3Usage(12, 20),
            },
          ],
        }),
      };
    },
  });
}

test('AiSdkAgentKernel has no durable checkpoint surface', () => {
  const kernel = new AiSdkAgentKernel({ model: mockToolThenDecisionModel() });
  assertNoDurableCheckpointSurface(kernel);
});

test('AiSdkAgentKernel streamText tool loop → strict AgentTurnDecision', async () => {
  const kernel = new AiSdkAgentKernel({ model: mockToolThenDecisionModel() });
  const toolExecutions: unknown[] = [];
  const partials: unknown[] = [];

  const result = await kernel.runTurn({
    instructions: 'session harness test',
    prompt: JSON.stringify({ merchantRequest: { text: '种草' } }),
    activeToolNames: ['read_context'],
    maxLlmSteps: 4,
    tools: {
      read_context: {
        description: 'read store facts',
        sideEffect: 'none',
        execute: async (args) => {
          toolExecutions.push(args);
          return { facts: ['price'] };
        },
      },
    },
    onPartial: async (partial) => {
      partials.push(partial);
    },
  });

  assert.equal(result.decision.action.kind, 'finish_turn');
  assert.equal(result.decision.merchantMessage, DECISION.merchantMessage);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.toolName, 'read_context');
  assert.deepEqual(result.toolCalls[0]?.args, { q: 'facts' });
  assert.equal(toolExecutions.length, 1);
  assert.ok(result.steps >= 2);
  assert.ok(partials.length >= 1);
});

test('createSessionAgentKernel: fixture always FixtureAgentKernel; live needs direct', () => {
  const fixture = createSessionAgentKernel({ mode: 'fixture' });
  assert.ok(fixture instanceof FixtureAgentKernel);

  const missingLive = createSessionAgentKernel({
    mode: 'live',
    activation: 'live_verified',
    direct: null,
  });
  assert.equal(missingLive, undefined);

  const live = createSessionAgentKernel({
    mode: 'live',
    activation: 'live_verified',
    direct: {
      catalogModelId: 'llm-fixed',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'test-key',
      model: 'provider-model',
      inputCostPerMillion: 1,
      outputCostPerMillion: 2,
    },
  });
  assert.ok(live instanceof AiSdkAgentKernel);
});
