import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminPlanReferenceNumbersControl,
  MODEL_CATALOG_REFRESH_MS,
} from './admin-plan-reference-numbers-control';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

const referenceNumbers = {
  published: {
    growth: { copy: 1_300, image: 260, video: 26 },
    pro: { copy: 2_800, image: 560, video: 56 },
    starter: { copy: 500, image: 100, video: 10 },
    trial: { copy: 100, image: 20, video: 2 },
  },
  referenceModels: {
    copy: 'copy-default',
    image: 'image-default',
    video: 'video-default',
  },
};

const plans = [
  { credits: 100, id: 'trial' },
  { credits: 500, id: 'starter' },
  { credits: 1_300, id: 'growth' },
  { credits: 2_800, id: 'pro' },
];

let imageCreditCost = 10;

function catalog() {
  return {
    catalog: {
      capabilities: [],
      deployments: [],
      executionChannels: [],
      models: [
        {
          creditPricing: {
            'copy.generate': {
              creditCost: 1,
              failureRefundsCredits: true,
            },
          },
          displayName: '文案参考模型',
          id: 'copy-default',
          modality: 'llm',
          operations: ['copy.generate'],
          qualityRank: 1,
        },
        {
          creditPricing: {
            'image.generate': {
              creditCost: imageCreditCost,
              failureRefundsCredits: true,
            },
          },
          displayName: '图片参考模型（已改价）',
          id: 'image-default',
          modality: 'image',
          operations: ['image.generate'],
          qualityRank: 1,
        },
        {
          creditPricing: {
            'video.generate': {
              creditCost: 90,
              failureRefundsCredits: true,
              videoCreditCosts: { '15': 50, '30': 90, '60': 160 },
            },
          },
          displayName: '视频参考模型',
          id: 'video-default',
          modality: 'video',
          operations: ['video.generate'],
          qualityRank: 1,
        },
        {
          creditPricing: {
            'image.generate': {
              creditCost: 5,
              failureRefundsCredits: true,
            },
          },
          displayName: '图片备选参考模型',
          id: 'image-alternate',
          modality: 'image',
          operations: ['image.generate'],
          qualityRank: 1,
        },
      ],
      prices: [],
      providerProfiles: [],
      routes: [],
    },
    revisionId: 'catalog-revision-1',
    stage: 'published',
    workspaceId: 'workspace-admin',
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
  imageCreditCost = 10;
  p1Client.queryP1.mockReset();
  p1Client.commandP1.mockReset();
  p1Client.queryP1.mockImplementation(
    async (_module: string, request: { action: string }) => {
      if (request.action === 'config_list') {
        return [
          {
            effectiveValue: referenceNumbers,
            key: 'plan.credits.reference_numbers',
            revision: 4,
            storedValue: referenceNumbers,
          },
          ...plans.map((plan) => ({
            effectiveValue: { credits: plan.credits },
            key: `plan.credits.${plan.id}`,
            revision: 1,
            storedValue: { credits: plan.credits },
          })),
        ];
      }
      if (request.action === 'admin_catalog_control') return catalog();
      throw new Error(`Unexpected query ${request.action}`);
    }
  );
  p1Client.commandP1.mockResolvedValue({
    effectiveValue: referenceNumbers,
    key: 'plan.credits.reference_numbers',
    revision: 5,
    storedValue: referenceNumbers,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminPlanReferenceNumbersControl', () => {
  it('automatically refreshes a model price change into the deviation state', async () => {
    vi.useFakeTimers();
    imageCreditCost = 5;
    renderWithQueryClient(<AdminPlanReferenceNumbersControl />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      screen.getByTestId('reference-status-growth-image')
    ).toHaveTextContent('一致');
    imageCreditCost = 10;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS);
    });
    expect(
      screen.getByTestId('reference-status-growth-image')
    ).toHaveTextContent('偏离 100%');
  });

  it('allows a reference model per category and fixes video suggestions to the 15-second price', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<AdminPlanReferenceNumbersControl />);

    await screen.findByTestId('reference-suggestion-growth-image');
    expect(
      screen.getByTestId('reference-suggestion-growth-video')
    ).toHaveTextContent('26');

    await user.selectOptions(
      screen.getByLabelText('图片参考模型'),
      'image-alternate'
    );
    expect(
      screen.getByTestId('reference-suggestion-growth-image')
    ).toHaveTextContent('260');
    expect(
      screen.getByTestId('reference-status-growth-image')
    ).toHaveTextContent('一致');
  });

  it('surfaces a changed model price, adopts suggestions, then publishes only the confirmed values', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<AdminPlanReferenceNumbersControl />);

    await screen.findByTestId('reference-status-growth-image');
    expect(
      screen.getByTestId('reference-status-growth-image')
    ).toHaveTextContent('偏离 100%');
    expect(
      screen.getByTestId('reference-suggestion-growth-image')
    ).toHaveTextContent('130');
    expect(screen.getByTestId('reference-published-growth-image')).toHaveValue(
      260
    );

    await user.click(screen.getByRole('button', { name: '全部采用建议值' }));
    expect(screen.getByTestId('reference-published-growth-image')).toHaveValue(
      130
    );
    expect(
      screen.getByTestId('reference-status-growth-image')
    ).toHaveTextContent('一致');
    expect(p1Client.commandP1).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '确认发布' }));
    await user.type(screen.getByRole('textbox'), '同步已发布的参考数字');
    await user.click(screen.getByRole('button', { name: '确认发布' }));

    await waitFor(() =>
      expect(p1Client.commandP1).toHaveBeenCalledWith(
        'admin-config',
        expect.objectContaining({
          action: 'config_apply',
          payload: expect.objectContaining({
            expectedRevision: 4,
            key: 'plan.credits.reference_numbers',
            value: expect.objectContaining({
              published: expect.objectContaining({
                growth: { copy: 1_300, image: 130, video: 26 },
              }),
            }),
          }),
        })
      )
    );
  });
});
