import assert from 'node:assert/strict';
import test from 'node:test';

import { mapComposerDestination } from './composer-destination-client';

test('posts only the merchant destination sentence and parses a mapped pair', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: {
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'manual_copy',
        status: 'mapped',
      },
    });
  };
  try {
    const result = await mapComposerDestination('发到小红书，生成后我自己复制');
    assert.deepEqual(result, {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      status: 'mapped',
    });
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/composer/destination-map'
    );
    assert.deepEqual(await request?.json(), {
      destination: '发到小红书，生成后我自己复制',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('keeps conservative clarification structured and rejects extra response fields', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: {
        options: [
          {
            contentPackagePlatform: 'douyin',
            distributionTarget: 'manual_copy',
            label: '抖音，生成后手动复制',
          },
        ],
        question: '准备发到哪里，生成后希望怎么交付？',
        status: 'needs_clarification',
      },
    });
  try {
    const result = await mapComposerDestination('帮我写一条活动文案');
    assert.equal(result.status, 'needs_clarification');
    if (result.status === 'needs_clarification') {
      assert.equal(result.options[0]?.distributionTarget, 'manual_copy');
    }
  } finally {
    globalThis.fetch = previousFetch;
  }

  globalThis.fetch = async () =>
    Response.json({
      data: {
        contentPackagePlatform: 'douyin',
        distributionTarget: 'export',
        status: 'mapped',
        silentlyAdded: true,
      },
    });
  try {
    await assert.rejects(
      mapComposerDestination('发到抖音'),
      /unrecognized|Unrecognized|invalid|Invalid/u
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
