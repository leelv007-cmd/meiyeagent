import type { ProductState } from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { __resetAgentWorkbenchHostStoreForTests } from '@/product/agent-workbench/agent-event-store';
import {
  type CampaignPaidWorkProjection,
  campaignPaidWorkProjectionSchema,
} from './campaign-paid-work-client';
import { ComposerHome } from './composer-home';

const productClient = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  state: undefined as ProductState | undefined,
}));

vi.mock('@/product/client', () => ({
  useProductState: () => ({
    error: undefined,
    execute: productClient.execute,
    loading: false,
    pending: false,
    refresh: productClient.refresh,
    state: productClient.state,
  }),
}));
vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  window.sessionStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  __resetAgentWorkbenchHostStoreForTests();
  productClient.state = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('keeps Work 1 through concurrent Work 2 projection, then advances after exact delivery', async () => {
  const read = vi.fn(async () => CAMPAIGN);

  await renderComposerHome({ read });

  await waitFor(() =>
    expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
      'data-work-id',
      'work-1'
    )
  );
  expect(screen.getByTestId('campaign-work-2')).toHaveTextContent('task-2');
  expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
    'data-work-id',
    'work-1'
  );

  act(() => workflowStream('task-1').finish());

  await waitFor(() =>
    expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
      'data-work-id',
      'work-2'
    )
  );
  expect(
    screen
      .getAllByTestId('composer-delivery-card')
      .map((element) => element.getAttribute('data-work-id'))
  ).toEqual(['work-1']);
  expect(FakeEventSource.instances.at(-1)?.url).toContain(
    '/workflows/task-2/events'
  );
});

it('binds sequential Work 2 when Core projects it, without a session delivery turn', async () => {
  const firstOnly = campaignPaidWorkProjectionSchema.parse({
    ...CAMPAIGN,
    works: [
      createdWork(1),
      {
        approvalScope: 'single_work' as const,
        state: 'scheduled' as const,
        workOrdinal: 2 as const,
      },
    ],
  });
  let current = firstOnly;
  const read = vi.fn(async () => current);

  await renderComposerHome({ initial: firstOnly, read });

  await waitFor(() =>
    expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
      'data-work-id',
      'work-1'
    )
  );
  expect(screen.queryByTestId('campaign-work-2')).not.toBeInTheDocument();

  current = CAMPAIGN;

  await waitFor(
    () =>
      expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
        'data-work-id',
        'work-2'
      ),
    { timeout: 4_000 }
  );
  expect(screen.getByTestId('campaign-work-2')).toHaveTextContent('task-2');
  expect(
    screen.queryByTestId('composer-delivery-card')
  ).not.toBeInTheDocument();
  expect(FakeEventSource.instances.at(-1)?.url).toContain(
    '/workflows/task-2/events'
  );
});

it('shows invalid Campaign refresh as a fail-closed retry state', async () => {
  const user = userEvent.setup();
  const read = vi
    .fn<() => Promise<CampaignPaidWorkProjection>>()
    .mockImplementationOnce(async () =>
      campaignPaidWorkProjectionSchema.parse({
        ...CAMPAIGN,
        works: [createdWork(1), createdWork(1)],
      })
    )
    .mockResolvedValue(CAMPAIGN);

  await renderComposerHome({
    read,
  });

  expect(await screen.findByTestId('campaign-status-error')).toHaveTextContent(
    '不会切换下一个 Work'
  );
  expect(screen.getByTestId('campaign-work-1')).toHaveTextContent('task-1');
  await waitFor(() =>
    expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
      'data-work-id',
      'work-1'
    )
  );
  const work1Stream = workflowStream('task-1');
  act(() => work1Stream.finish());
  await waitFor(() =>
    expect(screen.getByTestId('composer-delivery-card')).toHaveAttribute(
      'data-work-id',
      'work-1'
    )
  );
  expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
    'data-work-id',
    'work-1'
  );

  await user.click(screen.getByTestId('campaign-status-retry'));

  await waitFor(() =>
    expect(
      screen.queryByTestId('campaign-status-error')
    ).not.toBeInTheDocument()
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('workbench-inspector-work-id')).toHaveAttribute(
    'data-work-id',
    'work-2'
  );
});

