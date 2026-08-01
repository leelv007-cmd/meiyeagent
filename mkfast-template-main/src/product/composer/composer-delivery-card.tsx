/**
 * 成品交付卡 — the third outbound seam message (T31 / #225).
 *
 * Carries what D-116 calls the 任务总结 (策略依据/版本定位/使用建议) and the three
 * action entries. The delivered copy itself stays on the candidate capsule
 * (P0-3 / #286 retired the card's duplicate excerpt). ADR-0014 keeps 提交后不跳转:
 * the card is the doorway, so every action *opens the Result Center bound to
 * this revision* rather than mutating anything here — adoption, adjustment and
 * delivery all run through the canonical command path (R-05 唯一写路径), and a
 * second write seam in the conversation is exactly the 第二套提交真相 the ADR
 * forbids.
 *
 * The binding is the point: `revision` comes from the terminal workflow.state
 * snapshot, so 「采用」 acts on the revision the server actually delivered. With
 * no confirmed revision the actions are withheld rather than guessed.
 */

import type {
  ContentPackageRevisionDelivery,
  CreationLensId,
} from '@meiye/contracts';
import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS } from './workbench-shell';
import {
  AI_COVER_BEAUTY_PRESETS,
  AI_COVER_PRESET_LABELS,
  DEFAULT_AI_COVER_PRESET,
  aiCoverAllowedOnSurface,
  listAiCoverRatioOptions,
  type AiCoverActionSeed,
  type AiCoverBeautyPreset,
} from './ai-cover-action';
import { ComposerDeliveryFollowUps } from './composer-delivery-followups';
import {
  ComposerDeliveryRatingBar,
  type DeliveryRatingAction,
  type DeliveryRatingVerdict,
} from './composer-delivery-rating-bar';
import type { DeliveryFollowUpSeed } from './delivery-followup-seeds';

/**
 * Which Result Center panel an entry opens, bound to the delivered revision.
 *
 * P1-07 / C7: `open` / primary card click = 进入对象工作区 gate.
 * `export` label is 「导出/发布准备」placeholder — no distribution contract (§4.9).
 */
export type ComposerDeliveryAction = 'adopt' | 'adjust' | 'export';

export type ComposerDeliveryOpenInput = {
  workId: string;
  taskId: string;
  action: ComposerDeliveryAction | 'open';
  revision: ContentPackageRevisionDelivery | null;
};

export type DeliveryRatingTransition = {
  action: DeliveryRatingAction;
  idempotencyKey: string;
  previousVerdict: DeliveryRatingVerdict | null;
  nextVerdict: DeliveryRatingVerdict | null;
};

const ACTION_LABELS: Record<ComposerDeliveryAction, string> = {
  adopt: '采用这一版',
  adjust: '继续调整',
  /** §4.9: export/publish-prep placeholder — does not promise distribution. */
  export: '导出/发布准备',
};

const ACTION_ORDER: ComposerDeliveryAction[] = ['adopt', 'adjust', 'export'];

export type ComposerDeliveryCardProps = {
  workId: string;
  taskId: string;
  revision: ContentPackageRevisionDelivery | null;
  /** 任务总结 as core wrote it — never re-worded here. */
  statement: string | null;
  onOpen: (input: ComposerDeliveryOpenInput) => void;
  /** 交付物自己的创作类型 — 后续动作 chip 按它取固定集合。 */
  lensId?: CreationLensId;
  /** 交付物已有的画幅 — 用来剔除已经成立的动作（横版图不再问要不要横版）。 */
  aspectRatio?: string;
  /**
   * 评价条出口。事件的组装与投递属适配层，这里连事件名都不知道 —— 卡片知道
   * 键名，#248 改一次就要改两处。
   */
  onRate?: (transition: DeliveryRatingTransition) => Promise<unknown> | unknown;
  /** 后续动作出口：把整句交出去预填 Composer，禁止在此提交。 */
  onFollowUp?: (seed: DeliveryFollowUpSeed) => void;
  /**
   * P2-11 / #323: AI cover secondary action. Prefills Composer with ratio +
   * beauty preset intent — same non-submit contract as follow-ups.
   */
  onAiCover?: (seed: AiCoverActionSeed) => void;
  className?: string;
};

