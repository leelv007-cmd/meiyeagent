import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AssetIntakeBatch,
  AssetIntakeExperience,
  StoreProfile,
} from '@meiye/contracts';

import {
  applyExtractedFacts,
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  confirmArchiveCard,
  createProgressiveFactDraft,
  PRICE_VALIDITY_LONG_TERM,
} from '@/product/composer/progressive-fact';
import {
  applyArrangedDraft,
  applyBatchDrafts,
  applyLlmSentenceSuggestions,
  applySentenceDraft,
  arrangementRecognizedFields,
  extractStoreFactsFromSentence,
  extractStoreSentenceRequest,
  canLlmFillDraftField,
  assetParseTaskDraftsQuery,
  assetParseTaskQuery,
  batchPollDelayMs,
  BATCH_POLL_MAX_ATTEMPTS,
  buildImportFinalizeCommand,
  canArrange,
  canBatchParse,
  createStoreIntakeWizardState,
  draftSupplyFromExperience,
  isPhotoParseOpen,
  shouldShowFixtureParseLabel,
  currentStep,
  draftPrefillEntries,
  editSentence,
  goToStep,
  importCandidateGroups,
  isParseTaskTerminal,
  orderedIntakeFields,
  parseAssetBatchRequest,
  parseSingleAssetRequest,
  prepareManualDraftRequest,
  recommendedFactIds,
  resolveBatchPollTick,
  rotateExample,
  selectedExample,
  shouldContinueBatchPolling,
  statedSentence,
  STORE_INTAKE_FIELDS,
  toggleRecommendation,
} from './store-intake-wizard-model';

const experience: AssetIntakeExperience = {
  assetType: 'price_list',
  configRevision: 0,
  disclosure: '解析结果需要你确认。',
  draftSupply: { kind: 'fixture', open: true },
  examples: [
    {
      exampleId: 'a',
      title: '价目表示例 A',
      summary: '拍一张就行',
      sourceRef: 'platform-sample:a',
    },
    {
      exampleId: 'b',
      title: '价目表示例 B',
      summary: '手写的也认',
      sourceRef: 'platform-sample:b',
    },
  ],
  industry: 'hair_care',
  recommendations: [
    { recommendationId: 'r1', label: '项目名称、日常价' },
    { recommendationId: 'r2', label: '团购价' },
  ],
  steps: [
    { id: 'see_examples', optional: true },
    { id: 'choose_recommendations', optional: true },
    { id: 'say_or_upload', optional: true },
    { id: 'ai_arrange', optional: true },
    { id: 'confirm_each', optional: false },
  ],
};

const upload = {
  contentType: 'image/png',
  objectKey: 'workspace-a/canvas/assets/intake-' + 'a'.repeat(64) + '.png',
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  sourceUrl:
    'http://localhost:3000/api/core/p1/assets?objectKey=intake&providerExpires=1&providerSignature=test',
};

const uploadB = {
  contentType: 'image/png',
  objectKey: 'workspace-a/canvas/assets/intake-' + 'b'.repeat(64) + '.png',
  sha256: 'b'.repeat(64),
  sizeBytes: 2048,
  sourceUrl:
    'http://localhost:3000/api/core/p1/assets?objectKey=intake-b&providerExpires=1&providerSignature=test',
};

function wizard() {
  return createStoreIntakeWizardState(createProgressiveFactDraft());
}

test('the step order and optionality come from the server contract', () => {
  const state = wizard();
  assert.deepEqual(currentStep(experience, state), {
    id: 'see_examples',
    optional: true,
  });
  const last = goToStep(experience, state, 9);
  assert.deepEqual(currentStep(experience, last), {
    id: 'confirm_each',
    optional: false,
  });
  assert.equal(goToStep(experience, last, 1), last);
});

test('example rotation cycles the platform samples', () => {
  let state = wizard();
  assert.equal(selectedExample(experience, state)?.exampleId, 'a');
  state = rotateExample(experience, state);
  assert.equal(selectedExample(experience, state)?.exampleId, 'b');
  state = rotateExample(experience, state);
  assert.equal(selectedExample(experience, state)?.exampleId, 'a');
});

