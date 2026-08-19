/**
 * LINK-01 / R-P1-09: mapping table completeness and honest unavailable.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_DEEP_LINK_MAPPING,
  DEEP_LINK_CONSUMERS,
  DEEP_LINK_OBJECT_CLASSES,
  DEEP_LINK_PRODUCERS,
  DEEP_LINK_STAGE_TO_PANEL,
  canonicalDeepLinkRedirectHref,
  deepLinkConsumerFor,
  destinationPreservesIdentity,
  resolveCanonicalDeepLink,
  serializeCanonicalDeepLink,
  type DeepLinkConsumer,
  type DeepLinkObjectClass,
  type DeepLinkProducer,
} from './canonical-deep-link.js';

const LIVE_CLASSES = ['packageId', 'taskId'] as const;
const HISTORICAL_CLASSES = ['contentId', 'handoffId'] as const;

test('mapping table enumerates every producer and inbound object class', () => {
  const seen = new Set<string>();
  for (const row of CANONICAL_DEEP_LINK_MAPPING) {
    seen.add(`${row.producer}:${row.objectClass}`);
    assert.equal(
      DEEP_LINK_CONSUMERS.includes(row.consumer as DeepLinkConsumer),
      true,
      `${row.producer}/${row.objectClass} has no destination consumer`
    );
  }
  for (const producer of DEEP_LINK_PRODUCERS) {
    for (const objectClass of DEEP_LINK_OBJECT_CLASSES) {
      assert.equal(
        seen.has(`${producer}:${objectClass}`),
        true,
        `missing mapping row ${producer}/${objectClass}`
      );
    }
  }
});

test('each producer maps every required class onto one consumer', () => {
  const expected: Record<DeepLinkObjectClass, DeepLinkConsumer> = {
    contentId: 'historical_unavailable',
    handoffId: 'historical_unavailable',
    packageId: 'works_archive',
    taskId: 'composer_task',
    stage: 'historical_unavailable',
    entry: 'historical_unavailable',
  };
  for (const producer of DEEP_LINK_PRODUCERS) {
    for (const objectClass of DEEP_LINK_OBJECT_CLASSES) {
      assert.equal(
        deepLinkConsumerFor(producer, objectClass),
        expected[objectClass]
      );
    }
  }
});

test('opening each live link class keeps the object and stage', () => {
  for (const producer of DEEP_LINK_PRODUCERS) {
    for (const objectClass of LIVE_CLASSES) {
      for (const stage of ['action', 'progress', 'handoff'] as const) {
        const href = serializeCanonicalDeepLink({
          producer,
          objectClass,
          id: `${objectClass}-1`,
          stage,
        });
        const url = new URL(href, 'https://meiye.internal');
        const destination = resolveCanonicalDeepLink({
          pathname: url.pathname,
          search: Object.fromEntries(url.searchParams.entries()),
        });
        assert.notEqual(destination.consumer, 'composer_home');
        assert.equal(
          destinationPreservesIdentity(destination, {
            objectClass,
            id: `${objectClass}-1`,
            stage,
            ...(producer === 'feishu' || producer === 'notification'
              ? { entry: producer }
              : {}),
          }),
          true,
          `${producer} ${objectClass} ${stage} dropped identity: ${href}`
        );
      }
    }
  }
});

test('notification and Feishu task links do not open default Composer', () => {
  for (const producer of ['notification', 'feishu'] as const) {
    const href = serializeCanonicalDeepLink({
      producer,
      objectClass: 'taskId',
      id: 'task-live',
      stage: 'action',
    });
    assert.match(href, /taskId=task-live/u);
    assert.match(href, new RegExp(`entry=${producer}`, 'u'));
    assert.match(href, /stage=action/u);
    const url = new URL(href, 'https://meiye.internal');
    const destination = resolveCanonicalDeepLink({
      pathname: url.pathname,
      search: Object.fromEntries(url.searchParams.entries()),
    });
    assert.equal(destination.consumer, 'composer_task');
    assert.equal(destination.taskId, 'task-live');
  }
});

test('device relay work/package links keep stage on the destination consumer', () => {
  const work = serializeCanonicalDeepLink({
    producer: 'device_relay',
    objectClass: 'workId',
    id: 'work-1',
    stage: 'progress',
  });
  assert.equal(
    work,
    '/dashboard/results/work-1?panel=run&stage=progress'
  );
  const workUrl = new URL(work, 'https://meiye.internal');
  const workDestination = resolveCanonicalDeepLink({
    pathname: workUrl.pathname,
    search: Object.fromEntries(workUrl.searchParams.entries()),
  });
  assert.equal(workDestination.consumer, 'result_center');
  assert.equal(workDestination.stage, 'progress');
  assert.equal(workDestination.panel, DEEP_LINK_STAGE_TO_PANEL.progress);

  const pack = serializeCanonicalDeepLink({
    producer: 'device_relay',
    objectClass: 'packageId',
    id: 'pkg-9',
    stage: 'handoff',
  });
  assert.equal(pack, '/dashboard/works/pkg-9?stage=handoff');
  const packUrl = new URL(pack, 'https://meiye.internal');
  const packDestination = resolveCanonicalDeepLink({
    pathname: packUrl.pathname,
    search: Object.fromEntries(packUrl.searchParams.entries()),
  });
  assert.equal(packDestination.consumer, 'works_archive');
  assert.equal(packDestination.packageId, 'pkg-9');
  assert.equal(packDestination.stage, 'handoff');
});

test('inbound dashboard package/work search does not drop stage onto Composer', () => {
  const pack = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: { packageId: 'pkg-9', stage: 'action' },
  });
  assert.equal(pack.consumer, 'works_archive');
  assert.equal(pack.stage, 'action');
  assert.equal(
    canonicalDeepLinkRedirectHref('/dashboard', pack),
    pack.href
  );
  assert.doesNotMatch(pack.href, /^\/dashboard\/?$/u);

  const work = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: { workId: 'work-1', stage: 'handoff' },
  });
  assert.equal(work.consumer, 'result_center');
  assert.equal(work.panel, 'delivery');
  assert.equal(work.stage, 'handoff');
  assert.equal(
    canonicalDeepLinkRedirectHref('/dashboard', work),
    work.href
  );
});

test('unmappable historical objects resolve to unavailable, not Composer', () => {
  for (const producer of DEEP_LINK_PRODUCERS) {
    for (const objectClass of HISTORICAL_CLASSES) {
      const href = serializeCanonicalDeepLink({
        producer,
        objectClass,
        id: `${objectClass}-legacy`,
      });
      const url = new URL(href, 'https://meiye.internal');
      const destination = resolveCanonicalDeepLink({
        pathname: url.pathname,
        search: Object.fromEntries(url.searchParams.entries()),
      });
      assert.equal(destination.consumer, 'historical_unavailable');
      assert.equal(destination.reason, 'historical');
      assert.equal(destination.objectId, `${objectClass}-legacy`);
      assert.equal(
        canonicalDeepLinkRedirectHref(url.pathname, destination),
        undefined
      );
    }
  }

  const inboundContent = resolveCanonicalDeepLink({
    pathname: '/dashboard/content',
    search: { contentId: 'legacy-content' },
  });
  assert.equal(inboundContent.consumer, 'historical_unavailable');
  assert.notEqual(inboundContent.consumer, 'composer_home');

  const inboundHandoff = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: { handoffId: 'legacy-handoff' },
  });
  assert.equal(inboundHandoff.consumer, 'historical_unavailable');
  assert.equal(inboundHandoff.objectClass, 'handoffId');
});

test('entry or stage without an object is unavailable instead of default Composer', () => {
  const entryOnly = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: { entry: 'feishu' },
  });
  assert.equal(entryOnly.consumer, 'historical_unavailable');
  assert.equal(entryOnly.objectClass, 'entry');
  assert.equal(entryOnly.entry, 'feishu');

  const stageOnly = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: { stage: 'handoff' },
  });
  assert.equal(stageOnly.consumer, 'historical_unavailable');
  assert.equal(stageOnly.objectClass, 'stage');
  assert.equal(stageOnly.stage, 'handoff');
});

test('legacy task path keeps the task id on Composer instead of dropping it', () => {
  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard/tasks/task-live',
    search: { stage: 'action' },
  });
  assert.equal(destination.consumer, 'composer_task');
  assert.equal(destination.taskId, 'task-live');
  assert.equal(destination.stage, 'action');
  assert.match(destination.href, /taskId=task-live/u);
  assert.equal(
    canonicalDeepLinkRedirectHref('/dashboard/tasks/task-live', destination),
    destination.href
  );
});

test('bare dashboard without object keys stays the real Composer home', () => {
  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search: {},
  });
  assert.equal(destination.consumer, 'composer_home');
  assert.equal(
    canonicalDeepLinkRedirectHref('/dashboard', destination),
    undefined
  );
});
