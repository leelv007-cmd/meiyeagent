/**
 * P2 direct browser merge gate (#320-#325).
 *
 * Boundary: real local PostgreSQL + public Web -> Core HTTP/SSE + deterministic
 * fixture model execution. Product HTTP/SSE is observed, never mocked.
 *
 * This suite deliberately keeps known merge blockers as browser REDs. Soft
 * assertions let one run report every independent defect instead of stopping
 * at the first missing affordance.
 */

import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  adoptResult,
  chooseImageTextDirection,
  clickComposerDeliveryCard,
  closeComposerCapsule,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openComposerCapsule,
  openComposerRecipeCard,
  openDeliveryPanel,
  selectComposerLens,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;
const soft = expect.configure({ soft: true });
const VIRAL_REFERENCE_NOTE =
  '这篇参考笔记强调克制表达和熟客分享感，请按本店事实仿写';
const SENSITIVE_WORD = '根治';
const SAFE_REPLACEMENT = '明显改善';
const PRESET_LABELS = [
  '美业柔光',
  '杂志质感',
  '前后对比',
  'SPA 极简',
  '门店实拍感',
] as const;
const RATIO_CONTRACTS = [
  { aspectRatio: '3:4', size: '1536x2048' },
  { aspectRatio: '1:1', size: '2048x2048' },
  { aspectRatio: '9:16', size: '1152x2048' },
] as const;

type ComposerSubmission = {
  aiCover?: {
    aspectRatio?: string;
    size?: string;
    style?: string;
  };
  beautyVoiceRole?: string;
  contentPackagePlatform?: string;
  creationMode?: string;
  deliverable?: {
    aspectRatio?: string;
    kind?: string;
    notePageBound?: number;
    quantity?: number;
  };
  distributionTarget?: string;
  idempotencyKey?: string;
  recipe?: { id?: string };
  sources?: {
    assets?: Array<{ id?: string; revision?: string; role?: string }>;
  };
  thinkingLevel?: string;
  viralAdaptSource?: {
    authorizedAssetIds?: string[];
    noteText?: string;
    schemaVersion?: string;
    track?: string;
  };
};

type P1Command = {
  action?: string;
  module?: string;
  payload?: {
    changes?: { body?: string };
    instruction?: string;
    text?: string;
  };
};

function submissionResponse(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
}

function p1CommandResponse(
  page: Page,
  predicate: (command: P1Command) => boolean
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        return predicate(response.request().postDataJSON() as P1Command);
      } catch {
        return false;
      }
    },
    { timeout: 120_000 }
  );
}

async function registerPreparedMerchant(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const merchant = await registerE2EUser(request);
  await loginByForm(page, merchant);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');
  return merchant;
}

async function selectFirstFreeCreationModel(page: Page) {
  const modelSelect = page.getByTestId('composer-free-model-select');
  await expect(modelSelect).toBeEnabled({ timeout: 30_000 });
  await modelSelect.click();
  const firstModel = page.getByRole('option').first();
  await expect(firstModel).toBeVisible();
  const modelId = (await firstModel.getAttribute('data-model-id')) ?? '';
  expect(modelId).not.toBe('');
  await firstModel.click();
  await expect(modelSelect).toHaveAttribute('data-selected-model', modelId);
}

async function selectCaseNoteRecipe(page: Page) {
  await selectComposerLens(page, 'image_text');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.case_to_xhs_note'
  );
  const apply = page.getByRole('button', { name: '套用并更新设置' });
  const applied = page.getByTestId('composer-recipe-apply-undo');
  await expect(applied.or(apply)).toBeVisible();
  if (await apply.isVisible()) await apply.click();
  await expect(applied).toBeVisible();
  await closeComposerCapsule(page, recipePanel);
}

async function setTiptapBody(editor: Locator, value: string) {
  await editor.click();
  await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  // contenteditable fill treats each newline as a block boundary, while the
  // product's canonical plain-text contract uses two newlines between blocks.
  await editor.fill(value.replaceAll('\r\n', '\n').replaceAll('\n\n', '\n'));
  await expect.poll(() => tiptapPlainText(editor)).toBe(value);
}

