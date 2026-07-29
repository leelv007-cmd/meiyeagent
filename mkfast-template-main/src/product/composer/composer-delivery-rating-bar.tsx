/**
 * 成品评价条 (D-160③ ＋ D-164⑤).
 *
 * 紧贴文案末尾的三个纯图标动作。它是独立组件而不是 ComposerDeliveryCard 的内联
 * 片段，因为卡里的文案整块包在一个 `<button>` 里（整卡点击＝开结果中心）——
 * 按钮不能嵌套，内层点击也会冒泡上去，点赞会连带打开结果中心。渲染在那个
 * `</button>` 之后，是「文案末尾」在视觉上仍可达的最近位置。
 *
 * 本组件不持有任何副作用：复制的剪贴板写入、评价事件的组装与投递都在它之上做
 * （与 composer-delivery-card.tsx 头部的 R-05 唯一写路径同纪律）。它只报告
 * 「谁点了哪个」——让它知道三轴版本值或事件名，就等于让一个展示件成为事件合同的
 * 第二个知情方。
 *
 * D-160③ 定的是四动作（复制／点赞／点踩／更多，顺序即 Miora 实测顺序），四条一条
 * 未撤，但**首版只渲染前三个**：「更多」在本仓无任何下游菜单，渲染一个点了没东西
 * 的按钮撞 PRODUCT.md:40「警惕无载体的想象功能」与 spec
 * docs/specs/agent-substrate-dev-spec-2026-07-29.md:509「断言不再渲染无下游的可点
 * 元素」（裁定 docs/tickets/261/08-reconciliation.md M6）。第四动作等它真有下游时
 * 由后续票补，届时不必动既有三项。
 */

import { IconCopy, IconThumbDown, IconThumbUp } from '@tabler/icons-react';

import {
  delivery_rating_copy_aria,
  delivery_rating_down_aria,
  delivery_rating_down_done,
  delivery_rating_group_aria,
  delivery_rating_up_aria,
  delivery_rating_up_done,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';

export type DeliveryRatingAction = 'copy' | 'up' | 'down';

/** 顺序即 D-160③ 的实测顺序；补第四动作时在末尾追加。 */
export const DELIVERY_RATING_ORDER: readonly DeliveryRatingAction[] = [
  'copy',
  'up',
  'down',
];

/** 表达过的态度；同一版只保留一个。 */
export type DeliveryRatingVerdict = 'up' | 'down';

const RATING_ICONS = {
  copy: IconCopy,
  down: IconThumbDown,
  up: IconThumbUp,
} as const;

/** 纯图标按钮必须有可读名，所以三条 aria-label 走 paraglide 而不是源码常量。 */
const RATING_ARIA_LABELS: Record<DeliveryRatingAction, () => string> = {
  copy: delivery_rating_copy_aria,
  down: delivery_rating_down_aria,
  up: delivery_rating_up_aria,
};

export type ComposerDeliveryRatingBarProps = {
  /** 已表达过的态度；再点同一个＝撤回（撤回语义由上层记，本组件只显示）。 */
  verdict: DeliveryRatingVerdict | null;
  /** 唯一出口。 */
  onRate: (action: DeliveryRatingAction) => void;
  className?: string;
};

export function ComposerDeliveryRatingBar({
  verdict,
  onRate,
  className,
}: ComposerDeliveryRatingBarProps) {
  return (
    // fieldset 是表单字段的分组，会带出 legend 并把三个独立按钮播报成一组待填
    // 控件；这里只要给纯图标行一个可读的组名。outcome-chips-panel.tsx 用 fieldset
    // 是因为那真是一组记账表单动作，语义不同。
    // biome-ignore lint/a11y/useSemanticElements: 三个独立按钮不是表单字段分组
    <div
      aria-label={delivery_rating_group_aria()}
      // 44px 命中区自带约 15px 内白，负横边距把光学左缘拉回正文左缘，否则这一行
      // 读起来比正文块还宽；上边距同理只留 mt-0.5，视觉上仍是「紧贴文案末尾」
      // （对比现有动作行的 mt-3）。
      className={cn('-mx-2.5 mt-0.5 flex', className)}
      data-testid="composer-delivery-rating"
      role="group"
    >
      {DELIVERY_RATING_ORDER.map((action) => {
        const Icon = RATING_ICONS[action];
        const pressed = action !== 'copy' ? verdict === action : undefined;
        return (
          <button
            aria-label={RATING_ARIA_LABELS[action]()}
            // 切换态按钮的标准表达；比点击后换 label 稳，读屏用户听到的名字不变。
            aria-pressed={pressed}
            className={cn(
              // 墨量与命中区分开：图标 size-3.5 比卡内正文还小一档（「轻到可忽略」），
              // 命中区仍是 DESIGN.md:192 的 44px 硬底线。Ghost ＝透明底 ＋ tint-hover
              // 悬停痕（DESIGN.md:195 行内三级动作）；`bg-muted` 就是 --tint-hover
              // （styles.css:234 把 --muted 映到它）。只过渡颜色不触发布局，
              // 150ms 落在 DESIGN.md:227 区间下限。
              'inline-flex size-11 items-center justify-center rounded-full outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              pressed ? 'text-foreground' : 'text-muted-foreground/60'
            )}
            data-testid={`composer-delivery-rating-${action}`}
            key={action}
            onClick={() => onRate(action)}
            type="button"
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
      {/*
        视觉反馈只有图标变色，不弹 toast — D-164⑤ 要的是「服务系统质量信号，
        不打扰商家」。读屏用户看不见颜色，所以给一条不占版面的播报。
      */}
      <p aria-live="polite" className="sr-only">
        {verdict === 'up' ? delivery_rating_up_done() : null}
        {verdict === 'down' ? delivery_rating_down_done() : null}
      </p>
    </div>
  );
}
