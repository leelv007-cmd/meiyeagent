import type {
  ContentPackage,
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
} from '@meiye/contracts';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { AiMarkdown } from '@/components/markdown/ai-markdown';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  copy_candidate_accept,
  copy_candidate_accept_limit,
  copy_candidate_accepted_badge,
  copy_candidate_accepting,
  copy_candidate_alternative_badge,
  copy_candidate_conversion_hook_label,
  copy_candidate_conversion_hook_missing,
  copy_candidate_collapse_alternatives,
  copy_candidate_group_aria,
  copy_candidate_incomplete_description,
  copy_candidate_option_aria,
  copy_candidate_paid_confirm_action,
  copy_candidate_paid_confirm_cancel,
  copy_candidate_paid_confirm_description,
  copy_candidate_paid_confirm_title,
  copy_candidate_paid_reroll,
  copy_candidate_primary_badge,
  copy_candidate_quality_retries_used,
  copy_candidate_quality_retry,
  copy_candidate_quality_retrying,
  copy_candidate_recommendation_compliance,
  copy_candidate_recommendation_customer_action,
  copy_candidate_recommendation_deliverables,
  copy_candidate_recommendation_expression,
  copy_candidate_recommendation_facts,
  copy_candidate_recommendation_platforms,
  copy_candidate_recommendation_why,
  copy_candidate_recommended_group_aria,
  copy_candidate_recommended_title,
  copy_candidate_rerolling,
  copy_candidate_selector_aria,
  copy_candidate_status_accepted,
  copy_candidate_status_incomplete,
  copy_candidate_status_recommended,
  copy_candidate_status_ready,
  copy_candidate_toggle_alternatives,
  copy_candidate_title,
  copy_candidate_view_in_content,
  copy_candidate_visual_asset_move_down,
  copy_candidate_visual_asset_move_up,
  copy_candidate_visual_asset_toggle,
  copy_candidate_visual_assets,
  copy_candidate_visual_assets_description,
} from '@/locale/paraglide/messages';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import { operationsCommand } from '@/p1/client';

import {
  buildCopyCandidateSelectorModel,
  copyCandidateActionErrorMessage,
  createCopyCandidateCommand,
  type CopyCandidateCommandInput,
  moveOrderedVisualAsset,
  toggleOrderedVisualAsset,
} from './copy-candidate-selector-model';

export interface CopyCandidateSelectorProps {
  assets: CreativeAssetProjection[];
  compact?: boolean;
  contents: CreativeContent[];
  job: CreativeJob;
  onChanged: () => Promise<void> | void;
  packages?: ContentPackage[];
  productVisualAssets?: Array<{ id: string; title: string }>;
}

type PendingAction = CopyCandidateCommandInput['action'];

