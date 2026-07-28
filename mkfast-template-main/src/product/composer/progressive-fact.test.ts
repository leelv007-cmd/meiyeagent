import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoreProfile } from '@meiye/contracts';

import {
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  createProgressiveFactDraft,
  hasMissingProgressiveStoreFacts,
  nextGroundingFactFocus,
  PRICE_VALIDITY_LONG_TERM,
  priceValidityExpiresAt,
  priceValidityFromStored,
  progressiveFactRevisionMap,
  projectProgressiveFactView,
  shouldShowProgressiveFactCard,
  skipProgressiveFact,
} from './progressive-fact';

/** The end of 2026-08-31 in the machine's own zone, the way the UI writes it. */
const AUGUST_31 = priceValidityExpiresAt('2026-08-31')!;

test('asks one blocking store fact at a time before skippable fields', () => {
  let draft = createProgressiveFactDraft();
  let view = projectProgressiveFactView(draft);
  assert.equal(view.current?.id, 'name');
  assert.equal(view.current?.criticality, 'blocking');
  assert.equal(view.readyToConfirm, false);

  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  view = projectProgressiveFactView(draft);
  assert.equal(view.current?.id, 'projectPrice');

  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  view = projectProgressiveFactView(draft);
  // #244 — a price is not a finished answer until the merchant says how long it
  // runs, so confirmation stays blocked and the next question is the window.
  assert.equal(view.readyToConfirm, false);
  assert.equal(view.current?.id, 'projectPriceValidity');
  assert.equal(view.current?.criticality, 'blocking');

  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );
  view = projectProgressiveFactView(draft);
  assert.equal(view.readyToConfirm, true);
  assert.equal(view.current?.id, 'district');
  assert.equal(view.current?.criticality, 'skippable');
});

test('prefills the progressive draft from the current store profile', () => {
  const draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    prohibitions: ['不虚构价格'],
    accounts: [{ platform: 'xiaohongshu', nickname: '青禾美甲' }],
    projects: [
      {
        id: 'project-cat-eye',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: true,
        priceValidUntil: null,
      },
      {
        id: 'project-hand-care',
        name: '手部护理',
        price: 159,
        durationMinutes: 45,
        confirmed: true,
        priceValidUntil: null,
      },
    ],
    regulated: true,
    confirmedAt: '2026-07-26T10:00:00.000Z',
  });

  assert.equal(draft.name, '青禾美甲');
  assert.equal(draft.city, '杭州');
  assert.equal(draft.projectName, '透亮猫眼');
  assert.equal(draft.projectPrice, '299');
  assert.equal(draft.projectPriceValidity, PRICE_VALIDITY_LONG_TERM);
  assert.deepEqual(draft.answered, []);
  assert.deepEqual(projectProgressiveFactView(draft).answeredIds, [
    'name',
    'city',
    'projectName',
    'projectPrice',
    'projectPriceValidity',
    'district',
    'address',
    'booking',
    'brandVoice',
  ]);
});

test('non-critical facts can skip with safe fallback and impact note', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    projectName: '透亮猫眼',
    projectPrice: '299',
  });
  const blocked = skipProgressiveFact(draft, 'name');
  assert.equal(blocked, null);

  const skipped = skipProgressiveFact(draft, 'district');
  assert.ok(skipped);
  draft = skipped!;
  assert.equal(draft.district, '本区');
  assert.deepEqual(draft.skipped, ['district']);
  const view = projectProgressiveFactView(draft);
  assert.ok(
    view.skipImpacts.some(
      (item) => item.includes('本区') || item.includes('同城')
    )
  );
});