test('recommendation selection toggles both ways', () => {
  let state = toggleRecommendation(experience, wizard(), 'r1');
  assert.deepEqual(state.selectedRecommendations, ['r1']);
  state = toggleRecommendation(experience, state, 'r2');
  assert.deepEqual(state.selectedRecommendations, ['r1', 'r2']);
  state = toggleRecommendation(experience, state, 'r1');
  assert.deepEqual(state.selectedRecommendations, ['r2']);
});

test('ticking a recommendation changes what the wizard asks and offers', () => {
  const none = wizard();
  assert.deepEqual(recommendedFactIds(experience, none), []);
  // Nothing ticked keeps the wizard's own field order — no hidden narrowing.
  assert.deepEqual(orderedIntakeFields([]), STORE_INTAKE_FIELDS);

  const ticked = toggleRecommendation(experience, none, 'r1');
  // 「价」 pulls the price *and* how long it runs — a promotion price the
  // merchant is asked about but never dated is the bug #244 closed.
  assert.deepEqual(recommendedFactIds(experience, ticked), [
    'projectName',
    'projectPrice',
    'projectPriceValidity',
  ]);
  assert.deepEqual(
    orderedIntakeFields(recommendedFactIds(experience, ticked)),
    [
      'projectName',
      'projectPrice',
      'projectPriceValidity',
      'name',
      'city',
      'district',
      'address',
      'booking',
      // D-174 industry sits last and matches no recommendation hint: ticking a
      // recommendation never pulls it forward, it is only ever offered after
      // everything the merchant came here for.
      'industry',
    ]
  );
  // 少打字: the sentence box arrives pre-structured instead of empty.
  assert.equal(ticked.sentence, '项目名称：\n日常价：');

  const untickedAgain = toggleRecommendation(experience, ticked, 'r1');
  assert.equal(untickedAgain.sentence, '');
});

test('a scaffold the merchant typed into is theirs, an empty one is never sent', () => {
  const ticked = toggleRecommendation(experience, wizard(), 'r1');
  assert.equal(statedSentence(ticked.sentence), '');
  assert.equal(canArrange(ticked), false);

  const filled = editSentence(ticked, '项目名称：头皮护理\n日常价：239');
  assert.equal(statedSentence(filled.sentence), filled.sentence);
  // Ticking another box must not overwrite what was typed into the scaffold.
  const alsoR2 = toggleRecommendation(experience, filled, 'r2');
  assert.equal(alsoR2.sentence, filled.sentence);

  const request = prepareManualDraftRequest({
    assetId: 'intake-asset:1',
    draft: createProgressiveFactDraft(),
    rightsConfirmed: false,
    sentence: ticked.sentence,
    target: 'price_list',
    taskId: 'task-1',
    upload,
  });
  assert.equal(
    request.payload.fields.some(
      (field) => field.key === 'store.profile.summary'
    ),
    false
  );
});

test('an emptied box stays empty — clearing it is an edit, not an untouched box', () => {
  const ticked = toggleRecommendation(experience, wizard(), 'r1');
  const cleared = editSentence(ticked, '');
  assert.equal(cleared.sentence, '');

  // Whitespace is the same act — the merchant decided the box says nothing.
  const alsoR2 = toggleRecommendation(experience, cleared, 'r2');
  assert.equal(alsoR2.sentence, '');
  assert.equal(
    toggleRecommendation(experience, editSentence(ticked, '   '), 'r2')
      .sentence,
    '   '
  );
});

test('a half-filled scaffold sends only the lines the merchant answered', () => {
  const ticked = toggleRecommendation(experience, wizard(), 'r1');
  const half = editSentence(ticked, '项目名称：头疗护理\n日常价：');
  assert.equal(statedSentence(half.sentence), '项目名称：头疗护理');

  const request = prepareManualDraftRequest({
    assetId: 'intake-asset:1',
    draft: createProgressiveFactDraft(),
    rightsConfirmed: false,
    sentence: half.sentence,
    target: 'price_list',
    taskId: 'task-1',
    upload,
  });
  assert.deepEqual(
    request.payload.fields.filter(
      (field) => field.key === 'store.profile.summary'
    ),
    [{ key: 'store.profile.summary', value: '项目名称：头疗护理' }]
  );
});

