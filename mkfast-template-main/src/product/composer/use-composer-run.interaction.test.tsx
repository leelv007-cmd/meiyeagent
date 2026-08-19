import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  ComposerSubmissionSignedFields,
} from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, useRef, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import { P1RequestError } from '@/p1/client';

import { createBriefSurfaceState } from './brief-surface';
import { fixtureBriefProjection } from './brief-surface.fixture';
import {
  bindQuoteView,
  createComposerLensState,
  selectLens,
  updateUserText,
} from './lens-state-machine';
import { productQuoteFixture } from './quote-fixture.test-helper';
import { projectComposerQuoteView } from './quote-wiring';
import { createComposerSession } from './composer-session';
import { type ComposerRunTransports, useComposerRun } from './use-composer-run';
import type { ComposerDestinationPreflightState } from './composer-destination-preflight';
import type { ComposerGroundingBlocker } from './composer-grounding-blocker';

/**
 * A failed run used to say two different things at once: `createWork.onError`
 * fired a toast while `createWork.isError` rendered an alert under the send
 * button, so one failure produced 「操作未完成」 and 「暂时无法建立创作记录」 side by
 * side (live-tested 2026-08-07). The inline alert is the surface that keeps —
 * it sits where she clicked and it stays put — so these tests hold the toast
 * channel silent on the failure paths.
 */
const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

const QUOTE = productQuoteFixture({
  billingMode: 'per_request',
  catalogModelId: 'model-copy-1',
  catalogModelRevision: 'model-copy-1@1',
  quoteId: 'quote-1',
  revision: 'server-revision-1',
  quotePolicyRevision: 'policy-1',
  confirmedAmount: 1,
  authorizedCeiling: 1,
});
QUOTE.creditCost = 1;

const RECIPE = {
  delivery: {
    contentPackagePlatform: 'xiaohongshu',
    deliverableKind: 'copy_document',
    distributionTarget: 'export',
    quantity: 1,
  },
  lensId: 'copy',
  modelPolicy: { mode: 'auto' },
  recipeId: 'recipe-copy',
  revisionId: 'recipe-copy@1',
  status: 'published',
} as BrowserRecipeProjection;

const SIGNED_SUBMISSION: ComposerSubmissionSignedFields = {
  catalogModel: { id: 'model-copy-1', revision: 'model-copy-1@1' },
  contentPackagePlatform: 'xiaohongshu',
  creationMode: 'customized',
  deliverable: { kind: 'copy_document', quantity: 1 },
  distributionTarget: 'export',
  intent: '写一条周末护理文案',
  recipe: { id: RECIPE.recipeId, revision: RECIPE.revisionId },
};

function createTransports() {
  const projection = fixtureBriefProjection({
    confirmationValid: true,
    requiresBrief: false,
  });
  return {
    admitRun: vi.fn(async ({ loadProjection }) => {
      await loadProjection();
      return { kind: 'admitted' as const };
    }),
    loadCreditProjection: vi.fn(async () => ({
      credits: {
        grantedCredits: 20,
        usedCredits: 0,
        refundedCredits: 0,
        expiredCredits: 0,
        availableCredits: 20,
        soonestExpiringLot: null,
      },
      plan: { tier: 'trial' as const },
    })),
    mapDestination: vi.fn(),
    requestBrief: vi.fn(async () => projection),
    submitSubmission: vi.fn(async () => ({
      contentPackage: { id: 'package-1' },
      runId: 'run-authoritative',
      task: { id: 'task-1' },
      threadId: 'thread-authoritative',
      work: { id: 'work-1' },
    })),
    submitCampaign: vi.fn(async () => {
      throw new Error('Campaign transport is not used in this fixture.');
    }),
    syncBrief: vi.fn(async () => ({
      briefContextId: 'composer:session-1',
      currentRevisions: projection.bindRevisions,
      revision: 1,
    })),
  } as ComposerRunTransports;
}

