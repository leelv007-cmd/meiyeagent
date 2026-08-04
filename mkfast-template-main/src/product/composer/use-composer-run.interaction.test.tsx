import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  ComposerSubmissionSignedFields,
} from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, useRef, useState } from 'react';
import { expect, test, vi } from 'vitest';

import { createBriefSurfaceState } from './brief-surface';
import { fixtureBriefProjection } from './brief-surface.fixture';
import {
  bindQuoteView,
  createComposerLensState,
  selectLens,
  updateUserText,
} from './lens-state-machine';
import { buildComposerQuote, projectComposerQuoteView } from './quote-wiring';
import { createComposerSession } from './composer-session';
import { type ComposerRunTransports, useComposerRun } from './use-composer-run';

const QUOTE = buildComposerQuote({
  billingMode: 'per_request',
  catalogModelId: 'model-copy-1',
  catalogModelRevision: 'model-copy-1@1',
  quantity: 1,
  quoteId: 'quote-1',
  quotePolicyRevision: 'policy-1',
  unitRate: 1,
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
      credits: { availableCredits: 20 },
    })),
    mapDestination: vi.fn(),
    requestBrief: vi.fn(async () => projection),
    submitSubmission: vi.fn(async () => ({
      contentPackage: { id: 'package-1' },
      task: { id: 'task-1' },
      work: { id: 'work-1' },
    })),
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
      const [destinationPreflight, setDestinationPreflight] = useState(null);
      const [, setShowRequiredHint] = useState(false);
      const [, setSubmissionGroundingBlocked] = useState(null);
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
          recipeRefs: [],
          recipes: [],
          revisionId: 'surface-1',
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
  expect(view.result.current.session.task).toEqual({
    packageId: 'package-1',
    taskId: 'task-1',
    workId: 'work-1',
  });
  expect(view.result.current.lensState.phase).toBe('frozen');
});
