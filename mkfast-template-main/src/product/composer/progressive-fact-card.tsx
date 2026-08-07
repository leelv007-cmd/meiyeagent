/**
 * Day-0 store-fact reminder on the idle Composer screen (#148 / W01, D-C4).
 *
 * This used to be the intake itself: an input, a 继续 button and a confirm that
 * emitted the finalize batch — a second thing to type into, sitting above the
 * Composer on the one screen DESIGN.md reserves for it («Composer 永远是唯一主
 * 轴，任何面板不与它竞争视觉重心»). Two boxes on the first screen made the
 * merchant choose which one the product actually wanted.
 *
 * So the capture moved to the two surfaces that own it — the store page's
 * five-step wizard and the in-flow questions after send — and what stays here is
 * one sentence naming the next gap plus the way to it. The model
 * (`progressive-fact.ts`) is untouched: the wizard runs the same projection and
 * the same `finalize_store_intake` command.
 */

import { Link } from '@tanstack/react-router';

import { buttonVariants } from '@/components/ui/button';
import {
  progressive_fact_address_label,
  progressive_fact_booking_label,
  progressive_fact_brand_voice_label,
  progressive_fact_city_label,
  progressive_fact_district_label,
  progressive_fact_industry_label,
  progressive_fact_name_label,
  progressive_fact_project_name_label,
  progressive_fact_project_price_label,
  progressive_fact_project_price_validity_label,
  progressive_fact_reminder,
  progressive_fact_reminder_action,
} from '@/locale/paraglide/messages';
import type { StoreFact, StoreProfile } from '@meiye/contracts';
import { useMemo } from 'react';

import {
  createProgressiveFactDraft,
  projectProgressiveFactView,
  type ProgressiveFactId,
} from './progressive-fact';

const LABELS: Record<ProgressiveFactId, () => string> = {
  name: progressive_fact_name_label,
  city: progressive_fact_city_label,
  projectName: progressive_fact_project_name_label,
  projectPrice: progressive_fact_project_price_label,
  projectPriceValidity: progressive_fact_project_price_validity_label,
  district: progressive_fact_district_label,
  industry: progressive_fact_industry_label,
  address: progressive_fact_address_label,
  booking: progressive_fact_booking_label,
  brandVoice: progressive_fact_brand_voice_label,
};

export type ProgressiveFactCardProps = {
  activeFacts: Array<Pick<StoreFact, 'factId' | 'revision'>>;
  store?: StoreProfile;
};

export function ProgressiveFactCard({
  activeFacts,
  store,
}: ProgressiveFactCardProps) {
  const view = useMemo(
    () =>
      projectProgressiveFactView(
        createProgressiveFactDraft(store, activeFacts)
      ),
    [activeFacts, store]
  );
  const current = view.current;
  if (!current) return null;

  return (
    // 白瓷实底，不是 `bg-muted/NN`：`--muted` 在商家壳里是 --tint-hover（4%/6% 的
    // 底色 token），再乘一次 alpha 就归零——那样这行字压的是页面底下的任何东西。
    <div
      className="meiye-porcelain rounded-2xl p-4"
      data-testid="progressive-fact-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          className="min-w-0 flex-1 text-sm text-foreground"
          data-testid="progressive-fact-reminder"
        >
          {progressive_fact_reminder({ fact: LABELS[current.id]() })}
        </p>
        <Link
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          data-testid="progressive-fact-store-link"
          to="/dashboard/store"
        >
          {progressive_fact_reminder_action()}
        </Link>
      </div>
    </div>
  );
}
