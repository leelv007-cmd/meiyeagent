/**
 * Idle light-capsule suggestion row — xhs-spec §2.4 / D2 (#318).
 *
 * Default face is a horizontal capsule row (今日建议 first, highlighted when
 * current; 小红书图文 / 爆款复刻 on the first screen). Opening 今日建议 reveals
 * the three-element mini card (why / store facts / customer action). Every
 * chip only prefills the Composer — never auto-submits, never charges (C3).
 *
 * Cold / pending / stale stay honest one-line chips, never a full empty card
 * competing with the Composer for visual weight.
 */

import {
  STORE_FACT_KIND_LABELS,
  type CreativeJob,
  type CreativeWork,
  type CreativeWorkbenchProjection,
  type StoreFact,
  type TodayRecommendation,
  type TodayRecommendationState,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { IconArrowRight, IconSparkles } from '@tabler/icons-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  today_recommendation_cold_description,
  today_recommendation_cold_title,
  today_recommendation_customer_action,
  today_recommendation_facts,
  today_recommendation_facts_count,
  today_recommendation_pending_description,
  today_recommendation_pending_title,
  today_recommendation_source,
  today_recommendation_start,
  today_recommendation_stale_description,
  today_recommendation_stale_title,
  today_recommendation_title,
  today_recommendation_use,
  today_recommendation_use_description,
  today_recommendation_why,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { readDashboardHomeRecommendation } from '@/product/dashboard-home-recommendation';
import {
  IDLE_FIRST_SCREEN_RECIPE_CHIPS,
  todaySuggestionChipLabel,
} from '@/product/idle-suggestion-chips';
import {
  buildRecommendationHandoff,
  type RecommendationHandoff,
} from '@/product/recommendation-handoff';
import { HotTopicOpportunityCardView } from './hot-topic-opportunity-card';

/** Fact references are minted as `store_fact:<factId>:<revision>` (core production-context-port.ts:664). */
const STORE_FACT_REFERENCE_PATTERN = /^store_fact:(.+):\d+$/u;
/** Ledger keys, ids and slugs are never merchant language (D-116). */
const INTERNAL_NAME_PATTERN =
  /(?:^[a-z][a-z0-9_]*:[a-z0-9]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu;
/** Merchants write Chinese; a Han character is the strongest signal of it. */
const HAN_PATTERN = /\p{Script=Han}/u;
/** Only machines join words with these — merchant copy never carries them. */
const MACHINE_PUNCTUATION_PATTERN = /[:_/\\]/u;
/** Punctuation and spaces delimit machine-token candidates in Chinese text. */
const ASCII_ALPHANUMERIC_TOKEN_PATTERN = /[0-9A-Za-z]+/gu;
const LATIN_LETTER_PATTERN = /[A-Za-z]/u;
/** Latin admission requires 2+ words separated by spaces or apostrophes. */
const NATURAL_LATIN_NAME_PATTERN = /^[A-Za-z]+(?:[ '][A-Za-z]+)+$/u;
/** `deadbeef` reads as a word but is a hex digest; all-caps reads as a code. */
const HEX_DIGEST_PATTERN = /^[0-9a-f]{6,}$/iu;
const LOWERCASE_LETTER_PATTERN = /[a-z]/u;
const READABLE_NAME_KEYS = ['name', 'title', 'label'] as const;
const MAX_FACT_LABELS = 6;
const MAX_FACT_NAME_LENGTH = 24;
/** A Work counts as produced only after it reached a finished state. */
const PRODUCED_WORK_STATUSES = new Set<CreativeWork['status']>([
  'completed',
  'accepted',
]);

export type TodayRecommendationView =
  | { kind: 'cold' }
  | { kind: 'pending' }
  | { kind: 'stale' }
  | { kind: 'current'; recommendation: TodayRecommendation };

/**
 * W04: a degraded projection must not disguise itself as a cold start. A
 * workspace that has already produced work is never told it produced nothing —
 * it is told the recommendation itself did not come out.
 */
export function todayRecommendationView(
  state: TodayRecommendationState | undefined,
  workspaceHasWork = false
): TodayRecommendationView {
  if (!state?.recommendation) {
    if (state?.stale) return { kind: 'stale' };
    return { kind: workspaceHasWork ? 'pending' : 'cold' };
  }
  return { kind: 'current', recommendation: state.recommendation };
}

/**
 * W04 「用了本店什么」: name the facts instead of counting them. Names come from
 * the merchant's own active fact ledger, matched by factId; a reference with no
 * live fact behind it contributes to the count only — internal ids, ledger keys
 * and values shaped like identifiers never reach the card.
 */
export function recommendationFactLabels(
  references: readonly string[],
  facts: readonly StoreFact[] | undefined
): string[] {
  if (!facts?.length) return [];
  const byFactId = new Map(facts.map((fact) => [fact.factId, fact]));
  const labels: string[] = [];
  for (const reference of references) {
    const factId = STORE_FACT_REFERENCE_PATTERN.exec(reference)?.[1];
    const fact = factId ? byFactId.get(factId) : undefined;
    if (!fact) continue;
    // Fail-closed: a kind outside the shipped label whitelist (a newer core, a
    // corrupted row) contributes to the count only — the card never renders
    // `undefined·名称`, and never hands React a non-string child.
    const kindLabel = storeFactKindLabel(fact.kind);
    if (!kindLabel) continue;
    const name = readableFactName(fact.value);
    const label = name ? `${kindLabel}·${name}` : kindLabel;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, MAX_FACT_LABELS);
}

/** Only the kinds this build ships a merchant word for may be spoken aloud. */
function storeFactKindLabel(kind: StoreFact['kind']): string | undefined {
  return Object.hasOwn(STORE_FACT_KIND_LABELS, kind)
    ? STORE_FACT_KIND_LABELS[kind]
    : undefined;
}

/**
 * D-116 fail-closed: a fact value reaches the card only when it *looks like*
 * merchant language. Admission is a whitelist — anything that cannot be proven
 * human-readable degrades to the kind label, which is always safe. Over-
 * rejecting a real name costs the merchant one word; under-rejecting leaks an
 * internal id into the storefront.
 */
function readableFactName(value: StoreFact['value']) {
  const candidate =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && !Array.isArray(value)
        ? READABLE_NAME_KEYS.map(
            (key) => (value as Record<string, unknown>)[key]
          ).find((entry) => typeof entry === 'string')
        : undefined;
  const name = typeof candidate === 'string' ? candidate.trim() : '';
  if (!name || name.length > MAX_FACT_NAME_LENGTH) return undefined;
  // Fast path: the two id shapes the ledger is known to mint.
  if (INTERNAL_NAME_PATTERN.test(name)) return undefined;
  // No merchant types a colon, underscore or slash into a service name.
  if (MACHINE_PUNCTUATION_PATTERN.test(name)) return undefined;
  if (HAN_PATTERN.test(name)) {
    // In Chinese text, reject each punctuation/space-delimited ASCII token when
    // it is 4+ characters and carries a letter. Numeric prices remain readable.
    const carriesMachineToken = (
      name.match(ASCII_ALPHANUMERIC_TOKEN_PATTERN) ?? []
    ).some((token) => token.length >= 4 && LATIN_LETTER_PATTERN.test(token));
    return carriesMachineToken ? undefined : name;
  }
  // Latin-only values must contain 2+ plain words: no digits, no glue, no
  // single-token machine strings, and no all-caps codes.
  return NATURAL_LATIN_NAME_PATTERN.test(name) &&
    LOWERCASE_LETTER_PATTERN.test(name) &&
    !HEX_DIGEST_PATTERN.test(name)
    ? name
    : undefined;
}

/**
 * Work in hand means *produced*, not *attempted*. A submitted-then-failed job
 * leaves rows behind but nothing the merchant can hold; telling that workspace
 * "today's pick did not come out" would imply a history it does not have. Only
 * finished output breaks the cold start.
 */
export function workbenchHasWork(
  workbench: CreativeWorkbenchProjection | undefined
) {
  if (!workbench) return false;
  return (
    workbench.assets.length > 0 ||
    workbench.contents.length > 0 ||
    workbench.works.some((work) => PRODUCED_WORK_STATUSES.has(work.status)) ||
    workbench.jobs.some(jobHasOutput)
  );
}

/** uiux.ts CreativeJob: outputs are the only proof a job produced anything. */
function jobHasOutput(job: CreativeJob) {
  return (
    (job.outputAssetIds?.length ?? 0) > 0 ||
    (job.outputContentIds?.length ?? 0) > 0
  );
}

const CAPSULE_BASE =
  'inline-flex min-h-12 max-w-full items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none';

export function TodayRecommendationCard({
  onStart,
  onUse,
  workspaceId,
}: {
  onStart: () => void;
  /**
   * D-126 / P0-4: typed handoff prefills the Composer draft — never auto-submits,
   * never charges. Carries optional outputHint; absent hint must not force copy.
   */
  onUse: (handoff: RecommendationHandoff) => void;
  workspaceId?: string;
}) {
  const [todayOpen, setTodayOpen] = useState(false);
  const recommendation = useQuery({
    queryKey: ['harness', 'today-recommendation'],
    queryFn: ({ signal }) => readDashboardHomeRecommendation(signal),
    retry: false,
  });
  const workbench = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    retry: false,
  });
  const view = todayRecommendationView(
    recommendation.data,
    workbenchHasWork(workbench.data)
  );

  return (
    <div
      className="meiye-today-recommendation space-y-3"
      data-layer="base"
      data-recommendation-state={view.kind}
      data-suggestion-capsules="true"
      data-testid="today-recommendation"
    >
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="suggestion-capsule-row"
      >
        {view.kind === 'current' ? (
          <button
            aria-expanded={todayOpen}
            className={cn(
              CAPSULE_BASE,
              // Primary highlight chip for 今日建议 (D2).
              'border-primary/40 bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20',
              todayOpen && 'ring-2 ring-primary/40'
            )}
            data-highlight="true"
            data-testid="suggestion-chip-today"
            onClick={() => setTodayOpen((open) => !open)}
            type="button"
          >
            <IconSparkles
              aria-hidden="true"
              className="size-3.5 shrink-0 text-spark"
            />
            <span className="truncate">
              {todaySuggestionChipLabel(view.recommendation.title)}
            </span>
          </button>
        ) : (
          // Empty chips focus the composer directly; honest title/CTA sit below.
          <button
            className={cn(
              CAPSULE_BASE,
              'border-input bg-background text-muted-foreground hover:bg-accent'
            )}
            data-highlight="false"
            data-testid="suggestion-chip-today"
            onClick={onStart}
            type="button"
          >
            <IconSparkles aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{emptyChipLabel(view.kind)}</span>
          </button>
        )}

        {IDLE_FIRST_SCREEN_RECIPE_CHIPS.map((chip) => (
          <button
            className={cn(
              CAPSULE_BASE,
              'border-input bg-background text-foreground hover:bg-accent'
            )}
            data-recipe-chip={chip.id}
            data-testid={`suggestion-chip-${chip.id}`}
            key={chip.id}
            onClick={() => onUse(chip.handoff)}
            type="button"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {view.kind === 'current' && todayOpen ? (
        <TodayMiniCard
          onUse={onUse}
          recommendation={view.recommendation}
          workspaceId={workspaceId}
        />
      ) : null}

      {/*
        Empty states always show honest h3 + start CTA (W04 hard gate). Only
        the heavy *current* recommendation collapses behind the highlight chip.
      */}
      {view.kind !== 'current' ? (
        <EmptyRecommendationPanel kind={view.kind} onStart={onStart} />
      ) : null}
    </div>
  );
}

function emptyChipLabel(kind: 'cold' | 'pending' | 'stale') {
  // Honest state titles on the chip face (not the generic strip title).
  if (kind === 'stale') return today_recommendation_stale_title();
  return kind === 'pending'
    ? today_recommendation_pending_title()
    : today_recommendation_cold_title();
}

function emptyDescription(kind: 'cold' | 'pending' | 'stale') {
  if (kind === 'stale') return today_recommendation_stale_description();
  return kind === 'pending'
    ? today_recommendation_pending_description()
    : today_recommendation_cold_description();
}

/**
 * Expanded empty face: honest h3 title + start CTA (W04 / e2e contract).
 * Keeps the action-oriented 「开始下一次任务」accessible name.
 */
function EmptyRecommendationPanel({
  kind,
  onStart,
}: {
  kind: 'cold' | 'pending' | 'stale';
  onStart: () => void;
}) {
  return (
    <div
      className="meiye-porcelain space-y-2 rounded-2xl border border-border/60 p-4"
      data-testid="today-recommendation-empty-panel"
    >
      <h3 className="text-base font-semibold leading-6">
        {emptyChipLabel(kind)}
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">
        {emptyDescription(kind)}
      </p>
      <Button
        data-testid="today-recommendation-start"
        onClick={onStart}
        size="sm"
        type="button"
        variant="outline"
      >
        {today_recommendation_start()}
      </Button>
    </div>
  );
}

/**
 * Three-element mini card revealed by the 今日建议 capsule (D2 / D-126).
 * Compact porcelain — not the former full entry card that competed with Composer.
 */
function TodayMiniCard({
  onUse,
  recommendation,
  workspaceId,
}: {
  onUse: (handoff: RecommendationHandoff) => void;
  recommendation: TodayRecommendation;
  workspaceId?: string;
}) {
  const [factsAsOf] = useState(() => new Date().toISOString());
  const factsPayload = {
    scope: { storeId: workspaceId ?? '' },
    at: factsAsOf,
  };
  const facts = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: p1QueryKeys.request(
      'context',
      'store_facts_active',
      factsPayload
    ),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        { action: 'store_facts_active', payload: factsPayload },
        signal
      ),
    retry: false,
  });
  const factLabels = recommendationFactLabels(
    recommendation.factReferences,
    facts.data
  );

  return (
    <article
      className="meiye-porcelain space-y-4 rounded-2xl border border-border/60 p-4"
      data-testid="today-recommendation-mini-card"
    >
      <div>
        <h3 className="text-base font-semibold leading-6">
          {recommendation.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
          {recommendation.body}
        </p>
      </div>
      <dl
        className="grid gap-2 text-sm sm:grid-cols-3"
        data-testid="today-recommendation-three-elements"
      >
        <div className="rounded-xl bg-muted p-2.5">
          <dt className="text-xs font-medium">{today_recommendation_why()}</dt>
          <dd className="mt-1 text-muted-foreground">
            {recommendation.whyNow}
          </dd>
        </div>
        <div className="rounded-xl bg-muted p-2.5">
          <dt className="text-xs font-medium">
            {today_recommendation_facts()}
          </dt>
          <dd
            className="mt-1 space-y-1"
            data-testid="today-recommendation-facts"
          >
            {factLabels.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {factLabels.map((label) => (
                  <Badge className="h-auto" key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </span>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              {today_recommendation_facts_count({
                count: recommendation.factReferences.length,
              })}
            </span>
          </dd>
        </div>
        <div className="rounded-xl bg-muted p-2.5">
          <dt className="text-xs font-medium">
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
            onClick={() => onUse(buildRecommendationHandoff(recommendation))}
            size="sm"
            type="button"
          >
            {today_recommendation_use()}
            <IconArrowRight aria-hidden="true" />
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
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
