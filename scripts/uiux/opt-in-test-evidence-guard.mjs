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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EVIDENCE_PATH = 'docs/ops/opt-in-test-evidence.json';
const SUITE_PATTERN = /\.(postgres|smoke)\.test\.(ts|mts)$/u;

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

function trackedSuitePaths(cwd) {
  return execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((path) => SUITE_PATTERN.test(path))
    .sort();
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

export function main(cwd = process.cwd()) {
  const evidence = JSON.parse(readFileSync(`${cwd}/${EVIDENCE_PATH}`, 'utf8'));
  const reasons = collectStaleReasons(
    trackedSuitePaths(cwd),
    evidence,
    gitTouchedSince(cwd)
  );
  if (reasons.length === 0) {
    process.stdout.write(
      'OK: every env-gated suite has evidence newer than its own directory.\n'
    );
    return 0;
  }
  for (const reason of reasons) {
    process.stdout.write(`STALE: ${reason}\n`);
  }
  process.stdout.write(
    `\n${reasons.length} env-gated suite(s) need a real run. These skip silently without a database, so "0 fail" does not cover them.\n`
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
