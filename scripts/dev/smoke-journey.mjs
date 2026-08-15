import { randomUUID } from 'node:crypto';

export const REGISTER_GIFT_CREDITS = 100;

export function parseSetCookieHeaders(headers) {
  const raw = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [];
  const cookies = new Map();
  for (const line of raw) {
    const pair = String(line).split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return cookies;
}

export function cookieHeader(cookies) {
  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function mergeCookies(existing, incoming) {
  const next = new Map(existing);
  for (const [name, value] of incoming) next.set(name, value);
  return next;
}

export function stableJsonHash(value) {
  const serialized = JSON.stringify(canonicalJsonValue(value));
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }
  return (
    (low >>> 0).toString(16).padStart(8, '0') +
    (high >>> 0).toString(16).padStart(8, '0')
  );
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

export function createSmokeMerchant() {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  return {
    email: `e2e-lane79-${stamp}@example.test`,
    name: 'Lane79 Smoke',
    password: 'SmokePass123!',
  };
}

export function availableCreditsFromProjection(payload) {
  const data = payload?.data ?? payload;
  const credits = data?.credits;
  if (credits && Number.isFinite(credits.availableCredits)) {
    return credits.availableCredits;
  }
  return null;
}

export function confirmationReached(payload) {
  const text = JSON.stringify(payload ?? {});
  if (
    /execution_confirmation/u.test(text) ||
    /confirmation_card/u.test(text) ||
    /"kind":"execution_confirmation"/u.test(text) ||
    /agent-commit-strip/u.test(text) ||
    /living-plan-commit/u.test(text)
  ) {
    return true;
  }
  const data = payload?.data ?? payload;
  // Pure copy is D-043 exempt: admission returns 202 + makeReady without a
  // paid confirmation card. That is still the confirmation-gate surface.
  return Boolean(
    data?.makeReady === true &&
      data?.work?.id &&
      data?.task?.id &&
      data?.usageReservation?.id,
  );
}

export async function jsonOrText(response) {
  const text = await response.text();
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: null, text };
  }
}

export async function httpJson(url, init = {}) {
  const response = await fetch(url, init);
  const parsed = await jsonOrText(response);
  return { response, ...parsed };
}

