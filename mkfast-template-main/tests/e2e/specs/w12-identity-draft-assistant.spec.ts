import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { normalizeCatalog } from '../../../src/p1/settings-view-model';
import { productCommand } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
} from '../fixtures/ui-journey';

/**
 * W12② / D-142 — 一句话建人设 → 草案带 unconfirmed 徽标 → 逐项校对保存 →
 * Composer 可选绑 revision.
 *
 * The whole point of the assistant is that it speeds the merchant up without
 * ever answering for them, so this walk asserts the seam twice over: every
 * proposed field wears its origin and a「还没确认」badge, and the wizard refuses
 * to reach the save panel until each of them has been walked past by hand.
 */

const REFERENCE_IMAGE = await readFile(
  new URL('../fixtures/files/w12-brand-reference.png', import.meta.url)
);

/** Visible in the PNG and embedded as the deterministic fixture parse marker. */
const REFERENCE_TEXT = '暖棕色门店，主营头皮护理';

const BACKGROUND = '青禾美业，做头皮护理十年，说话稳、不夸大';
const DISPLAY_NAME = '青禾美业';

const QUESTION = {
  displayName: '希望在内容里怎么称呼这个身份？',
  owner: '这个身份归属于谁？',
  claim: '这个品牌最核心的主张是什么？',
  boundaries: '哪些话或做法绝对不能碰？',
  samples: '给一两句最能代表这个身份的表达样例。',
  sourceRef: '授权证明或内部备注是什么？（可填编号）',
  forbiddenClaims: '有哪些话这个品牌坚决不说？',
  visualPrinciples: '画面希望长期保持什么感觉？',
  seriesAnchors: '有哪些栏目值得长期连续做？',
  platforms: '这个人设可以用在哪些平台？',
  scenes: '这个人设可以用在哪些场景？',
} as const;

function questionRegion(manager: Locator, question: string) {
  return manager.getByRole('region', { name: question });
}

/** Read a proposal, keep the wording, move on. */
async function reviewProposal(
  manager: Locator,
  question: string,
  expectedOrigin: string
) {
  const region = questionRegion(manager, question);
  await expect(region).toBeVisible();
  await expect(region.getByText(expectedOrigin, { exact: true })).toBeVisible();
  await expect(region.getByText('还没确认', { exact: true })).toBeVisible();
  await expect(region.getByRole('textbox', { name: question })).not.toHaveValue(
    ''
  );
  await region.getByRole('button', { name: '继续' }).click();
}

async function answerText(manager: Locator, question: string, value: string) {
  const region = questionRegion(manager, question);
  await expect(region).toBeVisible();
  await region.getByRole('textbox', { name: question }).fill(value);
  await region.getByRole('button', { name: '继续' }).click();
}

async function seedStore(page: Page) {
  await productCommand(page, {
    type: 'confirm_store',
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天私信预约',
      brandVoice: '真实、克制',
      city: '杭州',
      district: '拱墅区',
      name: 'W12 口吻门店',
      prohibitions: ['不虚构价格'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 60,
          id: 'w12-project',
          name: '头皮护理',
          price: 199,
        },
      ],
      regulated: false,
    },
  });
}