async function tiptapPlainText(editor: Locator) {
  return editor.evaluate((element) =>
    Array.from(element.children)
      .map((block) => block.textContent ?? '')
      .join('\n\n')
      .replaceAll('\r\n', '\n')
  );
}

async function waitForDeliveryOrFailure(page: Page, workId: string) {
  const delivery = page.locator(
    '[data-testid="composer-delivery-card"][data-work-id="' + workId + '"]'
  );
  const failure = page.locator(
    '[data-testid="composer-report-card"], [data-testid="composer-terminal-outcome"][data-outcome="failed"]'
  );
  await expect(async () => {
    const failureCount = await failure.count();
    const failureVisibility = await Promise.all(
      Array.from({ length: failureCount }, (_, index) =>
        failure.nth(index).isVisible()
      )
    );
    expect(
      (await delivery.isVisible()) || failureVisibility.some(Boolean)
    ).toBe(true);
  }, 'the current work must reach delivery or a visible terminal failure').toPass(
    { timeout: 180_000 }
  );
  let failureText: string | undefined;
  for (let index = 0; index < (await failure.count()); index += 1) {
    const candidate = failure.nth(index);
    if (await candidate.isVisible()) {
      failureText = (await candidate.textContent())?.trim();
      break;
    }
  }
  return {
    deliveryVisible: await delivery.isVisible(),
    failureText,
  };
}

async function submitImageTextAllowingTerminalFailure(
  page: Page,
  intent: string,
  callbacks: {
    onDeliveryCardVisible?: () => void | Promise<void>;
    onRunStreaming?: () => void | Promise<void>;
  } = {}
) {
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-intent-input')).toHaveValue(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  const acceptedPromise = submissionResponse(page);
  const submit = page.getByTestId('composer-submit');
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
  const accepted = await acceptedPromise;
  expect(accepted.status()).toBe(202);
  const envelope = (await accepted.json()) as {
    data?: { work?: { id?: string } };
  };
  const workId = envelope.data?.work?.id;
  expect(workId).toBeTruthy();

  const failure = page
    .getByTestId('composer-report-card')
    .or(
      page.locator(
        '[data-testid="composer-terminal-outcome"][data-outcome="failed"]'
      )
    );
  const directionReady = page
    .getByTestId('ask-merchant-group-card')
    .filter({ hasText: /两种图文方向/u })
    .or(
      page
        .getByTestId('composer-question-card')
        .filter({ hasText: /两种图文方向/u })
    )
    .or(
      page
        .getByTestId('composer-stage-line')
        .filter({ hasText: '已按你选的方向继续准备整套图文' })
    );
  await expect(directionReady.or(failure).first()).toBeVisible({
    timeout: 180_000,
  });
  if (await failure.first().isVisible()) {
    return { delivered: false, workId: workId! };
  }
  await chooseImageTextDirection(page);

  const confirmation = page.getByTestId(
    'execution-confirmation-interaction-card'
  );
  await expect(confirmation.or(failure).first()).toBeVisible({
    timeout: 120_000,
  });
  if (await failure.first().isVisible()) {
    return { delivered: false, workId: workId! };
  }
  await confirmation.getByRole('button', { name: '确认执行' }).click();

  const candidate = page.getByTestId('composer-candidate-morph');
  await expect(candidate.or(failure).first()).toBeVisible({
    timeout: 180_000,
  });
  if (await failure.first().isVisible()) {
    return { delivered: false, workId: workId! };
  }
  await callbacks.onRunStreaming?.();
  const outcome = await waitForDeliveryOrFailure(page, workId!);
  if (!outcome.deliveryVisible) {
    return { delivered: false, workId: workId! };
  }
  await callbacks.onDeliveryCardVisible?.();
  const deliveryCard = page.locator(
    '[data-testid="composer-delivery-card"][data-work-id="' + workId + '"]'
  );
  await clickComposerDeliveryCard(deliveryCard);
  await expect(page).toHaveURL(/\/dashboard\/results\//u, {
    timeout: 60_000,
  });
  return { delivered: true, workId: workId! };
}

