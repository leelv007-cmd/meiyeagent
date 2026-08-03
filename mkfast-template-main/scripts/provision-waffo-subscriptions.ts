import { pathToFileURL } from 'node:url';
import { WaffoPancake } from '@waffo/pancake-ts';
import {
  buildWaffoSubscriptionProvisioningPlan,
  provisionWaffoSubscriptionCatalog,
} from '../src/payment/waffo-provisioning';

const APPLY_CONFIRMATION = 'true';

async function run() {
  const storeId = process.env.WAFFO_STORE_ID?.trim() || 'dry-run-store';
  const webhookUrl = process.env.WAFFO_TEST_WEBHOOK_URL?.trim();

  if (process.env.WAFFO_PROVISION_APPLY !== APPLY_CONFIRMATION) {
    const plan = buildWaffoSubscriptionProvisioningPlan(storeId, webhookUrl);
    process.stdout.write(
      `${JSON.stringify({ mode: 'dry-run', plan }, null, 2)}\n`
    );
    return;
  }

  if (process.env.WAFFO_ENVIRONMENT?.trim() !== 'test') {
    throw new Error('WAFFO_ENVIRONMENT must be test for provisioning.');
  }
  const merchantId = requiredEnvironment('WAFFO_MERCHANT_ID');
  const privateKey = requiredEnvironment('WAFFO_PRIVATE_KEY').replaceAll(
    '\\n',
    '\n'
  );
  const applyStoreId = requiredEnvironment('WAFFO_STORE_ID');
  const applyWebhookUrl = requiredEnvironment('WAFFO_TEST_WEBHOOK_URL');
  const client = new WaffoPancake({ merchantId, privateKey });
  const result = await provisionWaffoSubscriptionCatalog(client, {
    storeId: applyStoreId,
    webhookUrl: applyWebhookUrl,
    environment: 'test',
    mode: 'apply',
  });

  // Product and webhook IDs are public configuration values. Private input is
  // intentionally absent from this result and from all command arguments.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
