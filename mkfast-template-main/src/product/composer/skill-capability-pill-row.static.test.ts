/**
 * Spec E / #380 — static gates for capability pills.
 * No independent skill market/route; zero persistence; draft-only selection.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), 'utf8');

test('capability pills reuse recipe pill family — confirm-style button, no form', () => {
  const row = read('./skill-capability-pill-row.tsx');
  assert.match(row, /min-h-12 min-w-12/u);
  assert.match(row, /rounded-full/u);
  assert.match(row, /aria-pressed/u);
  assert.match(row, /type="button"/u);
  // No configuration form / market shell
  assert.doesNotMatch(row, /<form\b/u);
  assert.doesNotMatch(row, /skill-market|SkillMarket|skill marketplace/iu);
  // Engineering identity stays off the DOM surface
  assert.doesNotMatch(row, /data-skill-revision/u);
  assert.doesNotMatch(row, /data-revision-ref/u);
  assert.doesNotMatch(row, /providerId|nativeSkillId|contentHash/u);
});

test('selection lives only on Composer draft — no localStorage / workspace default', () => {
  const selection = read('./skill-capability-selection.ts');
  const row = read('./skill-capability-pill-row.tsx');
  const panel = read('./recipe-cards-panel.tsx');
  const home = read('./composer-home.tsx');
  const combined = `${selection}\n${row}\n${panel}\n${home}`;

  assert.doesNotMatch(selection, /localStorage|sessionStorage/u);
  assert.doesNotMatch(row, /localStorage|sessionStorage/u);
  // Draft field is the sole producer; submission freezes it
  assert.match(selection, /userSelectedSkillRefsForSubmission/u);
  assert.match(read('./lens-state-machine.ts'), /selectedSkillRevisionRefs/u);
  assert.match(read('./use-composer-run.ts'), /userSelectedSkillRefs/u);
  // No workspace-default skill selection writer
  assert.doesNotMatch(
    combined,
    /workspaceDefaultSkill|defaultSelectedSkill|rememberSkillSelection/u
  );
});

test('no new merchant Skill market or Skill catalog route under dashboard', () => {
  const routesRoot = join(here, '../../routes/dashboard');
  const names = readdirSync(routesRoot, { withFileTypes: true }).flatMap(
    (entry) => {
      if (entry.isDirectory()) return [entry.name];
      return [entry.name];
    }
  );
  // Admin skills stay under /admin; merchant surface must not grow a market.
  for (const name of names) {
    assert.doesNotMatch(
      name,
      /^skills?(\.|$|[-_])/iu,
      `unexpected merchant skill route entry: ${name}`
    );
  }

  const sidebar = read('../../config/sidebar-config.ts');
  // Merchant nav must not grow a skill market entry (admin skills are fine).
  assert.doesNotMatch(
    sidebar,
    /id:\s*['"]skill-market['"]|id:\s*['"]merchant-skills['"]/u
  );
});

test('capability packs hang on the recipe catalog host only', () => {
  const panel = read('./recipe-cards-panel.tsx');
  const home = read('./composer-home.tsx');
  assert.match(panel, /SkillCapabilityPillRow/u);
  assert.match(home, /skillCapabilityItems/u);
  assert.match(home, /merchant_skill_projection/u);
});
