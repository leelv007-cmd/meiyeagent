/**
 * env 门控测试的陈旧证据门 — 2026-07-30，因主控连续三次自身失误而立。
 *
 * `*.postgres.test.ts` 与 `*.smoke.test.ts` 只在带上 `TEST_DATABASE_URL` /
 * `TEST_DBOS_SYSTEM_DATABASE_URL` 时才真的执行；不带就 **skip**。而 skip 混在
 * 「0 fail」里，读起来和通过一模一样。三次实证都是同一形态：
 *
 *   - `aec25cdc` 的 due-delivery 扫描器自落地起就红，从未在真库上绿过；
 *   - `da5ac8f0`（#252）引入的 SupplyRequestFreeze 契约让 entitlement 与
 *     usage-ledger 四条红，合入时不可见；
 *   - `#250` 带进两条时区脆弱的交互测试，合入时不可见。
 *
 * 前两条是主控自己合入的。文字纪律（「合入前记得跑 opt-in 测试」）已经被证伪
 * 三次——因为**跳过是静默的**，而人只会注意到响声。
 *
 * 这道门不跑测试（跑不动：要库、要几分钟、要串行锁）。它拦的是那个具体动作：
 * **你改了某个目录的代码，而那个目录有 opt-in 测试，你却没有重新验证它。**
 *
 * 判据是「相对自身基线是否变陈旧」，不是「有没有跑过」。理由是刻意的：把 63 个
 * 套件一律按「未验证＝红」处理，会让 main 立刻全红、堵死一切合入，而我最后一定
 * 会去关掉这道门——那正是要避免的结局。一道被关掉的门比没有门更糟，因为它还给人
 * 虚假的安心。所以未验证的套件如实记为 `unverified` 并钉住当时的 SHA：不打扰
 * 无关工作，但**一旦有人动了那个目录就必须给出结论**。
 *
 * 证据文件本身不在任何被监视的目录里，所以更新证据不会自我触发。
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  repositoryInventory,
  resolveCatalogEntries,
} from '../ci/journey-ownership-catalog.mjs';

export const EVIDENCE_PATH = 'docs/ops/opt-in-test-evidence.json';
export const CATALOG_PATH = 'scripts/ci/journey-ownership-catalog.json';
const SUITE_PATTERN = /\.(postgres|smoke)\.test\.(ts|mts)$/u;
const ACTION_BY_DECISION = Object.freeze({
  blocking: 'real-rerun',
  advisory: 'advisory',
  instrument: 'instrument',
  retired: 'retired',
  superseded: 'retired',
});

export function suiteDirectory(path) {
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * 一个套件是否需要重新验证。返回 null 表示通过，否则返回该失败的人类可读理由。
 *
 * `touchedSince` 由调用方注入，便于纯函数测试，也便于把 git 调用集中在一处。
 */
export function staleSuiteReason(path, record, touchedSince) {
  if (!record) {
    return `${path} is a new opt-in suite with no recorded evidence. Run it against a fresh database and record the result in ${EVIDENCE_PATH}.`;
  }
  if (record.status === 'known_red' && !record.ticket) {
    return `${path} is recorded red without a ticket. A red nobody owns is indistinguishable from a red nobody noticed.`;
  }
  if (!record.verifiedAt) {
    return `${path} has evidence without a verifiedAt commit, so nothing pins when it was last true.`;
  }
  const touched = touchedSince(record.verifiedAt, suiteDirectory(path));
  if (touched.length > 0) {
    return `${path} was last verified at ${record.verifiedAt.slice(0, 8)} (${record.status}), and ${suiteDirectory(path)} has changed ${touched.length} time(s) since. Re-run it against a fresh database — provision first — and update ${EVIDENCE_PATH}.`;
  }
  return null;
}

export function collectStaleReasons(suitePaths, evidence, touchedSince) {
  return suitePaths
    .map((path) => staleSuiteReason(path, evidence.suites?.[path], touchedSince))
    .filter((reason) => reason !== null);
}

