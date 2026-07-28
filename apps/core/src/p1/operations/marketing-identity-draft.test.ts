import assert from 'node:assert/strict';
import test from 'node:test';

import type { ZodType } from 'zod';

import { FixtureAiStructuredObjectExecutor } from '../model-supply/index.js';
import type { StructuredObjectExecutor } from '../model-supply/index.js';
import type { StructuredNodeRunnerRequest } from '../model-supply/structured-node-runner.js';
import {
  MARKETING_IDENTITY_DRAFT_SCHEMA_NAME,
  type MarketingIdentityDraftRunnerFactory,
  StructuredMarketingIdentityDrafter,
} from './marketing-identity-draft.js';

const context = {
  workspaceId: 'workspace-1',
  userId: 'owner-1',
  correlationId: 'correlation-1',
} as const;

function fixtureDrafter() {
  return new StructuredMarketingIdentityDrafter(
    runnerFactory(new FixtureAiStructuredObjectExecutor()),
  );
}

function runnerFactory(
  executor: StructuredObjectExecutor,
): MarketingIdentityDraftRunnerFactory {
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

function suggest(
  drafter: StructuredMarketingIdentityDrafter,
  request: Parameters<StructuredMarketingIdentityDrafter['suggest']>[0]['request'],
) {
  return drafter.suggest({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    effectIdempotencyKey: 'identity-draft-test',
    request,
  });
}

test('a brand draft returns the exact supported expressive fields and nothing else', async () => {
  const result = await suggest(fixtureDrafter(), {
    kind: 'brand',
    background: '青禾美业，做头皮护理十年，说话稳、不夸大',
    reference: null,
  });
  const suggestion = result.suggestion;

  assert.equal(result.status, 'suggested');
  assert.deepEqual(suggestion, {
    displayName: { value: '青禾美业', provenance: 'ai_suggestion' },
    owner: null,
    primaryClaimOrRole: null,
    professionalBoundaries: {
      value: '不夸大效果',
      provenance: 'ai_suggestion',
    },
    expressionSamples: null,
    forbiddenClaims: {
      value: '不夸大效果',
      provenance: 'ai_suggestion',
    },
    visualPrinciples: null,
    seriesAnchors: null,
  });
  // The consent record has no slot here at all — a caller cannot read an
  // authorization out of a draft because there is nothing to read.
  assert.equal('sourceRef' in suggestion, false);
  assert.equal('allowedPlatforms' in suggestion, false);
  assert.equal('allowedScenes' in suggestion, false);
  assert.equal('portraitAuthorization' in suggestion, false);
  assert.equal('voiceAuthorization' in suggestion, false);
});

test('a reference the merchant supplied is reported as read with a verifiable citation', async () => {
  const result = await suggest(fixtureDrafter(), {
    kind: 'brand',
    background: '青禾美业，做头皮护理十年',
    reference: {
      draftId: 'asset-draft-1',
      draftRevision: 2,
      parsedDocumentId: 'parsed-document-1',
      text: '暖棕色门店，主营头皮护理',
    },
  });
  const suggestion = result.suggestion;

  assert.equal(suggestion.primaryClaimOrRole?.value, '暖棕色门店，主营头皮护理');
  assert.equal(suggestion.primaryClaimOrRole?.provenance, 'document');
  if (suggestion.primaryClaimOrRole?.provenance !== 'document') {
    assert.fail('Expected a document-grounded suggestion.');
  }
  assert.equal(
    suggestion.primaryClaimOrRole.citation.exactQuote,
    '暖棕色门店，主营头皮护理',
  );
});

test('an unverifiable document claim is deterministically downgraded to an AI suggestion', async () => {
  const executor: StructuredObjectExecutor = {
    supportsCatalogModel: () => true,
    async generate<Output>(input: { schema: ZodType<Output> }) {
      return {
        output: input.schema.parse({
          displayName: null,
          owner: null,
          primaryClaimOrRole: {
            value: '门店主打祛痘治疗',
            provenance: 'document' as const,
            citation: { exactQuote: '祛痘治疗' },
          },
          professionalBoundaries: null,
          expressionSamples: null,
          forbiddenClaims: null,
          visualPrinciples: null,
          seriesAnchors: null,
        }),
        providerTaskRef: 'fixture-bad-citation',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    providerCost: (usage) => ({ amount: 0, currency: 'USD' as const, usage }),
  };
  const result = await suggest(
    new StructuredMarketingIdentityDrafter(runnerFactory(executor)),
    {
      kind: 'brand',
      background: '青禾美业',
      reference: {
        draftId: 'asset-draft-1',
        draftRevision: 2,
        parsedDocumentId: 'parsed-document-1',
        text: '暖棕色门店，主营头皮护理',
      },
    },
  );

  assert.deepEqual(result.suggestion.primaryClaimOrRole, {
    value: '门店主打祛痘治疗',
    provenance: 'ai_suggestion',
  });
});

test('a personal identity is never handed brand guidance it will not be asked for', async () => {
  const result = await suggest(fixtureDrafter(), {
    kind: 'person',
    background: '小美老师，染发师，做了八年',
    reference: null,
  });
  const suggestion = result.suggestion;

  assert.equal(suggestion.displayName?.value, '小美老师');
  assert.equal(suggestion.forbiddenClaims, null);
  assert.equal(suggestion.visualPrinciples, null);
  assert.equal(suggestion.seriesAnchors, null);
});

test('a provider failure is observable as unavailable, never blamed on empty merchant input', async () => {
  const failing: StructuredObjectExecutor = {
    supportsCatalogModel: () => true,
    generate: () => Promise.reject(new Error('provider unavailable')),
    providerCost: (usage) => ({ amount: 0, currency: 'USD' as const, usage }),
  };
  const result = await suggest(
    new StructuredMarketingIdentityDrafter(runnerFactory(failing)),
    { kind: 'brand', background: '青禾美业', reference: null },
  );

  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'model_execution_failed');
  assert.deepEqual(
    Object.values(result.suggestion),
    new Array(8).fill(null),
  );
});

test('the draft command reaches the assistant under one governed schema name', async () => {
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
  const drafter = new StructuredMarketingIdentityDrafter(
    runnerFactory(recording),
  );
  const result = await suggest(drafter, {
    kind: 'brand',
    background: '青禾美业，做头皮护理十年',
    reference: null,
  });

  assert.deepEqual(seen, [MARKETING_IDENTITY_DRAFT_SCHEMA_NAME]);
  assert.equal(result.suggestion.displayName?.value, '青禾美业');
});
