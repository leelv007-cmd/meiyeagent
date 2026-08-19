/**
 * W02 五步录入向导 — the merchant-facing surface of the parse-service five-step
 * contract, and the second entry into the D-151① write channel.
 *
 * Two things this screen refuses to do: present a machine reading as the
 * merchant's own answer (every prefill keeps a provenance badge), and open a
 * second way into the fact ledger (everything leaves through
 * `finalize_store_intake`). Step 5 is one archive card: glance, edit, save.
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  account_usage_retry,
  progressive_fact_address_label,
  progressive_fact_booking_label,
  progressive_fact_brand_voice_label,
  progressive_fact_city_label,
  progressive_fact_district_label,
  progressive_fact_industry_label,
  progressive_fact_name_label,
  progressive_fact_price_validity_unanswered,
  progressive_fact_project_name_label,
  progressive_fact_project_price_label,
  progressive_fact_project_price_validity_label,
  store_intake_arrange,
  store_intake_arrange_empty,
  store_intake_arrange_failed,
  store_intake_arrange_manual,
  store_intake_arrange_none,
  store_intake_arrange_recognized,
  store_intake_arranging,
  store_intake_back,
  store_intake_batch_failed,
  store_intake_batch_retry,
  store_intake_batch_run,
  store_intake_batch_running,
  store_intake_batch_timeout,
  store_intake_batch_to_manual,
  store_intake_confirm_all,
  store_intake_fixture_label,
  store_intake_confirm_hint,
  store_intake_confirm_title,
  store_intake_description,
  store_intake_example_another,
  store_intake_example_source,
  store_intake_experience_failed,
  store_intake_import_confirm,
  store_intake_import_empty,
  store_intake_import_hint,
  store_intake_import_title,
  store_intake_industry_beauty_salon,
  store_intake_industry_hair_care,
  store_intake_industry_hair_growth,
  store_intake_industry_label,
  store_intake_industry_lash,
  store_intake_industry_nail,
  store_intake_industry_skin_management,
  store_intake_next,
  store_intake_origin_ai,
  store_intake_origin_import,
  store_intake_origin_merchant,
  store_intake_origin_parsed,
  store_intake_origin_platform,
  store_intake_parse_closed,
  store_intake_photo_choose,
  store_intake_photo_failed,
  store_intake_photo_label,
  store_intake_photo_ready,
  store_intake_photo_unsupported,
  store_intake_photo_uploading,
  store_intake_photos_choose,
  store_intake_photos_label,
  store_intake_photos_ready,
  store_intake_price_validity_hint,
  store_intake_recommendation_hint,
  store_intake_recommended,
  store_intake_rights_optional,
  store_intake_rights_prompt,
  store_intake_save_failed,
  store_intake_saved,
  store_intake_saving,
  store_intake_sentence_label,
  store_intake_sentence_placeholder,
  store_intake_slot_label,
  store_intake_slot_product,
  store_intake_slot_store_scene,
  store_intake_slot_subject_person,
  store_intake_slot_work_case,
  store_intake_step_ai_arrange,
  store_intake_step_choose_recommendations,
  store_intake_step_confirm_each,
  store_intake_step_required_note,
  store_intake_step_say_or_upload,
  store_intake_step_see_examples,
  store_intake_target_label,
  store_intake_target_price_list,
  store_intake_target_visual_asset,
  store_intake_title,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { toast } from 'sonner';
import { p1QueryKeys } from '@/p1/query-keys';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import {
  uploadWorkspaceIntakeAsset,
  WorkspaceAssetUploadError,
  type WorkspaceAssetUpload,
} from '@/p1/workspace-asset-upload';
import {
  answerProgressiveFact,
  archiveCardReady,
  buildFinalizeStoreIntakeCommand,
  confirmArchiveCard,
  createProgressiveFactDraft,
  editArchiveField,
  progressiveFactRevisionMap,
  type ProgressiveFactId,
  type ProgressiveFactProvenance,
} from '@/product/composer/progressive-fact';
import { PriceValidityAnswer } from '@/product/composer/price-validity-answer';
import type { useProductState } from '@/product/client';
import type {
  AssetDraftView,
  AssetIntakeBatch,
  AssetIntakeExperience,
  AssetParseTaskDrafts,
  ExtractStoreSentenceResult,
  ParseTask,
  StoreFact,
  StoreProfile,
  VisualAssetSlot,
} from '@meiye/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  applyArrangedDraft,
  applyBatchDrafts,
  applyLlmSentenceSuggestions,
  applySentenceDraft,
  arrangementRecognizedFields,
  assetParseTaskDraftsQuery,
  assetParseTaskQuery,
  batchPollDelayMs,
  buildImportFinalizeCommand,
  canArrange,
  canBatchParse,
  createStoreIntakeWizardState,
  currentStep,
  draftSupplyFromExperience,
  editSentence,
  extractStoreSentenceRequest,
  goToStep,
  importCandidateGroups,
  isPhotoParseOpen,
  orderedIntakeFields,
  parseAssetBatchRequest,
  parseSingleAssetRequest,
  prepareManualDraftRequest,
  recommendedFactIds,
  resolveBatchPollTick,
  rotateExample,
  selectedExample,
  SENTENCE_EXTRACT_TIMEOUT_MS,
  shouldShowFixtureParseLabel,
  statedSentence,
  toggleRecommendation,
  type ImportCandidateGroup,
  type StoreIntakeStepId,
  type StoreIntakeTarget,
} from './store-intake-wizard-model';

type ProductController = Pick<
  ReturnType<typeof useProductState>,
  'refresh' | 'state'
>;

/**
 * D-C3: the merchant's own 主营方向, not the supply catalogue. 美甲 and 美睫 are
 * the first persona and used to have nothing to pick here. Categories with no
 * published recommendation supply still fall through at the recommendation
 * layer (`resolveTodayRecommendationIndustrySlug` → undefined).
 */
