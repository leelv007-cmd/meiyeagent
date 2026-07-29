/**
 * 交付后续动作 chip 组 (D-164⑤ 后半).
 *
 * 评价条说的是「这一版怎么样」，这一组说的是「对下一版做什么」——两件事，所以
 * 独立成组而不是接在评价条后面。
 *
 * 点击只把整句交给上层预填 Composer，**不提交**（D-164⑤ ＋ D-126 ＋ Miora 实证
 * 三方同向：让商家看见将要发生什么，再由他按发送）。本组件因此不持有任何副作用，
 * 也不复用交付卡的 onOpen——那条路通向结果中心，不是创作输入。
 *
 * 与卡底既有三动作（采用／继续调整／导出）不加可见小标题来区分：加「接下来：」
 * 一行会把卡从三段读成四段，且一行冒号标题正是 D-116 要避开的说明书骨架。可见的
 * 区分交给动词短句 vs 判定短语、ghost 发丝线 vs glass 药丸两层；语义区分交给
 * role="group" 的 aria-label。
 */

import { delivery_followup_group_aria } from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import type { CreationLensId } from '@meiye/contracts';

import {
  type DeliveryFollowUpSeed,
  listDeliveryFollowUps,
} from './delivery-followup-seeds';

export type ComposerDeliveryFollowUpsProps = {
  /** 交付物自己的创作类型 — chip 集合按它分档。 */
  lensId: CreationLensId;
  /** 交付物已有的画幅，用来剔除已经成立的动作。 */
  aspectRatio?: string;
  /** 唯一出口：把 seed 交出去，由上层写进 Composer 草稿并取焦。 */
  onFollowUp: (seed: DeliveryFollowUpSeed) => void;
  className?: string;
};

export function ComposerDeliveryFollowUps({
  lensId,
  aspectRatio,
  onFollowUp,
  className,
}: ComposerDeliveryFollowUpsProps) {
  const seeds = listDeliveryFollowUps(lensId, aspectRatio);
  if (seeds.length === 0) return null;

  return (
    // 同 composer-delivery-rating-bar：这不是一组表单字段，fieldset 的 legend 会把
    // 它读成待填控件。组名只用来跟卡底那组「对这一版」的动作分开。
    // biome-ignore lint/a11y/useSemanticElements: 一组独立按钮不是表单字段分组
    <div
      aria-label={delivery_followup_group_aria()}
      className={cn('mt-3 flex flex-wrap gap-2', className)}
      data-testid="composer-delivery-followups"
      role="group"
    >
      {seeds.map((seed) => (
        <button
          // Ghost 药丸：透明底 ＋ 1px 发丝线 ＋ tint-hover 悬停痕
          // （DESIGN.md:195 行内三级动作），与卡底 glass 药丸分层。py-2.5 让整粒
          // 实高够 DESIGN.md:192 的 44px 触屏命中，不靠伪元素扩张——gap-2 下多行
          // chip 的间距已经足，44px 实高不显笨重，也省掉伪元素的调试成本。
          className="rounded-full border border-border/60 bg-transparent px-3 py-2.5 text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          data-testid={`composer-delivery-followup-${seed.id}`}
          key={seed.id}
          onClick={() => onFollowUp(seed)}
          type="button"
        >
          {seed.label}
        </button>
      ))}
    </div>
  );
}
