#!/usr/bin/env node
/**
 * Pro Studio K01/K02 — re-apply byte-exact upstream copies into apps/canvas vendor
 * and regenerate docs/evidence/pro-studio/copy-manifest.json copies[] rows.
 *
 * Usage:
 *   PRO_STUDIO_UPSTREAM_ROOT=/path/to/vozeb node scripts/pro-studio/apply-exact-copies.mjs
 *
 * Idempotent: overwrites targets and rewrites copies[] from the frozen inventory.
 * Does not commit.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_COMMIT = 'a2c52c7aacf68d825563b7455efa9c34f3db0123';
const A2_EVIDENCE = 'docs/evidence/pro-studio/a2-authorization-2026-07-19.md';
const A3_EVIDENCE = 'docs/evidence/pro-studio/a3-authorization-2026-07-19.md';
const MANIFEST_REL = 'docs/evidence/pro-studio/copy-manifest.json';

/**
 * Frozen exact-copy inventory at a2c52c7.
 * source paths are relative to the upstream repository root.
 * EXCLUDES: canvas-local-agent-panel, api/**, auth, admin, points, bulk prompt corpora, server secrets.
 */
export const EXACT_COPY_SOURCES = [
  // canvas core (34 files; provider/local-agent orchestration excluded)
  'web/src/app/(user)/canvas/[id]/page.tsx',
  'web/src/app/(user)/canvas/components/asset-picker-modal.tsx',
  'web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx',
  'web/src/app/(user)/canvas/components/canvas-agent-panel-motion.ts',
  'web/src/app/(user)/canvas/components/canvas-config-composer.tsx',
  'web/src/app/(user)/canvas/components/canvas-connections.tsx',
  'web/src/app/(user)/canvas/components/canvas-context-menu.tsx',
  'web/src/app/(user)/canvas/components/canvas-delete-projects-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-image-toolbar-settings-modal.tsx',
  'web/src/app/(user)/canvas/components/canvas-image-toolbar-tools.tsx',
  'web/src/app/(user)/canvas/components/canvas-mini-map.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-angle-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-crop-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-mask-edit-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-split-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-node-upscale-dialog.tsx',
  'web/src/app/(user)/canvas/components/canvas-node.tsx',
  'web/src/app/(user)/canvas/components/canvas-project-card.tsx',
  'web/src/app/(user)/canvas/components/canvas-prompt-library.tsx',
  'web/src/app/(user)/canvas/components/canvas-resource-mention-textarea.tsx',
  'web/src/app/(user)/canvas/components/canvas-size-picker.tsx',
  'web/src/app/(user)/canvas/components/canvas-toolbar.tsx',
  'web/src/app/(user)/canvas/components/canvas-zoom-controls.tsx',
  'web/src/app/(user)/canvas/components/vozeb-canvas.tsx',
  'web/src/app/(user)/canvas/constants.ts',
  'web/src/app/(user)/canvas/export-types.ts',
  'web/src/app/(user)/canvas/stores/use-canvas-store.ts',
  'web/src/app/(user)/canvas/stores/use-canvas-ui-store.ts',
  'web/src/app/(user)/canvas/types.ts',
  'web/src/app/(user)/canvas/utils/canvas-agent-ops.ts',
  'web/src/app/(user)/canvas/utils/canvas-image-data.ts',
  'web/src/app/(user)/canvas/utils/canvas-node-size.ts',
  'web/src/app/(user)/canvas/utils/canvas-resource-references.ts',
  // pure client utils under web/src/lib (no server secrets / no proxy implementation)
  'web/src/lib/audio-generation.ts',
  'web/src/lib/canvas-theme.ts',
  'web/src/lib/file-drop.ts',
  'web/src/lib/image-reference-prompt.ts',
  'web/src/lib/image-utils.ts',
  'web/src/lib/storage-keys.ts',
  'web/src/lib/utils.ts',
  'web/src/lib/zip.ts',
];

/**
 * K1's closed classification of the frozen direct-copy set. This is derived
 * from the source inventory rather than a manually maintained count.
 */
