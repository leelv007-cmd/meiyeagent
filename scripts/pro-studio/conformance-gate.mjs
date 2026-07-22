import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProductionRecoveryCli } from '../recovery/production-recovery-cli.mjs';
import {
  findMainWebCanvasImportViolations,
  validateCanvasBundleBudget,
} from './canvas-bundle-budget.mjs';
import {
  validateSecurityMatrixReleaseStatus,
  verifySecurityManifestFile,
} from './security-matrix.mjs';

const FORBIDDEN_RULES = [
  {
    rule: 'agent-token',
    pattern:
      /\b(?:agentToken|agentUrl)\b|(?:from\s+|require\()['"][^'"]*canvas-agent[^'"]*['"]/,
  },
  {
    rule: 'local-storage-token',
    pattern:
      /localStorage[^\n;]*(?:token|Token)|(?:token|Token)[^\n;]*localStorage/,
  },
  {
    rule: 'token-query',
    pattern:
      /[?&](?:token|agentToken)=|searchParams[^\n;]*(?:token|agentToken)/,
  },
  {
    rule: 'node-process-execution',
    pattern: /(?:node:)?child_process|\bexecFileSync?\(|\bspawnSync?\(/,
  },
  {
    rule: 'arbitrary-provider-target',
    pattern: /\b(?:serverUrl|baseUrl|requestTemplate|poll_url)\s*(?:=|:)/,
  },
  {
    rule: 'catch-all-proxy',
    pattern: /\[\.\.\.path\]|catchAllProxy|\/api\/proxy\//,
  },
  {
    rule: 'independent-auth-bootstrap',
    pattern: /\bfirstUser\b|\bregisterUser\b|\bpasswordLogin\b/,
  },
];

const EXACT_COPY_FORBIDDEN_RULES = [
  {
    message: 'forbidden local-agent bridge',
    pattern:
      /\b(?:agentToken|agentUrl)\b|canvas-agent-(?:token|url)|CanvasLocalAgentPanel|canvas-local-agent-panel/iu,
  },
  {
    message: 'forbidden arbitrary proxy',
    pattern: /\/api\/(?:media-)?proxy(?:\/|\?|["'])/iu,
  },
  {
    message: 'forbidden provider-direct runtime',
    pattern:
      /@\/services\/(?:api\/|image-storage|file-storage)|@\/stores\/use-config-store/iu,
  },
];

const PORT_TARGET_ROOT = 'apps/canvas/src/kernel-host/ported/';
const INVENTORY_CLASSIFICATIONS = new Set([
  'mount-exact',
  'utility-exact',
  'port-required',
  'delete-from-inventory',
  'out-of-scope',
]);

const RELEASE_EVIDENCE_KEYS = [
  'n2Recovery',
  'providerSafeFetch',
  'providerReferenceProbe',
  'audioSpeechActivation',
  'audioSfxActivation',
  'securityMatrix',
  'crossServiceSmoke',
  'pricingApproval',
  'upsellValidation',
];

export function validateCopyManifest(manifest, options = {}) {
  const normalized =
    typeof options === 'function' ? { evidenceExists: options } : options;
  const evidenceExists = normalized.evidenceExists ?? existsSync;
  const readEvidence = normalized.readEvidence;
  const readSource = normalized.readSource;
  const readTarget = normalized.readTarget;
  const issues = [];
  const commit = manifest?.upstream?.commit;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) {
    issues.push('upstream.commit: exact 40-character commit is required');
  }
  if (!manifest?.upstream?.repository) {
    issues.push('upstream.repository: repository URL is required');
  }
  if (!Array.isArray(manifest?.copies) || manifest.copies.length === 0) {
    issues.push('copies: at least one direct-copy entry is required');
  }

  if (readEvidence) {
    const instrument = manifest?.authorization?.instrument;
    if (!instrument || typeof instrument !== 'object') {
      issues.push('authorization.instrument: hashed written instrument is required');
    } else if (!/^[a-f0-9]{64}$/u.test(instrument.sha256 ?? '')) {
      issues.push('authorization.instrument: exact sha256 is required');
    } else {
      for (const [label, path] of [
        ['source', instrument.sourcePath],
        ['evidence copy', instrument.evidenceCopyPath],
      ]) {
        if (!path) {
          issues.push(`authorization.instrument: ${label} path is required`);
          continue;
        }
        const bytes = readEvidence(path);
        if (!bytes) {
          issues.push(`authorization.instrument: ${label} is missing`);
        } else if (sha256(bytes) !== instrument.sha256) {
          issues.push(
            `authorization.instrument: ${label} does not match the declared sha256`
          );
        }
      }
    }
  }

  const seenTargets = new Set();
  for (const copy of manifest?.copies ?? []) {
    const target = copy.target || '<missing target>';
    if (!copy.source) issues.push(`${target}: source path is required`);
    if (!copy.target) issues.push(`${target}: target path is required`);
    if (copy.source?.startsWith('web/src/')) {
      const expectedTarget = `apps/canvas/src/vendor/vozeb/${copy.source.slice('web/src/'.length)}`;
      if (copy.target !== expectedTarget) {
        issues.push(
          `${target}: target must map ${copy.source} to ${expectedTarget}`
        );
      }
    } else if (copy.source) {
      issues.push(`${target}: source must be under web/src/`);
    }
    if (seenTargets.has(copy.target)) {
      issues.push(`${target}: target is listed more than once`);
    }
    seenTargets.add(copy.target);
    if (!/^[a-f0-9]{64}$/u.test(copy.sha256 ?? '')) {
      issues.push(`${target}: exact source/target sha256 is required`);
    }
    const sourceBytes = readSource?.(copy.source);
    const targetBytes = readTarget?.(copy.target);
    if (readSource && !sourceBytes) {
      issues.push(`${target}: pinned upstream source is missing`);
    }
    if (!targetBytes) {
      issues.push(`${target}: copied target is missing`);
    }
    if (
      sourceBytes &&
      targetBytes &&
      (sha256(sourceBytes) !== copy.sha256 ||
        sha256(targetBytes) !== copy.sha256 ||
        !Buffer.from(sourceBytes).equals(Buffer.from(targetBytes)))
    ) {
      issues.push(
        `${target}: source and target do not match the declared sha256`
      );
    }
    if (!sourceBytes && targetBytes && sha256(targetBytes) !== copy.sha256) {
      issues.push(
        `${target}: copied target does not match the declared sha256`
      );
    }
    const verifiedBytes = sourceBytes ?? targetBytes;
    if (verifiedBytes) {
      const sourceText = Buffer.from(verifiedBytes).toString('utf8');
      for (const rule of EXACT_COPY_FORBIDDEN_RULES) {
        if (rule.pattern.test(sourceText)) {
          issues.push(`${target}: ${rule.message}`);
        }
      }
    }
    if (copy.authorizationStatus !== 'authorized') {
      issues.push(`${target}: authorizationStatus must be authorized`);
    }
    for (const [label, path] of [
      ['A2', copy.a2Evidence],
      ['A3', copy.a3Evidence],
    ]) {
      if (!path) {
        issues.push(`${target}: ${label} evidence path is required`);
      } else if (!evidenceExists(path)) {
        issues.push(`${target}: missing ${label} evidence ${path}`);
      }
    }
  }
  return issues;
}

/**
 * K1 derivative-port records are intentionally separate from byte-exact copies.
 * A port may adapt its source, but it must retain a pinned upstream hash, an
 * independently hashed target, authorization evidence, and an adapter matrix.
 */
export function validatePortManifest(manifest, options = {}) {
  const normalized =
    typeof options === 'function' ? { evidenceExists: options } : options;
  const evidenceExists = normalized.evidenceExists ?? existsSync;
  const readSource = normalized.readSource;
  const readTarget = normalized.readTarget;
  const issues = [];
  const commit = manifest?.upstream?.commit;

  if (manifest?.schemaVersion !== 2) {
    issues.push('schemaVersion: K1 manifest schemaVersion must be 2');
  }
  if (!Array.isArray(manifest?.ports)) {
    issues.push('ports: K1 manifest requires a ports[] array');
    return issues;
  }

  const seenSources = new Set();
  const seenTargets = new Set();
  for (const port of manifest.ports) {
    const target = port?.target || '<missing target>';
    if (!port?.source) issues.push(`${target}: port source path is required`);
    if (!port?.target) issues.push(`${target}: port target path is required`);
    if (!port?.source?.startsWith('web/src/')) {
      issues.push(`${target}: port source must be under web/src/`);
    }
    if (!port?.target?.startsWith(PORT_TARGET_ROOT)) {
      issues.push(`${target}: port target must stay under ${PORT_TARGET_ROOT}`);
    }
    if (port?.pinnedCommit !== commit) {
      issues.push(`${target}: port pinnedCommit must match upstream.commit`);
    }
    if (seenSources.has(port?.source)) {
      issues.push(`${target}: port source is listed more than once`);
    }
    if (seenTargets.has(port?.target)) {
      issues.push(`${target}: port target is listed more than once`);
    }
    seenSources.add(port?.source);
    seenTargets.add(port?.target);
    for (const [label, value] of [
      ['sourceSha256', port?.sourceSha256],
      ['targetSha256', port?.targetSha256],
    ]) {
      if (!/^[a-f0-9]{64}$/u.test(value ?? '')) {
        issues.push(`${target}: ${label} must be an exact sha256`);
      }
    }
    if (port?.authorizationStatus !== 'authorized') {
      issues.push(`${target}: port authorizationStatus must be authorized`);
    }
    for (const [label, path] of [
      ['A2', port?.a2Evidence],
      ['A3', port?.a3Evidence],
    ]) {
      if (!path) {
        issues.push(`${target}: port ${label} evidence path is required`);
      } else if (!evidenceExists(path)) {
        issues.push(`${target}: missing port ${label} evidence ${path}`);
      }
    }
    for (const [label, value] of [
      ['thirdPartyNotes', port?.thirdPartyNotes],
      ['reviewer', port?.reviewer],
      ['adaptationBoundary', port?.adaptationBoundary],
    ]) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(`${target}: port ${label} is required`);
      }
    }
    if (
      !Array.isArray(port?.adapterReplacementMatrix) ||
      port.adapterReplacementMatrix.length === 0
    ) {
      issues.push(`${target}: adapterReplacementMatrix must be non-empty`);
    } else {
      for (const replacement of port.adapterReplacementMatrix) {
        if (
          !replacement ||
          typeof replacement.upstream !== 'string' ||
          !replacement.upstream ||
          typeof replacement.host !== 'string' ||
          !replacement.host ||
          !['exclude', 'replace'].includes(replacement.decision)
        ) {
          issues.push(
            `${target}: every adapterReplacementMatrix row requires upstream, host, and decision`
          );
        }
      }
    }

    const sourceBytes = readSource?.(port?.source);
    const targetBytes = readTarget?.(port?.target);
    if (readSource && !sourceBytes) {
      issues.push(`${target}: pinned upstream port source is missing`);
    }
    if (readTarget && !targetBytes) {
      issues.push(`${target}: port target is missing`);
    }
    if (sourceBytes && sha256(sourceBytes) !== port?.sourceSha256) {
      issues.push(`${target}: source does not match sourceSha256`);
    }
    if (targetBytes && sha256(targetBytes) !== port?.targetSha256) {
      issues.push(`${target}: target does not match targetSha256`);
    }
  }

  if (normalized.discoveredTargets) {
    const declared = new Set(manifest.ports.map((port) => port.target));
    const discovered = new Set(normalized.discoveredTargets);
    for (const target of declared) {
      if (!discovered.has(target)) {
        issues.push(`${target}: manifest port target was not discovered`);
      }
    }
    for (const target of discovered) {
      if (!declared.has(target)) {
        issues.push(`${target}: derivative port is missing from ports[]`);
      }
    }
  }
  return issues.sort();
}

/** K1's closed 42-file inventory and production whitelist. */
export function validateProductionInventory(manifest, options = {}) {
  const readHost = options.readHost;
  const issues = [];
  const copies = manifest?.copies ?? [];
  const copySources = new Set(copies.map((copy) => copy.source));
  const copyTargets = new Map(copies.map((copy) => [copy.target, copy]));
  const inventory = manifest?.productionInventory;
  if (!Array.isArray(inventory)) {
    return ['productionInventory: K1 manifest requires a closed inventory'];
  }
  const seenSources = new Set();
  for (const item of inventory) {
    const source = item?.source || '<missing source>';
    if (!copySources.has(item?.source)) {
      issues.push(`${source}: inventory source is not an exact-copy row`);
    }
    if (seenSources.has(item?.source)) {
      issues.push(`${source}: inventory source is listed more than once`);
    }
    seenSources.add(item?.source);
    if (!INVENTORY_CLASSIFICATIONS.has(item?.classification)) {
      issues.push(`${source}: inventory classification is invalid`);
    }
    if (
      item?.classification === 'port-required' &&
      (typeof item.replacementTarget !== 'string' || !item.replacementTarget)
    ) {
      issues.push(`${source}: port-required inventory row needs replacementTarget`);
    }
  }
  for (const source of copySources) {
    if (!seenSources.has(source)) {
      issues.push(`${source}: exact-copy row is absent from productionInventory`);
    }
  }

  const inventoryBySource = new Map(inventory.map((item) => [item.source, item]));
  if (!Array.isArray(manifest?.productionWhitelist)) {
    issues.push('productionWhitelist: K1 manifest requires a production whitelist');
    return issues.sort();
  }
  const seenTargets = new Set();
  for (const entry of manifest.productionWhitelist) {
    const target = entry?.target || '<missing target>';
    const copy = copyTargets.get(entry?.target);
    if (!copy) {
      issues.push(`${target}: production whitelist target is not an exact-copy row`);
      continue;
    }
    if (seenTargets.has(entry.target)) {
      issues.push(`${target}: production whitelist target is listed more than once`);
    }
    seenTargets.add(entry.target);
    const classification = inventoryBySource.get(copy.source)?.classification;
    if (!['mount-exact', 'utility-exact'].includes(classification)) {
      issues.push(`${target}: non-production inventory class cannot be whitelisted`);
    }
    if (
      typeof entry?.consumer !== 'string' ||
      !entry.consumer ||
      typeof entry?.importRef !== 'string' ||
      !entry.importRef
    ) {
      issues.push(`${target}: production whitelist needs consumer and importRef`);
    } else if (readHost) {
      const host = readHost(entry.consumer);
      if (!host || !Buffer.from(host).toString('utf8').includes(entry.importRef)) {
        issues.push(`${target}: production whitelist consumer does not import importRef`);
      }
    }
  }
  return issues.sort();
}

export function validateDiscoveredCopySet(copies, discoveredTargets) {
  const declared = new Set(copies.map((copy) => copy.target));
  const discovered = new Set(discoveredTargets);
  return [
    ...[...declared]
      .filter((target) => !discovered.has(target))
      .map(
        (target) =>
          `${target}: manifest target was not discovered as an exact copy`
      ),
    ...[...discovered]
      .filter((target) => !declared.has(target))
      .map(
        (target) =>
          `${target}: exact upstream copy is missing from the manifest`
      ),
  ].sort();
}

export function discoverExactCopyTargets(
  upstreamDirectory,
  targetDirectory,
  displayRoot = 'apps/canvas'
) {
  const upstreamHashes = new Set(
    collectCopyCandidates(upstreamDirectory).map((file) =>
      sha256(file.contents)
    )
  );
  return collectCopyCandidates(targetDirectory, displayRoot)
    .filter((file) => upstreamHashes.has(sha256(file.contents)))
    .map((file) => file.path)
    .sort();
}

export function discoverPortedTargets(
  targetDirectory,
  displayRoot = PORT_TARGET_ROOT.slice(0, -1)
) {
  return collectCopyCandidates(targetDirectory, displayRoot)
    .map((file) => file.path)
    .sort();
}

export function findForbiddenSourceFindings(files) {
  const findings = [];
  for (const file of files) {
    for (const { rule, pattern } of FORBIDDEN_RULES) {
      if (pattern.test(file.contents)) {
        findings.push({ path: file.path, rule });
      }
    }
  }
  return findings;
}

const NEXT_NODE_PROCESS_EXTERNAL =
  /(\d+):([A-Za-z_$][\w$]*)=>\{\s*(?:(?:"use strict"|'use strict');)?\s*\2\.exports=require\(["'](?:node:)?child_process["']\)\s*\}/g;

export function findForbiddenBuildArtifactFindings(files) {
  const findings = [];
  for (const file of files) {
    const externalModuleIds = [];
    const appOwnedContents = file.contents.replace(
      NEXT_NODE_PROCESS_EXTERNAL,
      (_match, moduleId) => {
        externalModuleIds.push(moduleId);
        return '';
      }
    );
    for (const { rule, pattern } of FORBIDDEN_RULES) {
      const matches =
        rule === 'node-process-execution'
          ? pattern.test(appOwnedContents) ||
            externalModuleIds.some((moduleId) =>
              new RegExp(`\\b[A-Za-z_$][\\w$]*\\(${moduleId}\\)`).test(
                appOwnedContents
              )
            )
          : pattern.test(appOwnedContents);
      if (matches) findings.push({ path: file.path, rule });
    }
  }
  return findings;
}

export function collectCanvasBuildArtifactFiles(
  directory,
  displayRoot = 'apps/canvas/.next'
) {
  if (!existsSync(directory)) return [];
  const root = resolve(directory);
  const files = [];

  function visit(current) {
    for (const entry of readdirSync(current)) {
      const absolute = resolve(current, entry);
      if (statSync(absolute).isDirectory()) {
        if (entry === 'node_modules') continue;
        visit(absolute);
        continue;
      }
      const artifactPath = relative(root, absolute).replaceAll('\\', '/');
      const isBundle =
        /^(?:server|standalone|static)\//.test(artifactPath) &&
        /\.(?:c|m)?js$/i.test(entry);
      const isManifest = /(?:^|\/)[^/]*manifest[^/]*\.json$/i.test(
        artifactPath
      );
      if (!isBundle && !isManifest) continue;
      files.push({
        path: `${displayRoot}/${artifactPath}`,
        contents: readFileSync(absolute, 'utf8'),
      });
    }
  }

  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function validateCanvasBuildArtifacts(directory) {
  if (!existsSync(directory)) {
    return ['apps/canvas/.next: Canvas build artifacts are missing'];
  }
  const artifacts = collectCanvasBuildArtifactFiles(directory);
  if (artifacts.length === 0) {
    return ['apps/canvas/.next: no scannable build artifacts were found'];
  }
  return findForbiddenBuildArtifactFindings(artifacts).map(
    ({ path, rule }) => `${path}: forbidden ${rule}`
  );
}

export function findFrontendFetchViolations(
  files,
  backendPortPath = 'apps/canvas/src/client/backend-client.ts'
) {
  return files
    .filter(
      (file) =>
        file.path !== backendPortPath &&
        /['"]use client['"]/.test(file.contents) &&
        /\bfetch\s*\(/.test(file.contents)
    )
    .map((file) => `${file.path}: client fetch must use CanvasBackendPort`);
}

export function validateReleaseEvidence(
  evidence,
  evidenceExists = existsSync,
  securityVerification,
  verifyN2Evidence
) {
  const issues = [];
  for (const key of RELEASE_EVIDENCE_KEYS) {
    const record = evidence?.[key];
    if (!record?.path) {
      issues.push(`${key}: evidence path is required`);
    } else if (record.status !== 'passed') {
      issues.push(`${key}: status must be passed`);
    } else if (!evidenceExists(record.path)) {
      issues.push(`${key}: missing evidence ${record.path}`);
    }
  }
  if (securityVerification) {
    issues.push(
      ...validateSecurityMatrixReleaseStatus(evidence, securityVerification)
    );
  }
  if (evidence?.n2Recovery?.status === 'passed') {
    if (typeof verifyN2Evidence !== 'function') {
      issues.push(
        'n2Recovery: production recovery manifest verifier is required'
      );
    } else if (!verifyN2Evidence(evidence.n2Recovery.path)) {
      issues.push(
        'n2Recovery: production recovery manifest did not pass verifier'
      );
    }
  }
  return issues;
}

function collectSourceFiles(directory, root) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...collectSourceFiles(absolute, root));
      continue;
    }
    if (!/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry) || entry.endsWith('.test.ts')) {
      continue;
    }
    files.push({
      path: absolute.slice(root.length + 1),
      contents: readFileSync(absolute, 'utf8'),
    });
  }
  return files;
}

function collectCopyCandidates(directory, displayRoot = '') {
  if (!existsSync(directory)) return [];
  const root = resolve(directory);
  const files = [];
  const ignoredDirectories = new Set([
    '.git',
    '.hg',
    '.next',
    '.svn',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'node_modules',
  ]);
  function visit(current) {
    for (const entry of readdirSync(current)) {
      const absolute = resolve(current, entry);
      if (statSync(absolute).isDirectory()) {
        if (ignoredDirectories.has(entry)) continue;
        visit(absolute);
        continue;
      }
      const contents = readFileSync(absolute);
      const path = relative(root, absolute).replaceAll('\\', '/');
      files.push({
        path: displayRoot ? `${displayRoot}/${path}` : path,
        contents,
      });
    }
  }
  visit(root);
  return files;
}

function safeRead(root, path) {
  if (typeof path !== 'string' || !path) return undefined;
  const absolute = resolve(root, path);
  const relativePath = relative(resolve(root), absolute);
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\')
  ) {
    return undefined;
  }
  try {
    return readFileSync(absolute);
  } catch {
    return undefined;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(root) {
  const manifestPath = resolve(
    root,
    'docs/evidence/pro-studio/copy-manifest.json'
  );
  const releasePath = resolve(
    root,
    'docs/evidence/pro-studio/release-evidence.json'
  );
  const securityPath = resolve(
    root,
    'docs/evidence/pro-studio/security-manifest.json'
  );
  const issues = [];
  let securityVerification;
  if (!existsSync(manifestPath)) {
    issues.push('copy manifest is missing');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const upstreamRoot = process.env.PRO_STUDIO_UPSTREAM_ROOT;
    let pinnedUpstreamRoot;
    if ((manifest.copies?.length ?? 0) > 0) {
      if (!upstreamRoot) {
        issues.push(
          'PRO_STUDIO_UPSTREAM_ROOT: pinned upstream checkout is required'
        );
      } else {
        try {
          const head = execFileSync(
            'git',
            ['-C', upstreamRoot, 'rev-parse', 'HEAD'],
            { encoding: 'utf8' }
          ).trim();
          if (head !== manifest.upstream?.commit) {
            issues.push(
              'PRO_STUDIO_UPSTREAM_ROOT: checkout HEAD does not match upstream.commit'
            );
          } else {
            pinnedUpstreamRoot = upstreamRoot;
          }
        } catch {
          issues.push(
            'PRO_STUDIO_UPSTREAM_ROOT: checkout could not be verified'
          );
        }
      }
    }
    issues.push(
      ...validateCopyManifest(manifest, {
        evidenceExists: (path) => existsSync(resolve(root, path)),
        readEvidence: (path) => safeRead(root, path),
        readSource: pinnedUpstreamRoot
          ? (path) => safeRead(pinnedUpstreamRoot, path)
          : undefined,
        readTarget: (path) => safeRead(root, path),
      })
    );
    issues.push(
      ...validatePortManifest(manifest, {
        discoveredTargets: discoverPortedTargets(
          resolve(root, 'apps/canvas/src/kernel-host/ported')
        ),
        evidenceExists: (path) => existsSync(resolve(root, path)),
        readSource: pinnedUpstreamRoot
          ? (path) => safeRead(pinnedUpstreamRoot, path)
          : undefined,
        readTarget: (path) => safeRead(root, path),
      }),
      ...validateProductionInventory(manifest, {
        readHost: (path) => safeRead(root, path),
      })
    );
    if (pinnedUpstreamRoot) {
      issues.push(
        ...validateDiscoveredCopySet(
          manifest.copies,
          discoverExactCopyTargets(
            pinnedUpstreamRoot,
            resolve(root, 'apps/canvas/src/vendor/vozeb'),
            'apps/canvas/src/vendor/vozeb'
          )
        )
      );
    }
  }
  if (!existsSync(securityPath)) {
    issues.push('security manifest is missing');
  } else {
    try {
      securityVerification = verifySecurityManifestFile(securityPath, { root });
    } catch (error) {
      securityVerification = {
        blockers: [],
        errors: [error instanceof Error ? error.message : String(error)],
        status: 'failed',
      };
    }
    issues.push(
      ...securityVerification.errors.map(
        (issue) => `security manifest: ${issue}`
      ),
      ...securityVerification.blockers.map(
        (issue) => `security manifest: ${issue}`
      )
    );
  }
  if (!existsSync(releasePath)) {
    issues.push('release evidence manifest is missing');
  } else {
    issues.push(
      ...validateReleaseEvidence(
        JSON.parse(readFileSync(releasePath, 'utf8')),
        (path) => existsSync(resolve(root, path)),
        securityVerification,
        (path) =>
          runProductionRecoveryCli(['verify', path], { root }).exitCode === 0
      )
    );
  }

  const sources = collectSourceFiles(resolve(root, 'apps/canvas'), root);
  issues.push(
    ...findForbiddenSourceFindings(sources).map(
      ({ path, rule }) => `${path}: forbidden ${rule}`
    ),
    ...findFrontendFetchViolations(sources)
  );

  issues.push(
    ...validateCanvasBuildArtifacts(resolve(root, 'apps/canvas/.next'))
  );
  const canvasBuildDirectory = resolve(root, 'apps/canvas/.next');
  if (existsSync(canvasBuildDirectory)) {
    issues.push(...validateCanvasBundleBudget(canvasBuildDirectory));
  }
  issues.push(
    ...findMainWebCanvasImportViolations(
      collectSourceFiles(resolve(root, 'mkfast-template-main'), root)
    )
  );

  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`- ${issue}\n`);
    return 1;
  }
  process.stdout.write('Pro Studio conformance gate passed.\n');
  return 0;
}

const isEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) process.exitCode = run(resolve(process.cwd()));
