import type {
  ContentPackageDeliveryEvent,
  ContentPackagePlatform,
  ContentPackageResultSignal,
} from '@meiye/contracts';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  content_package_result_action_change_cta,
  content_package_result_action_change_platform,
  content_package_result_action_continue,
  content_package_result_action_stop,
  content_package_result_inferred_disclaimer,
  content_package_result_ladder_appointment,
  content_package_result_ladder_attention,
  content_package_result_ladder_consultation,
  content_package_result_ladder_published,
  content_package_result_ladder_redeemed,
  content_package_result_ladder_title,
  content_package_result_signal_appointment,
  content_package_result_signal_private_message,
  content_package_result_signal_redeemed,
  content_package_result_signal_store_visit,
  content_package_result_signal_voucher_purchased,
  content_package_result_signal_wechat_added,
  content_package_result_source_inferred,
  content_package_result_source_merchant,
  content_package_result_source_verified,
  content_package_result_title,
  content_package_result_verified_empty,
  content_package_result_weekly_next,
  content_package_result_weekly_next_answer,
  content_package_result_weekly_observed,
  content_package_result_weekly_published,
  content_package_result_weekly_title,
  content_package_platform_video_account,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
} from '@/locale/paraglide/messages';

export interface ContentPackageResultsProjection {
  ladder: Array<{
    id:
      | 'published'
      | 'attention'
      | 'consultation'
      | 'appointment_or_purchase'
      | 'redeemed_or_visited';
    reached: boolean;
  }>;
  signals: {
    inferred: ContentPackageResultSignal[];
    merchant: ContentPackageResultSignal[];
    verified: ContentPackageResultSignal[];
  };
}

export interface ContentPackageWeeklyResultReviewProjection {
  nextExperiments: Array<{
    actions: Array<
      'change_cta' | 'change_platform' | 'continue_series' | 'stop_series'
    >;
    packageId: string;
    nextTest: 'repeat_or_change_cta';
  }>;
  observed: Array<{
    packageId: string;
    signal: ContentPackageResultSignal;
  }>;
  published: Array<{
    event: ContentPackageDeliveryEvent;
    packageId: string;
  }>;
}

const SIGNAL_LABELS: Record<ContentPackageResultSignal['kind'], () => string> =
  {
    attention: content_package_result_ladder_attention,
    appointment: content_package_result_signal_appointment,
    contact_added: content_package_result_signal_wechat_added,
    inquiry: content_package_result_signal_private_message,
    private_message: content_package_result_signal_private_message,
    redeemed: content_package_result_signal_redeemed,
    redemption: content_package_result_signal_redeemed,
    store_visit: content_package_result_signal_store_visit,
    voucher_purchase: content_package_result_signal_voucher_purchased,
    voucher_purchased: content_package_result_signal_voucher_purchased,
    wechat_added: content_package_result_signal_wechat_added,
  };

const LADDER_LABELS: Record<
  ContentPackageResultsProjection['ladder'][number]['id'],
  () => string
> = {
  appointment_or_purchase: content_package_result_ladder_appointment,
  attention: content_package_result_ladder_attention,
  consultation: content_package_result_ladder_consultation,
  published: content_package_result_ladder_published,
  redeemed_or_visited: content_package_result_ladder_redeemed,
};

function platformLabel(platform: ContentPackagePlatform) {
  if (platform === 'xiaohongshu') return creation_entry_platform_xiaohongshu();
  if (platform === 'douyin') return creation_entry_platform_douyin();
  return content_package_platform_video_account();
}

