/**
 * High-density supply run table state (J4 / D-070).
 *
 * Faceted filters + server-style pagination/sort + URL state sync.
 * Upstream MkImage layout is the preferred information contract, not pixel-forced.
 */
import type { SupplyDataClass, SupplyOperation } from '@meiye/contracts';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import type {
  SupplyControlSnapshot,
  SupplyRunQuery,
  SupplyRunRecord,
  SupplyRunSortField,
} from './admin-supply-types';

export const RUN_TABLE_SORT_FIELDS = [
  'startedAt',
  'latencyMs',
  'status',
  'operation',
  'costMicros',
] as const;

export type RunTableSortField = SupplyRunSortField;
export type RunTableSortDir = 'asc' | 'desc';

export interface SupplyRunTableUrlState extends SupplyRunQuery {}

export const DEFAULT_RUN_TABLE_URL_STATE: SupplyRunTableUrlState = {
  page: 1,
  pageSize: 20,
  sort: 'startedAt',
  dir: 'desc',
};

export const RUN_TABLE_URL_KEYS = {
  page: 'page',
  pageSize: 'pageSize',
  sort: 'sort',
  dir: 'dir',
  operation: 'operation',
  status: 'status',
  modality: 'modality',
  channelKind: 'channelKind',
  catalogModelId: 'catalogModelId',
  deploymentId: 'deploymentId',
  dataClass: 'dataClass',
  q: 'q',
  taskId: 'taskId',
} as const;

const SORT_SET = new Set<string>(RUN_TABLE_SORT_FIELDS);

function parsePositiveInt(
  raw: string | null | undefined,
  fallback: number
): number {
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** Parse run-table URL state from URLSearchParams or plain record. */
export function parseRunTableUrlState(
  input: URLSearchParams | Record<string, string | undefined | null>
): SupplyRunTableUrlState {
  const get =
    input instanceof URLSearchParams
      ? (key: string) => input.get(key)
      : (key: string) => input[key] ?? null;

  const sortRaw =
    get(RUN_TABLE_URL_KEYS.sort) ?? DEFAULT_RUN_TABLE_URL_STATE.sort;
  const sort = SORT_SET.has(sortRaw)
    ? (sortRaw as RunTableSortField)
    : DEFAULT_RUN_TABLE_URL_STATE.sort;
  const dirRaw = get(RUN_TABLE_URL_KEYS.dir);
  const dir: RunTableSortDir = dirRaw === 'asc' ? 'asc' : 'desc';

  const state: SupplyRunTableUrlState = {
    page: parsePositiveInt(
      get(RUN_TABLE_URL_KEYS.page),
      DEFAULT_RUN_TABLE_URL_STATE.page
    ),
    pageSize: Math.min(
      100,
      parsePositiveInt(
        get(RUN_TABLE_URL_KEYS.pageSize),
        DEFAULT_RUN_TABLE_URL_STATE.pageSize
      )
    ),
    sort,
    dir,
  };

  const operation = get(RUN_TABLE_URL_KEYS.operation);
  if (operation) state.operation = operation as SupplyOperation;
  const status = get(RUN_TABLE_URL_KEYS.status);
  if (status) state.status = status as SupplyRunRecord['status'];
  const modality = get(RUN_TABLE_URL_KEYS.modality);
  if (modality) state.modality = modality as SupplyRunRecord['modality'];
  const channelKind = get(RUN_TABLE_URL_KEYS.channelKind);
  if (channelKind)
    state.channelKind = channelKind as SupplyRunRecord['channelKind'];
  const catalogModelId = get(RUN_TABLE_URL_KEYS.catalogModelId);
  if (catalogModelId) state.catalogModelId = catalogModelId;
  const deploymentId = get(RUN_TABLE_URL_KEYS.deploymentId);
  if (deploymentId) state.deploymentId = deploymentId;
  const dataClass = get(RUN_TABLE_URL_KEYS.dataClass);
  if (dataClass) state.dataClass = dataClass as SupplyDataClass;
  const q = get(RUN_TABLE_URL_KEYS.q);
  if (q) state.q = q;
  const taskId = get(RUN_TABLE_URL_KEYS.taskId);
  if (taskId) state.taskId = taskId;

  return state;
}

/** Serialize run-table state to URLSearchParams (omit defaults). */
export function serializeRunTableUrlState(
  state: SupplyRunTableUrlState
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page !== DEFAULT_RUN_TABLE_URL_STATE.page) {
    params.set(RUN_TABLE_URL_KEYS.page, String(state.page));
  }
  if (state.pageSize !== DEFAULT_RUN_TABLE_URL_STATE.pageSize) {
    params.set(RUN_TABLE_URL_KEYS.pageSize, String(state.pageSize));
  }
  if (state.sort !== DEFAULT_RUN_TABLE_URL_STATE.sort) {
    params.set(RUN_TABLE_URL_KEYS.sort, state.sort);
  }
  if (state.dir !== DEFAULT_RUN_TABLE_URL_STATE.dir) {
    params.set(RUN_TABLE_URL_KEYS.dir, state.dir);
  }
  if (state.operation)
    params.set(RUN_TABLE_URL_KEYS.operation, state.operation);
  if (state.status) params.set(RUN_TABLE_URL_KEYS.status, state.status);
  if (state.modality) params.set(RUN_TABLE_URL_KEYS.modality, state.modality);
  if (state.channelKind)
    params.set(RUN_TABLE_URL_KEYS.channelKind, state.channelKind);
  if (state.catalogModelId)
    params.set(RUN_TABLE_URL_KEYS.catalogModelId, state.catalogModelId);
  if (state.deploymentId)
    params.set(RUN_TABLE_URL_KEYS.deploymentId, state.deploymentId);
  if (state.dataClass)
    params.set(RUN_TABLE_URL_KEYS.dataClass, state.dataClass);
  if (state.q) params.set(RUN_TABLE_URL_KEYS.q, state.q);
  if (state.taskId) params.set(RUN_TABLE_URL_KEYS.taskId, state.taskId);
  return params;
}

