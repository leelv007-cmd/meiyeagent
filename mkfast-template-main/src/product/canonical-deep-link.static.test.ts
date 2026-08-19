/**
 * LINK-01 / R-P1-09: static gate enumerates producer/consumer wiring.
 * Opening each link class must keep the object/stage; unmappable historical
 * objects must not fall through to default Composer.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  CANONICAL_DEEP_LINK_MAPPING,
  DEEP_LINK_OBJECT_CLASSES,
  DEEP_LINK_PRODUCERS,
  resolveCanonicalDeepLink,
} from './canonical-deep-link';

const webRoot = process.cwd();
const repoRoot = resolve(webRoot, '..');

const PRODUCER_FILES: Record<(typeof DEEP_LINK_PRODUCERS)[number], string[]> = {
  notification: [
    'apps/core/src/p1/due-delivery/delivery-port.ts',
    'apps/core/src/product/product-service.ts',
  ],
  feishu: ['apps/core/src/assembly/core-assembly.ts'],
  device_relay: ['mkfast-template-main/src/product/device-relay.ts'],
  global_command: [
    'mkfast-template-main/src/product/canonical-history-model.ts',
    'mkfast-template-main/src/p1/source-object-navigation.ts',
  ],
};

const CONSUMER_FILES = [
  'mkfast-template-main/src/routes/dashboard/index.tsx',
  'mkfast-template-main/src/routes/dashboard/content.tsx',
  'mkfast-template-main/src/routes/dashboard/tasks_/$taskId.tsx',
  'mkfast-template-main/src/product/canonical-deep-link-unavailable.tsx',
  'mkfast-template-main/src/product/results/result-center-search.ts',
];

function readRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

test('static gate enumerates every producer with a destination consumer', () => {
  for (const producer of DEEP_LINK_PRODUCERS) {
    const files = PRODUCER_FILES[producer];
    assert.ok(files.length > 0, `${producer} has no producer files`);
    for (const file of files) {
      const source = readRepo(file);
      assert.match(
        source,
        /serializeCanonicalDeepLink/u,
        `${file} must produce links through the mapping table`
      );
      assert.doesNotMatch(
        source,
        /deepLink:\s*'\/dashboard'/u,
        `${file} must not emit a bare Composer deep link`
      );
    }
    for (const objectClass of DEEP_LINK_OBJECT_CLASSES) {
      const row = CANONICAL_DEEP_LINK_MAPPING.find(
        (item) => item.producer === producer && item.objectClass === objectClass
      );
      assert.ok(row, `${producer}/${objectClass} missing from mapping table`);
      assert.ok(row.consumer, `${producer}/${objectClass} has no consumer`);
    }
  }
});

test('consumer routes resolve through the mapping table and honest unavailable', () => {
  for (const file of CONSUMER_FILES) {
    const source = readRepo(file);
    if (file.endsWith('canonical-deep-link-unavailable.tsx')) {
      assert.match(source, /canonical-deep-link-unavailable/u);
      assert.match(source, /historical_unavailable|deep_link_unavailable/u);
      continue;
    }
    if (file.endsWith('result-center-search.ts')) {
      assert.match(source, /parseDeepLinkStage|DEEP_LINK_STAGE_TO_PANEL/u);
      continue;
    }
    assert.match(
      source,
      /resolveCanonicalDeepLink/u,
      `${file} must consume the mapping table`
    );
  }
  const dashboard = readRepo(
    'mkfast-template-main/src/routes/dashboard/index.tsx'
  );
  assert.match(dashboard, /CanonicalDeepLinkUnavailable/u);
  assert.match(dashboard, /canonicalDeepLinkRedirectHref/u);
  const content = readRepo(
    'mkfast-template-main/src/routes/dashboard/content.tsx'
  );
  assert.match(content, /CanonicalDeepLinkUnavailable/u);
});

test('opening each inbound link class keeps object/stage or is explicit unavailable', () => {
  const cases = [
    {
      objectClass: 'taskId',
      search: { taskId: 'task-live', stage: 'action', entry: 'feishu' },
      pathname: '/dashboard',
      consumer: 'composer_task',
    },
    {
      objectClass: 'packageId',
      search: { packageId: 'pkg-9', stage: 'handoff' },
      pathname: '/dashboard',
      consumer: 'works_archive',
    },
    {
      objectClass: 'contentId',
      search: { contentId: 'legacy-content' },
      pathname: '/dashboard/content',
      consumer: 'historical_unavailable',
    },
    {
      objectClass: 'handoffId',
      search: { handoffId: 'legacy-handoff' },
      pathname: '/dashboard/content',
      consumer: 'historical_unavailable',
    },
    {
      objectClass: 'stage',
      search: { workId: 'work-1', stage: 'progress' },
      pathname: '/dashboard',
      consumer: 'result_center',
    },
    {
      objectClass: 'entry',
      search: { taskId: 'task-live', entry: 'notification' },
      pathname: '/dashboard',
      consumer: 'composer_task',
    },
  ] as const;

  for (const item of cases) {
    const destination = resolveCanonicalDeepLink({
      pathname: item.pathname,
      search: item.search,
    });
    assert.equal(destination.consumer, item.consumer);
    assert.notEqual(destination.consumer, 'composer_home');
    if (item.objectClass === 'stage') {
      assert.equal(destination.stage, item.search.stage);
    } else if (item.objectClass === 'entry') {
      assert.equal(destination.entry, item.search.entry);
    } else if (item.objectClass === 'taskId') {
      assert.equal(destination.taskId, item.search.taskId);
    } else if (item.objectClass === 'packageId') {
      assert.equal(destination.packageId, item.search.packageId);
    } else if (item.objectClass === 'contentId') {
      assert.equal(destination.objectId, item.search.contentId);
    } else {
      assert.equal(destination.objectId, item.search.handoffId);
    }
  }
});
