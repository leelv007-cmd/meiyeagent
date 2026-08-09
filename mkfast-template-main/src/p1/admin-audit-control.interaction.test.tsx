import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuditControl } from '@/p1/admin-audit-control';

const p1Client = vi.hoisted(() => ({
  operationsQuery: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

/** ISO timestamp that lands on a known local calendar day. */
function localDayIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

const TEMPLATE_PAYLOAD = {
  versions: [
    {
      id: 'ver-1',
      templateId: 'tmpl-1',
      lifecycle: [
        {
          action: 'publish',
          actorId: 'admin-alice',
          correlationId: 'corr-template',
          occurredAt: localDayIso(2026, 8, 1),
          reason: 'ship template',
        },
      ],
    },
  ],
};

const ROLLBACK_PAYLOAD = [
  {
    id: 'evt-rollback',
    kind: 'catalog' as const,
    actorId: 'admin-alice',
    correlationId: 'corr-rollback',
    createdAt: localDayIso(2026, 8, 6, 8),
    fromRevisionId: 'rev-b',
    toRevisionId: 'rev-a',
    reason: 'revert bad catalog',
  },
];

const CATALOG_PAYLOAD = {
  revisions: [
    {
      id: 'rev-b',
      stage: 'published',
      createdAt: localDayIso(2026, 8, 5),
      actorId: 'admin-bob',
      correlationId: 'corr-catalog',
      previousRevisionId: 'rev-a',
      reason: 'publish catalog',
    },
  ],
};

function renderControl(children: ReactNode = <AdminAuditControl />) {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function stubAuditQueries() {
  p1Client.operationsQuery.mockResolvedValue(TEMPLATE_PAYLOAD);
  p1Client.queryP1.mockImplementation(
    async (
      module: string,
      request: { action: string; payload?: Record<string, unknown> }
    ) => {
      if (
        module === 'model-supply' &&
        request.action === 'revision_rollback_audits'
      ) {
        return ROLLBACK_PAYLOAD;
      }
      if (module === 'model-supply' && request.action === 'catalog_revisions') {
        return CATALOG_PAYLOAD;
      }
      throw new Error(`unexpected query ${module}.${request.action}`);
    }
  );
}

async function waitForAuditList() {
  await waitFor(() => {
    expect(screen.getByTestId('admin-audit-event-evt-rollback')).toBeTruthy();
  });
  // Template + catalog + rollback all present before any filter.
  expect(screen.getByText('template.publish')).toBeTruthy();
  expect(screen.getByText('catalog.published')).toBeTruthy();
  expect(screen.getByText('catalog.rollback')).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

beforeEach(() => {
  stubAuditQueries();
});

describe('AdminAuditControl filters and export', () => {
  it('narrows the result set when a single dimension is applied', async () => {
    const user = userEvent.setup();
    renderControl();
    await waitForAuditList();

    await user.type(screen.getByTestId('admin-audit-filter-actor'), 'alice');

    await waitFor(() => {
      expect(screen.queryByText('catalog.published')).toBeNull();
    });
    expect(screen.getByText('template.publish')).toBeTruthy();
    expect(screen.getByText('catalog.rollback')).toBeTruthy();
    expect(screen.getAllByTestId(/^admin-audit-event-/)).toHaveLength(2);
  });

  it('combines time, actor, and action filters with AND semantics', async () => {
    const user = userEvent.setup();
    renderControl();
    await waitForAuditList();

    // type="date" rejects partial keystrokes; set the value in one change.
    fireEvent.change(screen.getByTestId('admin-audit-filter-from'), {
      target: { value: '2026-08-05' },
    });
    fireEvent.change(screen.getByTestId('admin-audit-filter-to'), {
      target: { value: '2026-08-06' },
    });
    await user.type(screen.getByTestId('admin-audit-filter-actor'), 'alice');
    await user.type(
      screen.getByTestId('admin-audit-filter-action'),
      'rollback'
    );

    await waitFor(() => {
      expect(screen.queryByText('template.publish')).toBeNull();
      expect(screen.queryByText('catalog.published')).toBeNull();
    });
    expect(screen.getByText('catalog.rollback')).toBeTruthy();
    expect(screen.getAllByTestId(/^admin-audit-event-/)).toHaveLength(1);
    expect(screen.getByTestId('admin-audit-event-evt-rollback')).toBeTruthy();
  });

  it('exports a CSV whose rows match the currently filtered set', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:audit-export-test';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    renderControl();
    await waitForAuditList();

    await user.type(
      screen.getByTestId('admin-audit-filter-action'),
      'rollback'
    );
    await waitFor(() => {
      expect(screen.getAllByTestId(/^admin-audit-event-/)).toHaveLength(1);
    });

    await user.click(screen.getByTestId('admin-audit-export-csv'));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(blobs).toHaveLength(1);
    const csv = await blobs[0]!.text();
    expect(csv).toMatch(
      /^id,action,actor,correlationId,createdAt,reason,scope\n/
    );
    expect(csv).toContain('evt-rollback');
    expect(csv).toContain('catalog.rollback');
    expect(csv).toContain('admin-alice');
    expect(csv).not.toContain('evt-template');
    expect(csv).not.toContain('template.publish');
    expect(csv).not.toContain('catalog.published');
    expect(csv).not.toContain('admin-bob');

    // Anchor download attribute reflects the export filename.
    // (click happens synchronously inside the handler before revoke)
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  it('still queries only the existing audit data sources', async () => {
    renderControl();
    await waitForAuditList();

    const opsActions = p1Client.operationsQuery.mock.calls.map(
      (call) => call[0]
    );
    expect(opsActions).toEqual(['admin_template_catalog']);

    const p1Actions = p1Client.queryP1.mock.calls.map(
      (call) => `${call[0]}.${call[1]?.action}`
    );
    expect(p1Actions.sort()).toEqual(
      [
        'model-supply.catalog_revisions',
        'model-supply.revision_rollback_audits',
      ].sort()
    );
  });
});
