import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicContentPackage } from '@meiye/contracts';

import { platformPreviewsFromContentPackage } from './result-live-projection';

test('projects only formal generated variants into the result platform preview', () => {
  const contentPackage = {
    variants: [
      {
        id: 'package:xiaohongshu',
        platform: 'xiaohongshu',
        currentVersionId: 'formal-xiaohongshu',
        versions: [
          {
            id: 'formal-xiaohongshu',
            title: '小红书标题',
            body: '小红书正文',
            conversionHook: '收藏后预约',
            topics: ['夏日美甲'],
            source: 'ai_generated',
          },
        ],
      },
      {
        id: 'package:douyin',
        platform: 'douyin',
        currentVersionId: 'seed-douyin',
        versions: [
          {
            id: 'seed-douyin',
            title: '基础标题',
            body: '基础正文',
            topics: [],
          },
        ],
      },
    ],
  } as Pick<PublicContentPackage, 'variants'>;

  assert.deepEqual(platformPreviewsFromContentPackage(contentPackage), [
    {
      carrier: 'xiaohongshu',
      title: '小红书标题',
      body: '小红书正文',
      conversionHook: '收藏后预约',
      topics: ['夏日美甲'],
      source: 'copy.adapt',
    },
  ]);
});
