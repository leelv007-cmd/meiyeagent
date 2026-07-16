import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const cloudflareTestModule = `data:text/javascript,${encodeURIComponent(`
  export function cloudflare(pluginConfig = {}) {
    return [{
      name: 'cloudflare-config-test-double',
      workerConfigCustomizer: pluginConfig.config,
    }];
  }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@cloudflare/vite-plugin') {
      return { shortCircuit: true, url: cloudflareTestModule };
    }
    return nextResolve(specifier, context);
  },
});

const { default: viteConfig } = await import('../../vite.config');

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('local Vite development forwards only approved internal service bindings', async () => {
  const commerceEnvironment = {
    PRO_STUDIO_AMOUNT_CENTS: '29900',
    PRO_STUDIO_CURRENCY: 'CNY',
    PRO_STUDIO_OFFER_ID: 'pro-studio-v1',
    PRO_STUDIO_PAYMENT_TYPE: 'one_time',
    PRO_STUDIO_PRICE_ID: 'price-pro-studio',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
  };
  const previousCommerce = Object.fromEntries(
    Object.keys(commerceEnvironment).map((name) => [name, process.env[name]])
  );
  const previousUrl = process.env.CORE_SERVICE_URL;
  const previousToken = process.env.CORE_SERVICE_TOKEN;
  const previousCanvasUrl = process.env.CANVAS_SERVICE_URL;
  const previousCanvasToken = process.env.CANVAS_SERVICE_TOKEN;
  const previousCanvasOrigin = process.env.CANVAS_ORIGIN;
  const previousUnrelated = process.env.UNRELATED_LOCAL_BINDING;
  const previousParaglide = process.env.PARAGLIDE_PRECOMPILED;

  process.env.CORE_SERVICE_URL = 'http://core.test';
  process.env.CORE_SERVICE_TOKEN = 'test-core-token';
  process.env.CANVAS_SERVICE_URL = 'http://canvas.test';
  process.env.CANVAS_SERVICE_TOKEN = 'test-canvas-token';
  process.env.CANVAS_ORIGIN = 'https://canvas.example.test';
  process.env.UNRELATED_LOCAL_BINDING = 'must-not-be-forwarded';
  process.env.PARAGLIDE_PRECOMPILED = 'true';
  Object.assign(process.env, commerceEnvironment);

  try {
    assert.equal(typeof viteConfig, 'function');
    const resolvedConfig = await viteConfig({
      command: 'serve',
      isPreview: false,
      isSsrBuild: false,
      mode: 'test',
    });
    const plugins = ((resolvedConfig.plugins ?? []) as unknown[])
      .flat(Number.POSITIVE_INFINITY)
      .filter(Boolean) as Array<{
      name?: string;
      workerConfigCustomizer?: (workerConfig: {
        vars?: Record<string, unknown>;
      }) => { vars?: Record<string, unknown> };
    }>;
    const cloudflarePlugin = plugins.find(
      (plugin) => plugin.name === 'cloudflare-config-test-double'
    );

    assert.ok(cloudflarePlugin?.workerConfigCustomizer);
    const workerConfig = cloudflarePlugin.workerConfigCustomizer({
      vars: { EXISTING_WRANGLER_BINDING: 'kept' },
    });
    const vars = workerConfig.vars ?? {};

    assert.equal(vars.EXISTING_WRANGLER_BINDING, 'kept');
    assert.equal(vars.CORE_SERVICE_URL, 'http://core.test');
    assert.equal(vars.CORE_SERVICE_TOKEN, 'test-core-token');
    assert.equal(vars.CANVAS_SERVICE_URL, 'http://canvas.test');
    assert.equal(vars.CANVAS_SERVICE_TOKEN, 'test-canvas-token');
    assert.equal(vars.CANVAS_ORIGIN, 'https://canvas.example.test');
    assert.equal(vars.PRO_STUDIO_AMOUNT_CENTS, '29900');
    assert.equal(vars.STRIPE_WEBHOOK_SECRET, 'whsec_test');
    assert.deepEqual(Object.keys(vars).sort(), [
      'CANVAS_ORIGIN',
      'CANVAS_SERVICE_TOKEN',
      'CANVAS_SERVICE_URL',
      'CORE_SERVICE_TOKEN',
      'CORE_SERVICE_URL',
      'EXISTING_WRANGLER_BINDING',
      'PRO_STUDIO_AMOUNT_CENTS',
      'PRO_STUDIO_CURRENCY',
      'PRO_STUDIO_OFFER_ID',
      'PRO_STUDIO_PAYMENT_TYPE',
      'PRO_STUDIO_PRICE_ID',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  } finally {
    restoreEnvironment('CORE_SERVICE_URL', previousUrl);
    restoreEnvironment('CORE_SERVICE_TOKEN', previousToken);
    restoreEnvironment('CANVAS_SERVICE_URL', previousCanvasUrl);
    restoreEnvironment('CANVAS_SERVICE_TOKEN', previousCanvasToken);
    restoreEnvironment('CANVAS_ORIGIN', previousCanvasOrigin);
    restoreEnvironment('UNRELATED_LOCAL_BINDING', previousUnrelated);
    restoreEnvironment('PARAGLIDE_PRECOMPILED', previousParaglide);
    for (const [name, value] of Object.entries(previousCommerce)) {
      restoreEnvironment(name, value);
    }
  }
});
