import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CreativeBrief, ProductState } from '@meiye/contracts';

import {
  confirmedBriefChips,
  CreativeBriefEditor,
  missingBriefAdoptFields,
  missingCreativeGrounding,
} from './creative-brief-editor';

const drafts = {
  audience: '未指定目标顾客；由商家确认后再定向表达',
  intent: '介绍真实门店项目',
  scene: '只使用已确认门店事实与授权素材',
  tone: '真实、克制，不补写未确认信息',
} as const;

test('unconfirmed Brief keeps the full editor and confirm action for recovery', () => {
  const brief: CreativeBrief = {
    fields: {
      intent: {
        aiDraft: drafts.intent,
        current: drafts.intent,
        owner: 'ai',
      },
      tone: {
        aiDraft: drafts.tone,
        current: '像老板娘当面讲',
        owner: 'merchant',
      },
    },
    updatedAt: '2026-07-14T09:00:00.000Z',
  };
  const html = renderToStaticMarkup(
    <CreativeBriefEditor
      brief={brief}
      busy={false}
      drafts={drafts}
      onConfirm={async () => {}}
      onUpdate={async () => {}}
    />
  );

  assert.equal((html.match(/data-brief-field=/g) ?? []).length, 4);
  assert.match(html, /像老板娘当面讲/);
  assert.match(html, /商家接管/);
  assert.match(html, /恢复 AI 草稿/);
  assert.match(html, /采用并确认 Brief/);
  assert.doesNotMatch(html, /data-testid="creative-brief-chips"/);
});

test('confirmed Brief defaults to passive chips without a confirm button', () => {
  const brief: CreativeBrief = {
    confirmedAt: '2026-07-14T09:05:00.000Z',
    fields: {
      intent: {
        aiDraft: drafts.intent,
        current: drafts.intent,
        owner: 'ai',
      },
      scene: {
        aiDraft: drafts.scene,
        current: drafts.scene,
        owner: 'ai',
      },
      tone: {
        aiDraft: drafts.tone,
        current: drafts.tone,
        owner: 'ai',
      },
      audience: {
        aiDraft: drafts.audience,
        current: drafts.audience,
        owner: 'ai',
      },
    },
    updatedAt: '2026-07-14T09:05:00.000Z',
  };
  const html = renderToStaticMarkup(
    <CreativeBriefEditor
      brief={brief}
      busy={false}
      drafts={drafts}
      onConfirm={async () => {}}
      onUpdate={async () => {}}
    />
  );

  assert.match(html, /data-testid="creative-brief-chips"/);
  assert.match(html, /本次将使用|Using for this run/);
  assert.match(html, /Brief 已确认|Brief confirmed/);
  assert.doesNotMatch(html, /采用并确认 Brief|Adopt and confirm Brief/);
  assert.doesNotMatch(html, /data-brief-field=/);
});

test('confirmed chips never fall back to unconfirmed drafts', () => {
  const brief: CreativeBrief = {
    confirmedAt: '2026-07-14T09:05:00.000Z',
    fields: {
      intent: {
        aiDraft: drafts.intent,
        current: '已确认意图',
        owner: 'merchant',
      },
    },
    updatedAt: '2026-07-14T09:05:00.000Z',
  };
  const chips = confirmedBriefChips(brief);
  assert.deepEqual(
    chips.map((chip) => chip.field),
    ['intent']
  );
  assert.equal(chips[0]?.value, '已确认意图');
  assert.equal(confirmedBriefChips(undefined).length, 0);
  assert.equal(
    confirmedBriefChips({
      fields: {
        intent: {
          aiDraft: drafts.intent,
          current: drafts.intent,
          owner: 'ai',
        },
      },
      updatedAt: '2026-07-14T09:00:00.000Z',
    }).length,
    0
  );
});

test('missingBriefAdoptFields lists only unsaved draft fields', () => {
  assert.deepEqual(
    missingBriefAdoptFields(
      {
        fields: {
          intent: {
            aiDraft: drafts.intent,
            current: drafts.intent,
            owner: 'ai',
          },
        },
        updatedAt: '2026-07-14T09:00:00.000Z',
      },
      drafts
    ).map((item) => item.field),
    ['scene', 'tone', 'audience']
  );
});

test('auto-confirming state shows a non-blocking status without confirm CTA', () => {
  const html = renderToStaticMarkup(
    <CreativeBriefEditor
      autoConfirming
      busy
      drafts={drafts}
      onConfirm={async () => {}}
      onUpdate={async () => {}}
    />
  );
  assert.match(html, /data-testid="creative-brief-auto-confirming"/);
  assert.doesNotMatch(html, /采用并确认 Brief|Adopt and confirm Brief/);
});

test('grounding readiness requires confirmed store, project, qualification and every selected real authorized Asset', () => {
  const product = {
    assets: [
      {
        authorizationStatus: 'authorized',
        id: 'asset-ready',
        rightsEvidence: 'confirmed by owner',
        sourceType: 'real',
      },
      {
        authorizationStatus: 'pending',
        id: 'asset-pending',
        sourceType: 'real',
      },
    ],
    qualification: { confirmed: false },
    store: {
      confirmedAt: '2026-07-14T08:00:00.000Z',
      projects: [{ confirmed: true }],
      regulated: true,
    },
  } as unknown as ProductState;

  assert.deepEqual(
    missingCreativeGrounding(product, [
      { id: 'asset-ready', kind: 'asset' },
      { id: 'asset-pending', kind: 'asset' },
    ]),
    ['confirmed_qualification', 'real_authorized_asset']
  );
  product.qualification = { ...product.qualification!, confirmed: true };
  product.assets[1] = {
    ...product.assets[1]!,
    authorizationStatus: 'authorized',
    rightsEvidence: 'confirmed by owner',
  };
  assert.deepEqual(
    missingCreativeGrounding(product, [
      { id: 'asset-ready', kind: 'asset' },
      { id: 'asset-pending', kind: 'asset' },
    ]),
    []
  );
  assert.deepEqual(missingCreativeGrounding(product, []), []);
});
