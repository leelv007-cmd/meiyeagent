import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetIntakeExperience } from '@meiye/contracts';

const commandP1 = vi.fn();
const queryP1 = vi.fn();

vi.mock('@/p1/client', () => ({
  commandP1: (...args: unknown[]) => commandP1(...args),
  queryP1: (...args: unknown[]) => queryP1(...args),
}));

const { StoreIntakeWizard } = await import('./store-intake-wizard');

const EXPERIENCE: AssetIntakeExperience = {
  assetType: 'price_list',
  configRevision: 0,
  disclosure: '解析结果需要你确认。',
  examples: [
    {
      exampleId: 'a',
      title: '价目表示例 A',
      summary: '拍一张就行',
      sourceRef: 'platform-sample:a',
    },
  ],
  industry: 'hair_care',
  recommendations: [
    { recommendationId: 'r1', label: '项目名称、日常价' },
    { recommendationId: 'r2', label: '团购价' },
  ],
  steps: [
    { id: 'see_examples', optional: true },
    { id: 'choose_recommendations', optional: true },
    { id: 'say_or_upload', optional: true },
    { id: 'ai_arrange', optional: true },
    { id: 'confirm_each', optional: false },
  ],
};

const STORE = {
  accounts: [],
  address: '湖墅南路 88 号',
  booking: '提前一天预约',
  brandVoice: '真实、克制',
  city: '杭州',
  district: '拱墅区',
  name: '青禾美甲',
  prohibitions: [],
  projects: [
    {
      confirmed: true,
      durationMinutes: 90,
      id: 'project-cat-eye',
      name: '透亮猫眼',
      price: 299,
    },
  ],
  regulated: false,
  revision: 3,
};

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StoreIntakeWizard
        product={{
          refresh: async () => undefined,
          state: { store: STORE, workspaceId: 'workspace-a' } as never,
        }}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  commandP1.mockReset();
  queryP1.mockReset();
  queryP1.mockImplementation(
    async (module: string, call: { action: string }) => {
      if (call.action === 'asset_intake_experience') return EXPERIENCE;
      if (call.action === 'store_facts_active') return [];
      if (call.action === 'config_defaults') {
        return { 'compliance.regulated_mode.default': false };
      }
      throw new Error(`unexpected query ${module}.${call.action}`);
    }
  );
  commandP1.mockImplementation(
    async (_module: string, call: { action: string }) => {
      if (call.action === 'prepare_store_profile_import')
        return { batch: null };
      throw new Error(`unexpected command ${call.action}`);
    }
  );
});

afterEach(() => {
  cleanup();
});

