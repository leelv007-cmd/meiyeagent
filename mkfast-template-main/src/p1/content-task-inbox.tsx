import {
  IconAlertTriangle,
  IconArchive,
  IconCheck,
  IconChevronRight,
  IconExternalLink,
  IconPhotoPlus,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';

import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { m } from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';

import { CompactWeekStrip } from './compact-week-strip';
import type {
  ContentTaskAction,
  ContentTaskStatus,
  ContentTaskView,
  InlineTaskRenderer,
  TaskInboxFilterOptions,
  TaskInboxFiltersValue,
  TaskSourceLinkView,
  WeekPointView,
} from './types';

const STATUS_LABEL: Record<ContentTaskStatus, () => string> = {
  archived: m.p1_task_status_archived,
  blocked: m.p1_task_status_blocked,
  done: m.p1_task_status_done,
  in_progress: m.p1_task_status_in_progress,
  needs_asset: m.p1_task_status_needs_asset,
  needs_review: m.p1_task_status_needs_review,
  ready: m.p1_task_status_ready,
  todo: m.p1_task_status_todo,
};

const STATUS_CLASS: Record<ContentTaskStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  needs_review:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  needs_asset:
    'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  ready:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  done: 'bg-primary/10 text-primary',
  archived: 'bg-muted text-muted-foreground',
};

const ACTION_CONFIG = {
  start: {
    label: m.p1_task_action_start,
    icon: IconPlayerPlay,
    variant: 'outline',
  },
  complete: {
    label: m.p1_task_action_complete,
    icon: IconCheck,
    variant: 'outline',
  },
  archive: {
    label: m.p1_task_action_archive,
    icon: IconArchive,
    variant: 'ghost',
  },
  add_asset: {
    label: m.p1_task_action_add_asset,
    icon: IconPhotoPlus,
    variant: 'outline',
  },
  retry_notification: {
    label: m.p1_task_action_retry_notification,
    icon: IconRefresh,
    variant: 'outline',
  },
} as const satisfies Record<
  ContentTaskAction,
  {
    label: () => string;
    icon: typeof IconPlayerPlay;
    variant: 'default' | 'outline' | 'ghost';
  }
>;

