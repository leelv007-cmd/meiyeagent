/**
 * Composer home host (Z1 / #105 cutover).
 *
 * Primary creation entry mounted by dashboard/index.
 * Consumes WT-C modules only; submit success navigates to Result Center
 * via typed ResultCenterNavigation (never the legacy query-string work bridge).
 */

import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  creation_entry_intent_aria,
  creation_entry_intent_placeholder,
  creation_entry_submit,
  workbench_operation_failed,
  workbench_work_create_failed,
  workbench_work_created,
} from '@/locale/paraglide/messages';
import { operationsCommand } from '@/p1/client';
import type { CreationLensId } from '@meiye/contracts';
import { navigateAfterSubmitSuccess } from '@/product/results/result-center-navigation';

import { BriefSurface } from './brief-surface-panel';
import {
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  fixtureBriefProjection,
  openBriefSurface,
  projectBriefSurfaceView,
  setBriefVideoConfirmAccepted,
  type BriefSurfaceState,
} from './brief-surface';
import { ComposerToolsStrip } from './composer-tools-strip';
import {
  bindQuoteView,
  canSubmit,
  createComposerLensState,
  selectLens,
  submitComposer,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';
import { LensRadiogroup } from './lens-radiogroup';
import { isTwoColumnMobileViewport } from './mobile-layout';
import {
  buildComposerQuote,
  projectComposerQuoteView,
} from './quote-wiring';
import { listColdCardsFromSeeds } from './recipe-cards';
import { RecipeCardsPanel } from './recipe-cards-panel';

const LENS_TO_OPERATION: Record<
  CreationLensId,
  'copy.generate' | 'image.generate' | 'video.generate'
> = {
  copy: 'copy.generate',
  image_text: 'image.generate',
  video: 'video.generate',
};

function defaultQuoteForLens(lensId: CreationLensId) {
  const snapshot = buildComposerQuote({
    quoteId: `composer-local-${lensId}`,
    catalogModelId: `model.${lensId}.default`,
    quotePolicyRevision: 'qp.launch',
    billingMode: lensId === 'video' ? 'per_output_second' : 'per_request',
    unitRate: lensId === 'video' ? 1 : 2,
    quantity: 1,
    targetSeconds: lensId === 'video' ? 15 : undefined,
    minChargeSeconds: lensId === 'video' ? 2 : undefined,
  });
  return projectComposerQuoteView(snapshot);
}

export type ComposerHomeProps = {
  /** Optional viewport override for tests. */
  viewportWidth?: number;
  /** When true, skip live create and only freeze+navigate with fixture workId. */
  fixtureSubmit?: boolean;
};

export function ComposerHome({
  viewportWidth,
  fixtureSubmit = false,
}: ComposerHomeProps = {}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const intentRef = useRef<HTMLTextAreaElement | null>(null);
  const [lensState, setLensState] = useState<ComposerLensState>(() =>
    createComposerLensState()
  );
  const [showRequiredHint, setShowRequiredHint] = useState(false);
  const [briefState, setBriefState] = useState<BriefSurfaceState>(() =>
    createBriefSurfaceState()
  );

  const width =
    viewportWidth ??
    (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const singleColumn = !isTwoColumnMobileViewport({ width });
  const viewportKind = isMobile || singleColumn ? 'mobile' : 'desktop';

  const coldCards = useMemo(() => listColdCardsFromSeeds(), []);

  const lensId = lensState.phase === 'unselected' ? null : lensState.lensId;
  const userText = lensState.draft.userText;
  const quoteView = lensState.draft.quoteView;

  const createWork = useMutation({
    mutationFn: async (input: {
      lensId: CreationLensId;
      intent: string;
      videoConfirmAccepted?: boolean;
    }) => {
      if (fixtureSubmit) {
        return { id: `fixture-work-${input.lensId}` };
      }
      return operationsCommand<{ id: string }>(
        'create_creative_work',
        {
          intent: input.intent,
          mode: 'direct',
          operation: LENS_TO_OPERATION[input.lensId],
          contentModules: ['social_cover'],
          sourceReferences: [],
        },
        `composer-create-${crypto.randomUUID()}`
      );
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
    onError: () => {
      toast.error(workbench_work_create_failed());
    },
  });

  const runCreate = (
    selectedLens: CreationLensId,
    videoConfirmAccepted?: boolean
  ) => {
    const intent =
      lensState.draft.userText.trim() || coldCards[0]?.title || '创作';
    createWork.mutate({
      lensId: selectedLens,
      intent,
      videoConfirmAccepted,
    });
  };

  const handleLensChange = (next: CreationLensId) => {
    setShowRequiredHint(false);
    let nextState = selectLens(lensState, next);
    if (nextState.phase === 'selected') {
      nextState = bindQuoteView(nextState, defaultQuoteForLens(next));
    }
    setLensState(nextState);
  };

  const handleIntentChange = (value: string) => {
    setLensState(updateUserText(lensState, value));
  };

  const attemptSubmit = () => {
    const gate = canSubmit(lensState);
    if (!gate.allowed) {
      setShowRequiredHint(true);
      if (gate.focusTarget === 'lens_group') {
        document
          .querySelector<HTMLElement>('[data-testid="composer-lens-radiogroup"]')
          ?.focus();
      }
      return;
    }

    if (lensState.phase !== 'selected') return;

    // Video path always opens conditional Brief (D-094 / C6 extra confirm).
    const projection =
      lensState.lensId === 'video'
        ? fixtureBriefProjection({
            requiresBrief: true,
            triggerCodes: ['any_video'],
            lensId: lensState.lensId,
            summary: {
              targetDeliverable: '抖音项目成片',
              platforms: ['抖音'],
              sourceRightsSummary: '本店素材',
              keyFacts: [],
              modelAndSettings: quoteView?.catalogModelId ?? '默认模型',
              impactScope: '仅本次',
              estimatedCost: quoteView ? String(quoteView.amount) : null,
              estimatedDuration:
                quoteView?.quotedSeconds != null
                  ? `${quoteView.quotedSeconds} 秒`
                  : '约 15 秒',
              pendingItems: ['确认视频费用与时长'],
            },
          })
        : null;

    const path = decideSubmitPath({ projection });
    if (path.path === 'open_brief' && projection) {
      setBriefState(
        openBriefSurface(briefState, {
          projection,
          composerSnapshot: {
            userText: lensState.draft.userText,
            sources: [...lensState.draft.sources],
            lensId: lensState.lensId,
            draftRevisionId: lensState.draft.quoteRevisionId ?? 'draft-local',
          },
        })
      );
      return;
    }

    runCreate(lensState.lensId);
  };

  const handleBriefConfirm = () => {
    if (lensState.phase !== 'selected') return;
    const result = confirmBriefSurface(briefState);
    if (!result.ok) {
      setBriefState(result.state);
      return;
    }
    setBriefState(result.state);
    runCreate(lensState.lensId, briefState.videoConfirmAccepted);
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
      <Card className="meiye-composer border-0 shadow-none">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <LensRadiogroup
            value={lensId}
            onChange={handleLensChange}
            showRequiredHint={showRequiredHint}
            disabled={createWork.isPending || lensState.phase === 'frozen'}
          />

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
                attemptSubmit();
              }
            }}
            placeholder={creation_entry_intent_placeholder()}
            ref={intentRef}
            rows={4}
            value={userText}
          />

          {quoteView ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="composer-quote-line"
            >
              {quoteView.billingNote ?? `预计消耗 ${quoteView.amount}`}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="composer-submit"
              disabled={createWork.isPending || lensState.phase === 'frozen'}
              onClick={attemptSubmit}
              type="button"
            >
              {creation_entry_submit()}
            </Button>
            {createWork.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {workbench_operation_failed()}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <RecipeCardsPanel
        lensId={lensId}
        lensState={lensState}
        onLensStateChange={setLensState}
        singleColumn={singleColumn}
        useBottomSheet={viewportKind === 'mobile'}
      />

      <ComposerToolsStrip
        lensId={lensId}
        viewport={viewportKind}
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
          onCancel={() =>
            setBriefState(cancelBriefSurface(briefState).state)
          }
          onAcceptVideoConfirm={(accepted) =>
            setBriefState(setBriefVideoConfirmAccepted(briefState, accepted))
          }
          disabled={createWork.isPending}
        />
      ) : null}
    </div>
  );
}
