import { websiteConfig } from '@/config/website';
import { serverEnv } from '@/env/server';
import { getBaseUrl } from '@/lib/urls';
import type {
  NotificationProvider,
  SendPaymentNotificationParams,
  SendPaymentRefundReviewAlertParams,
} from '../types';

/**
 * Send a message to Discord via webhook.
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
    throw new Error('Discord notification request failed.');
  }
}

export class DiscordProvider implements NotificationProvider {
  private webhookUrl: string;
  private botName: string;
  private avatarUrl?: string;

  constructor() {
    const webhookUrl = serverEnv.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_URL is required.');
    const logoPath = websiteConfig.metadata?.images?.logoLight;
    this.webhookUrl = webhookUrl;
    this.botName = websiteConfig.metadata?.name ?? 'Bot';
    this.avatarUrl = logoPath ? `${getBaseUrl()}${logoPath}` : undefined;
  }

  getProviderName(): string {
    return 'discord';
  }

  async sendPaymentNotification(
    params: SendPaymentNotificationParams
  ): Promise<void> {
    const { sessionId, customerId, userName, amount } = params;
    try {
      const body: Record<string, unknown> = {
        username: this.botName,
        embeds: [
          {
            title: '🎉 New Purchase',
            color: 0x4caf50,
            fields: [
              { name: 'Username', value: userName, inline: true },
              { name: 'Amount', value: `$${amount.toFixed(2)}`, inline: true },
              {
                name: 'Customer ID',
                value: `\`${customerId}\``,
                inline: false,
              },
              { name: 'Session ID', value: `\`${sessionId}\``, inline: false },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };
      if (this.avatarUrl) body.avatar_url = this.avatarUrl;
      await sendMessage(this.webhookUrl, body);
      console.log(
        `Successfully sent Discord notification for user ${userName}`
      );
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
    }
  }

  async sendPaymentRefundReviewAlert(
    params: SendPaymentRefundReviewAlertParams
  ): Promise<void> {
    try {
      const body: Record<string, unknown> = {
        username: this.botName,
        embeds: [
          {
            title: 'Refund Requires Review',
            color: 0xf59e0b,
            fields: [
              { name: 'Provider', value: params.provider, inline: true },
              { name: 'Status', value: params.eventStatus, inline: true },
              {
                name: 'Amount',
                value: `${params.amount} ${params.currency}`,
                inline: true,
              },
              {
                name: 'Order ID',
                value: `\`${params.orderId}\``,
                inline: false,
              },
              {
                name: 'Refund Event ID',
                value: `\`${params.providerEventId}\``,
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };
      if (this.avatarUrl) body.avatar_url = this.avatarUrl;
      await sendMessage(this.webhookUrl, body);
    } catch (error) {
      console.error('Failed to send refund review alert.');
      throw error;
    }
  }
}
