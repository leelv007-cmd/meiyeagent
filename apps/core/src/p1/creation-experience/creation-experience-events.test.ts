/**
 * A3 / #90 — Creation experience event revisions (D-078 evidence boundary).
 * Seven kinds on append-only audit channel; privacy assertions.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  creationExperienceEventKinds,
  type CreationExperienceEventKind,
} from '@meiye/contracts';
import {
  FORBIDDEN_EVENT_PAYLOAD_KEYS,
  MemoryCreationExperienceEventAudit,
  buildCreationExperienceEvent,
  findForbiddenEventPayloadKey,
  listCreationExperienceEventKinds,
  sanitizeEventMeta,
} from './creation-experience-events.js';

const ALL_KINDS: CreationExperienceEventKind[] = [
  'exposure',
  'select',
  'apply',
  'start',
  'complete',
  'correct',
  'cancel',
];

describe('creation experience event kinds', () => {
  it('exports exactly seven kinds', () => {
    assert.deepEqual(listCreationExperienceEventKinds(), ALL_KINDS);
    assert.deepEqual([...creationExperienceEventKinds], ALL_KINDS);
    assert.equal(ALL_KINDS.length, 7);
  });
});

describe('append-only audit channel', () => {
  it('records all seven kinds with surface/recipe/action/lens revision', () => {
    const audit = new MemoryCreationExperienceEventAudit();
    for (const kind of ALL_KINDS) {
      audit.append({
        kind,
        sessionId: 'sess-1',
        correlationId: 'corr-1',
        actorId: 'user-1',
        lensId: 'image_text',
        lensRevisionId: 'lens.static@1',
        surfaceRevisionId: 'surface.home.launch@3',
        recipeRevisionId: 'recipe.promotion_poster@3',
        actionId: 'action.apply_recipe',
        actionRevisionId: 'action.apply_recipe@1',
        meta: { cardIndex: 2, featured: true },
      });
    }

    assert.equal(audit.size, 7);
    const listed = audit.list();
    assert.equal(listed.length, 7);

    const counts = audit.countByKind();
    for (const kind of ALL_KINDS) {
      assert.equal(counts[kind], 1, `expected one ${kind} event`);
    }

    for (const event of listed) {
      assert.equal(event.lensId, 'image_text');
      assert.equal(event.lensRevisionId, 'lens.static@1');
      assert.equal(event.surfaceRevisionId, 'surface.home.launch@3');
      assert.equal(event.recipeRevisionId, 'recipe.promotion_poster@3');
      assert.equal(event.actionId, 'action.apply_recipe');
      assert.equal(event.actionRevisionId, 'action.apply_recipe@1');
      assert.ok(event.eventId);
      assert.ok(event.recordedAt);
      assert.equal(findForbiddenEventPayloadKey(event), null);
    }
  });

  it('is append-only: list returns a snapshot; history is frozen', () => {
    const audit = new MemoryCreationExperienceEventAudit();
    const first = audit.append({
      kind: 'exposure',
      surfaceRevisionId: 'surface@1',
    });
    const snapshot = audit.list();
    assert.equal(snapshot.length, 1);

    // Mutating the returned list must not affect the store.
    (snapshot as CreationExperienceEventKind[]).pop?.();
    // @ts-expect-error — intentional runtime mutation attempt on snapshot array
    snapshot.length = 0;
    assert.equal(audit.size, 1);
    assert.equal(audit.list().length, 1);

    // Frozen event cannot grow forbidden fields.
    assert.throws(() => {
      // @ts-expect-error — frozen
      first.userText = 'secret body';
    });

    audit.append({ kind: 'select', lensId: 'copy' });
    assert.equal(audit.size, 2);
    assert.equal(audit.list()[0]?.kind, 'exposure');
    assert.equal(audit.list()[1]?.kind, 'select');
  });

  it('rejects unknown event kinds', () => {
    assert.throws(
      () =>
        buildCreationExperienceEvent({
          // @ts-expect-error — intentional invalid kind
          kind: 'dashboard_view',
        }),
      /Unknown creation experience event kind/,
    );
  });
});

describe('privacy boundary', () => {
  it('strips forbidden keys from meta (hidden prompt + user body)', () => {
    const cleaned = sanitizeEventMeta({
      cardIndex: 1,
      hiddenPrompt: 'SYSTEM: do secret things',
      hiddenPromptBody: 'never ship',
      prompt: 'ignore',
      userText: '用户敏感正文不应该进审计',
      body: 'body text',
      content: 'content leak',
      provider: 'openai',
      credential: 'sk-xxx',
      okFlag: true,
    });
    assert.deepEqual(cleaned, { cardIndex: 1, okFlag: true });
  });

  it('drops nested objects and long body-like strings from meta', () => {
    const cleaned = sanitizeEventMeta({
      nested: { userText: 'smuggle' },
      arr: [1, 2],
      short: 'ok',
      longBody: 'x'.repeat(281),
    });
    assert.deepEqual(cleaned, { short: 'ok' });
  });

  it('buildCreationExperienceEvent never retains forbidden keys', () => {
    const event = buildCreationExperienceEvent({
      kind: 'apply',
      surfaceRevisionId: 'surface@1',
      recipeRevisionId: 'recipe@1',
      lensId: 'copy',
      meta: {
        userText: '敏感',
        hiddenPromptBody: 'PROMPT',
        promptText: 'x',
        surfaceLabel: '首页',
      },
    });
    assert.equal(findForbiddenEventPayloadKey(event), null);
    assert.equal(event.meta?.surfaceLabel, '首页');
    assert.equal(event.meta?.userText, undefined);
    assert.equal(event.meta?.hiddenPromptBody, undefined);
    // Serialized form also clean.
    const json = JSON.stringify(event);
    for (const key of [
      'hiddenPrompt',
      'userText',
      'promptBody',
      'systemPrompt',
    ]) {
      assert.equal(
        json.includes(`"${key}"`),
        false,
        `serialized event must not contain ${key}`,
      );
    }
  });

  it('findForbiddenEventPayloadKey detects deep leaks', () => {
    assert.equal(
      findForbiddenEventPayloadKey({
        kind: 'start',
        meta: { nested: { prompt: 'bad' } },
      }),
      '$.meta.nested.prompt',
    );
    assert.equal(
      findForbiddenEventPayloadKey({
        kind: 'start',
        surfaceRevisionId: 's@1',
      }),
      null,
    );
  });

  it('FORBIDDEN_EVENT_PAYLOAD_KEYS covers prompt and sensitive body families', () => {
    const required = [
      'hiddenPromptBody',
      'hiddenPrompt',
      'prompt',
      'userText',
      'body',
      'content',
      'provider',
      'credential',
    ];
    for (const key of required) {
      assert.ok(
        (FORBIDDEN_EVENT_PAYLOAD_KEYS as readonly string[]).includes(key),
        `missing forbidden key ${key}`,
      );
    }
  });

  it('audit channel records have no dashboard aggregation API surface', () => {
    const audit = new MemoryCreationExperienceEventAudit();
    audit.append({ kind: 'complete', recipeRevisionId: 'r@1' });
    // Only append / list / countByKind / size — no metrics rollup / charts.
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(audit),
    ).filter((n) => n !== 'constructor');
    assert.ok(methods.includes('append'));
    assert.ok(methods.includes('list'));
    assert.ok(methods.includes('countByKind'));
    assert.equal(
      methods.some((m) =>
        /dashboard|chart|funnel|aggregateReport|metricsBoard/i.test(m),
      ),
      false,
    );
  });
});
