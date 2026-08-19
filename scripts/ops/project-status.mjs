#!/usr/bin/env node
/**
 * SHA-scoped project status checker (WF-01 / R-P1-23).
 *
 * Long-lived policy lives in docs/ops/project-status-policy.md.
 * These markdown files only host a machine header plus SHA-scoped snapshot:
 *   - docs/ops/current-project-status.md
 *   - docs/ops/capability-ledger-2026-08-13.md
 *
 * CURRENT is fail-closed: HEAD moved, baseline not an ancestor, or success
 * evidence pinned to an ancestor SHA all force STALE. write never copies
 * ancestor CI green onto the current SHA.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATUS_SCHEMA = 'meiye-project-status/v1';
export const CURRENT = 'CURRENT';
export const STALE = 'STALE';
export const STATUS_PATH = 'docs/ops/current-project-status.md';
export const LEDGER_PATH = 'docs/ops/capability-ledger-2026-08-13.md';
export const POLICY_PATH = 'docs/ops/project-status-policy.md';
export const STATUS_FILES = [STATUS_PATH, LEDGER_PATH];

const HEADER_FENCE = 'project-status-json';
const HEADER_PATTERN = new RegExp(
  '```' + HEADER_FENCE + '\\n([\\s\\S]*?)\\n```',
);
const H1_PATTERN = /^# .+$/m;
const H1_LABEL_PATTERN = /[（(](CURRENT|STALE)[）)]\s*$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const EVIDENCE_FIELDS = ['requiredRun', 'browserRun', 'pgDbosEvidence'];

export function parseStatusHeader(markdown) {
  const match = markdown.match(HEADER_PATTERN);
  if (!match) return null;
  let record;
  try {
    record = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`invalid ${HEADER_FENCE} JSON: ${error.message}`);
  }
  return record;
}

export function headingLabel(markdown) {
  const heading = markdown.match(H1_PATTERN)?.[0] ?? '';
  return heading.match(H1_LABEL_PATTERN)?.[1] ?? null;
}

export function renderStatusHeader(record) {
  return '```' + HEADER_FENCE + '\n' + JSON.stringify(record, null, 2) + '\n```';
}

export function applyStatusHeader(markdown, record) {
  const withHeading = markdown.replace(H1_PATTERN, (line) => {
    const stripped = line.replace(H1_LABEL_PATTERN, '').trimEnd();
    return `${stripped}（${record.label}）`;
  });
  const block = renderStatusHeader(record);
  if (HEADER_PATTERN.test(withHeading)) {
    return withHeading.replace(HEADER_PATTERN, () => block);
  }
  return withHeading.replace(H1_PATTERN, (line) => `${line}\n\n${block}`);
}

export function collectGitFacts(cwd) {
  const head = gitText(cwd, ['rev-parse', 'HEAD']);
  const remotes = gitText(cwd, ['remote'])
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const remote = remotes.includes('meiyeagent')
    ? 'meiyeagent'
    : (remotes[0] ?? null);
  let remoteRef = null;
  let remoteSha = null;
  if (remote) {
    const candidate = `${remote}/main`;
    const resolved = gitOk(cwd, ['rev-parse', '--verify', candidate]);
    if (resolved.status === 0) {
      remoteRef = candidate;
      remoteSha = resolved.stdout.trim();
    }
  }
  const porcelain = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd, encoding: 'utf8' },
  );
  return {
    dirty: porcelain.trim().length > 0,
    head,
    remote,
    remoteRef,
    remoteSha,
  };
}

export function isCommitAncestor(cwd, ancestor, descendant) {
  return (
    gitOk(cwd, ['merge-base', '--is-ancestor', ancestor, descendant])
      .status === 0
  );
}

export function commitExists(cwd, sha) {
  return gitOk(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]).status === 0;
}

export function evaluateStatusRecord(record, facts, options = {}) {
  const reasons = [];
  const isAncestor =
    options.isAncestor ??
    ((ancestor, descendant) =>
      isCommitAncestor(options.cwd, ancestor, descendant));
  const exists =
    options.commitExists ?? ((sha) => commitExists(options.cwd, sha));

  if (!record || typeof record !== 'object') {
    return {
      expectedLabel: STALE,
      ok: false,
      reasons: ['missing project-status-json header'],
    };
  }
  if (record.schema !== STATUS_SCHEMA) {
    reasons.push(`schema must be ${STATUS_SCHEMA}`);
  }
  if (record.label !== CURRENT && record.label !== STALE) {
    reasons.push('label must be CURRENT or STALE');
  }
  for (const field of ['head', 'baseline']) {
    if (!SHA_PATTERN.test(record[field])) {
      reasons.push(`${field} must be a 40-character SHA`);
    } else if (!exists(record[field])) {
      reasons.push(`${field} ${record[field]} does not resolve to a commit`);
    }
  }
  if (typeof record.dirty !== 'boolean') {
    reasons.push('dirty must be boolean');
  }

  const baselineOk = SHA_PATTERN.test(record.baseline) && exists(record.baseline);
  const baselineIsAncestor =
    baselineOk && isAncestor(record.baseline, facts.head);
  const expired =
    record.baseline !== facts.head || record.head !== facts.head;
  const notAncestor = baselineOk && !baselineIsAncestor;
  const expectedLabel = expired || notAncestor ? STALE : CURRENT;

  if (notAncestor) {
    reasons.push(
      `baseline ${record.baseline} is not an ancestor of HEAD ${facts.head}`,
    );
  }
  if (expired) {
    reasons.push(
      `HEAD moved; recorded head ${record.head} / baseline ${record.baseline} is expired relative to ${facts.head}`,
    );
  }

  if (record.label === CURRENT) {
    if (expectedLabel === STALE) {
      reasons.push('must not stay labeled CURRENT');
    }
    if (record.dirty !== facts.dirty) {
      reasons.push(
        `dirty ${record.dirty} does not match working tree ${facts.dirty}`,
      );
    }
    if (record.remoteSha !== facts.remoteSha) {
      reasons.push(
        `remote ${record.remoteSha ?? 'null'} does not match ${facts.remoteSha ?? 'null'}`,
      );
    }
    reasons.push(...copiedAncestorGreenReasons(record, facts, isAncestor));
  }

  if (Object.hasOwn(options, 'headingLabel')) {
    if (!options.headingLabel) {
      reasons.push('heading must be labeled CURRENT or STALE');
    } else if (options.headingLabel !== record.label) {
      reasons.push(
        `heading label ${options.headingLabel} does not match header ${record.label}`,
      );
    }
  }

  const unique = [...new Set(reasons)];
  const ok =
    unique.length === 0 ||
    (record.label === STALE &&
      unique.every((reason) => isHonestStaleReason(reason)));

  return { expectedLabel, ok, reasons: unique };
}

export function copiedAncestorGreenReasons(record, facts, isAncestor) {
  const reasons = [];
  for (const field of EVIDENCE_FIELDS) {
    const evidence = record[field];
    if (!evidence || evidence.conclusion !== 'success') continue;
    if (!SHA_PATTERN.test(evidence.sha)) {
      reasons.push(`${field} success SHA must be 40 characters`);
      continue;
    }
    if (evidence.sha === facts.head) continue;
    if (isAncestor(evidence.sha, facts.head)) {
      reasons.push(`${field} copies ancestor CI green onto current SHA`);
    } else {
      reasons.push(
        `${field} success SHA ${evidence.sha} is not HEAD ${facts.head}`,
      );
    }
  }
  return reasons;
}

export function buildWrittenRecord(previous, facts, now = () => new Date()) {
  const evidence = {};
  for (const field of EVIDENCE_FIELDS) {
    evidence[field] = previous?.[field] ?? null;
  }
  const baseline = previous?.baseline ?? facts.head;
  // Never rewrite evidence SHAs to HEAD. Ancestor green stays ancestor green.
  const copied = copiedAncestorGreenReasons({ ...evidence }, facts, () => true);
  return {
    schema: STATUS_SCHEMA,
    label: baseline === facts.head && copied.length === 0 ? CURRENT : STALE,
    generatedAt: now().toISOString(),
    head: facts.head,
    remote: facts.remote,
    remoteRef: facts.remoteRef,
    remoteSha: facts.remoteSha,
    dirty: facts.dirty,
    baseline,
    ...evidence,
  };
}

export function checkStatusDocuments(cwd, files = STATUS_FILES) {
  const facts = collectGitFacts(cwd);
  const documents = files.map((path) => {
    const absolute = join(cwd, path);
    let markdown;
    try {
      markdown = readFileSync(absolute, 'utf8');
    } catch (error) {
      return {
        ok: false,
        path,
        label: null,
        reasons: [`cannot read ${path}: ${error.message}`],
      };
    }
    let record;
    try {
      record = parseStatusHeader(markdown);
    } catch (error) {
      return {
        ok: false,
        path,
        label: null,
        reasons: [error.message],
      };
    }
    const verdict = evaluateStatusRecord(record, facts, {
      cwd,
      headingLabel: headingLabel(markdown),
    });
    return {
      ok: verdict.ok,
      path,
      label: record?.label ?? null,
      expectedLabel: verdict.expectedLabel,
      reasons: verdict.reasons,
      record,
    };
  });
  return {
    ok: documents.every((document) => document.ok),
    facts,
    documents,
  };
}

export function writeStatusDocuments(cwd, files = STATUS_FILES, now) {
  const facts = collectGitFacts(cwd);
  return files.map((path) => {
    const absolute = join(cwd, path);
    const markdown = readFileSync(absolute, 'utf8');
    const previous = parseStatusHeader(markdown);
    const record = buildWrittenRecord(previous, facts, now);
    writeFileSync(absolute, applyStatusHeader(markdown, record));
    return { path, record };
  });
}

function isHonestStaleReason(reason) {
  return (
    reason.startsWith('HEAD moved;') ||
    reason.includes('is not an ancestor of HEAD')
  );
}

function gitText(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitOk(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const command = argv[0];
  if (command === 'write') {
    const written = writeStatusDocuments(cwd);
    process.stdout.write(`${JSON.stringify({ written }, null, 2)}\n`);
    return 0;
  }
  if (command === 'check' || command === undefined) {
    const report = checkStatusDocuments(cwd);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      const lines = report.documents.flatMap((document) =>
        document.ok
          ? []
          : document.reasons.map((reason) => `${document.path}: ${reason}`),
      );
      process.stderr.write(`Project status check failed:\n${lines.join('\n')}\n`);
      return 1;
    }
    return 0;
  }
  process.stderr.write('Usage: node scripts/ops/project-status.mjs [check|write]\n');
  return 2;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = main();
}

export { main };
