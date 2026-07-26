import type { LeadStatus } from '@meiye/contracts';

/**
 * DESIGN.md §5「规范化状态标签」tones for the lead ledger (T33 / #227).
 *
 * ProductStatus covers the creation pipeline vocabulary only, so the ledger
 * carries its own five-tone mapping rather than teaching that shared component
 * a second domain. Colours are the DESIGN.md §2 Tertiary values, quoted the way
 * components/uiux/product-status.tsx quotes them, in both themes.
 */
const toneClassName = {
  neutral:
    'bg-[oklch(0.42_0_0/0.06)] text-[oklch(0_0_0/0.7)] dark:bg-[oklch(1_0_0/0.08)] dark:text-[oklch(1_0_0/0.78)]',
  progress:
    'bg-[oklch(0.5_0.19_262/0.1)] text-[oklch(0.4_0.16_262)] dark:bg-[oklch(0.5_0.19_262/0.18)] dark:text-[oklch(0.82_0.08_262)]',
  success:
    'bg-[oklch(0.53_0.14_150/0.1)] text-[oklch(0.4_0.12_150)] dark:bg-[oklch(0.53_0.14_150/0.18)] dark:text-[oklch(0.82_0.08_150)]',
  warning:
    'bg-[oklch(0.55_0.13_85/0.12)] text-[oklch(0.42_0.11_85)] dark:bg-[oklch(0.55_0.13_85/0.18)] dark:text-[oklch(0.88_0.08_85)]',
  danger:
    'bg-[oklch(0.55_0.2_27/0.1)] text-[oklch(0.45_0.16_27)] dark:bg-[oklch(0.55_0.2_27/0.18)] dark:text-[oklch(0.84_0.1_27)]',
} as const;

const leadStatusTone: Record<LeadStatus, keyof typeof toneClassName> = {
  booked: 'success',
  contacted: 'progress',
  invalid: 'neutral',
  lost: 'warning',
  new: 'neutral',
  redeemed: 'success',
};

export function leadStatusToneClassName(status: LeadStatus) {
  return `inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${toneClassName[leadStatusTone[status]]}`;
}
