import type {
  BriefSourceSignal,
  BriefTriggerInput,
  BriefTriggerProjection,
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  ComposerSubmissionSignedFields,
  CreationLensId,
  MarketingIdentityAsset,
  ProductQuoteSnapshot,
  RecipeSourceRequirement,
} from '@meiye/contracts';
import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  workbench_operation_failed,
  workbench_work_created,
} from '@/locale/paraglide/messages';
import { P1RequestError, p1ErrorCode, queryP1 } from '@/p1/client';
import type { AccountUsageProjection } from '@/product/account-usage';
import type { CreativeGroundingRequirement } from '@/product/creative-brief-editor';
import type { ViralAdaptSourcePayload } from '@/product/viral-adapt/viral-adapt-journey';

import { bindViralAdaptSource } from './viral-adapt-binding';
import {
  buildLiveBriefInput,
  requestComposerBrief,
  syncComposerBriefContext,
} from './composer-live';
import { mapComposerDestination } from './composer-destination-client';
import {
  decideComposerDestinationPreflight,
  type ComposerDestinationPreflightState,
} from './composer-destination-preflight';
import {
  decideSubmitPath,
  openBriefSurface,
  type BriefSurfaceState,
} from './brief-surface';
import {
  failComposerSession,
  bindComposerTask,
  openComposerTurn,
  type ComposerSession,
} from './composer-session';
import {
  type ComposerSubmissionBody,
  submitComposerSubmission,
} from './composer-submission-client';
import {
  type CampaignPaidWorkProjection,
  submitCampaignPaidWork,
} from './campaign-paid-work-client';
import { groundingBlockerFromMissing } from './composer-grounding-blocker';
import type { ComposerGroundingBlocker } from './composer-grounding-blocker';
import { requiredSourceSlotFromError } from './recipe-source-slot-readiness';
import type { ComposerLensState } from './lens-state-machine';
import {
  canSubmit,
  submitComposer,
  updateDeliverySuggestion,
} from './lens-state-machine';
import type { ComposerQuoteView } from './quote-wiring';
import { runComposerSubmitGateLadder } from './composer-submit-gates';
import { normalizeSelectedSkillRevisionRefs } from './skill-capability-selection';
import { submissionRoleForStyleReference } from './style-analysis-entry';
import { admitFreshCreditRun } from './workbench-credit';

type ComposerCreated = {
  contentPackage: { id: string };
  /** Present when the submit withheld Make pending paid confirmation. */
  executionConfirmationRequestId?: string;
  runId?: string;
  task: { id: string };
  threadId?: string;
  work: { id: string };
};

export type ComposerRunTransports = {
  admitRun: typeof admitFreshCreditRun;
  loadCreditProjection: () => Promise<AccountUsageProjection>;
  mapDestination: typeof mapComposerDestination;
  requestBrief: typeof requestComposerBrief;
  submitSubmission: (input: ComposerSubmissionBody) => Promise<ComposerCreated>;
  submitCampaign: typeof submitCampaignPaidWork;
  syncBrief: typeof syncComposerBriefContext;
};

const LIVE_TRANSPORTS: ComposerRunTransports = {
  admitRun: admitFreshCreditRun,
  loadCreditProjection: () =>
    queryP1<AccountUsageProjection>('entitlements', {
      action: 'projection',
      payload: {},
    }),
  mapDestination: mapComposerDestination,
  requestBrief: requestComposerBrief,
  submitSubmission: submitComposerSubmission,
  submitCampaign: submitCampaignPaidWork,
  syncBrief: syncComposerBriefContext,
};

export type ComposerCreateInput = {
  briefConfirmationId?: string;
  briefContextId: string;
  briefContextRevision: number;
  briefInput: BriefTriggerInput;
  identity?: MarketingIdentityAsset;
  identityDecision?: { id: string; revision: number };
  lensId: CreationLensId;
  intent: string;
  quote: ProductQuoteSnapshot;
  recipe: BrowserRecipeProjection;
  videoConfirmAccepted?: boolean;
};

type CurrentRef<T> = { current: T };