test('builds one finalize batch with only the explicitly edited profile field', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    prohibitions: ['不虚构价格'],
    accounts: [{ platform: 'xiaohongshu', nickname: '青禾美甲' }],
    projects: [
      {
        id: 'project-cat-eye',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: true,
        priceValidUntil: null,
      },
      {
        id: 'project-hand-care',
        name: '手部护理',
        price: 159,
        durationMinutes: 45,
        confirmed: true,
        priceValidUntil: null,
      },
    ],
    regulated: true,
    confirmedAt: '2026-07-26T10:00:00.000Z',
  });
  draft = answerProgressiveFact(draft, 'projectPrice', '329');
  draft = answerProgressiveFact(draft, 'projectPriceValidity', '2026-08-31');

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-a',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 7,
    referenceId: 'progressive-card-a',
    taskId: 'progressive-task-a',
    workspaceId: 'workspace-a',
  });

  assert.ok(command);
  assert.equal(command?.action, 'finalize_store_intake');
  assert.deepEqual(command?.payload.profilePatch, {
    expectedRevision: 7,
    projects: {
      upsert: [
        {
          id: 'project-cat-eye',
          name: '透亮猫眼',
          price: 329,
          durationMinutes: 90,
          confirmed: true,
          priceValidUntil: AUGUST_31,
        },
      ],
    },
  });
  assert.equal('accounts' in (command?.payload.profilePatch ?? {}), false);
  assert.equal('prohibitions' in (command?.payload.profilePatch ?? {}), false);
  assert.equal('regulated' in (command?.payload.profilePatch ?? {}), false);

  assert.deepEqual(command?.payload.confirmations, [
    {
      candidateId: 'store-project:project-cat-eye:price:candidate',
      factId: 'store-project:project-cat-eye:price',
      expectedFactRevision: 0,
    },
  ]);
  const batch = command?.payload.batch;
  assert.ok(batch && 'candidates' in batch);
  if (!batch || !('candidates' in batch)) return;
  const candidate = batch.candidates[0];
  assert.ok(candidate && 'fact' in candidate);
  if (!candidate || !('fact' in candidate)) return;
  assert.equal(candidate.fact.kind, 'price');
  assert.equal(candidate.fact.key, 'service.project-cat-eye.price');
  assert.deepEqual(candidate.fact.value, { amount: 329, currency: 'CNY' });
  assert.deepEqual(candidate.fact.scope, { storeId: 'workspace-a' });
  assert.equal(candidate.fact.source.kind, 'user_confirmation');
  assert.equal(candidate.fact.source.referenceId, 'progressive-card-a');
  // The stated window is on the fact itself — this is the value the generation
  // side reads when it decides whether the price is still current.
  assert.equal(candidate.fact.expiresAt, AUGUST_31);
  assert.equal(batch.source.capabilityStatus, 'assisted');
});

test('skipped fallbacks may patch the profile but never become StoreFacts', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );
  draft = skipProgressiveFact(draft, 'district')!;

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-skip',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 1,
    referenceId: 'progressive-card-skip',
    taskId: 'progressive-task-skip',
    workspaceId: 'workspace-a',
  });

  assert.equal(command?.payload.profilePatch.district, '本区');
  const batch = command?.payload.batch;
  assert.ok(batch && 'candidates' in batch);
  if (!batch || !('candidates' in batch)) return;
  assert.equal(
    batch.candidates.some(
      (candidate) =>
        'fact' in candidate && candidate.fact.key === 'store.profile.district'
    ),
    false
  );
});

test('revision zero creates a complete profile patch without promoting fallbacks', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-day-zero',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 0,
    referenceId: 'progressive-card-day-zero',
    regulatedDefault: false,
    taskId: 'progressive-task-day-zero',
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(command?.payload.profilePatch, {
    expectedRevision: 0,
    name: '青禾美甲',
    city: '杭州',
    district: '本区',
    address: '门店地址待补充',
    booking: '到店咨询预约',
    brandVoice: '真实、克制、像熟客推荐',
    regulated: false,
    projects: {
      upsert: [
        {
          id: 'progressive-project-1',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 60,
          confirmed: true,
          priceValidUntil: null,
        },
      ],
    },
  });
  const batch = command?.payload.batch;
  assert.ok(batch && 'candidates' in batch);
  if (!batch || !('candidates' in batch)) return;
  const factKeys = batch.candidates.flatMap((candidate) =>
    'fact' in candidate ? [candidate.fact.key] : []
  );
  assert.equal(factKeys.includes('store.profile.district'), false);
  assert.equal(factKeys.includes('store.fulfillment.address'), false);
  assert.equal(factKeys.includes('store.fulfillment.booking'), false);
});