async function renderComposerHome(input: {
  initial?: CampaignPaidWorkProjection;
  read: (campaignId: string) => Promise<CampaignPaidWorkProjection>;
}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(campaignFetch);
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const rootRoute = createRootRoute();
  const route = createRoute({
    component: () => (
      <ComposerHome
        testHost={{
          campaign: {
            initial: input.initial ?? CAMPAIGN,
            read: input.read,
          },
          fixtureSubmit: true,
          viewportWidth: 1240,
        }}
      />
    ),
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([route]),
  });
  await router.load();

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function workflowStream(workflowId: string) {
  const encoded = encodeURIComponent(workflowId);
  const stream = FakeEventSource.instances.find((candidate) =>
    candidate.url.endsWith(`/workflows/${encoded}/events`)
  );
  if (!stream) throw new Error(`Missing workflow stream for ${workflowId}.`);
  return stream;
}

class FakeEventSource extends EventTarget {
  static readonly CLOSED = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly instances: FakeEventSource[] = [];

  readonly CLOSED = FakeEventSource.CLOSED;
  readonly CONNECTING = FakeEventSource.CONNECTING;
  readonly OPEN = FakeEventSource.OPEN;
  readonly url: string;
  readonly withCredentials = false;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = FakeEventSource.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  finish() {
    const match = this.url.match(/\/workflows\/([^/]+)\/events$/u);
    const workflowId = decodeURIComponent(match?.[1] ?? '');
    this.dispatchEvent(
      new MessageEvent('workflow.state', {
        data: JSON.stringify({
          occurredAt: '2026-08-13T00:00:00.000Z',
          snapshot: {
            delivery: {
              packageId: workflowId.replace('task', 'package'),
              revision: 1,
              versionId: workflowId.replace('task', 'version'),
            },
          },
          sourceRevision: 1,
          status: 'success',
          workflowId,
        }),
      })
    );
  }
}

async function campaignFetch(
  request: string | URL | Request,
  init?: RequestInit
) {
  const url =
    typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url;
  if (url === '/api/core/p1/harness/tasks') {
    return successResponse({ tasks: [] });
  }
  if (url.endsWith('/decision')) {
    return new Response(null, { status: 404 });
  }
  if (url.includes('/interaction')) {
    return successResponse(null);
  }
  if (url === '/api/core/p1/query') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string };
    if (body.action === 'marketing_identity_projection') {
      return successResponse({
        decisionRevision: 0,
        defaultDecision: null,
        defaultIdentity: null,
        identities: [],
      });
    }
  }
  return new Response(
    JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: 'Unavailable in this test.' },
      meta: { correlationId: 'corr-campaign-interaction' },
    }),
    { headers: { 'content-type': 'application/json' }, status: 503 }
  );
}

function successResponse(data: unknown) {
  return new Response(
    JSON.stringify({
      data,
      meta: { correlationId: 'corr-campaign-interaction' },
    }),
    { headers: { 'content-type': 'application/json' }, status: 200 }
  );
}

const CAMPAIGN = campaignPaidWorkProjectionSchema.parse({
  campaignId: 'campaign-1',
  campaignPlanRef: { id: 'campaign-1:plan', revision: 1 },
  planApproval: {
    approvalScope: 'plan_only',
    planOnlyNotice: 'This confirmation approves scheduling only.',
    requestId: 'confirmation-campaign-1-plan',
    reservedCredits: 0,
    status: 'confirmed',
  },
  works: [createdWork(1), createdWork(2)],
});

function createdWork(workOrdinal: 1 | 2) {
  return {
    approvalScope: 'single_work' as const,
    contentPackage: {
      expectedRevision: 0,
      id: `package-${workOrdinal}`,
    },
    makeReady: false,
    replayed: false,
    runId: `run-${workOrdinal}`,
    snapshot: {
      id: `snapshot-${workOrdinal}`,
      identity: { id: 'identity-1', revision: '1' },
      schemaVersion: 'creation-execution-snapshot/v1',
    },
    task: { id: `task-${workOrdinal}` },
    threadId: 'thread-1',
    usageReservation: { id: `reservation-${workOrdinal}` },
    work: { id: `work-${workOrdinal}` },
    workOrdinal,
  };
}