test('one line and a reference become a draft the merchant still has to校对', async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    // The reference image rides the same upload channel every merchant asset
    // uses, which needs a workspace to land in.
    await seedStore(page);
    await page.goto('/dashboard/identity');

    // Exact: the save panel and the composer card are both named「…口吻」too,
    // and only the page's own section is called exactly that.
    const manager = page.getByRole('region', { name: '口吻', exact: true });
    await expect(manager).toBeVisible({ timeout: 60_000 });

    // Before a kind is chosen there is nothing for an assistant to draft into.
    await expect(manager.getByTestId('marketing-identity-assist')).toHaveCount(
      0
    );
    await manager.getByRole('button', { name: '品牌', exact: true }).click();

    const assist = manager.getByTestId('marketing-identity-assist');
    await expect(assist).toBeVisible();
    const run = assist.getByRole('button', { name: '让我先起个草稿' });
    // One line is the whole入口 — with nothing said there is nothing to draft.
    await expect(run).toBeDisabled();

    await assist.getByRole('textbox', { name: '一句话背景' }).fill(BACKGROUND);
    await expect(run).toBeEnabled();

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes('/api/core/p1/assets')
    );
    const parseResponses: import('@playwright/test').Response[] = [];
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands') &&
        response.request().postData()?.includes('parse_single_asset') === true
      ) {
        parseResponses.push(response);
      }
    });
    const referenceInput = assist.getByTestId(
      'marketing-identity-assist-reference'
    );
    await expect(referenceInput).toBeEnabled({ timeout: 60_000 });
    await referenceInput.setInputFiles({
      buffer: REFERENCE_IMAGE,
      mimeType: 'image/png',
      name: 'w12-brand-reference.png',
    });
    const uploaded = await uploadResponse;
    expect(uploaded.ok(), `asset upload status ${uploaded.status()}`).toBe(
      true
    );
    const uploadedBody = (await uploaded.json()) as { sourceUrl?: unknown };
    expect(uploadedBody.sourceUrl).toEqual(expect.any(String));
    const referenceResult = assist.getByTestId(
      'marketing-identity-assist-reference-state'
    );
    await expect(
      referenceResult,
      `reference stage: ${await referenceResult.getAttribute('data-error-stage')}`
    ).toHaveText('参考图片已经读过了', { timeout: 90_000 });
    expect(parseResponses).toHaveLength(1);
    expect(parseResponses[0]!.ok(), await parseResponses[0]!.text()).toBe(true);

    await run.click();
    // The draft is announced as not counting for anything yet.
    await expect(
      assist.getByTestId('marketing-identity-assist-applied')
    ).toContainText('都还没算数', { timeout: 90_000 });

    // Four supported proposals are in the draft and not one is an answer, so the
    // save panel is still out of reach.
    await expect(
      manager.getByRole('region', { name: '确认后保存为一个口吻' })
    ).toHaveCount(0);

    // Each field says where it came from before the merchant passes it.
    const displayName = questionRegion(manager, QUESTION.displayName);
    await expect(
      displayName.getByTestId('identity-provenance-displayName')
    ).toHaveText('我猜的');
    await expect(
      displayName.getByTestId('identity-unconfirmed-displayName')
    ).toHaveText('还没确认');
    await expect(
      displayName.getByRole('textbox', { name: QUESTION.displayName })
    ).toHaveValue(DISPLAY_NAME);
    await displayName.getByRole('button', { name: '继续' }).click();

    await answerText(manager, QUESTION.owner, '青禾品牌中心');

    // The claim was read out of the image the merchant handed over, and says so
    // rather than passing itself off as a guess or as their own words.
    const claim = questionRegion(manager, QUESTION.claim);
    await expect(
      claim.getByTestId('identity-provenance-primaryClaimOrRole')
    ).toHaveText('从你传的资料里读到的');
    await expect(
      claim.getByRole('textbox', { name: QUESTION.claim })
    ).toHaveValue(REFERENCE_TEXT);
    await claim.getByRole('button', { name: '继续' }).click();

    // Rewriting a proposal makes it the merchant's line — the badge goes with
    // the wording, not with the field.
    const boundaries = questionRegion(manager, QUESTION.boundaries);
    await expect(
      boundaries.getByTestId('identity-provenance-professionalBoundaries')
    ).toHaveText('我猜的');
    await boundaries
      .getByRole('textbox', { name: QUESTION.boundaries })
      .fill('不做医疗诊断，也不承诺见效时间');
    await expect(
      boundaries.getByTestId('identity-unconfirmed-professionalBoundaries')
    ).toHaveCount(0);
    await boundaries.getByRole('button', { name: '继续' }).click();

    await answerText(manager, QUESTION.samples, '先了解真实情况，再给护理建议');

    // The authorization note is not something the assistant may fill in — it
    // arrives empty, and nothing moves until the merchant writes it.
    const sourceRef = questionRegion(manager, QUESTION.sourceRef);
    await expect(
      sourceRef.getByTestId('identity-provenance-sourceRef')
    ).toHaveCount(0);
    await expect(
      sourceRef.getByRole('textbox', { name: QUESTION.sourceRef })
    ).toHaveValue('');
    await expect(
      sourceRef.getByRole('button', { name: '继续' })
    ).toBeDisabled();
    await sourceRef
      .getByRole('textbox', { name: QUESTION.sourceRef })
      .fill('w12-brand-authorization');
    await sourceRef.getByRole('button', { name: '继续' }).click();

    await reviewProposal(manager, QUESTION.forbiddenClaims, '我猜的');
    await answerText(
      manager,
      QUESTION.visualPrinciples,
      '暖棕色、真实门店光线'
    );
    await answerText(manager, QUESTION.seriesAnchors, '每周头皮护理答疑');

    // W12①: the authorized reach is still asked for. The assistant never
    // reached it, so both scopes arrive untouched.
    const platforms = questionRegion(manager, QUESTION.platforms);
    await expect(
      platforms.getByRole('button', { name: '继续' })
    ).toBeDisabled();
    await platforms.getByRole('button', { name: '小红书' }).click();
    await platforms.getByRole('button', { name: '继续' }).click();

    const scenes = questionRegion(manager, QUESTION.scenes);
    await expect(scenes.getByRole('button', { name: '继续' })).toBeDisabled();
    await scenes.getByRole('button', { name: '品牌人设' }).click();
    await scenes.getByRole('button', { name: '常规营销物料' }).click();
    await scenes.getByRole('button', { name: '继续' }).click();

    const preview = manager.getByRole('region', {
      name: '确认后保存为一个口吻',
    });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(DISPLAY_NAME);
    await expect(preview).toContainText('不做医疗诊断');
    // Nothing unconfirmed can survive to the save panel.
    await expect(preview.getByText('还没确认')).toHaveCount(0);
    const registrationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands') &&
        response
          .request()
          .postData()
          ?.includes('register_marketing_identity') === true
    );
    await preview.getByRole('button', { name: '登记身份' }).click();
    const registrationHttpResponse = await registrationResponse;
    const registrationRequestBody =
      registrationHttpResponse.request().postData() ?? '';
    const registrationCommand = JSON.parse(registrationRequestBody) as {
      payload?: {
        allowedPlatforms?: string[];
        allowedScenes?: string[];
        fieldProvenance?: Record<string, string>;
      };
    };
    expect(registrationCommand.payload).toMatchObject({
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip', 'routine_marketing_materials'],
      fieldProvenance: {
        allowedPlatforms: 'user',
        allowedScenes: 'user',
        portraitAuthorization: 'user',
        sourceRef: 'user',
        voiceAuthorization: 'user',
      },
    });
    const registeredEnvelope = (await registrationHttpResponse.json()) as {
      data?: { identityId?: string; version?: number };
      error?: { code?: string; message?: string };
    };
    expect(
      registrationHttpResponse.ok(),
      `registration request ${registrationRequestBody}; response ${JSON.stringify(registeredEnvelope)}`
    ).toBe(true);
    const registeredIdentity = {
      id: registeredEnvelope.data?.identityId,
      revision: registeredEnvelope.data?.version,
    };
    expect(
      registeredIdentity.id,
      `registration envelope ${JSON.stringify(registeredEnvelope)}`
    ).toBeTruthy();
    expect(registeredIdentity.revision).toBe(1);

    const saved = manager.locator('article').filter({ hasText: DISPLAY_NAME });
    await expect(saved).toHaveCount(1);
    await expect(saved.getByText('生效中', { exact: true })).toBeVisible();
    await saved
      .getByTestId(`identity-provenance-audit-${registeredIdentity.id}`)
      .click();
    await expect(saved).toContainText('displayName: 我猜的');
    await expect(saved).toContainText('brandClaims: 从你传的资料里读到的');

    // D-117 stays intact: creating saved a voice and nothing else, and binding
    // it to a session is its own trip into the conversation.
    await expect(saved.getByText('默认身份')).toHaveCount(0);
    const modelPreference = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'set_user_default',
          module: 'model-supply',
          payload: {
            modelId: 'llm-openai',
            operation: 'copy.generate',
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `w12-copy-model-${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      return { body: await response.text(), ok: response.ok };
    });
    expect(
      modelPreference.ok,
      `copy model preference ${modelPreference.body}`
    ).toBe(true);
    const sessionDecisionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands') &&
        response
          .request()
          .postData()
          ?.includes('select_marketing_identity_for_session') === true
    );
    await saved.getByRole('link', { name: '用这个身份创作（本次）' }).click();
    const sessionDecisionEnvelope = (await (
      await sessionDecisionResponse
    ).json()) as {
      data?: { decisionId?: string; decisionRevision?: number };
    };
    const sessionDecision = {
      id: sessionDecisionEnvelope.data?.decisionId,
      revision: sessionDecisionEnvelope.data?.decisionRevision,
    };
    expect(sessionDecision.id).toBeTruthy();
    expect(sessionDecision.revision).toBeGreaterThan(0);
    // L3-2: the idle bar hides the @ identity capsule behind 「更多」.
    await page.getByTestId('composer-capsule-more').click();
    await expect(page.getByTestId('composer-prompt-capsule')).toHaveAttribute(
      'data-more-expanded',
      'true'
    );
    await page.getByTestId('composer-capsule-mention').click();
    await expect(
      page.getByTestId('composer-capsule-mention-panel')
    ).toBeVisible();
    const identityCard = page.getByTestId('composer-identity-selection');
    await expect(identityCard).toHaveAttribute(
      'data-identity-state',
      'selected',
      { timeout: 120_000 }
    );
    await expect(identityCard).toContainText(
      '这次用你选的口吻，不会改掉你平时的默认。'
    );
    await page.keyboard.press('Escape');
    await expect(
      page.getByTestId('composer-capsule-mention-panel')
    ).toBeHidden();

    // The legacy store profile is not authoritative generation context. Confirm
    // the service and price through the production progressive-fact seam before
    // asking the server for a quote.
    const factCard = page.getByTestId('progressive-fact-card');
    await expect(factCard).toBeVisible({ timeout: 60_000 });
    const factInput = factCard.getByTestId('progressive-fact-input');
    await expect(factInput).toHaveValue('头皮护理');
    await factCard.getByTestId('progressive-fact-continue').click();
    await expect(factInput).toHaveValue('199');
    await factCard.getByTestId('progressive-fact-continue').click();
    await expect(
      factCard.getByTestId('progressive-fact-price-validity')
    ).toBeVisible();
    await factCard
      .getByTestId('progressive-fact-price-validity-long-term')
      .click();
    await factCard.getByTestId('progressive-fact-continue').click();
    const factFinalizationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands') &&
        response.request().postData()?.includes('finalize_store_intake') ===
          true
    );
    await factCard.getByTestId('progressive-fact-confirm').click();
    const factFinalized = await factFinalizationResponse;
    expect(factFinalized.ok(), await factFinalized.text()).toBe(true);
    await expect(factCard).toBeHidden({ timeout: 60_000 });

    const rawCopyCatalog = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'catalog',
          module: 'model-supply',
          payload: { operation: 'copy.generate' },
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: unknown;
      };
      return {
        body: envelope.data,
        error: envelope.error,
        ok: response.ok,
        status: response.status,
      };
    });
    expect(
      rawCopyCatalog.ok,
      `copy catalog response ${JSON.stringify(rawCopyCatalog)}`
    ).toBe(true);
    const copyCatalog = normalizeCatalog(rawCopyCatalog.body, 'copy.generate');
    expect(
      copyCatalog.models.find((model) => model.id === 'llm-openai'),
      `normalized copy catalog ${JSON.stringify(copyCatalog)}`
    ).toMatchObject({
      available: true,
      unitPrice: { amountMicros: expect.any(Number) },
    });

    const submissionRequest = page.waitForRequest(
      (outgoing) =>
        outgoing.method() === 'POST' &&
        outgoing.url().includes('/api/core/p1/composer/submissions')
    );
    const submissionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions')
    );
    const copyContract = JOURNEY_CONTRACTS.find(
      (contract) => contract.modality === 'copy'
    )!;
    await submitComposerJourney(
      page,
      copyContract,
      '为头皮护理写一条真实克制的朋友圈项目介绍'
    );
    expect((await submissionRequest).postDataJSON()).toMatchObject({
      identity: {
        id: registeredIdentity.id,
        revision: String(registeredIdentity.revision),
      },
      identityDecision: sessionDecision,
    });
    const submissionEnvelope = (await (await submissionResponse).json()) as {
      data?: {
        snapshot?: {
          identity?: { id?: string; revision?: string };
          identityDecision?: { id?: string; revision?: number };
        };
      };
    };
    expect(submissionEnvelope.data?.snapshot).toMatchObject({
      identity: {
        id: registeredIdentity.id,
        revision: String(registeredIdentity.revision),
      },
      identityDecision: sessionDecision,
    });
  } finally {
    await cleanupE2EUsers(request);
  }
});
