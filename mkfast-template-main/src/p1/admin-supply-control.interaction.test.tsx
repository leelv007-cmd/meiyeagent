import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminSupplyAssociationView,
  AdminSupplyControl,
  AdminSupplyTaskDrilldown,
} from '@/p1/admin-supply-control';
import { buildDefaultSupplyControlSnapshot } from '@/p1/admin-supply-fixture';
import {
  DEFAULT_RUN_TABLE_URL_STATE,
  type SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import {
  clearCredentialRotationHandoff,
  peekCredentialRotationHandoff,
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  resetCredentialRotationHandoffForTests,
  stageCredentialRotationHandoff,
} from '@/p1/provider-credential-rotation-handoff';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

const HANDOFF_RECEIPT_ID =
  'secure-write-123e4567-e89b-42d3-a456-426614174000';
const HANDOFF_ACCOUNT_ID = 'cred-provider-ark';

function impactPreview(id: string, scope: string) {
  return {
    id,
    scope,
    changes: ['Domain-calculated impact'],
    warnings: ['Domain-calculated warning'],
    reversible: true,
    expectedRevisionId: null,
    before: null,
    after: null,
  };
}

function routeDecision(surface: 'simulator' | 'task_audit' = 'simulator') {
  return {
    surface,
    hardFilter: {
      passedDeploymentIds: ['dep-text-ark', 'dep-text-tuzi'],
      excluded: [{ deploymentId: 'dep-text-old', reasons: ['data_class'] }],
    },
    sort: {
      layerOrder: [
        'quality_reliability_gate',
        'health_capacity_guardrail',
        'cost_optimization',
      ],
      ranked: [
        { deploymentId: 'dep-text-ark', rank: 1, band: 'production' },
        { deploymentId: 'dep-text-tuzi', rank: 2, band: 'canary' },
      ],
    },
    liveExclusions: [
      { deploymentId: 'dep-text-busy', reasons: ['capacity_exhausted'] },
    ],
    acceptanceBranch: {
      decision: 'safe_auto_fallback',
      reason: 'safe fallback is available',
      primaryDeploymentId: 'dep-text-ark',
      fallbackDeploymentId: 'dep-text-tuzi',
    },
    failClosed: false,
    failClosedReason: null,
    maxCost: {
      amountMicros: 2_500,
      currency: 'CNY',
      evidenceSource: 'catalog',
    },
    notSelectedReasons: [
      { deploymentId: 'dep-text-old', reasons: ['data_class'] },
    ],
    evidenceFreshness: [
      {
        deploymentId: 'dep-text-ark',
        criticalEvidence: [{ kind: 'conformance', status: 'fresh' }],
      },
    ],
    costEvidenceSource: [
      {
        deploymentId: 'dep-text-ark',
        source: 'catalog',
        amountMicros: 1_000,
      },
    ],
    dataProcessingLevel: {
      level: 'standard',
      protectedChannel: false,
      copy: '标准数据处理等级',
      primaryDataClass: 'public',
      dataClasses: ['public'],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  resetCredentialRotationHandoffForTests();
});

function renderWithQueryClient(children: ReactNode) {
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

function renderControl(
  snapshot?: ReturnType<typeof buildDefaultSupplyControlSnapshot>
) {
  return renderWithQueryClient(
    <AdminSupplyControl {...(snapshot ? { snapshot } : {})} />
  );
}

describe('AdminSupplyControl live data', () => {
  it('updates URL state controls and requests the selected server page', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockImplementation(async (_domain, request) => {
      const snapshot = buildDefaultSupplyControlSnapshot();
      snapshot.runPage.query = request.payload.runQuery;
      snapshot.runPage.total = 60;
      snapshot.runPage.totalPages = 3;
      return snapshot;
    });

    function Harness() {
      const [state, setState] = useState<SupplyRunTableUrlState>(
        DEFAULT_RUN_TABLE_URL_STATE
      );
      return (
        <AdminSupplyControl
          runTableState={state}
          onRunTableStateChange={setState}
        />
      );
    }

    renderWithQueryClient(<Harness />);
    const failed = await screen.findByRole('link', { name: '状态 failed' });
    expect(failed).toHaveAttribute(
      'href',
      expect.stringContaining('status=failed')
    );
    await user.click(failed);

    await waitFor(() =>
      expect(p1Client.queryP1).toHaveBeenLastCalledWith(
        'model-supply',
        {
          action: 'admin_supply_control',
          payload: {
            runQuery: expect.objectContaining({ page: 1, status: 'failed' }),
          },
        },
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByTestId('supply-run-table-share-link')).toHaveAttribute(
      'href',
      expect.stringContaining('status=failed')
    );

    await user.click(screen.getByRole('link', { name: '排序 latencyMs' }));
    await waitFor(() =>
      expect(p1Client.queryP1).toHaveBeenLastCalledWith(
        'model-supply',
        {
          action: 'admin_supply_control',
          payload: {
            runQuery: expect.objectContaining({
              page: 1,
              sort: 'latencyMs',
              status: 'failed',
            }),
          },
        },
        expect.any(AbortSignal)
      )
    );

    await user.click(screen.getByRole('link', { name: '每页 10' }));
    await waitFor(() =>
      expect(p1Client.queryP1).toHaveBeenLastCalledWith(
        'model-supply',
        {
          action: 'admin_supply_control',
          payload: {
            runQuery: expect.objectContaining({ page: 1, pageSize: 10 }),
          },
        },
        expect.any(AbortSignal)
      )
    );

    await user.click(screen.getByTestId('supply-run-table-next'));
    await waitFor(() =>
      expect(p1Client.queryP1).toHaveBeenLastCalledWith(
        'model-supply',
        {
          action: 'admin_supply_control',
          payload: {
            runQuery: expect.objectContaining({ page: 2, pageSize: 10 }),
          },
        },
        expect.any(AbortSignal)
      )
    );
  });

  it('loads the production snapshot from the model-supply admin query', async () => {
    const snapshot = buildDefaultSupplyControlSnapshot();
    snapshot.catalogRevisionId = 'live-admin-supply-revision';
    p1Client.queryP1.mockResolvedValueOnce(snapshot);

    renderControl();

    expect(screen.getByTestId('supply-control-loading')).toBeInTheDocument();
    expect(
      await screen.findByTestId('supply-control-center-panel')
    ).toHaveAttribute('data-catalog-revision-id', 'live-admin-supply-revision');
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'model-supply',
      {
        action: 'admin_supply_control',
        payload: {
          runQuery: {
            dir: 'desc',
            page: 1,
            pageSize: 20,
            sort: 'startedAt',
          },
        },
      },
      expect.any(AbortSignal)
    );
    // F-J-02: live always mounts route simulator (idle until route_simulate).
    const simulator = screen.getByTestId('supply-route-simulator-panel');
    expect(simulator).toHaveAttribute('data-status', 'idle');
    expect(
      screen.getByTestId('supply-route-simulator-idle')
    ).toBeInTheDocument();
  });

  it('shows an honest error instead of falling back to the demo fixture', async () => {
    p1Client.queryP1.mockRejectedValueOnce(new Error('Core unavailable'));

    renderControl();

    expect(await screen.findByTestId('supply-control-error')).toHaveTextContent(
      'Core unavailable'
    );
    expect(screen.queryByTestId('supply-control-center-panel')).toBeNull();
  });

  it('loads standalone association views from the same live admin snapshot', async () => {
    p1Client.queryP1.mockResolvedValueOnce(buildDefaultSupplyControlSnapshot());

    renderWithQueryClient(<AdminSupplyAssociationView viewId="model" />);

    expect(
      await screen.findByTestId('supply-association-views-panel')
    ).toBeInTheDocument();
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'model-supply',
      {
        action: 'admin_supply_control',
        payload: {
          runQuery: {
            dir: 'desc',
            page: 1,
            pageSize: 20,
            sort: 'startedAt',
          },
        },
      },
      expect.any(AbortSignal)
    );
  });

  it('fails standalone task drilldown honestly when the live snapshot is unavailable', async () => {
    p1Client.queryP1.mockRejectedValueOnce(
      new Error('Task supply unavailable')
    );

    renderWithQueryClient(<AdminSupplyTaskDrilldown taskId="task-image-002" />);

    expect(await screen.findByTestId('supply-control-error')).toHaveTextContent(
      'Task supply unavailable'
    );
    expect(screen.queryByTestId('supply-task-drilldown')).toBeNull();
  });
});

describe('AdminSupplyControl governed actions', () => {
  it('requires a target and impact reason before executing a secret-free command', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-isolate-1', 'channel:channel-ark-direct')
    );
    p1Client.commandP1.mockResolvedValueOnce({ correlationId: 'audit-corr-1' });
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'channel_isolate'
      );
    expect(row).toBeDefined();
    if (!row) throw new Error('channel isolate row missing');

    const actionButton = within(row).getByRole('button', { name: '渠道隔离' });
    expect(actionButton).toBeDisabled();

    await user.click(
      within(row).getByRole('combobox', { name: '渠道隔离目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'channel-ark-direct · official_direct',
      })
    );
    expect(actionButton).toBeDisabled();
    await user.type(
      within(row).getByRole('textbox', { name: '渠道隔离原因' }),
      'Isolate unhealthy channel after impact review'
    );
    expect(actionButton).toBeEnabled();
    await user.click(actionButton);

    const dialog = await screen.findByRole('dialog', { name: '渠道隔离' });
    expect(dialog).toHaveTextContent('channel-ark-direct');
    expect(dialog).toHaveTextContent('Domain-calculated impact');
    expect(dialog).toHaveTextContent('可逆性：可逆');
    expect(p1Client.queryP1).toHaveBeenCalledWith('model-supply', {
      action: 'admin_supply_action_preview',
      payload: expect.objectContaining({
        action: 'isolate',
        expectedRevisionId: 'channel-ark-direct:lifecycle:r0',
        idempotencyKey: expect.any(String),
        reason: 'Isolate unhealthy channel after impact review',
        target: {
          resourceId: 'channel-ark-direct',
          resourceType: 'channel',
        },
      }),
    });
    await user.click(
      within(dialog).getByRole('button', { name: '确认渠道隔离' })
    );

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledTimes(1));
    const [module, call, idempotencyKey] =
      p1Client.commandP1.mock.calls[0] ?? [];
    expect(module).toBe('model-supply');
    expect(call).toMatchObject({
      action: 'admin_supply_action',
      payload: {
        action: 'isolate',
        approvedPreviewId: 'preview-isolate-1',
        expectedRevisionId: 'channel-ark-direct:lifecycle:r0',
        idempotencyKey: expect.any(String),
        reason: 'Isolate unhealthy channel after impact review',
        target: {
          resourceId: 'channel-ark-direct',
          resourceType: 'channel',
        },
      },
    });
    expect(idempotencyKey).toEqual(expect.any(String));
    expect(idempotencyKey).toBe(call.payload.idempotencyKey);
    expect(JSON.stringify(call)).not.toMatch(
      /api[_-]?key|authorization|bearer|password|secret|token/i
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '渠道隔离执行成功'
    );
    expect(screen.getByRole('link', { name: '查看审计' })).toHaveAttribute(
      'href',
      '/admin/audit'
    );
  });

  it('keeps the dialog open and exposes the command failure', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-isolate-failure', 'channel:channel-ark-direct')
    );
    p1Client.commandP1.mockRejectedValueOnce(new Error('CAS conflict'));
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'channel_isolate'
      );
    if (!row) throw new Error('channel isolate row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '渠道隔离目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'channel-ark-direct · official_direct',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '渠道隔离原因' }),
      'Retry after reviewing conflict'
    );
    await user.click(within(row).getByRole('button', { name: '渠道隔离' }));

    const dialog = await screen.findByRole('dialog', { name: '渠道隔离' });
    await user.click(
      within(dialog).getByRole('button', { name: '确认渠道隔离' })
    );

    expect(
      await screen.findByTestId('supply-governed-action-result')
    ).toHaveTextContent(/执行失败.*CAS conflict/);
    expect(
      screen.getByRole('dialog', { name: '渠道隔离' })
    ).toBeInTheDocument();
  });

  it('uses a domain preview then dispatches governed read-like actions through the generic command', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce({
      ...impactPreview('preview-route-1', 'operation:copy.generate'),
      routeDecision: routeDecision(),
    });
    p1Client.commandP1.mockResolvedValueOnce({
      correlationId: 'route-corr-1',
      routeDecision: {
        simulator: routeDecision(),
        taskAudit: routeDecision('task_audit'),
      },
    });
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'route_simulate'
      );
    if (!row) throw new Error('route simulate row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '路由模拟目标' })
    );
    await user.click(
      await screen.findByRole('option', { name: 'copy.generate' })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '路由模拟原因' }),
      'Inspect route decision before publishing changes'
    );
    await user.click(within(row).getByRole('button', { name: '路由模拟' }));

    const dialog = await screen.findByRole('dialog', { name: '路由模拟' });
    expect(dialog).toHaveTextContent('Domain-calculated impact');
    expect(dialog).toHaveTextContent('safe_auto_fallback');
    await user.click(
      within(dialog).getByRole('button', { name: '确认路由模拟' })
    );

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledTimes(1));
    expect(p1Client.commandP1).toHaveBeenCalledWith(
      'model-supply',
      {
        action: 'admin_supply_action',
        payload: expect.objectContaining({
          action: 'route_simulate',
          approvedPreviewId: 'preview-route-1',
          expectedRevisionId: expect.any(String),
          idempotencyKey: expect.any(String),
          parameters: {
            dataClass: [],
            failureScenario: 'success',
            operation: 'copy.generate',
            selection: {
              fallbackConsent: true,
              mode: 'auto',
              profile: 'balanced',
            },
            unavailableDeploymentIds: [],
          },
          reason: 'Inspect route decision before publishing changes',
          target: {
            resourceId: 'copy.generate',
            resourceType: 'operation',
          },
        }),
      },
      expect.any(String)
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '路由模拟执行成功'
    );
    const details = screen.getByTestId('supply-governed-action-details');
    expect(details).toHaveTextContent(
      /硬过滤.*三层排序.*实时排除.*最大成本.*接受态.*未选原因.*证据新鲜度.*成本证据来源.*数据处理等级.*Fail closed/
    );
    expect(details).toHaveTextContent('safe_auto_fallback');
    // F-J-02: dedicated simulator panel projects Core routeDecision (ready).
    const simulator = screen.getByTestId('supply-route-simulator-panel');
    expect(simulator).toHaveAttribute('data-status', 'ready');
    expect(simulator).toHaveTextContent('safe_auto_fallback');
    expect(screen.getByTestId('supply-route-hard-filter')).toBeInTheDocument();
  });

  it('binds provider probes to a deployment and its exact operation', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-probe-1', 'deployment:dep-text-ark')
    );
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'connectivity_probe'
      );
    if (!row) throw new Error('connectivity probe row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '连通探针目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'dep-text-ark · copy.generate',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '连通探针原因' }),
      'Verify provider connectivity before activation'
    );
    await user.click(within(row).getByRole('button', { name: '连通探针' }));

    expect(
      await screen.findByRole('dialog', { name: '连通探针' })
    ).toHaveTextContent('Domain-calculated impact');
    expect(p1Client.queryP1).toHaveBeenCalledWith('model-supply', {
      action: 'admin_supply_action_preview',
      payload: expect.objectContaining({
        action: 'connectivity_probe',
        expectedRevisionId: 'dep-text-ark:r1',
        parameters: {
          deploymentId: 'dep-text-ark',
          operation: 'copy.generate',
          probeKind: 'connectivity',
        },
        target: {
          resourceId: 'dep-text-ark',
          resourceType: 'deployment',
        },
      }),
    });
  });

  it('binds candidate validation to the selected route-policy revision', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview(
        'preview-route-policy-1',
        'route_policy:route-image-generate:r2'
      )
    );
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') ===
          'candidate_config_validate'
      );
    if (!row) throw new Error('candidate validation row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '候选配置验证目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'image.generate · route-image-generate:r2',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '候选配置验证原因' }),
      'Validate route candidate before publishing'
    );
    await user.click(within(row).getByRole('button', { name: '候选配置验证' }));

    expect(
      await screen.findByRole('dialog', { name: '候选配置验证' })
    ).toHaveTextContent('Domain-calculated impact');
    expect(p1Client.queryP1).toHaveBeenCalledWith('model-supply', {
      action: 'admin_supply_action_preview',
      payload: expect.objectContaining({
        action: 'candidate_config_validate',
        expectedRevisionId: 'route-image-generate:r2',
        parameters: expect.objectContaining({
          failureScenario: 'success',
          operation: 'image.generate',
          routePolicyRevisionId: 'route-image-generate:r2',
          selection: {
            fallbackConsent: true,
            mode: 'auto',
            profile: 'quality',
          },
          unavailableDeploymentIds: [],
        }),
        target: {
          resourceId: 'route-image-generate:r2',
          resourceType: 'route_policy',
        },
      }),
    });
  });

  it('creates an immutable route-policy candidate through the governed action boundary', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce({
      ...impactPreview(
        'preview-route-policy-save-r3',
        'route_policy:route-image-generate:r2'
      ),
      expectedRevisionId: 'route-image-generate:r2',
    });
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'candidate_config_save'
      );
    if (!row) throw new Error('candidate save row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '候选配置保存目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'image.generate · route-image-generate:r2',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '候选 Revision ID' }),
      'route-image-generate:r3'
    );
    await user.clear(
      within(row).getByRole('textbox', { name: '候选 Deployment IDs' })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '候选 Deployment IDs' }),
      'dep-image-ark, dep-image-openai'
    );
    await user.type(
      within(row).getByRole('textbox', { name: '候选配置保存原因' }),
      'Save reviewed quality route candidate'
    );
    await user.click(within(row).getByRole('button', { name: '候选配置保存' }));

    await screen.findByRole('dialog', { name: '候选配置保存' });
    expect(p1Client.queryP1).toHaveBeenCalledWith('model-supply', {
      action: 'admin_supply_action_preview',
      payload: expect.objectContaining({
        action: 'candidate_config_save',
        expectedRevisionId: 'route-image-generate:r2',
        parameters: {
          candidate: {
            id: 'route-image-generate',
            operation: 'image.generate',
            qualityTier: 'quality',
            hardConstraints: ['data_class_allowed', 'health_not_blocking'],
            candidateDeploymentIds: ['dep-image-ark', 'dep-image-openai'],
            maxAttempts: 2,
            fallbackAuthorized: true,
            revisionId: 'route-image-generate:r3',
          },
        },
        target: {
          resourceId: 'route-image-generate:r2',
          resourceType: 'route_policy',
        },
      }),
    });
  });

  it('offers real route-policy revisions for publish and rollback, not the current catalog head', async () => {
    const user = userEvent.setup();
    renderControl(buildDefaultSupplyControlSnapshot());

    for (const [actionId, label] of [
      ['publish', '发布'],
      ['rollback', '回滚'],
    ] as const) {
      const row = screen
        .getAllByTestId('supply-governed-action-row')
        .find(
          (candidate) => candidate.getAttribute('data-action-id') === actionId
        );
      if (!row) throw new Error(`${actionId} row missing`);
      const select = within(row).getByRole('combobox', {
        name: `${label}目标`,
      });
      await user.click(select);
      expect(
        await screen.findByRole('option', {
          name: 'copy.generate · route-copy-generate:r3',
        })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('option', {
          name: /catalog-default-expand/i,
        })
      ).toBeNull();
      // Close listbox before opening the next action's select.
      await user.keyboard('{Escape}');
    }
  });

  it('offers non-head candidates for validation/publish and retained history for rollback', async () => {
    const user = userEvent.setup();
    const snapshot = buildDefaultSupplyControlSnapshot();
    const current = snapshot.routePolicies[0]!;
    const candidate = {
      ...current,
      id: 'route-copy-generate:r4',
      revisionId: 'route-copy-generate:r4',
    };
    const previous = {
      ...current,
      id: 'route-copy-generate:r2',
      revisionId: 'route-copy-generate:r2',
    };
    p1Client.queryP1.mockResolvedValueOnce({
      ...impactPreview(
        'preview-route-policy-candidate-r4',
        'route_policy:route-copy-generate:r4'
      ),
      expectedRevisionId: current.revisionId,
    });
    renderControl({
      ...snapshot,
      routePolicyRevisions: [previous, current, candidate],
      routePolicyPublicationHistory: [previous, current],
    });

    for (const [actionId, label] of [
      ['candidate_config_validate', '候选配置验证'],
      ['publish', '发布'],
    ] as const) {
      const row = screen
        .getAllByTestId('supply-governed-action-row')
        .find(
          (candidateRow) =>
            candidateRow.getAttribute('data-action-id') === actionId
        );
      if (!row) throw new Error(`${actionId} row missing`);
      const combobox = within(row).getByRole('combobox', {
        name: `${label}目标`,
      });
      expect(combobox).toBeInTheDocument();
      await user.click(combobox);
      expect(
        await screen.findByRole('option', {
          name: 'copy.generate · route-copy-generate:r4',
        })
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
    }

    const rollbackRow = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidateRow) =>
          candidateRow.getAttribute('data-action-id') === 'rollback'
      );
    if (!rollbackRow) throw new Error('rollback row missing');
    await user.click(
      within(rollbackRow).getByRole('combobox', { name: '回滚目标' })
    );
    expect(
      await screen.findByRole('option', {
        name: 'copy.generate · route-copy-generate:r2',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', {
        name: 'copy.generate · route-copy-generate:r4',
      })
    ).toBeNull();
    await user.keyboard('{Escape}');

    const validationRow = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidateRow) =>
          candidateRow.getAttribute('data-action-id') ===
          'candidate_config_validate'
      );
    if (!validationRow) throw new Error('candidate validation row missing');
    await user.click(
      within(validationRow).getByRole('combobox', {
        name: '候选配置验证目标',
      })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'copy.generate · route-copy-generate:r4',
      })
    );
    await user.type(
      within(validationRow).getByRole('textbox', {
        name: '候选配置验证原因',
      }),
      'Validate non-head candidate before publication'
    );
    await user.click(
      within(validationRow).getByRole('button', {
        name: '候选配置验证',
      })
    );
    await screen.findByRole('dialog', { name: '候选配置验证' });
    expect(p1Client.queryP1).toHaveBeenCalledWith('model-supply', {
      action: 'admin_supply_action_preview',
      payload: expect.objectContaining({
        action: 'candidate_config_validate',
        expectedRevisionId: current.revisionId,
        parameters: expect.objectContaining({
          routePolicyRevisionId: candidate.revisionId,
        }),
        target: {
          resourceId: candidate.revisionId,
          resourceType: 'route_policy',
        },
      }),
    });
  });

  it('requires a secure-write receipt for credential rotation and never accepts a raw secret', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-rotate-1', 'credential_account:cred-provider-ark')
    );
    p1Client.commandP1.mockResolvedValueOnce({
      correlationId: 'rotate-corr-1',
    });
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');
    const button = within(row).getByRole('button', { name: '凭据轮换' });
    await user.click(
      within(row).getByRole('combobox', { name: '凭据轮换目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: '方舟平台主账号 · active',
      })
    );
    expect(button).toBeDisabled();

    const receipt = within(row).getByRole('textbox', {
      name: '凭据轮换安全写入回执',
    });
    expect(receipt).toHaveAttribute('autocomplete', 'off');
    await user.type(receipt, 'raw-credential-value-must-never-leave-browser');
    expect(button).toBeDisabled();
    await user.clear(receipt);
    const issuedReceiptId = 'secure-write-123e4567-e89b-42d3-a456-426614174000';
    await user.type(receipt, issuedReceiptId);
    expect(button).toBeDisabled();
    await user.type(
      within(row).getByRole('textbox', { name: '凭据轮换原因' }),
      'Rotate expiring credential after secure write'
    );
    expect(button).toBeEnabled();
    await user.click(button);

    const dialog = await screen.findByRole('dialog', { name: '凭据轮换' });
    await user.click(
      within(dialog).getByRole('button', { name: '确认凭据轮换' })
    );

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledTimes(1));
    const call = p1Client.commandP1.mock.calls[0]?.[1];
    expect(call).toMatchObject({
      action: 'admin_supply_action',
      payload: {
        action: 'credential_rotate',
        approvedPreviewId: 'preview-rotate-1',
        parameters: { secureWriteReceiptId: issuedReceiptId },
        target: {
          resourceId: 'cred-provider-ark',
          resourceType: 'credential_account',
        },
      },
    });
    expect(JSON.stringify(call)).not.toMatch(
      /"(apiKey|authorization|password|secret|token|value)"\s*:/i
    );
  });

  it('prefills credential rotation from SPA handoff and clears handoff after success', async () => {
    const user = userEvent.setup();
    stageCredentialRotationHandoff({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: HANDOFF_ACCOUNT_ID,
      receiptId: HANDOFF_RECEIPT_ID,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-rotate-handoff', 'credential_account:cred-provider-ark')
    );
    p1Client.commandP1.mockResolvedValueOnce({
      correlationId: 'rotate-handoff-1',
      after: { secretVersion: 4 },
    });

    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');

    const receipt = within(row).getByTestId('supply-credential-rotate-receipt');
    expect(receipt).toHaveValue(HANDOFF_RECEIPT_ID);
    expect(receipt).toHaveAttribute('data-handoff-prefill', 'true');
    expect(
      within(row).getByTestId('supply-credential-rotate-handoff-hint')
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('combobox', { name: '凭据轮换目标' })
    ).toHaveTextContent(HANDOFF_ACCOUNT_ID);

    // No receiptId in share/external links on the supply surface.
    const anchors = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(anchors.some((href) => href.includes(HANDOFF_RECEIPT_ID))).toBe(
      false
    );

    await user.type(
      within(row).getByRole('textbox', { name: '凭据轮换原因' }),
      'Complete rotation via same-origin handoff'
    );
    await user.click(within(row).getByRole('button', { name: '凭据轮换' }));
    const dialog = await screen.findByRole('dialog', { name: '凭据轮换' });
    await user.click(
      within(dialog).getByRole('button', { name: '确认凭据轮换' })
    );

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalledTimes(1));
    expect(peekCredentialRotationHandoff()).toBeNull();
    expect(p1Client.commandP1.mock.calls[0]?.[1]).toMatchObject({
      action: 'admin_supply_action',
      payload: {
        action: 'credential_rotate',
        parameters: { secureWriteReceiptId: HANDOFF_RECEIPT_ID },
        target: {
          resourceId: HANDOFF_ACCOUNT_ID,
          resourceType: 'credential_account',
        },
      },
    });
  });

  it('clears handoff on wrong account binding before Core is called', async () => {
    const user = userEvent.setup();
    stageCredentialRotationHandoff({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: HANDOFF_ACCOUNT_ID,
      receiptId: HANDOFF_RECEIPT_ID,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');

    await user.click(
      within(row).getByRole('combobox', { name: '凭据轮换目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: '兔子中转主账号 · active',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '凭据轮换原因' }),
      'Attempt rotate with mismatched account binding'
    );
    await user.click(within(row).getByRole('button', { name: '凭据轮换' }));

    expect(
      await screen.findByTestId('supply-governed-action-result')
    ).toHaveTextContent(/绑定不匹配|不匹配/);
    expect(peekCredentialRotationHandoff()).toBeNull();
    expect(p1Client.queryP1).not.toHaveBeenCalled();
    expect(p1Client.commandP1).not.toHaveBeenCalled();
  });

  it('clears handoff when Core reports the receipt was already consumed', async () => {
    const user = userEvent.setup();
    stageCredentialRotationHandoff({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: HANDOFF_ACCOUNT_ID,
      receiptId: HANDOFF_RECEIPT_ID,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview('preview-rotate-dup', 'credential_account:cred-provider-ark')
    );
    p1Client.commandP1.mockRejectedValueOnce(
      new Error('The secure-write receipt has already been consumed.')
    );
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');

    await user.type(
      within(row).getByRole('textbox', { name: '凭据轮换原因' }),
      'Retry after first consumption should clear handoff'
    );
    await user.click(within(row).getByRole('button', { name: '凭据轮换' }));
    const dialog = await screen.findByRole('dialog', { name: '凭据轮换' });
    await user.click(
      within(dialog).getByRole('button', { name: '确认凭据轮换' })
    );

    expect(
      await screen.findByTestId('supply-governed-action-result')
    ).toHaveTextContent(/already been consumed|执行失败/);
    expect(peekCredentialRotationHandoff()).toBeNull();
  });

  it('clears handoff when Core reports the staged receipt has expired', async () => {
    const user = userEvent.setup();
    stageCredentialRotationHandoff({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: HANDOFF_ACCOUNT_ID,
      receiptId: HANDOFF_RECEIPT_ID,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    p1Client.queryP1.mockResolvedValueOnce(
      impactPreview(
        'preview-rotate-expired',
        'credential_account:cred-provider-ark'
      )
    );
    p1Client.commandP1.mockRejectedValueOnce(
      new Error('The secure-write receipt has expired.')
    );
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');

    await user.type(
      within(row).getByRole('textbox', { name: '凭据轮换原因' }),
      'Core expiry must drop the SPA handoff'
    );
    await user.click(within(row).getByRole('button', { name: '凭据轮换' }));
    const dialog = await screen.findByRole('dialog', { name: '凭据轮换' });
    await user.click(
      within(dialog).getByRole('button', { name: '确认凭据轮换' })
    );

    expect(
      await screen.findByTestId('supply-governed-action-result')
    ).toHaveTextContent(/has expired|执行失败/);
    expect(peekCredentialRotationHandoff()).toBeNull();
  });

  it('clears handoff on wrong workspace binding', () => {
    stageCredentialRotationHandoff({
      workspaceId: 'ws-other-merchant',
      accountId: HANDOFF_ACCOUNT_ID,
      receiptId: HANDOFF_RECEIPT_ID,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    renderControl(buildDefaultSupplyControlSnapshot());
    // Prefill binds against platform workspace and drops mismatched handoff.
    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'credential_rotate'
      );
    if (!row) throw new Error('credential rotate row missing');
    expect(
      within(row).getByTestId('supply-credential-rotate-receipt')
    ).toHaveValue('');
    expect(peekCredentialRotationHandoff()).toBeNull();
    clearCredentialRotationHandoff();
  });

  it('does not render secretReference on credential cards', () => {
    renderControl(buildDefaultSupplyControlSnapshot());
    const panel = screen.getByTestId('supply-credential-panel');
    expect(panel.textContent).not.toMatch(/secret:\/\//);
    expect(panel.textContent).not.toMatch(/secretReference/);
    expect(panel.innerHTML).not.toMatch(
      /sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9]/
    );
  });

  it('shows a preview failure without opening a synthetic impact dialog', async () => {
    const user = userEvent.setup();
    p1Client.queryP1.mockRejectedValueOnce(new Error('Preview unavailable'));
    renderControl(buildDefaultSupplyControlSnapshot());

    const row = screen
      .getAllByTestId('supply-governed-action-row')
      .find(
        (candidate) =>
          candidate.getAttribute('data-action-id') === 'channel_isolate'
      );
    if (!row) throw new Error('channel isolate row missing');
    await user.click(
      within(row).getByRole('combobox', { name: '渠道隔离目标' })
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'channel-ark-direct · official_direct',
      })
    );
    await user.type(
      within(row).getByRole('textbox', { name: '渠道隔离原因' }),
      'Review impact before isolation'
    );
    await user.click(within(row).getByRole('button', { name: '渠道隔离' }));

    expect(
      await screen.findByTestId('supply-governed-action-result')
    ).toHaveTextContent(/预览失败.*Preview unavailable/);
    expect(screen.queryByRole('dialog', { name: '渠道隔离' })).toBeNull();
    expect(p1Client.commandP1).not.toHaveBeenCalled();
  });
});