export function CopyCandidateSelector({
  assets,
  compact = false,
  contents,
  job,
  onChanged,
  packages = [],
  productVisualAssets = [],
}: CopyCandidateSelectorProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [error, setError] = useState<string>();
  const [confirmingPaidReroll, setConfirmingPaidReroll] = useState(false);
  const [alternativesExpanded, setAlternativesExpanded] = useState(false);
  const availableVisualAssets = [
    ...productVisualAssets,
    ...assets
      .filter((asset) => asset.kind === 'image' && Boolean(asset.ownedAssetId))
      .map((asset) => ({ id: asset.id, title: asset.title })),
  ].filter(
    (asset, index, all) =>
      all.findIndex((candidate) => candidate.id === asset.id) === index
  );
  const deliveredVisualAssetKey = availableVisualAssets
    .map((asset) => asset.id)
    .join(':');
  const [orderedVisualAssetIds, setOrderedVisualAssetIds] = useState<string[]>(
    []
  );
  const inFlight = useRef(false);
  const model = buildCopyCandidateSelectorModel({
    assets,
    contents,
    decisionTrace: job.decisionTrace,
    job,
    packages,
    recommendedAssetId: job.recommendedAssetId,
    selectedAssetId,
  });
  const visibleCandidates =
    model.presentation === 'recommended'
      ? [
          ...(model.primaryCandidate ? [model.primaryCandidate] : []),
          ...(alternativesExpanded
            ? model.alternativeCandidates
            : model.alternativeCandidates.filter(
                ({ asset }) => asset.id === model.acceptedAssetId
              )),
        ]
      : model.candidates;

  useEffect(() => {
    setSelectedAssetId(undefined);
    setOrderedVisualAssetIds(availableVisualAssets.map((asset) => asset.id));
    setError(undefined);
    setConfirmingPaidReroll(false);
    setAlternativesExpanded(false);
  }, [job.id, job.recommendedAssetId, deliveredVisualAssetKey]);

  async function executeAction(action: PendingAction) {
    if (inFlight.current) return;
    if (
      action === 'accept' &&
      (!model.selectedAssetId || orderedVisualAssetIds.length === 0)
    ) {
      return;
    }
    if (action === 'paid-reroll' && !model.canPaidReroll) return;
    if (action === 'quality-retry' && !model.canQualityRetry) return;

    inFlight.current = true;
    setPendingAction(action);
    setError(undefined);
    try {
      const clickToken = crypto.randomUUID();
      const command = createCopyCandidateCommand(
        action === 'accept'
          ? {
              action,
              assetId: model.selectedAssetId!,
              clickToken,
              jobId: job.id,
              visualAssetIds: orderedVisualAssetIds,
              workId: job.workId,
            }
          : { action, clickToken, jobId: job.id }
      );
      await operationsCommand(
        command.action,
        command.payload,
        command.idempotencyKey
      );
      await onChanged();
    } catch {
      setError(copyCandidateActionErrorMessage(action));
    } finally {
      inFlight.current = false;
      setPendingAction(undefined);
    }
  }

  const locked = Boolean(pendingAction) || model.status === 'accepted';

  return (
    <section
      aria-busy={Boolean(pendingAction)}
      aria-label={copy_candidate_selector_aria()}
      className="space-y-4"
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">
              {model.presentation === 'recommended'
                ? copy_candidate_recommended_title()
                : copy_candidate_title()}
            </h3>
            <Badge variant="outline">{model.batchLabel}</Badge>
            <Badge variant="outline">
              {copy_candidate_quality_retries_used({
                maximum: 2,
                used: model.usedQualityRetries,
              })}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {model.currentUsageLabel}
          </p>
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {model.status === 'accepted'
            ? copy_candidate_status_accepted()
            : model.status === 'ready'
              ? model.presentation === 'recommended'
                ? copy_candidate_status_recommended()
                : copy_candidate_status_ready()
              : copy_candidate_status_incomplete()}
        </p>
      </div>

      {model.status === 'invalid' ? (
        <output className="block rounded-lg border border-dashed bg-muted/30 p-4 text-sm">
          {copy_candidate_incomplete_description()}
        </output>
      ) : (
        <RadioGroup
          aria-label={
            model.presentation === 'recommended'
              ? copy_candidate_recommended_group_aria()
              : copy_candidate_group_aria()
          }
          className="grid items-stretch gap-4"
          disabled={locked}
          onValueChange={(value) => {
            if (!locked) setSelectedAssetId(value);
          }}
          value={model.selectedAssetId ?? ''}
        >
          {visibleCandidates.map((candidate) => {
            const bodyId = `copy-candidate-body-${candidate.asset.id}`;
            const inputId = `copy-candidate-${candidate.asset.id}`;
            return (
              <Card
                className={cn(
                  'relative h-full gap-0 rounded-lg border border-border py-0 ring-0 transition-[background-color,outline-color] has-data-[checked]:outline-2 has-data-[checked]:-outline-offset-2 has-data-[checked]:outline-primary has-focus-visible:outline-3 has-focus-visible:-outline-offset-1 has-focus-visible:outline-primary',
                  candidate.accepted && 'bg-primary/5'
                )}
                data-candidate-label={candidate.label}
                key={candidate.asset.id}
                size="sm"
              >
                <RadioGroupItem
                  aria-describedby={bodyId}
                  aria-label={copy_candidate_option_aria({
                    label: candidate.label,
                    title: candidate.asset.title,
                  })}
                  className="absolute inset-0 z-10 size-auto aspect-auto rounded-lg border-0 opacity-0 after:hidden focus-visible:ring-0 disabled:cursor-default disabled:opacity-0"
                  disabled={locked}
                  id={inputId}
                  onKeyDown={(event) => {
                    if (event.key !== ' ' || locked) return;
                    event.preventDefault();
                    setSelectedAssetId(candidate.asset.id);
                  }}
                  value={candidate.asset.id}
                />
                <CardHeader className="px-4 py-4 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge>
                        {candidate.recommended
                          ? copy_candidate_primary_badge()
                          : model.presentation === 'recommended'
                            ? copy_candidate_alternative_badge({
                                label: candidate.label,
                              })
                            : candidate.label}
                      </Badge>
                      <span className="font-semibold">
                        {candidate.asset.title}
                      </span>
                      {candidate.accepted ? (
                        <Badge variant="outline">
                          <IconCheck aria-hidden="true" />
                          {copy_candidate_accepted_badge()}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {copy_candidate_conversion_hook_label()}
                      {candidate.asset.conversionHook ??
                        copy_candidate_conversion_hook_missing()}
                    </span>
                  </span>
                </CardHeader>
                <CardContent
                  className="border-t border-border/60 px-4 py-4 sm:px-6"
                  id={bodyId}
                >
                  <AiMarkdown
                    className="prose prose-sm max-w-none text-foreground dark:prose-invert"
                    content={candidate.asset.body ?? ''}
                  />
                  {candidate.recommended && model.decisionTrace ? (
                    <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
                      {[
                        [
                          copy_candidate_recommendation_why(),
                          [model.decisionTrace.whyPost],
                        ],
                        [
                          copy_candidate_recommendation_expression(),
                          [model.decisionTrace.expressionIdentity],
                        ],
                        [
                          copy_candidate_recommendation_facts(),
                          model.decisionTrace.factReferences,
                        ],
                        [
                          copy_candidate_recommendation_platforms(),
                          model.decisionTrace.platforms,
                        ],
                        [
                          copy_candidate_recommendation_customer_action(),
                          [model.decisionTrace.customerAction],
                        ],
                        [
                          copy_candidate_recommendation_compliance(),
                          [model.decisionTrace.complianceStatus],
                        ],
                        [
                          copy_candidate_recommendation_deliverables(),
                          model.decisionTrace.deliverables,
                        ],
                      ].map(([label, values]) => (
                        <div className="space-y-1" key={String(label)}>
                          <dt className="text-xs text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="flex flex-wrap gap-1.5">
                            {(values as string[]).map((value, index) => (
                              <Badge
                                className="h-auto max-w-full whitespace-normal break-words"
                                key={`${String(label)}-${index}`}
                                variant="outline"
                              >
                                {value}
                              </Badge>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </RadioGroup>
      )}

      {model.presentation === 'recommended' &&
      model.status !== 'invalid' &&
      model.alternativeCandidates.length > 0 ? (
        <Button
          aria-expanded={alternativesExpanded}
          onClick={() => {
            if (alternativesExpanded) setSelectedAssetId(undefined);
            setAlternativesExpanded((current) => !current);
          }}
          type="button"
          variant="ghost"
        >
          <IconArrowDown
            aria-hidden="true"
            className={cn(
              'transition-transform',
              alternativesExpanded && 'rotate-180'
            )}
          />
          {alternativesExpanded
            ? copy_candidate_collapse_alternatives()
            : copy_candidate_toggle_alternatives({
                count: model.alternativeCandidates.length,
              })}
        </Button>
      ) : null}

      {model.status === 'ready' && availableVisualAssets.length > 0 ? (
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h4 className="font-medium">{copy_candidate_visual_assets()}</h4>
            <p className="text-xs text-muted-foreground">
              {copy_candidate_visual_assets_description()}
            </p>
          </div>
          <ol className="space-y-2">
            {[
              ...orderedVisualAssetIds
                .map((assetId) =>
                  availableVisualAssets.find((asset) => asset.id === assetId)
                )
                .filter((asset) => Boolean(asset)),
              ...availableVisualAssets.filter(
                (asset) => !orderedVisualAssetIds.includes(asset.id)
              ),
            ].map((asset) => {
              if (!asset) return null;
              const selected = orderedVisualAssetIds.includes(asset.id);
              const selectedIndex = orderedVisualAssetIds.indexOf(asset.id);
              return (
                <li
                  className="flex items-center gap-3 rounded-md bg-muted/30 p-2"
                  key={asset.id}
                >
                  <input
                    aria-label={copy_candidate_visual_asset_toggle({
                      title: asset.title,
                    })}
                    checked={selected}
                    className="size-4"
                    disabled={
                      Boolean(pendingAction) ||
                      (selected && orderedVisualAssetIds.length === 1)
                    }
                    onChange={() =>
                      setOrderedVisualAssetIds((current) =>
                        toggleOrderedVisualAsset(current, asset.id)
                      )
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {asset.title}
                  </span>
                  {selected ? (
                    <span className="flex gap-1">
                      <Button
                        aria-label={copy_candidate_visual_asset_move_up({
                          title: asset.title,
                        })}
                        disabled={selectedIndex === 0 || Boolean(pendingAction)}
                        onClick={() =>
                          setOrderedVisualAssetIds((current) =>
                            moveOrderedVisualAsset(current, asset.id, -1)
                          )
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <IconArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={copy_candidate_visual_asset_move_down({
                          title: asset.title,
                        })}
                        disabled={
                          selectedIndex === orderedVisualAssetIds.length - 1 ||
                          Boolean(pendingAction)
                        }
                        onClick={() =>
                          setOrderedVisualAssetIds((current) =>
                            moveOrderedVisualAsset(current, asset.id, 1)
                          )
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <IconArrowDown aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {error ? (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {model.acceptedPackageId ? (
        <a
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          href={getPathWithLocale(
            `/dashboard/content/${encodeURIComponent(model.acceptedPackageId)}?from=workbench`
          )}
        >
          {copy_candidate_view_in_content()}
        </a>
      ) : null}

      <div className="grid gap-3 border-t pt-4 md:grid-cols-3">
        <div
          className={cn(
            'space-y-1',
            compact &&
              'order-last sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 -mx-1 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:static md:order-none md:mx-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none'
          )}
          data-mobile-sticky-actions={compact ? 'true' : undefined}
        >
          <Button
            className="w-full"
            disabled={
              !model.canAccept ||
              orderedVisualAssetIds.length === 0 ||
              Boolean(pendingAction)
            }
            onClick={() => void executeAction('accept')}
            type="button"
          >
            {pendingAction === 'accept'
              ? copy_candidate_accepting()
              : copy_candidate_accept()}
          </Button>
          <p className="text-xs text-muted-foreground">
            {copy_candidate_accept_limit()}
          </p>
        </div>

        <div className="space-y-1">
          <Button
            className="w-full"
            data-requires-confirmation="true"
            disabled={!model.canPaidReroll || Boolean(pendingAction)}
            onClick={() => setConfirmingPaidReroll(true)}
            type="button"
            variant="outline"
          >
            <IconRefresh aria-hidden="true" />
            {pendingAction === 'paid-reroll'
              ? copy_candidate_rerolling()
              : copy_candidate_paid_reroll()}
          </Button>
          <p className="text-xs text-muted-foreground">
            {model.paidUsageLabel}
          </p>
        </div>

        <div className="space-y-1">
          <Button
            className="w-full"
            disabled={!model.canQualityRetry || Boolean(pendingAction)}
            onClick={() => void executeAction('quality-retry')}
            type="button"
            variant="secondary"
          >
            <IconSparkles aria-hidden="true" />
            {pendingAction === 'quality-retry'
              ? copy_candidate_quality_retrying()
              : copy_candidate_quality_retry()}
          </Button>
          <p className="text-xs text-muted-foreground">
            {model.qualityUsageLabel}
          </p>
        </div>
      </div>

      <AlertDialog
        onOpenChange={setConfirmingPaidReroll}
        open={confirmingPaidReroll}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {copy_candidate_paid_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {copy_candidate_paid_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {copy_candidate_paid_confirm_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(pendingAction)}
              onClick={() => {
                setConfirmingPaidReroll(false);
                void executeAction('paid-reroll');
              }}
            >
              {copy_candidate_paid_confirm_action()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
