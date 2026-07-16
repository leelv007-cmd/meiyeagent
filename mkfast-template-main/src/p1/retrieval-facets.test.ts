import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRetrievalQuery,
  CONTENT_PLATFORM_FILTER_OPTIONS,
  CONTENT_STATUS_FILTER_OPTIONS,
  TASK_RELATED_KIND_FILTER_OPTIONS,
  TASK_SOURCE_FILTER_OPTIONS,
  TASK_STATUS_FILTER_OPTIONS,
} from './retrieval-facets';

test('keeps task facets aligned with the Core task lifecycle', () => {
  assert.deepEqual(
    TASK_STATUS_FILTER_OPTIONS.slice(1).map((option) => option.value),
    [
      'todo',
      'in_progress',
      'needs_review',
      'needs_asset',
      'blocked',
      'ready',
      'done',
      'archived',
    ]
  );
  assert.deepEqual(
    TASK_SOURCE_FILTER_OPTIONS.slice(1).map((option) => option.value),
    [
      'weekly_batch',
      'asset_gap',
      'stale_draft',
      'weekly_review',
      'publish_ready',
      'manual',
    ]
  );
  assert.deepEqual(
    TASK_RELATED_KIND_FILTER_OPTIONS.slice(1).map((option) => option.value),
    [
      'asset',
      'content',
      'integration',
      'publication',
      'review',
      'template',
      'work',
    ]
  );
});

test('keeps content status facets aligned with Product ContentItem', () => {
  assert.deepEqual(
    CONTENT_STATUS_FILTER_OPTIONS.slice(1).map((option) => option.value),
    ['candidate', 'draft', 'abandoned', 'published']
  );
  assert.deepEqual(
    CONTENT_PLATFORM_FILTER_OPTIONS.slice(1).map((option) => option.value),
    ['xiaohongshu', 'douyin']
  );
});

test('matches a selected platform through multi-value tags and keeps scalar facets structured', () => {
  assert.deepEqual(
    buildRetrievalQuery({
      metadata: {
        platform: 'douyin',
        status: 'published',
        updatedDate: '2026-07-11',
      },
      query: '猫眼',
      scope: 'content',
    }),
    {
      kinds: ['content'],
      limit: 20,
      metadata: { status: 'published', updatedDate: '2026-07-11' },
      query: '猫眼',
      tags: ['douyin'],
    }
  );
});
