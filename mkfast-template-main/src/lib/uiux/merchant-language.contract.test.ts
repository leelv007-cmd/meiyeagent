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
