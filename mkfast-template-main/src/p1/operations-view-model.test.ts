import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CANVAS_TEMPLATE_NAME,
  officialCanvasTemplateName,
} from '@meiye/contracts';

import { overwriteGetLocale } from '../locale/paraglide/runtime';

import {
  officialTemplateCopyTarget,
  searchResultView,
  taskSystemText,
  type RawCanvasWork,
  type RawTask,
  type RawTemplate,
  taskView,
  templateViews,
} from './operations-view-model';

const publishedTemplate: RawTemplate = {
  family: 'price_card',
  id: 'official-price_card',
  name: '价格卡',
  publicationStatus: 'published',
  publishedVersionId: 'price-card-v2',
  tags: ['价格'],
};

function work(templateVersionId: string): RawCanvasWork {
  return {
    aigcLabelEnabled: false,
    brandWatermarkEnabled: false,
    currentRevisionId: 'revision-current',
    id: 'work-price-card',
    name: '价格卡作品',
    revisions: [
      {
        document: {
          height: 1350,
          pages: [{ elements: [], id: 'page-1' }],
          width: 1080,
        },
        id: 'revision-current',
        revision: 1,
      },
    ],
    templateId: publishedTemplate.id,
    templateVersionId,
  };
}

describe('P1 operations template view model', () => {
  it('localizes known official defaults without rewriting custom names', () => {
    overwriteGetLocale(() => 'en');
    try {
      const [defaultView, customView] = templateViews(
        [
          publishedTemplate,
          { ...publishedTemplate, id: 'custom', name: 'July menu' },
        ],
        [],
        []
      );

      assert.equal(defaultView?.name, 'Price card');
      assert.equal(customView?.name, 'July menu');
      const [savedOfficialView] = templateViews(
        [],
        [
          {
            canvasRevisionId: 'revision-saved-official',
            id: 'saved-official',
            name: officialCanvasTemplateName('price_card'),
            sourceWorkId: 'work-saved-official',
          },
        ],
        []
      );
      assert.equal(savedOfficialView?.name, 'Price card work template');
    } finally {
      overwriteGetLocale(() => 'zh');
    }
  });

  it('keeps unknown official template families merchant-friendly', () => {
    overwriteGetLocale(() => 'en');
    try {
      const [view] = templateViews(
        [
          {
            ...publishedTemplate,
            family: 'seasonal_campaign_internal_v3',
            id: 'official-seasonal-campaign',
          },
        ],
        [],
        []
      );

      assert.equal(view?.familyLabel, 'Other official template');
      assert.doesNotMatch(
        view?.familyLabel ?? '',
        /seasonal_campaign_internal_v3/u
      );
    } finally {
      overwriteGetLocale(() => 'zh');
    }
  });

  it('offers an upgrade only when the selected work is pinned to an older published version', () => {
    const oldVersion = templateViews(
      [publishedTemplate],
      [],
      [],
      work('price-card-v1')
    );
    assert.equal(oldVersion[0]?.updateAvailable, true);

    const currentVersion = templateViews(
      [publishedTemplate],
      [],
      [],
      work('price-card-v2')
    );
    assert.equal(currentVersion[0]?.updateAvailable, false);
  });

  it('does not turn an enabled canary into a downgrade to its published baseline', () => {
    const enabledTemplate: RawTemplate = {
      ...publishedTemplate,
      enabledVersionId: 'price-card-v3-canary',
      publicationStatus: 'enabled',
    };
    const views = templateViews(
      [enabledTemplate],
      [],
      [],
      work('price-card-v3-canary')
    );
    assert.equal(views[0]?.updateAvailable, false);
  });

  it('copies the selected historical version but falls back to the current published version', () => {
    assert.deepEqual(
      officialTemplateCopyTarget(publishedTemplate, work('price-card-v1')),
      {
        sourceWorkId: 'work-price-card',
        templateVersionId: 'price-card-v1',
      }
    );
    assert.deepEqual(officialTemplateCopyTarget(publishedTemplate), {
      templateVersionId: 'price-card-v2',
    });
  });
});

