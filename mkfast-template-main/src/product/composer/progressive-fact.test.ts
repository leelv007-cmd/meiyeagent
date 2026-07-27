import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  createProgressiveFactDraft,
  nextGroundingFactFocus,
  progressiveFactRevisionMap,
  projectProgressiveFactView,
  shouldShowProgressiveFactCard,
  skipProgressiveFact,
} from './progressive-fact';

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
      },
      {
        id: 'project-hand-care',
        name: '手部护理',
        price: 159,
        durationMinutes: 45,
        confirmed: true,
      },
    ],
    regulated: true,
    confirmedAt: '2026-07-26T10:00:00.000Z',
  });

  assert.equal(draft.name, '青禾美甲');
  assert.equal(draft.city, '杭州');
  assert.equal(draft.projectName, '透亮猫眼');
  assert.equal(draft.projectPrice, '299');
  assert.deepEqual(draft.answered, []);
  assert.deepEqual(projectProgressiveFactView(draft).answeredIds, [
    'name',
    'city',
    'projectName',
    'projectPrice',
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
      },
      {
        id: 'project-hand-care',
        name: '手部护理',
        price: 159,
        durationMinutes: 45,
        confirmed: true,
      },
    ],
    regulated: true,
    confirmedAt: '2026-07-26T10:00:00.000Z',
  });
  draft = answerProgressiveFact(draft, 'projectPrice', '329');

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
  assert.equal(candidate.fact.expiresAt, null);
  assert.equal(batch.source.capabilityStatus, 'assisted');
});

test('skipped fallbacks may patch the profile but never become StoreFacts', () => {
  let draft = createProgressiveFactDraft();
  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  draft = answerProgressiveFact(draft, 'projectPrice', '299');
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

  const command = buildFinalizeStoreIntakeCommand(draft, {
    batchId: 'progressive-batch-day-zero',
    capturedAt: '2026-07-27T10:00:00.000Z',
    expectedRevision: 0,
    referenceId: 'progressive-card-day-zero',
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
  assert.equal(projectProgressiveFactView(draft).readyToConfirm, true);
  assert.deepEqual(draft.answered, ['projectName', 'projectPrice']);
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
      },
    ],
    regulated: false,
    revision: 3,
  });
  draft = answerProgressiveFact(draft, 'projectPrice', '329');

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