describe('StoreIntakeWizard', () => {
  it('walks the five server-declared steps and marks the last one required', async () => {
    renderWizard();
    const steps = await screen.findByTestId('store-intake-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(5);
    expect(
      steps.querySelector('[data-step="confirm_each"]')?.textContent
    ).toContain('必做');
    expect(await screen.findByTestId('store-intake-example')).toBeTruthy();

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByTestId('store-intake-next'));
    }
    expect(await screen.findByTestId('store-intake-confirm')).toBeTruthy();
  });

  it('keeps a photo-extracted value unconfirmed until the merchant confirms it', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByTestId('store-intake-next'));
    }
    const price = await screen.findByTestId('store-intake-field-projectPrice');
    // The prefill comes from the stored profile, so it is the merchant's own
    // number and carries no machine badge — but it is still not "answered".
    expect((price as HTMLInputElement).value).toBe('299');
    expect(
      screen.queryByTestId('store-intake-confirmed-projectPrice')
    ).toBeNull();

    fireEvent.click(screen.getByTestId('store-intake-confirm-projectPrice'));
    await waitFor(() => {
      expect(
        screen.getByTestId('store-intake-confirmed-projectPrice')
      ).toBeTruthy();
    });
  });

  it('sends exactly one finalize_store_intake for the confirmed fields', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByTestId('store-intake-next'));
    }
    await screen.findByTestId('store-intake-confirm');
    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      fireEvent.click(screen.getByTestId(`store-intake-confirm-${field}`));
    }
    // #244 — a price with no stated window cannot be saved at all.
    expect(screen.getByTestId('store-intake-save')).toBeDisabled();
    fireEvent.click(
      screen.getByTestId('store-intake-field-projectPriceValidity-long-term')
    );
    fireEvent.click(
      screen.getByTestId('store-intake-confirm-projectPriceValidity')
    );
    expect(screen.getByTestId('store-intake-save')).toBeEnabled();
    commandP1.mockImplementation(
      async (_module: string, call: { action: string }) => {
        if (call.action === 'prepare_store_profile_import')
          return { batch: null };
        if (call.action === 'finalize_store_intake') return { facts: [] };
        throw new Error(`unexpected command ${call.action}`);
      }
    );

    fireEvent.click(screen.getByTestId('store-intake-save'));
    await waitFor(() => {
      expect(screen.getByTestId('store-intake-saved')).toBeTruthy();
    });
    const finalizations = commandP1.mock.calls.filter(
      (call) =>
        (call[1] as { action: string }).action === 'finalize_store_intake'
    );
    expect(finalizations).toHaveLength(1);
    expect(
      (finalizations[0]![1] as { payload: { confirmations: unknown[] } })
        .payload.confirmations
    ).toHaveLength(4);
    expect(
      (
        finalizations[0]![1] as {
          payload: {
            profilePatch: {
              projects?: {
                upsert?: Array<{ priceValidUntil?: string | null }>;
              };
            };
          };
        }
      ).payload.profilePatch.projects?.upsert?.[0]?.priceValidUntil
    ).toBe(null);
  });

  it('leaves the wizard asking about every field when nothing is ticked', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByTestId('store-intake-next'));
    }
    const confirm = await screen.findByTestId('store-intake-confirm');
    expect(
      [...confirm.querySelectorAll('li[data-field]')].map((item) =>
        item.getAttribute('data-field')
      )
    ).toEqual([
      'name',
      'city',
      'projectName',
      'projectPrice',
      'projectPriceValidity',
      'district',
      'address',
      'booking',
    ]);
    expect(screen.queryByTestId('store-intake-recommended-projectPrice')).toBe(
      null
    );
  });

  it('ticking a recommendation changes what the merchant is asked and offered', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(
      await screen.findByTestId('store-intake-recommendation-r1')
    );

    // 少打字: the sentence box arrives with the ticked items as its skeleton.
    fireEvent.click(screen.getByTestId('store-intake-next'));
    const sentence = (await screen.findByTestId(
      'store-intake-sentence'
    )) as HTMLTextAreaElement;
    expect(sentence.value).toBe('项目名称：\n日常价：');

    // 重点问: the ticked fields lead the confirm step and say why.
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(screen.getByTestId('store-intake-next'));
    const confirm = await screen.findByTestId('store-intake-confirm');
    const fields = [...confirm.querySelectorAll('li[data-field]')].map((item) =>
      item.getAttribute('data-field')
    );
    expect(fields.slice(0, 3)).toEqual([
      'projectName',
      'projectPrice',
      'projectPriceValidity',
    ]);
    expect(fields).toHaveLength(8);
    expect(
      screen.getByTestId('store-intake-recommended-projectPrice')
    ).toBeTruthy();
    expect(screen.queryByTestId('store-intake-recommended-booking')).toBe(null);
  });

  it('never refills a sentence box the merchant emptied', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(
      await screen.findByTestId('store-intake-recommendation-r1')
    );
    fireEvent.click(screen.getByTestId('store-intake-next'));
    const sentence = (await screen.findByTestId(
      'store-intake-sentence'
    )) as HTMLTextAreaElement;
    expect(sentence.value).toBe('项目名称：\n日常价：');

    // 我不想在这儿打字 — the merchant clears the box and goes back to tick more.
    fireEvent.change(sentence, { target: { value: '' } });
    expect(sentence.value).toBe('');
    fireEvent.click(screen.getByTestId('store-intake-back'));
    fireEvent.click(
      await screen.findByTestId('store-intake-recommendation-r2')
    );
    fireEvent.click(screen.getByTestId('store-intake-next'));

    expect(
      (
        (await screen.findByTestId(
          'store-intake-sentence'
        )) as HTMLTextAreaElement
      ).value
    ).toBe('');
  });

  it('never writes through a retired direct StoreFact command', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByTestId('store-intake-next'));
    }
    await screen.findByTestId('store-intake-confirm');
    const actions = commandP1.mock.calls.map(
      (call) => (call[1] as { action: string }).action
    );
    expect(actions).not.toContain('store_fact_append');
    expect(actions).not.toContain('confirm_asset_intake_fact');
    expect(actions).not.toContain('record_asset_intake_batch');
  });
});
