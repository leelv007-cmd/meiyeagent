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
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
  };
  const previousCommerce = Object.fromEntries(
    Object.keys(commerceEnvironment).map((name) => [name, process.env[name]])
  );
  const previousUrl = process.env.CORE_SERVICE_URL;
  const previousToken = process.env.CORE_SERVICE_TOKEN;
  const previousUnrelated = process.env.UNRELATED_LOCAL_BINDING;
  const previousParaglide = process.env.PARAGLIDE_PRECOMPILED;

  process.env.CORE_SERVICE_URL = 'http://core.test';
  process.env.CORE_SERVICE_TOKEN = 'test-core-token';
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
    assert.equal(vars.STRIPE_WEBHOOK_SECRET, 'whsec_test');
    assert.deepEqual(Object.keys(vars).sort(), [
      'CORE_SERVICE_TOKEN',
      'CORE_SERVICE_URL',
      'EXISTING_WRANGLER_BINDING',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  } finally {
    restoreEnvironment('CORE_SERVICE_URL', previousUrl);
    restoreEnvironment('CORE_SERVICE_TOKEN', previousToken);
    restoreEnvironment('UNRELATED_LOCAL_BINDING', previousUnrelated);
    restoreEnvironment('PARAGLIDE_PRECOMPILED', previousParaglide);
    for (const [name, value] of Object.entries(previousCommerce)) {
      restoreEnvironment(name, value);
    }
  }
});