interface FilterSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (value: string) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onChange(nextValue);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className="min-w-28 border-0 bg-surface-2 shadow-none"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
            {typeof option.count === 'number' ? ` ${option.count}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface TaskInboxFiltersProps {
  value: TaskInboxFiltersValue;
  options: TaskInboxFilterOptions;
  onChange: (value: TaskInboxFiltersValue) => void;
  onClear?: () => void;
}

export function TaskInboxFilters({
  value,
  options,
  onChange,
  onClear,
}: TaskInboxFiltersProps) {
  const update = <Key extends keyof TaskInboxFiltersValue>(
    key: Key,
    nextValue: TaskInboxFiltersValue[Key]
  ) => onChange({ ...value, [key]: nextValue });

  const hasActiveFilter = Object.values(value).some(
    (filterValue) => filterValue !== 'all'
  );

  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">{m.p1_task_filters_legend()}</legend>
      <FilterSelect
        label={m.p1_task_filters_status()}
        value={value.status}
        options={options.statuses}
        onChange={(nextValue) => update('status', nextValue)}
      />
      <FilterSelect
        label={m.p1_task_filters_source()}
        value={value.source}
        options={options.sources}
        onChange={(nextValue) => update('source', nextValue)}
      />
      <FilterSelect
        label={m.p1_task_filters_date()}
        value={value.date}
        options={options.dates}
        onChange={(nextValue) => update('date', nextValue)}
      />
      <FilterSelect
        label={m.p1_task_filters_related()}
        value={value.relatedKind}
        options={options.relatedKinds}
        onChange={(nextValue) => update('relatedKind', nextValue)}
      />
      <FilterSelect
        label={m.p1_task_filters_risk()}
        value={value.risk}
        options={options.risks}
        onChange={(nextValue) => update('risk', nextValue)}
      />
      {hasActiveFilter && onClear && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          {m.p1_task_filters_clear()}
        </Button>
      )}
    </fieldset>
  );
}

interface TaskSourceLinkProps {
  link: TaskSourceLinkView;
  onOpen?: (link: TaskSourceLinkView) => void;
}

function TaskSourceLink({ link, onOpen }: TaskSourceLinkProps) {
  if (link.href) {
    return (
      <a
        href={getPathWithLocale(link.href)}
        className="inline-flex min-h-touch-target items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {link.label}
        <IconExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }

  if (!onOpen) return <span className="text-xs">{link.label}</span>;

  return (
    <Button
      type="button"
      size="xs"
      variant="link"
      className="min-h-touch-target px-2"
      onClick={() => onOpen(link)}
    >
      {link.label}
      <IconChevronRight aria-hidden="true" />
    </Button>
  );
}

interface TaskFeedItemProps {
  task: ContentTaskView;
  selected: boolean;
  pending: boolean;
  onSelect?: (taskId: string, selected: boolean) => void;
  onAction: (taskId: string, action: ContentTaskAction) => void;
  onOpenSource?: (link: TaskSourceLinkView) => void;
  renderInline?: InlineTaskRenderer;
}

function TaskFeedItem({
  task,
  selected,
  pending,
  onSelect,
  onAction,
  onOpenSource,
  renderInline,
}: TaskFeedItemProps) {
  const isBlocked = task.status === 'blocked' || task.status === 'needs_asset';

  return (
    <li className="flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {onSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(task.id, checked === true)}
            aria-label={m.p1_task_select_aria({ title: task.title })}
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <h3 className="meiye-type-body font-semibold">{task.title}</h3>
            <Badge
              variant="outline"
              className={cn(
                'mt-0.5 rounded-md border-transparent px-1.5 py-0.5 text-xs font-medium',
                STATUS_CLASS[task.status]
              )}
            >
              {STATUS_LABEL[task.status]()}
            </Badge>
          </div>
          <div className="meiye-type-aux mt-1 flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="whitespace-nowrap">{task.sourceLabel}</span>
            {task.summary && (
              <>
                <svg
                  viewBox="0 0 2 2"
                  className="size-0.5 flex-none fill-current"
                  aria-hidden="true"
                >
                  <circle r={1} cx={1} cy={1} />
                </svg>
                <p className="min-w-0">{task.summary}</p>
              </>
            )}
          </div>
          {renderInline?.({ task, placement: 'after_summary' })}
          {isBlocked && (
            <div className="mt-3 flex gap-2 rounded-lg bg-destructive/6 p-2.5 text-sm">
              <IconAlertTriangle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium">
                  {task.blockedReason ?? m.p1_task_blocked_fallback()}
                </p>
                {task.nextStep && (
                  <p className="mt-0.5 text-muted-foreground">
                    {m.p1_task_next_step({ nextStep: task.nextStep })}
                  </p>
                )}
              </div>
            </div>
          )}
          {task.notificationFailed && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {m.p1_task_notification_failed()}
            </p>
          )}
          {renderInline?.({ task, placement: 'before_actions' })}
        </div>
      </div>
      <div
        className={cn(
          'flex flex-none flex-wrap items-center gap-2 sm:justify-end',
          onSelect && 'pl-7 sm:pl-0'
        )}
      >
        {task.availableActions.map((action) => {
          const config = ACTION_CONFIG[action];
          const Icon = config.icon;
          return (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={config.variant}
              disabled={pending}
              onClick={() => onAction(task.id, action)}
            >
              <Icon aria-hidden="true" />
              {config.label()}
            </Button>
          );
        })}
        {task.sourceLink && (
          <TaskSourceLink link={task.sourceLink} onOpen={onOpenSource} />
        )}
      </div>
    </li>
  );
}

export interface ContentTaskInboxProps {
  description?: string;
  weekLabel: string;
  weekPoints: WeekPointView[];
  tasks: ContentTaskView[];
  totalCount: number;
  filters: TaskInboxFiltersValue;
  filterOptions: TaskInboxFilterOptions;
  selectedTaskIds?: string[];
  pendingTaskIds?: string[];
  onFiltersChange: (filters: TaskInboxFiltersValue) => void;
  onClearFilters: () => void;
  onSelectTask?: (taskId: string, selected: boolean) => void;
  onTaskAction: (taskId: string, action: ContentTaskAction) => void;
  onOpenSource?: (link: TaskSourceLinkView) => void;
  renderInline?: InlineTaskRenderer;
}

export function ContentTaskInbox({
  description,
  weekLabel,
  weekPoints,
  tasks,
  totalCount,
  filters,
  filterOptions,
  selectedTaskIds = [],
  pendingTaskIds = [],
  onFiltersChange,
  onClearFilters,
  onSelectTask,
  onTaskAction,
  onOpenSource,
  renderInline,
}: ContentTaskInboxProps) {
  const hasActiveFilters = Object.values(filters).some(
    (filterValue) => filterValue !== 'all'
  );
  const hideEmptyScaffolding = totalCount === 0 && !hasActiveFilters;

  return (
    <section aria-label={m.p1_task_default_title()} className="space-y-4">
      <header>
        <p className="meiye-type-aux">
          {description ?? m.p1_task_default_description()}
        </p>
      </header>

      <CompactWeekStrip label={weekLabel} points={weekPoints} />

      {!hideEmptyScaffolding ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-surface-1 p-4">
          <TaskInboxFilters
            value={filters}
            options={filterOptions}
            onChange={onFiltersChange}
            onClear={onClearFilters}
          />
          <p className="meiye-type-aux tabular-nums">
            {m.p1_task_count({ total: totalCount, visible: tasks.length })}
          </p>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <WarmEmptyState
          action={
            hasActiveFilters ? (
              <Button type="button" variant="outline" onClick={onClearFilters}>
                {m.p1_task_empty_filtered_action()}
              </Button>
            ) : (
              <a
                className={buttonVariants()}
                href={getPathWithLocale(Routes.Dashboard)}
              >
                {m.p1_task_empty_default_action()}
              </a>
            )
          }
          description={
            hasActiveFilters
              ? m.p1_task_empty_description()
              : m.p1_task_empty_default_description()
          }
          media={
            <span className="block h-16 w-24 overflow-hidden rounded-lg">
              <img
                alt={m.p1_task_empty_media_alt()}
                className="size-full object-cover"
                loading="lazy"
                src="/seed/scene/scene-seeding-nail.webp"
              />
            </span>
          }
          title={
            hasActiveFilters
              ? m.p1_task_empty_title()
              : m.p1_task_empty_default_title()
          }
        />
      ) : (
        <ul className="divide-y divide-divider overflow-hidden rounded-xl bg-surface-1">
          {tasks.map((task) => (
            <TaskFeedItem
              key={task.id}
              task={task}
              selected={selectedTaskIds.includes(task.id)}
              pending={pendingTaskIds.includes(task.id)}
              onSelect={onSelectTask}
              onAction={onTaskAction}
              onOpenSource={onOpenSource}
              renderInline={renderInline}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
