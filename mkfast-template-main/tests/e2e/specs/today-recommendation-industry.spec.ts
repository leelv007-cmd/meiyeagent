import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore, seedStoreIndustry } from '../fixtures/product';
import {
  clickComposerDeliveryCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

/**
 * D-174 / #342 — the industry layer of 「为什么适合现在」 comes from the store
 * profile.
 *
 * This is #330 AC3 restated. The original journey (answer the industry
 * question card, read the answer back off the task) was proven unreachable end
 * to end: no merchant-writable fact could answer that question, so the gap was
 * always auto-continued, and an answer given in-flight was never persisted
 * anywhere the recommendation could read it. D-174 moved the source to the
 * profile, where the copy's own claim ("结合本店…") already pointed.
 *
 * Long by nature — it runs one real generation. Deliberately its own file: it
 * asserts one product contract rather than the D-126 home mount, and it is not
 * part of the production-journey required set.
 */
test.describe('D-174 today-recommendation industry layer', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a stated industry gives the hot recommendation its industry whyNow', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    // Stated before the run: the industry is part of the store the delivery is
    // grounded in, and a fact written afterwards would (correctly) mark the
    // delivered recommendation stale rather than relabel it.
    await seedStoreIndustry(page, '美发');

    await page.goto('/dashboard');
    // Lens first — capsule interaction resets the intent box.
    await selectComposerLens(page, 'copy');
    await page
      .getByTestId('composer-intent-input')
      .fill('写一条发朋友圈提醒老客到店的短文案');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });

    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await page.getByTestId('composer-submit').click();
    const briefConfirm = page.getByTestId('composer-brief-confirm');
    await Promise.race([
      briefConfirm
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(() => briefConfirm.click()),
      submission,
    ]).catch(() => undefined);
    const response = await submission;
    const body = (await response.json()) as {
      data?: { work?: { id?: string } };
      error?: { message?: string };
    };
    expect(
      response.ok(),
      body.error?.message ?? 'industry journey submission failed'
    ).toBeTruthy();
    expect(
      body.data?.work?.id,
      'the journey must create a real work'
    ).toBeTruthy();

    const deliveryCard = page.getByTestId('composer-delivery-card');
    await expect(deliveryCard).toBeVisible({ timeout: 300_000 });
    await clickComposerDeliveryCard(deliveryCard);

    // 美发 resolves to the published hair_care slug through the read-time alias
    // table, so the industry layer answers with its configured copy.
    const industryWhyNow = '结合本店护发与头皮护理，今天适合把主推项目讲清楚。';

    // The daily recommendation is produced by the due-delivery pipeline rather
    // than on demand: reading the endpoint enqueues today's due, a worker
    // delivers it, and only then does the projection carry a recommendation.
    // Poll it for readiness — and assert the industry copy here too, so a
    // regression that merely reorders the whyNow layers fails on the
    // projection instead of hiding behind a rendering assertion.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch(
              '/api/core/p1/harness/recommendation',
              { credentials: 'same-origin' }
            );
            const envelope = (await response.json()) as {
              data?: { recommendation?: { whyNow?: string } | null };
            };
            return envelope.data?.recommendation?.whyNow ?? null;
          }),
        { timeout: 300_000 }
      )
      .toBe(industryWhyNow);

    await page.goto('/dashboard');
    const card = page.getByTestId('today-recommendation');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-recommendation-state', 'current', {
      timeout: 60_000,
    });

    // D2: the highlight chip expands into the three-element mini card.
    const todayChip = card.getByTestId('suggestion-chip-today');
    await expect(todayChip).toHaveAttribute('data-highlight', 'true');
    await todayChip.click();
    await expect(
      card.getByTestId('today-recommendation-mini-card')
    ).toBeVisible();
    await expect(card.getByText('为什么适合现在')).toBeVisible();

    await expect(card.getByText(industryWhyNow)).toBeVisible();

    // Exclusive: these are what the merchant reads instead when the industry
    // layer misses, so their absence is half the claim. The generic delivery
    // line is last because that is what this journey actually fell back to
    // before D-174 — with no industry, no configured layer answered at all.
    for (const fallbackWhyNow of [
      '今天适合先用一篇实用内容让顾客了解本店项目。',
      '新的一周适合把本店主推项目重新介绍给顾客。',
      '周末前适合提醒顾客安排下一次到店。',
      '这版先按你这次的要求整理，已经准备好直接使用。',
    ]) {
      await expect(card.getByText(fallbackWhyNow)).toHaveCount(0);
    }
  });
});