export function ContentPackageResults({
  packageId,
  onRecord,
  onReviewAction,
  pending = false,
  results,
  weeklyReview,
}: {
  packageId: string;
  onRecord(kind: ContentPackageResultSignal['kind']): void;
  onReviewAction(
    action: 'change_cta' | 'change_platform' | 'continue_series' | 'stop_series'
  ): void;
  pending?: boolean;
  results?: ContentPackageResultsProjection;
  weeklyReview?: ContentPackageWeeklyResultReviewProjection;
}) {
  const recordingEnabled =
    results?.ladder.find((step) => step.id === 'published')?.reached === true;
  const published = (weeklyReview?.published ?? []).filter(
    (item) => item.packageId === packageId
  );
  const observed = (weeklyReview?.observed ?? []).filter(
    (item) => item.packageId === packageId
  );
  const nextExperiment = weeklyReview?.nextExperiments.find(
    (item) => item.packageId === packageId
  );
  return (
    <section
      aria-labelledby="content-package-results-title"
      className="space-y-4"
    >
      <h3 className="font-medium" id="content-package-results-title">
        {content_package_result_title()}
      </h3>
      <div className="flex flex-wrap gap-2">
        {Object.entries(SIGNAL_LABELS).map(([kind, label]) => (
          <Button
            disabled={pending || !recordingEnabled}
            key={kind}
            onClick={() => onRecord(kind as ContentPackageResultSignal['kind'])}
            size="sm"
            type="button"
            variant="outline"
          >
            {label()}
          </Button>
        ))}
      </div>
      <SignalGroup
        empty={content_package_result_verified_empty()}
        label={content_package_result_source_verified()}
        signals={results?.signals.verified ?? []}
        tone="verified"
      />
      <SignalGroup
        label={content_package_result_source_merchant()}
        signals={results?.signals.merchant ?? []}
        tone="merchant"
      />
      <SignalGroup
        description={content_package_result_inferred_disclaimer()}
        label={content_package_result_source_inferred()}
        signals={results?.signals.inferred ?? []}
        tone="inferred"
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {content_package_result_ladder_title()}
        </p>
        <div className="flex flex-wrap gap-2" data-result-ladder>
          {(results?.ladder ?? []).map((step) => (
            <Badge
              data-ladder-step={step.id}
              data-reached={String(step.reached)}
              key={step.id}
              variant={step.reached ? 'secondary' : 'outline'}
            >
              {LADDER_LABELS[step.id]()}
            </Badge>
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-md border border-divider p-3">
        <p className="font-medium">{content_package_result_weekly_title()}</p>
        <WeeklyAnswer label={content_package_result_weekly_published()}>
          {published.length === 0
            ? '—'
            : published.map(({ event }) => (
                <span key={event.id}>
                  {platformLabel(event.platform)} ·{' '}
                  {event.occurredAt.slice(0, 10)}
                </span>
              ))}
        </WeeklyAnswer>
        <WeeklyAnswer label={content_package_result_weekly_observed()}>
          {observed.length === 0
            ? '—'
            : observed.map(({ signal }) => (
                <span key={signal.id}>{SIGNAL_LABELS[signal.kind]()}</span>
              ))}
        </WeeklyAnswer>
        <WeeklyAnswer label={content_package_result_weekly_next()}>
          {nextExperiment ? content_package_result_weekly_next_answer() : '—'}
        </WeeklyAnswer>
        {nextExperiment ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => onReviewAction('continue_series')}
              size="sm"
              type="button"
            >
              {content_package_result_action_continue()}
            </Button>
            <Button
              onClick={() => onReviewAction('change_cta')}
              size="sm"
              type="button"
              variant="outline"
            >
              {content_package_result_action_change_cta()}
            </Button>
            <Button
              onClick={() => onReviewAction('change_platform')}
              size="sm"
              type="button"
              variant="outline"
            >
              {content_package_result_action_change_platform()}
            </Button>
            <Button
              onClick={() => onReviewAction('stop_series')}
              size="sm"
              type="button"
              variant="ghost"
            >
              {content_package_result_action_stop()}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function WeeklyAnswer({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2 text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function SignalGroup({
  description,
  empty,
  label,
  signals,
  tone,
}: {
  description?: string;
  empty?: string;
  label: string;
  signals: ContentPackageResultSignal[];
  tone: 'inferred' | 'merchant' | 'verified';
}) {
  return (
    <div className="space-y-1" data-signal-source={tone}>
      <p className="text-sm font-medium">{label}</p>
      {signals.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty ?? '—'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {signals.map((signal) => (
            <Badge
              key={signal.id}
              variant={tone === 'verified' ? 'secondary' : 'outline'}
            >
              {SIGNAL_LABELS[signal.kind]()} {signal.quantity ?? ''}
            </Badge>
          ))}
        </div>
      )}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