/**
 * The evidence ledger answers whether a suite's proof is stale. The ownership
 * catalog answers whether that stale proof blocks a merge, is advisory
 * telemetry, or belongs to a retired surface. Keeping both facts in one
 * machine-readable record prevents two dangerous shortcuts:
 *
 * - an advisory run cannot be mistaken for a release verdict; and
 * - an entry marked `blocking` cannot keep a known-red result merely because
 *   no source file changed since it was recorded.
 */
export function classifiedStaleSuites(
  suitePaths,
  evidence,
  catalog,
  touchedSince
) {
  const entriesByPath = new Map(
    resolveCatalogEntries(catalog).map((entry) => [entry.path, entry])
  );
  return suitePaths
    .map((suitePath) => {
      const record = evidence.suites?.[suitePath];
      const entry = entriesByPath.get(suitePath);
      const reason = staleSuiteReason(suitePath, record, touchedSince);
      const catalogReason = catalogEvidenceReason(suitePath, record, entry);
      if (!reason && !catalogReason) return null;
      const decision = entry?.currentDecision ?? 'unowned';
      const action = ACTION_BY_DECISION[decision] ?? 'unowned';
      return {
        path: suitePath,
        action,
        blocksMerge: decision === 'blocking' || action === 'unowned',
        decision,
        owner: entry?.owner ?? null,
        ticket: entry?.ticket ?? record?.ticket ?? null,
        tier: entry?.tier ?? null,
        env: entry?.env ?? null,
        reason: catalogReason ?? reason,
      };
    })
    .filter(Boolean);
}

