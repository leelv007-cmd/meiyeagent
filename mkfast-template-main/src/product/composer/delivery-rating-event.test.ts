import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ObservabilityAxes,
  type ObservabilityDropEvent,
  observabilityAxesSchema,
  observabilityDropEventSchema,
} from '@meiye/contracts';

import { buildTelemetryEvent } from '@/lib/product-telemetry';
import {
  type DeliveryRatingEventInput,
  emitDeliveryRatingEvent,
  resetDeliveryRatingEventWiring,
  setObservabilityDropSink,
  setSubstrateEventDeliverer,
  type SubstrateEventDeliverer,
} from './delivery-rating-event';

type DeliveredCall = Parameters<SubstrateEventDeliverer>;

const DELIVERY = {
  packageId: 'pkg-1',
  versionId: 'ver-1',
  revision: 3,
};

/** 四轴齐全的入参。键名不手抄：形状由 ObservabilityAxes 约束。 */
function axes(overrides: Partial<ObservabilityAxes> = {}) {
  return {
    catalogRevision: 'catalog-2026-07-29',
    promptVersion: 'delivery_rating@v2',
    scene: 'dashboard.delivery-card',
    skillRevision: 'copy.generate@v7',
    ...overrides,
  };
}

function input(
  overrides: Partial<DeliveryRatingEventInput> = {}
): DeliveryRatingEventInput {
  return {
    axes: axes(),
    delivery: DELIVERY,
    verdict: 'up',
    ...overrides,
  };
}

/** 两个注入点都换成记录器，跑一次，把结果交回断言。 */
function run(overrides: Partial<DeliveryRatingEventInput> = {}) {
  const delivered: DeliveredCall[] = [];
  const drops: ObservabilityDropEvent[] = [];
  setSubstrateEventDeliverer((eventName, payload) => {
    delivered.push([eventName, payload]);
  });
  setObservabilityDropSink((event) => {
    drops.push(event);
  });
  try {
    return {
      delivered,
      drops,
      sent: emitDeliveryRatingEvent(input(overrides)),
    };
  } finally {
    resetDeliveryRatingEventWiring();
  }
}

test('点赞发出的事件带满四轴 ＋ 产物标识，无一为空', () => {
  const { delivered, drops, sent } = run();

  assert.equal(sent, true);
  assert.equal(drops.length, 0);
  assert.equal(delivered.length, 1);
  const [eventName, payload] = delivered[0];
  assert.equal(eventName, 'rating_signal');

  // 键名取自上游合同，避免这里退化成手抄键名的第二真相源。
  assert.equal(
    observabilityAxesSchema.safeParse({
      catalogRevision: payload.catalogRevision,
      promptVersion: payload.promptVersion,
      scene: payload.scene,
      skillRevision: payload.skillRevision,
    }).success,
    true
  );
  assert.deepEqual(payload, {
    catalogRevision: 'catalog-2026-07-29',
    packageId: 'pkg-1',
    promptVersion: 'delivery_rating@v2',
    revision: 3,
    scene: 'dashboard.delivery-card',
    skillRevision: 'copy.generate@v7',
    verdict: 'up',
    versionId: 'ver-1',
  });
  // 「带满」＝没有空串占位（D-160③：补录不可能，宁可不发也不发假的）。
  for (const value of Object.values(payload)) {
    assert.notEqual(value, '');
  }
});

test('allowlist 那一条覆盖了 payload 的每个键，通道不会静默吞字段', () => {
  const { delivered } = run();
  const [eventName, payload] = delivered[0];

  const event = buildTelemetryEvent(eventName, payload, {
    releaseVersion: 'local',
    schemaRevision: 'uiux-p1-v1',
  });
  for (const [key, value] of Object.entries(payload)) {
    assert.equal(event[key], value, `字段 ${key} 被 allowlist 挡掉了`);
  }
});

test('四轴缺任一时不发事件，只发 permanent-config drop 事件', () => {
  for (const missing of [
    'catalogRevision',
    'promptVersion',
    'scene',
    'skillRevision',
  ] as const) {
    const partial: Partial<ObservabilityAxes> = axes();
    delete partial[missing];
    const { delivered, drops, sent } = run({ axes: partial });

    assert.equal(sent, false, `缺 ${missing} 却投了出去`);
    assert.equal(delivered.length, 0);
    assert.deepEqual(observabilityDropEventSchema.parse(drops[0]), {
      count: 1,
      reason: 'permanent-config',
      signal: 'feedback',
      source: 'dashboard.rating-bar',
    });
    assert.equal(drops.length, 1);
  }
});