export function ComposerDeliveryCard({
  workId,
  taskId,
  revision,
  statement,
  onOpen,
  lensId,
  aspectRatio,
  onRate,
  onFollowUp,
  onAiCover,
  className,
}: ComposerDeliveryCardProps) {
  const [verdict, setVerdict] = useState<DeliveryRatingVerdict | null>(null);
  const [ratingPending, setRatingPending] = useState(false);
  const [aiCoverOpen, setAiCoverOpen] = useState(false);
  const [aiCoverPreset, setAiCoverPreset] = useState<AiCoverBeautyPreset>(
    DEFAULT_AI_COVER_PRESET
  );
  const showAiCover =
    Boolean(onAiCover) &&
    aiCoverAllowedOnSurface({
      surface: 'delivered_secondary',
      lensId: lensId ?? null,
    });
  const aiCoverOptions = showAiCover
    ? listAiCoverRatioOptions({ style: aiCoverPreset })
    : [];
  const ratingPendingRef = useRef(false);
  const retryTransitionRef = useRef<{
    signature: string;
    idempotencyKey: string;
  } | null>(null);

  const handleRate = async (action: DeliveryRatingAction) => {
    if (ratingPendingRef.current) return;
    const nextVerdict =
      action === 'copy' ? verdict : verdict === action ? null : action;
    const signature = [action, verdict ?? 'none', nextVerdict ?? 'none'].join(
      ':'
    );
    const retry = retryTransitionRef.current;
    const idempotencyKey =
      retry?.signature === signature
        ? retry.idempotencyKey
        : crypto.randomUUID();
    retryTransitionRef.current = { signature, idempotencyKey };
    ratingPendingRef.current = true;
    setRatingPending(true);
    try {
      await onRate?.({
        action,
        idempotencyKey,
        previousVerdict: verdict,
        nextVerdict,
      });
      retryTransitionRef.current = null;
      if (action !== 'copy') {
        // The visible state is an acknowledgement of the canonical PG append.
        // A failed command leaves the previous verdict visible.
        setVerdict(nextVerdict);
      }
    } catch {
      // Feedback delivery must not break the delivery card or pretend success.
    } finally {
      ratingPendingRef.current = false;
      setRatingPending(false);
    }
  };

  return (
    <section
      className={cn(
        'meiye-porcelain rounded-2xl p-4',
        // Clear Active sticky Composer (z-30) so scrollIntoView / clicks land
        // on the card face, not the stuck prompt bar (P1-2 journey gate).
        WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS,
        className
      )}
      data-package-id={revision?.packageId}
      data-revision={revision?.revision}
      data-testid="composer-delivery-turn"
      data-version-id={revision?.versionId}
    >
      <button
        className="w-full text-left"
        // The container spec opens the Result Center by clicking the card
        // itself; that affordance keeps this id.
        data-testid="composer-delivery-card"
        data-work-id={workId}
        onClick={() => onOpen({ action: 'open', revision, taskId, workId })}
        type="button"
      >
        <p className="text-foreground text-sm font-medium">
          {revision ? `成品已就绪 · 第 ${revision.revision} 版` : '成品已就绪'}
        </p>
        {statement ? (
          // 任务总结 is a first-class delivery output (D-116: 策略依据/版本定位/
          // 使用建议), not card chrome — muted footnote type would make the one
          // thing the merchant is meant to read the hardest thing to read.
          <p
            className="text-foreground/80 mt-1.5 text-sm leading-relaxed"
            data-testid="composer-delivery-statement"
          >
            {statement}
          </p>
        ) : null}
        {/* C7: 成品卡 = 进入对象工作区的门 — explicit gate copy on the card face. */}
        <p
          className="text-muted mt-2 text-xs"
          data-testid="composer-delivery-object-workspace-gate"
        >
          进入对象工作区 · 点开看完整成品
        </p>
      </button>

      {/*
        评价条与 chip 组各自跟着自己的出口渲染，没有出口就不渲染：一个点了没有
        任何去处的按钮，与首版撤掉「更多」是同一条理由（PRODUCT.md:40）。评价条
        另外还要 revision —— 「这一版好不好用」在没有确认交付版本时无从谈起，与
        本卡对三动作的处置一致（宁可不给，不猜）。
      */}
      {revision && onRate ? (
        <ComposerDeliveryRatingBar
          disabled={ratingPending}
          onRate={(action) => void handleRate(action)}
          verdict={verdict}
        />
      ) : null}

      {lensId && onFollowUp ? (
        <ComposerDeliveryFollowUps
          aspectRatio={aspectRatio}
          lensId={lensId}
          onFollowUp={onFollowUp}
        />
      ) : null}

      {/* P2-11 / #323: Delivered secondary — AI cover with three selectable ratios. */}
      {showAiCover && onAiCover ? (
        <div
          className="mt-3 space-y-2"
          data-testid="composer-delivery-ai-cover"
        >
          <button
            aria-expanded={aiCoverOpen}
            className="rounded-full border border-border/60 bg-transparent px-3 py-2.5 text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            data-testid="composer-delivery-ai-cover-toggle"
            onClick={() => setAiCoverOpen((open) => !open)}
            type="button"
          >
            生成 AI 封面
          </button>
          {aiCoverOpen ? (
            <div className="space-y-2">
              <fieldset
                aria-label="AI 封面美业风格"
                className="flex flex-wrap gap-2"
                data-testid="composer-delivery-ai-cover-presets"
              >
                {AI_COVER_BEAUTY_PRESETS.map((preset) => (
                  <button
                    aria-pressed={aiCoverPreset === preset}
                    className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
                    data-preset={preset}
                    data-testid={`composer-delivery-ai-cover-preset-${preset}`}
                    key={preset}
                    onClick={() => setAiCoverPreset(preset)}
                    type="button"
                  >
                    {AI_COVER_PRESET_LABELS[preset]}
                  </button>
                ))}
              </fieldset>
              <fieldset
                aria-label="AI 封面比例"
                className="flex flex-wrap gap-2"
                data-testid="composer-delivery-ai-cover-ratios"
              >
                {aiCoverOptions.map((option) => (
                  <button
                    className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
                    data-aspect-ratio={option.aspectRatio}
                    data-size={option.size}
                    data-testid={`composer-delivery-ai-cover-ratio-${option.aspectRatio.replace(':', '-')}`}
                    key={option.aspectRatio}
                    onClick={() => {
                      onAiCover(option);
                      setAiCoverOpen(false);
                    }}
                    type="button"
                  >
                    {option.aspectRatio}
                  </button>
                ))}
              </fieldset>
            </div>
          ) : null}
        </div>
      ) : null}

      {revision ? (
        <div
          className="mt-3 flex flex-wrap gap-2"
          data-testid="composer-delivery-actions"
        >
          <button
            className="meiye-glass-piece rounded-full px-3 py-1 text-xs font-medium"
            data-testid="composer-delivery-action-object-workspace"
            onClick={() => onOpen({ action: 'open', revision, taskId, workId })}
            type="button"
          >
            进入对象工作区
          </button>
          {ACTION_ORDER.map((action) => (
            <button
              className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
              data-testid={`composer-delivery-action-${action}`}
              key={action}
              onClick={() => onOpen({ action, revision, taskId, workId })}
              type="button"
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
