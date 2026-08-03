export type WaffoEnvironment = 'test' | 'production';

export type WaffoWebhookPublicKeys = {
  prod?: string;
  test?: string;
};

export function sdkWaffoEnvironment(environment: WaffoEnvironment) {
  return environment === 'production' ? 'prod' : 'test';
}

export function expectedWaffoWebhookMode(environment: WaffoEnvironment) {
  return sdkWaffoEnvironment(environment);
}

export function selectWaffoWebhookPublicKey(
  environment: WaffoEnvironment,
  keys: WaffoWebhookPublicKeys | undefined
) {
  return keys?.[sdkWaffoEnvironment(environment)]?.trim() || undefined;
}
