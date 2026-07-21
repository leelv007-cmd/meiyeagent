import { serverEnv } from '@/env/server';
import type {
  CheckSubscribeStatusParams,
  NewsletterProvider,
  SubscribeNewsletterParams,
  UnsubscribeNewsletterParams,
} from '@/newsletter/types';
import { BeehiivClient } from '@beehiiv/sdk';
import { safeErrorFields } from '@/auth/safe-log';

/**
 * Beehiiv newsletter provider
 *
 * Beehiiv is a newsletter platform that provides:
 * - Subscription management via API
 * - Publication-based subscriber organization
 * - Rich subscriber data with custom fields
 *
 * docs:
 * https://developers.beehiiv.com/
 * https://github.com/beehiiv/typescript-sdk
 */
export class BeehiivNewsletterProvider implements NewsletterProvider {
  private client: BeehiivClient;
  private publicationId: string;

  constructor() {
    const apiKey = serverEnv.BEEHIIV_API_KEY;
    const publicationId = serverEnv.BEEHIIV_PUBLICATION_ID;

    if (!apiKey) {
      throw new Error('BEEHIIV_API_KEY is required for newsletter.');
    }
    if (!publicationId) {
      throw new Error('BEEHIIV_PUBLICATION_ID is required for newsletter.');
    }

    this.client = new BeehiivClient({ token: apiKey });
    this.publicationId = publicationId;
  }

  getProviderName(): string {
    return 'beehiiv';
  }

  /**
   * Subscribe a user to the newsletter.
   * Creates a new subscription or reactivates an existing one.
   */
  async subscribe({ email }: SubscribeNewsletterParams): Promise<boolean> {
    try {
      const existing = await this.getSubscription(email);

      if (existing) {
        if (existing.status !== 'active') {
          const updateResult = await this.client.subscriptions.patch(
            this.publicationId,
            existing.id,
            {}
          );

          await this.client.bulkSubscriptionUpdates.patchStatus(
            this.publicationId,
            {
              subscription_ids: [existing.id],
              new_status: 'active',
            }
          );

          console.info('newsletter subscription reactivated', {
            event: 'NEWSLETTER_SUBSCRIPTION_REACTIVATED',
          });
          return !!updateResult;
        }

        console.info('newsletter subscription already active', {
          event: 'NEWSLETTER_SUBSCRIPTION_ALREADY_ACTIVE',
        });
        return true;
      }

      const result = await this.client.subscriptions.create(
        this.publicationId,
        {
          email,
          reactivate_existing: true,
          send_welcome_email: false,
        }
      );

      if (!result.data) {
        console.error('newsletter subscription create failed', {
          event: 'NEWSLETTER_SUBSCRIPTION_CREATE_FAILED',
        });
        return false;
      }

      console.info('newsletter subscription created', {
        event: 'NEWSLETTER_SUBSCRIPTION_CREATED',
      });
      return true;
    } catch (error) {
      console.error('newsletter subscription provider failed', {
        event: 'NEWSLETTER_PROVIDER_SUBSCRIBE_FAILED',
        ...safeErrorFields(error),
      });
      return false;
    }
  }

  /**
   * Unsubscribe a user from the newsletter.
   */
  async unsubscribe({ email }: UnsubscribeNewsletterParams): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(email);

      if (!subscription) {
        console.info('newsletter unsubscribe already absent', {
          event: 'NEWSLETTER_UNSUBSCRIBE_ALREADY_ABSENT',
        });
        return true;
      }

      await this.client.bulkSubscriptionUpdates.patch(this.publicationId, {
        subscriptions: [
          {
            subscription_id: subscription.id,
            unsubscribe: true,
          },
        ],
      });

      console.info('newsletter unsubscribed', {
        event: 'NEWSLETTER_UNSUBSCRIBED',
      });
      return true;
    } catch (error) {
      console.error('newsletter unsubscribe provider failed', {
        event: 'NEWSLETTER_PROVIDER_UNSUBSCRIBE_FAILED',
        ...safeErrorFields(error),
      });
      return false;
    }
  }

  /**
   * Check if a user is subscribed to the newsletter.
   */
  async checkSubscribeStatus({
    email,
  }: CheckSubscribeStatusParams): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(email);

      if (!subscription) {
        console.info('newsletter status not found', {
          event: 'NEWSLETTER_STATUS_NOT_FOUND',
        });
        return false;
      }

      const isActive = subscription.status === 'active';
      console.info('newsletter status checked', {
        event: 'NEWSLETTER_STATUS_CHECKED',
        subscribed: isActive,
      });
      return isActive;
    } catch (error) {
      console.error('newsletter status provider failed', {
        event: 'NEWSLETTER_PROVIDER_STATUS_FAILED',
        ...safeErrorFields(error),
      });
      return false;
    }
  }

  /**
   * Get subscription by email.
   */
  private async getSubscription(email: string) {
    try {
      const result = await this.client.subscriptions.getByEmail(
        this.publicationId,
        email
      );

      return result.data ?? null;
    } catch (_error) {
      return null;
    }
  }
}