export const PRODUCTION_INVENTORY = [
  { source: 'web/src/app/(user)/canvas/[id]/page.tsx', classification: 'delete-from-inventory' },
  { source: 'web/src/app/(user)/canvas/components/asset-picker-modal.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx', classification: 'out-of-scope' },
  { source: 'web/src/app/(user)/canvas/components/canvas-agent-panel-motion.ts', classification: 'out-of-scope' },
  { source: 'web/src/app/(user)/canvas/components/canvas-config-composer.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-connections.tsx', classification: 'port-required', replacementTarget: 'apps/canvas/src/kernel-host/ported/canvas-connections.tsx' },
  { source: 'web/src/app/(user)/canvas/components/canvas-context-menu.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-delete-projects-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-image-toolbar-settings-modal.tsx', classification: 'port-required', replacementTarget: 'apps/canvas/src/client/runtime-panel.tsx' },
  { source: 'web/src/app/(user)/canvas/components/canvas-image-toolbar-tools.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-mini-map.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-angle-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-crop-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-mask-edit-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-split-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node-upscale-dialog.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-node.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-project-card.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-prompt-library.tsx', classification: 'port-required', replacementTarget: 'apps/canvas/src/client/runtime-panel.tsx' },
  { source: 'web/src/app/(user)/canvas/components/canvas-resource-mention-textarea.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-size-picker.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/canvas-toolbar.tsx', classification: 'port-required', replacementTarget: 'apps/canvas/src/kernel-host/ported/k2-canvas-toolbar.tsx' },
  { source: 'web/src/app/(user)/canvas/components/canvas-zoom-controls.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/components/vozeb-canvas.tsx', classification: 'mount-exact' },
  { source: 'web/src/app/(user)/canvas/constants.ts', classification: 'utility-exact' },
  { source: 'web/src/app/(user)/canvas/export-types.ts', classification: 'delete-from-inventory' },
  { source: 'web/src/app/(user)/canvas/stores/use-canvas-store.ts', classification: 'delete-from-inventory' },
  { source: 'web/src/app/(user)/canvas/stores/use-canvas-ui-store.ts', classification: 'port-required', replacementTarget: 'apps/canvas/src/kernel-host/ported/canvas-session-store.ts' },
  { source: 'web/src/app/(user)/canvas/types.ts', classification: 'utility-exact' },
  { source: 'web/src/app/(user)/canvas/utils/canvas-agent-ops.ts', classification: 'out-of-scope' },
  { source: 'web/src/app/(user)/canvas/utils/canvas-image-data.ts', classification: 'utility-exact' },
  { source: 'web/src/app/(user)/canvas/utils/canvas-node-size.ts', classification: 'utility-exact' },
  { source: 'web/src/app/(user)/canvas/utils/canvas-resource-references.ts', classification: 'port-required', replacementTarget: 'apps/canvas/src/kernel-host/generation-adapter.ts' },
  { source: 'web/src/lib/audio-generation.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/canvas-theme.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/file-drop.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/image-reference-prompt.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/image-utils.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/storage-keys.ts', classification: 'delete-from-inventory' },
  { source: 'web/src/lib/utils.ts', classification: 'utility-exact' },
  { source: 'web/src/lib/zip.ts', classification: 'port-required', replacementTarget: 'apps/canvas/src/server/backend-port-vnext.ts' },
];

export const PRODUCTION_WHITELIST = [
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/components/canvas-context-menu',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-context-menu.tsx',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/components/canvas-mini-map',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-mini-map.tsx',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/components/canvas-node',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-node.tsx',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/components/canvas-zoom-controls',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-zoom-controls.tsx',
  },
  {
    consumer: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-node.tsx',
    importRef: './canvas-resource-mention-textarea',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-resource-mention-textarea.tsx',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-node-adapter.ts',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/constants',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/constants.ts',
  },
  {
    consumer: 'apps/canvas/lib/image-reference-prompt.ts',
    importRef: '../src/vendor/vozeb/lib/image-reference-prompt',
    target: 'apps/canvas/src/vendor/vozeb/lib/image-reference-prompt.ts',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    importRef: '@/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas.tsx',
  },
  {
    consumer: 'apps/canvas/src/kernel-host/retouch-adapter.ts',
    importRef: '../vendor/vozeb/app/(user)/canvas/utils/canvas-image-data.js',
    target: 'apps/canvas/src/vendor/vozeb/app/(user)/canvas/utils/canvas-image-data.ts',
  },
  {
    consumer: 'apps/canvas/lib/canvas-theme.ts',
    importRef: '../src/vendor/vozeb/lib/canvas-theme',
    target: 'apps/canvas/src/vendor/vozeb/lib/canvas-theme.ts',
  },
];

