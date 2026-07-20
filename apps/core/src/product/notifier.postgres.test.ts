import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  PostgresIdempotentProductNotifier,
  WebhookProductNotifier,
  type ProductNotification,
  type ProductNotifier,
} from './notifier.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('webhook forwards the stable idempotency key', async () => {
  let observedHeaders: HeadersInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    observedHeaders = init?.headers;
    return new Response(null, { status: 200 });
  };
  const notifier = new WebhookProductNotifier(
    'https://hooks.example.test/product',
    'https://app.example.test',
    fetchImpl,
  );

  await notifier.notify({
    workspaceId: 'workspace-a',
    jobId: 'task-a',
    status: 'needs_action',
    message: '请处理任务',
    deepLink: '/dashboard',
    correlationId: 'notification-a',
    idempotencyKey: 'effect-a',
  });

  assert.equal(new Headers(observedHeaders).get('x-idempotency-key'), 'effect-a');
});

test(
  'Postgres notifier replays sent receipts and fences unknown webhook delivery',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is required.' },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `notification-${randomUUID()}`;
    const deliveries: string[] = [];
    const delegate: ProductNotifier = {
      async notify(notification) {
        deliveries.push(notification.jobId);
        if (notification.jobId === 'response-loss') {
          throw new Error('webhook response lost');
        }
      },
    };
    const notifier = new PostgresIdempotentProductNotifier(pool, delegate);
    const client = await pool.connect();
    try {
      await notifier.migrate(client);
    } finally {
      client.release();
    }
    const notification: ProductNotification = {
      workspaceId,
      jobId: 'task-a',
      status: 'needs_action',
      message: '请处理任务',
      deepLink: '/dashboard',
      correlationId: 'notification-a',
      idempotencyKey: 'effect-a',
    };

    try {
      await notifier.notify(notification);
      await notifier.notify(notification);
      assert.deepEqual(deliveries, ['task-a']);

      await assert.rejects(
        notifier.notify({ ...notification, message: '冲突内容' }),
        /conflicts with another payload/,
      );

      const responseLoss = {
        ...notification,
        jobId: 'response-loss',
        idempotencyKey: 'effect-response-loss',
      };
      await assert.rejects(
        notifier.notify(responseLoss),
        /webhook response lost/,
      );
      await assert.rejects(
        notifier.notify(responseLoss),
        /requires explicit reconciliation/,
      );
      assert.deepEqual(deliveries, ['task-a', 'response-loss']);

      let releaseDelivery!: () => void;
      let markDeliveryStarted!: () => void;
      const deliveryStarted = new Promise<void>((resolve) => {
        markDeliveryStarted = resolve;
      });
      const deliveryGate = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      let concurrentDeliveries = 0;
      const concurrentNotifier = new PostgresIdempotentProductNotifier(pool, {
        async notify() {
          concurrentDeliveries += 1;
          markDeliveryStarted();
          await deliveryGate;
        },
      });
      const concurrent = {
        ...notification,
        jobId: 'concurrent-task',
        idempotencyKey: 'effect-concurrent',
      };
      const firstDelivery = concurrentNotifier.notify(concurrent);
      await deliveryStarted;
      await assert.rejects(
        concurrentNotifier.notify(concurrent),
        /requires explicit reconciliation/,
      );
      releaseDelivery();
      await firstDelivery;
      await concurrentNotifier.notify(concurrent);
      assert.equal(concurrentDeliveries, 1);
    } finally {
      await pool.query(
        'DELETE FROM p1_notification_effects WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);