test('轴整体取不到（main 现状）同样拒发并留下负向证据', () => {
  const { delivered, drops, sent } = run({ axes: undefined });

  assert.equal(sent, false);
  assert.equal(delivered.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, 'permanent-config');
});

test('复合 revision 的 `@` 格式不合时拒发，不补空串也不放行', () => {
  // compositeRevisionSchema 的正则：恰好一个 `@`、两侧非空且无空白。
  for (const bad of [
    'copy.generate',
    'copy.generate@',
    '@v7',
    'copy.generate@v7@v8',
    'copy generate@v7',
    'copy.generate@ v7',
    '',
  ]) {
    const { delivered, drops, sent } = run({
      axes: axes({ skillRevision: bad }),
    });
    assert.equal(sent, false, `skillRevision=${JSON.stringify(bad)} 被放行了`);
    assert.equal(delivered.length, 0);
    assert.equal(drops[0].reason, 'permanent-config');
  }
});

test('任一轴超过通道的 120 字符上限时拒发，绝不预截断', () => {
  const long = `${'a'.repeat(60)}@${'b'.repeat(60)}`; // 121 字符，正则仍合法
  assert.equal(long.length, 121);
  assert.equal(
    observabilityAxesSchema.safeParse(axes({ skillRevision: long })).success,
    true
  );

  const { delivered, drops, sent } = run({
    axes: axes({ skillRevision: long }),
  });

  assert.equal(sent, false);
  assert.equal(delivered.length, 0);
  assert.deepEqual(observabilityDropEventSchema.parse(drops[0]), {
    count: 1,
    reason: 'permanent-config',
    signal: 'feedback',
    source: 'dashboard.rating-bar',
  });
});

test('产物标识超长同样拒发 —— 截断是通道的性质，不分字段', () => {
  const { delivered, drops, sent } = run({
    delivery: { ...DELIVERY, packageId: 'p'.repeat(121) },
  });

  assert.equal(sent, false);
  assert.equal(delivered.length, 0);
  assert.equal(drops[0].reason, 'permanent-config');
});

test('恰好 120 字符仍投递 —— 门是「超过」不是「接近」', () => {
  const exact = `${'a'.repeat(59)}@${'b'.repeat(60)}`;
  assert.equal(exact.length, 120);

  const { delivered, sent } = run({ axes: axes({ skillRevision: exact }) });

  assert.equal(sent, true);
  assert.equal(delivered[0][1].skillRevision, exact);
});

test('投递抛异常时发一条 transient drop 事件，且不冒泡给调用点', () => {
  const drops: ObservabilityDropEvent[] = [];
  setSubstrateEventDeliverer(() => {
    throw new Error('offline');
  });
  setObservabilityDropSink((event) => {
    drops.push(event);
  });

  const sent = emitDeliveryRatingEvent(input({ verdict: 'down' }));
  resetDeliveryRatingEventWiring();

  assert.equal(sent, false);
  assert.deepEqual(observabilityDropEventSchema.parse(drops[0]), {
    count: 1,
    reason: 'transient', // 投递抛异常＝可恢复，与缺轴不同因
    signal: 'feedback',
    source: 'dashboard.rating-bar',
  });
  assert.equal(drops.length, 1);
});

test('drop sink 自己坏掉也不冒泡 —— 评价按钮永不因埋点报错', () => {
  setSubstrateEventDeliverer(() => {
    throw new Error('offline');
  });
  setObservabilityDropSink(() => {
    throw new Error('sink is broken too');
  });

  assert.doesNotThrow(() => {
    assert.equal(emitDeliveryRatingEvent(input()), false);
  });
  resetDeliveryRatingEventWiring();
});

test('出口可替换，复位后不再流向被注入的实现', () => {
  const delivered: DeliveredCall[] = [];
  setSubstrateEventDeliverer((eventName, payload) => {
    delivered.push([eventName, payload]);
  });
  emitDeliveryRatingEvent(input());
  assert.equal(delivered.length, 1);

  resetDeliveryRatingEventWiring();
  emitDeliveryRatingEvent(input());
  assert.equal(delivered.length, 1);
});

test('投出去的是 schema 认下来的那份值（trim 后），不是入参原值', () => {
  const { delivered, sent } = run({
    axes: axes({ scene: '  dashboard.delivery-card  ' }),
  });

  assert.equal(sent, true);
  assert.equal(delivered[0][1].scene, 'dashboard.delivery-card');
});