export function sourceToTarget(source) {
  if (!source.startsWith('web/src/')) {
    throw new Error(`source must start with web/src/: ${source}`);
  }
  return `apps/canvas/src/vendor/vozeb/${source.slice('web/src/'.length)}`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function requireUpstreamHead(upstreamRoot) {
  if (!upstreamRoot) {
    throw new Error('PRO_STUDIO_UPSTREAM_ROOT is required');
  }
  if (!existsSync(upstreamRoot)) {
    throw new Error(`PRO_STUDIO_UPSTREAM_ROOT does not exist: ${upstreamRoot}`);
  }
  let head;
  try {
    head = execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      `PRO_STUDIO_UPSTREAM_ROOT is not a git checkout: ${upstreamRoot}`
    );
  }
  if (head !== PINNED_COMMIT) {
    throw new Error(
      `upstream HEAD ${head} !== pinned ${PINNED_COMMIT}`
    );
  }
  return head;
}

export function applyExactCopies({
  root = repoRoot(),
  upstreamRoot = process.env.PRO_STUDIO_UPSTREAM_ROOT,
  sources = EXACT_COPY_SOURCES,
  dryRun = false,
} = {}) {
  requireUpstreamHead(upstreamRoot);

  const manifestPath = resolve(root, MANIFEST_REL);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.authorization || typeof manifest.authorization !== 'object') {
    throw new Error('copy-manifest.json missing authorization block');
  }
  if (manifest.upstream?.commit !== PINNED_COMMIT) {
    throw new Error(
      `manifest.upstream.commit must remain ${PINNED_COMMIT}`
    );
  }
  if (!Array.isArray(manifest.ports)) {
    throw new Error('copy-manifest.json missing K1 ports[] block');
  }
  for (const port of manifest.ports) {
    if (!port?.target?.startsWith('apps/canvas/src/kernel-host/ported/')) {
      throw new Error(`port target must stay under kernel-host/ported: ${port?.target}`);
    }
  }

  const copies = [];
  for (const source of sources) {
    const absSource = resolve(upstreamRoot, source);
    if (!existsSync(absSource)) {
      throw new Error(`missing upstream source: ${source}`);
    }
    const bytes = readFileSync(absSource);
    const hash = sha256(bytes);
    const target = sourceToTarget(source);
    const absTarget = resolve(root, target);
    if (!dryRun) {
      mkdirSync(dirname(absTarget), { recursive: true });
      copyFileSync(absSource, absTarget);
      const targetBytes = readFileSync(absTarget);
      if (!bytes.equals(targetBytes) || sha256(targetBytes) !== hash) {
        throw new Error(`byte mismatch after copy: ${target}`);
      }
    }
    copies.push({
      source,
      target,
      sha256: hash,
      authorizationStatus: 'authorized',
      a2Evidence: A2_EVIDENCE,
      a3Evidence: A3_EVIDENCE,
    });
  }

  const nextTargets = new Set(copies.map((copy) => copy.target));
  const vendorRoot = resolve(root, 'apps/canvas/src/vendor/vozeb');
  for (const previous of manifest.copies ?? []) {
    if (
      typeof previous.target !== 'string' ||
      nextTargets.has(previous.target) ||
      !previous.target.startsWith('apps/canvas/src/vendor/vozeb/')
    ) {
      continue;
    }
    const staleTarget = resolve(root, previous.target);
    const vendorRelative = relative(vendorRoot, staleTarget);
    if (
      vendorRelative === '..' ||
      vendorRelative.startsWith('../') ||
      vendorRelative.startsWith('..\\')
    ) {
      throw new Error(`stale target escapes vendor root: ${previous.target}`);
    }
    if (!dryRun && existsSync(staleTarget)) rmSync(staleTarget);
  }

  const next = {
    ...manifest,
    schemaVersion: 2,
    authorization: { ...manifest.authorization },
    copies,
    productionInventory: PRODUCTION_INVENTORY.map((item) => ({ ...item })),
    productionWhitelist: PRODUCTION_WHITELIST.map((item) => ({ ...item })),
    status:
      copies.length > 0
        ? 'authorized_with_exact_copies'
        : 'authorized_pending_exact_copy_entries',
    note:
      copies.length > 0
        ? 'A2/A3 written authorization on file. Exact-copy rows frozen at pinned commit via scripts/pro-studio/apply-exact-copies.mjs.'
        : manifest.note,
  };

  if (!dryRun) {
    writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  return { copies, manifest: next };
}

const isEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const { copies } = applyExactCopies({ dryRun });
    process.stdout.write(
      `${dryRun ? 'dry-run ' : ''}exact-copy rows: ${copies.length}\n`
    );
    for (const row of copies) {
      process.stdout.write(`  ${row.source} -> ${row.target} ${row.sha256.slice(0, 12)}…\n`);
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}
