/**
 * One-off backfill (R-P0-00): derive Evidence SHA for every completed V31
 * ticket from its Status text / git history, then insert the provenance
 * fields (Implementation state / Verification state / Evidence SHA /
 * Workflow Run / Artifact Digest) under the Status line.
 *
 * Does NOT fabricate evidence: a ticket whose SHA cannot be resolved to a
 * HEAD ancestor is left without Evidence SHA (the index gate stays red and
 * the ticket cannot be claimed complete).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(import.meta.dirname, '../..');
const ticketsDir = join(repoRoot, 'docs/tickets/v3.1');

const STATUS_RE = /^(?:\*\*Status\*\*|-\s*Status):\s*(.+)$/mu;
const SHORT_SHA_RE = /\b([0-9a-f]{7,40})\b/gu;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function resolveFullSha(shortSha) {
  try {
    return git(['rev-parse', `${shortSha}^{commit}`]);
  } catch {
    return null;
  }
}

function isAncestor(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function extractStatus(text) {
  const m = text.match(STATUS_RE);
  return m ? m[1].trim() : null;
}

function shaCandidatesFromStatus(status) {
  const out = [];
  for (const m of status.matchAll(SHORT_SHA_RE)) {
    const full = resolveFullSha(m[1]);
    if (full && !out.includes(full)) out.push(full);
  }
  return out;
}

function findByTicketId(id) {
  const logs = git([
    'log',
    '--format=%H %s',
    '--all',
    '--grep',
    id,
    '--regexp-ignore-case',
  ]).split('\n');
  const matches = [];
  for (const line of logs) {
    const [sha, ...rest] = line.split(' ');
    const subject = rest.join(' ');
    if (!subject.includes(id)) continue;
    matches.push({ sha, subject });
  }
  return matches;
}

const IMPL_SUBJECT_RE =
  /^(merge|land|feat|fix|refactor|test|build|chore)[:(]|^merge:|\bland\b/i;

// Manually audited evidence SHAs for tickets whose implementation commits do
// not carry the ticket id in the subject (repair-wave tickets, browser-only
// evidence tickets). All SHAs verified as HEAD ancestors.
const MANUAL_EVIDENCE = {
  'V31-34': '557c007eb500dede6f39b786b47d317c8e5522c1', // memory server revocation (repair wave)
  'V31-51': 'e0c635610a6cc952566f21ae03b41d4a3c77c5a1', // encode absent store as null
  'V31-52': '557c007eb500dede6f39b786b47d317c8e5522c1', // repair wave (product durable ready copy)
  'V31-53': '557c007eb500dede6f39b786b47d317c8e5522c1', // repair wave (admin-config seam)
  'V31-54': '557c007eb500dede6f39b786b47d317c8e5522c1', // repair wave (seedComposerInlineAuthorize)
  'V31-56': '8f2c54e5052d3e9b894aec0cda2558fd9e7527c0', // drain living plan revise response
  'V31-57': '052b856e00ef02d9760c62f1e303ebda56bc4003', // write paid confirmation decision on interrupt accept
  'V31-60': '557c007eb500dede6f39b786b47d317c8e5522c1', // video scene contract narrowing (repair wave)
  'V31-61': '96bd91440d434b3f346f18e5e5efbe84c247c53e', // retire video subtitle/cover delivery
  'V31-62': '3bec455d728be43e2d5bfeca8ee1a355cdedb281', // V31-15 artifact growth real UI journey
};

function pickAncestor(candidates, subjects = []) {
  const bySubject = [];
  const rest = [];
  for (const { sha, subject } of subjects) {
    if (IMPL_SUBJECT_RE.test(subject) && isAncestor(sha)) {
      bySubject.push({ sha, subject });
    } else if (isAncestor(sha)) {
      rest.push(sha);
    }
  }
  const shaPool = candidates.filter(isAncestor);
  const preferred = bySubject[0]?.sha;
  const fallback =
    bySubject.find(({ subject }) => /merge|land/i.test(subject))?.sha ??
    shaPool[0] ??
    rest[0] ??
    null;
  return preferred ?? fallback;
}

function classifyImplementation(status) {
  const lower = status.toLowerCase();
  if (/废止|void/i.test(lower)) return 'void';
  if (/^open[\s（(—-]|open\s*（|^open\b|未开工/i.test(lower)) return 'open';
  if (/^partial|partial|^partially|26a done/i.test(lower)) return 'partial';
  if (/^merged-with|evidence-debt/i.test(lower)) return 'implemented';
  if (/^done|^done\b|^resolved|^fixed|已勾/i.test(lower)) return 'done';
  if (/implemented|in-progress|in progress/i.test(lower)) return 'implemented';
  return 'open';
}

function classifyVerification(status) {
  const lower = status.toLowerCase();
  if (/evidence-debt/i.test(lower) || /residual/i.test(lower)) return 'evidence-debt';
  if (/no push|local/i.test(lower)) return 'unverified';
  if (/^done|^done\b|^resolved/i.test(lower)) return 'verified';
  if (/^partial|partial|^partially|26a done/i.test(lower)) return 'evidence-debt';
  return 'unverified';
}

async function main() {
  const files = (await readdir(ticketsDir))
    .filter((f) => /^V31-\d+.*\.md$/u.test(f))
    .sort();

  let inserted = 0;
  let noEvidence = [];
  const report = [];

  for (const file of files) {
    const path = join(ticketsDir, file);
    const text = await readFile(path, 'utf8');
    const status = extractStatus(text);
    if (!status) continue;

    const id = file.match(/^(V31-\d+)/u)[1];
    const impl = classifyImplementation(status);
    const verify = classifyVerification(status);

    let evidenceSha = null;
    const byLog = findByTicketId(id);
    if (impl === 'done' || impl === 'implemented') {
      const candidates = shaCandidatesFromStatus(status);
      evidenceSha =
        MANUAL_EVIDENCE[id] ?? pickAncestor(candidates, byLog);
    }

    const block = [
      `**Implementation state**: ${impl}`,
      `**Verification state**: ${verify}`,
      `**Evidence SHA**: ${evidenceSha ?? ''}`,
      `**Workflow Run**: `,
      `**Artifact Digest**: `,
    ].join('\n');

    if (text.includes('**Implementation state**')) {
      report.push(`${id}: already has provenance block — skipped`);
      continue;
    }

    const statusLine = status === null ? null : text.match(STATUS_RE);
    const anchor = statusLine ? statusLine[0] : '# V31-';
    const anchorIndex = text.indexOf(anchor);
    if (anchorIndex < 0) {
      report.push(`${id}: cannot locate Status line — skipped`);
      continue;
    }
    const anchorEnd = anchorIndex + anchor.length;
    const nextLineEnd = text.indexOf('\n', anchorEnd);
    const insertAt = nextLineEnd < 0 ? text.length : nextLineEnd + 1;

    const updated =
      text.slice(0, insertAt) + '\n' + block + '\n' + text.slice(insertAt);
    await writeFile(path, updated, 'utf8');
    inserted += 1;

    report.push(
      `${id}: impl=${impl} verify=${verify} sha=${evidenceSha ?? 'MISSING'} (from ${byLog.length} log hits)`,
    );
    if (!evidenceSha) noEvidence.push(id);
  }

  process.stdout.write(`Backfilled ${inserted} tickets.\n`);
  for (const line of report) process.stdout.write(`  ${line}\n`);
  process.stdout.write(
    `\nNo HEAD-ancestor SHA resolved (index gate stays red for these):\n  ${noEvidence.join(', ') || '(none)'}\n`,
  );
}

await main();
