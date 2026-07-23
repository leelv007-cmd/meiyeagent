import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const messagesDirectory = new URL(
  '../../../project.inlang/messages/',
  import.meta.url
);
const en = JSON.parse(
  readFileSync(new URL('en.json', messagesDirectory), 'utf8')
) as Record<string, string>;
const zh = JSON.parse(
  readFileSync(new URL('zh.json', messagesDirectory), 'utf8')
) as Record<string, string>;

/** Full UUID shape (with optional work_/workspace_/job_ prefix). */
const UUID_LEAK =
  /(?:\b(?:work|workspace|job|asset)_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;

/**
 * Snake_case / machine enums that must never ship as merchant-visible copy.
 * Keep this list mechanical — English prose like "Task is running" is allowed.
 */
const RAW_ENUM_LEAK =
  /\b(?:candidate_ready|needs_input|automatic_verified|cancel_requested|permission_denied|result_ready|provider_failed|acceptance_unknown)\b/u;

/**
 * Internal provider / model routing identifiers. Public brand names
 * (OpenAI, Seedream) may appear; catalog/provider slugs may not.
 */
const PROVIDER_SLUG_LEAK =
  /\b(?:openai\/[a-z0-9._-]+|anthropic\/[a-z0-9._-]+|seedance-2|llm-openai|gpt-image-2|catalogModelId|providerModel|providerJobId|sub2api)\b/iu;

function merchantCopyLeaks(
  messages: Record<string, string>,
  pattern: RegExp
): Array<[string, string]> {
  return Object.entries(messages)
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => [key, value]);
}

test('English merchant copy does not expose canonical object names', () => {
  const exposed = Object.entries(en).filter(
    ([key, value]) =>
      key !== 'home_integration_subtitle' &&
      /\b(?:Asset|Assets|ContentPackage|Job|Jobs|Work|Works)\b/u.test(value)
  );

  assert.deepEqual(exposed, []);

  for (const key of [
    'canonical_content_detail_description',
    'canonical_content_detail_title',
    'canonical_content_loading_description',
    'canonical_content_loading_title',
    'canonical_content_not_found_description',
    'canonical_content_not_found_title',
    'canonical_history_kind_content',
    'creation_assistant_prefix_content',
    'creation_assistant_source_content',
    'creation_catalog_tag_content',
    'creative_object_persisted_result_count',
    'creative_object_result_count',
    'object_evidence_kind_content',
    'p1_admin_model_catalog_retire_change_history',
    'p1_admin_model_rollback_description',
    'p1_filter_related_content',
    'p1_retrieval_scope_content',
  ]) {
    assert.doesNotMatch(en[key] ?? '', /\bContent\b/u, key);
  }
});

test('Chinese admin copy uses merchant language for creation records', () => {
  for (const key of [
    'admin_plan_catalog_description',
    'p1_admin_health_worker_title',
    'p1_admin_template_publish_change_history',
    'p1_admin_template_publish_change_new_work',
    'p1_admin_template_publish_review_description',
    'p1_admin_template_retire_change_work',
  ]) {
    assert.doesNotMatch(zh[key] ?? '', /\b(?:Job|Work)\b/u, key);
  }
});

test('locale copy never embeds UUID or work_/workspace_ id shapes', () => {
  assert.deepEqual(merchantCopyLeaks(zh, UUID_LEAK), []);
  assert.deepEqual(merchantCopyLeaks(en, UUID_LEAK), []);
});

test('locale copy never surfaces raw execution enums as merchant labels', () => {
  assert.deepEqual(merchantCopyLeaks(zh, RAW_ENUM_LEAK), []);
  assert.deepEqual(merchantCopyLeaks(en, RAW_ENUM_LEAK), []);
});

test('locale copy never surfaces provider routing slugs', () => {
  assert.deepEqual(merchantCopyLeaks(zh, PROVIDER_SLUG_LEAK), []);
  assert.deepEqual(merchantCopyLeaks(en, PROVIDER_SLUG_LEAK), []);
});

test('product shell CSS degrades rose-glow under prefers-reduced-motion', () => {
  const styles = readFileSync(
    new URL('../../styles.css', import.meta.url),
    'utf8'
  );
  assert.match(styles, /\.meiye-rose-glow\s*\{[\s\S]*?animation:/u);
  assert.match(
    styles,
    /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\.meiye-rose-glow\s*\{[\s\S]*?animation:\s*none/u
  );
  assert.match(
    styles,
    /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\.meiye-product-shell[\s\S]*?animation-duration:\s*0\.01ms/u
  );
});

test('Z1 removes legacy entries and keeps Composer + Result Center contracts', () => {
  const oldDesktop = new URL(
    '../../product/unified-creation-workbench.tsx',
    import.meta.url
  );
  const oldMobile = new URL(
    '../../product/mobile-action-book.tsx',
    import.meta.url
  );
  assert.equal(existsSync(oldDesktop), false);
  assert.equal(existsSync(oldMobile), false);

  const composer = readFileSync(
    new URL('../../product/composer/composer-home.tsx', import.meta.url),
    'utf8'
  );
  const resultCenter = readFileSync(
    new URL('../../product/results/result-center-page.tsx', import.meta.url),
    'utf8'
  );
  assert.match(composer, /data-testid="composer-home"/u);
  assert.match(resultCenter, /data-testid="result-center-shell"/u);
});