/** Round-trip helper for tests and shareable links. */
export function runTableStateToSearchString(
  state: SupplyRunTableUrlState
): string {
  const params = serializeRunTableUrlState(state);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function filterSupplyRuns(
  runs: readonly SupplyRunRecord[],
  state: SupplyRunTableUrlState
): SupplyRunRecord[] {
  return runs.filter((run) => {
    if (state.operation && run.operation !== state.operation) return false;
    if (state.status && run.status !== state.status) return false;
    if (state.modality && run.modality !== state.modality) return false;
    if (state.channelKind && run.channelKind !== state.channelKind)
      return false;
    if (state.catalogModelId && run.catalogModelId !== state.catalogModelId)
      return false;
    if (state.deploymentId && run.deploymentId !== state.deploymentId)
      return false;
    if (state.dataClass && run.dataClass !== state.dataClass) return false;
    if (state.taskId && run.taskId !== state.taskId) return false;
    if (state.q) {
      const hay = [
        run.id,
        run.taskId,
        run.catalogModelId,
        run.deploymentId,
        run.errorCode,
        run.errorMessage,
        run.accountId,
        run.workspaceId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
}

function compareRuns(
  a: SupplyRunRecord,
  b: SupplyRunRecord,
  sort: RunTableSortField,
  dir: RunTableSortDir
): number {
  const mul = dir === 'asc' ? 1 : -1;
  const av = a[sort];
  const bv = b[sort];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * mul;
  }
  return String(av).localeCompare(String(bv)) * mul;
}

export function sortSupplyRuns(
  runs: readonly SupplyRunRecord[],
  state: Pick<SupplyRunTableUrlState, 'sort' | 'dir'>
): SupplyRunRecord[] {
  return [...runs].sort((a, b) => compareRuns(a, b, state.sort, state.dir));
}

export interface SupplyRunTablePage {
  state: SupplyRunTableUrlState;
  total: number;
  totalPages: number;
  rows: SupplyRunRecord[];
  facets: {
    operations: SupplyOperation[];
    statuses: SupplyRunRecord['status'][];
    modalities: SupplyRunRecord['modality'][];
    channelKinds: SupplyRunRecord['channelKind'][];
    dataClasses: SupplyDataClass[];
  };
}

/** Fixture/reference query helper. Production consumes Core's server page. */
export function querySupplyRunTable(
  runs: readonly SupplyRunRecord[],
  state: SupplyRunTableUrlState
): SupplyRunTablePage {
  const filtered = filterSupplyRuns(runs, state);
  const sorted = sortSupplyRuns(filtered, state);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(state.page, totalPages);
  const start = (page - 1) * state.pageSize;
  const rows = sorted.slice(start, start + state.pageSize);

  const facetSource = runs;
  return {
    state: { ...state, page },
    total,
    totalPages,
    rows,
    facets: {
      operations: [...new Set(facetSource.map((r) => r.operation))],
      statuses: [...new Set(facetSource.map((r) => r.status))],
      modalities: [...new Set(facetSource.map((r) => r.modality))],
      channelKinds: [...new Set(facetSource.map((r) => r.channelKind))],
      dataClasses: [...new Set(facetSource.map((r) => r.dataClass))],
    },
  };
}

export function buildSupplyRunTablePage(
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot()
): SupplyRunTablePage {
  return {
    state: structuredClone(snapshot.runPage.query),
    total: snapshot.runPage.total,
    totalPages: snapshot.runPage.totalPages,
    rows: structuredClone(snapshot.runPage.rows),
    facets: structuredClone(snapshot.runPage.facets),
  };
}

/** Merge partial URL updates and reset page when filters change. */
export function updateRunTableUrlState(
  current: SupplyRunTableUrlState,
  patch: Partial<SupplyRunTableUrlState>
): SupplyRunTableUrlState {
  const next = { ...current, ...patch };
  const filterKeys: (keyof SupplyRunTableUrlState)[] = [
    'operation',
    'status',
    'modality',
    'channelKind',
    'catalogModelId',
    'deploymentId',
    'dataClass',
    'q',
    'taskId',
    'pageSize',
    'sort',
    'dir',
  ];
  const filtersChanged = filterKeys.some((key) => Object.hasOwn(patch, key));
  if (filtersChanged && patch.page === undefined) {
    next.page = 1;
  }
  return next;
}
