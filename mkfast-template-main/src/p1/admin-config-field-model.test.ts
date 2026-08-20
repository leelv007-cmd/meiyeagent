import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  adminConfigFieldId,
  buildAdminConfigFields,
  defaultAdminConfigValue,
  flattenFields,
  readFieldValue,
  writeFieldValue,
} from '@/p1/admin-config-field-model';
import {
  ADMIN_CONFIG_KEYS,
  parseAdminConfigValue,
} from '@/p1/admin-config-view-model';

/** 后台能改的每个配置项都必须有表单件，一个都不许退回手敲文本。 */
test('every admin config key maps onto typed form fields', () => {
  assert.equal(ADMIN_CONFIG_KEYS.length, 22);
  for (const key of ADMIN_CONFIG_KEYS) {
    const fields = buildAdminConfigFields(key);
    assert.ok(fields.length > 0, `${key} produced no fields`);
    for (const field of flattenFields(fields)) {
      assert.notEqual(
        field.kind,
        'unsupported',
        `${key} fell back to a non-editable shape at ${field.path.join('.')}`
      );
    }
  }
});

test('confirmation hold timeout is editable only inside the safe operating range', () => {
  const [field] = buildAdminConfigFields(
    'harness.confirmation_card.hold_timeout_seconds'
  );
  assert.equal(field.kind, 'number');
  assert.equal(field.kind === 'number' && field.control, 'stepper');
  assert.equal(field.kind === 'number' && field.min, 3_600);
  assert.equal(field.kind === 'number' && field.max, 172_800);
  assert.equal(
    parseAdminConfigValue(
      'harness.confirmation_card.hold_timeout_seconds',
      3_600
    ),
    3_600
  );
  assert.throws(() =>
    parseAdminConfigValue(
      'harness.confirmation_card.hold_timeout_seconds',
      3_599
    )
  );
});

/** 标签必须是运营看得懂的说法，不是把契约里的字段名原样搬上来（D-116）。 */
test('every field label is a registered human label, never a raw schema name', () => {
  for (const key of ADMIN_CONFIG_KEYS) {
    for (const field of flattenFields(buildAdminConfigFields(key))) {
      const segment = field.path.at(-1);
      assert.ok(field.label.trim().length > 0, `${key} has an empty label`);
      if (typeof segment === 'string') {
        assert.notEqual(
          field.label,
          segment,
          `${key}.${segment} still shows its schema name`
        );
      }
    }
  }
});

test('booleans become switches and short strings become single-line text', () => {
  const [watermark] = buildAdminConfigFields('compliance.watermark.default');
  assert.equal(watermark.kind, 'boolean');
  assert.equal(watermark.path.length, 0);

  const [copyModel] = buildAdminConfigFields('platform.defaultModel.copy');
  assert.equal(copyModel.kind, 'text');
  assert.equal(copyModel.kind === 'text' && copyModel.multiline, false);
  assert.equal(copyModel.kind === 'text' && copyModel.maxLength, 200);
});

test('plan credits expose period credits and non-billing capacity dials', () => {
  const fields = buildAdminConfigFields('plan.credits.trial');
  const byName = new Map(fields.map((field) => [field.path.at(-1), field]));

  const credits = byName.get('credits');
  assert.equal(credits?.kind, 'number');
  assert.equal(credits?.kind === 'number' && credits.control, 'stepper');

  const concurrency = byName.get('concurrencyLimit');
  assert.equal(concurrency?.kind === 'number' && concurrency.control, 'slider');
  const priority = byName.get('queuePriority');
  assert.equal(priority?.kind === 'number' && priority.control, 'slider');

  const support = byName.get('supportLabel');
  assert.equal(support?.kind, 'enum');
  assert.deepEqual(
    support?.kind === 'enum' && support.options.map((option) => option.value),
    ['standard', 'priority']
  );

  // Retired bucket container must not reappear on credit keys.
  assert.equal(
    fields.some((field) => field.path.at(-1) === 'allowance'),
    false
  );
  assert.equal(buildAdminConfigFields('plan.allowances.trial').length, 0);
});

test('credit add-on offers render as an editable grid with real bounds', () => {
  const [addons] = buildAdminConfigFields('plan.credits.addons');
  assert.equal(addons.kind, 'list');
  if (addons.kind !== 'list') return;
  assert.equal(addons.layout, 'grid');
  assert.equal(addons.maxItems, 100);
  assert.deepEqual(
    addons.itemFields.map((field) => field.path.at(-1)),
    ['amountMicros', 'credits', 'currency', 'expireDays', 'id']
  );
  assert.equal(buildAdminConfigFields('plan.addons').length, 0);
});