test('arranging needs either a sentence or a photo', () => {
  assert.equal(canArrange(wizard()), false);
  assert.equal(canArrange({ ...wizard(), sentence: '头疗 239' }), true);
  assert.equal(canArrange({ ...wizard(), upload }), true);
  assert.equal(canArrange({ ...wizard(), uploads: [upload] }), true);
});

const AUDIT_SENTENCE =
  '我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元';

test('a spoken sentence yields name, city, project and price as unconfirmed suggestions', () => {
  const extracted = extractStoreFactsFromSentence(AUDIT_SENTENCE);
  assert.deepEqual(
    Object.fromEntries(extracted.map((entry) => [entry.id, entry.value])),
    {
      name: '盘点美发工作室',
      city: '市中心',
      projectName: '染发套餐',
      projectPrice: '388',
    }
  );
  assert.ok(extracted.every((entry) => entry.provenance === 'ai_suggestion'));
});

test('a price word alone is never mistaken for the project name', () => {
  const extracted = extractStoreFactsFromSentence(
    '我们店叫盘点美发工作室，在杭州市，主打透亮猫眼，日常价 299 元'
  );
  assert.deepEqual(
    Object.fromEntries(extracted.map((entry) => [entry.id, entry.value])),
    {
      name: '盘点美发工作室',
      city: '杭州市',
      projectName: '透亮猫眼',
      projectPrice: '299',
    }
  );
});

test('an empty scaffold is not treated as a store statement', () => {
  assert.deepEqual(extractStoreFactsFromSentence('项目名称：\n日常价：'), []);
  assert.deepEqual(extractStoreFactsFromSentence('   '), []);
});

test('walking forward from a stated sentence prefills empty draft fields', () => {
  const spoken = editSentence(wizard(), AUDIT_SENTENCE);
  const arranged = goToStep(experience, { ...spoken, stepIndex: 2 }, 1);
  assert.equal(arranged.draft.name, '盘点美发工作室');
  assert.equal(arranged.draft.city, '市中心');
  assert.equal(arranged.draft.projectName, '染发套餐');
  assert.equal(arranged.draft.projectPrice, '388');
  assert.ok(arranged.draft.unconfirmed.includes('name'));
  assert.equal(arranged.arrangedOrigin, 'parsed');
  assert.deepEqual(arrangementRecognizedFields(arranged), [
    'name',
    'city',
    'projectName',
    'projectPrice',
  ]);
});

test('walking onto the archive card prefills platform defaults', () => {
  const spoken = editSentence(wizard(), AUDIT_SENTENCE);
  const card = goToStep(experience, { ...spoken, stepIndex: 3 }, 1);
  assert.equal(card.draft.district, '本区');
  assert.equal(card.draft.address, '门店地址待补充');
  assert.equal(card.draft.booking, '到店咨询预约');
  assert.equal(card.draft.provenance.district, 'platform_default');
  assert.equal(card.draft.name, '盘点美发工作室');
});

test('sentence extract does not overwrite a field the merchant already typed', () => {
  const started = {
    ...editSentence(wizard(), AUDIT_SENTENCE),
    draft: { ...wizard().draft, name: '手填店名' },
  };
  const arranged = applySentenceDraft(started);
  assert.equal(arranged.draft.name, '手填店名');
  assert.equal(arranged.draft.projectPrice, '388');
});

test('LLM backfill only fills empty fields and never overwrites a user edit', () => {
  const spoken = applySentenceDraft(editSentence(wizard(), AUDIT_SENTENCE));
  const edited = {
    ...spoken,
    draft: answerProgressiveFact(spoken.draft, 'name', '手填店名'),
  };
  assert.equal(edited.draft.provenance.name, 'user');
  const filled = applyLlmSentenceSuggestions(edited, [
    { id: 'name', value: '模型想改的店名' },
    { id: 'district', value: '拱墅区' },
    { id: 'address', value: '湖墅南路 1 号' },
  ]);
  assert.equal(filled.draft.name, '手填店名');
  assert.equal(filled.draft.district, '拱墅区');
  assert.equal(filled.draft.address, '湖墅南路 1 号');
  assert.equal(filled.draft.provenance.district, 'ai_suggestion');
  assert.equal(filled.draft.provenance.name, 'user');
  assert.equal(canLlmFillDraftField(edited.draft, 'name'), false);
});

