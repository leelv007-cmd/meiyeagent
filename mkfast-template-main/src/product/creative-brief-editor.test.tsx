import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CreativeBrief, ProductState } from '@meiye/contracts';

import {
  CreativeBriefEditor,
  missingCreativeGrounding,
} from './creative-brief-editor';

const drafts = {
  audience: '未指定目标顾客；由商家确认后再定向表达',
  intent: '介绍真实门店项目',
  scene: '只使用已确认门店事实与授权素材',
  tone: '真实、克制，不补写未确认信息',
} as const;

test('unconfirmed Brief exposes four grounded drafts and one explicit confirmation action', () => {
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
  assert.doesNotMatch(html, /只在本地确认/);
});

test('confirmed Brief renders durable ownership without another primary confirmation action', () => {
  const brief: CreativeBrief = {
    confirmedAt: '2026-07-14T09:05:00.000Z',
    fields: {
      intent: {
        aiDraft: drafts.intent,
        current: drafts.intent,
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

  assert.match(html, /Brief 已确认/);
  assert.doesNotMatch(html, /采用并确认 Brief/);
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
});