function task(relatedObject: RawTask['relatedObject']): RawTask {
  return {
    createdAt: '2026-07-11T08:00:00.000Z',
    dueAt: '2026-07-12T08:00:00.000Z',
    executable: true,
    id: 'task-a',
    relatedObject,
    risk: 'normal',
    source: 'manual',
    status: 'todo',
    title: '查看来源',
  };
}

describe('P1 task source view model', () => {
  it('resolves content and asset sources to their authoritative pages', () => {
    assert.equal(
      taskView(task({ id: 'content-a', kind: 'content' })).sourceLink?.href,
      '/dashboard/content?contentId=content-a'
    );
    assert.equal(
      taskView(task({ id: 'asset-a', kind: 'asset' })).sourceLink?.href,
      '/dashboard/assets/asset-a'
    );
    assert.equal(
      taskView(task({ id: 'handoff-a', kind: 'publication' })).sourceLink?.href,
      '/dashboard/content?handoffId=handoff-a'
    );
    assert.equal(
      taskView(task({ id: 'handoff-b', kind: 'publish' })).sourceLink?.href,
      '/dashboard/content?handoffId=handoff-b'
    );
  });

  it('keeps in-workbench sources as local navigation targets', () => {
    assert.equal(
      taskView(task({ id: 'review-a', kind: 'review' })).sourceLink?.href,
      undefined
    );
  });

  it('localizes known system task copy without translating user-authored titles', () => {
    overwriteGetLocale(() => 'en');

    assert.equal(
      taskView({
        ...task(undefined),
        blockedReason: '缺少完成本周内容所需的素材',
        nextStep: '打开素材库补充素材',
        title: '本周内容批次已就绪',
      }).title,
      "This week's content batch is ready"
    );
    assert.equal(
      taskView({ ...task(undefined), title: '用户自定义任务' }).title,
      '用户自定义任务'
    );

    overwriteGetLocale(() => 'zh');
  });

  it('sanitizes integration task identifiers while preserving user-authored titles', () => {
    overwriteGetLocale(() => 'en');

    assert.deepEqual(
      taskView({
        ...task({ id: 'intent-private', kind: 'integration' }),
        blockedReason:
          '\u9700\u8981 Owner \u786e\u8ba4\u540e\u624d\u80fd\u6267\u884c\u5916\u90e8\u9ad8\u98ce\u9669\u64cd\u4f5c',
        nextStep:
          '\u6253\u5f00\u4efb\u52a1\u5e76\u786e\u8ba4\u4e0d\u53ef\u53d8\u7684\u98de\u4e66\u64cd\u4f5c\u610f\u56fe',
        title:
          '\u786e\u8ba4\u98de\u4e66\u64cd\u4f5c\uff1aprivate.tool.identifier',
      }),
      {
        ...taskView(task({ id: 'intent-private', kind: 'integration' })),
        blockedReason:
          'Owner confirmation is required before running this high-risk external action',
        nextStep:
          'Open the task and confirm the immutable Feishu action intent',
        summary:
          'Owner confirmation is required before running this high-risk external action',
        title: 'Confirm Feishu action',
      }
    );
    assert.equal(
      taskView({
        ...task({ id: 'connection-private', kind: 'integration' }),
        title: '\u5904\u7406 private-provider \u8fde\u63a5\u5f02\u5e38',
      }).title,
      'Resolve connection issue'
    );
    assert.equal(
      taskView({
        ...task(undefined),
        title: 'Customer-defined private-provider task',
      }).title,
      'Customer-defined private-provider task'
    );
    assert.deepEqual(
      [
        taskSystemText('\u4efb\u52a1\u4e0d\u5b58\u5728'),
        taskSystemText('\u4efb\u52a1\u5df2\u7ec8\u7ed3'),
        taskSystemText('\u4efb\u52a1\u6b63\u5728\u6267\u884c'),
        taskSystemText(
          '\u7a0d\u540e\u91cd\u8bd5\u5e76\u786e\u8ba4\u8fde\u63a5\u6062\u590d'
        ),
        taskSystemText(
          '\u6253\u5f00\u96c6\u6210\u8bbe\u7f6e\u91cd\u65b0\u6388\u6743\u6216\u68c0\u67e5\u6743\u9650'
        ),
      ],
      [
        'Task not found',
        'Task already finished',
        'Task is running',
        'Retry later and confirm the connection has recovered',
        'Open integration settings to reauthorize or review permissions',
      ]
    );

    overwriteGetLocale(() => 'zh');
  });

  it('shows user tags and localized system tags without Core metadata values', () => {
    overwriteGetLocale(() => 'en');

    const view = searchResultView({
      id: 'asset-private',
      kind: 'asset',
      matchMode: 'structured',
      metadata: {
        authorization: 'authorized',
        projectionOwner: 'product',
        store: 'Private store metadata',
      },
      tags: ['customer-tag', 'xiaohongshu', 'authorized', 'normal'],
      text: 'Customer-authored excerpt',
      title: 'Customer-authored title',
    });

    assert.deepEqual(view.tags, [
      'customer-tag',
      'Xiaohongshu',
      'Authorized',
      'Normal risk',
    ]);
    assert.deepEqual(view.matchedBy, ['Structured filters']);
    assert.doesNotMatch(view.tags.join(' '), /Private|product/);
    assert.equal(
      searchResultView({
        id: 'asset-with-fallback-title',
        kind: 'asset',
        matchMode: 'exact',
        metadata: {},
        tags: [],
        text: '',
        title: '\u7d20\u6750',
      }).title,
      'Material'
    );
    assert.deepEqual(
      searchResultView({
        id: 'template-default-name',
        kind: 'template',
        matchMode: 'exact',
        metadata: {},
        tags: [],
        text: DEFAULT_CANVAS_TEMPLATE_NAME,
        title: DEFAULT_CANVAS_TEMPLATE_NAME,
      }),
      {
        excerpt: 'Blank visual post template',
        id: 'template-default-name',
        matchedBy: ['Full-text match'],
        scope: 'template',
        tags: [],
        title: 'Blank visual post template',
      }
    );
    const officialTemplate = searchResultView({
      id: 'official-price_card',
      kind: 'template',
      matchMode: 'fts',
      metadata: { family: 'price_card', official: 'true' },
      tags: ['价格', '项目'],
      text: '价格卡 price_card',
      title: '价格卡',
    });
    assert.deepEqual(officialTemplate, {
      excerpt: 'Price card',
      id: 'official-price_card',
      matchedBy: ['Full-text match'],
      scope: 'template',
      tags: ['Price card'],
      title: 'Price card',
    });
    assert.doesNotMatch(
      [
        officialTemplate.title,
        officialTemplate.excerpt,
        ...officialTemplate.tags,
      ].join(' '),
      /\p{Script=Han}/u
    );
    assert.deepEqual(
      searchResultView({
        id: 'official-price-card-custom-1',
        kind: 'template',
        matchMode: 'fts',
        metadata: { family: 'price_card', official: 'true' },
        tags: ['summer'],
        text: 'VIP summer menu price_card',
        title: 'VIP summer menu',
      }),
      {
        excerpt: 'VIP summer menu',
        id: 'official-price-card-custom-1',
        matchedBy: ['Full-text match'],
        scope: 'template',
        tags: ['summer'],
        title: 'VIP summer menu',
      }
    );

    overwriteGetLocale(() => 'zh');
    const legacyTemplate = searchResultView({
      id: 'template-legacy-default-name',
      kind: 'template',
      matchMode: 'exact',
      metadata: {},
      tags: [],
      text: 'Blank visual post template',
      title: 'Blank visual post template',
    });
    assert.equal(legacyTemplate.title, '空白图文作品模板');
    assert.equal(legacyTemplate.excerpt, '空白图文作品模板');
  });
});