test('revision zero seeds the platform regulated default instead of false', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾医美');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '光子嫩肤');
  draft = answerProgressiveFact(draft, 'projectPrice', '1299');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-regulated',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 0,
    referenceId: 'progressive-card-regulated',
    regulatedDefault: true,
    taskId: 'progressive-task-regulated',
    workspaceId: 'workspace-a',
  });

  assert.equal(command?.payload.profilePatch.regulated, true);
});

test('revision zero is withheld until the platform regulated default is known', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );

  assert.equal(
    buildFinalizeStoreIntakeCommand(draft, {
      batchId: 'progressive-batch-unknown-default',
      capturedAt: '2026-07-27T10:00:00.000Z',
      expectedRevision: 0,
      referenceId: 'progressive-card-unknown-default',
      taskId: 'progressive-task-unknown-default',
      workspaceId: 'workspace-a',
    }),
    null
  );
});

test('a fully prefilled profile cannot create an empty finalize batch', () => {
  const draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    prohibitions: ['不虚构价格'],
    accounts: [],
    projects: [
      {
        id: 'project-cat-eye',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: true,
        priceValidUntil: null,
      },
    ],
    regulated: false,
    revision: 3,
  });

  assert.equal(
    buildFinalizeStoreIntakeCommand(draft, {
      batchId: 'progressive-batch-noop',
      capturedAt: '2026-07-27T10:00:00.000Z',
      expectedRevision: 3,
      referenceId: 'progressive-card-noop',
      taskId: 'progressive-task-noop',
      workspaceId: 'workspace-a',
    }),
    null
  );
});

test('an unconfirmed prefilled project still requires explicit answers', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    prohibitions: ['不虚构价格'],
    accounts: [],
    projects: [
      {
        id: 'project-cat-eye',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: false,
      },
    ],
    regulated: false,
    revision: 3,
  });

  assert.equal(projectProgressiveFactView(draft).current?.id, 'projectName');
  assert.equal(draft.projectName, '透亮猫眼');

  draft = answerProgressiveFact(draft, 'projectName', draft.projectName);
  assert.equal(projectProgressiveFactView(draft).current?.id, 'projectPrice');
  assert.equal(draft.projectPrice, '299');

  draft = answerProgressiveFact(draft, 'projectPrice', draft.projectPrice);
  assert.equal(projectProgressiveFactView(draft).readyToConfirm, false);
  assert.equal(
    projectProgressiveFactView(draft).current?.id,
    'projectPriceValidity'
  );

  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );
  assert.equal(projectProgressiveFactView(draft).readyToConfirm, true);
  assert.deepEqual(draft.answered, [
    'projectName',
    'projectPrice',
    'projectPriceValidity',
  ]);
});

test('a legacy confirmed project without ledger facts requires explicit confirmation', () => {
  const draft = createProgressiveFactDraft(
    {
      name: '青禾美甲',
      city: '杭州',
      district: '拱墅区',
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '真实、克制',
      prohibitions: ['不虚构价格'],
      accounts: [],
      projects: [
        {
          id: 'project-cat-eye',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
      regulated: false,
      revision: 3,
    },
    []
  );

  assert.equal(projectProgressiveFactView(draft).current?.id, 'projectName');
});

test('an existing fact revision is carried into a correction confirmation', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    prohibitions: ['不虚构价格'],
    accounts: [],
    projects: [
      {
        id: 'project-cat-eye',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: true,
        priceValidUntil: null,
      },
    ],
    regulated: false,
    revision: 3,
  });
  draft = answerProgressiveFact(draft, 'projectPrice', '329');
  draft = answerProgressiveFact(
    draft,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-correction',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 3,
    factRevisions: { 'store-project:project-cat-eye:price': 7 },
    referenceId: 'progressive-card-correction',
    taskId: 'progressive-task-correction',
    workspaceId: 'workspace-a',
  });

  assert.equal(command?.payload.confirmations[0]?.expectedFactRevision, 7);
});

