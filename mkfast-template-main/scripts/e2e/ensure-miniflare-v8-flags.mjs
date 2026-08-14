#!/usr/bin/env node
/**
 * e2e instrument: miniflare@4 serializes workerd config but never copies
 * MINIFLARE_WORKERD_V8_FLAGS into capnp `v8Flags`. Playwright already sets
 * that env; without this splice the embedded workerd stays at the ~1.4 GB
 * default and the official V3.1 remaining invoke dies mid Artifact AC2.
 */
import { createRequire } from 'node:module';
import { realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const RETURN_BLOCK = `    return {
      services: servicesArray,
      sockets,
      extensions,
      structuredLogging: this.#structuredWorkerdLogs,
      autogates: process.env.MINIFLARE_WORKERD_AUTOGATES ? process.env.MINIFLARE_WORKERD_AUTOGATES.split(" ") : []
    };`;

const PATCHED_BLOCK = `    return {
      services: servicesArray,
      sockets,
      extensions,
      structuredLogging: this.#structuredWorkerdLogs,
      ...(process.env.MINIFLARE_WORKERD_V8_FLAGS
        ? {
            v8Flags: process.env.MINIFLARE_WORKERD_V8_FLAGS.split(/[\\s,]+/u).filter(Boolean),
          }
        : {}),
      autogates: process.env.MINIFLARE_WORKERD_AUTOGATES ? process.env.MINIFLARE_WORKERD_AUTOGATES.split(" ") : []
    };`;

export function resolveMiniflareRuntime(root = webRoot) {
  const pluginPkg = realpathSync(
    join(root, 'node_modules/@cloudflare/vite-plugin/package.json')
  );
  const req = createRequire(pluginPkg);
  return req.resolve('miniflare');
}

export function applyMiniflareV8FlagsPatch(source) {
  if (source.includes('v8Flags: process.env.MINIFLARE_WORKERD_V8_FLAGS')) {
    return { source, changed: false };
  }
  if (!source.includes(RETURN_BLOCK)) {
    throw new Error(
      'miniflare assembleConfig return block was not found; refuse to guess a splice.'
    );
  }
  return { source: source.replace(RETURN_BLOCK, PATCHED_BLOCK), changed: true };
}

const invoked = process.argv[1]
  ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invoked) {
  const runtime = resolveMiniflareRuntime();
  const before = readFileSync(runtime, 'utf8');
  const { source, changed } = applyMiniflareV8FlagsPatch(before);
  if (changed) writeFileSync(runtime, source);
  process.stdout.write(
    `${changed ? 'patched' : 'already-patched'} ${runtime}\n`
  );
}
