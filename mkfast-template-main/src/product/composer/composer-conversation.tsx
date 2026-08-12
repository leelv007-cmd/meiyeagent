/**
 * D-114 定制创作主容器 — agent 流式对话 + AGUI 三层结构 (ADR-0014, T30 / #224).
 *
 * Layer ①: this transcript — 意图 → 阶段宣告 → 引导补问卡 → 流式候选 → 成品预览卡.
 * Layer ②: the 成品预览卡 is the doorway into the Result Center (对象工作区纵深);
 *          submitting does not navigate (ADR-0014「提交后不跳转」).
 * Layer ③: long tasks stay reachable through the same card after a refresh —
 *          the session handle is persisted, the transcript is replayed.
 *
 * Structured input lives in the flow as chips and one-tap cards, never as a
 * slot form (D-031). Components come from the HeroUI Pro V3 supply layer with
 * the 门店橱窗 token bridge applied (D-130); DESIGN.md stays the visual
 * authority.
 */

import type {
  ContentPackageRevisionDelivery,
  CreationLensId,
} from '@meiye/contracts';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import {
  ChatConversation,
  ChatLoader,
  PromptInput,
  PromptSuggestion,
  Segment,
} from '@/components/heroui-pro';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  agent_frame_stage_decision,
  agent_frame_stage_memory,
  agent_frame_stage_narrative,
  agent_frame_stage_plan,
  agent_frame_stage_result,
  agent_frame_stage_task,
  composer_conversation_scroll_to_latest,
  composer_generation_running,
  composer_reuse_suggestion_group,
  model_card_channel_multi,
  model_card_channel_single,
} from '@/locale/paraglide/messages';
import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { GenerationAccent } from '@/components/uiux/generation-accent';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';
import type { ResultTokenStreamProjection } from '@/product/results/result-token-stream';

import {
  ComposerDeliveryCard,
  type DeliveryRatingTransition,
  type ComposerDeliveryOpenInput,
} from './composer-delivery-card';
import type { AiCoverActionSeed } from './ai-cover-action';
import type { DeliveryFollowUpSeed } from './delivery-followup-seeds';
import { ComposerProgressCard } from './composer-progress-card';
import {
  WORKBENCH_STICKY_COMPOSER_INTERRUPT_CLASS,
  WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS,
} from './workbench-shell';
import { isWorkbenchEngaged } from './workbench-state';
import {
  ComposerReportCard,
  type ComposerRecoveryInput,
} from './composer-report-card';
import {
  resolveAgentFrameKind,
  type AgentFrameKind,
  type ComposerTimelineTurnKind,
} from './agent-frame-registry';
import type {
  ComposerCandidateTurn,
  ComposerSession,
  ComposerStageTurn,
  ComposerTurn,
} from './composer-session';
import type { ComposerSignedPreview } from './composer-signed-preview';
import { NotePlanTimelineFrame } from './note-plan-timeline-frame';
import type {
  ExperienceBasisProjection,
  ExperienceCorrectionProjection,
  ExperienceSedimentProjection,
} from './task-experience';
import {
  shouldShowExperienceBasis,
  shouldShowExperienceCorrection,
  shouldShowExperienceSediment,
} from './task-experience';
import {
  ExperienceBasisSurface,
  ExperienceCorrectionSurface,
  ExperienceSedimentSurface,
} from './task-experience-surfaces';

export type ComposerCreationMode = 'customized' | 'free';

export const COMPOSER_INTENT_INPUT_TESTID = 'composer-intent-input';

/** Locale stage labels for the six AgentFrame families (document timeline). */
export function agentFrameStageLabel(frameKind: AgentFrameKind): string {
  switch (frameKind) {
    case 'narrative':
      return agent_frame_stage_narrative();
    case 'decision':
      return agent_frame_stage_decision();
    case 'plan':
      return agent_frame_stage_plan();
    case 'result':
      return agent_frame_stage_result();
    case 'task':
      return agent_frame_stage_task();
    case 'memory':
      return agent_frame_stage_memory();
  }
}

/**
 * Idle creation-mode segmenter (C5 / R-1).
 * Lives outside the Composer card — greeting → segmenter → Composer.
 */
export function ComposerCreationModeSegment({
  creationMode,
  onCreationModeChange,
  className,
}: {
  creationMode: ComposerCreationMode;
  onCreationModeChange: (mode: ComposerCreationMode) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(className)}
      data-testid="composer-creation-mode-host"
      style={
        {
          '--meiye-segment-unselected': 'var(--ink-90)',
        } as CSSProperties
      }
    >
      <Segment
        aria-label="创作入口"
        data-testid="composer-creation-mode"
        onSelectionChange={(key) =>
          onCreationModeChange(key === 'free' ? 'free' : 'customized')
        }
        selectedKey={creationMode}
        size="sm"
      >
        <Segment.Item
          data-testid="composer-creation-mode-customized"
          id="customized"
        >
          定制创作
        </Segment.Item>
        <Segment.Item data-testid="composer-creation-mode-free" id="free">
          自由创作
        </Segment.Item>
      </Segment>
    </div>
  );
}

/** Focus the intent box. See the TextArea render site for why this is not a ref. */
export function focusComposerIntentInput() {
  if (typeof document === 'undefined') return;
  document
    .querySelector<HTMLTextAreaElement>(
      `[data-testid="${COMPOSER_INTENT_INPUT_TESTID}"]`
    )
    ?.focus();
}

/** 「发到哪」— one merchant question, mapped to the双字段 server-side (M-01). */
export type ComposerDestinationOption = {
  id: string;
  label: string;
};

export const COMPOSER_DESTINATION_OPTIONS: ComposerDestinationOption[] = [
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'douyin', label: '抖音' },
  { id: 'video_account', label: '视频号' },
  { id: 'wechat_moments', label: '朋友圈' },
  { id: 'offline_material', label: '线下物料' },
  { id: 'generic', label: '通用素材' },
];

/**
 * 旧内容换平台 as one sentence plus chips. The retired three-step panel
 * (source / form / carrier) forced a selection before anything could start —
 * the D-031 违规 this container replaces.
 */
export type ComposerReuseChip = {
  id: string;
  label: string;
  /** Sentence dropped into the merchant's own draft when tapped. */
  intent: string;
};

