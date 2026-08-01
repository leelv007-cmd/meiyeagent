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
import { domAnimation, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { CSSProperties } from 'react';

import {
  ChatConversation,
  ChatLoader,
  PromptInput,
  PromptSuggestion,
  Segment,
} from '@/components/heroui-pro';
import {
  composer_conversation_scroll_to_latest,
  composer_reuse_suggestion_group,
  model_card_channel_multi,
  model_card_channel_single,
} from '@/locale/paraglide/messages';
import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';
import type { ResultTokenStreamProjection } from '@/product/results/result-token-stream';

import {
  ComposerDeliveryCard,
  type DeliveryRatingTransition,
  type ComposerDeliveryOpenInput,
} from './composer-delivery-card';
import type { DeliveryFollowUpSeed } from './delivery-followup-seeds';
import { ComposerProgressCard } from './composer-progress-card';
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

export type ComposerCreationMode = 'customized' | 'free';

export const COMPOSER_INTENT_INPUT_TESTID = 'composer-intent-input';

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
 * Document-timeline frame host (#313 / D1).
 *
 * Every turn renders through the AgentFrame registry. Agent content is full
 * width; merchant input may keep a light right-aligned chip (not a chat bubble
 * stream). data-agent-frame is the consumer hook for frame-family assertions.
 */
function AgentFrameHost({
  turnKind,
  frameKind,
  children,
  className,
  testId,
}: {
  turnKind: ComposerTimelineTurnKind;
  frameKind: AgentFrameKind;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn('w-full min-w-0', className)}
      data-agent-frame={frameKind}
      data-testid={testId ?? `agent-frame-${frameKind}`}
      data-turn-kind={turnKind}
    >
      {children}
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
  return (
    <AgentFrameHost
      frameKind={resolveAgentFrameKind('route_notice')}
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
  /** P1-07: per-page regenerate intent (fixture or merchant_request host). */
  onNotePlanRegeneratePage?: (pageId: string) => void;
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
  /** 交付物自己的创作类型与画幅 — chip 集合按它取，横版上不再问要不要横版。 */
  deliveryLensId?: CreationLensId;
  deliveryAspectRatio?: string;
  /** 失败/partial 申报卡 recovery entry (W03). */
  onRecover?: (input: ComposerRecoveryInput) => void;
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
  onNotePlanRegeneratePage,
  onOpenDelivery,
  onRateDelivery,
  onDeliveryFollowUp,
  deliveryLensId,
  deliveryAspectRatio,
  onRecover,
}: ComposerConversationProps) {
  const turnCount = session.turns.length;
  const prefersReducedMotion = usePrefersReducedMotion();
  // `scrollTo({ behavior: 'smooth' })` ignores the `scroll-behavior: auto`
  // that styles.css forces under prefers-reduced-motion, so the transcript
  // has to answer the preference itself.
  const scrollBehavior = prefersReducedMotion ? 'instant' : 'smooth';

  if (turnCount === 0 && !identitySlot) return null;

  const running = session.phase === 'running' || session.phase === 'submitting';

  const renderTurn = (turn: ReturnType<typeof foldTurns>[number]) => {
    switch (turn.kind) {
      case 'stages':
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('stages')}
            key={turn.stages[0]!.id}
            turnKind="stages"
          >
            <ComposerProgressCard running={running} stages={turn.stages} />
          </AgentFrameHost>
        );
      case 'merchant':
        // Merchant intent: light right-aligned chip allowed; still a registry frame.
        return (
          <AgentFrameHost
            className="flex justify-end"
            frameKind={resolveAgentFrameKind('merchant')}
            key={turn.id}
            testId="composer-turn-merchant"
            turnKind="merchant"
          >
            <div className="meiye-porcelain max-w-[min(100%,28rem)] rounded-2xl px-3 py-2 text-sm">
              {turn.text}
            </div>
          </AgentFrameHost>
        );
      case 'route_notice':
        return <RouteNotice key={turn.id} message={turn.message} />;
      case 'stage':
        // Folded into a 'stages' group above; unreachable.
        return null;
      case 'question':
        return questionSlot ? (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('question')}
            key={turn.id}
            testId="composer-question-turn"
            turnKind="question"
          >
            {questionSlot}
          </AgentFrameHost>
        ) : null;
      case 'execution_confirm':
        // P1-05: in-stream AG-UI interrupt (DecisionFrame). Replaces the
        // independent sticky execution-confirm-slot mount from D-164.
        return executionConfirmSlot ? (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('execution_confirm')}
            key={turn.id}
            testId="composer-execution-confirm-turn"
            turnKind="execution_confirm"
          >
            {executionConfirmSlot}
          </AgentFrameHost>
        ) : null;
      case 'note_plan':
        // P1-07 / #319: multi-page outline + image status (AgentFrame plan).
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('note_plan')}
            key={turn.id}
            testId="composer-note-plan-turn"
            turnKind="note_plan"
          >
            <NotePlanTimelineFrame
              onEditOutline={onNotePlanOutlineEdit}
              onRegeneratePage={onNotePlanRegeneratePage}
              outlineReadOnly={session.phase === 'submitting'}
              timeline={turn.timeline}
            />
          </AgentFrameHost>
        );
      case 'candidate':
        // P0-3: after this run's delivery lands, collapse to a capsule;
        // drafting stays full. The single stream projection follows the
        // current task, so a capsule left by an earlier run must not borrow
        // the live run's content.
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('candidate')}
            key={turn.id}
            turnKind="candidate"
          >
            {candidateShouldCollapse(session, turn) ? (
              <CandidateSummaryCapsule
                stream={session.task?.taskId === turn.taskId ? stream : null}
              />
            ) : (
              <CandidateStream stream={stream} />
            )}
          </AgentFrameHost>
        );
      case 'delivery':
        // P0-3 / F8: delivery is the summary face (statement + actions). Do not
        // re-paste the candidate body as a second full excerpt beside the stream.
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('delivery')}
            key={turn.id}
            turnKind="delivery"
          >
            <ComposerDeliveryCard
              aspectRatio={deliveryAspectRatio}
              lensId={deliveryLensId}
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
          </AgentFrameHost>
        );
      case 'report':
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('report')}
            key={turn.id}
            turnKind="report"
          >
            <ComposerReportCard
              onRecover={(input) => onRecover?.(input)}
              report={turn.report}
            />
          </AgentFrameHost>
        );
      case 'terminal':
        return (
          <AgentFrameHost
            frameKind={resolveAgentFrameKind('terminal')}
            key={turn.id}
            turnKind="terminal"
          >
            <output
              className="meiye-porcelain rounded-2xl p-4 text-sm"
              data-outcome={turn.outcome}
              data-testid="composer-terminal-outcome"
            >
              {turn.message}
            </output>
          </AgentFrameHost>
        );
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
      <ChatConversation.Content className="flex flex-col gap-3">
        {/* T10's Day-0 identity card leads the flow; the folded turn list
            follows it. Both, in this order — the identity choice is offered
            before there is any transcript to fold. */}
        {identitySlot}
        {/*
          `domAnimation` only — the product面 pays for the animation features it
          actually uses, and this transcript uses opacity and transform.
        */}
        <LazyMotion features={domAnimation} strict>
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
  creationMode: ComposerCreationMode;
  onCreationModeChange: (mode: ComposerCreationMode) => void;
  /** D-081 lens radiogroup. See the render site for why it is on both lines. */
  lensSlot?: React.ReactNode;
  /**
   * D-164② 第二层：the recipe pills for the lens above. It sits inside the bar
   * because the axis and its shortcuts are one control surface — outside it,
   * with the quote line in between, they read as two unrelated panels.
   */
  recipePillSlot?: React.ReactNode;
  attachmentSlot?: React.ReactNode;
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
};