export function buildEvidenceGuardReport({
  catalog,
  evidence,
  receiptIssues = [],
  stale,
  suitePaths,
}) {
  const trackedSuites = new Set(suitePaths);
  const retiredSuites = Object.entries(evidence.retiredSuites ?? {})
    .map(([path, record]) => ({ path, ...record }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const ledgerIssues = evidenceLedgerIssues({
    evidence,
    retiredSuites,
    trackedSuites,
  });
  const summary = {
    blocking: stale.filter(({ decision }) => decision === 'blocking').length,
    advisory: stale.filter(({ decision }) => decision === 'advisory').length,
    instrument: stale.filter(({ decision }) => decision === 'instrument')
      .length,
    retired: retiredSuites.length,
    unowned: stale.filter(({ action }) => action === 'unowned').length,
  };
  return {
    schemaVersion: 'opt-in-evidence-guard/v2',
    catalog: catalog?.schemaVersion ?? null,
    stale,
    retired: retiredSuites,
    ledgerIssues,
    receiptIssues,
    summary,
    blocksMerge:
      stale.some(({ blocksMerge }) => blocksMerge) ||
      ledgerIssues.length > 0 ||
      receiptIssues.length > 0,
  };
}

export function buildPersistenceCalibrationSelections(stale) {
  const groups = new Map();
  for (const record of stale) {
    if (!['blocking', 'advisory', 'instrument'].includes(record.decision))
      continue;
    const paths = groups.get(record.decision) ?? [];
    paths.push(record.path);
    groups.set(record.decision, paths);
  }
  return ['blocking', 'advisory', 'instrument']
    .flatMap((decision) => {
      const paths = groups.get(decision);
      return paths
        ? [{ decision, paths: [...new Set(paths)].sort() }]
        : [];
    });
}

export async function writePersistenceCalibrationSelections({
  directory,
  commitSha,
  selections,
}) {
  if (!/^[a-f0-9]{40}$/u.test(commitSha)) {
    throw new Error('Calibration selections require a 40-character commit SHA.');
  }
  await mkdir(directory, { recursive: true });
  await Promise.all(
    selections.map(async ({ decision, paths }) => {
      const output = {
        schemaVersion: 'persistence-selection/v1',
        commitSha,
        decision,
        paths,
      };
      await writeFile(
        path.join(directory, `${decision}.json`),
        `${JSON.stringify(output, null, 2)}\n`
      );
    })
  );
}

function catalogEvidenceReason(suitePath, record, entry) {
  if (!entry) {
    return `${suitePath} is an active opt-in suite without a journey ownership catalog entry.`;
  }
  if (entry.kind !== 'persistence') {
    return `${suitePath} is an opt-in suite but its catalog kind is ${entry.kind}.`;
  }
  if (entry.currentDecision === 'blocking' && record?.status === 'known_red') {
    return `${suitePath} is cataloged blocking but its evidence is known_red. Fix it or explicitly move it to an owned advisory/instrument decision before it can contribute to a release verdict.`;
  }
  if (entry.currentDecision === 'blocking' && record?.status === 'unverified') {
    return `${suitePath} is cataloged blocking but has only unverified evidence. Run it against a fresh database before it can contribute to a release verdict.`;
  }
  return null;
}

function evidenceLedgerIssues({ evidence, retiredSuites, trackedSuites }) {
  const retiredByPath = new Map(retiredSuites.map((record) => [record.path, record]));
  const issues = [];
  for (const suitePath of Object.keys(evidence.suites ?? {}).sort()) {
    if (trackedSuites.has(suitePath)) continue;
    if (!retiredByPath.has(suitePath)) {
      issues.push({
        path: suitePath,
        reason: `${suitePath} has active evidence but is no longer tracked and has no retirement record.`,
      });
    }
  }
  for (const retired of retiredSuites) {
    if (trackedSuites.has(retired.path)) {
      issues.push({
        path: retired.path,
        reason: `${retired.path} is marked retired but is still a tracked opt-in suite.`,
      });
    }
    if (!['retired', 'superseded'].includes(retired.disposition)) {
      issues.push({
        path: retired.path,
        reason: `${retired.path} retirement disposition must be retired or superseded.`,
      });
    }
    if (!/^[a-f0-9]{40}$/u.test(retired.decisionCommit ?? '')) {
      issues.push({
        path: retired.path,
        reason: `${retired.path} retirement record requires its 40-character decision commit.`,
      });
    }
    if (typeof retired.reason !== 'string' || retired.reason.length === 0) {
      issues.push({
        path: retired.path,
        reason: `${retired.path} retirement record requires a reason.`,
      });
    }
  }
  return issues;
}

export function receiptEvidenceIssue(suitePath, record, receipt) {
  if (!record?.receipt) return null;
  if (receipt?.schemaVersion !== 'opt-in-persistence-calibration/v1') {
    return `${suitePath} receipt has an unsupported schema.`;
  }
  if (receipt.commitSha !== record.verifiedAt) {
    return `${suitePath} receipt commit SHA does not match verifiedAt.`;
  }
  const file = receipt.files?.find((entry) => entry?.path === suitePath);
  if (!file) return `${suitePath} receipt does not contain this suite.`;
  const counts = file.counts ?? {};
  if (
    !Number.isInteger(counts.pass) ||
    counts.pass <= 0 ||
    counts.fail !== 0 ||
    counts.skip !== 0 ||
    file.verdict !== 'pass' ||
    typeof file.artifact?.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(file.artifact.sha256)
  ) {
    return `${suitePath} receipt does not prove a passing non-skipped file result.`;
  }
  return null;
}

function receiptLedgerIssues(cwd, evidence, suitePaths) {
  const issues = [];
  const cache = new Map();
  const activeSuites = new Set(suitePaths);
  for (const [suitePath, record] of Object.entries(evidence.suites ?? {})) {
    if (!activeSuites.has(suitePath) || !record?.receipt) continue;
    const receiptPath = path.resolve(cwd, record.receipt);
    const relative = path.relative(cwd, receiptPath);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      issues.push({
        path: suitePath,
        reason: `${suitePath} receipt path escapes the repository.`,
      });
      continue;
    }
    let receipt = cache.get(receiptPath);
    if (receipt === undefined) {
      try {
        receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      } catch {
        receipt = null;
      }
      cache.set(receiptPath, receipt);
    }
    const reason = receiptEvidenceIssue(suitePath, record, receipt);
    if (reason) issues.push({ path: suitePath, reason });
  }
  return issues;
}

function trackedSuitePaths(cwd) {
  const inventory = repositoryInventory(cwd);
  return [
    ...new Set([
      ...inventory.persistence,
      ...inventory.unregisteredPersistence,
      ...execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
        .split('\n')
        .filter((file) => SUITE_PATTERN.test(file)),
    ]),
  ].sort();
}

function readOptions(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (!['--catalog', '--evidence', '--output', '--selection-dir'].includes(name)) {
      throw new Error(
        'Usage: node scripts/uiux/opt-in-test-evidence-guard.mjs [--catalog path] [--evidence path] [--output report.json] [--selection-dir directory]'
      );
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a path.`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function writeHumanReport(report) {
  for (const record of report.stale) {
    const ownership = [
      `decision=${record.decision}`,
      `action=${record.action}`,
      record.owner ? `owner=${record.owner}` : null,
      record.ticket ? `ticket=${record.ticket}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    process.stdout.write(`STALE [${ownership}]: ${record.reason}\n`);
  }
  for (const issue of report.ledgerIssues) {
    process.stdout.write(`LEDGER: ${issue.reason}\n`);
  }
  for (const issue of report.receiptIssues) {
    process.stdout.write(`RECEIPT: ${issue.reason}\n`);
  }
  if (report.retired.length > 0) {
    process.stdout.write(
      `RETIRED: ${report.retired.length} documented historical opt-in suite(s) are excluded from the active inventory.\n`
    );
  }
  process.stdout.write(
    `\nEvidence actions: ${report.summary.blocking} blocking rerun, ${report.summary.advisory} advisory, ${report.summary.instrument} instrument, ${report.summary.unowned} unowned.\n`
  );
}

function gitTouchedSince(cwd) {
  return (sha, directory) => {
    try {
      return execFileSync(
        'git',
        ['log', '--format=%H', `${sha}..HEAD`, '--', directory],
        { cwd, encoding: 'utf8' }
      )
        .split('\n')
        .filter((line) => line.length > 0);
    } catch {
      // An unreachable baseline is itself a reason to re-verify: the commit it
      // named is no longer in history, so the evidence points at nothing.
      return ['<unreachable baseline>'];
    }
  };
}

export async function main(cwd = process.cwd(), arguments_ = process.argv.slice(2)) {
  const options = readOptions(arguments_);
  const evidencePath = path.resolve(cwd, options['--evidence'] ?? EVIDENCE_PATH);
  const catalogPath = path.resolve(cwd, options['--catalog'] ?? CATALOG_PATH);
  const [evidenceText, catalogText] = await Promise.all([
    readFile(evidencePath, 'utf8'),
    readFile(catalogPath, 'utf8'),
  ]);
  const evidence = JSON.parse(evidenceText);
  const catalog = JSON.parse(catalogText);
  const suitePaths = trackedSuitePaths(cwd);
  const stale = classifiedStaleSuites(
    suitePaths,
    evidence,
    catalog,
    gitTouchedSince(cwd)
  );
  const report = buildEvidenceGuardReport({
    catalog,
    evidence,
    receiptIssues: receiptLedgerIssues(cwd, evidence, suitePaths),
    stale,
    suitePaths,
  });
  if (options['--output']) {
    await writeFile(
      path.resolve(cwd, options['--output']),
      `${JSON.stringify(report, null, 2)}\n`
    );
  }
  if (options['--selection-dir']) {
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    await writePersistenceCalibrationSelections({
      directory: path.resolve(cwd, options['--selection-dir']),
      commitSha,
      selections: buildPersistenceCalibrationSelections(stale),
    });
  }
  if (
    report.stale.length === 0 &&
    report.ledgerIssues.length === 0 &&
    report.receiptIssues.length === 0
  ) {
    process.stdout.write(
      'OK: every active env-gated suite has evidence newer than its own directory.\n'
    );
    return 0;
  }
  writeHumanReport(report);
  return report.blocksMerge ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
