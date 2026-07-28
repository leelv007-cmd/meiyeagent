/**
 * W02 五步录入向导 — the merchant-facing surface of the parse-service five-step
 * contract, and the second entry into the D-151① write channel.
 *
 * Two things this screen refuses to do: present a machine reading as the
 * merchant's own answer (every prefill keeps a provenance badge and stays
 * "waiting on you" until it is confirmed), and open a second way into the fact
 * ledger (everything leaves through `finalize_store_intake`).
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  account_usage_retry,
  progressive_fact_address_label,
  progressive_fact_booking_label,
  progressive_fact_brand_voice_label,
  progressive_fact_city_label,
  progressive_fact_district_label,
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
  store_intake_confirm_all,
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
  store_intake_industry_hair_care,
  store_intake_industry_hair_growth,
  store_intake_industry_label,
  store_intake_industry_skin_management,
  store_intake_next,
  store_intake_origin_ai,
  store_intake_origin_import,
  store_intake_origin_manual,
  store_intake_origin_parsed,
  store_intake_photo_choose,
  store_intake_photo_failed,
  store_intake_photo_label,
  store_intake_photo_ready,
  store_intake_photo_unsupported,
  store_intake_photo_uploading,
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
  store_intake_step_optional,
  store_intake_step_required,
  store_intake_step_say_or_upload,
  store_intake_step_see_examples,
  store_intake_target_label,
  store_intake_target_price_list,
  store_intake_target_visual_asset,
  store_intake_title,
  store_intake_unconfirmed,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import {
  uploadWorkspaceIntakeAsset,
  WorkspaceAssetUploadError,
  type WorkspaceAssetUpload,
} from '@/p1/workspace-asset-upload';
import {
  answerProgressiveFact,
  buildFinalizeStoreIntakeCommand,
  createProgressiveFactDraft,
  progressiveFactRevisionMap,
  projectProgressiveFactView,
  type ProgressiveFactId,
  type ProgressiveFactProvenance,
} from '@/product/composer/progressive-fact';
import { PriceValidityAnswer } from '@/product/composer/price-validity-answer';
import type { useProductState } from '@/product/client';
import type {
  AssetDraftView,
  AssetIntakeBatch,
  AssetIntakeExperience,
  StoreFact,
  StoreProfile,
  VisualAssetSlot,
} from '@meiye/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconCheck, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';

import {
  applyArrangedDraft,
  arrangementRecognizedFields,
  buildImportFinalizeCommand,
  canArrange,
  createStoreIntakeWizardState,
  currentStep,
  editSentence,
  goToStep,
  importCandidateGroups,
  orderedIntakeFields,
  parseSingleAssetRequest,
  prepareManualDraftRequest,
  recommendedFactIds,
  rotateExample,
  selectedExample,
  toggleRecommendation,
  type ImportCandidateGroup,
  type StoreIntakeStepId,
  type StoreIntakeTarget,
} from './store-intake-wizard-model';

type ProductController = Pick<
  ReturnType<typeof useProductState>,
  'refresh' | 'state'
>;

const INDUSTRIES = [
  ['hair_care', store_intake_industry_hair_care],
  ['skin_management', store_intake_industry_skin_management],
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
  user: store_intake_origin_manual,
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
  const store = product.state?.store;
  const [industry, setIndustry] = useState<string>('hair_care');
  const complianceDefaults = useComplianceDefaults();
  // Wizard state is declared before the queries because guidance is fetched per
  // industry *and* per asset type: the samples and the recommended fields have
  // to follow whichever lane the merchant picks in step 3.
  const [state, setState] = useState(() =>
    createStoreIntakeWizardState(createProgressiveFactDraft(store, []))
  );
  const target = state.target;

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
      const request = buildFinalizeStoreIntakeCommand(state.draft, {
        batchId: `intake-batch:${id}`,
        capturedAt: new Date().toISOString(),
        expectedRevision: store?.revision ?? 0,
        factRevisions: progressiveFactRevisionMap(factHeads),
        referenceId: `store-intake-wizard:${id}`,
        regulatedDefault:
          complianceDefaults.data?.['compliance.regulated_mode.default'],
        taskId: `intake-task:${id}`,
        workspaceId,
      });
      if (!request) return;
      await commandP1('asset-memory', request, `intake-finalize:${id}`);
      await Promise.all([product.refresh(), storeFacts.refetch()]);
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
  const step = experience.data
    ? currentStep(experience.data, state)
    : undefined;
  const example = experience.data
    ? selectedExample(experience.data, state)
    : undefined;
  const recognized = arrangementRecognizedFields(state);
  // "勾上的我会重点问" is a promise the confirm step has to keep: the ticked
  // fields lead, and the sentence box carries the same skeleton.
  const recommended = experience.data
    ? recommendedFactIds(experience.data, state)
    : [];
  const fieldOrder = orderedIntakeFields(recommended);
  const { readyToConfirm } = projectProgressiveFactView(state.draft);
  // The first patch has to carry the platform's `regulated` call, so Day-0
  // confirmation waits for the admin default rather than guessing it.
  const awaitingRegulatedDefault =
    (store?.revision ?? 0) === 0 &&
    complianceDefaults.data?.['compliance.regulated_mode.default'] ===
      undefined;

  async function upload(file: File) {
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
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          data-testid="store-intake-industry"
          id="store-intake-industry"
          onChange={(event) => setIndustry(event.target.value)}
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
          <ol
            className="mt-4 flex flex-wrap gap-2 text-xs"
            data-testid="store-intake-steps"
          >
            {steps.map((item, index) => (
              <li
                aria-current={item.id === step.id ? 'step' : undefined}
                className={
                  item.id === step.id
                    ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground'
                    : 'rounded-full bg-muted px-3 py-1 text-muted-foreground'
                }
                data-step={item.id}
                key={item.id}
              >
                {index + 1}. {STEP_LABELS[item.id]()} ·{' '}
                {item.optional
                  ? store_intake_step_optional()
                  : store_intake_step_required()}
              </li>
            ))}
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
                {/* W02 ④: the target decides which contract lane reads the
                    photo — a price list becomes fact candidates, a visual asset
                    is classified into the four `VISUAL_ASSET_SLOTS`. */}
                <div>
                  <Label htmlFor="store-intake-target">
                    {store_intake_target_label()}
                  </Label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
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
                    disabled={uploading}
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
                {!canArrange(state) ? (
                  <p className="text-sm text-muted-foreground">
                    {store_intake_arrange_empty()}
                  </p>
                ) : null}
                {state.upload ? (
                  <Button
                    data-testid="store-intake-arrange-run"
                    disabled={arrange.isPending}
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
                    const pending = state.draft.unconfirmed.includes(id);
                    const confirmed = state.draft.answered.includes(id);
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
                          {pending ? (
                            <Badge
                              data-testid={`store-intake-unconfirmed-${id}`}
                              variant="secondary"
                            >
                              {store_intake_unconfirmed()}
                            </Badge>
                          ) : null}
                          {confirmed ? (
                            <IconCheck
                              aria-hidden
                              className="size-4 text-primary"
                              data-testid={`store-intake-confirmed-${id}`}
                            />
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
                        <div className="flex gap-2">
                          {id === 'projectPriceValidity' ? (
                            <div className="flex-1">
                              <PriceValidityAnswer
                                onChange={(value) =>
                                  setState((current) => ({
                                    ...current,
                                    draft: {
                                      ...current.draft,
                                      projectPriceValidity: value,
                                    },
                                  }))
                                }
                                testId="store-intake-field-projectPriceValidity"
                                value={state.draft.projectPriceValidity}
                              />
                            </div>
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
                                  draft: {
                                    ...current.draft,
                                    [id]: event.target.value,
                                  },
                                }))
                              }
                              value={state.draft[id]}
                            />
                          )}
                          <Button
                            data-testid={`store-intake-confirm-${id}`}
                            disabled={state.draft[id].trim().length === 0}
                            onClick={() =>
                              setState((current) => ({
                                ...current,
                                draft: answerProgressiveFact(
                                  current.draft,
                                  id,
                                  current.draft[id]
                                ),
                              }))
                            }
                            size="sm"
                            type="button"
                            variant={confirmed ? 'outline' : 'default'}
                          >
                            <IconCheck />
                          </Button>
                        </div>
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
                    state.draft.answered.length === 0 ||
                    // A save the finalize builder would refuse to assemble is a
                    // dead click; show it as blocked instead of swallowing it.
                    !readyToConfirm
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

          <div className="mt-4 flex gap-2">
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
              onClick={() =>
                setState((current) => goToStep(experience.data!, current, 1))
              }
              size="sm"
              type="button"
            >
              {store_intake_next()}
            </Button>
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