test('attemptSubmit passes all gates and creates through injected transports', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const transports = createTransports();
  const onAgentBinding = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const initialLens = bindQuoteView(
        updateUserText(
          selectLens(createComposerLensState(), 'copy'),
          SIGNED_SUBMISSION.intent
        ),
        projectComposerQuoteView(QUOTE, 1)
      );
      const [lensState, setLensState] = useState(initialLens);
      const [session, setSession] = useState(() =>
        createComposerSession('session-1')
      );
      const [briefState, setBriefState] = useState(() =>
        createBriefSurfaceState()
      );
      const [, setBriefPending] = useState(false);
      const [, setDestinationMapPending] = useState(false);
      const [destinationPreflight, setDestinationPreflight] =
        useState<ComposerDestinationPreflightState | null>(null);
      const [, setShowRequiredHint] = useState(false);
      const [, setSubmissionGroundingBlocked] =
        useState<ComposerGroundingBlocker | null>(null);
      const [, setSubmissionQuotaBlocked] = useState(false);
      const [, setSubmitBlockedMessage] = useState<string | null>(null);
      const armedQuoteIdRef = useRef<string | null>(null);
      const briefContextRevisionRef = useRef<number | null>(null);
      const briefInputRef = useRef(null);
      const destinationAutoSubmitIntentRef = useRef<string | null>(null);
      const destinationMapPendingRef = useRef(false);
      const focusIntentAfterPrefillRef = useRef(false);
      const sessionIdRef = useRef('session-1');
      const run = useComposerRun({
        agentThreadId: 'thread-previous',
        armedQuoteIdRef,
        briefContextRevisionRef,
        briefInputRef,
        briefState,
        creationMode: 'customized',
        creditProjectionQueryKey: ['credits'],
        currentQuoteView: projectComposerQuoteView(QUOTE, 1),
        destinationAutoSubmitIntentRef,
        destinationMapPendingRef,
        destinationPreflight,
        fixtureSubmit: false,
        flushQuoteSettle: vi.fn(),
        focusIntentAfterPrefillRef,
        imageCardinalityValid: true,
        lensState,
        missingGrounding: [],
        onAgentBinding,
        productGroundingReady: true,
        quotaBlocked: false,
        quote: QUOTE,
        quoteId: QUOTE.quoteId,
        quoteSettling: false,
        recipe: RECIPE,
        sessionIdRef,
        setBriefPending,
        setBriefState,
        setDestinationMapPending,
        setDestinationPreflight,
        setLensState,
        setSession,
        setShowRequiredHint,
        setSubmissionGroundingBlocked,
        setSubmissionQuotaBlocked,
        setSubmitBlockedMessage,
        signedSubmission: SIGNED_SUBMISSION,
        submissionDelivery: {
          deliverableKind: 'copy_document',
          platform: 'xiaohongshu',
        },
        submissionQuantity: 1,
        submissionSettings: { ...lensState.draft.settings },
        styleReferenceAssetIds: [],
        surface: {
          contentHash: 'surface-hash-1',
          recipeRefs: [],
          recipes: [],
          revision: 1,
          revisionId: 'surface-1',
          status: 'published',
          surfaceId: 'surface.home.launch',
        } as BrowserSurfaceProjection,
        transports,
        viralJourneyActive: false,
        viralSubmissionRecipeReady: false,
      });
      return { lensState, run, session };
    },
    { wrapper }
  );

  await act(() => view.result.current.run.attemptSubmit());
  await waitFor(() =>
    expect(transports.submitSubmission).toHaveBeenCalledOnce()
  );

  expect(transports.syncBrief).toHaveBeenCalledOnce();
  expect(transports.requestBrief).toHaveBeenCalledTimes(2);
  expect(transports.admitRun).toHaveBeenCalledOnce();
  expect(transports.loadCreditProjection).toHaveBeenCalled();
  expect(transports.submitSubmission).toHaveBeenCalledWith(
    expect.objectContaining({ agentThreadId: 'thread-previous' })
  );
  expect(onAgentBinding).toHaveBeenCalledWith({
    threadId: 'thread-authoritative',
    runId: 'run-authoritative',
  });
  expect(view.result.current.session.task).toEqual({
    agentRunId: 'run-authoritative',
    agentThreadId: 'thread-authoritative',
    packageId: 'package-1',
    taskId: 'task-1',
    workId: 'work-1',
  });
  expect(view.result.current.lensState.phase).toBe('frozen');
});

/**
 * One submission run under injected transports. Both failure tests below read
 * the same surfaces, so the harness is shared rather than copied.
 */