test('payment mapping reaches the nested list through the object wrapper', () => {
  const fields = buildAdminConfigFields('plan.payment-mapping');
  assert.equal(fields.length, 1);
  const [mappings] = fields;
  assert.equal(mappings.kind, 'list');
  assert.equal(mappings.kind === 'list' && mappings.layout, 'grid');
  assert.deepEqual(
    mappings.kind === 'list' &&
      mappings.itemFields.map((field) => field.path.at(-1)),
    ['paymentProductId', 'interval', 'tier']
  );
});

test('note styles render as cards with a platform toggle set', () => {
  const fields = buildAdminConfigFields('harness.note.styles');
  assert.equal(fields.length, 1);
  const [styles] = fields;
  assert.equal(styles.kind, 'list');
  if (styles.kind !== 'list') return;
  assert.equal(styles.layout, 'cards');
  assert.equal(styles.minItems, 1);
  assert.equal(styles.maxItems, 6);

  const platforms = styles.itemFields.find(
    (field) => field.path.at(-1) === 'platforms'
  );
  assert.equal(platforms?.kind, 'toggle-set');
  assert.deepEqual(
    platforms?.kind === 'toggle-set' &&
      platforms.options.map((option) => option.value),
    ['xiaohongshu', 'douyin', 'video_account']
  );

  const guide = styles.itemFields.find(
    (field) => field.path.at(-1) === 'writingGuide'
  );
  assert.equal(guide?.kind, 'text');
  assert.equal(guide?.kind === 'text' && guide.multiline, true);

  // 名称和写作要点都没有长度上限，但一个是一行、一个是一段。
  const name = styles.itemFields.find((field) => field.path.at(-1) === 'name');
  assert.equal(name?.kind === 'text' && name.multiline, false);
});

/** 行内字段的 id 必须按行号解析，否则第二行会顶着第一行的 id。 */
test('list rows address their fields by row, not by the template index', () => {
  const [styles] = buildAdminConfigFields('harness.note.styles');
  assert.equal(styles.kind, 'list');
  const first = adminConfigFieldId('harness.note.styles', [
    'styles',
    0,
    'name',
  ]);
  const second = adminConfigFieldId('harness.note.styles', [
    'styles',
    1,
    'name',
  ]);
  assert.equal(first, 'admin-config-harness-note-styles-styles-0-name');
  assert.notEqual(first, second);
});

test('a never-written key still opens on a usable starting value', () => {
  // 风格集合能拿到运行时正在用的那份，运营打开就是现状而不是空表。
  const styles = defaultAdminConfigValue('harness.note.styles') as {
    styles: { name: string }[];
  };
  assert.equal(styles.styles.length, 2);
  assert.equal(styles.styles[0].name, '干货科普版');
  assert.equal(defaultAdminConfigValue('compliance.watermark.default'), false);
  assert.equal(defaultAdminConfigValue('plan.addons'), null);
  assert.equal(defaultAdminConfigValue('plan.trial.enabled'), false);
  assert.deepEqual(defaultAdminConfigValue('plan.credits.starter'), {
    concurrencyLimit: 1,
    credits: 500,
    currency: 'HKD',
    monthlyPriceMicros: 231_183_288,
    queuePriority: 1,
    storageMb: 1_024,
    supportLabel: 'standard',
  });
  assert.deepEqual(defaultAdminConfigValue('plan.credits.cycle_coefficients'), {
    monthly: 9_000,
    single_month: 10_000,
    yearly: 7_500,
  });
});

test('field writes stay immutable and land on the addressed path', () => {
  const before = { styles: [{ name: 'a' }, { name: 'b' }] };
  const after = writeFieldValue(
    before,
    ['styles', 1, 'name'],
    'c'
  ) as typeof before;
  assert.equal(readFieldValue(after, ['styles', 1, 'name']), 'c');
  assert.equal(readFieldValue(before, ['styles', 1, 'name']), 'b');
  assert.notEqual(after.styles, before.styles);
});

/** 表单交上来的结构值走同一份契约，和手敲 JSON 时校验的是同一件事。 */
test('structured values are validated against the same contract', () => {
  assert.equal(
    parseAdminConfigValue('compliance.watermark.default', true),
    true
  );
  assert.throws(() =>
    parseAdminConfigValue('harness.note.styles', { styles: [] })
  );
  assert.throws(() => parseAdminConfigValue('unknown.key', 1));
});
