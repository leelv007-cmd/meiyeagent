/**
 * ResultShellModel phase / action matrix pure tests (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  desktopVisibleActions,
  mobileVisibleActions,
  projectResultShellActions,
  projectResultShellModel,
  projectResultShellPhase,
  projectResultShellView,
  shellViewFromResolveOutcome,
  type ResultShellFacts,
} from './result-shell-model';

function baseFacts(
  overrides: Partial<ResultShellFacts> = {}
): ResultShellFacts {
  return {
    target: { workId: 'work-1' },
    workspaceKind: 'copy',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase matrix
// ---------------------------------------------------------------------------

test('phase: running progress → running', () => {
  assert.equal(
    projectResultShellPhase(baseFacts({ progressState: 'running' })),
    'running'
  );
  assert.equal(
    projectResultShellPhase(baseFacts({ progressState: 'waiting' })),
    'running'
  );
});

test('phase: suspended / needsUserChoice → needs_input or running', () => {
  assert.equal(
    projectResultShellPhase(
      baseFacts({ progressState: 'suspended', needsUserChoice: true })
    ),
    'needs_input'
  );
  assert.equal(
    projectResultShellPhase(baseFacts({ needsUserChoice: true })),
    'needs_input'
  );
});

test('phase: acceptance_unknown wins over ready candidates', () => {
  assert.equal(
    projectResultShellPhase(
      baseFacts({
        acceptanceUnknown: true,
        hasUsableCandidate: true,
        progressState: 'success',
      })
    ),
    'needs_input'
  );
});

test('phase: failed progress → failed', () => {
  assert.equal(
    projectResultShellPhase(baseFacts({ progressState: 'failed' })),
    'failed'
  );
});

test('phase: delivered attempt → delivered', () => {
  assert.equal(
    projectResultShellPhase(
      baseFacts({
        progressState: 'success',
        hasAdoptedCandidate: true,
        deliveryAttempt: 'delivered',
      })
    ),
    'delivered'
  );
});

test('phase: partial delivery → needs_input (not delivered)', () => {
  assert.equal(
    projectResultShellPhase(
      baseFacts({
        progressState: 'success',
        deliveryAttempt: 'partial',
      })
    ),
    'needs_input'
  );
});

test('phase: success with candidates → ready', () => {
  assert.equal(
    projectResultShellPhase(
      baseFacts({
        progressState: 'success',
        hasUsableCandidate: true,
      })
    ),
    'ready'
  );
});

// ---------------------------------------------------------------------------
// Action matrix
// ---------------------------------------------------------------------------

test('actions: running → leave_and_continue primary', () => {
  const phase = projectResultShellPhase(
    baseFacts({ progressState: 'running' })
  );
  const actions = projectResultShellActions(
    phase,
    baseFacts({ progressState: 'running' })
  );
  assert.equal(actions.primaryAction?.id, 'leave_and_continue');
});

test('actions: suspended running → handle_current_issue primary', () => {
  const facts = baseFacts({
    progressState: 'suspended',
    needsUserChoice: true,
  });
  const phase = projectResultShellPhase(facts);
  const actions = projectResultShellActions(phase, facts);
  assert.equal(actions.primaryAction?.id, 'handle_current_issue');
});

test('actions: ready usable candidate → adopt primary with copy label', () => {
  const facts = baseFacts({
    progressState: 'success',
    hasUsableCandidate: true,
    hasAdoptedCandidate: false,
  });
  const phase = projectResultShellPhase(facts);
  const actions = projectResultShellActions(phase, facts);
  assert.equal(actions.primaryAction?.id, 'adopt_candidate');
  assert.equal(actions.primaryAction?.label, '采用此版本');
  assert.ok(actions.secondaryActions.some((a) => a.id === 'continue_adjust'));
  assert.equal(
    actions.secondaryActions.some((a) => a.id === 'deliver'),
    false
  );
});

test('actions: image adopt label differs', () => {
  const facts = baseFacts({
    workspaceKind: 'image',
    progressState: 'success',
    hasUsableCandidate: true,
  });
  const actions = projectResultShellActions('ready', facts);
  assert.equal(actions.primaryAction?.label, '采用这组');
});

test('actions: video adopt label differs', () => {
  const facts = baseFacts({
    workspaceKind: 'video',
    progressState: 'success',
    hasUsableCandidate: true,
  });
  const actions = projectResultShellActions('ready', facts);
  assert.equal(actions.primaryAction?.label, '使用此成片');
  assert.deepEqual(actions.secondaryActions, []);
});

test('actions: video receiver removes editing and regeneration but keeps derivation', () => {
  const adopted = baseFacts({
    workspaceKind: 'video',
    progressState: 'success',
    hasAdoptedCandidate: true,
    hasUsableCandidate: false,
    hasDeliverableVariant: true,
  });
  const adoptedActions = projectResultShellActions('ready', adopted);
  assert.equal(adoptedActions.primaryAction?.id, 'deliver');
  assert.deepEqual(
    adoptedActions.secondaryActions.map((action) => action.id),
    ['create_from_this']
  );

  const deliveredActions = projectResultShellActions('delivered', {
    ...adopted,
    deliveryAttempt: 'delivered',
  });
  assert.equal(deliveredActions.primaryAction?.id, 'create_from_this');
  assert.deepEqual(deliveredActions.secondaryActions, []);

  for (const [label, phase, overrides] of [
    [
      'suspended receive',
      'running',
      { progressState: 'suspended', needsUserChoice: false },
    ],
    [
      'supplier input',
      'needs_input',
      { progressState: 'suspended', needsUserChoice: true },
    ],
    ['failed receive', 'failed', { progressState: 'failed' }],
  ] as const) {
    const actions = projectResultShellActions(phase, {
      ...baseFacts(),
      workspaceKind: 'video',
      ...overrides,
    });
    assert.equal(
      actions.primaryAction?.id,
      'leave_and_continue',
      `${label} must not create or adjust video`
    );
    assert.equal(
      actions.secondaryActions.some(
        (candidate) =>
          candidate.id === 'continue_adjust' ||
          candidate.id === 'handle_current_issue' ||
          candidate.id === 'retry'
      ),
      false,
      `${label} has no video editing or regeneration fallback`
    );
  }

  for (const [label, deliveryAttempt] of [
    ['awaiting approval', 'awaiting_approval'],
    ['partial delivery', 'partial'],
    ['failed delivery', 'failed'],
  ] as const) {
    const actions = projectResultShellActions('needs_input', {
      ...baseFacts(),
      workspaceKind: 'video',
      deliveryAttempt,
    });
    assert.equal(
      actions.primaryAction?.id,
      'deliver',
      `${label} returns to delivery rather than video adjustment`
    );
    assert.deepEqual(actions.secondaryActions, []);
  }

  const recoverable = projectResultShellActions('needs_input', {
    ...baseFacts(),
    acceptanceUnknown: true,
    progressState: 'suspended',
    workspaceKind: 'video',
  });
  assert.equal(recoverable.primaryAction?.id, 'recover_or_verify');
  assert.equal(
    [
      recoverable.primaryAction,
      ...recoverable.secondaryActions,
      ...recoverable.overflowActions,
    ].some(
      (action) => action?.id === 'retry' || action?.id === 'continue_adjust'
    ),
    false
  );
});

test('actions: adopted without a platform variant cannot enter delivery', () => {
  const facts = baseFacts({
    progressState: 'success',
    hasUsableCandidate: false,
    hasAdoptedCandidate: true,
    deliveryAttempt: 'none',
  });
  const actions = projectResultShellActions('ready', facts);
  assert.equal(actions.primaryAction?.id, 'continue_adjust');
  assert.equal(
    actions.secondaryActions.some((candidate) => candidate.id === 'deliver'),
    false
  );
});

test('actions: adopted with a platform variant → deliver primary', () => {
  const facts = {
    ...baseFacts({
      progressState: 'success',
      hasUsableCandidate: false,
      hasAdoptedCandidate: true,
      deliveryAttempt: 'none',
    }),
    hasDeliverableVariant: true,
  } as ResultShellFacts & { hasDeliverableVariant: boolean };
  const actions = projectResultShellActions('ready', facts);
  assert.equal(actions.primaryAction?.id, 'deliver');
});

test('actions: delivered → create_from_this primary with real History/Run Detail overflow', () => {
  const facts = baseFacts({ deliveryAttempt: 'delivered' });
  const actions = projectResultShellActions('delivered', facts);
  assert.equal(actions.primaryAction?.id, 'create_from_this');
  // Primary stays unique — History / Run Detail live in overflow only.
  assert.equal(
    actions.overflowActions.some((item) => item.id === 'open_history'),
    true
  );
  assert.equal(
    actions.overflowActions.some((item) => item.id === 'open_run_detail'),
    true
  );
  assert.equal(
    actions.secondaryActions.some(
      (item) => item.id === 'open_history' || item.id === 'open_run_detail'
    ),
    false
  );
  assert.equal(
    actions.primaryAction?.id === 'create_from_this' &&
      !actions.overflowActions.some((item) => item.id === 'create_from_this'),
    true
  );
});

test('actions: every merchant phase keeps a single primary and real History/Run Detail', () => {
  const matrix: Array<{
    label: string;
    facts: ResultShellFacts;
    primary: string;
  }> = [
    {
      label: 'running',
      facts: baseFacts({ progressState: 'running' }),
      primary: 'leave_and_continue',
    },
    {
      label: 'waiting_suspended',
      facts: baseFacts({
        progressState: 'suspended',
        needsUserChoice: true,
      }),
      primary: 'handle_current_issue',
    },
    {
      label: 'recoverable_failure',
      facts: baseFacts({ progressState: 'failed', jobId: 'job-1' }),
      primary: 'retry',
    },
    {
      label: 'candidate',
      facts: baseFacts({
        progressState: 'success',
        hasUsableCandidate: true,
        hasAdoptedCandidate: false,
      }),
      primary: 'adopt_candidate',
    },
    {
      label: 'accepted',
      facts: baseFacts({
        progressState: 'success',
        hasAdoptedCandidate: true,
        hasDeliverableVariant: true,
        deliveryAttempt: 'none',
      }),
      primary: 'deliver',
    },
    {
      label: 'delivered',
      facts: baseFacts({ deliveryAttempt: 'delivered' }),
      primary: 'create_from_this',
    },
    {
      label: 'published_as_delivered',
      facts: baseFacts({
        deliveryAttempt: 'delivered',
        hasAdoptedCandidate: true,
      }),
      primary: 'create_from_this',
    },
  ];

  for (const row of matrix) {
    const phase = projectResultShellPhase(row.facts);
    const actions = projectResultShellActions(phase, row.facts);
    assert.equal(
      actions.primaryAction?.id,
      row.primary,
      `${row.label} primary`
    );
    // Dead CTA gate: the single primary must stay enabled for every merchant phase.
    assert.equal(
      actions.primaryAction?.enabled,
      true,
      `${row.label} primary enabled`
    );
    assert.equal(
      actions.overflowActions.some((item) => item.id === 'open_history'),
      true,
      `${row.label} history`
    );
    assert.equal(
      actions.overflowActions.some((item) => item.id === 'open_run_detail'),
      true,
      `${row.label} run detail`
    );
  }
});

test('actions: failed → retry primary', () => {
  const actions = projectResultShellActions(
    'failed',
    baseFacts({ progressState: 'failed', jobId: 'job-1' })
  );
  assert.equal(actions.primaryAction?.id, 'retry');
});

// #350: Composer copy/image works never get a `p1_creative_jobs` row, and the
// retry handler is `if (!selected?.job) return;`. Offering 重试 there is a
// button that swallows the click. Fall back to the exit the video branch of
// this same phase already uses.
test('actions: a failed run with no retryable Job offers no retry', () => {
  const actions = projectResultShellActions(
    'failed',
    baseFacts({ progressState: 'failed' })
  );
  assert.equal(actions.primaryAction?.id, 'leave_and_continue');
  assert.equal(actions.primaryAction?.label, '返回工作台');
  assert.equal(
    [
      actions.primaryAction,
      ...actions.secondaryActions,
      ...actions.overflowActions,
    ].some((candidate) => candidate?.id === 'retry'),
    false
  );
});

test('actions: a failed delivery with no retryable Job offers no retry', () => {
  const actions = projectResultShellActions(
    'delivered',
    baseFacts({ deliveryAttempt: 'failed' })
  );
  assert.notEqual(actions.primaryAction?.id, 'retry');
  assert.equal(
    [
      actions.primaryAction,
      ...actions.secondaryActions,
      ...actions.overflowActions,
    ].some((candidate) => candidate?.id === 'retry'),
    false
  );
});

// #353: `retry` dispatches `retry_creative_job` in every branch it appears in —
// a billable fresh creative run on the Operations executor, never a second
// delivery attempt. The cure for a failed delivery is the delivery panel, which
// runs off the ContentPackage and needs no Job at all. Same house rule the video
// branch of this same condition already follows.
test('actions: a failed delivery returns to delivery, Job or no Job', () => {
  for (const facts of [
    baseFacts({ deliveryAttempt: 'failed', jobId: 'job-1' }),
    baseFacts({ deliveryAttempt: 'failed' }),
  ]) {
    const actions = projectResultShellActions(
      projectResultShellPhase(facts),
      facts
    );
    assert.equal(actions.primaryAction?.id, 'deliver');
    assert.equal(actions.primaryAction?.label, '处理交付问题');
    assert.equal(
      [
        actions.primaryAction,
        ...actions.secondaryActions,
        ...actions.overflowActions,
      ].some((candidate) => candidate?.id === 'retry'),
      false
    );
  }
});

test('actions: acceptance_unknown → recover_or_verify only', () => {
  const facts = baseFacts({ acceptanceUnknown: true });
  const actions = projectResultShellActions('needs_input', facts);
  assert.equal(actions.primaryAction?.id, 'recover_or_verify');
});

test('actions: desktop budget ≤1 primary + ≤3 secondary', () => {
  const shell = projectResultShellModel(
    baseFacts({
      progressState: 'success',
      hasUsableCandidate: true,
    })
  );
  const visible = desktopVisibleActions(shell);
  assert.ok(visible.primary);
  assert.ok(visible.secondary.length <= 3);
});

test('actions: mobile budget 1 primary + more (no third conditional)', () => {
  const shell = projectResultShellModel(
    baseFacts({
      progressState: 'success',
      hasUsableCandidate: true,
    })
  );
  const visible = mobileVisibleActions(shell);
  assert.ok(visible.primary);
  assert.ok(visible.more.length >= 1);
});

// ---------------------------------------------------------------------------
// Composed sub-projections
// ---------------------------------------------------------------------------

test('view composes harness candidates without inventing a Result entity', () => {
  const view = projectResultShellView(
    baseFacts({
      progressState: 'success',
      hasUsableCandidate: true,
      harnessPackage: {
        currentVersionId: 'v1',
        harnessSelection: {
          recommendedCandidateId: 'c-primary',
          adoptedCandidateId: undefined,
        },
        versions: [
          {
            id: 'v1',
            title: '主推',
            body: '正文',
            harnessCandidateId: 'c-primary',
            harnessScore: 0.9,
            orderedAssetIds: [],
          },
          {
            id: 'v2',
            title: '备选',
            body: '备选正文',
            harnessCandidateId: 'c-alt',
            harnessScore: 0.7,
            orderedAssetIds: [],
          },
        ],
      },
    })
  );
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;
  assert.equal(view.sub.candidates?.primary.title, '主推');
  assert.equal(view.sub.candidates?.alternatives.length, 1);
  assert.equal(view.shell.phase, 'ready');
  assert.equal(view.shell.primaryAction?.id, 'adopt_candidate');
});

test('view composes stream phase for running copy', () => {
  const drafting = projectResultShellView(
    baseFacts({ progressState: 'running', hasFirstToken: true })
  );
  assert.equal(drafting.kind, 'ready');
  if (drafting.kind !== 'ready') return;
  assert.equal(drafting.sub.streamPhase, 'drafting');
  assert.equal(drafting.sub.hasFirstToken, true);
  assert.equal(drafting.sub.a11yAnnouncement, '正在生成内容');

  const awaiting = projectResultShellView(
    baseFacts({
      progressState: 'suspended',
      needsUserChoice: true,
    })
  );
  assert.equal(awaiting.kind, 'ready');
  if (awaiting.kind !== 'ready') return;
  assert.equal(awaiting.sub.streamPhase, 'awaiting_confirmation');

  // A finished run is neither drafting nor waiting — the Result Center must
  // not present delivered copy as still streaming.
  const finished = projectResultShellView(
    baseFacts({ progressState: 'success', hasFirstToken: true })
  );
  assert.equal(finished.kind, 'ready');
  if (finished.kind !== 'ready') return;
  assert.equal(finished.sub.streamPhase, 'completed');
});

test('view composes delivery capability sub-projection', () => {
  const view = projectResultShellView(
    baseFacts({
      progressState: 'success',
      hasAdoptedCandidate: true,
      deliveryCapability: {
        mode: 'assisted',
        platform: 'xiaohongshu',
        reason: 'no automatic adapter',
      },
    })
  );
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;
  assert.equal(view.sub.deliveryCapability?.mode, 'assisted');
});

test('shellViewFromResolveOutcome not_found never becomes ready shell', () => {
  const view = shellViewFromResolveOutcome(
    {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message: 'Work was not found for the requested workId.',
      requested: { workId: 'missing' },
    },
    { workspaceKind: 'copy' }
  );
  assert.equal(view.kind, 'error');
  if (view.kind !== 'error') return;
  assert.equal(view.code, 'NOT_FOUND');
  assert.equal(view.requested.workId, 'missing');
});

test('requested panel is honored when valid', () => {
  const shell = projectResultShellModel(
    baseFacts({
      progressState: 'success',
      hasAdoptedCandidate: true,
      requestedPanel: 'delivery',
    })
  );
  assert.equal(shell.panel, 'delivery');
});