function renderSubmissionRun(
  transports: ComposerRunTransports,
  extras: {
    missingRequiredSourceSlots?: Array<{
      slot: string;
      required: boolean;
      kinds?: string[];
    }>;
    storeFactsPending?: boolean;
    onRevealStoreFacts?: () => void;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      const initialLens = bindQuoteView(
        updateUserText(
          selectLens(createComposerLensState(), 'copy'),
          SIGNED_SUBMISSION.intent
        ),
        projectComposerQuoteView(QUOTE, 1)
      );
      const [lensState, setLensState] = useState(initialLens);
      const [session, setSession] = useState(() =>
        createComposerSession('session-1')
      );
      const [briefState, setBriefState] = useState(() =>
        createBriefSurfaceState()
      );
      const [, setBriefPending] = useState(false);
      const [, setDestinationMapPending] = useState(false);
      const [destinationPreflight, setDestinationPreflight] =
        useState<ComposerDestinationPreflightState | null>(null);
      const [, setShowRequiredHint] = useState(false);
      const [submissionGroundingBlocked, setSubmissionGroundingBlocked] =
        useState<ComposerGroundingBlocker | null>(null);
      const [sourceSlotGuidance, setSourceSlotGuidance] = useState(false);
      const [, setSubmissionQuotaBlocked] = useState(false);
      const [, setSubmitBlockedMessage] = useState<string | null>(null);
      const armedQuoteIdRef = useRef<string | null>(null);
      const briefContextRevisionRef = useRef<number | null>(null);
      const briefInputRef = useRef(null);
      const destinationAutoSubmitIntentRef = useRef<string | null>(null);
      const destinationMapPendingRef = useRef(false);
      const focusIntentAfterPrefillRef = useRef(false);
      const sessionIdRef = useRef('session-1');
      const run = useComposerRun({
        armedQuoteIdRef,
        briefContextRevisionRef,
        briefInputRef,
        briefState,
        // Free creation is the mode that reaches the server without a store
        // pre-check (`missingGrounding` is empty here for that reason).
        creationMode: 'free',
        creditProjectionQueryKey: ['credits'],
        currentQuoteView: projectComposerQuoteView(QUOTE, 1),
        destinationAutoSubmitIntentRef,
        destinationMapPendingRef,
        destinationPreflight,
        fixtureSubmit: false,
        flushQuoteSettle: vi.fn(),
        focusIntentAfterPrefillRef,
        imageCardinalityValid: true,
        lensState,
        missingGrounding: [],
        missingRequiredSourceSlots: extras.missingRequiredSourceSlots,
        productGroundingReady: true,
        quotaBlocked: false,
        quote: QUOTE,
        quoteId: QUOTE.quoteId,
        quoteSettling: false,
        recipe: RECIPE,
        sessionIdRef,
        setBriefPending,
        setBriefState,
        setDestinationMapPending,
        setDestinationPreflight,
        setLensState,
        setSession,
        setShowRequiredHint,
        setSourceSlotGuidance,
        setSubmissionGroundingBlocked,
        setSubmissionQuotaBlocked,
        setSubmitBlockedMessage,
        storeFactsPending: extras.storeFactsPending,
        onRevealStoreFacts: extras.onRevealStoreFacts,
        signedSubmission: SIGNED_SUBMISSION,
        submissionDelivery: {
          deliverableKind: 'copy_document',
          platform: 'xiaohongshu',
        },
        submissionQuantity: 1,
        submissionSettings: { ...lensState.draft.settings },
        styleReferenceAssetIds: [],
        surface: {
          contentHash: 'surface-hash-1',
          recipeRefs: [],
          recipes: [],
          revision: 1,
          revisionId: 'surface-1',
          status: 'published',
          surfaceId: 'surface.home.launch',
        } as BrowserSurfaceProjection,
        transports,
        viralJourneyActive: false,
        viralSubmissionRecipeReady: false,
      });
      return { run, session, sourceSlotGuidance, submissionGroundingBlocked };
    },
    { wrapper }
  );
}

/**
 * #345: Core resolves creative grounding for every submission with no notion of
 * creation mode (`ProductCreativeGroundingResolver.resolve`), while free
 * creation carries no client-side store pre-check — so the server is the first
 * thing that tells a Day-0 merchant their store is unconfirmed. That refusal
 * has to name the gap: the Composer already renders a `store` blocker with the
 * copy and the store link, and a press that is refused must produce a described
 * reason rather than the generic failure toast.
 */

