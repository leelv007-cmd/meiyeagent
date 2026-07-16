import {
  p1_week_candidate_rationale,
  p1_week_fact_asset_gaps,
  p1_week_fact_confirmed,
  p1_week_fact_drafted,
  p1_week_fact_evidence_asset_gaps,
  p1_week_fact_evidence_confirmed,
  p1_week_fact_evidence_drafted,
  p1_week_fact_evidence_human_leads,
  p1_week_fact_evidence_planned,
  p1_week_fact_evidence_published,
  p1_week_fact_human_leads,
  p1_week_fact_planned,
  p1_week_fact_published,
  p1_week_fact_unknown,
} from '@/locale/paraglide/messages';

import type { RawTask } from './operations-view-model';
import type {
  NextWeekCandidateView,
  TaskInboxFiltersValue,
  WeeklyReviewFactView,
} from './types';

export interface RawKnownMetric {
  status: 'known' | 'unknown';
  value?: number;
}

export interface RawWeeklyReview {
  id: string;
  metrics: {
    planned: RawKnownMetric;
    drafted: RawKnownMetric;
    confirmed: RawKnownMetric;
    published: RawKnownMetric;
    assetGaps: RawKnownMetric;
    humanLeads: RawKnownMetric;
  };
  nextWeekCandidates: Array<{
    id: string;
    title: string;
    status: 'pending_confirmation' | 'confirmed' | 'dismissed';
  }>;
}

export const EMPTY_TASK_FILTERS: TaskInboxFiltersValue = {
  date: 'all',
  relatedKind: 'all',
  risk: 'all',
  source: 'all',
  status: 'all',
};

export function currentWeekRange(now = new Date()) {
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

export function taskQuery(filters: TaskInboxFiltersValue, now = new Date()) {
  const range = currentWeekRange(now);
  return {
    ...(filters.date === 'week' ? range : {}),
    ...(filters.relatedKind !== 'all'
      ? { relatedKinds: [filters.relatedKind] }
      : {}),
    ...(filters.risk !== 'all' ? { risks: [filters.risk] } : {}),
    ...(filters.source !== 'all' ? { sources: [filters.source] } : {}),
    ...(filters.status !== 'all' ? { statuses: [filters.status] } : {}),
  };
}

function taskPriority(task: RawTask) {
  if (task.source === 'publish_ready' || task.status === 'blocked') return 0;
  if (task.status === 'needs_asset') return 1;
  if (task.status === 'needs_review') return 2;
  if (task.status === 'in_progress') return 3;
  if (task.source === 'weekly_review') return 5;
  return 4;
}

export function nextActionTask(tasks: RawTask[]) {
  return [...tasks]
    .filter((task) => !['done', 'archived'].includes(task.status))
    .sort(
      (left, right) =>
        taskPriority(left) - taskPriority(right) ||
        left.dueAt.localeCompare(right.dueAt) ||
        left.id.localeCompare(right.id)
    )[0];
}

export function weeklyReviewView(review: RawWeeklyReview | null): {
  facts: WeeklyReviewFactView[];
  candidates: NextWeekCandidateView[];
} {
  if (!review) return { candidates: [], facts: [] };
  const definitions: Array<
    [keyof RawWeeklyReview['metrics'], () => string, () => string]
  > = [
    ['planned', p1_week_fact_planned, p1_week_fact_evidence_planned],
    ['drafted', p1_week_fact_drafted, p1_week_fact_evidence_drafted],
    ['confirmed', p1_week_fact_confirmed, p1_week_fact_evidence_confirmed],
    ['published', p1_week_fact_published, p1_week_fact_evidence_published],
    ['assetGaps', p1_week_fact_asset_gaps, p1_week_fact_evidence_asset_gaps],
    ['humanLeads', p1_week_fact_human_leads, p1_week_fact_evidence_human_leads],
  ];
  return {
    facts: definitions.map(([id, label, evidenceLabel]) => {
      const metric = review.metrics[id];
      return {
        evidenceLabel: evidenceLabel(),
        id,
        label: label(),
        unknownReason: p1_week_fact_unknown(),
        value: metric.status === 'known' ? (metric.value ?? 0) : null,
      };
    }),
    candidates: review.nextWeekCandidates.map((candidate) => ({
      id: candidate.id,
      rationale: p1_week_candidate_rationale(),
      status:
        candidate.status === 'pending_confirmation'
          ? 'pending'
          : candidate.status === 'confirmed'
            ? 'confirmed'
            : 'dismissed',
      title: candidate.title,
    })),
  };
}
