import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  initialAssistantPatchDecision,
  isConversationNearBottom,
  projectAssistantMessageParts,
  reduceAssistantPatchDecision,
} from './creation-assistant-model';
import {
  AssistantConversationEntry,
  AssistantMessageParts,
  CREATION_ASSISTANT_SEED,
} from './creation-assistant';

const context = {
  workId: 'work-private-id',
  intent: '介绍真实的到店体验',
  tone: '克制、像熟客分享',
  sourceSummaries: ['asset:private-source-id'],
};

const tonePatch = {
  field: 'tone',
  value: '改成熟客分享的语气',
  reason: '更贴近当前创作意图',
};

test('reconciles final data parts over tool snapshots without exposing unknown payloads', () => {
  const projected = projectAssistantMessageParts([
    { type: 'text', text: '我先核对当前创作信息。' },
    {
      type: 'tool-readCurrentContext',
      toolCallId: 'context-tool',
      state: 'output-available',
      input: {},
      output: context,
    },
    {
      type: 'tool-proposeFieldPatch',
      toolCallId: 'patch-tool',
      state: 'output-available',
      input: tonePatch,
      output: { ...tonePatch, applied: false },
    },
    { type: 'data-context', id: 'context-data', data: context },
    { type: 'data-field_patch', id: 'patch-data', data: tonePatch },
    {
      type: 'data-private-provider-payload',
      data: { apiKey: 'must-not-render' },
    },
  ]);

  assert.deepEqual(
    projected.map((part) => part.kind),
    ['text', 'context', 'field-patch']
  );
  assert.deepEqual(projected[1], {
    id: 'context-data',
    kind: 'context',
    state: 'ready',
    summary: {
      intent: '介绍真实的到店体验',
      sourceCount: 1,
      tone: '克制、像熟客分享',
    },
  });
  assert.deepEqual(projected[2], {
    id: 'patch-data',
    kind: 'field-patch',
    patch: tonePatch,
    state: 'ready',
  });
  assert.equal(JSON.stringify(projected).includes('must-not-render'), false);
  assert.equal(JSON.stringify(projected).includes('work-private-id'), false);
  assert.equal(JSON.stringify(projected).includes('private-source-id'), false);
});

test('keeps accept, edit and ignore decisions local and explicit', () => {
  const pending = initialAssistantPatchDecision(tonePatch.value);
  assert.deepEqual(pending, { state: 'pending', value: tonePatch.value });

  const accepted = reduceAssistantPatchDecision(pending, { type: 'accept' });
  assert.deepEqual(accepted, { state: 'accepted', value: tonePatch.value });

  const editing = reduceAssistantPatchDecision(pending, { type: 'edit' });
  const changed = reduceAssistantPatchDecision(editing, {
    type: 'change',
    value: '改成更精简的熟客语气',
  });
  assert.deepEqual(
    reduceAssistantPatchDecision(changed, { type: 'save-edit' }),
    { state: 'accepted', value: '改成更精简的熟客语气' }
  );

  assert.deepEqual(reduceAssistantPatchDecision(pending, { type: 'ignore' }), {
    state: 'ignored',
    value: tonePatch.value,
  });
});

test('resets a local decision when the server replaces the proposed value', () => {
  const accepted = reduceAssistantPatchDecision(
    initialAssistantPatchDecision('input draft'),
    { type: 'accept' }
  );

  assert.deepEqual(
    reduceAssistantPatchDecision(accepted, {
      type: 'reset',
      value: 'validated output',
    }),
    { state: 'pending', value: 'validated output' }
  );
});

test('renders safe context and patch actions instead of raw structured JSON', () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessageParts, {
      parts: [
        { type: 'text', text: '建议微调语气。' },
        { type: 'data-context', data: context },
        { type: 'data-field_patch', id: 'patch-data', data: tonePatch },
        {
          type: 'dynamic-tool',
          toolName: 'providerDebug',
          toolCallId: 'debug-tool',
          state: 'output-available',
          input: {},
          output: { raw: 'secret-provider-json' },
        },
      ],
      streaming: false,
    })
  );

  assert.match(html, /建议微调语气/u);
  assert.match(html, /当前创作信息已读取/u);
  assert.match(html, /接受建议/u);
  assert.match(html, />编辑</u);
  assert.match(html, />忽略</u);
  assert.match(html, /不会自动写回草稿/u);
  assert.doesNotMatch(
    html,
    /secret-provider-json|work-private-id|private-source-id/u
  );
});

test('hides user seed turns and renders assistant proposals without chat chrome', () => {
  const userHtml = renderToStaticMarkup(
    createElement(AssistantConversationEntry, {
      message: {
        id: 'user-message',
        role: 'user',
        parts: [{ type: 'text', text: CREATION_ASSISTANT_SEED }],
      },
      streaming: false,
    })
  );
  const assistantHtml = renderToStaticMarkup(
    createElement(AssistantConversationEntry, {
      message: {
        id: 'assistant-message',
        role: 'assistant',
        parts: [{ type: 'text', text: '我先核对当前信息。' }],
      },
      streaming: false,
    })
  );

  // Transport seed is not chat chrome
  assert.equal(userHtml, '');
  assert.doesNotMatch(assistantHtml, /你：|创作副驾：|补充说明/u);
  assert.doesNotMatch(assistantHtml, /<header/u);
  assert.match(assistantHtml, /<article/u);
  assert.match(assistantHtml, /我先核对当前信息/u);
});

test('renders a document timeline instead of chat-bubble chrome', () => {
  const assistantHtml = renderToStaticMarkup(
    createElement(AssistantConversationEntry, {
      message: {
        id: 'assistant-message',
        role: 'assistant',
        parts: [
          { type: 'text', text: '建议微调语气。' },
          { type: 'data-field_patch', id: 'patch-data', data: tonePatch },
        ],
      },
      streaming: false,
    })
  );

  assert.doesNotMatch(assistantHtml, /rounded-xl border bg-muted/u);
  // Chat bubbles push messages with ml-auto; primary CTA buttons are fine.
  assert.doesNotMatch(assistantHtml, /ml-auto/u);
  assert.match(assistantHtml, /data-proposal-card="field-patch"/u);
  assert.match(
    assistantHtml,
    /rounded-2xl border border-divider bg-surface-0\/80/u
  );
  assert.match(assistantHtml, /接受建议/u);
  assert.match(assistantHtml, />编辑</u);
  assert.match(assistantHtml, />忽略</u);
});

test('does not expose free-text chat input on the workbench assistant', async () => {
  const source = await readFile(
    fileURLToPath(new URL('./creation-assistant.tsx', import.meta.url)),
    'utf8'
  );

  assert.doesNotMatch(source, /from '@\/components\/ui\/input'/u);
  assert.doesNotMatch(
    source,
    /creation_assistant_input_aria|creation_assistant_input_placeholder|creation_assistant_send/u
  );
  assert.match(source, /creation_assistant_fetch/u);
  assert.match(source, /CREATION_ASSISTANT_SEED/u);
  assert.equal(CREATION_ASSISTANT_SEED, '请根据当前意图给出表达建议');
});

test('sticks only while the reader remains near the conversation bottom', () => {
  assert.equal(
    isConversationNearBottom({
      clientHeight: 300,
      scrollHeight: 900,
      scrollTop: 560,
    }),
    true
  );
  assert.equal(
    isConversationNearBottom({
      clientHeight: 300,
      scrollHeight: 900,
      scrollTop: 400,
    }),
    false
  );
});
