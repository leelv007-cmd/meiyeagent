import type {
  TodayRecommendation,
  TodayRecommendationState,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { IconArrowRight, IconSparkles } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  today_recommendation_cold_description,
  today_recommendation_cold_title,
  today_recommendation_customer_action,
  today_recommendation_facts,
  today_recommendation_facts_count,
  today_recommendation_source,
  today_recommendation_start,
  today_recommendation_stale_description,
  today_recommendation_stale_title,
  today_recommendation_title,
  today_recommendation_use,
  today_recommendation_use_description,
  today_recommendation_why,
} from '@/locale/paraglide/messages';
import { todayRecommendationIntent } from '@/product/creation-entry-model';
import { readDashboardHomeRecommendation } from '@/product/dashboard-home-recommendation';
import { HotTopicOpportunityCardView } from './hot-topic-opportunity-card';

export type TodayRecommendationView =
  | { kind: 'cold' }
  | { kind: 'stale' }
  | { kind: 'current'; recommendation: TodayRecommendation };

export function todayRecommendationView(
  state: TodayRecommendationState | undefined
): TodayRecommendationView {
  if (!state?.recommendation) {
    return { kind: state?.stale ? 'stale' : 'cold' };
  }
  return { kind: 'current', recommendation: state.recommendation };
}

export function TodayRecommendationCard({
  onStart,
  onUse,
}: {
  onStart: () => void;
  /** D-126: prefills the Composer draft — never auto-submits, never charges. */
  onUse: (intent: string) => void;
}) {
  const recommendation = useQuery({
    queryKey: ['harness', 'today-recommendation'],
    queryFn: ({ signal }) => readDashboardHomeRecommendation(signal),
    retry: false,
  });
  const view = todayRecommendationView(recommendation.data);

  return (
    <Card
      className="meiye-porcelain meiye-entry-card meiye-today-recommendation overflow-hidden"
      data-layer="base"
      data-testid="today-recommendation"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-foreground">
          <IconSparkles aria-hidden="true" className="size-4 text-spark" />
          <CardTitle
            aria-level={2}
            className="text-sm font-medium"
            role="heading"
          >
            {today_recommendation_title()}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {view.kind === 'current' ? (
          <CurrentRecommendation
            onUse={onUse}
            recommendation={view.recommendation}
          />
        ) : (
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">
              {view.kind === 'stale'
                ? today_recommendation_stale_title()
                : today_recommendation_cold_title()}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {view.kind === 'stale'
                ? today_recommendation_stale_description()
                : today_recommendation_cold_description()}
            </p>
            <Button onClick={onStart} size="sm" type="button" variant="outline">
              {today_recommendation_start()}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CurrentRecommendation({
  onUse,
  recommendation,
}: {
  onUse: (intent: string) => void;
  recommendation: TodayRecommendation;
}) {
  return (
    <article className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">{recommendation.title}</h3>
        <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">
          {recommendation.body}
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-muted/70 p-3">
          <dt className="font-medium">{today_recommendation_why()}</dt>
          <dd className="mt-1 text-muted-foreground">
            {recommendation.whyNow}
          </dd>
        </div>
        <div className="rounded-xl bg-muted/70 p-3">
          <dt className="font-medium">{today_recommendation_facts()}</dt>
          {/* D-116: fact references are internal ids — show the count, not them. */}
          <dd className="mt-1">
            <Badge variant="secondary">
              {today_recommendation_facts_count({
                count: recommendation.factReferences.length,
              })}
            </Badge>
          </dd>
        </div>
        <div className="rounded-xl bg-muted/70 p-3">
          <dt className="font-medium">
            {today_recommendation_customer_action()}
          </dt>
          <dd className="mt-1 text-muted-foreground">
            {recommendation.customerAction}
          </dd>
        </div>
      </dl>
      <HotTopicOpportunityCardView
        opportunity={recommendation.opportunity}
        presentation="compact"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button
            data-testid="today-recommendation-use"
            onClick={() => onUse(todayRecommendationIntent(recommendation))}
            size="sm"
            type="button"
          >
            {today_recommendation_use()}
            <IconArrowRight aria-hidden="true" />
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {today_recommendation_use_description()}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {today_recommendation_source()}：{recommendation.sourceLabel}
        </p>
      </div>
    </article>
  );
}
