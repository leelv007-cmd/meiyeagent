/**
 * Composer home host (Z1 / #105 cutover).
 *
 * Primary creation entry mounted by dashboard/index.
 * Consumes WT-C modules only; submit success navigates to Result Center
 * via typed ResultCenterNavigation (never the legacy query-string work bridge).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  creation_entry_intent_aria,
  creation_entry_intent_placeholder,
  creation_entry_submit,
  model_card_channel_multi,
  model_card_channel_single,
  workbench_grounding_go_to_store,
  workbench_grounding_source_required,
  workbench_grounding_store_required,
  workbench_operation_failed,
  workbench_work_create_failed,
  workbench_work_created,
} from '@/locale/paraglide/messages';
import {
  commandP1,
  operationsCommand,
  P1RequestError,
  p1ErrorCode,
  queryP1,
} from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  selectAvailableCatalogModel,
} from '@/p1/settings-view-model';
import type {
  BriefBoundRevisions,
  BriefSourceSignal,
  BriefTriggerInput,
  BriefTriggerProjection,
  CreationLensId,
  ProductQuoteSnapshot,
} from '@meiye/contracts';
import type { AccountUsageProjection } from '@/product/account-usage';
import { uploadProductAsset } from '@/api/product-assets';
import {
  ComposerImageInput,
  type ComposerImageIdentity,
} from '@/product/composer-image-input';
import { executeProductCommand, useProductState } from '@/product/client';
import type { ConfirmedAssetFacts } from '@/product/creation-entry-model';
import {
  missingCreativeGrounding,
  type CreativeGroundingRequirement,
} from '@/product/creative-brief-editor';
import { navigateAfterSubmitSuccess } from '@/product/results/result-center-navigation';

import { BriefSurface } from './brief-surface-panel';
import { applyCatalogRecipeSelection } from './catalog-selection';
import {
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  openBriefSurface,
  projectBriefSurfaceView,
  type BriefSurfaceState,
} from './brief-surface';
import { ComposerToolsStrip } from './composer-tools-strip';
import {
  bindQuoteView,
  canSubmit,
  createComposerLensState,
  selectLens,
  submitComposer,
  updateSettings,
  updateSources,
  updateDeliverySuggestion,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';
import { LensRadiogroup } from './lens-radiogroup';
import { LensSwitchPreviewPanel } from './lens-switch-preview-panel';
import { isTwoColumnMobileViewport } from './mobile-layout';
import { projectComposerQuoteView } from './quote-wiring';
import {
  listColdCardsFromSeeds,
  listColdCardsFromSurface,
} from './recipe-cards';
import { RecipeCardsPanel } from './recipe-cards-panel';
import { QuotaBlockingCard } from './quota-blocking-card';
import {
  buildLiveBriefInput,
  buildLiveQuoteInput,
  COMPOSER_OPERATION_BY_LENS,
  fetchComposerCatalog,
  fetchComposerSurface,
  confirmComposerBrief,
  requestComposerBrief,
  requestComposerQuote,
  requestRecipePatchPreview,
  syncComposerBriefContext,
} from './composer-live';
import { composerDraftToRecipeFields } from './recipe-patch-preview-client';
import { buildDynamicSettingsRow } from './settings-row';

function briefSourcesFromDraft(sources: unknown[]): BriefSourceSignal[] {
  return sources.flatMap((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [];
    }
    const value = source as Record<string, unknown>;
    return [
      {
        id: typeof value.id === 'string' ? value.id : `source-${index + 1}`,
        ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
        ...(typeof value.category === 'string'
          ? { category: value.category }
          : {}),
        ...(typeof value.containsPerson === 'boolean'
          ? { containsPerson: value.containsPerson }
          : {}),
        ...(typeof value.restricted === 'boolean'
          ? { restricted: value.restricted }
          : {}),
        ...(typeof value.rightsStatus === 'string'
          ? { rightsStatus: value.rightsStatus }
          : {}),
      },
    ];
  });
}

type ComposerGroundingBlocker = 'source' | 'store';

function sourceReferencesFromDraft(sources: unknown[]) {
  return sources.flatMap((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [];
    }
    const id = (source as Record<string, unknown>).id;
    return typeof id === 'string' ? [{ id, kind: 'asset' as const }] : [];
  });
}

function groundingBlockerFromMissing(
  missing: readonly CreativeGroundingRequirement[]
): ComposerGroundingBlocker | null {
  if (
    missing.includes('confirmed_store') ||
    missing.includes('confirmed_project') ||
    missing.includes('confirmed_qualification')
  ) {
    return 'store';
  }
  return missing.includes('real_authorized_asset') ? 'source' : null;
}

function groundingBlockerFromError(error: unknown) {
  if (!(error instanceof P1RequestError)) return null;
  const missing = error.details?.missing;
  if (!Array.isArray(missing)) return null;
  return groundingBlockerFromMissing(
    missing.filter(
      (value): value is CreativeGroundingRequirement =>
        value === 'confirmed_store' ||
        value === 'confirmed_project' ||
        value === 'confirmed_qualification' ||
        value === 'real_authorized_asset'
    )
  );
}

function sameBriefRevisions(
  left: BriefBoundRevisions,
  right: BriefBoundRevisions
) {
  return (
    left.draftRevisionId === right.draftRevisionId &&
    (left.recipeRevisionId ?? null) === (right.recipeRevisionId ?? null) &&
    (left.modelRevisionId ?? null) === (right.modelRevisionId ?? null) &&
    (left.quoteRevisionId ?? null) === (right.quoteRevisionId ?? null) &&
    (left.sourceRevisionId ?? null) === (right.sourceRevisionId ?? null) &&
    (left.surfaceRevisionId ?? null) === (right.surfaceRevisionId ?? null) &&
    (left.lensId ?? null) === (right.lensId ?? null)
  );
}

export type ComposerHomeProps = {
  /** Optional viewport override for tests. */
  viewportWidth?: number;
  /** When true, skip live create and only freeze+navigate with fixture workId. */
  fixtureSubmit?: boolean;
  initialRecipeRevisionId?: string;
  initialSurfaceRevisionId?: string;
};

