import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');
const P1_ROOT = join(repositoryRoot, 'apps/core/src/p1');
const WEB_ROOT = join(repositoryRoot, 'mkfast-template-main/src');

/**
 * Which Core actions no merchant surface names.
 *
 * ADR-0019 §1 already forbids a pure-substrate ticket without a declared
 * consumer whose acceptance covers it. That rule had no machine check, and the
 * 2026-08-16 architecture review found the result: whole clusters of backend
 * capability with nothing in front of them — every goal-proactive action, the
 * three product-billing read surfaces, result-delivery's assisted close-out,
 * the six-stage Recipe Studio governance chain, recurring scheduling. This is
 * that check.
 *
 * WHAT THIS MEASURES, EXACTLY: the action appears as a `case '<name>':` label
 * in a module's foundation-module.ts, and the literal `'<name>'` (or
 * `"<name>"`) appears nowhere in mkfast-template-main/src outside tests.
 *
 * WHAT IT DOES NOT PROVE: that the capability is unreachable. A caller that
 * builds the action name from a variable or a template is invisible to a
 * literal scan — the review hit exactly that with
 * `/v1/workspaces/:id/bootstrap`, which scans to zero references and is
 * assembled at workspace-provisioning.ts:487. So an entry here is a strong
 * hint, not a verdict, and nothing should be deleted on its strength alone.
 *
 * The value runs the other way: a NEW entry means someone shipped backend
 * capability with no surface naming it, and has to either wire one or write
 * down why not. That is the ADR's rule, enforced.
 */

/** Frozen by D-170. Retired for writes; see canvas-generation-retirement.test.ts. */
const RETIRED = [
  'canvas_generation_cancel',
  'canvas_generation_catalog',
  'canvas_generation_job',
  'canvas_generation_jobs',
  'canvas_generation_quote',
  'canvas_generation_retry',
  'canvas_generation_submit',
];

/**
 * Bypassed on purpose, not forgotten: the store-intake wizard goes through
 * asset-memory instead, and store-intake-wizard.interaction.test.tsx:397,801
 * asserts `.not.toContain('store_workflow_capture_start')` to keep it that way.
 * Core still carries the maintenance cost, which is worth knowing.
 */
const BYPASSED_BY_DESIGN = [
  'store_workflow_capture_answer',
  'store_workflow_capture_confirm',
  'store_workflow_capture_get',
  'store_workflow_capture_reject',
  'store_workflow_capture_start',
  'store_workflow_catalog',
];

/**
 * Everything else with no merchant surface naming it, as measured on
 * 2026-08-17. Deliberately NOT sorted into "ops-only" and "product gap" — that
 * split needs per-action product knowledge, and guessing it here would dress
 * up an inventory as a judgement. Some are plainly backend
 * (content_package_migration_* is a CLI cutover chain); others are plainly
 * missing surfaces (every goal-proactive action, so a merchant can neither
 * create a goal nor see progress). Reading this list is the point.
 */
const NO_FRONTEND_REFERENCE = [
  'adopt_into_content_package',
  'admin_supply_pending_actions',
  'admin_supply_reconcile_pending',
  'assisted_get',
  'assisted_mark_pending',
  'assisted_pending_confirm',
  'attempt_publish_from_handoff',
  'cancel_generation',
  'catalog_create_safe_draft',
  'catalog_discover_draft',
  'confirm_goal_proposal',
  'content_package_delivery_timeline',
  'content_package_migration_activate',
  'content_package_migration_backfill',
  'content_package_migration_dry_run',
  'content_package_migration_freeze',
  'content_package_migration_inspect',
  'content_package_migration_report',
  'content_package_migration_rollback',
  'content_package_migration_status',
  'create_thread',
  'delivery_prepare_package',
  'get_goal_progress',
  'get_primary_goal',
  'get_quote',
  'get_quote_by_task',
  'get_thread',
  'get_usage',
  'lens_list',
  'list_goals',
  'list_proactive_suggestions',
  'metrics',
  // V31-105 §3: the composer no longer opens a `legacy-work:<id>` thread to
  // steer (it was never the bound thread). Core keeps the action for the
  // Workbench thread-root journey; no merchant surface names it now.
  'open_legacy_work_thread',
  'propose_attach_works',
  'propose_create_goal',
  'propose_status_transition',
  'publish_feishu_tool',
  'quality_evaluation',
  'recent_list',
  'recipe_browser',
  'reconcile_cancelled_provider_terminal',
  'record_quality',
  'schedule_recurring',
  'session_freeze',
  'session_get',
  'strict_byok_options',
  'submit_generation',
  'submit_strict_byok',
  'sync_feishu_tools',
  'unschedule_recurring',
];

const EXPECTED_UNREFERENCED = [
  ...RETIRED,
  ...BYPASSED_BY_DESIGN,
  ...NO_FRONTEND_REFERENCE,
].sort();

function moduleActions(): string[] {
  const actions = new Set<string>();
  for (const entry of readdirSync(P1_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const module = join(P1_ROOT, entry.name, 'foundation-module.ts');
    if (!existsSync(module)) continue;
    const source = readFileSync(module, 'utf8');
    for (const match of source.matchAll(/case '([a-z][a-z0-9_]{2,})':/gu)) {
      const action = match[1];
      if (action) actions.add(action);
    }
  }
  return [...actions].sort();
}

function webSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'paraglide' ? [] : webSources(path);
    }
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [readFileSync(path, 'utf8')];
  });
}

test('every Core action is named by a merchant surface, or listed here', () => {
  const actions = moduleActions();
  assert.ok(actions.length > 200, `only found ${actions.length} actions`);
  const web = webSources(WEB_ROOT).join('\n');
  assert.ok(web.length > 0, 'no web sources were scanned');

  const unreferenced = actions
    .filter((action) => !web.includes(`'${action}'`) && !web.includes(`"${action}"`))
    .sort();

  // deepEqual both ways. An action that grows a surface has to leave the list,
  // so the backlog shrinks visibly instead of the list quietly going stale.
  assert.deepEqual(unreferenced, EXPECTED_UNREFERENCED);
});

test('the retired and by-design entries are still declared by Core', () => {
  // Guards against the list outliving the actions it describes: an entry for an
  // action nobody declares any more would make the count above look healthier
  // than it is.
  const actions = new Set(moduleActions());
  for (const action of EXPECTED_UNREFERENCED) {
    assert.ok(actions.has(action), `${action} is listed but no longer declared`);
  }
});
