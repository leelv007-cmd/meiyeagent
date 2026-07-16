import {
  IconArrowRight,
  IconDatabaseSearch,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  p1_retrieval_count,
  p1_retrieval_description,
  p1_retrieval_empty_description,
  p1_retrieval_empty_title,
  p1_retrieval_error_description,
  p1_retrieval_error_title,
  p1_retrieval_form_aria,
  p1_retrieval_loading,
  p1_retrieval_metric_document_count,
  p1_retrieval_metric_engine,
  p1_retrieval_metric_engine_memory,
  p1_retrieval_metric_engine_postgres_bigram,
  p1_retrieval_metric_engine_postgres_trigram,
  p1_retrieval_metric_index_size,
  p1_retrieval_metric_no_result_rate,
  p1_retrieval_metric_query_set,
  p1_retrieval_metric_recall,
  p1_retrieval_metric_reformulation_rate,
  p1_retrieval_metric_revision,
  p1_retrieval_metric_unknown,
  p1_retrieval_placeholder,
  p1_retrieval_query_aria,
  p1_retrieval_query_too_long,
  p1_retrieval_retry,
  p1_retrieval_scope_all,
  p1_retrieval_scope_aria,
  p1_retrieval_scope_asset,
  p1_retrieval_scope_content,
  p1_retrieval_scope_task,
  p1_retrieval_scope_template,
  p1_retrieval_search,
  p1_retrieval_title,
} from '@/locale/paraglide/messages';

import type {
  RetrievalFilterView,
  RetrievalMetricsView,
  RetrievalResultView,
  SearchScope,
} from './types';

const SCOPE_OPTIONS: { value: SearchScope; label: () => string }[] = [
  { value: 'all', label: p1_retrieval_scope_all },
  { value: 'task', label: p1_retrieval_scope_task },
  { value: 'asset', label: p1_retrieval_scope_asset },
  { value: 'content', label: p1_retrieval_scope_content },
  { value: 'template', label: p1_retrieval_scope_template },
];

const SCOPE_LABEL: Record<Exclude<SearchScope, 'all'>, () => string> = {
  asset: p1_retrieval_scope_asset,
  content: p1_retrieval_scope_content,
  task: p1_retrieval_scope_task,
  template: p1_retrieval_scope_template,
};

const retrievalFormSchema = z.object({
  filters: z.record(z.string(), z.string().max(200)),
  query: z.string().trim().max(200, p1_retrieval_query_too_long()),
  scope: z.enum(['all', 'task', 'asset', 'content', 'template']),
});

type RetrievalFormValue = z.infer<typeof retrievalFormSchema>;

export interface RetrievalSearchProps {
  query: string;
  scope: SearchScope;
  filters: RetrievalFilterView[];
  results: RetrievalResultView[];
  totalCount: number;
  loading?: boolean;
  error?: string;
  metrics?: RetrievalMetricsView;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: SearchScope) => void;
  onFilterChange: (filterId: string, value: string) => void;
  onSearch: () => void;
  onRetry?: () => void;
  onOpenResult: (result: RetrievalResultView) => void;
}

function PercentMetric({ value }: { value: number | null }) {
  return (
    <span className="font-medium tabular-nums">
      {value === null
        ? p1_retrieval_metric_unknown()
        : `${Math.round(value * 100)}%`}
    </span>
  );
}

function retrievalEngineLabel(value: string) {
  if (value === 'memory-bigram-trigram') {
    return p1_retrieval_metric_engine_memory();
  }
  if (value === 'postgres-fts-bigram') {
    return p1_retrieval_metric_engine_postgres_bigram();
  }
  if (value === 'postgres-fts-trigram-bigram') {
    return p1_retrieval_metric_engine_postgres_trigram();
  }
  return p1_retrieval_metric_unknown();
}