export type UseComposerRunOptions = {
  agentThreadId?: string | null;
  activeViralAdaptSource?: ViralAdaptSourcePayload;
  campaign?: {
    enabled: boolean;
    onStarted: (campaign: CampaignPaidWorkProjection) => void;
    secondWorkIntent: string;
  };
  briefContextRevisionRef: CurrentRef<number | null>;
  briefInputRef: CurrentRef<BriefTriggerInput | null>;
  briefState: BriefSurfaceState;
  creationMode: ComposerSubmissionSignedFields['creationMode'];
  creditProjectionQueryKey: QueryKey;
  currentQuoteView?: ComposerQuoteView | null;
  destinationAutoSubmitIntentRef: CurrentRef<string | null>;
  destinationMapPendingRef: CurrentRef<boolean>;
  destinationPreflight: ComposerDestinationPreflightState | null;
  explicitImageOperation?: string;
  fixtureSubmit: boolean;
  focusIntentAfterPrefillRef: CurrentRef<boolean>;
  identity?: MarketingIdentityAsset;
  identityDecision?: { id: string; revision: number };
  imageCardinalityValid: boolean;
  initialSurfaceRevisionId?: string;
  intentFallback?: string;
  lensState: ComposerLensState;
  missingGrounding: CreativeGroundingRequirement[];
  productGroundingReady: boolean;
  quotaBlocked: boolean;
  quote?: ProductQuoteSnapshot;
  quoteId: string | null;
  quoteSettling: boolean;
  recipe?: BrowserRecipeProjection;
  sessionIdRef: CurrentRef<string>;
  setBriefPending: React.Dispatch<React.SetStateAction<boolean>>;
  setBriefState: React.Dispatch<React.SetStateAction<BriefSurfaceState>>;
  setDestinationMapPending: React.Dispatch<React.SetStateAction<boolean>>;
  setDestinationPreflight: React.Dispatch<
    React.SetStateAction<ComposerDestinationPreflightState | null>
  >;
  setLensState: React.Dispatch<React.SetStateAction<ComposerLensState>>;
  setSession: React.Dispatch<React.SetStateAction<ComposerSession>>;
  setShowRequiredHint: React.Dispatch<React.SetStateAction<boolean>>;
  setSubmissionGroundingBlocked: React.Dispatch<
    React.SetStateAction<ComposerGroundingBlocker | null>
  >;
  setSourceSlotGuidance?: React.Dispatch<React.SetStateAction<boolean>>;
  setSubmissionQuotaBlocked: React.Dispatch<React.SetStateAction<boolean>>;
  missingRequiredSourceSlots?: RecipeSourceRequirement[];
  setSubmitBlockedMessage: React.Dispatch<React.SetStateAction<string | null>>;
  signedSubmission: ComposerSubmissionSignedFields | null;
  submissionDelivery: {
    deliverableKind: string | null;
    platform: string | null;
  };
  submissionQuantity: number;
  submissionSettings: Record<string, unknown>;
  styleReferenceAssetIds: string[];
  surface?: BrowserSurfaceProjection;
  transports?: Partial<ComposerRunTransports>;
  onAgentBinding?: (binding: { threadId: string; runId: string }) => void;
  viralJourneyActive: boolean;
  viralSubmissionRecipeReady: boolean;
  flushQuoteSettle: () => void;
  armedQuoteIdRef: CurrentRef<string | null>;
};

const COMPOSER_LENS_REQUIRED_MESSAGE =
  '还没定下要做哪种内容。先在上面选文案、图文或视频，再点发送。';
const COMPOSER_QUOTE_PENDING_MESSAGE =
  '这次的用量还没算好，所以没能开始。稍等一下，等发送键下方出现用量说明再点；一直没出来的话，改一句描述会重新算。';