test('the latest historical fact revision wins when the active ledger is empty', () => {
  assert.deepEqual(
    progressiveFactRevisionMap([
      { factId: 'store-project:project-cat-eye:price', revision: 2 },
      { factId: 'store-project:project-cat-eye:price', revision: 7 },
    ]),
    { 'store-project:project-cat-eye:price': 7 }
  );
});

test('Day-0 remains visible on ledger failure while existing stores fail closed', () => {
  assert.equal(
    shouldShowProgressiveFactCard({
      hasProductState: true,
      productLoading: false,
      hasStore: false,
      ledgerReady: false,
      groundingRequested: false,
      missingStoreFacts: false,
    }),
    true
  );
  assert.equal(
    shouldShowProgressiveFactCard({
      hasProductState: true,
      productLoading: false,
      hasStore: true,
      ledgerReady: false,
      groundingRequested: true,
      missingStoreFacts: true,
    }),
    false
  );
  assert.equal(
    shouldShowProgressiveFactCard({
      hasProductState: true,
      productLoading: false,
      hasStore: true,
      ledgerReady: true,
      groundingRequested: false,
      missingStoreFacts: true,
    }),
    true
  );
});

test('a profile backed by active service and price facts has no fake confirm step', () => {
  const draft = createProgressiveFactDraft(
    {
      name: '青禾美甲',
      city: '杭州',
      district: '拱墅区',
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '真实、克制',
      prohibitions: ['不虚构价格'],
      accounts: [],
      projects: [
        {
          id: 'project-cat-eye',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
          priceValidUntil: null,
        },
      ],
      regulated: false,
      revision: 3,
    },
    [
      { factId: 'store-project:project-cat-eye:service', revision: 4 },
      { factId: 'store-project:project-cat-eye:price', revision: 7 },
    ]
  );

  assert.equal(projectProgressiveFactView(draft).current, null);
  assert.deepEqual(draft.unconfirmed, []);
});

test('next grounding focus prefers store then project', () => {
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: false, projectConfirmed: false }),
    'name'
  );
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: true, projectConfirmed: false }),
    'projectName'
  );
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: true, projectConfirmed: true }),
    null
  );
});

/* ------------------------------------------------------------------ *
 * #244 — how long is this price good for?
 * ------------------------------------------------------------------ */

const legacyStore = (priceValidUntil?: string | null): StoreProfile => ({
  name: '青禾美甲',
  city: '杭州',
  district: '拱墅区',
  address: '湖墅南路 88 号',
  booking: '提前一天预约',
  brandVoice: '真实、克制',
  prohibitions: [],
  accounts: [],
  projects: [
    {
      id: 'project-cat-eye',
      name: '透亮猫眼',
      price: 299,
      durationMinutes: 90,
      confirmed: true,
      ...(priceValidUntil === undefined ? {} : { priceValidUntil }),
    },
  ],
  regulated: false,
  revision: 3,
});

const ledgerHeads = [
  { factId: 'store-project:project-cat-eye:service', revision: 4 },
  { factId: 'store-project:project-cat-eye:price', revision: 7 },
];

test('a price stored before anyone asked about validity comes back as unconfirmed', () => {
  // The historical migration, and it is a derivation rather than a backfill:
  // a project that carries no stated window at all was never asked, so the
  // wizard shows the question instead of pretending the price is permanent.
  const draft = createProgressiveFactDraft(legacyStore(), ledgerHeads);

  assert.deepEqual(draft.unconfirmed, ['projectPriceValidity']);
  assert.equal(draft.projectPriceValidity, '');
  assert.equal(
    projectProgressiveFactView(draft).current?.id,
    'projectPriceValidity'
  );
  assert.equal(projectProgressiveFactView(draft).readyToConfirm, false);
  assert.equal(
    hasMissingProgressiveStoreFacts(legacyStore(), ledgerHeads),
    true
  );

  // Replaying the same read is the same read — nothing is consumed or stamped.
  assert.deepEqual(
    createProgressiveFactDraft(legacyStore(), ledgerHeads).unconfirmed,
    ['projectPriceValidity']
  );

  // And once the merchant answers, the nag stops.
  const answered = legacyStore(null);
  assert.deepEqual(
    createProgressiveFactDraft(answered, ledgerHeads).unconfirmed,
    []
  );
  assert.equal(hasMissingProgressiveStoreFacts(answered, ledgerHeads), false);
});

