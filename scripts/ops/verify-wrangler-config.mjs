#!/usr/bin/env node
/**
 * Wrangler configuration verification for the release engineering gate (T40/E-01).
 *
 * Two independent judgments, deliberately separated:
 *
 *   1. Structure — key positions the repository owns. A missing `name`, absent
 *      Hyperdrive/R2 binding, or a D1 binding (forbidden by ADR-0006) is a hard
 *      failure, because no external account provisioning can fix it.
 *   2. Placeholders — template names, demo domains, and the all-zero Hyperdrive
 *      id. These are *reported*, not failed: filling them needs real Cloudflare
 *      resources, which are the E-gate business batch (D-132 §D), not this
 *      ticket. A gate that fails on them today would be red at birth.
 *
 * Switch condition: once the E-gate business batch fills real resource values,
 * run this script with `--require-real-resources` (and register that form in the
 * deploy path) so every remaining placeholder becomes a hard failure.
 *
 * Only the Web unit is a Cloudflare Worker. Core, Worker, and Canvas run on Node
 * (`@meiye/core` runtime-entry / Next standalone), so having no wrangler config
 * is their correct shape and is never reported as a finding.
 *
 * The Hyperdrive placeholder id mirrors
 * apps/core/src/p1/cloudflare-read/config-risk.ts (HYPERDRIVE_PLACEHOLDER_ID /
 * isHyperdrivePlaceholder). scripts/ops/verify-wrangler-config.test.mjs pins the
 * two definitions together so they cannot drift.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HYPERDRIVE_PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';
const ALL_ZERO_UUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/u;

/** Units that legitimately ship without a wrangler config. */
export const NON_WORKER_UNITS = ['core', 'worker', 'canvas'];

const TEMPLATE_NAMES = ['mkfast-template', 'tanstarter'];
const DEMO_DOMAIN_SUFFIXES = ['tanstarter.dev', 'example.com', 'example.test'];
const PLACEHOLDER_TOKENS = ['changeme', 'your-account', 'your_account', '<your'];
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.wrangler',
  'references',
  'output',
  '.git',
  '.scratch',
]);

export function isHyperdrivePlaceholder(id) {
  if (!id) return true;
  const value = String(id).trim();
  return value === HYPERDRIVE_PLACEHOLDER_ID || ALL_ZERO_UUID.test(value);
}

/** Strips // and /* *\/ comments and trailing commas from JSONC, string-aware. */
export function parseJsonc(text) {
  let output = '';
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index];
    if (inString) {
      output += character;
      if (character === '\\') {
        output += text[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === '*' && text[index + 1] === '/')
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/gu, '$1'));
}

export function findWranglerConfigs(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(join(directory, entry.name));
        continue;
      }
      if (/^wrangler(\.[A-Za-z0-9-]+)?\.jsonc?$/u.test(entry.name)) {
        found.push(relative(root, join(directory, entry.name)));
      }
    }
  };
  walk(root);
  return found.sort();
}

function structureIssuesFor(label, config, configPath, root) {
  const issues = [];
  const push = (message) => issues.push(`${label}: ${message}`);

  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    push('name is required');
  }
  if (typeof config.main !== 'string' || config.main.trim().length === 0) {
    push('main entrypoint is required');
  } else if (!/(^|\/)(dist|\.next)\//u.test(config.main)) {
    const mainPath = resolve(dirname(resolve(root, configPath)), config.main);
    if (!existsSync(mainPath)) {
      push(`main entrypoint ${config.main} does not exist`);
    }
  }
  if (
    typeof config.compatibility_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(config.compatibility_date)
  ) {
    push('compatibility_date must be an ISO date');
  }
  if (!Array.isArray(config.compatibility_flags) || config.compatibility_flags.length === 0) {
    push('compatibility_flags are required');
  } else if (!config.compatibility_flags.includes('nodejs_compat')) {
    push('compatibility_flags must include nodejs_compat');
  }

  const hyperdrive = config.hyperdrive;
  if (!Array.isArray(hyperdrive) || hyperdrive.length === 0) {
    push('hyperdrive binding is required (PostgreSQL is the only fact source)');
  } else {
    for (const [index, binding] of hyperdrive.entries()) {
      if (binding?.binding !== 'HYPERDRIVE') {
        push(`hyperdrive[${index}].binding must be HYPERDRIVE`);
      }
      if (typeof binding?.id !== 'string' || binding.id.trim().length === 0) {
        push(`hyperdrive[${index}].id key is required`);
      }
    }
  }

  const buckets = config.r2_buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) {
    push('r2_buckets binding is required');
  } else {
    for (const [index, bucket] of buckets.entries()) {
      if (typeof bucket?.binding !== 'string' || bucket.binding.length === 0) {
        push(`r2_buckets[${index}].binding is required`);
      }
      if (
        typeof bucket?.bucket_name !== 'string' ||
        bucket.bucket_name.trim().length === 0
      ) {
        push(`r2_buckets[${index}].bucket_name is required`);
      }
    }
  }

  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    push('d1_databases must not be declared (ADR-0006: D1 carries no auth or business data)');
  }
  return issues;
}