test.describe('P2 direct Chromium closure (#320-#325)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('image-text customer deep run keeps canonical edit, Selection AI, sensitive-word guard, and delivery on one journey', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerPreparedMerchant(page, request);
    await selectCaseNoteRecipe(page);
    const asset = await seedComposerInlineAuthorize(page, {
      fileName: 'p2-image-text-source.png',
    });

    await page.getByTestId('composer-creation-mode-free').click();
    await expect(page.getByTestId('composer-creation-mode-free')).toBeChecked();
    await selectFirstFreeCreationModel(page);
    // Generation params live in the attach capsule and only mount in free mode.
    // Use DOM click rather than Playwright actionability: the sticky Composer
    // reflows while quote readiness settles, which keeps these buttons
    // "unstable" even though they are the correct free-mode controls.
    const attachPanel = await openComposerCapsule(page, 'attach');
    await expect(
      page.getByTestId('composer-generation-params')
    ).toHaveAttribute('data-creation-mode', 'free');
    const beautyVoice = page.getByTestId('composer-beauty-voice-role-customer');
    const deepThinking = page.getByTestId('composer-thinking-level-deep');
    await expect(beautyVoice).toBeVisible();
    await beautyVoice.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(beautyVoice).toHaveAttribute('aria-pressed', 'true');
    await deepThinking.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(deepThinking).toHaveAttribute('aria-pressed', 'true');
    await closeComposerCapsule(page, attachPanel);

    let submission: ComposerSubmission | undefined;
    let submissionIdempotencyHeader: string | null = null;
    page.on('request', (networkRequest) => {
      if (
        networkRequest.method() === 'POST' &&
        networkRequest.url().includes('/api/core/p1/composer/submissions')
      ) {
        submission = networkRequest.postDataJSON() as ComposerSubmission;
        submissionIdempotencyHeader =
          networkRequest.headers()['idempotency-key'] ?? null;
      }
    });

    const workId = await submitComposerJourney(
      page,
      imageTextContract,
      '把授权案例做成克制可信的小红书图文笔记',
      { preserveIntent: false }
    );
    expect(submission).toBeDefined();
    expect(submission).toEqual(
      expect.objectContaining({
        beautyVoiceRole: 'customer',
        creationMode: 'free',
        thinkingLevel: 'deep',
        recipe: expect.objectContaining({ id: 'recipe.case_to_xhs_note' }),
        deliverable: expect.objectContaining({
          aspectRatio: '3:4',
          kind: 'note',
          notePageBound: 3,
          quantity: 1,
        }),
      })
    );
    soft(
      submission?.distributionTarget,
      'the applied case-note recipe must keep its signed export destination'
    ).toBe('export');
    expect(submissionIdempotencyHeader).toBe(submission?.idempotencyKey);
    expect(submission?.sources?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: asset.id,
          revision: expect.stringMatching(/\S/u),
          role: 'reference',
        }),
      ])
    );

    await waitForResultJourney(page, imageTextContract, workId);
    let workspace = page.getByTestId('result-image-text-workspace');
    await expect(workspace.getByTestId('image-worksurface')).toBeVisible();
    await expect(
      workspace.getByTestId('object-workspace-shell')
    ).toHaveAttribute('data-carrier', 'note');
    await expect(workspace.getByTestId('copy-field-body-host')).toHaveAttribute(
      'data-editor',
      'tiptap'
    );
    const toolbar = workspace.getByRole('toolbar', {
      name: '选区 AI 六动作',
    });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('[data-selection-ai-action]')).toHaveCount(6);

    let body = workspace.getByTestId('copy-field-body');
    const originalBody = (await tiptapPlainText(body)).trim();
    expect(originalBody.length).toBeGreaterThan(0);
    const selectionLength = Math.min(12, originalBody.length);
    await body.click();
    await body.press(
      process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Control+Home'
    );
    for (let index = 0; index < selectionLength; index += 1) {
      await body.press('Shift+ArrowRight');
    }
    const selectedText = await page.evaluate(
      () => window.getSelection()?.toString() ?? ''
    );
    expect(selectedText.trim().length).toBeGreaterThan(0);
    await expect(
      workspace.getByTestId('object-workspace-selection-ai')
    ).toHaveAttribute('data-rewrite-scope', 'selection');
    await expect(
      workspace.getByTestId('object-workspace-selection-ai-scope')
    ).toContainText('已选中');
    const preparePromise = p1CommandResponse(
      page,
      (command) =>
        command.module === 'result-delivery' &&
        command.action === 'result_adjust_prepare'
    );
    await workspace.getByTestId('selection-ai-rewrite').click();
    const prepare = await preparePromise;
    const prepareCommand = prepare.request().postDataJSON() as P1Command;
    expect(prepare.ok(), await prepare.text()).toBeTruthy();
    expect(prepareCommand.payload?.instruction).toContain(selectedText);
    await expect(page.getByTestId('image-adjust-confirmation')).toBeVisible();
    const previousUrl = page.url();
    const adjustPromise = p1CommandResponse(
      page,
      (command) =>
        command.module === 'result-delivery' &&
        command.action === 'result_adjust'
    );
    await page.getByTestId('execution-confirm-accept').click();
    const adjusted = await adjustPromise;
    expect(adjusted.ok(), await adjusted.text()).toBeTruthy();
    await expect
      .poll(() => page.url(), { timeout: 60_000 })
      .not.toBe(previousUrl);
    const adjustedWorkId = new URL(page.url()).pathname
      .split('/')
      .filter(Boolean)
      .at(-1);
    expect(adjustedWorkId).toBeTruthy();
    await waitForResultJourney(
      page,
      imageTextContract,
      decodeURIComponent(adjustedWorkId!)
    );
    workspace = page.getByTestId('result-image-text-workspace');
    body = workspace.getByTestId('copy-field-body');
    const revisedBody = (await tiptapPlainText(body)).trim();
    expect(revisedBody).not.toBe(originalBody);
    await adoptResult(page, imageTextContract);
    const sensitiveBody =
      revisedBody + '\n\n本店承诺' + SENSITIVE_WORD + '相关问题。';
    await setTiptapBody(body, sensitiveBody);
    const unsafeSavePromise = p1CommandResponse(
      page,
      (command) => command.action === 'edit_content_package_version'
    );
    await workspace.getByTestId('copy-save-hand-edit').click();
    const unsafeSave = await unsafeSavePromise;
    const unsafeSaveCommand = unsafeSave.request().postDataJSON() as P1Command;
    expect(unsafeSave.ok(), await unsafeSave.text()).toBeTruthy();
    expect(unsafeSaveCommand.payload?.changes?.body).toBe(sensitiveBody);
    await expect(body).toContainText(SENSITIVE_WORD);

    const checkedTexts: string[] = [];
    page.on('request', (networkRequest) => {
      if (
        networkRequest.method() !== 'POST' ||
        !networkRequest.url().includes('/api/core/p1/query')
      ) {
        return;
      }
      try {
        const command = networkRequest.postDataJSON() as P1Command;
        if (
          command.module === 'sensitive-words' &&
          command.action === 'check_bar' &&
          typeof command.payload?.text === 'string'
        ) {
          checkedTexts.push(command.payload.text);
        }
      } catch {
        // Non-JSON requests are irrelevant to this public command assertion.
      }
    });
    await openDeliveryPanel(page, imageTextContract.modality);
    const check = page.getByTestId('delivery-sensitive-words-check');
    await expect(check).not.toHaveAttribute('data-status', 'checking', {
      timeout: 60_000,
    });
    soft(
      checkedTexts.at(-1),
      'delivery must recheck the current canonical body after hand edit'
    ).toContain(SENSITIVE_WORD);
    await soft(check).toHaveAttribute('data-status', 'hits');
    const actions = page.locator('[data-testid^="delivery-action-"]');
    const actionCount = await actions.count();
    for (let index = 0; index < actionCount; index += 1) {
      await soft(actions.nth(index)).toBeDisabled();
    }
    const guardedSecondary = page.getByTestId('delivery-action-copy');
    await soft(guardedSecondary).toBeDisabled();

    const safeBody = sensitiveBody.replace(SENSITIVE_WORD, SAFE_REPLACEMENT);
    await setTiptapBody(body, safeBody);
    const safeSavePromise = p1CommandResponse(
      page,
      (command) => command.action === 'edit_content_package_version'
    );
    await workspace.getByTestId('copy-save-hand-edit').click();
    const safeSave = await safeSavePromise;
    expect(safeSave.ok(), await safeSave.text()).toBeTruthy();
    await soft
      .poll(() => checkedTexts.at(-1), {
        message:
          'delivery must recheck the corrected current canonical body without reload',
        timeout: 30_000,
      })
      .toContain(SAFE_REPLACEMENT);
    await expect(check).toHaveAttribute('data-status', 'clear', {
      timeout: 60_000,
    });
    await expect(guardedSecondary).toBeEnabled();
    await downloadFullPackage(page, imageTextContract);
  });

  test('delivered AI cover exposes five presets, signed ratios, style-role analysis, and a Result image', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerPreparedMerchant(page, request);
    const asset = await seedComposerInlineAuthorize(page, {
      fileName: 'p2-cover-style-source.png',
    });
    await submitComposerJourney(
      page,
      imageTextContract,
      '为本店护理案例准备一篇可交付的小红书图文',
      { openResult: false }
    );

    const cover = page.getByTestId('composer-delivery-ai-cover');
    await expect(cover).toBeVisible();
    await cover.getByTestId('composer-delivery-ai-cover-toggle').click();
    const ratios = cover.getByTestId('composer-delivery-ai-cover-ratios');
    await expect(ratios).toBeVisible();
    for (const contract of RATIO_CONTRACTS) {
      const control = ratios.getByTestId(
        'composer-delivery-ai-cover-ratio-' +
          contract.aspectRatio.replace(':', '-')
      );
      await expect(control).toHaveAttribute(
        'data-aspect-ratio',
        contract.aspectRatio
      );
      await soft(control).toHaveAttribute('data-size', contract.size);
      const maxSide = Math.max(
        ...contract.size.split('x').map((part) => Number(part))
      );
      soft(
        maxSide,
        contract.aspectRatio +
          ' signed cover size must fit active model max side 2048'
      ).toBeLessThanOrEqual(2048);
    }
    for (const label of PRESET_LABELS) {
      await soft(
        cover.getByRole('button', { name: label, exact: true }),
        'beauty preset must be reachable: ' + label
      ).toHaveCount(1);
    }

    await ratios.getByTestId('composer-delivery-ai-cover-ratio-1-1').click();
    const intent = page.getByTestId('composer-intent-input');
    await expect(intent).toHaveValue(/美业柔光.*1:1 方图/u);
    await expect(page.getByTestId('composer-creation-mode-free')).toBeChecked();
    await selectFirstFreeCreationModel(page);
    // Style reference controls live in the attach capsule popover.
    await openComposerCapsule(page, 'attach');
    const styleReference = page.getByTestId(
      'composer-style-reference-' + asset.id
    );
    await expect(styleReference).toBeVisible();
    await styleReference.click();
    await expect(styleReference).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByTestId('composer-style-analysis-stage')
    ).toHaveAttribute('data-stage-id', 'xhs_style_analysis');
    await expect(
      page.getByTestId('composer-style-analysis-stage')
    ).toContainText('正在分析参考图风格（七维）');
    await closeComposerCapsule(
      page,
      page.getByTestId('composer-capsule-attach-panel')
    );
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });

    const acceptedPromise = submissionResponse(page);
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId('composer-submit').click();
    const accepted = await acceptedPromise;
    const acceptedEnvelope = (await accepted.json()) as {
      data?: { task?: { id?: string }; work?: { id?: string } };
    };
    const coverTaskId = acceptedEnvelope.data?.task?.id;
    const coverWorkId = acceptedEnvelope.data?.work?.id;
    expect(coverTaskId).toBeTruthy();
    expect(coverWorkId).toBeTruthy();
    const signed = accepted.request().postDataJSON() as ComposerSubmission;
    expect(accepted.status()).toBe(202);
    soft(
      signed,
      'viral submission must carry the structured private source carrier'
    ).toEqual(
      expect.objectContaining({
        aiCover: {
          aspectRatio: '1:1',
          size: '2048x2048',
          style: 'beauty_soft',
        },
        creationMode: 'free',
        deliverable: expect.objectContaining({
          aspectRatio: '1:1',
          kind: 'poster',
          quantity: 1,
        }),
        recipe: expect.objectContaining({
          id: 'recipe.promotion_poster',
        }),
      })
    );
    expect(signed.sources?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: asset.id,
          revision: expect.stringMatching(/\S/u),
          role: 'style',
        }),
      ])
    );

    // Follow-on cover shares the first note's Agent Thread. Workbench
    // lifecycle stays `executing` from the delivered note, so the Living
    // Plan strip hides 开始制作. The parked poster then admits Make from
    // the reserved-stage 确认执行 card (same as campaign poster).
    const startAction = page.getByTestId('agent-commit-strip-start');
    const confirmation = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(startAction.or(confirmation).first()).toBeVisible({
      timeout: 60_000,
    });
    if (await startAction.isVisible()) {
      await expect(startAction).toBeEnabled();
      const startResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/core/p1/composer/tasks/${coverTaskId}/start`,
        { timeout: 60_000 }
      );
      await startAction.click();
      expect((await startResponse).ok()).toBeTruthy();
    } else {
      await confirmation.getByRole('button', { name: '确认执行' }).click();
    }
    const outcome = await waitForDeliveryOrFailure(page, coverWorkId!);
    soft(
      outcome.deliveryVisible,
      'fixture Chromium style-role run must reach a delivery card; terminal=' +
        (outcome.failureText ?? 'none')
    ).toBe(true);
    if (outcome.deliveryVisible) {
      const deliveryCard = page.locator(
        '[data-testid="composer-delivery-card"][data-work-id="' +
          coverWorkId +
          '"]'
      );
      await clickComposerDeliveryCard(deliveryCard);
      await expect(page).toHaveURL(/\/dashboard\/results\//u);
      await expect(
        page.getByTestId('image-worksurface').locator('img').first()
      ).toBeVisible({ timeout: 60_000 });
    }
  });

  test('viral chip uses honest paste fallback and authorized image through task experience morph to note Result', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const outboundHosts = new Set<string>();
    let memoryEntriesQueries = 0;
    page.on('request', (networkRequest) => {
      outboundHosts.add(new URL(networkRequest.url()).hostname);
      if (
        networkRequest.method() !== 'POST' ||
        !networkRequest.url().includes('/api/core/p1/query')
      ) {
        return;
      }
      try {
        const command = networkRequest.postDataJSON() as P1Command;
        if (command.module === 'memory' && command.action === 'entries_page') {
          memoryEntriesQueries += 1;
        }
      } catch {
        // Non-JSON requests are irrelevant to the memory refresh contract.
      }
    });
    await registerPreparedMerchant(page, request);
    await expect
      .poll(() => memoryEntriesQueries, {
        message: 'Composer must settle its initial memory entries query',
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const memoryEntriesBaseline = memoryEntriesQueries;

    const viralChip = page.getByTestId('suggestion-chip-viral_adapt');
    await expect(viralChip).toBeVisible({ timeout: 30_000 });
    await expect(viralChip).toHaveAttribute('data-recipe-chip', 'viral_adapt');
    await viralChip.click();
    const sourcing = page.getByTestId('viral-adapt-sourcing-card');
    await expect(sourcing).toBeVisible();
    const openCli = sourcing.getByTestId('viral-adapt-track-opencli');
    await expect(openCli).toHaveAttribute('data-opencli-available', 'true');
    await expect(
      sourcing.getByTestId('viral-adapt-track-paste')
    ).toHaveAttribute('data-selected', 'true');
    await expect(
      sourcing.getByTestId('viral-adapt-opencli-status')
    ).toContainText('已通过 live 核销');
    await expect(
      sourcing.getByTestId('viral-adapt-opencli-device-status')
    ).toContainText('本机桥未连接');

    await sourcing
      .getByTestId('viral-adapt-paste-text')
      .fill(VIRAL_REFERENCE_NOTE);
    await sourcing.getByTestId('viral-adapt-add-image').click();
    const asset = await seedComposerInlineAuthorize(page, {
      fileName: 'p2-viral-source.png',
    });
    await expect(
      sourcing.getByTestId('viral-adapt-track-images')
    ).toContainText('已附加 1 张经 Composer 授权的参考图');
    await sourcing.getByTestId('viral-adapt-sourcing-continue').click();

    const confirm = page.getByTestId('viral-adapt-confirm-card');
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByTestId('viral-adapt-confirm-source-label')
    ).toHaveText('粘贴笔记文字 + 上传图片');
    await expect(
      confirm.getByTestId('viral-adapt-confirm-spec-deliverable')
    ).toHaveText('小红书笔记（note）');
    await expect(
      confirm.getByTestId('viral-adapt-confirm-spec-platform')
    ).toHaveText('小红书');
    await expect(
      confirm.getByTestId('viral-adapt-confirm-spec-aspect')
    ).toHaveText('3:4');
    await expect(
      confirm.getByTestId('viral-adapt-confirm-spec-pages')
    ).toHaveText('3 页');
    await expect(
      confirm.getByTestId('viral-adapt-confirm-opencli')
    ).toHaveAttribute('data-opencli-available', 'true');
    await confirm.getByTestId('viral-adapt-confirm-submit').click();

    const intentInput = page.getByTestId('composer-intent-input');
    const readyIntent = await intentInput.inputValue();
    soft(
      readyIntent.includes(VIRAL_REFERENCE_NOTE),
      'merchant-visible Composer intent must not expose raw pasted source text'
    ).toBe(false);
    soft(
      /^\[[a-z_]+:[a-z_]+\]/u.test(readyIntent),
      'merchant-visible Composer intent must not expose an internal transport marker'
    ).toBe(false);
    soft(
      readyIntent.includes(asset.id),
      'merchant-visible Composer intent must not expose a raw asset identifier'
    ).toBe(false);

    let signed: ComposerSubmission | undefined;
    page.on('request', (networkRequest) => {
      if (
        networkRequest.method() === 'POST' &&
        networkRequest.url().includes('/api/core/p1/composer/submissions')
      ) {
        signed = networkRequest.postDataJSON() as ComposerSubmission;
      }
    });
    const viralOutcome = await submitImageTextAllowingTerminalFailure(
      page,
      readyIntent,
      {
        onRunStreaming: async () => {
          const conversation = page.getByTestId('composer-conversation');
          await expect(conversation).toHaveAttribute(
            'data-phase',
            /running|awaiting_input/u
          );
          await expect(conversation).toHaveAttribute('data-motion', 'on');
          await expect(
            page.getByTestId('experience-basis-surface')
          ).toBeVisible({ timeout: 60_000 });
          await expect(
            page.getByTestId('composer-candidate-morph')
          ).toHaveAttribute('data-morph-role', 'candidate', {
            timeout: 120_000,
          });
        },
        onDeliveryCardVisible: async () => {
          await expect(
            page.getByTestId('composer-delivery-morph')
          ).toHaveAttribute('data-morph-role', 'delivery');
          await expect(
            page.getByTestId('composer-candidate-morph-capsule')
          ).toHaveAttribute('data-morph-role', 'candidate-capsule');
          await expect(
            page.getByTestId('experience-sediment-surface')
          ).toBeVisible();
          await expect(
            page.getByTestId('experience-correction-surface')
          ).toBeVisible();
          await expect
            .poll(() => memoryEntriesQueries, {
              message:
                'successful delivery must actively refetch memory entries without reload',
              timeout: 30_000,
            })
            .toBeGreaterThan(memoryEntriesBaseline);
        },
      }
    );
    expect(signed).toEqual(
      expect.objectContaining({
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        recipe: expect.objectContaining({ id: 'recipe.viral_adapt' }),
        deliverable: expect.objectContaining({
          aspectRatio: '3:4',
          kind: 'note',
          notePageBound: 3,
        }),
        viralAdaptSource: {
          authorizedAssetIds: [asset.id],
          noteText: VIRAL_REFERENCE_NOTE,
          schemaVersion: 'viral-adapt-source/v1',
          track: 'paste',
        },
      })
    );
    expect(signed?.sources?.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: asset.id,
          revision: expect.stringMatching(/\S/u),
          role: 'reference',
        }),
      ])
    );
    expect(
      [...outboundHosts].some(
        (hostname) =>
          hostname.includes('opencli') || hostname.includes('xiaohongshu.com')
      )
    ).toBe(false);
    soft(
      viralOutcome.delivered,
      'authorized viral reference images must have a confirmed fixture route and reach delivery'
    ).toBe(true);
    if (viralOutcome.delivered) {
      await waitForResultJourney(page, imageTextContract, viralOutcome.workId);
      await expect(
        page
          .getByTestId('result-image-text-workspace')
          .getByTestId('object-workspace-shell')
      ).toHaveAttribute('data-carrier', 'note');
    }
  });
});
