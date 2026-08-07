import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminRuntimeConfigControl,
  editableAdminConfigItems,
} from './admin-runtime-config-control';
import { defaultAdminConfigValue } from './admin-config-field-model';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

const RETIRED_KEYS = ['plan.addons', 'plan.trial.enabled'] as const;

function retiredItem(key: (typeof RETIRED_KEYS)[number]) {
  const storedValue = key === 'plan.trial.enabled' ? false : [];
  return {
    activationEvidenceStatus: 'recorded_only',
    actorId: 'platform-admin',
    correlationId: `readonly-${key}`,
    createdAt: '2026-08-07T00:00:00.000Z',
    effectiveValue: storedValue,
    key,
    reason: 'retired',
    revision: 1,
    rolledBackToRevision: null,
    scope: 'global' as const,
    status: 'applied' as const,
    storedValue,
    wired: false,
    readOnly: true,
  };
}

function growthItem() {
  return {
    activationEvidenceStatus: 'recorded_only',
    actorId: 'platform-admin',
    correlationId: 'growth-live',
    createdAt: '2026-08-07T00:00:00.000Z',
    effectiveValue: defaultAdminConfigValue('plan.credits.growth'),
    key: 'plan.credits.growth',
    reason: 'live',
    revision: 3,
    rolledBackToRevision: null,
    scope: 'global' as const,
    status: 'applied' as const,
    storedValue: defaultAdminConfigValue('plan.credits.growth'),
    wired: true,
    readOnly: false,
  };
}

function renderWithQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  p1Client.queryP1.mockReset();
  p1Client.commandP1.mockReset();
});

describe('AdminRuntimeConfigControl read-only retired plan keys', () => {
  it('renders locked display rows without forms or unwired badges', async () => {
    p1Client.queryP1.mockImplementation(
      async (
        _module: string,
        request: { action: string; payload?: { key?: string } }
      ) => {
        if (request.action === 'config_list') {
          return RETIRED_KEYS.map(retiredItem);
        }
        if (request.action === 'config_history') return [];
        throw new Error(`Unexpected query ${request.action}`);
      }
    );

    renderWithQueryClient(
      <AdminRuntimeConfigControl keys={[...RETIRED_KEYS]} />
    );

    for (const key of RETIRED_KEYS) {
      const row = await screen.findByTestId(
        `admin-runtime-config-readonly-${key}`
      );
      expect(row).toBeTruthy();
      expect(
        document.querySelector(`[data-testid="admin-config-form-${key}"]`)
      ).toBeNull();
    }

    expect(screen.getAllByText('只读').length).toBeGreaterThan(0);
    expect(screen.queryByText('已记录（未接线）')).toBeNull();

    const save = screen.getByRole('button', { name: /审阅并记录/ });
    expect(save).toBeDisabled();
  });

  it('keeps save enabled only for editable keys and excludes readOnly from the submit set', async () => {
    const list = [growthItem(), ...RETIRED_KEYS.map(retiredItem)];
    p1Client.queryP1.mockImplementation(
      async (_module: string, request: { action: string }) => {
        if (request.action === 'config_list') return list;
        if (request.action === 'config_history') return [];
        throw new Error(`Unexpected query ${request.action}`);
      }
    );

    renderWithQueryClient(
      <AdminRuntimeConfigControl
        keys={['plan.credits.growth', ...RETIRED_KEYS]}
      />
    );

    expect(
      await screen.findByTestId('admin-config-form-plan.credits.growth')
    ).toBeTruthy();
    for (const key of RETIRED_KEYS) {
      expect(
        await screen.findByTestId(`admin-runtime-config-readonly-${key}`)
      ).toBeTruthy();
      expect(
        document.querySelector(`[data-testid="admin-config-form-${key}"]`)
      ).toBeNull();
    }

    const save = screen.getByRole('button', { name: /审阅并记录/ });
    expect(save).not.toBeDisabled();

    expect(editableAdminConfigItems(list).map((item) => item.key)).toEqual([
      'plan.credits.growth',
    ]);
    expect(
      editableAdminConfigItems(list).some((item) =>
        (RETIRED_KEYS as readonly string[]).includes(item.key)
      )
    ).toBe(false);

    // Key picker must not offer retired keys when mixed with editable ones.
    const keyTrigger = document.getElementById('admin-runtime-config-key');
    if (keyTrigger) {
      const picker =
        keyTrigger.closest('[data-slot]') ?? keyTrigger.parentElement;
      if (picker) {
        expect(within(picker as HTMLElement).queryByText(/加量包/)).toBeNull();
        expect(
          within(picker as HTMLElement).queryByText(/新店自动赠送试用/)
        ).toBeNull();
      }
    }
  });
});