test('LLM backfill refuses to refill a field the merchant cleared', () => {
  const spoken = applySentenceDraft(editSentence(wizard(), AUDIT_SENTENCE));
  const cleared = {
    ...spoken,
    draft: {
      ...spoken.draft,
      city: '',
      provenance: { ...spoken.draft.provenance, city: 'user' as const },
    },
  };
  const filled = applyLlmSentenceSuggestions(cleared, [
    { id: 'city', value: '杭州市' },
  ]);
  assert.equal(filled.draft.city, '');
  assert.equal(filled, cleared);
});

test('LLM extract failure stays an empty suggestion list — save path is untouched', () => {
  const spoken = applySentenceDraft(editSentence(wizard(), AUDIT_SENTENCE));
  const failed = applyLlmSentenceSuggestions(spoken, []);
  assert.equal(failed, spoken);
  assert.equal(failed.draft.name, '盘点美发工作室');
  const request = extractStoreSentenceRequest(AUDIT_SENTENCE);
  assert.equal(request.action, 'extract_store_sentence');
  assert.equal(request.payload.sentence, AUDIT_SENTENCE);
  const confirmed = confirmArchiveCard({
    ...failed.draft,
    projectPriceValidity: PRICE_VALIDITY_LONG_TERM,
  });
  const finalize = buildFinalizeStoreIntakeCommand(confirmed, {
    batchId: 'intake-batch:1',
    capturedAt: '2026-08-13T00:00:00.000Z',
    expectedRevision: 0,
    referenceId: 'store-intake-wizard:1',
    regulatedDefault: false,
    taskId: 'intake-task:1',
    workspaceId: 'workspace-a',
  });
  assert.equal(finalize?.action, 'finalize_store_intake');
  assert.equal(finalize?.payload.profilePatch.name, '盘点美发工作室');
});

test('batch parse needs at least two uploaded sources', () => {
  assert.equal(canBatchParse(wizard()), false);
  assert.equal(canBatchParse({ ...wizard(), uploads: [upload] }), false);
  assert.equal(
    canBatchParse({ ...wizard(), uploads: [upload, uploadB] }),
    true
  );
});

test('fixture supply labels demo parse; closed supply fails closed', () => {
  const fixture = draftSupplyFromExperience(experience);
  assert.deepEqual(fixture, { kind: 'fixture', open: true });
  assert.equal(shouldShowFixtureParseLabel(fixture), true);
  assert.equal(isPhotoParseOpen(fixture), true);

  const closed = draftSupplyFromExperience({
    ...experience,
    draftSupply: { kind: 'production', open: false },
  });
  assert.equal(shouldShowFixtureParseLabel(closed), false);
  assert.equal(isPhotoParseOpen(closed), false);

  const production = draftSupplyFromExperience({
    ...experience,
    draftSupply: { kind: 'production', open: true },
  });
  assert.equal(shouldShowFixtureParseLabel(production), false);
  assert.equal(isPhotoParseOpen(production), true);

  assert.equal(draftSupplyFromExperience(undefined), null);
  assert.equal(isPhotoParseOpen(null), false);
  assert.equal(shouldShowFixtureParseLabel(null), false);
});

test('the parse command carries the exact bytes identity Core re-verifies', () => {
  const request = parseSingleAssetRequest({
    assetId: 'intake-asset:1',
    rightsConfirmed: false,
    target: 'price_list',
    taskId: 'task-1',
    upload,
  });
  assert.equal(request.action, 'parse_single_asset');
  assert.deepEqual(request.payload.source, {
    assetId: 'intake-asset:1',
    contentType: 'image/png',
    inputKind: 'document_image',
    objectKey: upload.objectKey,
    // Non-blocking rights prompt: unanswered travels as `unconfirmed`.
    rightsStatus: 'unconfirmed',
    sha256: upload.sha256,
    sizeBytes: 1024,
    sourceUrl: upload.sourceUrl,
    target: 'price_list',
  });
});