export function briefSourcesFromDraft(sources: unknown[]): BriefSourceSignal[] {
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

function groundingBlockerFromError(error: unknown) {
  if (!(error instanceof P1RequestError)) return null;
  const missing = error.details?.missing;
  if (!Array.isArray(missing)) return null;
  const requirements = missing.filter(
    (value): value is CreativeGroundingRequirement =>
      value === 'confirmed_store' ||
      value === 'confirmed_project' ||
      value === 'confirmed_qualification' ||
      value === 'real_authorized_asset'
  );
  // A store gap normally never reaches a request: customized creation names it
  // on the button and opens the fact card first. Core resolves grounding for
  // every submission regardless of creation mode, so free creation meets that
  // rule at the server instead — and a refused press has to say why (#345).
  return (
    groundingBlockerFromMissing(requirements) ??
    (requirements.includes('confirmed_store') ||
    requirements.includes('confirmed_project')
      ? 'store'
      : null)
  );
}

export function useComposerRun(options: UseComposerRunOptions) {
  const queryClient = useQueryClient();
  const transports = { ...LIVE_TRANSPORTS, ...options.transports };
  const creditAdmissionPendingRef = useRef(false);
  const [creditAdmissionPending, setCreditAdmissionPending] = useState(false);
  const sourceReferenceIds = options.lensState.draft.sources.flatMap(
    (source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source))
        return [];
      const id = (source as Record<string, unknown>).id;
      return typeof id === 'string' ? [id] : [];
    }
  );

  const createWork = useMutation({
    mutationFn: async (input: ComposerCreateInput) => {
      if (options.fixtureSubmit) {
        return {
          contentPackage: { id: `fixture-package-${input.lensId}` },
          task: { id: `fixture-task-${input.lensId}` },
          work: { id: `fixture-work-${input.lensId}` },
        };
      }
      if (input.lensId === 'video' && !input.videoConfirmAccepted) {
        throw new Error('Video quote confirmation is required.');
      }
      const currentBrief = await transports.requestBrief({
        ...input.briefInput,
        ...(input.briefConfirmationId
          ? { confirmationId: input.briefConfirmationId }
          : {}),
      });
      if (
        currentBrief.requiresBrief ||
        (input.briefConfirmationId && !currentBrief.confirmationValid)
      ) {
        throw new Error('Brief confirmation is no longer current.');
      }
      if (!options.signedSubmission || !options.surface) {
        throw new Error('Composer delivery contract is incomplete.');
      }
      if (options.signedSubmission.viralAdaptSource) {
        const rebound = bindViralAdaptSource({
          sessionId: options.sessionIdRef.current,
          payload: options.signedSubmission.viralAdaptSource,
          sources: options.lensState.draft.sources,
        });
        if (
          !options.activeViralAdaptSource ||
          !rebound.ok ||
          rebound.binding.sessionId !== options.sessionIdRef.current
        ) {
          throw new Error(
            'Viral adapt source is no longer ready for this run.'
          );
        }
      }
      const catalogModelRevision = input.quote.catalogModelRevision;
      if (!catalogModelRevision) {
        throw new Error('Composer quote is missing its catalog revision.');
      }
      const assets = options.lensState.draft.sources.flatMap((source) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          return [];
        }
        const candidate = source as Record<string, unknown>;
        return typeof candidate.id === 'string' &&
          typeof candidate.revision === 'string'
          ? [
              {
                id: candidate.id,
                revision: candidate.revision,
                role: submissionRoleForStyleReference(
                  candidate.id,
                  options.styleReferenceAssetIds
                ),
              },
            ]
          : [];
      });
      if (assets.length !== sourceReferenceIds.length) {
        throw new Error('Composer source revisions are incomplete.');
      }
      const submission: ComposerSubmissionBody = {
        ...options.signedSubmission,
        ...(options.agentThreadId
          ? { agentThreadId: options.agentThreadId }
          : {}),
        ...(input.briefConfirmationId
          ? {
              briefConfirmation: {
                id: input.briefConfirmationId,
                revision: currentBrief.bindRevisions.draftRevisionId,
              },
            }
          : {}),
        briefContext: {
          id: input.briefContextId,
          revision: input.briefContextRevision,
        },
        catalogModel: {
          id: input.quote.catalogModelId,
          revision: catalogModelRevision,
        },
        ...(input.identity
          ? {
              identity: {
                id: input.identity.identityId,
                revision: String(input.identity.version),
              },
            }
          : {}),
        ...(input.identityDecision
          ? { identityDecision: input.identityDecision }
          : {}),
        idempotencyKey: `composer-submit:${options.sessionIdRef.current}:${input.quote.revision}`,
        creationMode: options.creationMode,
        intent: input.intent,
        quote: { id: input.quote.quoteId, revision: input.quote.revision },
        recipe: {
          id: input.recipe.recipeId,
          revision: input.recipe.revisionId,
        },
        sources: { assets },
        surface: {
          id: options.surface.surfaceId,
          revision: options.surface.revisionId,
        },
        // Spec E / #380: draft selection freezes into the submission body.
        userSelectedSkillRefs: normalizeSelectedSkillRevisionRefs(
          options.lensState.draft.selectedSkillRevisionRefs ?? []
        ),
      };
      if (options.campaign?.enabled) {
        return {
          campaign: await transports.submitCampaign({
            firstWork: submission,
            secondWorkIntent: options.campaign.secondWorkIntent,
          }),
        };
      }
      return transports.submitSubmission(submission);
    },
    onSuccess: async (created, variables) => {
      if ('campaign' in created) {
        options.campaign?.onStarted(created.campaign);
        toast.success('计划已创建，确认排期后将创建第 1 个付费 Work。');
        return;
      }
      if (created.threadId && created.runId) {
        options.onAgentBinding?.({
          threadId: created.threadId,
          runId: created.runId,
        });
      }
      const submitted = submitComposer(options.lensState, {
        videoConfirmAccepted:
          variables.lensId === 'video'
            ? variables.videoConfirmAccepted
            : undefined,
        confirmPriceMatchesCharge: true,
      });
      if (submitted.ok) options.setLensState(submitted.state);
      toast.success(workbench_work_created());
      options.setSession((current) =>
        bindComposerTask(current, {
          taskId: created.task.id,
          workId: created.work.id,
          packageId: created.contentPackage.id,
          agentThreadId: created.threadId,
          agentRunId: created.runId,
          ...(created.executionConfirmationRequestId
            ? {
                executionConfirmationRequestId:
                  created.executionConfirmationRequestId,
              }
            : {}),
        })
      );
      await queryClient.invalidateQueries({
        queryKey: options.creditProjectionQueryKey,
      });
      await queryClient.refetchQueries({
        queryKey: options.creditProjectionQueryKey,
        type: 'active',
      });
    },
    onMutate: () => {
      options.setSubmissionGroundingBlocked(null);
      options.setSourceSlotGuidance?.(false);
    },
    onError: (error) => {
      if (requiredSourceSlotFromError(error)) {
        options.setSourceSlotGuidance?.(true);
        options.setSession((current) =>
          current.phase === 'idle' ? current : { ...current, phase: 'idle' }
        );
        return;
      }
      options.setSession((current) => failComposerSession(current));
      if (p1ErrorCode(error) === 'CREATIVE_GROUNDING_INCOMPLETE') {
        const blocker =
          groundingBlockerFromError(error) ??
          groundingBlockerFromMissing(options.missingGrounding);
        if (blocker) {
          // Same rule as below: the blocker renders inline with the link that
          // fixes it, so a toast repeating the identical sentence only doubled
          // the message.
          options.setSubmissionGroundingBlocked(blocker);
          return;
        }
      }
      if (
        p1ErrorCode(error) === 'INSUFFICIENT_ENTITLEMENT' ||
        p1ErrorCode(error) === 'ENTITLEMENT_INSUFFICIENT'
      ) {
        options.setSubmissionQuotaBlocked(true);
        void queryClient.invalidateQueries({
          queryKey: options.creditProjectionQueryKey,
        });
      }
      // No toast here. `createWork.isError` already renders the failure inline
      // under the send button, and a toast on top of it made one failed run say
      // two different things at once — 「操作未完成」 in the alert and 「暂时无法
      // 建立创作记录」 in the toast (live-tested 2026-08-07). The inline alert is
      // the surface that keeps: it sits where the merchant clicked and it stays
      // put, where a toast is gone before she has read it.
    },
  });

  useEffect(() => {
    if (!options.focusIntentAfterPrefillRef.current || createWork.isPending) {
      return;
    }
    const intentInput = document.querySelector(
      '[data-testid="composer-intent-input"]'
    );
    if (!(intentInput instanceof HTMLTextAreaElement) || intentInput.disabled) {
      return;
    }
    options.focusIntentAfterPrefillRef.current = false;
    intentInput.focus();
  });

  const runCreate = async (
    selectedLens: CreationLensId,
    videoConfirmAccepted?: boolean,
    briefConfirmationId?: string,
    onAdmitted?: () => void
  ) => {
    if (creditAdmissionPendingRef.current || createWork.isPending) return;
    const briefInput = options.briefInputRef.current;
    const briefContextRevision = options.briefContextRevisionRef.current;
    if (
      !options.recipe ||
      !briefInput?.briefContextId ||
      briefContextRevision === null ||
      !options.quote ||
      !options.currentQuoteView
    ) {
      options.setSession((current) => failComposerSession(current));
      toast.error(workbench_operation_failed());
      return;
    }
    creditAdmissionPendingRef.current = true;
    setCreditAdmissionPending(true);
    try {
      const admission = await transports.admitRun({
        loadProjection: () =>
          queryClient.fetchQuery({
            queryKey: options.creditProjectionQueryKey,
            queryFn: transports.loadCreditProjection,
            retry: false,
            staleTime: 0,
          }),
        quote: options.currentQuoteView,
      });
      if (admission.kind === 'shortfall') {
        options.setSession((current) => failComposerSession(current));
        options.setSubmissionQuotaBlocked(true);
        return;
      }
      if (admission.kind === 'unavailable') {
        options.setSession((current) => failComposerSession(current));
        options.setSubmitBlockedMessage('积分余额暂时无法确认，请重试。');
        return;
      }
      onAdmitted?.();
      await createWork.mutateAsync({
        briefContextId: briefInput.briefContextId,
        briefContextRevision,
        briefInput,
        identity: options.identity,
        identityDecision: options.identityDecision,
        lensId: selectedLens,
        intent:
          options.lensState.draft.userText.trim() ||
          options.intentFallback ||
          '创作',
        quote: options.quote,
        recipe: options.recipe,
        videoConfirmAccepted,
        ...(briefConfirmationId ? { briefConfirmationId } : {}),
      });
    } catch {
      // Mutation handlers own merchant-facing submission failures.
    } finally {
      creditAdmissionPendingRef.current = false;
      setCreditAdmissionPending(false);
    }
  };

  const attemptSubmit = async () => {
    createWork.reset();
    options.setSubmitBlockedMessage(null);
    let submitGate: ReturnType<typeof canSubmit> | undefined;
    await runComposerSubmitGateLadder({
      imageCardinality: () => {
        if (options.imageCardinalityValid) return true;
        document
          .querySelector<HTMLElement>(
            '[data-testid="composer-image-operation-picker"]'
          )
          ?.focus();
        return false;
      },
      canSubmit: () => {
        submitGate = canSubmit(options.lensState);
        if (
          !submitGate.allowed &&
          submitGate.reason !== 'video_confirm_required'
        ) {
          options.setShowRequiredHint(true);
          options.setSubmitBlockedMessage(submitGate.message);
          if (submitGate.focusTarget === 'lens_group') {
            document
              .querySelector<HTMLElement>(
                '[data-testid="composer-lens-radiogroup"]'
              )
              ?.focus();
          }
          return false;
        }
        if (options.lensState.phase === 'selected') return true;
        options.setSubmitBlockedMessage(COMPOSER_LENS_REQUIRED_MESSAGE);
        return false;
      },
      viralReadiness: () => {
        if (
          !options.viralJourneyActive ||
          (options.viralSubmissionRecipeReady && options.activeViralAdaptSource)
        ) {
          return true;
        }
        options.setSubmitBlockedMessage(
          '爆款复刻的模板或参考素材尚未确认，当前不会按默认图文提交。'
        );
        return false;
      },
      destinationPreflight: async () => {
        const destinationDecision = decideComposerDestinationPreflight({
          appliedRecipeDestination:
            options.recipe?.revisionId ===
            options.lensState.draft.recipeRevisionId
              ? options.recipe.delivery
              : undefined,
          currentDestination: {
            contentPackagePlatform: options.lensState.draft.delivery.platform,
            distributionTarget:
              options.lensState.draft.delivery.distributionTarget,
          },
          hasExplicitDestination:
            options.lensState.draft.fieldMeta.deliveryPlatform?.ownership ===
              'user' &&
            options.lensState.draft.fieldMeta.deliveryPlatform.dirty,
          intent: options.lensState.draft.userText,
          state: options.destinationPreflight,
        });
        if (destinationDecision.kind === 'continue') return true;
        if (destinationDecision.kind === 'block') {
          document
            .querySelector<HTMLElement>(
              '[data-testid="composer-destination-clarification"]'
            )
            ?.focus();
          return false;
        }
        if (options.destinationMapPendingRef.current) return false;
        options.destinationMapPendingRef.current = true;
        options.setDestinationMapPending(true);
        try {
          const result = await transports.mapDestination(
            destinationDecision.destination
          );
          options.setDestinationPreflight({
            intent: destinationDecision.destination,
            result,
          });
          if (result.status === 'mapped') {
            options.destinationAutoSubmitIntentRef.current =
              destinationDecision.destination;
            options.setLensState((current) =>
              current.draft.userText.trim() === destinationDecision.destination
                ? updateDeliverySuggestion(
                    current,
                    {
                      distributionTarget: result.distributionTarget,
                      platform: result.contentPackagePlatform,
                    },
                    'system'
                  )
                : current
            );
          }
        } catch {
          toast.error('暂时无法确认发布去向，请重试或直接选择平台。');
        } finally {
          options.destinationMapPendingRef.current = false;
          options.setDestinationMapPending(false);
        }
        return false;
      },
      quota: () => {
        if (options.quotaBlocked) {
          options.setSubmissionQuotaBlocked(true);
          return false;
        }
        if (options.quote && options.currentQuoteView && options.recipe) {
          return true;
        }
        if (options.quoteSettling) {
          options.armedQuoteIdRef.current = options.quoteId;
          options.flushQuoteSettle();
          return false;
        }
        options.setShowRequiredHint(true);
        options.setSubmitBlockedMessage(COMPOSER_QUOTE_PENDING_MESSAGE);
        return false;
      },
      grounding: () => {
        const blocker = options.productGroundingReady
          ? groundingBlockerFromMissing(options.missingGrounding)
          : null;
        if (!blocker) return true;
        options.setSubmissionGroundingBlocked(blocker);
        return false;
      },
      sourceSlots: () => {
        if ((options.missingRequiredSourceSlots ?? []).length === 0) {
          return true;
        }
        options.setSourceSlotGuidance?.(true);
        return false;
      },
      confirm: async () => {
        if (
          options.lensState.phase !== 'selected' ||
          !options.quote ||
          !options.recipe
        ) {
          return false;
        }
        options.setSession((current) =>
          openComposerTurn(current, options.lensState.draft.userText)
        );
        options.setBriefPending(true);
        let projection: BriefTriggerProjection | undefined;
        try {
          const briefContextId = `composer:${options.sessionIdRef.current}`;
          const briefContext = await transports.syncBrief({
            briefContextId,
            draft: {
              delivery: options.submissionDelivery,
              imageOperation: options.explicitImageOperation ?? null,
              settings: options.submissionSettings,
              sources: briefSourcesFromDraft(options.lensState.draft.sources),
              userText: options.lensState.draft.userText,
            },
            expectedRevision: options.briefContextRevisionRef.current,
            lensId: options.lensState.lensId,
            quoteId: options.quote.quoteId,
            recipeRevisionId: options.recipe.revisionId,
            sourceIds: sourceReferenceIds,
            surfaceRevisionId:
              options.surface?.revisionId ??
              options.initialSurfaceRevisionId ??
              null,
          });
          options.briefContextRevisionRef.current = briefContext.revision;
          const briefInput = buildLiveBriefInput({
            briefContextId,
            lensId: options.lensState.lensId,
            quote: options.quote,
            currentRevisions: briefContext.currentRevisions,
            delivery: options.submissionDelivery,
            imageCount:
              options.lensState.lensId === 'image_text'
                ? options.submissionQuantity
                : 0,
            sources: briefSourcesFromDraft(options.lensState.draft.sources),
            highRiskFacts:
              /价格|价目|团购|优惠|\d+\s*元/u.test(
                options.lensState.draft.userText
              ) &&
              !options.lensState.draft.sources.some(
                (source) =>
                  source &&
                  typeof source === 'object' &&
                  !Array.isArray(source) &&
                  (source as Record<string, unknown>).category === 'price_list'
              )
                ? [{ kind: 'price', status: 'missing' }]
                : [],
          });
          options.briefInputRef.current = briefInput;
          projection = await transports.requestBrief(briefInput);
        } catch {
          options.setSession((current) => failComposerSession(current));
          toast.error(workbench_operation_failed());
          return false;
        } finally {
          options.setBriefPending(false);
        }
        const videoConfirmRequired =
          options.lensState.lensId === 'video' ||
          (submitGate?.allowed === false &&
            submitGate.reason === 'video_confirm_required');
        if (videoConfirmRequired && !projection) {
          options.setShowRequiredHint(true);
          return false;
        }
        const path = decideSubmitPath({ projection, videoConfirmRequired });
        if (path.path === 'open_brief') {
          options.setBriefState(
            openBriefSurface(options.briefState, {
              projection: path.projection,
              composerSnapshot: {
                userText: options.lensState.draft.userText,
                sources: [...options.lensState.draft.sources],
                lensId: options.lensState.lensId,
                draftRevisionId: path.projection.bindRevisions.draftRevisionId,
              },
            })
          );
          return false;
        }
        if (videoConfirmRequired) {
          options.setShowRequiredHint(true);
          return false;
        }
        void runCreate(options.lensState.lensId);
        return true;
      },
    });
  };

  return { attemptSubmit, createWork, creditAdmissionPending, runCreate };
}
