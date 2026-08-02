import { pathToFileURL } from 'node:url';
import { WaffoPancake } from '@waffo/pancake-ts';
import { WAFFO_SUBSCRIPTION_PRODUCTS } from '../src/payment/waffo-subscription-catalog';
import {
  WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS,
  provisionWaffoSubscriptionCatalog,
} from '../src/payment/waffo-provisioning';

const APPLY_CONFIRMATION = 'true';

async function run() {
  if (process.env.WAFFO_PROVISION_APPLY !== APPLY_CONFIRMATION) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'dry-run',
          products: WAFFO_SUBSCRIPTION_PRODUCTS,
          webhook: {
            events: WAFFO_SUBSCRIPTION_WEBHOOK_EVENTS,
            testMode: true,
          },
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const merchantId = requiredEnvironment('WAFFO_MERCHANT_ID');
  const privateKey = requiredEnvironment('WAFFO_PRIVATE_KEY').replaceAll(
    '\\n',
    '\n'
  );
  const storeId = requiredEnvironment('WAFFO_STORE_ID');
  const testWebhookId = requiredEnvironment('WAFFO_TEST_WEBHOOK_ID');
  const client = new WaffoPancake({ merchantId, privateKey });
  const result = await provisionWaffoSubscriptionCatalog(client, {
    storeId,
    testWebhookId,
  });

  // Product and webhook IDs are public configuration values. Private input is
  // intentionally absent from this result and from all command arguments.
  process.stdout.write(
    `${JSON.stringify({ mode: 'applied', ...result }, null, 2)}\n`
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch(() => {
    process.stderr.write('Waffo subscription provisioning failed.\n');
    process.exitCode = 1;
  });
}