test('batch parse request assembles start_parse_asset_batch with unique sources', () => {
  const request = parseAssetBatchRequest({
    rightsConfirmed: true,
    target: 'price_list',
    taskId: 'batch-task-1',
    uploads: [upload, uploadB],
  });
  assert.equal(request.action, 'start_parse_asset_batch');
  assert.equal(request.payload.taskId, 'batch-task-1');
  assert.equal(request.payload.sources.length, 2);
  assert.equal(request.payload.sources[0]!.objectKey, upload.objectKey);
  assert.equal(request.payload.sources[1]!.objectKey, uploadB.objectKey);
  assert.equal(request.payload.sources[0]!.rightsStatus, 'confirmed');
  assert.notEqual(
    request.payload.sources[0]!.assetId,
    request.payload.sources[1]!.assetId
  );
  assert.deepEqual(assetParseTaskQuery('batch-task-1'), {
    action: 'asset_parse_task',
    payload: { taskId: 'batch-task-1' },
  });
  assert.deepEqual(assetParseTaskDraftsQuery('batch-task-1'), {
    action: 'asset_parse_task_drafts',
    payload: { taskId: 'batch-task-1' },
  });
});

test('batch poll stops on terminal status, attempt budget, or cancel', () => {
  assert.equal(isParseTaskTerminal('queued'), false);
  assert.equal(isParseTaskTerminal('running'), false);
  assert.equal(isParseTaskTerminal('completed'), true);
  assert.equal(isParseTaskTerminal('completed_with_fallback'), true);
  assert.equal(isParseTaskTerminal('failed'), true);

  assert.equal(
    shouldContinueBatchPolling({ attempt: 0, status: 'queued' }),
    true
  );
  assert.equal(
    shouldContinueBatchPolling({ attempt: 0, status: 'running' }),
    true
  );
  assert.equal(
    shouldContinueBatchPolling({ attempt: 0, status: 'completed' }),
    false
  );
  assert.equal(
    shouldContinueBatchPolling({ attempt: 0, status: 'failed' }),
    false
  );
  assert.equal(
    shouldContinueBatchPolling({
      attempt: BATCH_POLL_MAX_ATTEMPTS,
      status: 'running',
    }),
    false
  );
  assert.equal(
    shouldContinueBatchPolling({
      attempt: 0,
      cancelled: true,
      status: 'running',
    }),
    false
  );

  const runningTask = {
    carrierAttempt: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    disclosure: 'x',
    mode: 'batch_async' as const,
    progress: {
      completed: 1,
      message: '正在整理你上传的资料，已完成 1/2 份；离开后也会继续处理。',
      total: 2,
    },
    sourceAssetIds: ['a', 'b'],
    status: 'running' as const,
    taskId: 't1',
    updatedAt: '2026-08-05T00:00:00.000Z',
    workspaceId: 'workspace-a',
  };
  assert.equal(
    resolveBatchPollTick({ attempt: 1, task: runningTask }).kind,
    'continue'
  );
  assert.equal(
    resolveBatchPollTick({
      attempt: 1,
      task: { ...runningTask, status: 'completed' },
    }).kind,
    'completed'
  );
  assert.equal(
    resolveBatchPollTick({
      attempt: 1,
      task: { ...runningTask, status: 'failed' },
    }).kind,
    'failed'
  );
  assert.equal(
    resolveBatchPollTick({
      attempt: BATCH_POLL_MAX_ATTEMPTS,
      task: runningTask,
    }).kind,
    'timeout'
  );
  assert.equal(
    resolveBatchPollTick({ attempt: 0, cancelled: true, task: runningTask })
      .kind,
    'cancelled'
  );
  assert.ok(batchPollDelayMs(0) >= 500);
  assert.ok(batchPollDelayMs(10) <= 4_000);
});