const INDUSTRIES = [
  ['hair_care', store_intake_industry_hair_care],
  ['nail', store_intake_industry_nail],
  ['lash', store_intake_industry_lash],
  ['skin_management', store_intake_industry_skin_management],
  ['beauty_salon', store_intake_industry_beauty_salon],
  ['hair_growth', store_intake_industry_hair_growth],
] as const;

const STEP_LABELS: Record<StoreIntakeStepId, () => string> = {
  ai_arrange: store_intake_step_ai_arrange,
  choose_recommendations: store_intake_step_choose_recommendations,
  confirm_each: store_intake_step_confirm_each,
  say_or_upload: store_intake_step_say_or_upload,
  see_examples: store_intake_step_see_examples,
};

const FIELD_LABELS: Record<ProgressiveFactId, () => string> = {
  address: progressive_fact_address_label,
  booking: progressive_fact_booking_label,
  brandVoice: progressive_fact_brand_voice_label,
  city: progressive_fact_city_label,
  district: progressive_fact_district_label,
  industry: progressive_fact_industry_label,
  name: progressive_fact_name_label,
  projectName: progressive_fact_project_name_label,
  projectPrice: progressive_fact_project_price_label,
  projectPriceValidity: progressive_fact_project_price_validity_label,
};

/** The parse contract's four visual slots — no local re-categorisation. */
const SLOT_LABELS: Record<VisualAssetSlot, () => string> = {
  product: store_intake_slot_product,
  store_scene: store_intake_slot_store_scene,
  subject_person: store_intake_slot_subject_person,
  work_case: store_intake_slot_work_case,
};

const PROVENANCE_LABELS: Record<ProgressiveFactProvenance, () => string> = {
  ai_suggestion: store_intake_origin_ai,
  import: store_intake_origin_import,
  photo_extract: store_intake_origin_parsed,
  platform_default: store_intake_origin_platform,
  user: store_intake_origin_merchant,
};

