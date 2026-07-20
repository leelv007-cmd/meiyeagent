/**
 * High-density supply run table (J4 / D-070).
 * Facets + pagination/sort reflected via URL state helpers (pure props).
 */
import { Badge } from '@/components/ui/badge';
import type {
  SupplyRunTablePage,
  SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import {
  runTableStateToSearchString,
  updateRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';

type FacetKey =
  | 'operation'
  | 'status'
  | 'modality'
  | 'channelKind'
  | 'dataClass';

function StateLink({
  basePath,
  current,
  next,
  label,
  onStateChange,
  testId,
}: {
  basePath: string;
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
      className="rounded border px-2 py-1 text-foreground hover:bg-muted"
      onClick={(event) => {
        if (!onStateChange) return;
        event.preventDefault();
        onStateChange(state);
      }}
    >
      {label}
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
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-facet-key={facetKey}
    >
      <span className="font-medium">{label}</span>
      <StateLink
        basePath={basePath}
        current={current}
        next={{ [facetKey]: undefined }}
        label={`${label} 全部`}
        onStateChange={onStateChange}
      />
      {values.map((value) => (
        <StateLink
          key={value}
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

  return (
    <section
      data-testid="supply-run-table"
      data-page={page.state.page}
      data-page-size={page.state.pageSize}
      data-sort={page.state.sort}
      data-dir={page.state.dir}
      data-total={page.total}
      className="space-y-3"
    >
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">运行表</h2>
          <p className="text-xs text-muted-foreground">
            faceted 筛选 · 服务端分页排序 · URL 状态同步（刷新/分享保持筛选态）
          </p>
        </div>
        <a
          href={sharePath}
          data-testid="supply-run-table-share-link"
          data-share-path={sharePath}
          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
        >
          {sharePath}
        </a>
      </header>

      <div
        data-testid="supply-run-table-controls"
        className="space-y-2 rounded-md border p-3 text-xs"
      >
        <FacetLinks
          basePath={basePath}
          current={page.state}
          facetKey="operation"
          label="操作"
          values={page.facets.operations}
          onStateChange={onStateChange}
        />
        <FacetLinks
          basePath={basePath}
          current={page.state}
          facetKey="status"
          label="状态"
          values={page.facets.statuses}
          onStateChange={onStateChange}
        />
        <FacetLinks
          basePath={basePath}
          current={page.state}
          facetKey="modality"
          label="模态"
          values={page.facets.modalities}
          onStateChange={onStateChange}
        />
        <FacetLinks
          basePath={basePath}
          current={page.state}
          facetKey="channelKind"
          label="渠道"
          values={page.facets.channelKinds}
          onStateChange={onStateChange}
        />
        <FacetLinks
          basePath={basePath}
          current={page.state}
          facetKey="dataClass"
          label="数据类别"
          values={page.facets.dataClasses}
          onStateChange={onStateChange}
        />
        <div className="flex flex-wrap items-center gap-1" data-control="sort">
          <span className="font-medium">排序</span>
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
              basePath={basePath}
              current={page.state}
              next={{ sort }}
              label={`排序 ${sort}`}
              onStateChange={onStateChange}
            />
          ))}
          <StateLink
            basePath={basePath}
            current={page.state}
            next={{ dir: page.state.dir === 'asc' ? 'desc' : 'asc' }}
            label={page.state.dir === 'asc' ? '切换为降序' : '切换为升序'}
            onStateChange={onStateChange}
          />
        </div>
        <div
          className="flex flex-wrap items-center gap-1"
          data-control="page-size"
        >
          <span className="font-medium">每页</span>
          {[10, 20, 50, 100].map((pageSize) => (
            <StateLink
              key={pageSize}
              basePath={basePath}
              current={page.state}
              next={{ pageSize }}
              label={`每页 ${pageSize}`}
              onStateChange={onStateChange}
            />
          ))}
        </div>
      </div>

      <div
        data-testid="supply-run-table-facets"
        className="flex flex-wrap gap-2 text-xs"
      >
        {page.state.operation ? (
          <Badge variant="secondary" data-facet="operation">
            op={page.state.operation}
          </Badge>
        ) : null}
        {page.state.status ? (
          <Badge variant="secondary" data-facet="status">
            status={page.state.status}
          </Badge>
        ) : null}
        {page.state.modality ? (
          <Badge variant="secondary" data-facet="modality">
            modality={page.state.modality}
          </Badge>
        ) : null}
        {page.state.channelKind ? (
          <Badge variant="secondary" data-facet="channelKind">
            channel={page.state.channelKind}
          </Badge>
        ) : null}
        {page.state.q ? (
          <Badge variant="secondary" data-facet="q">
            q={page.state.q}
          </Badge>
        ) : null}
        <span className="text-muted-foreground">
          facets ops[{page.facets.operations.join('|')}] status[
          {page.facets.statuses.join('|')}]
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table
          className="w-full text-left text-xs"
          data-testid="supply-run-table-grid"
        >
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="p-2">任务</th>
              <th className="p-2">操作</th>
              <th className="p-2">状态</th>
              <th className="p-2">渠道</th>
              <th className="p-2">延迟</th>
              <th className="p-2">生命周期</th>
              <th className="p-2">错误</th>
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
                className="border-b last:border-0"
              >
                <td className="p-2">
                  <a
                    href={`/admin/supply/tasks/${row.taskId}`}
                    data-testid="supply-run-task-link"
                    className="font-mono text-primary underline-offset-2 hover:underline"
                  >
                    {row.taskId}
                  </a>
                </td>
                <td className="p-2">
                  {row.operation}
                  <br />
                  <span className="text-muted-foreground">{row.modality}</span>
                </td>
                <td className="p-2">
                  <Badge variant="outline">{row.status}</Badge>
                </td>
                <td className="p-2 font-mono">
                  {row.channelKind}
                  <br />
                  {row.deploymentId}
                </td>
                <td className="p-2">
                  {row.latencyMs != null ? `${row.latencyMs}ms` : '—'}
                </td>
                <td className="p-2">{row.lifecycle}</td>
                <td className="p-2">
                  {row.errorCode ? (
                    <span data-testid="supply-run-error-badge">
                      {row.errorCode}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer
        data-testid="supply-run-table-pagination"
        className="flex flex-wrap gap-3 text-xs text-muted-foreground"
      >
        <span>
          第 {page.state.page}/{page.totalPages} 页 · 共 {page.total} 条 · 每页{' '}
          {page.state.pageSize}
        </span>
        <span>
          排序 {page.state.sort} {page.state.dir}
        </span>
        {page.state.page > 1 ? (
          <StateLink
            basePath={basePath}
            current={page.state}
            next={{ page: page.state.page - 1 }}
            label="上一页"
            onStateChange={onStateChange}
            testId="supply-run-table-previous"
          />
        ) : null}
        {page.state.page < page.totalPages ? (
          <StateLink
            basePath={basePath}
            current={page.state}
            next={{ page: page.state.page + 1 }}
            label="下一页"
            onStateChange={onStateChange}
            testId="supply-run-table-next"
          />
        ) : null}
      </footer>
    </section>
  );
}