test('batch drafts merge into progressive facts; finalize still is the only write', () => {
  const state = applyBatchDrafts({ ...wizard(), uploads: [upload, uploadB] }, [
    {
      sourceAssetId: 'a',
      draft: {
        origin: 'parsed',
        fields: [
          {
            key: 'offer.price',
            provenance: 'photo_extract',
            value: { amount: 239, currency: 'CNY' },
          },
        ],
      },
    },
    {
      sourceAssetId: 'b',
      draft: {
        origin: 'parsed',
        fields: [
          {
            key: 'service.name',
            provenance: 'photo_extract',
            value: '头皮护理',
          },
        ],
      },
    },
  ]);
  assert.equal(state.draft.projectPrice, '239');
  assert.equal(state.draft.projectName, '头皮护理');
  assert.equal(state.draft.provenance.projectPrice, 'photo_extract');
  assert.equal(state.arrangedOrigin, 'parsed');
  assert.equal(state.arrangeFailed, false);

  // Per-item confirm still leaves only through finalize_store_intake.
  // Blocking set needs name/city/project/price/validity before the builder
  // assembles a command.
  let confirmed = state.draft;
  confirmed = answerProgressiveFact(confirmed, 'name', '青禾美甲');
  confirmed = answerProgressiveFact(confirmed, 'city', '杭州');
  confirmed = answerProgressiveFact(confirmed, 'projectName', '头皮护理');
  confirmed = answerProgressiveFact(confirmed, 'projectPrice', '239');
  confirmed = answerProgressiveFact(
    confirmed,
    'projectPriceValidity',
    PRICE_VALIDITY_LONG_TERM
  );
  const request = buildFinalizeStoreIntakeCommand(confirmed, {
    batchId: 'batch-1',
    capturedAt: '2026-08-05T00:00:00.000Z',
    expectedRevision: 0,
    factRevisions: {},
    referenceId: 'store-intake-wizard:batch',
    regulatedDefault: false,
    taskId: 'task-1',
    workspaceId: 'workspace-a',
  });
  assert.equal(request?.action, 'finalize_store_intake');
  assert.ok((request?.payload.confirmations.length ?? 0) > 0);
});

test('confirming the rights prompt is recorded, not required', () => {
  const request = parseSingleAssetRequest({
    assetId: 'intake-asset:1',
    rightsConfirmed: true,
    target: 'price_list',
    taskId: 'task-1',
    upload,
  });
  assert.equal(request.payload.source.rightsStatus, 'confirmed');
});

test('the visual lane asks the server to classify, not to read a document', () => {
  const request = parseSingleAssetRequest({
    assetId: 'intake-asset:1',
    rightsConfirmed: false,
    target: 'visual_asset',
    taskId: 'task-1',
    upload,
  });
  assert.equal(request.payload.source.inputKind, 'visual_asset');
  assert.equal(request.payload.source.target, 'visual_asset');
});

test('the four-slot classification is carried through verbatim from the server', () => {
  const state = applyArrangedDraft(
    { ...wizard(), target: 'visual_asset' },
    {
      fields: [
        {
          key: 'asset.slot',
          provenance: 'ai_suggestion',
          value: 'store_scene',
        },
      ],
      origin: 'ai_suggestion',
      visualClassification: {
        slot: 'store_scene',
        description: '门店环境照片',
        rightsPrompt: {
          message: '发布前记得确认你有这张图的使用权。',
          skippable: true,
          blocking: false,
        },
      },
    }
  );

  assert.equal(state.classification?.slot, 'store_scene');
  // `blocking: false` is the contract's own word for "prompt, not gate".
  assert.equal(state.classification?.rightsPrompt.blocking, false);
  // A classification is not a store fact: nothing lands in the confirm list.
  assert.deepEqual(arrangementRecognizedFields(state), []);
});

test('the manual fallback re-opens the same source with the same field schema', () => {
  const draft = answerProgressiveFact(
    answerProgressiveFact(createProgressiveFactDraft(), 'name', '青禾美甲'),
    'projectPrice',
    '239'
  );
  const request = prepareManualDraftRequest({
    assetId: 'intake-asset:1',
    draft,
    rightsConfirmed: false,
    sentence: '头疗 239',
    target: 'price_list',
    taskId: 'task-1',
    upload,
  });
  assert.equal(request.action, 'prepare_manual_asset_draft');
  assert.equal(request.payload.source.objectKey, upload.objectKey);
  assert.deepEqual(request.payload.fields, [
    { key: 'store.profile.name', value: '青禾美甲' },
    { key: 'service.price', value: '239' },
    { key: 'store.profile.summary', value: '头疗 239' },
  ]);
});

