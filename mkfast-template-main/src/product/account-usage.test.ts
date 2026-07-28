import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectAccountUsage } from './account-usage';

test('explains every way reserved usage can be released', () => {
  const messages = Object.fromEntries(
    ['en', 'zh'].map((locale) => [
      locale,
      JSON.parse(
        readFileSync(
          new URL(
            `../../project.inlang/messages/${locale}.json`,
            import.meta.url
          ),
          'utf8'
        )
      ) as { account_usage_terms_explanation: string },
    ])
  );

  assert.equal(
    messages.zh?.account_usage_terms_explanation,
    '可用=还能生成的条数；预留=进行中任务暂扣；已结算=已完成消耗；已释放=失败或已取消任务退回，以及到期未用的预留。'
  );
  assert.equal(
    messages.en?.account_usage_terms_explanation,
    'Available = outputs you can still generate; Reserved = held for work in progress; Settled = completed usage; Released = returned after a failed or cancelled task, or after an unused reservation expires.'
  );
});

test('every usage bucket has its own name in both languages', () => {
  // The panel used to label `audio` with 「视频条数」 because its label lookup
  // was a ternary that fell through, so /settings/account showed 「视频条数」
  // twice with two different balances — 可用 1/总量 1 next to 可用 0/总量 0 —
  // and the shop owner could not tell which one was their real video quota.
  const panel = readFileSync(
    new URL('./account-usage-panel.tsx', import.meta.url),
    'utf8'
  );
  for (const key of ['copy', 'image', 'video', 'audio']) {
    assert.match(
      panel,
      new RegExp(`\\b${key}:\\s*account_usage_\\w+`, 'u'),
      `${key} needs its own label`
    );
  }

  for (const locale of ['en', 'zh']) {
    const messages = JSON.parse(
      readFileSync(
        new URL(
          `../../project.inlang/messages/${locale}.json`,
          import.meta.url
        ),
        'utf8'
      )
    ) as Record<string, string>;
    const labels = ['copy', 'image', 'video', 'audio'].map(
      (resource) => messages[`account_usage_${resource}`]
    );
    assert.equal(labels.filter(Boolean).length, 4, locale);
    assert.equal(new Set(labels).size, 4, `${locale}: duplicate bucket label`);
  }
});

test('projects output usage without collapsing reserved, settled, released, or expiry', () => {
  const rows = projectAccountUsage({
    plan: {
      tier: 'growth',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
    },
    usage: {
      copy: {
        allowance: 20,
        available: 11,
        committed: 7,
        released: 3,
        reserved: 2,
      },
      image: {
        allowance: 10,
        available: 8,
        committed: 2,
        released: 1,
        reserved: 0,
      },
      audio: {
        allowance: 12,
        available: 9,
        committed: 2,
        released: 1,
        reserved: 1,
      },
      video: {
        allowance: 5,
        available: 3,
        committed: 1,
        released: 0,
        reserved: 1,
      },
    },
  });

  assert.deepEqual(rows.summary, {
    expiresAt: '2026-08-01T00:00:00.000Z',
    tier: 'growth',
  });
  assert.deepEqual(rows.resources[0], {
    allowance: 20,
    available: 11,
    released: 3,
    reserved: 2,
    resource: 'copy',
    settled: 7,
  });
  assert.deepEqual(rows.resources[3], {
    allowance: 12,
    available: 9,
    released: 1,
    reserved: 1,
    resource: 'audio',
    settled: 2,
  });
});

test('states that expiry is unavailable instead of inventing a date', () => {
  const rows = projectAccountUsage({
    plan: null,
    usage: {
      copy: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      image: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      audio: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      video: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
    },
  });

  assert.equal(rows.summary.expiresAt, null);
  assert.equal(rows.summary.tier, null);
});