export function ComposerHome({
  viewportWidth,
  fixtureSubmit = false,
  initialRecipeRevisionId,
  initialSurfaceRevisionId,
}: ComposerHomeProps = {}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const product = useProductState();
  const intentRef = useRef<HTMLTextAreaElement | null>(null);
  const sourcePickerRef = useRef<HTMLElement | null>(null);
  const sourceFactsRef = useRef(new Map<string, ConfirmedAssetFacts>());
  const catalogSelectionAppliedRef = useRef(false);
  const sessionIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `composer-${Date.now()}`
  );
  const briefContextRevisionRef = useRef<number | null>(null);
  const briefInputRef = useRef<BriefTriggerInput | null>(null);
  const [lensState, setLensState] = useState<ComposerLensState>(() =>
    createComposerLensState()
  );
  const [showRequiredHint, setShowRequiredHint] = useState(false);
  const [briefState, setBriefState] = useState<BriefSurfaceState>(() =>
    createBriefSurfaceState()
  );
  const [briefPending, setBriefPending] = useState(false);
  const [submissionQuotaBlocked, setSubmissionQuotaBlocked] = useState(false);
  const [submissionGroundingBlocked, setSubmissionGroundingBlocked] =
    useState<ComposerGroundingBlocker | null>(null);
  const [uploadsReady, setUploadsReady] = useState(true);

  const width =
    viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const singleColumn = !isTwoColumnMobileViewport({ width });
  const viewportKind = isMobile || singleColumn ? 'mobile' : 'desktop';

  const lensId = lensState.phase === 'unselected' ? null : lensState.lensId;
  const userText = lensState.draft.userText;
  const quoteView = lensState.draft.quoteView;
  const sourceReferences = useMemo(
    () => sourceReferencesFromDraft(lensState.draft.sources),
    [lensState.draft.sources]
  );
  const missingGrounding = useMemo(
    () => missingCreativeGrounding(product.state, sourceReferences),
    [product.state, sourceReferences]
  );

  const surfaceQuery = useQuery({
    queryKey: p1QueryKeys.request('creation-experience', 'surface_browser', {
      surfaceId: 'surface.home.launch',
    }),
    queryFn: ({ signal }) => fetchComposerSurface(signal),
  });
  const usageQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
    staleTime: 30_000,
  });
  const catalogQuery = useQuery({
    enabled: lensId != null,
    queryKey: p1QueryKeys.request('model-supply', 'catalog', {
      operation: lensId ? COMPOSER_OPERATION_BY_LENS[lensId] : 'unselected',
    }),
    queryFn: ({ signal }) => {
      if (!lensId) throw new Error('Composer lens is required.');
      return fetchComposerCatalog(lensId, signal);
    },
  });
  const catalog = useMemo(
    () =>
      lensId && catalogQuery.data
        ? normalizeCatalog(
            catalogQuery.data,
            COMPOSER_OPERATION_BY_LENS[lensId]
          )
        : { models: [] },
    [catalogQuery.data, lensId]
  );
  const selectedModel = useMemo(() => {
    const explicitId = lensState.draft.settings.catalogModelId;
    return (
      catalog.models.find(
        (model) => model.id === explicitId && model.available
      ) ?? selectAvailableCatalogModel(catalog)
    );
  }, [catalog, lensState.draft.settings.catalogModelId]);
  const catalogRevision = catalogQuery.data?.revisionId ?? 'catalog-current';
  const quoteInput = useMemo(() => {
    if (!lensId || !selectedModel) return null;
    const aspectRatio = lensState.draft.settings.aspectRatio;
    return buildLiveQuoteInput({
      sessionId: sessionIdRef.current,
      lensId,
      catalogRevision,
      model: selectedModel,
      quantity: lensState.draft.settings.quantity ?? 1,
      durationSeconds: lensState.draft.settings.durationSeconds ?? undefined,
      aspectRatio:
        aspectRatio === '1:1' || aspectRatio === '3:4' || aspectRatio === '9:16'
          ? aspectRatio
          : undefined,
    });
  }, [
    catalogRevision,
    lensId,
    lensState.draft.settings.durationSeconds,
    lensState.draft.settings.aspectRatio,
    lensState.draft.settings.quantity,
    selectedModel,
  ]);
  const quoteQuery = useQuery({
    enabled: quoteInput != null,
    queryKey: p1QueryKeys.request('product-billing', 'quote', quoteInput ?? {}),
    queryFn: () => {
      if (!quoteInput) throw new Error('Composer quote input is required.');
      return requestComposerQuote(quoteInput);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const coldCards = useMemo(
    () =>
      surfaceQuery.data
        ? listColdCardsFromSurface(surfaceQuery.data)
        : listColdCardsFromSeeds(),
    [surfaceQuery.data]
  );
  const settingsFields = useMemo(
    () =>
      buildDynamicSettingsRow({
        lensId,
        catalogModel: selectedModel
          ? { id: selectedModel.id, displayName: selectedModel.displayName }
          : null,
        aspectRatio: lensState.draft.settings.aspectRatio,
        quantity: lensState.draft.settings.quantity,
        durationSeconds: lensState.draft.settings.durationSeconds,
        platform: lensState.draft.delivery.platform,
        deliverableKind: lensState.draft.delivery.deliverableKind,
      }),
    [lensId, lensState.draft, selectedModel]
  );
  const usageResource =
    lensId === 'image_text' ? 'image' : lensId === 'video' ? 'video' : 'copy';
  const usageCost = lensState.draft.settings.quantity ?? 1;
  const quotaInsufficient = Boolean(
    lensId &&
      usageQuery.data &&
      usageQuery.data.usage[usageResource].available < usageCost
  );
  const quotaBlocked = quotaInsufficient || submissionQuotaBlocked;

  useEffect(() => {
    if (
      catalogSelectionAppliedRef.current ||
      !initialRecipeRevisionId ||
      !initialSurfaceRevisionId ||
      !surfaceQuery.data
    ) {
      return;
    }
    catalogSelectionAppliedRef.current = true;
    setLensState(
      (current) =>
        applyCatalogRecipeSelection({
          state: current,
          surface: surfaceQuery.data!,
          recipeRevisionId: initialRecipeRevisionId,
          surfaceRevisionId: initialSurfaceRevisionId,
        }).state
    );
  }, [initialRecipeRevisionId, initialSurfaceRevisionId, surfaceQuery.data]);

  useEffect(() => {
    if (!selectedModel || lensState.phase === 'frozen') return;
    if (
      lensState.draft.settings.catalogModelId === selectedModel.id &&
      lensState.draft.settings.catalogModelRevision === catalogRevision
    ) {
      return;
    }
    setLensState((current) =>
      updateSettings(
        current,
        {
          catalogModelId: selectedModel.id,
          catalogModelName: selectedModel.displayName,
          catalogModelRevision: catalogRevision,
        },
        'system'
      )
    );
  }, [catalogRevision, lensState, selectedModel]);

  useEffect(() => {
    if (!quoteQuery.data || lensState.phase === 'frozen') return;
    const nextView = projectComposerQuoteView(
      quoteQuery.data,
      lensState.draft.settings.quantity ?? 1
    );
    if (lensState.draft.quoteRevisionId === nextView.revision) return;
    setLensState((current) => bindQuoteView(current, nextView));
  }, [quoteQuery.data, lensState]);

  const addSource = (assetId: string) => {
    const facts = sourceFactsRef.current.get(assetId);
    if (!facts) return;
    setLensState((current) =>
      updateSources(current, [
        ...current.draft.sources.filter(
          (source) =>
            !source ||
            typeof source !== 'object' ||
            Array.isArray(source) ||
            (source as Record<string, unknown>).id !== assetId
        ),
        {
          id: assetId,
          kind: 'asset',
          category: facts.category,
          containsPerson: facts.containsPerson,
          restricted:
            facts.category === 'customer_case' ||
            facts.category === 'before_after' ||
            facts.containsPerson,
          rightsStatus: facts.consentScope,
        },
      ])
    );
  };

  const removeSource = (assetId: string) => {
    sourceFactsRef.current.delete(assetId);
    setLensState((current) =>
      updateSources(
        current,
        current.draft.sources.filter(
          (source) =>
            !source ||
            typeof source !== 'object' ||
            Array.isArray(source) ||
            (source as Record<string, unknown>).id !== assetId
        )
      )
    );
  };

  const uploadComposerImage = async (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => {
    const body = new FormData();
    body.append('file', file);
    body.append('uploadId', identity.uploadId);
    body.append('contentHash', identity.contentHash);
    const receipt = await uploadProductAsset({ data: body });
    await executeProductCommand(
      {
        type: 'add_asset',
        asset: {
          id: identity.assetId,
          mediaType: 'image',
          objectKey: receipt.key,
          sourceType: 'real',
          tags: file.name.trim() ? [file.name.slice(0, 40)] : [],
          category: facts.category,
          consentScope: 'internal_only',
          containsPerson: facts.containsPerson,
          containsSensitiveData: facts.containsSensitiveData,
          minorStatus: facts.minorStatus,
          rightsOwner: identity.assetId,
        },
      },
      `composer-asset:${identity.contentHash}`
    );
    sourceFactsRef.current.set(identity.assetId, facts);
    if (facts.consentScope === 'internal_only') {
      return { attached: false };
    }
    await executeProductCommand(
      {
        type: 'authorize_asset',
        assetId: identity.assetId,
        consentScope: facts.consentScope,
        rightsEvidence: facts.rightsEvidence,
        rightsNoFixedExpiry: facts.rightsNoFixedExpiry,
        rightsPlatforms: facts.rightsPlatforms,
        rightsValidUntil: facts.rightsValidUntil,
      },
      `composer-asset-authorize:${identity.contentHash}`
    );
    return { attached: true };
  };

  const authorizeComposerImage = async (
    assetId: string,
    facts: ConfirmedAssetFacts
  ) => {
    if (facts.consentScope !== 'public_marketing') return;
    await executeProductCommand(
      {
        type: 'authorize_asset',
        assetId,
        consentScope: facts.consentScope,
        rightsEvidence: facts.rightsEvidence,
        rightsNoFixedExpiry: facts.rightsNoFixedExpiry,
        rightsPlatforms: facts.rightsPlatforms,
        rightsValidUntil: facts.rightsValidUntil,
      },
      `composer-asset-authorize:${assetId}:${crypto.randomUUID()}`
    );
    sourceFactsRef.current.set(assetId, facts);
  };

  const createWork = useMutation({
    mutationFn: async (input: {
      briefConfirmationId?: string;
      briefContextId?: string;
      briefInput?: BriefTriggerInput;
      lensId: CreationLensId;
      intent: string;
      quote: ProductQuoteSnapshot;
      videoConfirmAccepted?: boolean;
    }) => {
      if (fixtureSubmit) {
        return { id: `fixture-work-${input.lensId}` };
      }
      if (input.briefContextId && input.briefInput) {
        const current = await requestComposerBrief({
          ...input.briefInput,
          ...(input.briefConfirmationId
            ? { confirmationId: input.briefConfirmationId }
            : {}),
        });
        if (
          current.requiresBrief ||
          (input.briefConfirmationId && !current.confirmationValid)
        ) {
          throw new Error('Brief confirmation is no longer current.');
        }
      }
      const created = await operationsCommand<{ id: string }>(
        'create_creative_work',
        {
          autoConfirmBrief: true,
          intent: input.intent,
          mode: 'direct',
          operation: COMPOSER_OPERATION_BY_LENS[input.lensId],
          contentModules: ['social_cover'],
          sessionId: `composer:${sessionIdRef.current}`,
          sourceReferences,
          ...(input.briefConfirmationId
            ? { briefConfirmationId: input.briefConfirmationId }
            : {}),
          ...(input.briefContextId
            ? { briefContextId: input.briefContextId }
            : {}),
        },
        `composer-create:${sessionIdRef.current}:${input.quote.revision}`
      );

      const amount = input.quote.confirmedAmount ?? 0;
      await commandP1(
        'product-billing',
        {
          action: 'confirm',
          payload: {
            quoteId: input.quote.quoteId,
            taskId: created.id,
          },
        },
        `composer-confirm:${input.quote.quoteId}:${created.id}`
      );

      const quoteAcceptedAt = new Date().toISOString();
      const contract = {
        operation: COMPOSER_OPERATION_BY_LENS[input.lensId],
        catalogModelId: input.quote.catalogModelId,
        catalogRevision: input.quote.catalogModelRevision ?? catalogRevision,
        quoteRevision: input.quote.revision,
        quoteAcceptedAt,
        outputLabel:
          input.quote.outputLabel ??
          (input.lensId === 'copy'
            ? '3 条内容候选'
            : input.lensId === 'image_text'
              ? '1 张 3:4 图片'
              : '1 段竖屏视频'),
        estimatedAmount: amount,
        currency: input.quote.formula.currency ?? 'CNY',
        outputCount:
          input.quote.outputCount ?? lensState.draft.settings.quantity ?? 1,
        ...(input.lensId === 'image_text' || input.lensId === 'video'
          ? {
              aspectRatio:
                lensState.draft.settings.aspectRatio ??
                (input.lensId === 'video' ? '9:16' : '3:4'),
            }
          : {}),
        ...(input.lensId === 'video'
          ? {
              durationSeconds: lensState.draft.settings.durationSeconds ?? 15,
            }
          : {}),
        dataClass: [],
        watermarkEnabled: true,
        aigcLabelEnabled: true,
        contentModules: ['social_cover'],
      };
      let approvalReceiptId: string | undefined;
      if (input.lensId === 'video') {
        if (!input.videoConfirmAccepted) {
          throw new Error('Video quote confirmation is required.');
        }
        const approval = await operationsCommand<{ id: string }>(
          'approve_creative_generation',
          {
            approvalKey: `composer-video:${input.quote.revision}`,
            contract,
            workId: created.id,
          },
          `composer-video-approval:${created.id}:${input.quote.revision}`
        );
        approvalReceiptId = approval.id;
      }
      await operationsCommand(
        'submit_creative_work',
        {
          workId: created.id,
          contract,
          billingQuoteId: input.quote.quoteId,
          submissionKey: `composer-submit:${created.id}:${input.quote.revision}`,
          ...(input.briefConfirmationId
            ? { briefConfirmationId: input.briefConfirmationId }
            : {}),
          ...(input.briefContextId
            ? { briefContextId: input.briefContextId }
            : {}),
          ...(approvalReceiptId ? { approvalReceiptId } : {}),
        },
        `composer-submit:${created.id}:${input.quote.revision}`
      );
      return created;
    },
    onSuccess: async (created, variables) => {
      const submitted = submitComposer(lensState, {
        videoConfirmAccepted:
          variables.lensId === 'video'
            ? variables.videoConfirmAccepted
            : undefined,
        confirmPriceMatchesCharge: true,
      });
      if (submitted.ok) {
        setLensState(submitted.state);
      }
      toast.success(workbench_work_created());
      const location = navigateAfterSubmitSuccess({
        workId: created.id,
        sourceRoute: '/dashboard',
        panel: 'run',
      });
      await navigate({
        to: '/dashboard/results/$workId',
        params: { workId: created.id },
        search: location.search,
        replace: false,
      });
    },
    onMutate: () => setSubmissionGroundingBlocked(null),
    onError: (error) => {
      if (p1ErrorCode(error) === 'CREATIVE_GROUNDING_INCOMPLETE') {
        const blocker =
          groundingBlockerFromError(error) ??
          groundingBlockerFromMissing(missingGrounding);
        if (blocker) {
          setSubmissionGroundingBlocked(blocker);
          toast.error(
            blocker === 'store'
              ? workbench_grounding_store_required()
              : workbench_grounding_source_required()
          );
          return;
        }
      }
      if (
        p1ErrorCode(error) === 'INSUFFICIENT_ENTITLEMENT' ||
        p1ErrorCode(error) === 'ENTITLEMENT_INSUFFICIENT'
      ) {
        setSubmissionQuotaBlocked(true);
        void queryClient.invalidateQueries({
          queryKey: p1QueryKeys.request('entitlements', 'projection'),
        });
      }
      toast.error(workbench_work_create_failed());
    },
  });

  const runCreate = (
    selectedLens: CreationLensId,
    videoConfirmAccepted?: boolean,
    briefConfirmationId?: string
  ) => {
    const intent =
      lensState.draft.userText.trim() || coldCards[0]?.title || '创作';
    createWork.mutate({
      lensId: selectedLens,
      intent,
      quote: quoteQuery.data!,
      videoConfirmAccepted,
      ...(briefInputRef.current?.briefContextId
        ? {
            briefContextId: briefInputRef.current.briefContextId,
            briefInput: briefInputRef.current,
          }
        : {}),
      ...(briefConfirmationId
        ? {
            briefConfirmationId,
          }
        : {}),
    });
  };

  const handleLensChange = (next: CreationLensId) => {
    setShowRequiredHint(false);
    setSubmissionGroundingBlocked(null);
    setLensState(selectLens(lensState, next));
  };

  const handleIntentChange = (value: string) => {
    setSubmissionGroundingBlocked(null);
    setLensState(updateUserText(lensState, value));
  };

  const attemptSubmit = async () => {
    const gate = canSubmit(lensState);
    if (!gate.allowed && gate.reason !== 'video_confirm_required') {
      setShowRequiredHint(true);
      if (gate.focusTarget === 'lens_group') {
        document
          .querySelector<HTMLElement>(
            '[data-testid="composer-lens-radiogroup"]'
          )
          ?.focus();
      }
      return;
    }

    if (lensState.phase !== 'selected') return;
    if (quotaBlocked) {
      setSubmissionQuotaBlocked(true);
      return;
    }
    if (!quoteQuery.data || !quoteView) {
      setShowRequiredHint(true);
      return;
    }
    const groundingBlocker =
      product.state && !product.loading && !product.error
        ? groundingBlockerFromMissing(missingGrounding)
        : null;
    if (groundingBlocker) {
      setSubmissionGroundingBlocked(groundingBlocker);
      return;
    }

    setBriefPending(true);
    let projection: BriefTriggerProjection | undefined;
    try {
      const briefContextId = `composer:${sessionIdRef.current}`;
      const recipeRevisionId = lensState.draft.recipeRevisionId;
      const briefContext = await syncComposerBriefContext({
        briefContextId,
        draft: {
          delivery: lensState.draft.delivery,
          settings: lensState.draft.settings,
          sources: briefSourcesFromDraft(lensState.draft.sources),
          userText: lensState.draft.userText,
        },
        expectedRevision: briefContextRevisionRef.current,
        lensId: lensState.lensId,
        quoteId: quoteQuery.data.quoteId,
        recipeRevisionId: recipeRevisionId ?? null,
        sourceIds: sourceReferences.map((source) => source.id),
        surfaceRevisionId:
          surfaceQuery.data?.revisionId ?? initialSurfaceRevisionId ?? null,
      });
      briefContextRevisionRef.current = briefContext.revision;
      const briefInput = buildLiveBriefInput({
        briefContextId,
        lensId: lensState.lensId,
        quote: quoteQuery.data,
        currentRevisions: briefContext.currentRevisions,
        delivery: lensState.draft.delivery,
        imageCount:
          lensState.lensId === 'image_text'
            ? (lensState.draft.settings.quantity ?? 1)
            : 0,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        highRiskFacts:
          /价格|价目|团购|优惠|\d+\s*元/u.test(lensState.draft.userText) &&
          !lensState.draft.sources.some(
            (source) =>
              source &&
              typeof source === 'object' &&
              !Array.isArray(source) &&
              (source as Record<string, unknown>).category === 'price_list'
          )
            ? [{ kind: 'price', status: 'missing' }]
            : [],
      });
      briefInputRef.current = briefInput;
      projection = await requestComposerBrief(briefInput);
    } catch {
      toast.error(workbench_operation_failed());
      return;
    } finally {
      setBriefPending(false);
    }

    // Video paths always require explicit Brief accept — never runCreate
    // while the lens gate reports video_confirm_required or lens is video.
    const videoConfirmRequired =
      lensState.lensId === 'video' ||
      (!gate.allowed && gate.reason === 'video_confirm_required');

    if (videoConfirmRequired && !projection) {
      setShowRequiredHint(true);
      return;
    }

    const path = decideSubmitPath({
      projection,
      videoConfirmRequired,
    });
    if (path.path === 'open_brief') {
      setBriefState(
        openBriefSurface(briefState, {
          projection: path.projection,
          composerSnapshot: {
            userText: lensState.draft.userText,
            sources: [...lensState.draft.sources],
            lensId: lensState.lensId,
            draftRevisionId: path.projection.bindRevisions.draftRevisionId,
          },
        })
      );
      return;
    }

    // Safety net: video must never submit without Brief accept.
    if (videoConfirmRequired) {
      setShowRequiredHint(true);
      return;
    }

    runCreate(lensState.lensId);
  };

  const handleBriefConfirm = async () => {
    if (lensState.phase !== 'selected') return;
    const result = confirmBriefSurface(briefState);
    if (!result.ok) {
      setBriefState(result.state);
      return;
    }
    const briefInput = briefInputRef.current;
    if (!briefInput?.briefContextId) {
      toast.error(workbench_operation_failed());
      return;
    }
    const refreshedContext = await syncComposerBriefContext({
      briefContextId: briefInput.briefContextId,
      draft: {
        delivery: lensState.draft.delivery,
        settings: lensState.draft.settings,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        userText: lensState.draft.userText,
      },
      expectedRevision: briefContextRevisionRef.current,
      lensId: lensState.lensId,
      quoteId: quoteQuery.data!.quoteId,
      recipeRevisionId: lensState.draft.recipeRevisionId ?? null,
      sourceIds: sourceReferences.map((source) => source.id),
      surfaceRevisionId:
        surfaceQuery.data?.revisionId ?? initialSurfaceRevisionId ?? null,
    }).catch(() => null);
    if (!refreshedContext) {
      toast.error(workbench_operation_failed());
      return;
    }
    briefContextRevisionRef.current = refreshedContext.revision;
    if (
      !briefState.projection ||
      !sameBriefRevisions(
        briefState.projection.bindRevisions,
        refreshedContext.currentRevisions
      )
    ) {
      const refreshedInput = buildLiveBriefInput({
        briefContextId: briefInput.briefContextId,
        lensId: lensState.lensId,
        quote: quoteQuery.data!,
        currentRevisions: refreshedContext.currentRevisions,
        delivery: lensState.draft.delivery,
        imageCount:
          lensState.lensId === 'image_text'
            ? (lensState.draft.settings.quantity ?? 1)
            : 0,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        highRiskFacts:
          /价格|价目|团购|优惠|\d+\s*元/u.test(lensState.draft.userText) &&
          !lensState.draft.sources.some(
            (source) =>
              source &&
              typeof source === 'object' &&
              !Array.isArray(source) &&
              (source as Record<string, unknown>).category === 'price_list'
          )
            ? [{ kind: 'price', status: 'missing' }]
            : [],
      });
      briefInputRef.current = refreshedInput;
      const refreshedProjection = await requestComposerBrief(refreshedInput);
      setBriefState(
        openBriefSurface(briefState, {
          projection: refreshedProjection,
          composerSnapshot: {
            userText: lensState.draft.userText,
            sources: [...lensState.draft.sources],
            lensId: lensState.lensId,
            draftRevisionId: refreshedProjection.bindRevisions.draftRevisionId,
          },
        })
      );
      return;
    }
    const confirmationId = `brief-confirm:${sessionIdRef.current}:${briefContextRevisionRef.current ?? 0}`;
    setBriefPending(true);
    try {
      await confirmComposerBrief({
        ...briefInput,
        confirmationId,
      });
      const current = await requestComposerBrief({
        ...briefInput,
        confirmationId,
      });
      if (current.requiresBrief || !current.confirmationValid) {
        throw new Error('Brief confirmation was invalidated before submit.');
      }
      setBriefState(result.state);
      runCreate(
        lensState.lensId,
        result.state.videoConfirmAccepted,
        confirmationId
      );
    } catch {
      toast.error(workbench_operation_failed());
    } finally {
      setBriefPending(false);
    }
  };

  const briefView =
    briefState.phase === 'open'
      ? projectBriefSurfaceView(briefState, {
          lensId,
          quote: quoteView,
        })
      : null;

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6"
      data-testid="composer-home"
      data-viewport={viewportKind}
    >
      <Card className="meiye-composer meiye-entry-card border-0 shadow-none">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <LensRadiogroup
            value={lensId}
            onChange={handleLensChange}
            showRequiredHint={showRequiredHint}
            disabled={createWork.isPending || lensState.phase === 'frozen'}
          />

          <LensSwitchPreviewPanel state={lensState} onChange={setLensState} />

          <Textarea
            aria-label={creation_entry_intent_aria()}
            className="min-h-28 resize-none rounded-2xl text-base leading-7"
            data-testid="composer-intent-input"
            disabled={createWork.isPending || lensState.phase === 'frozen'}
            onChange={(event) => handleIntentChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === 'Enter' &&
                !createWork.isPending
              ) {
                event.preventDefault();
                void attemptSubmit();
              }
            }}
            placeholder={creation_entry_intent_placeholder()}
            ref={intentRef}
            rows={4}
            value={userText}
          />

          <div data-testid="composer-source-picker">
            <ComposerImageInput
              focusRef={sourcePickerRef}
              onAssetAdded={addSource}
              onAssetRemoved={removeSource}
              onAuthorize={authorizeComposerImage}
              onQueueChange={(uploads) =>
                setUploadsReady(
                  uploads.every((upload) => upload.status === 'ready')
                )
              }
              onUpload={uploadComposerImage}
            >
              <p className="text-sm text-muted-foreground">
                可选：上传门店图片、顾客案例或价目素材
              </p>
            </ComposerImageInput>
          </div>

          {quoteView ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="composer-quote-line"
            >
              {quoteView.billingNote ?? `预计消耗 ${quoteView.amount}`}
            </p>
          ) : lensId ? (
            <output className="text-sm text-muted-foreground">
              {catalogQuery.isError || quoteQuery.isError
                ? '当前模型或报价暂不可用'
                : '正在读取模型与报价…'}
            </output>
          ) : null}

          {settingsFields.length > 0 ? (
            <div
              className="grid gap-2 sm:grid-cols-2"
              data-testid="composer-settings-row"
            >
              {settingsFields.map((field) => (
                <div
                  className="rounded-xl border border-border/60 px-3 py-2"
                  data-testid={`composer-setting-${field.def.key}`}
                  key={field.def.key}
                >
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor={`composer-setting-input-${field.def.key}`}
                  >
                    {field.def.label}
                  </label>
                  {field.def.key === 'catalogModel' ? (
                    <>
                      <select
                        className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                        data-testid="composer-catalog-model-select"
                        id="composer-setting-input-catalogModel"
                        value={selectedModel?.id ?? ''}
                        onChange={(event) => {
                          const next = catalog.models.find(
                            (model) => model.id === event.target.value
                          );
                          if (!next) return;
                          setLensState((current) =>
                            updateSettings(
                              current,
                              {
                                catalogModelId: next.id,
                                catalogModelName: next.displayName,
                                catalogModelRevision: catalogRevision,
                                modelPolicyMode: 'fixed',
                              },
                              'user'
                            )
                          );
                        }}
                      >
                        {catalog.models
                          .filter((model) => model.available)
                          .map((model) => {
                            const channelLabel =
                              model.channelReadiness === 'multi_channel_ready'
                                ? model_card_channel_multi()
                                : model.channelReadiness === 'single_channel'
                                  ? model_card_channel_single()
                                  : undefined;
                            return (
                              <option key={model.id} value={model.id}>
                                {channelLabel
                                  ? `${model.displayName} · ${channelLabel}`
                                  : model.displayName}
                              </option>
                            );
                          })}
                      </select>
                      {selectedModel?.channelReadiness === 'single_channel' ||
                      selectedModel?.channelReadiness ===
                        'multi_channel_ready' ? (
                        <p
                          className="mt-1 text-xs text-muted-foreground"
                          data-channel-readiness={
                            selectedModel.channelReadiness
                          }
                          data-testid="composer-model-channel-readiness"
                        >
                          {selectedModel.channelReadiness ===
                          'multi_channel_ready'
                            ? model_card_channel_multi()
                            : model_card_channel_single()}
                        </p>
                      ) : null}
                    </>
                  ) : field.def.key === 'aspectRatio' ? (
                    <select
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                      id="composer-setting-input-aspectRatio"
                      value={lensState.draft.settings.aspectRatio ?? ''}
                      onChange={(event) =>
                        setLensState((current) =>
                          updateSettings(
                            current,
                            { aspectRatio: event.target.value },
                            'user'
                          )
                        )
                      }
                    >
                      <option value="1:1">1:1</option>
                      <option value="3:4">3:4</option>
                      <option value="9:16">9:16</option>
                    </select>
                  ) : field.def.key === 'quantity' ||
                    field.def.key === 'durationSeconds' ? (
                    <input
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                      id={`composer-setting-input-${field.def.key}`}
                      min={1}
                      type="number"
                      value={field.value ?? 1}
                      onChange={(event) =>
                        setLensState((current) =>
                          updateSettings(
                            current,
                            {
                              [field.def.key]: Math.max(
                                1,
                                Number(event.target.value) || 1
                              ),
                            },
                            'user'
                          )
                        )
                      }
                    />
                  ) : field.def.key === 'platform' ? (
                    <select
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                      id="composer-setting-input-platform"
                      value={lensState.draft.delivery.platform ?? ''}
                      onChange={(event) =>
                        setLensState((current) =>
                          updateDeliverySuggestion(current, {
                            platform: event.target.value || null,
                          })
                        )
                      }
                    >
                      <option value="">未指定</option>
                      <option value="xiaohongshu">小红书</option>
                      <option value="douyin">抖音</option>
                      <option value="wechat_moments">朋友圈</option>
                      <option value="video_account">视频号</option>
                    </select>
                  ) : (
                    <input
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                      id={`composer-setting-input-${field.def.key}`}
                      value={field.value ?? ''}
                      onChange={(event) =>
                        setLensState((current) =>
                          updateDeliverySuggestion(current, {
                            deliverableKind: event.target.value || null,
                          })
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="composer-submit"
              disabled={
                createWork.isPending ||
                briefPending ||
                !uploadsReady ||
                lensState.phase === 'frozen' ||
                quotaBlocked ||
                (lensId != null && !quoteView)
              }
              onClick={() => void attemptSubmit()}
              type="button"
            >
              {creation_entry_submit()}
            </Button>
            {submissionGroundingBlocked === 'store' ? (
              <p
                className="text-sm text-destructive"
                data-testid="composer-grounding-blocker"
                role="alert"
              >
                {workbench_grounding_store_required()}{' '}
                <Link
                  className="font-medium underline underline-offset-4"
                  to="/dashboard/store"
                >
                  {workbench_grounding_go_to_store()}
                </Link>
              </p>
            ) : submissionGroundingBlocked === 'source' ? (
              <p
                className="text-sm text-destructive"
                data-testid="composer-grounding-blocker"
                role="alert"
              >
                {workbench_grounding_source_required()}
              </p>
            ) : createWork.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {workbench_operation_failed()}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {quotaBlocked ? (
        <QuotaBlockingCard
          blocked
          onRedeem={async ({ command, idempotencyKey }) => {
            try {
              await commandP1('redemptions', command, idempotencyKey);
              await queryClient.invalidateQueries({
                queryKey: p1QueryKeys.request('entitlements', 'projection'),
              });
              return { ok: true };
            } catch (error) {
              return {
                ok: false,
                message:
                  error instanceof Error ? error.message : '兑换失败，请重试',
              };
            }
          }}
          onUnlocked={() => setSubmissionQuotaBlocked(false)}
        />
      ) : null}

      {surfaceQuery.data ? (
        <RecipeCardsPanel
          lensId={lensId}
          lensState={lensState}
          onLensStateChange={setLensState}
          surface={surfaceQuery.data}
          requestServerPreview={({ lensState: state, recipe }) =>
            requestRecipePatchPreview({
              recipeRevisionId: recipe.revisionId,
              currentLens: state.lensId,
              surfaceRevisionId: surfaceQuery.data.revisionId,
              draft: composerDraftToRecipeFields(state),
            })
          }
          singleColumn={singleColumn}
          useBottomSheet={viewportKind === 'mobile'}
        />
      ) : (
        <output
          className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="composer-surface-status"
        >
          {surfaceQuery.isError
            ? '创作模板暂时不可用，请稍后重试'
            : '正在读取创作模板…'}
        </output>
      )}

      <ComposerToolsStrip
        viewport={viewportKind}
        surfaceRevisionId={surfaceQuery.data?.revisionId}
        onOpenTool={(href) => {
          if (typeof window !== 'undefined') {
            window.location.assign(href);
          }
        }}
        onViewAll={(href) => {
          void navigate({ to: href as '/dashboard/catalog' });
        }}
      />

      {briefView ? (
        <BriefSurface
          view={briefView}
          onConfirm={handleBriefConfirm}
          onCancel={() => setBriefState(cancelBriefSurface(briefState).state)}
          disabled={createWork.isPending}
        />
      ) : null}
    </div>
  );
}