test('a photo-extracted price lands unconfirmed and keeps its origin', () => {
  const state = applyArrangedDraft(wizard(), {
    fields: [
      {
        key: 'offer.price',
        provenance: 'photo_extract',
        value: { amount: 239, currency: 'CNY' },
      },
    ],
    origin: 'parsed',
  });

  assert.equal(state.draft.projectPrice, '239');
  assert.equal(state.draft.provenance.projectPrice, 'photo_extract');
  assert.ok(state.draft.unconfirmed.includes('projectPrice'));
  assert.ok(!state.draft.answered.includes('projectPrice'));
  assert.deepEqual(arrangementRecognizedFields(state), ['projectPrice']);
  assert.equal(state.arrangeFailed, false);
});

test('a fallback draft is reported as a failed read, not as a result', () => {
  const state = applyArrangedDraft(wizard(), {
    fields: [
      { key: 'fallback.message', provenance: 'ai_suggestion', value: '看不清' },
    ],
    origin: 'fallback',
  });
  assert.equal(state.arrangeFailed, true);
  assert.deepEqual(arrangementRecognizedFields(state), []);
});

test('unmapped draft keys never invent a field', () => {
  assert.deepEqual(
    draftPrefillEntries({
      fields: [
        {
          key: 'price_list.summary',
          provenance: 'photo_extract',
          value: '随便',
        },
      ],
    }),
    []
  );
});

test('confirming an extracted value unchanged keeps photo provenance; editing makes it the merchant’s', () => {
  const extracted = applyExtractedFacts(createProgressiveFactDraft(), [
    { id: 'projectPrice', provenance: 'photo_extract', value: '239' },
  ]);
  const kept = answerProgressiveFact(extracted, 'projectPrice', '239');
  assert.equal(kept.provenance.projectPrice, 'photo_extract');
  const edited = answerProgressiveFact(extracted, 'projectPrice', '259');
  assert.equal(edited.provenance.projectPrice, 'user');
});

test('an extracted archive card reaches finalize after one batch confirm', () => {
  const extracted = applyExtractedFacts(createProgressiveFactDraft(), [
    { id: 'name', provenance: 'photo_extract', value: '青禾美甲' },
    { id: 'city', provenance: 'photo_extract', value: '杭州' },
    { id: 'projectName', provenance: 'photo_extract', value: '头皮护理' },
    { id: 'projectPrice', provenance: 'photo_extract', value: '239' },
  ]);
  const options = {
    batchId: 'batch-1',
    capturedAt: '2026-07-27T00:00:00.000Z',
    expectedRevision: 1,
    referenceId: 'store-intake-wizard:1',
    taskId: 'task-1',
    workspaceId: 'workspace-a',
  };

  assert.equal(buildFinalizeStoreIntakeCommand(extracted, options), null);

  const withValidity = {
    ...extracted,
    projectPriceValidity: PRICE_VALIDITY_LONG_TERM,
  };
  assert.equal(buildFinalizeStoreIntakeCommand(withValidity, options), null);

  const confirmed = confirmArchiveCard(withValidity);
  const request = buildFinalizeStoreIntakeCommand(confirmed, options);
  assert.equal(request?.action, 'finalize_store_intake');
  assert.equal(request?.payload.confirmations.length, 4);
  assert.equal(
    request?.payload.profilePatch.projects?.upsert?.[0]?.priceValidUntil,
    null
  );
  assert.equal(request?.payload.fieldProvenance?.name, 'ai_suggestion');
});

/* ---------------------------- import candidates --------------------------- */

const store: StoreProfile = {
  accounts: [],
  address: '湖墅南路 88 号',
  booking: '提前一天私信预约',
  brandVoice: '克制',
  city: '杭州',
  district: '拱墅区',
  name: '青禾美甲',
  prohibitions: [],
  projects: [
    {
      confirmed: true,
      durationMinutes: 75,
      id: 'legacy-primary',
      name: '透亮猫眼护理',
      price: 299,
    },
  ],
  regulated: false,
  revision: 2,
};

