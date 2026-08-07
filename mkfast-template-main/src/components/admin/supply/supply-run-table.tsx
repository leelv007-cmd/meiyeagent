/**
 * High-density supply run table (J4 / D-070).
 * Facets + pagination/sort reflected via URL state helpers (pure props).
 */
import { Badge, badgeVariants, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type {
  SupplyRunTablePage,
  SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import {
  runTableStateToSearchString,
  serializeRunTableUrlState,
  updateRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import { IconSearch, IconX } from '@tabler/icons-react';
import {
  admin_supply_action_f3ea6d34,
  admin_supply_apply_filters_758c4639,
  admin_supply_channel_c152be9f,
  admin_supply_clear_search_d9e2eaf7,
  admin_supply_data_class_39ae5796,
  admin_supply_error_b859c7be,
  admin_supply_faceted_filters_server_side_page_sort_ur_bdbb621a,
  admin_supply_filter_all_with_label,
  admin_supply_filter_by_catalog_model_b5543b26,
  admin_supply_filter_by_task_id_92eff027,
  admin_supply_full_text_search_runs_9e37fb19,
  admin_supply_latency_e9f09214,
  admin_supply_lifecycle_00920077,
  admin_supply_modality_525b0a38,
  admin_supply_next_page_67a246a3,
  admin_supply_of_af061b41,
  admin_supply_page_size_with_value,
  admin_supply_per_page_309c98d3,
  admin_supply_previous_page_b41561d8,
  admin_supply_rows_page_824a627c,
  admin_supply_run_table_707842cf,
  admin_supply_search_task_model_error_code_5b7d9398,
  admin_supply_sort_6d3c6f3f,
  admin_supply_sort_dc35af8d,
  admin_supply_sort_with_value,
  admin_supply_status_62e951a6,
  admin_supply_switch_to_ascending_f2f0ac32,
  admin_supply_switch_to_descending_fd06f602,
  admin_supply_tasks_3172b317,
} from '@/locale/paraglide/messages';

type FacetKey =
  | 'operation'
  | 'status'
  | 'modality'
  | 'channelKind'
  | 'dataClass';

const RUN_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  succeeded: 'success-light',
  accepted: 'success-light',
  failed: 'destructive-light',
  rejected_before_accept: 'destructive-light',
  running: 'info-light',
  queued: 'info-light',
  draining: 'warning-light',
  acceptance_unknown: 'warning-light',
};

function runStatusVariant(status: string): BadgeProps['variant'] {
  return RUN_STATUS_VARIANT[status] ?? 'outline';
}

/**
 * Every control on this table is a real link to the state it produces, so the
 * server-paged view stays shareable and works before hydration. `onStateChange`
 * only intercepts the navigation when the route owns the search params.
 */
function StateLink({
  active = false,
  basePath,
  children,
  className,
  current,
  next,
  label,
  onStateChange,
  testId,
}: {
  active?: boolean;
  basePath: string;
  children?: React.ReactNode;
  className?: string;
  current: SupplyRunTableUrlState;
  next: Partial<SupplyRunTableUrlState>;
  label: string;
  onStateChange?: (state: SupplyRunTableUrlState) => void;
  testId?: string;
}) {
  const state = updateRunTableUrlState(current, next);
  const href = `${basePath}${runTableStateToSearchString(state)}`;
  return (
    <a
      href={href}
      data-testid={testId}
      aria-label={children ? label : undefined}
      // A facet is a link to a URL, not a toggle button, so the selected one is
      // announced with aria-current rather than aria-pressed.
      aria-current={active ? 'true' : undefined}
      className={cn(
        badgeVariants({
          variant: active ? 'primary-light' : 'outline',
          size: 'lg',
        }),
        'hover:bg-muted',
        className
      )}
      onClick={(event) => {
        if (!onStateChange) return;
        event.preventDefault();
        onStateChange(state);
      }}
    >
      {children ?? label}
    </a>
  );
}

function FacetLinks({
  basePath,
  current,
  facetKey,
  label,
  values,
  onStateChange,
}: {
  basePath: string;
  current: SupplyRunTableUrlState;
  facetKey: FacetKey;
  label: string;
  values: readonly string[];
  onStateChange?: (state: SupplyRunTableUrlState) => void;
}) {
  const selected = current[facetKey];
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-facet-key={facetKey}
    >
      <span className="mr-1 font-medium text-muted-foreground">{label}</span>
      <StateLink
        active={!selected}
        basePath={basePath}
        current={current}
        next={{ [facetKey]: undefined }}
        label={admin_supply_filter_all_with_label({ label })}
        onStateChange={onStateChange}
      />
      {values.map((value) => (
        <StateLink
          key={value}
          active={selected === value}
          basePath={basePath}
          current={current}
          next={{ [facetKey]: value }}
          label={`${label} ${value}`}
          onStateChange={onStateChange}
        />
      ))}
    </div>
  );
}

/** Text filters that Core already honours but had no input (q / model / task). */
const TEXT_FILTER_KEYS = ['q', 'catalogModelId', 'taskId'] as const;

function SearchForm({
  basePath,
  current,
  onStateChange,
}: {
  basePath: string;
  current: SupplyRunTableUrlState;
  onStateChange?: (state: SupplyRunTableUrlState) => void;
}) {
  // Everything not typed in this form travels as hidden fields, so a submit
  // without JS lands on the same URL the click handler would have produced.
  const carried = Array.from(serializeRunTableUrlState(current).entries())
    .filter(([key]) => !TEXT_FILTER_KEYS.includes(key as 'q'))
    .filter(([key]) => key !== 'page');

  return (
    <form
      action={basePath}
      className="flex w-full flex-wrap items-center gap-2"
      data-testid="supply-run-table-search"
      // Remount on state change so the inputs follow the URL after a facet click.
      key={runTableStateToSearchString(current)}
      method="get"
      onSubmit={(event) => {
        if (!onStateChange) return;
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const read = (key: string) => {
          const value = form.get(key);
          const text = typeof value === 'string' ? value.trim() : '';
          return text === '' ? undefined : text;
        };
        onStateChange(
          updateRunTableUrlState(current, {
            catalogModelId: read('catalogModelId'),
            page: 1,
            q: read('q'),
            taskId: read('taskId'),
          })
        );
      }}
    >
      {carried.map(([key, value]) => (
        <input key={key} name={key} type="hidden" value={value} />
      ))}
      <InputGroup className="w-full sm:w-56">
        <InputGroupAddon>
          <IconSearch aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={admin_supply_full_text_search_runs_9e37fb19()}
          data-testid="supply-run-table-q"
          defaultValue={current.q ?? ''}
          name="q"
          placeholder={admin_supply_search_task_model_error_code_5b7d9398()}
        />
        {current.q ? (
          <InputGroupAddon align="inline-end">
            <StateLink
              basePath={basePath}
              className="size-5 p-0"
              current={current}
              next={{ page: 1, q: undefined }}
              label={admin_supply_clear_search_d9e2eaf7()}
              onStateChange={onStateChange}
              testId="supply-run-table-q-clear"
            >
              <IconX aria-hidden="true" />
            </StateLink>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Input
        aria-label={admin_supply_filter_by_catalog_model_b5543b26()}
        className="w-full sm:w-44"
        data-testid="supply-run-table-catalog-model-id"
        defaultValue={current.catalogModelId ?? ''}
        name="catalogModelId"
        placeholder="catalogModelId"
      />
      <Input
        aria-label={admin_supply_filter_by_task_id_92eff027()}
        className="w-full sm:w-40"
        data-testid="supply-run-table-task-id"
        defaultValue={current.taskId ?? ''}
        name="taskId"
        placeholder="taskId"
      />
      <Button size="sm" type="submit" variant="outline">
        {admin_supply_apply_filters_758c4639()}
      </Button>
    </form>
  );
}

export function SupplyRunTable({
  page,
  basePath = '/admin/supply',
  onStateChange,
}: {
  page: SupplyRunTablePage;
  basePath?: string;
  onStateChange?: (state: SupplyRunTableUrlState) => void;
}) {
  const sharePath = `${basePath}${runTableStateToSearchString(page.state)}`;
  const from = (page.state.page - 1) * page.state.pageSize + 1;
  const to = Math.min(page.state.page * page.state.pageSize, page.total);

  return (
    <Frame
      dense
      spacing="sm"
      className="w-full min-w-0"
      data-testid="supply-run-table"
      data-page={page.state.page}
      data-page-size={page.state.pageSize}
      data-sort={page.state.sort}
      data-dir={page.state.dir}
      data-total={page.total}
    >
      <FrameHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-px">
          <FrameTitle>{admin_supply_run_table_707842cf()}</FrameTitle>
          <FrameDescription className="text-xs">
            {admin_supply_faceted_filters_server_side_page_sort_ur_bdbb621a()}
          </FrameDescription>
        </div>
        <a
          href={sharePath}
          data-testid="supply-run-table-share-link"
          data-share-path={sharePath}
          className="max-w-full truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
        >
          {sharePath}
        </a>
      </FrameHeader>

      <FramePanel className="p-0!">
        <div className="px-(--frame-panel-header-px) py-(--frame-panel-header-py)">
          <SearchForm
            basePath={basePath}
            current={page.state}
            onStateChange={onStateChange}
          />
        </div>
        <Separator />
        <div
          data-testid="supply-run-table-controls"
          className="space-y-2 px-(--frame-panel-header-px) py-(--frame-panel-header-py) text-xs"
        >
          <FacetLinks
            basePath={basePath}
            current={page.state}
            facetKey="operation"
            label={admin_supply_action_f3ea6d34()}
            values={page.facets.operations}
            onStateChange={onStateChange}
          />
          <FacetLinks
            basePath={basePath}
            current={page.state}
            facetKey="status"
            label={admin_supply_status_62e951a6()}
            values={page.facets.statuses}
            onStateChange={onStateChange}
          />
          <FacetLinks
            basePath={basePath}
            current={page.state}
            facetKey="modality"
            label={admin_supply_modality_525b0a38()}
            values={page.facets.modalities}
            onStateChange={onStateChange}
          />
          <FacetLinks
            basePath={basePath}
            current={page.state}
            facetKey="channelKind"
            label={admin_supply_channel_c152be9f()}
            values={page.facets.channelKinds}
            onStateChange={onStateChange}
          />
          <FacetLinks
            basePath={basePath}
            current={page.state}
            facetKey="dataClass"
            label={admin_supply_data_class_39ae5796()}
            values={page.facets.dataClasses}
            onStateChange={onStateChange}
          />
          <div
            className="flex flex-wrap items-center gap-1"
            data-control="sort"
          >
            <span className="mr-1 font-medium text-muted-foreground">
              {admin_supply_sort_dc35af8d()}
            </span>
            {(
              [
                'startedAt',
                'latencyMs',
                'status',
                'operation',
                'costMicros',
              ] as const
            ).map((sort) => (
              <StateLink
                key={sort}
                active={page.state.sort === sort}
                basePath={basePath}
                current={page.state}
                next={{ sort }}
                label={admin_supply_sort_with_value({ sort })}
                onStateChange={onStateChange}
              />
            ))}
            <StateLink
              basePath={basePath}
              current={page.state}
              next={{ dir: page.state.dir === 'asc' ? 'desc' : 'asc' }}
              label={
                page.state.dir === 'asc'
                  ? admin_supply_switch_to_descending_fd06f602()
                  : admin_supply_switch_to_ascending_f2f0ac32()
              }
              onStateChange={onStateChange}
            />
          </div>
          <div
            className="flex flex-wrap items-center gap-1"
            data-control="page-size"
          >
            <span className="mr-1 font-medium text-muted-foreground">
              {admin_supply_per_page_309c98d3()}
            </span>
            {[10, 20, 50, 100].map((pageSize) => (
              <StateLink
                key={pageSize}
                active={page.state.pageSize === pageSize}
                basePath={basePath}
                current={page.state}
                next={{ pageSize }}
                label={admin_supply_page_size_with_value({ pageSize })}
                onStateChange={onStateChange}
              />
            ))}
          </div>
        </div>
        <Separator />
        <div
          data-testid="supply-run-table-facets"
          className="flex flex-wrap items-center gap-2 px-(--frame-panel-header-px) py-(--frame-panel-header-py) text-xs"
        >
          {page.state.operation ? (
            <Badge variant="primary-light" data-facet="operation">
              op={page.state.operation}
            </Badge>
          ) : null}
          {page.state.status ? (
            <Badge variant="primary-light" data-facet="status">
              status={page.state.status}
            </Badge>
          ) : null}
          {page.state.modality ? (
            <Badge variant="primary-light" data-facet="modality">
              modality={page.state.modality}
            </Badge>
          ) : null}
          {page.state.channelKind ? (
            <Badge variant="primary-light" data-facet="channelKind">
              channel={page.state.channelKind}
            </Badge>
          ) : null}
          {page.state.q ? (
            <Badge variant="primary-light" data-facet="q">
              q={page.state.q}
            </Badge>
          ) : null}
          {page.state.catalogModelId ? (
            <Badge variant="primary-light" data-facet="catalogModelId">
              model={page.state.catalogModelId}
            </Badge>
          ) : null}
          {page.state.taskId ? (
            <Badge variant="primary-light" data-facet="taskId">
              task={page.state.taskId}
            </Badge>
          ) : null}
          <span className="text-muted-foreground">
            facets ops[{page.facets.operations.join('|')}] status[
            {page.facets.statuses.join('|')}]
          </span>
        </div>
        <Separator />
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-xs"
            data-testid="supply-run-table-grid"
          >
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_tasks_3172b317()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_action_f3ea6d34()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_status_62e951a6()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_channel_c152be9f()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_latency_e9f09214()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_lifecycle_00920077()}
                </th>
                <th className="px-3 py-2 font-medium">
                  {admin_supply_error_b859c7be()}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="supply-run-row"
                  data-run-id={row.id}
                  data-task-id={row.taskId}
                  data-status={row.status}
                  data-ended-at={row.endedAt}
                  data-latency-ms={row.latencyMs}
                  className="border-b last:border-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/supply/tasks/${row.taskId}`}
                      data-testid="supply-run-task-link"
                      className="font-mono text-primary underline-offset-2 hover:underline"
                    >
                      {row.taskId}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    {row.operation}
                    <br />
                    <span className="text-muted-foreground">
                      {row.modality}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={runStatusVariant(row.status)}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.channelKind}
                    <br />
                    {row.deploymentId}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.latencyMs != null ? `${row.latencyMs}ms` : '—'}
                  </td>
                  <td className="px-3 py-2">{row.lifecycle}</td>
                  <td className="px-3 py-2">
                    {row.errorCode ? (
                      <Badge
                        variant="destructive-light"
                        data-testid="supply-run-error-badge"
                      >
                        {row.errorCode}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FramePanel>

      <FrameFooter
        data-testid="supply-run-table-pagination"
        className="flex-row flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span className="tabular-nums">
          {page.total === 0 ? 0 : from} - {to} {admin_supply_of_af061b41()}{' '}
          {page.total} {admin_supply_rows_page_824a627c()} {page.state.page}/
          {page.totalPages} {admin_supply_sort_6d3c6f3f()} {page.state.sort}{' '}
          {page.state.dir}
        </span>
        <span className="flex items-center gap-1">
          {page.state.page > 1 ? (
            <StateLink
              basePath={basePath}
              current={page.state}
              next={{ page: page.state.page - 1 }}
              label={admin_supply_previous_page_b41561d8()}
              onStateChange={onStateChange}
              testId="supply-run-table-previous"
            />
          ) : null}
          {page.state.page < page.totalPages ? (
            <StateLink
              basePath={basePath}
              current={page.state}
              next={{ page: page.state.page + 1 }}
              label={admin_supply_next_page_67a246a3()}
              onStateChange={onStateChange}
              testId="supply-run-table-next"
            />
          ) : null}
        </span>
      </FrameFooter>
    </Frame>
  );
}
