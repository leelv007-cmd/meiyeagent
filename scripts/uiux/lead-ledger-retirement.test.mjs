import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * D-144 leads CRM 台账退役真删的防复活门。
 *
 * 结果账本唯一写入面 = ContentPackage `resultSignals`。线索台账（两页 + 详情页
 * + create_lead/update_lead 命令链 + Lead 契约 + lead.manage 能力 + 台账文案）
 * 已整体真删，本门保证它不会以任何形态被重新引入生产源码。
 */

const PRODUCTION_PREFIXES = [
  'apps/core/src/',
  'mkfast-template-main/src/',
  'packages/contracts/src/',
];

const FORBIDDEN_PRODUCTION_PATTERNS = [
  ['retired lead ledger route', /routes\/dashboard\/leads/u],
  ['retired lead ledger route constant', /\bLeadLedger\b/u],
  ['retired lead create command', /\bcreate_lead\b/u],
  ['retired lead update command', /\bupdate_lead\b/u],
  ['retired lead entity type', /\binterface Lead\b/u],
  ['retired lead status type', /\bLeadStatus\b/u],
  ['retired lead capability', /\blead\.manage\b/u],
  ['retired lead ledger copy', /\bdashboard_lead_/u],
  ['retired lead ledger empty-state copy', /\blead_ledger_/u],
  ['retired lead ledger failure copy', /\bleads_operation_failed/u],
  ['retired lead ledger navigation copy', /\bproduct_navigation_leads\b/u],
  ['retired lead evidence kind copy', /\bobject_evidence_kind_lead\b/u],
  ['retired lead association counter', /\bleadAssociationCount\b/u],
  ['retired canonical lead port', /\bCanonicalLeadContentPackagePort\b/u],
  ['retired canonical lead port option', /\bcanonicalLeadContentPackages\b/u],
  ['retired lead status tone helper', /\bleadStatusToneClassName\b/u],
  ['retired lead relation fact kind', /['"]lead['"]/u],
];

const FORBIDDEN_MESSAGE_KEY_PATTERNS = [
  /^dashboard_lead_/u,
  /^lead_ledger_/u,
  /^leads_operation_failed/u,
  /^product_navigation_leads$/u,
  /^object_evidence_kind_lead$/u,
];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function productionSources() {
  return trackedFiles()
    .filter((path) =>
      PRODUCTION_PREFIXES.some((prefix) => path.startsWith(prefix))
    )
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .filter((path) => !/\.test\.(?:ts|tsx)$/u.test(path))
    .filter((path) => existsSync(path));
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function retiredLeadFindings() {
  return productionSources().flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return FORBIDDEN_PRODUCTION_PATTERNS.flatMap(([reason, pattern]) => {
      const match = pattern.exec(source);
      return match ? [{ line: lineOf(source, match.index), path, reason }] : [];
    });
  });
}

test('D-144 keeps the retired lead ledger out of production sources', () => {
  assert.deepEqual(retiredLeadFindings(), []);
});

test('D-144 leaves no lead ledger route file behind', () => {
  const survivors = trackedFiles().filter((path) =>
    /^mkfast-template-main\/src\/routes\/.*leads?(?:_|\.|\/)/u.test(path)
  );
  assert.deepEqual(survivors, []);
});

test('D-144 leaves no lead ledger copy behind', () => {
  const locales = trackedFiles().filter((path) =>
    /^mkfast-template-main\/project\.inlang\/messages\/[a-z-]+\.json$/u.test(
      path
    )
  );
  assert.ok(locales.length > 0, 'locale message catalogues must be findable');
  const survivors = locales.flatMap((path) =>
    Object.keys(JSON.parse(readFileSync(path, 'utf8')))
      .filter((key) =>
        FORBIDDEN_MESSAGE_KEY_PATTERNS.some((pattern) => pattern.test(key))
      )
      .map((key) => `${path}:${key}`)
  );
  assert.deepEqual(survivors, []);
});
