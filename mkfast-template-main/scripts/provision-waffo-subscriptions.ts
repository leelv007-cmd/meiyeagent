import { pathToFileURL } from 'node:url';
import { WaffoPancake } from '@waffo/pancake-ts';
import { commercePlanCatalogSnapshotSchema } from '@meiye/contracts';
import {
  buildWaffoSubscriptionProvisioningPlan,
  provisionWaffoSubscriptionCatalog,
} from '../src/payment/waffo-provisioning';

const APPLY_CONFIRMATION = 'true';

async function run() {
  const storeId = process.env.WAFFO_STORE_ID?.trim() || 'dry-run-store';
  const webhookUrl = process.env.WAFFO_TEST_WEBHOOK_URL?.trim();
  const catalog = await readGovernedCatalog();

  if (process.env.WAFFO_PROVISION_APPLY !== APPLY_CONFIRMATION) {
    const plan = buildWaffoSubscriptionProvisioningPlan(
      storeId,
      catalog,
      webhookUrl
    );
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
    catalog,
    storeId: applyStoreId,
    webhookUrl: applyWebhookUrl,
    environment: 'test',
    mode: 'apply',
  });

  // Product and webhook IDs are public configuration values. Private input is
  // intentionally absent from this result and from all command arguments.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function readGovernedCatalog() {
  const coreUrl =
    process.env.CORE_SERVICE_URL?.trim() || 'http://127.0.0.1:4100';
  const serviceToken = requiredEnvironment('CORE_SERVICE_TOKEN');
  const response = await fetch(`${coreUrl}/internal/commerce-plan-catalog`, {
    headers: { 'x-service-token': serviceToken },
  });
  if (!response.ok) {
    throw new Error(`Core commerce catalog returned ${response.status}.`);
  }
  const envelope = (await response.json()) as { data?: unknown };
  return commercePlanCatalogSnapshotSchema.parse(envelope.data).catalog;
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