function placeholderFindingsFor(label, config) {
  const findings = [];
  const push = (id, detail) => findings.push({ config: label, id, detail });

  if (
    typeof config.name === 'string' &&
    TEMPLATE_NAMES.some((template) => config.name.trim().toLowerCase() === template)
  ) {
    push('template_worker_name', `name=${config.name}`);
  }
  for (const [index, route] of (Array.isArray(config.routes) ? config.routes : []).entries()) {
    const pattern = typeof route === 'string' ? route : route?.pattern;
    if (
      typeof pattern === 'string' &&
      DEMO_DOMAIN_SUFFIXES.some((suffix) => pattern.toLowerCase().endsWith(suffix))
    ) {
      push('demo_route_domain', `routes[${index}].pattern=${pattern}`);
    }
  }
  for (const [index, binding] of (Array.isArray(config.hyperdrive) ? config.hyperdrive : []).entries()) {
    if (isHyperdrivePlaceholder(binding?.id)) {
      push(
        'hyperdrive_placeholder',
        `hyperdrive[${index}].id=${binding?.id ?? '(missing)'}`
      );
    }
  }
  for (const [index, bucket] of (Array.isArray(config.r2_buckets) ? config.r2_buckets : []).entries()) {
    if (
      typeof bucket?.bucket_name === 'string' &&
      TEMPLATE_NAMES.some(
        (template) => bucket.bucket_name.trim().toLowerCase() === template
      )
    ) {
      push('template_bucket_name', `r2_buckets[${index}].bucket_name=${bucket.bucket_name}`);
    }
  }
  const blob = JSON.stringify(config).toLowerCase();
  for (const token of PLACEHOLDER_TOKENS) {
    if (blob.includes(token)) push('placeholder_token', `contains ${token}`);
  }
  return findings;
}

export function verifyWranglerConfigs(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const configPaths = options.configs ?? findWranglerConfigs(root);
  const structureIssues = [];
  const placeholders = [];
  const configs = [];

  if (configPaths.length === 0) {
    structureIssues.push('no wrangler configuration was found for the Web unit');
  }

  for (const configPath of configPaths) {
    const absolute = resolve(root, configPath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      structureIssues.push(`${configPath}: configuration file is missing`);
      continue;
    }
    let config;
    try {
      config = parseJsonc(readFileSync(absolute, 'utf8'));
    } catch (error) {
      structureIssues.push(
        `${configPath}: not parseable as JSONC (${error instanceof Error ? error.message : 'unknown error'})`
      );
      continue;
    }
    configs.push({ name: config.name ?? null, path: configPath });
    structureIssues.push(...structureIssuesFor(configPath, config, configPath, root));
    placeholders.push(...placeholderFindingsFor(configPath, config));
  }

  const requireRealResources = options.requireRealResources === true;
  return {
    configs,
    nonWorkerUnits: NON_WORKER_UNITS,
    ok: structureIssues.length === 0 && (!requireRealResources || placeholders.length === 0),
    placeholders,
    requireRealResources,
    structureIssues,
  };
}

export function formatReport(result) {
  const lines = [];
  lines.push('Wrangler configuration verification (T40/E-01)');
  lines.push(
    `Configs verified: ${result.configs.length === 0 ? '(none)' : result.configs.map((entry) => `${entry.path} [name=${entry.name ?? '(unset)'}]`).join(', ')}`
  );
  lines.push(
    `Units without a wrangler config by design: ${result.nonWorkerUnits.join(', ')} (Node runtimes, not Workers)`
  );
  lines.push('');
  if (result.structureIssues.length === 0) {
    lines.push('Structure: ok — every owned key position is present.');
  } else {
    lines.push(`Structure: ${result.structureIssues.length} hard failure(s)`);
    for (const issue of result.structureIssues) lines.push(` - ${issue}`);
  }
  lines.push('');
  if (result.placeholders.length === 0) {
    lines.push('Placeholders: none — real resource values are in place.');
  } else {
    lines.push(
      `Placeholders: ${result.placeholders.length} finding(s) — real values are the E-gate business batch, reported not failed`
    );
    for (const finding of result.placeholders) {
      lines.push(` - [${finding.id}] ${finding.config}: ${finding.detail}`);
    }
    lines.push('');
    lines.push(
      'Switch condition: after the E-gate business batch fills real Cloudflare resource values,'
    );
    lines.push(
      'run `node scripts/ops/verify-wrangler-config.mjs --require-real-resources` so these findings'
    );
    lines.push('become hard failures and the deploy path can depend on them.');
  }
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), options = {}) {
  const result = verifyWranglerConfigs({
    requireRealResources: argv.includes('--require-real-resources'),
    root: options.root ?? process.cwd(),
  });
  const report = argv.includes('--json')
    ? JSON.stringify(result, null, 2)
    : formatReport(result);
  process.stdout.write(`${report}\n`);
  process.exitCode = result.ok ? 0 : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