/**
 * Consecutive 白话进度 announcements read as one 进度宣告卡, not as a run of
 * loose lines: D-116 makes the stage rail a delivery statement the merchant is
 * meant to read, and a card is what carries that. Runs of stage turns are
 * folded at render time so the session model stays an ordered turn list.
 */
function foldTurns(turns: ComposerTurn[]) {
  const folded: (
    | ComposerTurn
    | { kind: 'stages'; stages: ComposerStageTurn[] }
  )[] = [];
  for (const turn of turns) {
    if (turn.kind !== 'stage') {
      folded.push(turn);
      continue;
    }
    const last = folded.at(-1);
    if (last && last.kind === 'stages') last.stages.push(turn);
    else folded.push({ kind: 'stages', stages: [turn] });
  }
  return folded;
}

/**
 * Document-timeline frame host (#313 / D1 + L3-3 visual contract).
 *
 * Every turn renders through the AgentFrame registry. Agent content is full
 * width; merchant input may keep a light right-aligned chip (not a chat bubble
 * stream). data-agent-frame is the consumer hook for frame-family CSS + tests.
 * The left rail / node / stage label form the document timeline (spec §2 D1).
 */
function AgentFrameHost({
  turnKind,
  frameKind,
  children,
  className,
  testId,
  stageLabel,
}: {
  turnKind: ComposerTimelineTurnKind;
  frameKind: AgentFrameKind;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  /** Locale stage label shown above the card body (document timeline). */
  stageLabel?: string;
}) {
  return (
    <div
      className={cn(
        'meiye-agent-frame relative w-full min-w-0',
        `meiye-agent-frame--${frameKind}`,
        className
      )}
      data-agent-frame={frameKind}
      data-testid={testId ?? `agent-frame-${frameKind}`}
      data-turn-kind={turnKind}
    >
      <span
        aria-hidden="true"
        className="meiye-agent-frame__node"
        data-testid="meiye-agent-frame-node"
      />
      {stageLabel ? (
        <span
          className="meiye-agent-frame__stage-label"
          data-testid={`agent-frame-stage-${frameKind}`}
        >
          {stageLabel}
        </span>
      ) : null}
      <div className="meiye-agent-frame__body">{children}</div>
    </div>
  );
}

/**
 * D-111 分流告知. Identified by the `intent_naming` success frame, so the
 * wording stays T11's to own. Never silently downgrades: the merchant is told
 * which mode this run used.
 *
 * P1-01: full-width narrative frame (document timeline), not an assistant bubble.
 */
function RouteNotice({ message }: { message: string }) {
  const frameKind = resolveAgentFrameKind('route_notice');
  return (
    <AgentFrameHost
      frameKind={frameKind}
      stageLabel={agentFrameStageLabel(frameKind)}
      testId="composer-route-notice"
      turnKind="route_notice"
    >
      <p className="meiye-porcelain rounded-2xl px-4 py-3 text-sm">{message}</p>
    </AgentFrameHost>
  );
}

/**
 * P0-3 / D7 / F8: once THIS candidate's run has delivered, collapse its full
 * body into a one-line capsule so the delivery card is the summary face — not
 * a second full-text copy. Matching by taskId keeps a newer run's live stream
 * full even while an earlier run's delivery card is still on the transcript.
 */
function candidateShouldCollapse(
  session: ComposerSession,
  candidate: ComposerCandidateTurn
): boolean {
  return session.turns.some(
    (turn) => turn.kind === 'delivery' && turn.taskId === candidate.taskId
  );
}

/** Shared layout id for candidate → delivery morph (P2-13 / D7). */
function resultMorphLayoutId(taskId: string): string {
  return `composer-result-morph-${taskId}`;
}

function CandidateSummaryCapsule({
  stream,
}: {
  /** Null when the capsule belongs to an earlier run than the live stream. */
  stream: ResultTokenStreamProjection | null;
}) {
  const primary = stream?.primary;
  const title = primary?.title?.trim() || '已生成候选';
  const body = primary?.body?.trim() ?? '';
  const snippet =
    body.length > 40 ? `${body.slice(0, 40)}…` : body.length > 0 ? body : null;

  return (
    <section
      aria-live="polite"
      className="meiye-porcelain inline-flex max-w-full flex-wrap items-center gap-2 rounded-full px-3 py-1.5"
      data-collapsed="true"
      data-has-token={stream?.hasFirstToken ? 'true' : 'false'}
      data-testid="composer-candidate-summary"
    >
      <span
        className="text-foreground text-xs font-medium"
        data-testid="composer-candidate-summary-title"
      >
        {title}
      </span>
      {snippet ? (
        <span
          className="text-muted max-w-[16rem] truncate text-xs"
          data-testid="composer-candidate-summary-snippet"
        >
          {snippet}
        </span>
      ) : null}
    </section>
  );
}