export function RetrievalSearch({
  query,
  scope,
  filters,
  results,
  totalCount,
  loading = false,
  error,
  metrics,
  onQueryChange,
  onScopeChange,
  onFilterChange,
  onSearch,
  onRetry,
  onOpenResult,
}: RetrievalSearchProps) {
  const form = useForm<RetrievalFormValue>({
    resolver: zodResolver(retrievalFormSchema),
    values: {
      filters: Object.fromEntries(
        filters.map((filter) => [filter.id, filter.value])
      ),
      query,
      scope,
    },
  });

  return (
    <section aria-labelledby="p1-search-title" className="space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <IconDatabaseSearch
            className="size-5 text-primary"
            aria-hidden="true"
          />
          <h2 id="p1-search-title" className="text-lg font-semibold">
            {p1_retrieval_title()}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {p1_retrieval_description()}
        </p>
      </header>

      <form
        onSubmit={form.handleSubmit(() => onSearch())}
        aria-label={p1_retrieval_form_aria()}
        className="space-y-3"
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <IconSearch
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Controller
              control={form.control}
              name="query"
              render={({ field }) => (
                <Input
                  {...field}
                  onChange={(event) => {
                    field.onChange(event);
                    onQueryChange(event.target.value);
                  }}
                  placeholder={p1_retrieval_placeholder()}
                  className="pl-9"
                  aria-label={p1_retrieval_query_aria()}
                />
              )}
            />
          </div>
          <Button type="submit" disabled={loading}>
            <IconSearch aria-hidden="true" />
            {p1_retrieval_search()}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Controller
            control={form.control}
            name="scope"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (!value) return;
                  field.onChange(value);
                  onScopeChange(value as SearchScope);
                }}
              >
                <SelectTrigger size="sm" aria-label={p1_retrieval_scope_aria()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {filters.map((filter) => (
            <Controller
              key={filter.id}
              control={form.control}
              name={`filters.${filter.id}`}
              render={({ field }) =>
                filter.control === 'text' || filter.control === 'date' ? (
                  <Input
                    type={filter.control === 'date' ? 'date' : 'text'}
                    value={field.value === 'all' ? '' : (field.value ?? '')}
                    onChange={(event) => {
                      const value = event.target.value || 'all';
                      field.onChange(value);
                      onFilterChange(filter.id, value);
                    }}
                    placeholder={filter.label}
                    aria-label={filter.label}
                    className="h-8 w-auto min-w-32"
                  />
                ) : (
                  <Select
                    value={field.value ?? 'all'}
                    onValueChange={(value) => {
                      if (!value) return;
                      field.onChange(value);
                      onFilterChange(filter.id, value);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={filter.label}
                      className="min-w-28"
                    >
                      <SelectValue placeholder={filter.label} />
                    </SelectTrigger>
                    <SelectContent>
                      {(filter.options ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                          {typeof option.count === 'number'
                            ? ` ${option.count}`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            />
          ))}
        </div>
        {form.formState.errors.query?.message && (
          <p className="text-xs text-destructive">
            {form.formState.errors.query.message}
          </p>
        )}
      </form>

      {metrics && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {p1_retrieval_metric_revision()}{' '}
            <span className="font-mono text-foreground">
              {metrics.revision}
            </span>
          </span>
          <span>
            {p1_retrieval_metric_recall()}{' '}
            <PercentMetric value={metrics.recallAtK} />
          </span>
          <span>
            {p1_retrieval_metric_no_result_rate()}{' '}
            <PercentMetric value={metrics.noResultRate} />
          </span>
          <span>
            {p1_retrieval_metric_reformulation_rate()}{' '}
            <PercentMetric value={metrics.reformulationRate} />
          </span>
          <span>
            {p1_retrieval_metric_document_count({
              count: metrics.indexDocumentCount,
            })}
          </span>
          <span>
            {p1_retrieval_metric_index_size({
              size: (metrics.indexSizeBytes / 1024).toFixed(1),
            })}
          </span>
          <span>
            {p1_retrieval_metric_engine({
              engine: retrievalEngineLabel(metrics.indexMode),
            })}
          </span>
          <span>
            {p1_retrieval_metric_query_set()}{' '}
            <span className="font-mono text-foreground">
              {metrics.querySetHash.slice(0, 12)}…
            </span>
          </span>
        </div>
      )}

      {loading ? (
        <output className="block space-y-2" aria-label={p1_retrieval_loading()}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </output>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">
            {p1_retrieval_error_title()}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {p1_retrieval_error_description()}
          </p>
          {onRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onRetry}
            >
              <IconRefresh aria-hidden="true" />
              {p1_retrieval_retry()}
            </Button>
          )}
        </div>
      ) : results.length === 0 ? (
        <div className="grid min-h-44 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <IconSearch
              className="mx-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="mt-3 font-medium">{p1_retrieval_empty_title()}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {p1_retrieval_empty_description()}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {p1_retrieval_count({
              total: totalCount,
              visible: results.length,
            })}
          </p>
          <ol className="divide-y overflow-hidden rounded-xl border">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="group flex w-full items-start gap-3 bg-background p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onOpenResult(result)}
                >
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {SCOPE_LABEL[result.scope]()}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{result.title}</span>
                    {result.excerpt && (
                      <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                        {result.excerpt}
                      </span>
                    )}
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {result.tags.map((item) => (
                        <span
                          key={item}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {item}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {result.matchedBy.join(' + ')}
                    <IconArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