export async function runHttpSmokeJourney({
  webOrigin,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const merchant = createSmokeMerchant();
  let cookies = new Map();

  const request = async (path, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (cookies.size > 0) headers.set('cookie', cookieHeader(cookies));
    const response = await fetchImpl(new URL(path, webOrigin), {
      ...init,
      headers,
    });
    cookies = mergeCookies(cookies, parseSetCookieHeaders(response.headers));
    const parsed = await jsonOrText(response);
    return { response, ...parsed };
  };

  const signup = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: webOrigin,
      referer: `${webOrigin}/auth/register`,
    },
    body: JSON.stringify({
      email: merchant.email,
      password: merchant.password,
      name: merchant.name,
      callbackURL: '/dashboard',
    }),
  });
  if (!signup.response.ok) {
    throw new Error(
      `sign-up failed HTTP ${signup.response.status}: ${signup.text}`,
    );
  }

  const projection = await request('/api/core/p1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      module: 'entitlements',
      action: 'projection',
      payload: {},
    }),
  });
  if (!projection.response.ok) {
    throw new Error(
      `entitlements.projection failed HTTP ${projection.response.status}: ${projection.text}`,
    );
  }
  const credits = availableCreditsFromProjection(projection.body);
  if (credits !== REGISTER_GIFT_CREDITS) {
    throw new Error(
      `expected ${REGISTER_GIFT_CREDITS} available credits, got ${String(credits)} (${projection.text})`,
    );
  }

  const surface = await request('/api/core/p1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      module: 'creation-experience',
      action: 'surface_browser',
      payload: { surfaceId: 'surface.home.launch' },
    }),
  });
  if (!surface.response.ok) {
    throw new Error(
      `surface_browser failed HTTP ${surface.response.status}: ${surface.text}`,
    );
  }

  const catalog = await request('/api/core/p1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      module: 'model-supply',
      action: 'catalog',
      payload: { operation: 'copy.generate' },
    }),
  });
  if (!catalog.response.ok) {
    throw new Error(
      `model-supply.catalog failed HTTP ${catalog.response.status}: ${catalog.text}`,
    );
  }

  const preferences = await request('/api/core/p1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      module: 'model-supply',
      action: 'preferences',
      payload: { operation: 'copy.generate' },
    }),
  });
  if (!preferences.response.ok) {
    throw new Error(
      `model-supply.preferences failed HTTP ${preferences.response.status}: ${preferences.text}`,
    );
  }

  const catalogData = catalog.body?.data ?? catalog.body;
  const preferenceData = preferences.body?.data ?? preferences.body;
  const surfaceData = surface.body?.data ?? surface.body;
  const catalogModelId =
    preferenceData?.provisionedPlatformDefault?.catalogModelId ??
    preferenceData?.platformDefault?.catalogModelId ??
    preferenceData?.platformDefault ??
    catalogData?.models?.[0]?.id ??
    'deepseek-v4-pro';
  const catalogRevision =
    catalogData?.revisionId ??
    preferenceData?.platformDefaultRevision ??
    'recorded-default-v1';
  const copyRecipeRef = (surfaceData?.recipeRefs ?? []).find(
    (entry) => entry?.lensId === 'copy' && entry?.recipeRevisionId,
  );
  const copyRecipe =
    (surfaceData?.recipes ?? []).find((entry) => entry?.lensId === 'copy') ?? {};
  const recipeId =
    copyRecipe.recipeId ??
    String(copyRecipeRef?.recipeRevisionId ?? 'recipe.project_intro').split('@')[0];
  const recipeRevision =
    copyRecipe.revisionId ??
    copyRecipeRef?.recipeRevisionId ??
    `${recipeId}@1`;
  const surfaceRevision =
    surfaceData?.revisionId ??
    (surfaceData?.revision != null
      ? `surface.home.launch@${surfaceData.revision}`
      : 'surface.home.launch@1');
  const delivery = copyRecipe.delivery ?? {};

  const signedSubmission = {
    catalogModel: { id: String(catalogModelId), revision: String(catalogRevision) },
    contentPackagePlatform: delivery.contentPackagePlatform ?? 'xiaohongshu',
    creationMode: 'customized',
    deliverable: {
      kind: delivery.deliverableKind === 'note' ? 'note' : 'copy_document',
      quantity: delivery.quantity ?? 1,
    },
    distributionTarget: delivery.distributionTarget ?? 'export',
    intent: '为夏日护理项目写一条预约文案',
    recipe: { id: String(recipeId), revision: String(recipeRevision) },
  };
  const quoteInput = {
    catalogModelId: String(catalogModelId),
    operation: 'copy.generate',
    quantity: 1,
    submission: signedSubmission,
    quoteId: ['composer', `lane79-${now()}`, 'copy', stableJsonHash({
      catalogModelId: String(catalogModelId),
      operation: 'copy.generate',
      quantity: 1,
      submission: signedSubmission,
    })].join(':'),
  };

  const quote = await request('/api/core/p1/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `composer-quote:${quoteInput.quoteId}`,
    },
    body: JSON.stringify({
      module: 'product-billing',
      action: 'quote',
      payload: quoteInput,
    }),
  });
  if (!quote.response.ok) {
    throw new Error(
      `product-billing.quote failed HTTP ${quote.response.status}: ${quote.text}`,
    );
  }
  const quoteData = quote.body?.data ?? quote.body;
  const quoteId = quoteData?.quoteId ?? quoteData?.id ?? quoteInput.quoteId;
  const quoteRevision = String(
    quoteData?.revision ?? quoteData?.quoteRevisionId ?? '1',
  );

  const briefContextId = `brief-context-lane79-${now()}`;
  const briefSync = await request('/api/core/p1/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `brief-context:${briefContextId}:0`,
    },
    body: JSON.stringify({
      module: 'creation-experience',
      action: 'brief_context_sync',
      payload: {
        briefContextId,
        draft: {
          delivery: {
            deliverableKind: signedSubmission.deliverable.kind,
            platform: signedSubmission.contentPackagePlatform,
          },
          settings: { quantity: signedSubmission.deliverable.quantity },
          sources: [],
          userText: signedSubmission.intent,
        },
        expectedRevision: null,
        lensId: 'copy',
        quoteId,
        recipeRevisionId: signedSubmission.recipe.revision,
        sourceIds: [],
        surfaceRevisionId: surfaceRevision,
      },
    }),
  });
  if (!briefSync.response.ok) {
    throw new Error(
      `brief_context_sync failed HTTP ${briefSync.response.status}: ${briefSync.text}`,
    );
  }
  const briefSyncData = briefSync.body?.data ?? briefSync.body;

  const briefProject = await request('/api/core/p1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      module: 'creation-experience',
      action: 'brief_project',
      payload: {
        briefContextId,
        lensId: 'copy',
        deliverableCount: signedSubmission.deliverable.quantity,
        platforms: [signedSubmission.contentPackagePlatform],
        sources: [],
        highRiskFacts: [],
        quote: {
          quoteRevisionId: quoteRevision,
          amount: quoteData?.creditCost ?? 1,
          extraConfirmThreshold: 20,
          quotePolicyRevision: quoteData?.quotePolicyRevision ?? 'quote.policy@1',
        },
        currentRevisions: {
          draftRevisionId: `draft-${briefContextId}`,
          modelRevisionId: signedSubmission.catalogModel.revision,
          quoteRevisionId: quoteRevision,
          recipeRevisionId: signedSubmission.recipe.revision,
          surfaceRevisionId: surfaceRevision,
        },
      },
    }),
  });
  if (!briefProject.response.ok) {
    throw new Error(
      `brief_project failed HTTP ${briefProject.response.status}: ${briefProject.text}`,
    );
  }

  const briefRevision =
    briefSyncData?.revision ?? briefProject.body?.data?.contextRevision ?? 1;

  const submitKey = `lane79-copy-${now()}`;
  const submit = await request('/api/core/p1/composer/submissions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': submitKey,
    },
    body: JSON.stringify({
      ...signedSubmission,
      idempotencyKey: submitKey,
      briefContext: { id: briefContextId, revision: Number(briefRevision) },
      catalogModel: signedSubmission.catalogModel,
      quote: { id: String(quoteId), revision: String(quoteRevision) },
      recipe: signedSubmission.recipe,
      sources: { assets: [] },
      surface: {
        id: 'surface.home.launch',
        revision: String(surfaceRevision),
      },
      userSelectedSkillRefs: [],
    }),
  });
  if (submit.response.status !== 202 && !submit.response.ok) {
    throw new Error(
      `composer submission failed HTTP ${submit.response.status}: ${submit.text}`,
    );
  }

  const submitData = submit.body?.data ?? submit.body;
  const taskId = submitData?.task?.id;
  const deadline = Date.now() + 90_000;
  let confirmation = submit.body;
  if (!confirmationReached(confirmation) && taskId) {
    while (Date.now() < deadline) {
      const interaction = await request(
        `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction`,
      );
      if (confirmationReached(interaction.body) || confirmationReached(interaction.text)) {
        confirmation = interaction.body ?? interaction.text;
        break;
      }
      const pending = await request('/api/core/p1/pending-actions');
      if (confirmationReached(pending.body) || confirmationReached(pending.text)) {
        confirmation = pending.body ?? pending.text;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  if (!confirmationReached(confirmation) && !confirmationReached(submit.body)) {
    throw new Error(
      `copy submission did not reach a confirmation card (submit=${submit.text})`,
    );
  }

  return {
    credits,
    email: merchant.email,
    submission: submitData,
    taskId,
  };
}