const INTENT_ERROR_ID = 'composer-intent-error';
const SUBMIT_HINT_ID = 'composer-submit-intent';

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
  recipePillSlot,
  attachmentSlot,
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
}: ComposerPromptBarProps) {
  const describedBy =
    [intentError ? INTENT_ERROR_ID : null, submitHint ? SUBMIT_HINT_ID : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      data-testid="composer-prompt-bar"
      style={
        {
          /* The prompt bar sits on the ambient backdrop, where --ink-60 paints
           * to ~3:1 in the light theme; raise the unselected segment label the
           * same way the works filter does. */
          '--meiye-segment-unselected': 'var(--ink-90)',
        } as CSSProperties
      }
    >
      {/* D-111 双入口自报: 定制 and 自由 are two entries, never one blended control. */}
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

      {/*
        ADR-0014 wants outputKind compiled from the intent so the customized
        line never asks 对口, but that compiler (T18 ①段) is not wired to the
        recipe/quote selection yet: without a lens there is no catalog
        operation and no quote, and picking a default here would be inventing a
        product decision this ticket does not own. So the selector stays on
        both lines for now — D-081's radiogroup contract, which D-043 already
        counts as one of its two activations.
      */}
      {lensSlot}
      {recipePillSlot}

      <PromptInput
        isDisabled={disabled}
        onSubmit={onSubmit}
        onValueChange={onValueChange}
        status={running ? 'streaming' : 'ready'}
        value={value}
      >
        <PromptInput.Shell className="meiye-porcelain">
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
          <PromptInput.Toolbar>
            <PromptInput.ToolbarEnd>
              <PromptInput.Send
                aria-label={submitLabel}
                data-testid="composer-submit"
                isDisabled={submitDisabled}
              />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
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
        Outside the Shell on purpose. The upload surface carries the T5 授权
        disclosure, which expands into a full card; inside PromptInput.Toolbar
        it is laid out as a toolbar item, so the expanded panel is clipped by
        the toolbar row and the Shell's own layers swallow clicks meant for the
        confirm button. A full-width block keeps it in the composer card — where
        it belongs — without borrowing the toolbar's geometry.
      */}
      {attachmentSlot ? <div className="mt-1">{attachmentSlot}</div> : null}

      {/* 「发到哪」— one question, one tap. The双字段 split stays server-side. */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="composer-destination-chips"
      >
        <span className="text-muted text-xs">发到哪</span>
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
              onDestinationChange(destination === option.id ? null : option.id)
            }
            type="button"
          >
            {option.label}
          </button>
        ))}
        {destinationCapability ? (
          <span
            className="text-muted text-xs"
            data-testid="composer-destination-capability"
          >
            {destinationCapability}
          </span>
        ) : null}
      </div>

      {/*
        U04: the 旧内容换平台 openers are the supply layer's PromptSuggestion —
        one-tap sentences that drop into the merchant's own draft. This is the
        composer's cold surface too: before there is any transcript, these
        pills and the intent box are the whole offer, so the 空态 is a
        suggestion rather than an empty panel.
      */}
      {reuseChips.length > 0 ? (
        <PromptSuggestion data-testid="composer-reuse-chips" variant="pill">
          <PromptSuggestion.Group label={composer_reuse_suggestion_group()}>
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
      ) : null}

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
    </div>
  );
}
