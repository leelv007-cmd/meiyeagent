import assert from 'node:assert/strict';
import test from 'node:test';

import type { MarketingIdentitySuggestion } from '@meiye/contracts';
import type { ZodType } from 'zod';

import { FixtureAiStructuredObjectExecutor } from '../model-supply/index.js';
import type { StructuredObjectExecutor } from '../model-supply/index.js';
import {
  MARKETING_IDENTITY_DRAFT_SCHEMA_NAME,
  StructuredMarketingIdentityDrafter,
} from './marketing-identity-draft.js';
import {
  MarketingIdentityFoundationModule,
  MemoryMarketingIdentityRepository,
} from './marketing-identity.js';

const context = {
  workspaceId: 'workspace-1',
  userId: 'owner-1',
  correlationId: 'correlation-1',
} as const;

function fixtureDrafter() {
  return new StructuredMarketingIdentityDrafter(
    new FixtureAiStructuredObjectExecutor(),
  );
}

test('a brand draft names every expressive field and nothing else', async () => {
  const suggestion = await fixtureDrafter().suggest({
    request: {
      kind: 'brand',
      background: '青禾美业，做头皮护理十年，说话稳、不夸大',
    },
  });

  assert.equal(suggestion.displayName?.value, '青禾美业');
  assert.equal(suggestion.displayName?.provenance, 'ai_suggestion');
  assert.equal(suggestion.forbiddenClaims?.value, '不承诺永久效果');
  // The consent record has no slot here at all — a caller cannot read an
  // authorization out of a draft because there is nothing to read.
  assert.equal('sourceRef' in suggestion, false);
  assert.equal('allowedPlatforms' in suggestion, false);
  assert.equal('allowedScenes' in suggestion, false);
  assert.equal('portraitAuthorization' in suggestion, false);
  assert.equal('voiceAuthorization' in suggestion, false);
});

test('a reference the merchant supplied is reported as read, not guessed', async () => {
  const suggestion = await fixtureDrafter().suggest({
    request: {
      kind: 'brand',
      background: '青禾美业，做头皮护理十年',
      referenceText: '暖棕色门店，主营头皮护理',
    },
  });

  assert.equal(suggestion.primaryClaimOrRole?.value, '暖棕色门店，主营头皮护理');
  assert.equal(suggestion.primaryClaimOrRole?.provenance, 'document');
});

test('a personal identity is never handed brand guidance it will not be asked for', async () => {
  const suggestion = await fixtureDrafter().suggest({
    request: { kind: 'person', background: '小美老师，染发师，做了八年' },
  });

  assert.equal(suggestion.displayName?.value, '小美老师');
  assert.equal(suggestion.forbiddenClaims, null);
  assert.equal(suggestion.visualPrinciples, null);
  assert.equal(suggestion.seriesAnchors, null);
});

test('a provider that fails leaves the merchant with the questions, not an error', async () => {
  const failing: StructuredObjectExecutor = {
    supportsCatalogModel: () => true,
    generate: () => Promise.reject(new Error('provider unavailable')),
    providerCost: (usage) => ({ amount: 0, currency: 'USD' as const, usage }),
  };
  const suggestion = await new StructuredMarketingIdentityDrafter(
    failing,
  ).suggest({
    request: { kind: 'brand', background: '青禾美业' },
  });

  assert.deepEqual(Object.values(suggestion), new Array(8).fill(null));
});

test('the draft command reaches the assistant under one schema name', async () => {
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
  const module = new MarketingIdentityFoundationModule(
    new MemoryMarketingIdentityRepository(),
    () => '2026-07-28T00:00:00.000Z',
    new StructuredMarketingIdentityDrafter(recording),
  );

  const suggestion = (await module.execute({
    context,
    idempotencyKey: 'identity-draft-1',
    input: {
      action: 'draft_marketing_identity',
      payload: { kind: 'brand', background: '青禾美业，做头皮护理十年' },
    },
  })) as MarketingIdentitySuggestion;

  assert.deepEqual(seen, [MARKETING_IDENTITY_DRAFT_SCHEMA_NAME]);
  assert.equal(suggestion.displayName?.value, '青禾美业');
});

test('without a structured model the draft command still answers, emptily', async () => {
  const module = new MarketingIdentityFoundationModule(
    new MemoryMarketingIdentityRepository(),
    () => '2026-07-28T00:00:00.000Z',
  );

  const suggestion = (await module.execute({
    context,
    idempotencyKey: 'identity-draft-2',
    input: {
      action: 'draft_marketing_identity',
      payload: { kind: 'brand', background: '青禾美业' },
    },
  })) as MarketingIdentitySuggestion;

  assert.equal(suggestion.displayName, null);
});
