import { serverEnv } from '@/env/server';
import type {
  NotificationProvider,
  SendPaymentNotificationParams,
  SendPaymentRefundReviewAlertParams,
} from '../types';

/**
 * Send a message to Feishu via webhook.
 */
async function sendMessage(
  webhookUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error('Feishu notification request failed.');
  }
}

export class FeishuProvider implements NotificationProvider {
  private webhookUrl: string;

  constructor() {
    const webhookUrl = serverEnv.FEISHU_WEBHOOK_URL;
    if (!webhookUrl) throw new Error('FEISHU_WEBHOOK_URL is required.');
    this.webhookUrl = webhookUrl;
  }

  getProviderName(): string {
    return 'feishu';
  }

  async sendPaymentNotification(
    params: SendPaymentNotificationParams
  ): Promise<void> {
    const { sessionId, customerId, userName, amount } = params;
    try {
      await sendMessage(this.webhookUrl, {
        msg_type: 'text',
        content: {
          text: `🎉 New Purchase\nUsername: ${userName}\nAmount: $${amount.toFixed(2)}\nCustomer ID: ${customerId}\nSession ID: ${sessionId}`,
        },
      });
      console.log(`Successfully sent Feishu notification for user ${userName}`);
    } catch (error) {
      console.error('Failed to send Feishu notification:', error);
    }
  }

  async sendPaymentRefundReviewAlert(
    params: SendPaymentRefundReviewAlertParams
  ): Promise<void> {
    try {
      await sendMessage(this.webhookUrl, {
        msg_type: 'text',
        content: {
          text: `Refund Requires Review\nProvider: ${params.provider}\nStatus: ${params.eventStatus}\nAmount: ${params.amount} ${params.currency}\nOrder ID: ${params.orderId}\nRefund Event ID: ${params.providerEventId}`,
        },
      });
    } catch (error) {
      console.error('Failed to send refund review alert.');
      throw error;
    }
  }
}
