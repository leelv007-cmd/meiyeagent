/**
 * 交付后续动作 chip 的静态种子 (D-164⑤).
 *
 * Mirror of the browser side only — same shape as lens-labels.ts and
 * launch-card-seeds.ts: no core import, and a later Surface/Recipe projection
 * may override this table at runtime once it carries follow-ups.
 *
 * 生成方式＝配方声明的固定集合，不由模型即时生成 (DECISIONS D4). 让模型在每次
 * 交付后再生成一轮 chip 文案，等于每条成品都多一次商家没请求、也看不见的规划
 * 消耗，正是 D-164⑥C 点名要消灭的那类；固定集合还让验收能逐字断言文案，模型
 * 即时生成的 chip 只能断言「有几个按钮」，那等于验收不覆盖内容。
 */

import type { CreationLensId } from '@meiye/contracts';

export type DeliveryFollowUpSeed = {
  /** 稳定 key，进 data-testid，不随文案变。 */
  id: string;
  /** chip 上的字 — 商家语言，祈使动词开头 (D-116)，主语省略。 */
  label: string;
  /** 点击后填进 Composer 的整句 — 不是 label，label 省了主语。 */
  intent: string;
  /** 交付物已是该比例时不出，避免「再出一版横版」出现在横版上。 */
  ratioNot?: string;
};

/**
 * D-164⑤ 原文「2–3 个」。剔除后不足两条时整组不渲染：宁可没有，也不出一个
 * 孤零零的 chip 让它看起来像唯一正解。
 */
export const DELIVERY_FOLLOWUP_MIN_VISIBLE = 2;

/**
 * D-164⑤ 给的三个示例是「换背景为深色版」「加上开业日期」「生成横版尺寸」。
 * 第三个的「尺寸」是参数词不是商家词，按 D-116 改写为「再出一版横版的」，语义
 * 一一对应，不新增也不减少。
 */
export const DELIVERY_FOLLOWUP_SEEDS: Readonly<
  Record<CreationLensId, readonly DeliveryFollowUpSeed[]>
> = {
  copy: [
    {
      id: 'shorter',
      intent: '这段再短一点，能一眼看完',
      label: '说得再短一点',
    },
    {
      id: 'warmer_tone',
      intent: '语气换得再热闹一点，像门店活动那样',
      label: '换个更热闹的语气',
    },
    {
      id: 'add_offer',
      intent: '结尾加一句到店福利，别写具体折扣数字',
      label: '加一句到店福利',
    },
  ],
  image_text: [
    {
      id: 'dark_background',
      intent: '这版底色换成深色的，其他都不动',
      label: '换成深色背景',
    },
    {
      id: 'add_open_date',
      intent: '图上把开业日期加进去',
      label: '加上开业日期',
    },
    {
      id: 'landscape_variant',
      intent: '同样内容再出一版横着的，发朋友圈封面用',
      label: '再出一版横版的',
      ratioNot: '16:9',
    },
  ],
  video: [
    {
      id: 'new_hook',
      intent: '开头三秒换一个更抓人的说法',
      label: '换个开头钩子',
    },
    {
      id: 'add_address',
      intent: '片尾把门店地址加上',
      label: '配上门店地址',
    },
    {
      id: 'portrait_variant',
      intent: '同样内容再出一版竖屏的',
      label: '出一版竖屏的',
      ratioNot: '9:16',
    },
  ],
};

/**
 * 本 lens 下该出的 chip。已经成立的动作剔掉（横版图上不再问要不要横版），
 * 剩下不足两条就整组不出。
 */
export function listDeliveryFollowUps(
  lensId: CreationLensId,
  aspectRatio?: string
): readonly DeliveryFollowUpSeed[] {
  const seeds = DELIVERY_FOLLOWUP_SEEDS[lensId].filter(
    (seed) => !(seed.ratioNot && seed.ratioNot === aspectRatio)
  );
  return seeds.length >= DELIVERY_FOLLOWUP_MIN_VISIBLE ? seeds : [];
}