function CandidateStream({ stream }: { stream: ResultTokenStreamProjection }) {
  const primary = stream.primary;
  // D-113 / story 15: one primary candidate by default. Alternatives are an
  // opt-in disclosure, never a parallel grid of choices.
  return (
    <section
      aria-live="polite"
      className="meiye-porcelain rounded-2xl p-4"
      data-has-token={stream.hasFirstToken ? 'true' : 'false'}
      data-testid="composer-candidate-stream"
    >
      {primary ? (
        <div data-testid="composer-candidate-primary">
          {primary.title ? (
            <p className="text-foreground text-sm font-medium">
              {primary.title}
            </p>
          ) : null}
          {/*
            Only `drafting` is a live stream. `completed` (terminal run, or a
            delivered session) and `awaiting_confirmation` render the body as
            settled text — no caret, no blur-in reveal, and nothing replayed
            when the merchant reloads a finished run.
          */}
          <StreamingAiMarkdown
            className="prose prose-sm dark:prose-invert mt-1 max-w-none"
            content={primary.body}
            streaming={stream.streamPhase === 'drafting'}
          />
          {primary.conversionHook ? (
            <p className="text-muted mt-2 text-xs">{primary.conversionHook}</p>
          ) : null}
        </div>
      ) : (
        <div
          className="flex items-center gap-2"
          data-testid="composer-candidate-pending"
        >
          <ChatLoader.Dots />
          <span className="text-muted text-xs">正在写第一版…</span>
        </div>
      )}
      {stream.alternatives.length > 0 ? (
        <details className="mt-3" data-testid="composer-candidate-alternates">
          <summary className="text-muted cursor-pointer text-xs">
            另有 {stream.alternatives.length} 个备选 · 按需查看
          </summary>
          <ul className="mt-2 space-y-1">
            {stream.alternatives.map((slot) => (
              <li className="text-muted text-xs" key={slot.index}>
                {slot.title || slot.body.slice(0, 40) || '备选'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {stream.reconnectBanner ? (
        <output className="text-muted mt-2 block text-xs">
          {stream.reconnectBanner}
        </output>
      ) : null}
    </section>
  );
}

export type ComposerConversationProps = {
  session: ComposerSession;
  stream: ResultTokenStreamProjection;
  /** Optional one-tap identity choice shown as the first conversation card. */
  identitySlot?: React.ReactNode;
  /** 引导补问卡 (T11 skip UI lives inside this node). */
  questionSlot?: React.ReactNode;
  /**
   * P1-05 / xhs-spec §3.3: paid-media execution_confirm interrupt body.
   * Server interaction card and/or client cost confirm + cost feedback line.
   * Rendered as a DecisionFrame turn — not a sticky independent slot.
   */
  executionConfirmSlot?: React.ReactNode;
  /**
   * P1-07 / #319: outline edit on the multi-page note plan frame.
   * Host owns persistence; timeline model stays pure.
   */
  onNotePlanOutlineEdit?: (input: {
    pageId: string;
    title: string;
    body: string;
  }) => void;
  onNotePlanOutlineSave?: (pageId: string) => void;
  notePlanOutlineSaveError?: { message: string; pageId: string } | null;
  notePlanOutlineSavePendingPageId?: string | null;
  /** P1-07: per-page regenerate intent (fixture or merchant_request host). */
  onNotePlanRegeneratePage?: (pageId: string) => void;
  notePlanRegenerationError?: { message: string; pageId: string } | null;
  /** Delivery-time ContentPackage hydrate failed — page regen unavailable. */
  notePlanHydrationError?: { reason: string; message: string } | null;
  /** Opens the Result Center for a finished run — the only navigation. */
  onOpenDelivery: (input: ComposerDeliveryOpenInput) => void;
  /**
   * D-164⑤ 评价条与后续动作 chip 的出口。两者都跟着出口渲染 —— 不传就不出，
   * 一个点了没有去处的按钮比没有按钮更糟。
   */
  onRateDelivery?: (input: {
    transition: DeliveryRatingTransition;
    revision: ContentPackageRevisionDelivery;
    taskId: string;
  }) => Promise<unknown> | unknown;
  onDeliveryFollowUp?: (seed: DeliveryFollowUpSeed) => void;
  /** P2-11 / #323: Delivered secondary AI cover (ratio-selectable prefill). */
  onDeliveryAiCover?: (seed: AiCoverActionSeed) => void;
  /** 交付物自己的创作类型与画幅 — chip 集合按它取，横版上不再问要不要横版。 */
  deliveryLensId?: CreationLensId;
  deliveryAspectRatio?: string;
  /** 失败/partial 申报卡 recovery entry (W03). */
  onRecover?: (input: ComposerRecoveryInput) => void;
  /**
   * P2-13 task-in experience surfaces. Host projects from real producers;
   * omit a slot (or pass null) to hide that surface entirely.
   */
  experienceBasis?: ExperienceBasisProjection | null;
  experienceSediment?: ExperienceSedimentProjection | null;
  experienceCorrection?: ExperienceCorrectionProjection | null;
  onSedimentKeepLater?: (entryId: string) => void;
  onSedimentThisTimeOnly?: (entryId: string) => void;
};

/**
 * A turn's arrival, made visible (U07 Motion 进产品面).
 *
 * The transcript is the one place in the product where something appears
 * without the merchant having done anything — a stage announcement, a question,
 * the deliverable. A card that materialises with no transition reads as a
 * repaint; a short rise reads as「刚刚到的」. `initial` only runs on mount and
 * turns keep stable keys, so existing cards never replay: the motion marks
 * arrival and nothing else.
 *
 * The reduced-motion alternative is not a shorter animation, it is none: the
 * card is simply there, in its final position, on the first frame.
 *
 * Transform only, never opacity: an animation that fails to run must leave the
 * card eight pixels low, not invisible. The merchant's whole run lives in this
 * list, and no decoration gets to hide it.
 */
function TurnArrival({
  animate,
  children,
}: {
  animate: boolean;
  children: React.ReactNode;
}) {
  return (
    <m.div
      animate={animate ? { y: 0 } : undefined}
      initial={animate ? { y: 8 } : false}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      {children}
    </m.div>
  );
}

export function ComposerConversation({
  session,
  stream,
  identitySlot,
  questionSlot,
  executionConfirmSlot,
  onNotePlanOutlineEdit,
  onNotePlanOutlineSave,
  onNotePlanRegeneratePage,
  notePlanOutlineSaveError,
  notePlanOutlineSavePendingPageId,
  notePlanRegenerationError,
  notePlanHydrationError,
  onOpenDelivery,
  onRateDelivery,
  onDeliveryFollowUp,
  onDeliveryAiCover,
  deliveryLensId,
  deliveryAspectRatio,
  onRecover,
  experienceBasis,
  experienceSediment,
  experienceCorrection,
  onSedimentKeepLater,
  onSedimentThisTimeOnly,
}: ComposerConversationProps) {
  const turnCount = session.turns.length;
  const prefersReducedMotion = usePrefersReducedMotion();
  // `scrollTo({ behavior: 'smooth' })` ignores the `scroll-behavior: auto`
  // that styles.css forces under prefers-reduced-motion, so the transcript
  // has to answer the preference itself.
  const scrollBehavior = prefersReducedMotion ? 'instant' : 'smooth';
  // Prefer the *latest* interrupt: execution_confirm often arrives after
  // note_style, and stage progress must not re-fire scroll (deps stay narrow).
  const liveInterrupt = (() => {
    for (let index = session.turns.length - 1; index >= 0; index -= 1) {
      const turn = session.turns[index]!;
      if (turn.kind === 'question' || turn.kind === 'execution_confirm') {
        return turn;
      }
    }
    return null;
  })();
  const liveInterruptTurnId = liveInterrupt?.id ?? null;
  const liveInterruptKind = liveInterrupt?.kind ?? null;

  // Merchant must act on in-stream interrupts. Active sticky Composer (z-30)
  // covers the bottom of the timeline — bring the interrupt above the scrim
  // when it appears (same failure class as 成品交付卡 / M-04 direction card).
  useEffect(() => {
    if (!liveInterruptTurnId || !liveInterruptKind) return;
    const testId =
      liveInterruptKind === 'execution_confirm'
        ? 'composer-execution-confirm-turn'
        : 'composer-question-turn';
    const node = document.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`
    );
    if (!node || typeof node.scrollIntoView !== 'function') return;
    node.scrollIntoView({
      block: 'end',
      behavior: prefersReducedMotion ? 'instant' : 'smooth',
    });
  }, [liveInterruptKind, liveInterruptTurnId, prefersReducedMotion]);
  const morphEnabled = !prefersReducedMotion;

  if (turnCount === 0 && !identitySlot) return null;

  const running = session.phase === 'running' || session.phase === 'submitting';

  const frameHost = (
    turnKind: ComposerTimelineTurnKind,
    props: {
      children: React.ReactNode;
      className?: string;
      testId?: string;
      key?: string;
      stageLabel?: string | null;
    }
  ) => {
    const frameKind = resolveAgentFrameKind(turnKind);
    return (
      <AgentFrameHost
        className={props.className}
        frameKind={frameKind}
        key={props.key}
        stageLabel={
          props.stageLabel === null
            ? undefined
            : (props.stageLabel ?? agentFrameStageLabel(frameKind))
        }
        testId={props.testId}
        turnKind={turnKind}
      >
        {props.children}
      </AgentFrameHost>
    );
  };

  const renderTurn = (turn: ReturnType<typeof foldTurns>[number]) => {
    switch (turn.kind) {
      case 'stages':
        return frameHost('stages', {
          key: turn.stages[0]!.id,
          children: (
            <ComposerProgressCard running={running} stages={turn.stages} />
          ),
        });
      case 'merchant':
        // Merchant intent: light right-aligned chip. Not labeled 「叙述」 —
        // that stage is for agent document lines, and repeating it here
        // doubled the same prompt on the timeline.
        return frameHost('merchant', {
          key: turn.id,
          className: cn(
            'flex justify-end',
            isWorkbenchEngaged(session.phase) &&
              `${WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS} relative z-40`
          ),
          stageLabel: null,
          testId: 'composer-turn-merchant',
          children: (
            <div className="meiye-porcelain max-w-[min(100%,28rem)] rounded-2xl px-3 py-2 text-sm">
              {turn.text}
            </div>
          ),
        });
      case 'route_notice':
        return <RouteNotice key={turn.id} message={turn.message} />;
      case 'stage':
        // Folded into a 'stages' group above; unreachable.
        return null;
      case 'question':
        return questionSlot
          ? frameHost('question', {
              key: turn.id,
              // Clear Active sticky Composer (z-30) so 图文方向 / 补问 clicks land.
              className: WORKBENCH_STICKY_COMPOSER_INTERRUPT_CLASS,
              testId: 'composer-question-turn',
              children: questionSlot,
            })
          : null;
      case 'execution_confirm':
        // P1-05: in-stream AG-UI interrupt (DecisionFrame). Replaces the
        // independent sticky execution-confirm-slot mount from D-164.
        return executionConfirmSlot
          ? frameHost('execution_confirm', {
              key: turn.id,
              className: WORKBENCH_STICKY_COMPOSER_INTERRUPT_CLASS,
              testId: 'composer-execution-confirm-turn',
              children: executionConfirmSlot,
            })
          : null;
      case 'note_plan':
        // P1-07 / #319: multi-page outline + image status (AgentFrame plan).
        return frameHost('note_plan', {
          key: turn.id,
          testId: 'composer-note-plan-turn',
          children: (
            <NotePlanTimelineFrame
              onEditOutline={
                session.phase === 'delivered'
                  ? onNotePlanOutlineEdit
                  : undefined
              }
              onSaveOutline={
                session.phase === 'delivered'
                  ? onNotePlanOutlineSave
                  : undefined
              }
              onRegeneratePage={
                session.phase === 'delivered'
                  ? onNotePlanRegeneratePage
                  : undefined
              }
              outlineSaveError={notePlanOutlineSaveError}
              outlineSavePendingPageId={notePlanOutlineSavePendingPageId}
              outlineReadOnly={
                // L1-3: running-phase timeline is mountable but read-only;
                // outline edit / regenerate stay delivered-only (OCC chain).
                session.phase !== 'delivered' ||
                Boolean(notePlanOutlineSavePendingPageId)
              }
              regenerateError={notePlanRegenerationError}
              hydrationError={notePlanHydrationError}
              timeline={turn.timeline}
            />
          ),
        });
      case 'candidate': {
        // P0-3: after this run's delivery lands, collapse to a capsule;
        // drafting stays full. The single stream projection follows the
        // current task, so a capsule left by an earlier run must not borrow
        // the live run's content.
        //
        // P2-13 / D7: layoutId moves from the full candidate onto the delivery
        // card when collapse lands — shared-element morph. Capsule keeps no
        // layoutId so it does not fight the delivery face. Reduced-motion
        // drops layoutId entirely (instant swap).
        const collapsed = candidateShouldCollapse(session, turn);
        const morphId =
          morphEnabled && !collapsed
            ? resultMorphLayoutId(turn.taskId)
            : undefined;
        return frameHost('candidate', {
          key: turn.id,
          children: (
            <m.div
              data-morph-role={collapsed ? 'candidate-capsule' : 'candidate'}
              data-testid={
                collapsed
                  ? 'composer-candidate-morph-capsule'
                  : 'composer-candidate-morph'
              }
              layout={morphEnabled}
              layoutId={morphId}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {collapsed ? (
                <CandidateSummaryCapsule
                  stream={session.task?.taskId === turn.taskId ? stream : null}
                />
              ) : (
                <CandidateStream stream={stream} />
              )}
            </m.div>
          ),
        });
      }
      case 'delivery': {
        // P0-3 / F8: delivery is the summary face (statement + actions). Do not
        // re-paste the candidate body as a second full excerpt beside the stream.
        // P2-13: inherits layoutId from the candidate when motion is allowed.
        const morphId = morphEnabled
          ? resultMorphLayoutId(turn.taskId)
          : undefined;
        return frameHost('delivery', {
          key: turn.id,
          children: (
            <m.div
              data-morph-role="delivery"
              data-testid="composer-delivery-morph"
              layout={morphEnabled}
              layoutId={morphId}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <ComposerDeliveryCard
                aspectRatio={deliveryAspectRatio}
                lensId={deliveryLensId}
                onAiCover={onDeliveryAiCover}
                onFollowUp={onDeliveryFollowUp}
                onOpen={onOpenDelivery}
                onRate={
                  onRateDelivery && turn.revision
                    ? (transition) =>
                        onRateDelivery({
                          transition,
                          revision: turn.revision!,
                          taskId: turn.taskId,
                        })
                    : undefined
                }
                revision={turn.revision}
                statement={session.deliveryStatement}
                taskId={turn.taskId}
                workId={turn.workId}
              />
            </m.div>
          ),
        });
      }
      case 'report':
        return frameHost('report', {
          key: turn.id,
          children: (
            <ComposerReportCard
              onRecover={(input) => onRecover?.(input)}
              report={turn.report}
            />
          ),
        });
      case 'terminal':
        return frameHost('terminal', {
          key: turn.id,
          children: (
            <output
              className="meiye-porcelain rounded-2xl p-4 text-sm"
              data-outcome={turn.outcome}
              data-testid="composer-terminal-outcome"
            >
              {turn.message}
            </output>
          ),
        });
    }
  };

  return (
    /*
      P0-2 / F7: do not cap the pane with a nested max-height — that created a
      second scroll axis fighting the page. The transcript grows with the page,
      so the page is the single scroll main axis and ChatConversation's own
      follow-newest / scroll-to-latest machinery stays dormant (the pane never
      overflows itself). Following the newest turn is the page's job now.

      `aria-live="off"` on purpose: the component's `role="log"` would make the
      entire transcript one live region and re-announce whole cards. The
      announcements are already owned where they are written — 进度宣告卡 and
      the candidate stream each carry their own polite region.
    */
    <ChatConversation
      aria-live="off"
      className="meiye-conversation-pane"
      data-motion={prefersReducedMotion ? 'off' : 'on'}
      data-phase={session.phase}
      data-testid="composer-conversation"
      initial={scrollBehavior}
      resize={scrollBehavior}
    >
      <ChatConversation.Content className="meiye-document-timeline isolate z-[1] flex flex-col gap-3">
        <span
          aria-hidden="true"
          className="meiye-document-timeline__rail"
          data-testid="meiye-document-timeline-rail"
        />
        {/* T10's Day-0 identity card leads the flow; the folded turn list
            follows it. Both, in this order — the identity choice is offered
            before there is any transcript to fold. */}
        {identitySlot}
        {/*
          `domMax` — transcript needs layout for candidate→delivery morph
          (P2-13 / D7) plus the existing arrival transform. Reduced-motion
          still opts out of both via `morphEnabled` / TurnArrival.animate.
        */}
        <LazyMotion features={domMax} strict>
          {shouldShowExperienceBasis(session.phase) && experienceBasis ? (
            <TurnArrival animate={!prefersReducedMotion} key="experience-basis">
              {frameHost('experience_basis', {
                key: 'experience-basis-frame',
                children: (
                  <ExperienceBasisSurface projection={experienceBasis} />
                ),
              })}
            </TurnArrival>
          ) : null}
          {foldTurns(session.turns).map((turn) => {
            const rendered = renderTurn(turn);
            if (!rendered) return null;
            return (
              <TurnArrival
                animate={!prefersReducedMotion}
                key={rendered.key ?? undefined}
              >
                {rendered}
              </TurnArrival>
            );
          })}
          {shouldShowExperienceSediment(session.phase) && experienceSediment ? (
            <TurnArrival
              animate={!prefersReducedMotion}
              key="experience-sediment"
            >
              {frameHost('experience_sediment', {
                key: 'experience-sediment-frame',
                children: (
                  <ExperienceSedimentSurface
                    onKeepLater={onSedimentKeepLater}
                    onThisTimeOnly={onSedimentThisTimeOnly}
                    projection={experienceSediment}
                  />
                ),
              })}
            </TurnArrival>
          ) : null}
          {shouldShowExperienceCorrection(
            session.phase,
            experienceCorrection
          ) && experienceCorrection ? (
            <TurnArrival
              animate={!prefersReducedMotion}
              key="experience-correction"
            >
              {frameHost('experience_correction', {
                key: 'experience-correction-frame',
                children: (
                  <ExperienceCorrectionSurface
                    projection={experienceCorrection}
                  />
                ),
              })}
            </TurnArrival>
          ) : null}
        </LazyMotion>
        <ChatConversation.ScrollAnchor />
      </ChatConversation.Content>
      <ChatConversation.ScrollButton
        aria-label={composer_conversation_scroll_to_latest()}
        data-testid="composer-conversation-scroll-to-latest"
      />
    </ChatConversation>
  );
}

export type ComposerPromptBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * Locks the textarea. Kept narrow on purpose: the old shell only ever
   * disabled the submit button, so gating typing on things like "the quote has
   * not arrived yet" would stop a merchant mid-sentence.
   */
  disabled: boolean;
  /** Gates starting a run. Wider than `disabled` — quota, quote, uploads. */
  submitDisabled: boolean;
  /** Streaming lock — the send button becomes a stop affordance. */
  running: boolean;
  /**
   * @deprecated R-1: creation mode segment lives outside the Composer card.
   * Kept optional so isolated tests can still mount a standalone bar.
   */
  creationMode?: ComposerCreationMode;
  onCreationModeChange?: (mode: ComposerCreationMode) => void;
  /** D-081 lens radiogroup — hosted inside the 输出类型 capsule popover. */
  lensSlot?: React.ReactNode;
  /** Selected lens label echo on the capsule (e.g. 「图文」). */
  lensSummary?: string | null;
  /** True when required lens is missing — capsule shows required highlight. */
  lensRequired?: boolean;
  /**
   * D-164② recipe pills — hosted inside the 配方 capsule popover.
   */
  recipePillSlot?: React.ReactNode;
  /** Selected recipe title echo on the capsule. */
  recipeSummary?: string | null;
  /** Upload / style-reference surface — hosted inside the ＋素材 capsule. */
  attachmentSlot?: React.ReactNode;
  /**
   * Identity + tools affordances — hosted inside the @ capsule.
   * (口吻卡 / ComposerToolsStrip.)
   */
  mentionSlot?: React.ReactNode;
  /**
   * Credit balance / recovery — face shows a short label; popover keeps the
   * existing recovery host (passive line + blocking redeem card).
   */
  creditSlot?: React.ReactNode;
  /** Short credit label on the capsule face (e.g. balance notice). */
  creditSummary?: string | null;
  /** When true, credit capsule is emphasized (shortfall / blocked). */
  creditShort?: boolean;
  destination: string | null;
  onDestinationChange: (platform: string | null) => void;
  destinationCapability: string | null;
  reuseChips: ComposerReuseChip[];
  onReuseChip: (chip: ComposerReuseChip) => void;
  signedPreview: ComposerSignedPreview | null;
  /**
   * F-J-01 / G-UI-MERCHANT-NO-FALLBACK. The merchant is told what the model
   * that will actually run can reach. The reshell removed the model picker
   * (a T08 signed field), so this readiness rides the read-only preview
   * instead — the guarantee survives the control that used to carry it.
   */
  modelChannelReadiness?: string | null;
  placeholder: string;
  ariaLabel: string;
  /** Accessible name of the send control — states which of its two jobs is armed. */
  submitLabel: string;
  /** Visible companion to `submitLabel`; null when the press starts a run. */
  submitHint?: string | null;
  /**
   * Why the last send press did not start a run. Rendered as a real, visible
   * `role=alert` and bound to the textarea through `aria-describedby`, so a red
   * edge is never the only signal (WCAG 3.3.1).
   */
  intentError?: string | null;
  /** Host-owned page composition — DESIGN.md 白瓷 Composer 大卡 lands here. */
  className?: string;
  /**
   * Idle density (P0): secondary capsules (素材 / 输出类型 / 配方 / @) collapse
   * behind 「更多」so the default face is intent + 发到哪 + send. Full keeps the
   * flat capsule row for Active sticky composer.
   */
  controlDensity?: 'full' | 'idle-compact';
  /** Open the attach popover (V31-73 「去传素材」). */
  attachOpen?: boolean;
  onAttachOpenChange?: (open: boolean) => void;
  /** Increment to unfold 「更多」so the attach capsule is on the face. */
  expandMoreRequest?: number;
  /** Quote / usage lines that must stay inside the composer card. */
  usageSlot?: React.ReactNode;
};

const INTENT_ERROR_ID = 'composer-intent-error';
const SUBMIT_HINT_ID = 'composer-submit-intent';

function CapsuleTrigger({
  children,
  className,
  required,
  active,
  testId,
  ...props
}: React.ComponentProps<'button'> & {
  required?: boolean;
  active?: boolean;
  testId: string;
}) {
  return (
    <button
      className={cn(
        // 36px is the 紧凑 button height (DESIGN.md §5); a finger needs 44.
        // Bound to `pointer: coarse` rather than a width breakpoint so the
        // desktop density stays put even in a narrow window.
        'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-touch-target',
        'text-foreground hover:bg-foreground/5',
        active && 'ring-foreground/15 bg-foreground/5 ring-1',
        required && 'text-destructive ring-destructive/40 ring-1',
        className
      )}
      data-active={active ? 'true' : 'false'}
      data-required={required ? 'true' : 'false'}
      data-testid={testId}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Composer prompt surface (L3-2 capsule contract / spec §2.4).
 *
 * Default Idle face: intent textarea + compact bottom row
 * (更多 / 发到哪 / 弱化积分 / circular send). Secondary capsules
 * (＋素材 / 输出类型 / 配方 / @) expand from 「更多」.
 * Active sticky bar uses controlDensity="full" for flat capsules.
 * Creation-mode segmenter is outside this card (R-1).
 */
export function ComposerPromptBar({
  value,
  onValueChange,
  onSubmit,
  disabled,
  submitDisabled,
  running,
  creationMode,
  onCreationModeChange,
  lensSlot,
  lensSummary = null,
  lensRequired = false,
  recipePillSlot,
  recipeSummary = null,
  attachmentSlot,
  mentionSlot,
  creditSlot,
  creditSummary = null,
  creditShort = false,
  destination,
  onDestinationChange,
  destinationCapability,
  reuseChips,
  onReuseChip,
  signedPreview,
  modelChannelReadiness,
  placeholder,
  ariaLabel,
  submitLabel,
  submitHint = null,
  intentError = null,
  className,
  controlDensity = 'full',
  attachOpen,
  onAttachOpenChange,
  expandMoreRequest = 0,
  usageSlot,
}: ComposerPromptBarProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);
  useEffect(() => {
    if (expandMoreRequest > 0) setMoreExpanded(true);
  }, [expandMoreRequest]);
  const describedBy =
    [intentError ? INTENT_ERROR_ID : null, submitHint ? SUBMIT_HINT_ID : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const destinationOption = COMPOSER_DESTINATION_OPTIONS.find(
    (option) => option.id === destination
  );
  const destinationLabel = destinationOption
    ? destinationOption.label
    : '发到哪';

  const hasSecondaryControls = Boolean(
    attachmentSlot || lensSlot || recipePillSlot || mentionSlot
  );
  const idleCompact = controlDensity === 'idle-compact';
  const showSecondaryCapsules = !idleCompact || moreExpanded;
  const moreSummary = [lensSummary, recipeSummary].filter(Boolean).join(' · ');
  const moreRequired = Boolean(lensRequired && !lensSummary);
  // D-C2: a required control cannot live behind 「更多」. While 创作类型 is still
  // unchosen its capsule stays on the default idle face, so the one thing that
  // blocks send is the one thing the merchant can see.
  const showLensCapsule = showSecondaryCapsules || moreRequired;

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        running && 'meiye-rose-glow',
        className
      )}
      data-running={running ? 'true' : 'false'}
      data-testid="composer-prompt-bar"
    >
      {/* Optional legacy segment — prefer ComposerCreationModeSegment outside. */}
      {creationMode && onCreationModeChange ? (
        <ComposerCreationModeSegment
          creationMode={creationMode}
          onCreationModeChange={onCreationModeChange}
        />
      ) : null}

      {running ? (
        <div data-testid="composer-generation-accent">
          <GenerationAccent label={composer_generation_running()} />
        </div>
      ) : null}

      <PromptInput
        isDisabled={disabled}
        onSubmit={onSubmit}
        onValueChange={onValueChange}
        status={running ? 'streaming' : 'ready'}
        value={value}
      >
        <PromptInput.Shell className="meiye-porcelain border-0 bg-transparent shadow-none">
          <PromptInput.Content
            onKeyDownCapture={(event) => {
              // Upstream PromptInput submits on bare Enter. The shipped submit
              // contract is Cmd/Ctrl+Enter, and the D-043 activation counter
              // only counts that — letting bare Enter through would submit
              // uncounted and would swallow newlines mid-sentence. Stopping in
              // the capture phase leaves the textarea's default newline intact
              // while Cmd/Ctrl+Enter and Shift+Enter keep their behaviour.
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.stopPropagation();
              }
            }}
          >
            {/*
              No `ref` here on purpose: PromptInput.TextArea spreads incoming
              props after its own `ref`, so passing one silently replaces the
              ref its autosize depends on and the box stops growing. Callers
              focus it through COMPOSER_INTENT_INPUT_TESTID instead.
            */}
            <PromptInput.TextArea
              aria-describedby={describedBy}
              aria-invalid={intentError ? true : undefined}
              aria-label={ariaLabel}
              data-testid={COMPOSER_INTENT_INPUT_TESTID}
              placeholder={placeholder}
            />
          </PromptInput.Content>
        </PromptInput.Shell>
      </PromptInput>

      {/*
        The reason a press did not start a run, and what the next press will do.
        Both are real text, both are `aria-describedby` targets on the textarea:
        a red edge on its own told screen-reader users nothing and told sighted
        merchants a colour without a cause.
      */}
      {intentError ? (
        <p
          className="text-destructive text-sm"
          data-testid={INTENT_ERROR_ID}
          id={INTENT_ERROR_ID}
          role="alert"
        >
          {intentError}
        </p>
      ) : null}
      {submitHint ? (
        <p
          className="text-muted text-xs"
          data-testid={SUBMIT_HINT_ID}
          id={SUBMIT_HINT_ID}
        >
          {submitHint}
        </p>
      ) : null}

      {/*
        Bottom icon capsule — L3-2 / prototype 04:286-294.
        Idle-compact collapses 素材/输出类型/配方/@ behind 「更多」so the default
        face is 发到哪 + send (+ weak credits). Active uses the flat row.
        Popovers host the former stacked controls; selected state echoes on
        the capsule labels. Radiogroup / fieldset a11y stays inside popovers.
      */}
      <div
        className="meiye-glass-piece flex flex-wrap items-center gap-1 rounded-full p-1.5"
        data-control-density={controlDensity}
        data-more-expanded={showSecondaryCapsules ? 'true' : 'false'}
        data-testid="composer-prompt-capsule"
      >
        {idleCompact && hasSecondaryControls ? (
          <CapsuleTrigger
            active={moreExpanded || Boolean(moreSummary)}
            aria-expanded={moreExpanded}
            aria-label={moreSummary ? `更多设置：${moreSummary}` : '更多设置'}
            onClick={() => setMoreExpanded((open) => !open)}
            testId="composer-capsule-more"
          >
            <span>{moreExpanded ? '收起' : '更多'}</span>
            {moreSummary && !moreExpanded ? (
              <span className="max-w-[6rem] truncate text-muted-foreground">
                {moreSummary}
              </span>
            ) : (
              <span aria-hidden="true">{moreExpanded ? '▴' : '▾'}</span>
            )}
          </CapsuleTrigger>
        ) : null}

        {showSecondaryCapsules && attachmentSlot ? (
          <Popover onOpenChange={onAttachOpenChange} open={attachOpen}>
            <PopoverTrigger
              render={(triggerProps) => (
                <CapsuleTrigger
                  {...triggerProps}
                  aria-label="添加素材"
                  testId="composer-capsule-attach"
                >
                  <span aria-hidden="true">＋</span>
                  <span className="hidden sm:inline">素材</span>
                </CapsuleTrigger>
              )}
            />
            <PopoverContent
              align="start"
              className="max-h-[70vh] w-[min(100vw-2rem,22rem)] overflow-y-auto p-3"
              data-testid="composer-capsule-attach-panel"
            >
              {attachmentSlot}
            </PopoverContent>
          </Popover>
        ) : null}

        {showLensCapsule && lensSlot ? (
          <Popover>
            <PopoverTrigger
              render={(triggerProps) => (
                <CapsuleTrigger
                  {...triggerProps}
                  active={Boolean(lensSummary)}
                  aria-label={
                    lensSummary
                      ? `创作类型：${lensSummary}`
                      : '选择创作类型（必选）'
                  }
                  // Ink emphasis, not the destructive ring `required` paints:
                  // an unmade required choice is a state, not an error, and the
                  // rose accent is reserved for AI spark (DESIGN.md).
                  className={
                    moreRequired
                      ? 'ring-foreground/30 font-semibold ring-1'
                      : undefined
                  }
                  data-required-unmet={moreRequired ? 'true' : 'false'}
                  testId="composer-capsule-lens"
                >
                  <span>{lensSummary ?? '创作类型（必选）'}</span>
                  <span aria-hidden="true">▾</span>
                </CapsuleTrigger>
              )}
            />
            <PopoverContent
              align="start"
              className="w-[min(100vw-2rem,22rem)] p-3"
              data-testid="composer-capsule-lens-panel"
            >
              {lensSlot}
            </PopoverContent>
          </Popover>
        ) : null}

        {showSecondaryCapsules && recipePillSlot ? (
          <Popover>
            <PopoverTrigger
              render={(triggerProps) => (
                <CapsuleTrigger
                  {...triggerProps}
                  active={Boolean(recipeSummary)}
                  aria-label={
                    recipeSummary ? `配方：${recipeSummary}` : '选择配方'
                  }
                  testId="composer-capsule-recipe"
                >
                  <span className="max-w-[7rem] truncate">
                    {recipeSummary ?? '配方'}
                  </span>
                  <span aria-hidden="true">▾</span>
                </CapsuleTrigger>
              )}
            />
            <PopoverContent
              align="start"
              className="w-[min(100vw-2rem,24rem)] max-h-[70vh] overflow-y-auto p-3"
              data-testid="composer-capsule-recipe-panel"
            >
              {recipePillSlot}
            </PopoverContent>
          </Popover>
        ) : null}

        {showSecondaryCapsules && mentionSlot ? (
          <Popover>
            <PopoverTrigger
              render={(triggerProps) => (
                <CapsuleTrigger
                  {...triggerProps}
                  aria-label="口吻与创作工具"
                  testId="composer-capsule-mention"
                >
                  <span aria-hidden="true">@</span>
                </CapsuleTrigger>
              )}
            />
            <PopoverContent
              align="start"
              className="w-[min(100vw-2rem,24rem)] max-h-[70vh] overflow-y-auto p-3"
              data-testid="composer-capsule-mention-panel"
            >
              {mentionSlot}
            </PopoverContent>
          </Popover>
        ) : null}

        <Popover>
          <PopoverTrigger
            render={(triggerProps) => (
              <CapsuleTrigger
                {...triggerProps}
                active={Boolean(destination)}
                aria-label={
                  destinationLabel === '发到哪'
                    ? '选择发布平台'
                    : `发到哪：${destinationLabel}`
                }
                testId="composer-capsule-destination"
              >
                <span>{destinationLabel}</span>
                <span aria-hidden="true">▾</span>
              </CapsuleTrigger>
            )}
          />
          <PopoverContent
            align="start"
            className="w-[min(100vw-2rem,20rem)] p-3"
            data-testid="composer-destination-chips"
          >
            <p className="text-muted mb-2 text-xs">发到哪</p>
            <div className="flex flex-wrap items-center gap-2">
              {COMPOSER_DESTINATION_OPTIONS.map((option) => (
                <button
                  aria-pressed={destination === option.id}
                  className={cn(
                    'meiye-glass-piece rounded-full px-3 py-1 text-xs',
                    destination === option.id &&
                      'ring-foreground/20 text-foreground ring-1'
                  )}
                  data-testid={`composer-destination-option-${option.id}`}
                  key={option.id}
                  onClick={() =>
                    onDestinationChange(
                      destination === option.id ? null : option.id
                    )
                  }
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {destinationCapability ? (
              <span
                className="text-muted mt-2 block text-xs"
                data-testid="composer-destination-capability"
              >
                {destinationCapability}
              </span>
            ) : null}
            {reuseChips.length > 0 ? (
              <div className="mt-3 border-t pt-3">
                <PromptSuggestion
                  data-testid="composer-reuse-chips"
                  variant="pill"
                >
                  <PromptSuggestion.Group
                    label={composer_reuse_suggestion_group()}
                  >
                    <PromptSuggestion.Items>
                      {reuseChips.map((chip) => (
                        <PromptSuggestion.Item
                          data-testid={`composer-reuse-chip-${chip.id}`}
                          key={chip.id}
                          onPress={() => onReuseChip(chip)}
                        >
                          {chip.label}
                        </PromptSuggestion.Item>
                      ))}
                    </PromptSuggestion.Items>
                  </PromptSuggestion.Group>
                </PromptSuggestion>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>

        {creditSlot ? (
          <Popover>
            <PopoverTrigger
              render={(triggerProps) => (
                <CapsuleTrigger
                  {...triggerProps}
                  active={Boolean(creditSummary) && !idleCompact}
                  aria-label={creditSummary ?? '积分'}
                  className={
                    idleCompact && !creditShort
                      ? 'text-muted-foreground font-normal'
                      : undefined
                  }
                  required={creditShort}
                  testId="composer-capsule-credit"
                >
                  <span className="max-w-[8rem] truncate">
                    {creditSummary ?? '积分'}
                  </span>
                </CapsuleTrigger>
              )}
            />
            <PopoverContent
              align="end"
              className="w-[min(100vw-2rem,22rem)] p-3"
              data-testid="composer-capsule-credit-panel"
            >
              {creditSlot}
            </PopoverContent>
          </Popover>
        ) : null}

        <button
          aria-describedby={submitHint ? SUBMIT_HINT_ID : undefined}
          aria-label={submitLabel}
          className={cn(
            'ml-auto inline-flex size-10 shrink-0 items-center justify-center rounded-full pointer-coarse:size-touch-target',
            'bg-primary text-primary-foreground shadow-sm transition-opacity',
            'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
          )}
          data-testid="composer-submit"
          disabled={submitDisabled}
          onClick={onSubmit}
          type="button"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ↑
          </span>
        </button>
      </div>

      {/* Read-only echo of what the server will sign and freeze (T08). */}
      {signedPreview ? (
        <div
          className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs"
          data-testid="composer-signed-preview"
        >
          {signedPreview.rows.map((row) => (
            <span data-testid={`composer-signed-row-${row.key}`} key={row.key}>
              {row.label}：{row.value}
            </span>
          ))}
          <span className="text-muted text-xs">{signedPreview.capability}</span>
          {modelChannelReadiness === 'single_channel' ||
          modelChannelReadiness === 'multi_channel_ready' ? (
            <span
              data-channel-readiness={modelChannelReadiness}
              data-testid="composer-model-channel-readiness"
            >
              {modelChannelReadiness === 'multi_channel_ready'
                ? model_card_channel_multi()
                : model_card_channel_single()}
            </span>
          ) : null}
        </div>
      ) : null}
      {usageSlot}
    </div>
  );
}
