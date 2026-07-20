import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { ContentPackageProjection } from '@/p1/content-package-card';
import type {
  CreativeWorkbenchProjection,
  CreativeWork,
} from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const { CreativeObjectProjection } = await import('./creative-object-page');

function creativeWork(status: CreativeWork['status']): CreativeWork {
  return {
    createdAt: '2026-07-18T08:00:00.000Z',
    id: 'work-1',
    intent: '夏日清透美甲',
    mode: 'agent',
    sessionId: 'session-1',
    sourceReferences: [],
    status,
    updatedAt: '2026-07-18T09:00:00.000Z',
    workspaceId: 'workspace-1',
  };
}

function workbench(work: CreativeWork): CreativeWorkbenchProjection {
  return {
    assets: [],
    contents: [],
    events: [],
    jobs: [],
    works: [work],
  };
}

function acceptedPackage(): ContentPackageProjection {
  return {
    compliance: {
      aigcLabelEnabled: true,
      watermarkEnabled: false,
    },
    createdAt: '2026-07-18T08:30:00.000Z',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-1',
    kind: 'image_text',
    lineage: {},
    revision: 4,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId: 'work-1' },
    status: 'accepted',
    statusGroup: 'usable',
    statusLabel: '可使用',
    updatedAt: '2026-07-18T10:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
  };
}

function renderWork(
  work: CreativeWork,
  contentPackages: ContentPackageProjection[],
  kind: 'Session' | 'Work' = 'Work'
) {
  return renderToStaticMarkup(
    createElement(CreativeObjectProjection, {
      catalogLoaded: true,
      composedVideoAssets: [],
      contentPackages,
      data: workbench(work),
      id: kind === 'Session' ? work.sessionId : work.id,
      kind,
      templates: [],
    })
  );
}

test('accepted package replaces a stale draft work projection on detail pages', () => {
  const work = creativeWork('draft');
  const packageProjection = acceptedPackage();
  const pages = [
    renderWork(work, [packageProjection], 'Work'),
    renderWork(work, [packageProjection], 'Session'),
  ];

  for (const html of pages) {
    assert.match(html, /已交付/u);
    assert.match(html, /第 4 版/u);
    assert.match(html, /可使用/u);
    assert.match(html, /dashboard\/content\?packageId=package-1/u);
    assert.doesNotMatch(html, /草稿|持久化结果|Asset|Content/u);
  }
});

test('unmapped completed work is shown as an honest old-flow record', () => {
  const html = renderWork(creativeWork('completed'), []);

  assert.match(html, /旧版流程记录/u);
  assert.doesNotMatch(html, /已交付/u);
});