function importBatch(): AssetIntakeBatch {
  const source = {
    kind: 'import' as const,
    referenceId: 'store-profile-confirmation:workspace-a:2',
    capturedAt: '2026-05-04T02:00:00.000Z',
  };
  return {
    batchId: 'store-profile-import:2',
    workspaceId: 'workspace-a',
    taskId: 'store-profile-import-task:2',
    source: {
      sourceId: 'store-profile-import-source:2',
      kind: 'import',
      referenceId: source.referenceId,
      capabilityStatus: 'assisted',
      sourceWorkspaceId: 'workspace-a',
      capturedAt: source.capturedAt,
      example: false,
    },
    summary: '已从门店档案整理出 3 项待确认资料。',
    candidates: [
      {
        candidateId: 'store-profile:name:other:import',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'other',
          key: 'store.profile.name',
          value: { name: '青禾美甲' },
          scope: { storeId: 'workspace-a' },
          source,
          effectiveFrom: source.capturedAt,
          expiresAt: null,
        },
      },
      {
        candidateId: 'store-project:legacy-primary:service:import',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'service',
          key: 'service.legacy-primary.name',
          value: { name: '透亮猫眼护理' },
          scope: { storeId: 'workspace-a', serviceId: 'legacy-primary' },
          source,
          effectiveFrom: source.capturedAt,
          expiresAt: null,
        },
      },
      {
        candidateId: 'store-project:legacy-primary:price:import',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.legacy-primary.price',
          value: { amount: 299, currency: 'CNY' },
          scope: { storeId: 'workspace-a', serviceId: 'legacy-primary' },
          source,
          effectiveFrom: source.capturedAt,
          expiresAt: null,
        },
      },
    ],
    createdAt: source.capturedAt,
  };
}

test('a project import is one confirmable unit, a profile field is its own', () => {
  const groups = importCandidateGroups(importBatch());
  assert.deepEqual(
    groups.map((group) => group.groupId),
    ['profile:name', 'project:legacy-primary']
  );
  assert.equal(groups[1]!.confirmations.length, 2);
  assert.equal(groups[1]!.value, '299');
});

test('a half-staged project stays confirmable for the stream that is missing', () => {
  // The service fact is already in the ledger, so import only stages the price.
  const batch = importBatch();
  batch.candidates = batch.candidates.filter(
    (candidate) => !candidate.candidateId.endsWith(':service:import')
  );
  const groups = importCandidateGroups(batch);
  assert.deepEqual(
    groups.map((group) => group.groupId),
    ['profile:name', 'project:legacy-primary']
  );
  assert.equal(groups[1]!.confirmations.length, 1);

  const request = buildImportFinalizeCommand({
    batch,
    selectedGroupIds: ['project:legacy-primary'],
    store,
  });
  // The upsert still travels — Core matches the unconfirmed half against the
  // fact already standing in the ledger rather than demanding it twice.
  assert.deepEqual(request?.payload.profilePatch, {
    expectedRevision: 2,
    projects: { upsert: [store.projects[0]] },
  });
  assert.deepEqual(
    request?.payload.confirmations.map((confirmation) => confirmation.factId),
    ['store-project:legacy-primary:price']
  );
});

test('the import confirmation echoes the stored profile, never an edit buffer', () => {
  const request = buildImportFinalizeCommand({
    batch: importBatch(),
    selectedGroupIds: ['profile:name', 'project:legacy-primary'],
    store,
  });
  assert.equal(request?.action, 'finalize_store_intake');
  assert.deepEqual(request?.payload.batch, {
    batchId: 'store-profile-import:2',
  });
  assert.deepEqual(request?.payload.profilePatch, {
    expectedRevision: 2,
    name: '青禾美甲',
    projects: { upsert: [store.projects[0]] },
  });
  assert.deepEqual(
    request?.payload.confirmations.map((confirmation) => confirmation.factId),
    [
      'store-profile:name:other',
      'store-project:legacy-primary:service',
      'store-project:legacy-primary:price',
    ]
  );
});

test('deselecting every group produces no command', () => {
  assert.equal(
    buildImportFinalizeCommand({
      batch: importBatch(),
      selectedGroupIds: [],
      store,
    }),
    null
  );
});
