import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const seenTargets = new Set();
  for (const copy of manifest?.copies ?? []) {
    const target = copy.target || '<missing target>';
    if (!copy.source) issues.push(`${target}: source path is required`);
    if (!copy.target) issues.push(`${target}: target path is required`);
    if (seenTargets.has(copy.target)) {
      issues.push(`${target}: target is listed more than once`);
    }
    seenTargets.add(copy.target);
    if (!/^[a-f0-9]{64}$/u.test(copy.sha256 ?? '')) {
      issues.push(`${target}: exact source/target sha256 is required`);
    }
    const sourceBytes = readSource?.(copy.source);
    const targetBytes = readTarget?.(copy.target);
    if (!sourceBytes) {
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

export function discoverExactCopyTargets(upstreamDirectory, targetDirectory) {
  const upstreamHashes = new Set(
    collectCopyCandidates(upstreamDirectory).map((file) =>
      sha256(file.contents)
    )
  );
  return collectCopyCandidates(targetDirectory, 'apps/canvas')
    .filter((file) => upstreamHashes.has(sha256(file.contents)))
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

export function validateReleaseEvidence(evidence, evidenceExists = existsSync) {
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
  const issues = [];
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
        readSource: pinnedUpstreamRoot
          ? (path) => safeRead(pinnedUpstreamRoot, path)
          : undefined,
        readTarget: (path) => safeRead(root, path),
      })
    );
    if (pinnedUpstreamRoot) {
      issues.push(
        ...validateDiscoveredCopySet(
          manifest.copies,
          discoverExactCopyTargets(
            pinnedUpstreamRoot,
            resolve(root, 'apps/canvas')
          )
        )
      );
    }
  }
  if (!existsSync(releasePath)) {
    issues.push('release evidence manifest is missing');
  } else {
    issues.push(
      ...validateReleaseEvidence(
        JSON.parse(readFileSync(releasePath, 'utf8')),
        (path) => existsSync(resolve(root, path))
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
