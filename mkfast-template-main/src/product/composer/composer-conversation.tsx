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

import { useEffect, useRef } from 'react';

import {
  ChatLoader,
  ChatMessage,
  PromptInput,
  Segment,
} from '@/components/heroui-pro';
import {
  model_card_channel_multi,
  model_card_channel_single,
} from '@/locale/paraglide/messages';
import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { cn } from '@/lib/utils';
import type { ResultTokenStreamProjection } from '@/product/results/result-token-stream';

import type {
  ComposerSession,
  ComposerTurn,
} from './composer-session';
import type { ComposerSignedPreview } from './composer-signed-preview';

export type ComposerCreationMode = 'customized' | 'free';

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

function StageLine({ message, stage }: { message: string; stage: string }) {
  return (
    <p
      className="text-muted px-1 text-xs"
      data-stage={stage}
      data-testid="composer-stage-line"
    >
      {message}
    </p>
  );
}

/**
 * D-111 分流告知. Identified by the `intent_naming` success frame, so the
 * wording stays T11's to own. Never silently downgrades: the merchant is told
 * which mode this run used.
 */
function RouteNotice({ message }: { message: string }) {
  return (
    <ChatMessage.Assistant data-testid="composer-route-notice">
      <ChatMessage.Bubble className="meiye-glass-piece">
        <ChatMessage.Content>{message}</ChatMessage.Content>
      </ChatMessage.Bubble>
    </ChatMessage.Assistant>
  );
}

function CandidateStream({
  stream,
}: {
  stream: ResultTokenStreamProjection;
}) {
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
          <StreamingAiMarkdown
            className="prose prose-sm dark:prose-invert mt-1 max-w-none"
            content={primary.body}
            streaming={stream.streamPhase === 'drafting'}
          />
          {primary.conversionHook ? (
            <p className="text-muted mt-2 text-xs">
              {primary.conversionHook}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2" data-testid="composer-candidate-pending">
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
        <p className="text-muted mt-2 text-xs" role="status">
          {stream.reconnectBanner}
        </p>
      ) : null}
    </section>
  );
}

export type ComposerConversationProps = {
  session: ComposerSession;
  stream: ResultTokenStreamProjection;
  /** 引导补问卡 (T11 skip UI lives inside this node). */
  questionSlot?: React.ReactNode;
  /** Opens the Result Center for a finished run — the only navigation. */
  onOpenDelivery: (input: { workId: string; taskId: string }) => void;
};

export function ComposerConversation({
  session,
  stream,
  questionSlot,
  onOpenDelivery,
}: ComposerConversationProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const turnCount = session.turns.length;

  useEffect(() => {
    // Structured card flow, not a chat log — follow the newest turn without
    // hijacking the page scroll on first paint.
    if (turnCount === 0) return;
    // Optional-call: following the newest turn is a nicety, and jsdom has no
    // scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [turnCount]);

  if (turnCount === 0) return null;

  const renderTurn = (turn: ComposerTurn) => {
    switch (turn.kind) {
      case 'merchant':
        return (
          <ChatMessage.User data-testid="composer-turn-merchant" key={turn.id}>
            <ChatMessage.Bubble>
              <ChatMessage.Content>{turn.text}</ChatMessage.Content>
            </ChatMessage.Bubble>
          </ChatMessage.User>
        );
      case 'route_notice':
        return <RouteNotice key={turn.id} message={turn.message} />;
      case 'stage':
        return (
          <StageLine key={turn.id} message={turn.message} stage={turn.stage} />
        );
      case 'question':
        return questionSlot ? (
          <div data-testid="composer-question-turn" key={turn.id}>
            {questionSlot}
          </div>
        ) : null;
      case 'candidate':
        return <CandidateStream key={turn.id} stream={stream} />;
      case 'delivery':
        return (
          <button
            className="meiye-porcelain w-full rounded-2xl p-4 text-left"
            data-testid="composer-delivery-card"
            key={turn.id}
            onClick={() =>
              onOpenDelivery({ workId: turn.workId, taskId: turn.taskId })
            }
            type="button"
          >
            <p className="text-foreground text-sm font-medium">成品已就绪</p>
            <p className="text-muted mt-1 text-xs">点开看完整成品、发布或导出</p>
          </button>
        );
    }
  };

  return (
    <section
      className="flex flex-col gap-3"
      data-phase={session.phase}
      data-testid="composer-conversation"
    >
      {session.turns.map(renderTurn)}
      <div ref={endRef} />
    </section>
  );
}

export type ComposerPromptBarProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  /** Streaming lock — the send button becomes a stop affordance. */
  running: boolean;
  creationMode: ComposerCreationMode;
  onCreationModeChange: (mode: ComposerCreationMode) => void;
  /** D-081 lens radiogroup — 自由创作线存续, hidden on the customized line. */
  lensSlot?: React.ReactNode;
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
  textAreaRef?: React.Ref<HTMLTextAreaElement>;
  placeholder: string;
  ariaLabel: string;
  submitLabel: string;
  /** Host-owned page composition — DESIGN.md 白瓷 Composer 大卡 lands here. */
  className?: string;
};

export function ComposerPromptBar({
  value,
  onValueChange,
  onSubmit,
  disabled,
  running,
  creationMode,
  onCreationModeChange,
  lensSlot,
  attachmentSlot,
  destination,
  onDestinationChange,
  destinationCapability,
  reuseChips,
  onReuseChip,
  signedPreview,
  modelChannelReadiness,
  textAreaRef,
  placeholder,
  ariaLabel,
  submitLabel,
  className,
}: ComposerPromptBarProps) {
  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      data-testid="composer-prompt-bar"
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
        <Segment.Item data-testid="composer-creation-mode-customized" id="customized">
          定制创作
        </Segment.Item>
        <Segment.Item data-testid="composer-creation-mode-free" id="free">
          自由创作
        </Segment.Item>
      </Segment>

      {creationMode === 'free' ? lensSlot : null}

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
            <PromptInput.TextArea
              aria-label={ariaLabel}
              data-testid="composer-intent-input"
              placeholder={placeholder}
              ref={textAreaRef}
            />
          </PromptInput.Content>
          <PromptInput.Toolbar>
            <PromptInput.ToolbarStart>
              {attachmentSlot}
            </PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd>
              <PromptInput.Send
                aria-label={submitLabel}
                data-testid="composer-submit"
                isDisabled={disabled}
              />
            </PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
      </PromptInput>

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

      {reuseChips.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="composer-reuse-chips"
        >
          <span className="text-muted text-xs">想把旧内容换个平台再发？</span>
          {reuseChips.map((chip) => (
            <button
              className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
              data-testid={`composer-reuse-chip-${chip.id}`}
              key={chip.id}
              onClick={() => onReuseChip(chip)}
              type="button"
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Read-only echo of what the server will sign and freeze (T08). */}
      {signedPreview ? (
        <div
          className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs"
          data-testid="composer-signed-preview"
        >
          {signedPreview.rows.map((row) => (
            <span
              data-testid={`composer-signed-row-${row.key}`}
              key={row.key}
            >
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
