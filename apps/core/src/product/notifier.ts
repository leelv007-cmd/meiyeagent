import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface ProductNotification {
  workspaceId: string;
  jobId: string;
  status: 'completed' | 'needs_action';
  message: string;
  deepLink: string;
  correlationId: string;
  idempotencyKey?: string;
}

export interface ProductNotifier {
  notify(notification: ProductNotification): Promise<void>;
}

export const noOpProductNotifier: ProductNotifier = {
  async notify() {},
};

export class WebhookProductNotifier implements ProductNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly appBaseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notify(notification: ProductNotification) {
    const deepLink = new URL(notification.deepLink, this.appBaseUrl).toString();
    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(notification.idempotencyKey
          ? { 'x-idempotency-key': notification.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: `${notification.message}\n${deepLink}`,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Notification webhook returned ${response.status}.`);
    }
  }
}

interface NotificationEffectRow {
  payload_hash: string;
  status: 'claimed' | 'sent' | 'unknown';
}

/**
 * Gives non-idempotent chat webhooks a durable at-most-once boundary. A
 * claimed/unknown effect is never replayed automatically; a sent effect can be
 * safely acknowledged again after the caller loses its local receipt.
 */
export class PostgresIdempotentProductNotifier implements ProductNotifier {
  constructor(
    private readonly pool: Pool,
    private readonly delegate: ProductNotifier,
  ) {}

  async migrate(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_notification_effects (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        status text NOT NULL CHECK (status IN ('claimed', 'sent', 'unknown')),
        error text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, idempotency_key)
      )
    `);
  }

  async notify(notification: ProductNotification) {
    if (!notification.idempotencyKey) {
      return this.delegate.notify(notification);
    }
    const payloadHash = notificationPayloadHash(notification);
    const claimed = await this.pool.query<NotificationEffectRow>(
      `INSERT INTO p1_notification_effects
         (workspace_id, idempotency_key, payload_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'claimed', now(), now())
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING payload_hash, status`,
      [notification.workspaceId, notification.idempotencyKey, payloadHash],
    );
    if (claimed.rowCount === 0) {
      const existing = await this.pool.query<NotificationEffectRow>(
        `SELECT payload_hash, status
           FROM p1_notification_effects
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [notification.workspaceId, notification.idempotencyKey],
      );
      const effect = existing.rows[0];
      if (!effect || effect.payload_hash !== payloadHash) {
        throw new Error('Notification idempotency key conflicts with another payload.');
      }
      if (effect.status === 'sent') return;
      throw new Error(
        'Notification delivery is unknown and requires explicit reconciliation.',
      );
    }

    try {
      await this.delegate.notify(notification);
    } catch (error) {
      await this.pool.query(
        `UPDATE p1_notification_effects
            SET status = 'unknown', error = $3, updated_at = now()
          WHERE workspace_id = $1 AND idempotency_key = $2 AND status = 'claimed'`,
        [
          notification.workspaceId,
          notification.idempotencyKey,
          error instanceof Error ? error.message : String(error),
        ],
      );
      throw error;
    }
    const settled = await this.pool.query(
      `UPDATE p1_notification_effects
          SET status = 'sent', error = NULL, updated_at = now()
        WHERE workspace_id = $1 AND idempotency_key = $2 AND status = 'claimed'`,
      [notification.workspaceId, notification.idempotencyKey],
    );
    if (settled.rowCount !== 1) {
      throw new Error('Notification claim could not be settled as sent.');
    }
  }
}

function notificationPayloadHash(notification: ProductNotification) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries({
            deepLink: notification.deepLink,
            jobId: notification.jobId,
            message: notification.message,
            status: notification.status,
            workspaceId: notification.workspaceId,
          }).sort(([left], [right]) => left.localeCompare(right)),
        ),
      ),
    )
    .digest('hex');
}