test('a blank validity answer is never read as "it never expires"', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');

  // Explicitly "answered" with nothing — the id is in `answered`, and it still
  // does not count, because an empty answer is not a standing price.
  draft = answerProgressiveFact(draft, 'projectPriceValidity', '   ');
  assert.equal(projectProgressiveFactView(draft).readyToConfirm, false);
  assert.equal(
    buildFinalizeStoreIntakeCommand(draft, {
      batchId: 'progressive-batch-blank-validity',
      capturedAt: '2026-07-27T10:00:00.000Z',
      expectedRevision: 0,
      referenceId: 'progressive-card-blank-validity',
      regulatedDefault: false,
      taskId: 'progressive-task-blank-validity',
      workspaceId: 'workspace-a',
    }),
    null
  );
});

test('a window that has already run out cannot be recorded as a current price', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  draft = answerProgressiveFact(draft, 'projectPriceValidity', '2026-07-01');

  assert.equal(
    buildFinalizeStoreIntakeCommand(draft, {
      batchId: 'progressive-batch-lapsed',
      capturedAt: '2026-07-27T10:00:00.000Z',
      expectedRevision: 0,
      referenceId: 'progressive-card-lapsed',
      regulatedDefault: false,
      taskId: 'progressive-task-lapsed',
      workspaceId: 'workspace-a',
    }),
    null
  );
});

test('restating only the window still rewrites the price stream it belongs to', () => {
  // The window has no fact of its own, so a validity-only change has to carry
  // the price candidate — otherwise the ledger would keep the old window while
  // the profile advertised the new one.
  let draft = createProgressiveFactDraft(legacyStore(), ledgerHeads);
  draft = answerProgressiveFact(draft, 'projectPriceValidity', '2026-08-31');

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-window-only',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 3,
    factRevisions: { 'store-project:project-cat-eye:price': 7 },
    referenceId: 'progressive-card-window-only',
    taskId: 'progressive-task-window-only',
    workspaceId: 'workspace-a',
  });

  assert.deepEqual(command?.payload.confirmations, [
    {
      candidateId: 'store-project:project-cat-eye:price:candidate',
      factId: 'store-project:project-cat-eye:price',
      expectedFactRevision: 7,
    },
  ]);
  const batch = command?.payload.batch;
  assert.ok(batch && 'candidates' in batch);
  if (!batch || !('candidates' in batch)) return;
  const candidate = batch.candidates[0];
  assert.ok(candidate && 'fact' in candidate);
  if (!candidate || !('fact' in candidate)) return;
  assert.equal(candidate.fact.expiresAt, AUGUST_31);
  assert.deepEqual(candidate.fact.value, { amount: 299, currency: 'CNY' });
  assert.equal(
    command?.payload.profilePatch.projects?.upsert?.[0]?.priceValidUntil,
    AUGUST_31
  );
});

test('a stated window survives the round trip through the stored profile', () => {
  assert.equal(priceValidityFromStored(undefined), '');
  assert.equal(priceValidityFromStored(null), PRICE_VALIDITY_LONG_TERM);
  assert.equal(priceValidityFromStored(AUGUST_31), '2026-08-31');
  assert.equal(priceValidityExpiresAt(PRICE_VALIDITY_LONG_TERM), null);
  assert.equal(priceValidityExpiresAt(''), undefined);
  assert.equal(priceValidityExpiresAt('八月底'), undefined);
});