test('a submission refused for store grounding names the gap the server sent', async () => {
  const transports = createTransports();
  transports.submitSubmission = vi.fn(async () => {
    throw new P1RequestError(
      'Confirmed Product grounding is incomplete: confirmed_store, confirmed_project.',
      'CREATIVE_GROUNDING_INCOMPLETE',
      { missing: ['confirmed_store', 'confirmed_project'] },
      409
    );
  }) as ComposerRunTransports['submitSubmission'];
  const view = renderSubmissionRun(transports);

  await act(() => view.result.current.run.attemptSubmit());
  await waitFor(() =>
    expect(transports.submitSubmission).toHaveBeenCalledOnce()
  );

  await waitFor(() =>
    expect(view.result.current.submissionGroundingBlocked).toBe('store')
  );
  // The blocker copy renders inline with the link that fixes it; a toast
  // carrying the identical sentence was the second half of the double message.
  expect(toastError).not.toHaveBeenCalled();
});

/**
 * The generic failure — no grounding gap, no shortfall, just a run that did not
 * start. `createWork.isError` is what the Composer renders the one sentence
 * from, so the run has to leave that flag set and the toast channel silent.
 */
test('D1 copy still posts when Brief projection still requires confirmation', async () => {
  const transports = createTransports();
  transports.requestBrief = vi.fn(async () =>
    fixtureBriefProjection({
      confirmationValid: false,
      requiresBrief: true,
    })
  );
  const view = renderSubmissionRun(transports);

  await act(() => view.result.current.run.attemptSubmit());
  await waitFor(() =>
    expect(transports.submitSubmission).toHaveBeenCalledOnce()
  );
  expect(toastError).not.toHaveBeenCalled();
});

test('store-facts pending reveals the fact card and does not mint a run', async () => {
  const transports = createTransports();
  const onRevealStoreFacts = vi.fn();
  const view = renderSubmissionRun(transports, {
    onRevealStoreFacts,
    storeFactsPending: true,
  });

  await act(() => view.result.current.run.attemptSubmit());

  expect(onRevealStoreFacts).toHaveBeenCalledOnce();
  expect(transports.syncBrief).not.toHaveBeenCalled();
  expect(transports.submitSubmission).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});

test('missing required source slots stop before brief and confirm', async () => {
  const transports = createTransports();
  const view = renderSubmissionRun(transports, {
    missingRequiredSourceSlots: [
      { slot: 'case_image', required: true, kinds: ['image'] },
    ],
  });

  await act(() => view.result.current.run.attemptSubmit());

  expect(view.result.current.sourceSlotGuidance).toBe(true);
  expect(transports.syncBrief).not.toHaveBeenCalled();
  expect(transports.requestBrief).not.toHaveBeenCalled();
  expect(transports.submitSubmission).not.toHaveBeenCalled();
  expect(toastError).not.toHaveBeenCalled();
});

test('INVALID_STATE missing-slot refusal opens guidance instead of retry copy', async () => {
  const transports = createTransports();
  transports.submitSubmission = vi.fn(async () => {
    throw new P1RequestError(
      'Required source slot case_image is not satisfied by the current workspace sources.',
      'INVALID_STATE',
      undefined,
      400
    );
  }) as ComposerRunTransports['submitSubmission'];
  const view = renderSubmissionRun(transports);

  await act(() => view.result.current.run.attemptSubmit());
  await waitFor(() =>
    expect(transports.submitSubmission).toHaveBeenCalledOnce()
  );

  await waitFor(() =>
    expect(view.result.current.sourceSlotGuidance).toBe(true)
  );
  expect(view.result.current.session.phase).not.toBe('failed');
  expect(toastError).not.toHaveBeenCalled();
});

test('a run that fails to start speaks once, through createWork.isError', async () => {
  const transports = createTransports();
  transports.submitSubmission = vi.fn(async () => {
    throw new Error('Core refused the submission.');
  }) as ComposerRunTransports['submitSubmission'];
  const view = renderSubmissionRun(transports);

  await act(() => view.result.current.run.attemptSubmit());
  await waitFor(() =>
    expect(view.result.current.run.createWork.isError).toBe(true)
  );

  expect(view.result.current.submissionGroundingBlocked).toBe(null);
  expect(toastError).not.toHaveBeenCalled();
  expect(toastSuccess).not.toHaveBeenCalled();
  expect(view.result.current.session.phase).toBe('failed');
});