export function StoreIntakeWizard({
  product,
  surface = 'store',
}: {
  product: ProductController;
  /** Both mount points render the same wizard; only the test id differs. */
  surface?: 'store' | 'assets';
}) {
  const workspaceId = product.state?.workspaceId ?? '';
  // V31-51: product projects explicit `store: null` for no confirmed profile.
  const store = product.state?.store ?? undefined;
  const [industry, setIndustry] = useState<string>('hair_care');
  const queryClient = useQueryClient();
  const complianceDefaults = useComplianceDefaults();
  // Wizard state is declared before the queries because guidance is fetched per
  // industry *and* per asset type: the samples and the recommended fields have
  // to follow whichever lane the merchant picks in step 3.
  const [state, setState] = useState(() =>
    createStoreIntakeWizardState(createProgressiveFactDraft(store, []))
  );
  const target = state.target;

  useEffect(() => {
    if (!store?.industry || state.draft.provenance.industry === 'user') return;
    setIndustry(store.industry);
  }, [state.draft.provenance.industry, store?.industry]);

  const experience = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: p1QueryKeys.request('asset-memory', 'asset_intake_experience', {
      assetType: target,
      industry,
    }),
    queryFn: ({ signal }) =>
      queryP1<AssetIntakeExperience>(
        'asset-memory',
        {
          action: 'asset_intake_experience',
          payload: { assetType: target, industry },
        },
        signal
      ),
  });

  const storeFacts = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: p1QueryKeys.request('context', 'store_facts_active', {
      scope: { storeId: workspaceId },
    }),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        {
          action: 'store_facts_active',
          payload: {
            at: new Date().toISOString(),
            scope: { storeId: workspaceId },
          },
        },
        signal
      ),
  });

  /**
   * A price whose window has closed is no longer *active*, but its stream is
   * still there and its head still has a revision. Confirming a fresh price on
   * top of it therefore has to expect that head — reading the revision off the
   * active list alone would say 0 and collide (#244). Only fetched when the
   * stream is missing from the active list, so the ordinary case costs nothing.
   */
  const project = store?.projects[0];
  const projectFactIds = project
    ? {
        price: `store-project:${project.id}:price`,
        service: `store-project:${project.id}:service`,
      }
    : null;
  const activeFactIds = new Set(
    (storeFacts.data ?? []).map((fact) => fact.factId)
  );
  const lapsedFactIds = projectFactIds
    ? [projectFactIds.service, projectFactIds.price].filter(
        (factId) => !activeFactIds.has(factId)
      )
    : [];
  const lapsedFactHistory = useQuery({
    enabled: storeFacts.isSuccess && lapsedFactIds.length > 0,
    queryKey: p1QueryKeys.request('context', 'store_fact_history', {
      factIds: lapsedFactIds,
    }),
    queryFn: async ({ signal }) => {
      const histories = await Promise.all(
        lapsedFactIds.map((factId) =>
          queryP1<StoreFact[]>(
            'context',
            { action: 'store_fact_history', payload: { factId } },
            signal
          )
        )
      );
      return histories.flat();
    },
  });
  const factHeads = [
    ...(storeFacts.data ?? []),
    ...(lapsedFactHistory.data ?? []),
  ];

  const [seededRevision, setSeededRevision] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [saved, setSaved] = useState(false);
  /** Batch progress message comes from Core (`merchantParseProgress`). */
  const [batchProgress, setBatchProgress] = useState<{
    completed: number;
    message: string;
    total: number;
  } | null>(null);
  const [batchStatus, setBatchStatus] = useState<ParseTask['status'] | null>(
    null
  );
  const [batchTerminal, setBatchTerminal] = useState<
    'failed' | 'timeout' | null
  >(null);
  const [batchPending, setBatchPending] = useState(false);
  const batchPollAbortRef = useRef<AbortController | null>(null);
  const sentenceExtractAbortRef = useRef<AbortController | null>(null);
  const lastExtractedSentenceRef = useRef('');
  const [sentenceExtracting, setSentenceExtracting] = useState(false);

  const arrange = useMutation({
    mutationFn: async (input: {
      manual: boolean;
      upload: WorkspaceAssetUpload;
    }) => {
      const id = crypto.randomUUID();
      const request = input.manual
        ? prepareManualDraftRequest({
            assetId: `intake-asset:${input.upload.sha256.slice(0, 24)}`,
            draft: state.draft,
            rightsConfirmed: state.rightsConfirmed,
            sentence: state.sentence,
            target: state.target,
            taskId: `intake-task:${id}`,
            upload: input.upload,
          })
        : parseSingleAssetRequest({
            assetId: `intake-asset:${input.upload.sha256.slice(0, 24)}`,
            rightsConfirmed: state.rightsConfirmed,
            target: state.target,
            taskId: `intake-task:${id}`,
            upload: input.upload,
          });
      const result = await commandP1<
        AssetDraftView | { draft: AssetDraftView }
      >('asset-memory', request, `intake-arrange:${id}`);
      return 'draft' in result ? result.draft : result;
    },
    onSuccess: (draft) => {
      setState((current) => applyArrangedDraft(current, draft));
    },
  });

  const confirmAll = useMutation({
    mutationFn: async () => {
      const id = crypto.randomUUID();
      const request = buildFinalizeStoreIntakeCommand(
        confirmArchiveCard(state.draft),
        {
          batchId: `intake-batch:${id}`,
          capturedAt: new Date().toISOString(),
          expectedRevision: store?.revision ?? 0,
          factRevisions: progressiveFactRevisionMap(factHeads),
          referenceId: `store-intake-wizard:${id}`,
          regulatedDefault:
            complianceDefaults.data?.['compliance.regulated_mode.default'],
          taskId: `intake-task:${id}`,
          workspaceId,
        }
      );
      if (!request) {
        throw new Error('STORE_INTAKE_NOT_READY');
      }
      await commandP1('asset-memory', request, `intake-finalize:${id}`);
      await Promise.all([
        product.refresh(),
        storeFacts.refetch(),
        // Fresh facts are exactly what the cold 今日建议 chip was waiting for
        // (QA ISSUE-008). The reminder card used to do this when it still
        // confirmed; the confirm lives here now, so the invalidation does too.
        queryClient.invalidateQueries({
          queryKey: ['harness', 'today-recommendation'],
        }),
      ]);
    },
    onError: () => {
      toast.error(store_intake_save_failed());
    },
    onSuccess: () => setSaved(true),
  });

  /**
   * The product state arrives after the first render, so the draft has to be
   * re-seeded once the profile lands — otherwise the wizard would show empty
   * fields for a merchant who already has a store. Re-seeding stops the moment
   * the merchant has confirmed or extracted anything, so an in-progress session
   * is never overwritten by a background refresh.
   */
  const untouched =
    state.draft.answered.length === 0 && state.arrangedOrigin === null;
  useEffect(() => {
    if (!store || !storeFacts.isSuccess) return;
    const revision = store.revision ?? 0;
    if (seededRevision === revision || !untouched) return;
    setSeededRevision(revision);
    setState((current) => ({
      ...current,
      draft: createProgressiveFactDraft(store, storeFacts.data),
    }));
  }, [seededRevision, store, storeFacts.data, storeFacts.isSuccess, untouched]);

  const steps = experience.data?.steps ?? [];
  /*
   * The contract ships exactly one non-optional step, and the note names it.
   * If a future contract marks more than one the sentence would be wrong, so
   * it simply does not render — saying nothing beats saying something false.
   */
  const requiredSteps = steps.filter((item) => !item.optional);
  const requiredStep =
    requiredSteps.length === 1 ? requiredSteps[0] : undefined;
  const step = experience.data
    ? currentStep(experience.data, state)
    : undefined;
  const example = experience.data
    ? selectedExample(experience.data, state)
    : undefined;
  // Core draftSupply only — never guess fixture from FE env.
  const draftSupply = draftSupplyFromExperience(experience.data);
  const photoParseOpen = isPhotoParseOpen(draftSupply);
  const showFixtureLabel = shouldShowFixtureParseLabel(draftSupply);
  const recognized = arrangementRecognizedFields(state);
  // "勾上的我会重点问" is a promise the confirm step has to keep: the ticked
  // fields lead, and the sentence box carries the same skeleton.
  const recommended = experience.data
    ? recommendedFactIds(experience.data, state)
    : [];
  const fieldOrder = orderedIntakeFields(recommended);
  const readyToSave = archiveCardReady(state.draft);
  // The first patch has to carry the platform's `regulated` call, so Day-0
  // confirmation waits for the admin default rather than guessing it.
  const awaitingRegulatedDefault =
    (store?.revision ?? 0) === 0 &&
    complianceDefaults.data?.['compliance.regulated_mode.default'] ===
      undefined;

  // D-158: leave the ai_arrange step or unmount → stop polling immediately.
  useEffect(() => {
    if (step?.id !== 'ai_arrange') {
      batchPollAbortRef.current?.abort();
      batchPollAbortRef.current = null;
    }
  }, [step?.id]);

  useEffect(() => {
    return () => {
      batchPollAbortRef.current?.abort();
      batchPollAbortRef.current = null;
      sentenceExtractAbortRef.current?.abort();
      sentenceExtractAbortRef.current = null;
    };
  }, []);

  function requestSentenceExtract(sentence: string) {
    const text = statedSentence(sentence);
    if (!text || text === lastExtractedSentenceRef.current) return;
    sentenceExtractAbortRef.current?.abort();
    const abort = new AbortController();
    sentenceExtractAbortRef.current = abort;
    lastExtractedSentenceRef.current = text;
    setSentenceExtracting(true);
    void commandP1<ExtractStoreSentenceResult>(
      'asset-memory',
      extractStoreSentenceRequest(text),
      `intake-extract:${crypto.randomUUID()}`,
      { signal: abort.signal, timeoutMs: SENTENCE_EXTRACT_TIMEOUT_MS }
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setState((current) => {
          if (statedSentence(current.sentence) !== text) return current;
          return applyLlmSentenceSuggestions(current, result.suggestions);
        });
      })
      .catch(() => {
        // Regex prefill stays. Save is never blocked by extract failure.
      })
      .finally(() => {
        if (sentenceExtractAbortRef.current === abort) {
          setSentenceExtracting(false);
          sentenceExtractAbortRef.current = null;
        }
      });
  }

  async function upload(file: File) {
    if (!photoParseOpen) return;
    setUploadError(undefined);
    setUploading(true);
    try {
      const receipt = await uploadWorkspaceIntakeAsset({ file, workspaceId });
      setState((current) => ({ ...current, upload: receipt }));
    } catch (error) {
      setUploadError(
        error instanceof WorkspaceAssetUploadError &&
          error.reason === 'unsupported_type'
          ? store_intake_photo_unsupported()
          : store_intake_photo_failed()
      );
    } finally {
      setUploading(false);
    }
  }

  async function uploadMany(files: File[]) {
    if (!photoParseOpen || files.length === 0) return;
    setUploadError(undefined);
    setUploading(true);
    try {
      const receipts: WorkspaceAssetUpload[] = [];
      for (const file of files) {
        receipts.push(await uploadWorkspaceIntakeAsset({ file, workspaceId }));
      }
      setState((current) => ({
        ...current,
        uploads: receipts,
        // Keep the first receipt on the single lane so manual fallback works.
        upload: receipts[0] ?? current.upload,
      }));
      setBatchTerminal(null);
      setBatchProgress(null);
      setBatchStatus(null);
    } catch (error) {
      setUploadError(
        error instanceof WorkspaceAssetUploadError &&
          error.reason === 'unsupported_type'
          ? store_intake_photo_unsupported()
          : store_intake_photo_failed()
      );
    } finally {
      setUploading(false);
    }
  }

  async function sleep(ms: number, signal: AbortSignal) {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Batch arrange: start_parse_asset_batch → poll asset_parse_task → drafts.
   * Every wait state exits on terminal status, attempt budget, cancel, or fail.
   */
  async function runBatchParse() {
    if (!photoParseOpen || !canBatchParse(state)) return;
    batchPollAbortRef.current?.abort();
    const abort = new AbortController();
    batchPollAbortRef.current = abort;
    setBatchPending(true);
    setBatchTerminal(null);
    setBatchProgress(null);
    setBatchStatus(null);
    const id = crypto.randomUUID();
    const taskId = `intake-batch-task:${id}`;
    try {
      const request = parseAssetBatchRequest({
        rightsConfirmed: state.rightsConfirmed,
        target: state.target,
        taskId,
        uploads: state.uploads,
      });
      let task = await commandP1<ParseTask>(
        'asset-memory',
        request,
        `intake-batch:${id}`
      );
      setBatchStatus(task.status);
      setBatchProgress(task.progress);

      let attempt = 0;
      while (true) {
        const decision = resolveBatchPollTick({
          attempt,
          cancelled: abort.signal.aborted,
          task,
        });
        if (decision.kind === 'cancelled') return;
        if (decision.kind === 'failed') {
          setBatchTerminal('failed');
          setBatchStatus(decision.task.status);
          setBatchProgress(decision.task.progress);
          return;
        }
        if (decision.kind === 'completed') {
          setBatchStatus(decision.task.status);
          setBatchProgress(decision.task.progress);
          const draftsQuery = assetParseTaskDraftsQuery(taskId);
          const drafts = await queryP1<AssetParseTaskDrafts>(
            'asset-memory',
            draftsQuery,
            abort.signal
          );
          if (abort.signal.aborted) return;
          setState((current) => applyBatchDrafts(current, drafts.items));
          return;
        }
        if (decision.kind === 'timeout') {
          setBatchTerminal('timeout');
          return;
        }

        await sleep(batchPollDelayMs(attempt), abort.signal);
        if (abort.signal.aborted) return;
        attempt += 1;
        const progressQuery = assetParseTaskQuery(taskId);
        task = await queryP1<ParseTask>(
          'asset-memory',
          progressQuery,
          abort.signal
        );
        if (abort.signal.aborted) return;
        setBatchStatus(task.status);
        setBatchProgress(task.progress);
      }
    } catch {
      if (!abort.signal.aborted) setBatchTerminal('failed');
    } finally {
      if (batchPollAbortRef.current === abort) {
        batchPollAbortRef.current = null;
      }
      setBatchPending(false);
    }
  }

  return (
    // 与补问门同构：`bg-muted/NN` 是 alpha token 再乘一次 alpha，必然归零，向导
    // 里的 <select> 与整排按钮就落在没有实底的面板上。表单是实体内容区，按
    // DESIGN.md §4 走白瓷。
    <section
      aria-labelledby="store-intake-wizard-title"
      className="meiye-porcelain rounded-2xl p-4"
      data-testid={`store-intake-wizard-${surface}`}
    >
      <h2 className="text-base font-medium" id="store-intake-wizard-title">
        {store_intake_title()}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {store_intake_description()}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Label className="text-xs" htmlFor="store-intake-industry">
          {store_intake_industry_label()}
        </Label>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm pointer-coarse:h-touch-target"
          data-testid="store-intake-industry"
          id="store-intake-industry"
          onChange={(event) => {
            const nextIndustry = event.target.value;
            setIndustry(nextIndustry);
            setState((current) => ({
              ...current,
              draft: answerProgressiveFact(
                current.draft,
                'industry',
                nextIndustry
              ),
            }));
          }}
          value={industry}
        >
          {INDUSTRIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label()}
            </option>
          ))}
        </select>
      </div>

      {/* A payload that arrived but carries no steps is as unusable as a failed
          request — say so instead of rendering an empty shell. */}
      {experience.isError || (experience.data && !step) ? (
        <Alert className="mt-3" variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{store_intake_title()}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {store_intake_experience_failed()}
            <Button
              onClick={() => void experience.refetch()}
              size="sm"
              variant="outline"
            >
              <IconRefresh />
              {account_usage_retry()}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {experience.data && step ? (
        <>
          {/*
            A progress track, not a menu. Every chip used to carry its own
            「可跳过」/「必做」 tag, which turned five ordered steps into five
            co-equal options and told the merchant four fifths of the guide was
            skippable before she had seen any of it. Position is what the row
            shows now — visited / here / ahead — and the one thing she has to
            do herself is said once, down beside the control that skips.
          */}
          <ol
            className="mt-4 flex flex-wrap gap-2 text-xs"
            data-testid="store-intake-steps"
          >
            {steps.map((item, index) => {
              const current = item.id === step.id;
              const visited = index < state.stepIndex;
              return (
                <li
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'rounded-full px-3 py-1',
                    current
                      ? 'bg-primary text-primary-foreground'
                      : visited
                        ? 'bg-surface-1 text-foreground'
                        : 'bg-muted text-muted-foreground'
                  )}
                  data-step={item.id}
                  key={item.id}
                >
                  {index + 1}. {STEP_LABELS[item.id]()}
                </li>
              );
            })}
          </ol>

          <div className="mt-4 space-y-3">
            {step.id === 'see_examples' && example ? (
              <div data-testid="store-intake-example">
                <p className="text-sm font-medium">{example.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {example.summary}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {store_intake_example_source()}
                </p>
                <Button
                  className="mt-2"
                  data-testid="store-intake-example-rotate"
                  onClick={() =>
                    setState((current) =>
                      rotateExample(experience.data!, current)
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {store_intake_example_another()}
                </Button>
              </div>
            ) : null}

            {step.id === 'choose_recommendations' ? (
              <div data-testid="store-intake-recommendations">
                <p className="text-xs text-muted-foreground">
                  {store_intake_recommendation_hint()}
                </p>
                <ul className="mt-2 space-y-2">
                  {experience.data.recommendations.map((recommendation) => (
                    <li
                      className="flex items-center gap-2 text-sm"
                      key={recommendation.recommendationId}
                    >
                      <Checkbox
                        checked={state.selectedRecommendations.includes(
                          recommendation.recommendationId
                        )}
                        id={recommendation.recommendationId}
                        data-testid={`store-intake-recommendation-${recommendation.recommendationId}`}
                        onCheckedChange={() =>
                          setState((current) =>
                            toggleRecommendation(
                              experience.data!,
                              current,
                              recommendation.recommendationId
                            )
                          )
                        }
                      />
                      <Label htmlFor={recommendation.recommendationId}>
                        {recommendation.label}
                      </Label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {step.id === 'say_or_upload' ? (
              <div className="space-y-3" data-testid="store-intake-capture">
                {showFixtureLabel ? (
                  <output
                    className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
                    data-testid="store-intake-fixture-label"
                  >
                    {store_intake_fixture_label()}
                  </output>
                ) : null}
                {!photoParseOpen ? (
                  <output
                    className="block rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
                    data-testid="store-intake-parse-closed"
                  >
                    {store_intake_parse_closed()}
                  </output>
                ) : null}
                {/* W02 ④: the target decides which contract lane reads the
                    photo — a price list becomes fact candidates, a visual asset
                    is classified into the four `VISUAL_ASSET_SLOTS`. */}
                <div>
                  <Label htmlFor="store-intake-target">
                    {store_intake_target_label()}
                  </Label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm pointer-coarse:h-touch-target"
                    data-testid="store-intake-target"
                    id="store-intake-target"
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        arrangedOrigin: null,
                        classification: null,
                        target: event.target.value as StoreIntakeTarget,
                      }))
                    }
                    value={state.target}
                  >
                    <option value="price_list">
                      {store_intake_target_price_list()}
                    </option>
                    <option value="visual_asset">
                      {store_intake_target_visual_asset()}
                    </option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="store-intake-sentence">
                    {store_intake_sentence_label()}
                  </Label>
                  <Textarea
                    className="mt-1"
                    data-testid="store-intake-sentence"
                    id="store-intake-sentence"
                    onChange={(event) =>
                      setState((current) =>
                        editSentence(current, event.target.value)
                      )
                    }
                    placeholder={store_intake_sentence_placeholder()}
                    value={state.sentence}
                  />
                </div>
                <div>
                  <Label htmlFor="store-intake-photo">
                    {store_intake_photo_label()}
                  </Label>
                  <Input
                    accept="image/jpeg,image/png,image/webp"
                    className="mt-1"
                    data-testid="store-intake-photo"
                    disabled={uploading || !photoParseOpen}
                    id="store-intake-photo"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file);
                    }}
                    type="file"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {uploading
                      ? store_intake_photo_uploading()
                      : state.upload
                        ? store_intake_photo_ready()
                        : store_intake_photo_choose()}
                  </p>
                  {uploadError ? (
                    <p
                      className="mt-1 text-xs text-destructive"
                      data-testid="store-intake-photo-error"
                      role="alert"
                    >
                      {uploadError}
                    </p>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="store-intake-photos">
                    {store_intake_photos_label()}
                  </Label>
                  <Input
                    accept="image/jpeg,image/png,image/webp"
                    className="mt-1"
                    data-testid="store-intake-photos"
                    disabled={uploading || !photoParseOpen}
                    id="store-intake-photos"
                    multiple
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      if (files.length > 0) void uploadMany(files);
                    }}
                    type="file"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {uploading
                      ? store_intake_photo_uploading()
                      : state.uploads.length > 0
                        ? store_intake_photos_ready({
                            count: state.uploads.length,
                          })
                        : store_intake_photos_choose()}
                  </p>
                </div>
                {/* Contract says `blocking: false` — this prompt records an
                    answer, it never stops the merchant from continuing. */}
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={state.rightsConfirmed}
                    data-testid="store-intake-rights"
                    id="store-intake-rights"
                    onCheckedChange={(checked) =>
                      setState((current) => ({
                        ...current,
                        rightsConfirmed: checked === true,
                      }))
                    }
                  />
                  <div>
                    <Label htmlFor="store-intake-rights">
                      {store_intake_rights_prompt()}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {store_intake_rights_optional()}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {step.id === 'ai_arrange' ? (
              <div className="space-y-3" data-testid="store-intake-arrange">
                {showFixtureLabel ? (
                  <output
                    className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
                    data-testid="store-intake-fixture-label"
                  >
                    {store_intake_fixture_label()}
                  </output>
                ) : null}
                {!photoParseOpen ? (
                  <output
                    className="block rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
                    data-testid="store-intake-parse-closed"
                  >
                    {store_intake_parse_closed()}
                  </output>
                ) : null}
                {!canArrange(state) ? (
                  <p className="text-sm text-muted-foreground">
                    {store_intake_arrange_empty()}
                  </p>
                ) : null}
                {statedSentence(state.sentence).length > 0 ? (
                  <Button
                    data-testid="store-intake-arrange-sentence"
                    disabled={arrange.isPending || batchPending}
                    onClick={() => {
                      setState((current) => applySentenceDraft(current));
                      requestSentenceExtract(state.sentence);
                    }}
                    type="button"
                  >
                    {store_intake_arrange()}
                  </Button>
                ) : null}
                {state.upload && photoParseOpen ? (
                  <Button
                    data-testid="store-intake-arrange-run"
                    disabled={arrange.isPending || batchPending}
                    onClick={() =>
                      arrange.mutate({ manual: false, upload: state.upload! })
                    }
                    type="button"
                  >
                    {arrange.isPending
                      ? store_intake_arranging()
                      : store_intake_arrange()}
                  </Button>
                ) : null}
                {canBatchParse(state) && photoParseOpen ? (
                  <div className="space-y-2" data-testid="store-intake-batch">
                    <Button
                      data-testid="store-intake-batch-run"
                      disabled={batchPending || arrange.isPending}
                      onClick={() => void runBatchParse()}
                      type="button"
                    >
                      {batchPending
                        ? store_intake_batch_running()
                        : store_intake_batch_run()}
                    </Button>
                    {batchProgress ? (
                      <p
                        className="text-sm text-muted-foreground"
                        data-status={batchStatus ?? undefined}
                        data-testid="store-intake-batch-progress"
                      >
                        {/* Core merchantParseProgress text — do not rephrase. */}
                        {batchProgress.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {batchTerminal ? (
                  <div
                    className="space-y-2"
                    data-testid="store-intake-batch-failed"
                    role="alert"
                  >
                    <p className="text-sm text-destructive">
                      {batchTerminal === 'timeout'
                        ? store_intake_batch_timeout()
                        : store_intake_batch_failed()}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-testid="store-intake-batch-retry"
                        disabled={batchPending}
                        onClick={() => void runBatchParse()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {store_intake_batch_retry()}
                      </Button>
                      {state.upload ? (
                        <Button
                          data-testid="store-intake-batch-to-manual"
                          disabled={arrange.isPending}
                          onClick={() =>
                            arrange.mutate({
                              manual: true,
                              upload: state.upload!,
                            })
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {store_intake_batch_to_manual()}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {arrange.isError || state.arrangeFailed ? (
                  <div
                    className="space-y-2"
                    data-testid="store-intake-arrange-failed"
                    role="alert"
                  >
                    <p className="text-sm text-destructive">
                      {store_intake_arrange_failed()}
                    </p>
                    {state.upload ? (
                      <Button
                        data-testid="store-intake-arrange-manual"
                        disabled={arrange.isPending}
                        onClick={() =>
                          arrange.mutate({
                            manual: true,
                            upload: state.upload!,
                          })
                        }
                        type="button"
                        variant="outline"
                      >
                        {store_intake_arrange_manual()}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {state.arrangedOrigin && !state.arrangeFailed ? (
                  <p
                    className="text-sm"
                    data-testid="store-intake-arrange-result"
                  >
                    {recognized.length > 0
                      ? store_intake_arrange_recognized({
                          count: recognized.length,
                        })
                      : store_intake_arrange_none()}
                  </p>
                ) : null}
                {state.classification ? (
                  <div className="space-y-1" data-testid="store-intake-slot">
                    <p className="text-sm">
                      {store_intake_slot_label()}
                      <Badge
                        className="ml-2"
                        data-testid="store-intake-slot-badge"
                        variant="outline"
                      >
                        {SLOT_LABELS[state.classification.slot]()}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {state.classification.description}
                    </p>
                    {/* `blocking: false` in the contract — a reminder, not a wall. */}
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="store-intake-slot-rights"
                    >
                      {state.classification.rightsPrompt.message}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step.id === 'confirm_each' ? (
              <div className="space-y-3" data-testid="store-intake-confirm">
                <p className="text-sm font-medium">
                  {store_intake_confirm_title()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {store_intake_confirm_hint()}
                </p>
                <ul className="space-y-3">
                  {fieldOrder.map((id) => {
                    const provenance = state.draft.provenance[id];
                    return (
                      <li className="space-y-1" data-field={id} key={id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Label htmlFor={`store-intake-field-${id}`}>
                            {FIELD_LABELS[id]()}
                          </Label>
                          {recommended.includes(id) ? (
                            <Badge
                              data-testid={`store-intake-recommended-${id}`}
                              variant="default"
                            >
                              {store_intake_recommended()}
                            </Badge>
                          ) : null}
                          {provenance ? (
                            <Badge
                              data-testid={`store-intake-provenance-${id}`}
                              variant="outline"
                            >
                              {PROVENANCE_LABELS[provenance]()}
                            </Badge>
                          ) : null}
                        </div>
                        {id === 'projectPriceValidity' ? (
                          <p className="text-xs text-muted-foreground">
                            {store_intake_price_validity_hint()}
                            {state.draft.projectPriceValidity === '' ? (
                              <span
                                className="ml-1 text-destructive"
                                data-testid="store-intake-price-validity-unanswered"
                              >
                                {progressive_fact_price_validity_unanswered()}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        {id === 'projectPriceValidity' ? (
                          <PriceValidityAnswer
                            onChange={(value) =>
                              setState((current) => ({
                                ...current,
                                draft: editArchiveField(
                                  current.draft,
                                  id,
                                  value
                                ),
                              }))
                            }
                            testId="store-intake-field-projectPriceValidity"
                            value={state.draft.projectPriceValidity}
                          />
                        ) : (
                          <Input
                            data-testid={`store-intake-field-${id}`}
                            id={`store-intake-field-${id}`}
                            inputMode={
                              id === 'projectPrice' ? 'decimal' : 'text'
                            }
                            onChange={(event) =>
                              setState((current) => ({
                                ...current,
                                draft: editArchiveField(
                                  current.draft,
                                  id,
                                  event.target.value
                                ),
                              }))
                            }
                            value={state.draft[id]}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {confirmAll.isError ? (
                  <p
                    className="text-sm text-destructive"
                    data-testid="store-intake-save-error"
                    role="alert"
                  >
                    {store_intake_save_failed()}
                  </p>
                ) : null}
                {saved ? (
                  <p className="text-sm" data-testid="store-intake-saved">
                    {store_intake_saved()}
                  </p>
                ) : null}
                <Button
                  data-testid="store-intake-save"
                  disabled={
                    confirmAll.isPending ||
                    awaitingRegulatedDefault ||
                    !readyToSave
                  }
                  onClick={() => confirmAll.mutate()}
                  type="button"
                >
                  {confirmAll.isPending
                    ? store_intake_saving()
                    : store_intake_confirm_all()}
                </Button>
              </div>
            ) : null}
          </div>

          {sentenceExtracting ? (
            <p
              className="mt-3 text-xs text-muted-foreground"
              data-testid="store-intake-sentence-extracting"
            >
              {store_intake_arranging()}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex gap-2">
              <Button
                data-testid="store-intake-back"
                disabled={state.stepIndex === 0}
                onClick={() =>
                  setState((current) => goToStep(experience.data!, current, -1))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                {store_intake_back()}
              </Button>
              <Button
                data-testid="store-intake-next"
                disabled={state.stepIndex >= steps.length - 1}
                onClick={() => {
                  setState((current) => goToStep(experience.data!, current, 1));
                  requestSentenceExtract(state.sentence);
                }}
                size="sm"
                type="button"
              >
                {store_intake_next()}
              </Button>
            </div>
            {requiredStep ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="store-intake-step-required-note"
              >
                {store_intake_step_required_note({
                  step: STEP_LABELS[requiredStep.id](),
                })}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <StoreIntakeImportPanel
        onConfirmed={async () => {
          await Promise.all([product.refresh(), storeFacts.refetch()]);
        }}
        product={product}
      />
    </section>
  );
}

/**
 * A partially staged project only carries the stream that was missing, so the
 * name or the price can be absent from the candidate itself. The stored profile
 * supplies the other half for display — it is the same value the confirmation
 * will project, so the merchant reads the whole row, not a gap.
 */
function importProjectLabel(group: ImportCandidateGroup, store: StoreProfile) {
  const project = store.projects.find(
    (item) => `project:${item.id}` === group.groupId
  );
  const name = group.label || project?.name || '';
  const price = group.value || (project ? String(project.price) : '');
  return `${name} ¥${price}`;
}

/**
 * D-151③ — everything the merchant typed before the ledger existed is staged
 * server-side as *pending* candidates with `source.kind: 'import'`. This panel
 * is where they become facts, one explicit confirmation at a time.
 */
function StoreIntakeImportPanel({
  onConfirmed,
  product,
}: {
  onConfirmed: () => Promise<void>;
  product: ProductController;
}) {
  const store = product.state?.store;
  const workspaceId = product.state?.workspaceId ?? '';
  const [selected, setSelected] = useState<string[] | null>(null);

  const staged = useQuery({
    enabled: Boolean(workspaceId && store),
    queryKey: p1QueryKeys.request('asset-memory', 'store_profile_import', {
      revision: store?.revision ?? 0,
      workspaceId,
    }),
    queryFn: () =>
      commandP1<{ batch: AssetIntakeBatch | null }>(
        'asset-memory',
        { action: 'prepare_store_profile_import', payload: {} },
        `store-profile-import:${workspaceId}:${store?.revision ?? 0}`
      ),
  });

  const groups = useMemo(
    () => importCandidateGroups(staged.data?.batch ?? null),
    [staged.data?.batch]
  );
  const selection = selected ?? groups.map((group) => group.groupId);

  const confirm = useMutation({
    mutationFn: async () => {
      if (!staged.data?.batch || !store) return;
      const request = buildImportFinalizeCommand({
        batch: staged.data.batch,
        selectedGroupIds: selection,
        store,
      });
      if (!request) return;
      await commandP1(
        'asset-memory',
        request,
        `store-profile-import-finalize:${workspaceId}:${store.revision ?? 0}`
      );
      await onConfirmed();
      await staged.refetch();
    },
  });

  if (!store) return null;

  if (groups.length === 0) {
    return (
      <div
        className="mt-6 border-t border-border pt-4"
        data-testid="store-intake-import"
      >
        <p className="text-sm font-medium">{store_intake_import_title()}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {store_intake_import_empty()}
        </p>
      </div>
    );
  }

  return (
    <div
      className="mt-6 border-t border-border pt-4"
      data-testid="store-intake-import"
    >
      <p className="text-sm font-medium">{store_intake_import_title()}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {store_intake_import_hint()}
      </p>
      <ul className="mt-2 space-y-2">
        {groups.map((group) => (
          <li className="flex items-center gap-2 text-sm" key={group.groupId}>
            <Checkbox
              checked={selection.includes(group.groupId)}
              data-testid={`store-intake-import-${group.groupId}`}
              id={`store-intake-import-${group.groupId}`}
              onCheckedChange={() =>
                setSelected(
                  selection.includes(group.groupId)
                    ? selection.filter((id) => id !== group.groupId)
                    : [...selection, group.groupId]
                )
              }
            />
            <Label htmlFor={`store-intake-import-${group.groupId}`}>
              {group.kind === 'profile'
                ? `${FIELD_LABELS[group.label as ProgressiveFactId]()}：${group.value}`
                : importProjectLabel(group, store)}
            </Label>
            <Badge variant="outline">{store_intake_origin_import()}</Badge>
          </li>
        ))}
      </ul>
      {confirm.isError ? (
        <p
          className="mt-2 text-sm text-destructive"
          data-testid="store-intake-import-error"
          role="alert"
        >
          {store_intake_save_failed()}
        </p>
      ) : null}
      <Button
        className="mt-3"
        data-testid="store-intake-import-confirm"
        disabled={confirm.isPending || selection.length === 0}
        onClick={() => confirm.mutate()}
        size="sm"
        type="button"
      >
        {confirm.isPending
          ? store_intake_saving()
          : store_intake_import_confirm()}
      </Button>
    </div>
  );
}
