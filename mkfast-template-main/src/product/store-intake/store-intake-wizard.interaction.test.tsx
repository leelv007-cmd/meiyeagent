import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetIntakeExperience, ParseTask } from '@meiye/contracts';

const commandP1 = vi.fn();
const queryP1 = vi.fn();
const uploadWorkspaceIntakeAsset = vi.fn();

vi.mock('@/p1/client', () => ({
  commandP1: (...args: unknown[]) => commandP1(...args),
  queryP1: (...args: unknown[]) => queryP1(...args),
}));

vi.mock('@/p1/workspace-asset-upload', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/p1/workspace-asset-upload')>();
  return {
    ...actual,
    uploadWorkspaceIntakeAsset: (...args: unknown[]) =>
      uploadWorkspaceIntakeAsset(...args),
  };
});

const { StoreIntakeWizard } = await import('./store-intake-wizard');

const EXPERIENCE: AssetIntakeExperience = {
  assetType: 'price_list',
  configRevision: 0,
  disclosure: '解析结果需要你确认。',
  draftSupply: { kind: 'fixture', open: true },
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

function renderWizard(store: typeof STORE | null = STORE) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StoreIntakeWizard
        product={{
          refresh: async () => undefined,
          state: { store, workspaceId: 'workspace-a' } as never,
        }}
      />
    </QueryClientProvider>
  );
}

const AUDIT_SENTENCE =
  '我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元';

async function walkTo(stepTestId: string) {
  await screen.findByTestId('store-intake-steps');
  for (let index = 0; index < 5; index += 1) {
    if (screen.queryByTestId(stepTestId)) return;
    fireEvent.click(screen.getByTestId('store-intake-next'));
  }
  throw new Error(`${stepTestId} was never reached`);
}

beforeEach(() => {
  commandP1.mockReset();
  queryP1.mockReset();
  uploadWorkspaceIntakeAsset.mockReset();
  let uploadCount = 0;
  uploadWorkspaceIntakeAsset.mockImplementation(
    async ({ file }: { file: File }) => {
      uploadCount += 1;
      const hex = String(uploadCount).padStart(2, '0').repeat(32);
      return {
        contentType: file.type || 'image/png',
        objectKey: `workspace-a/canvas/assets/intake-${file.name}`,
        sha256: hex.slice(0, 64),
        sizeBytes: 128,
        sourceUrl: `https://assets.example.test/${file.name}`,
      };
    }
  );
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
  it('walks the five server-declared steps and names the required one once', async () => {
    renderWizard();
    const steps = await screen.findByTestId('store-intake-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(5);
    // The chips used to carry a 「可跳过」/「必做」 tag each, which read as five
    // co-equal options rather than an ordered walk. Requiredness is stated
    // once now, beside the control that skips, and it names the step it means.
    expect(steps.textContent).not.toContain('可跳过');
    expect(steps.textContent).not.toContain('必做');
    const note = screen.getByTestId('store-intake-step-required-note');
    expect(note.textContent).toContain('你逐条点头');
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
      // D-174 industry sits last and matches no recommendation hint: ticking a
      // recommendation never pulls it forward, it is only ever offered after
      // everything the merchant came here for.
      'industry',
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
    // Reordering neither adds nor drops: the whole of STORE_INTAKE_FIELDS is
    // still asked, industry (D-174) included.
    expect(fields).toHaveLength(9);
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

  it('folds a spoken sentence into the confirm draft without a photo', async () => {
    renderWizard(null);
    await walkTo('store-intake-capture');
    fireEvent.change(screen.getByTestId('store-intake-sentence'), {
      target: { value: AUDIT_SENTENCE },
    });
    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-arrange');
    expect(
      screen.getByTestId('store-intake-arrange-result').textContent
    ).toMatch(/认出了 4/);
    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-confirm');
    expect(
      (screen.getByTestId('store-intake-field-name') as HTMLInputElement).value
    ).toBe('盘点美发工作室');
    expect(
      (screen.getByTestId('store-intake-field-city') as HTMLInputElement).value
    ).toBe('市中心');
    expect(
      (screen.getByTestId('store-intake-field-projectName') as HTMLInputElement)
        .value
    ).toBe('染发套餐');
    expect(
      (
        screen.getByTestId(
          'store-intake-field-projectPrice'
        ) as HTMLInputElement
      ).value
    ).toBe('388');
    expect(screen.getByTestId('store-intake-unconfirmed-name')).toBeTruthy();
    expect(
      commandP1.mock.calls.map((call) => (call[1] as { action: string }).action)
    ).not.toContain('store_workflow_capture_start');
  });

  it('sends finalize_store_intake from a Day-0 sentence confirmation', async () => {
    renderWizard(null);
    await walkTo('store-intake-capture');
    fireEvent.change(screen.getByTestId('store-intake-sentence'), {
      target: { value: AUDIT_SENTENCE },
    });
    await walkTo('store-intake-confirm');
    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      fireEvent.click(screen.getByTestId(`store-intake-confirm-${field}`));
    }
    fireEvent.click(
      screen.getByTestId('store-intake-field-projectPriceValidity-long-term')
    );
    fireEvent.click(
      screen.getByTestId('store-intake-confirm-projectPriceValidity')
    );
    commandP1.mockImplementation(
      async (_module: string, call: { action: string }) => {
        if (call.action === 'prepare_store_profile_import')
          return { batch: null };
        if (call.action === 'finalize_store_intake') return { facts: [] };
        throw new Error(`unexpected command ${call.action}`);
      }
    );
    expect(screen.getByTestId('store-intake-save')).toBeEnabled();
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
      (
        finalizations[0]![1] as {
          payload: { profilePatch: { name?: string } };
        }
      ).payload.profilePatch.name
    ).toBe('盘点美发工作室');
  });

  it('shows visible failure when finalize is refused and never pretends it saved', async () => {
    renderWizard(null);
    await walkTo('store-intake-capture');
    fireEvent.change(screen.getByTestId('store-intake-sentence'), {
      target: { value: AUDIT_SENTENCE },
    });
    await walkTo('store-intake-confirm');
    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      fireEvent.click(screen.getByTestId(`store-intake-confirm-${field}`));
    }
    fireEvent.click(
      screen.getByTestId('store-intake-field-projectPriceValidity-long-term')
    );
    fireEvent.click(
      screen.getByTestId('store-intake-confirm-projectPriceValidity')
    );
    commandP1.mockImplementation(
      async (_module: string, call: { action: string }) => {
        if (call.action === 'prepare_store_profile_import')
          return { batch: null };
        if (call.action === 'finalize_store_intake') {
          throw new Error('finalize refused');
        }
        throw new Error(`unexpected command ${call.action}`);
      }
    );
    fireEvent.click(screen.getByTestId('store-intake-save'));
    expect(await screen.findByTestId('store-intake-save-error')).toBeTruthy();
    expect(screen.queryByTestId('store-intake-saved')).toBeNull();
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

  it('shows a DOM-visible fixture demo label on capture and arrange', async () => {
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(screen.getByTestId('store-intake-next'));
    const captureLabel = await screen.findByTestId(
      'store-intake-fixture-label'
    );
    expect(captureLabel.textContent).toMatch(/演示档|Demo mode/u);
    expect(screen.queryByTestId('store-intake-parse-closed')).toBeNull();
    expect(
      (screen.getByTestId('store-intake-photo') as HTMLInputElement).disabled
    ).toBe(false);
    expect(
      (screen.getByTestId('store-intake-photos') as HTMLInputElement).disabled
    ).toBe(false);

    fireEvent.click(screen.getByTestId('store-intake-next'));
    const arrangeLabel = await screen.findByTestId(
      'store-intake-fixture-label'
    );
    expect(arrangeLabel.textContent).toMatch(/演示档|Demo mode/u);
  });

  it('fails closed when Core marks draftSupply closed', async () => {
    queryP1.mockImplementation(
      async (module: string, call: { action: string }) => {
        if (call.action === 'asset_intake_experience') {
          return {
            ...EXPERIENCE,
            draftSupply: { kind: 'production', open: false },
          };
        }
        if (call.action === 'store_facts_active') return [];
        if (call.action === 'config_defaults') {
          return { 'compliance.regulated_mode.default': false };
        }
        throw new Error(`unexpected query ${module}.${call.action}`);
      }
    );
    renderWizard();
    await screen.findByTestId('store-intake-steps');
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(screen.getByTestId('store-intake-next'));
    expect(await screen.findByTestId('store-intake-parse-closed')).toBeTruthy();
    expect(screen.queryByTestId('store-intake-fixture-label')).toBeNull();
    expect(
      (screen.getByTestId('store-intake-photo') as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('store-intake-photos') as HTMLInputElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-arrange');
    expect(screen.getByTestId('store-intake-parse-closed')).toBeTruthy();
    expect(screen.queryByTestId('store-intake-arrange-run')).toBeNull();
    expect(screen.queryByTestId('store-intake-batch-run')).toBeNull();
  });

  it('batch upload shows Core progress then per-draft confirm fields', async () => {
    const progressMessage =
      '正在整理你上传的资料，已完成 2/2 份；离开后也会继续处理。';
    let taskPolls = 0;
    queryP1.mockImplementation(
      async (module: string, call: { action: string; payload?: unknown }) => {
        if (call.action === 'asset_intake_experience') return EXPERIENCE;
        if (call.action === 'store_facts_active') return [];
        if (call.action === 'config_defaults') {
          return { 'compliance.regulated_mode.default': false };
        }
        if (call.action === 'asset_parse_task') {
          taskPolls += 1;
          const status =
            taskPolls === 1 ? ('running' as const) : ('completed' as const);
          const completed = taskPolls === 1 ? 1 : 2;
          return {
            carrierAttempt: 1,
            createdAt: '2026-08-05T00:00:00.000Z',
            disclosure: EXPERIENCE.disclosure,
            mode: 'batch_async',
            progress: {
              completed,
              message:
                taskPolls === 1
                  ? '正在整理你上传的资料，已完成 1/2 份；离开后也会继续处理。'
                  : progressMessage,
              total: 2,
            },
            sourceAssetIds: ['asset-a', 'asset-b'],
            status,
            taskId: (call.payload as { taskId: string }).taskId,
            updatedAt: '2026-08-05T00:00:01.000Z',
            workspaceId: 'workspace-a',
          } satisfies ParseTask;
        }
        if (call.action === 'asset_parse_task_drafts') {
          return {
            taskId: (call.payload as { taskId: string }).taskId,
            items: [
              {
                sourceAssetId: 'asset-a',
                draft: {
                  draftId: 'draft-a',
                  revision: 1,
                  workspaceId: 'workspace-a',
                  taskId: (call.payload as { taskId: string }).taskId,
                  sourceAssetId: 'asset-a',
                  parsedDocumentId: 'parsed-a',
                  target: 'price_list',
                  origin: 'parsed',
                  fields: [
                    {
                      key: 'offer.price',
                      value: { amount: 239, currency: 'CNY' },
                      provenance: 'photo_extract',
                      status: 'unconfirmed',
                    },
                  ],
                  factCandidates: [],
                  visualClassification: null,
                  parser: { kind: 'fixture' },
                  createdAt: '2026-08-05T00:00:00.000Z',
                },
              },
              {
                sourceAssetId: 'asset-b',
                draft: {
                  draftId: 'draft-b',
                  revision: 1,
                  workspaceId: 'workspace-a',
                  taskId: (call.payload as { taskId: string }).taskId,
                  sourceAssetId: 'asset-b',
                  parsedDocumentId: 'parsed-b',
                  target: 'price_list',
                  origin: 'parsed',
                  fields: [
                    {
                      key: 'service.name',
                      value: '头皮护理',
                      provenance: 'photo_extract',
                      status: 'unconfirmed',
                    },
                  ],
                  factCandidates: [],
                  visualClassification: null,
                  parser: { kind: 'fixture' },
                  createdAt: '2026-08-05T00:00:00.000Z',
                },
              },
            ],
          };
        }
        throw new Error(`unexpected query ${module}.${call.action}`);
      }
    );
    commandP1.mockImplementation(
      async (_module: string, call: { action: string; payload?: unknown }) => {
        if (call.action === 'prepare_store_profile_import') {
          return { batch: null };
        }
        if (call.action === 'start_parse_asset_batch') {
          return {
            carrierAttempt: 1,
            createdAt: '2026-08-05T00:00:00.000Z',
            disclosure: EXPERIENCE.disclosure,
            mode: 'batch_async',
            progress: {
              completed: 0,
              message:
                '正在整理你上传的资料，已完成 0/2 份；离开后也会继续处理。',
              total: 2,
            },
            sourceAssetIds: ['asset-a', 'asset-b'],
            status: 'queued',
            taskId: (call.payload as { taskId: string }).taskId,
            updatedAt: '2026-08-05T00:00:00.000Z',
            workspaceId: 'workspace-a',
          } satisfies ParseTask;
        }
        if (call.action === 'finalize_store_intake') return {};
        throw new Error(`unexpected command ${call.action}`);
      }
    );

    renderWizard();
    await screen.findByTestId('store-intake-steps');
    // skip examples + recommendations → say_or_upload
    fireEvent.click(screen.getByTestId('store-intake-next'));
    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-photos');

    const photos = screen.getByTestId(
      'store-intake-photos'
    ) as HTMLInputElement;
    const fileA = new File(['price-a'], 'price-a.png', { type: 'image/png' });
    const fileB = new File(['price-b'], 'price-b.png', { type: 'image/png' });
    Object.defineProperty(photos, 'files', {
      configurable: true,
      value: [fileA, fileB],
    });
    fireEvent.change(photos);

    await waitFor(() => {
      expect(uploadWorkspaceIntakeAsset).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText(/已上传 2 份/u)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-batch-run');
    fireEvent.click(screen.getByTestId('store-intake-batch-run'));

    await waitFor(
      () => {
        expect(
          commandP1.mock.calls.some(
            (call) =>
              (call[1] as { action: string }).action ===
              'start_parse_asset_batch'
          )
        ).toBe(true);
      },
      { timeout: 5_000 }
    );

    await waitFor(
      () => {
        expect(
          screen.getByTestId('store-intake-batch-progress').textContent
        ).toBe(progressMessage);
      },
      { timeout: 5_000 }
    );

    await waitFor(
      () => {
        expect(screen.getByTestId('store-intake-arrange-result')).toBeTruthy();
      },
      { timeout: 5_000 }
    );

    fireEvent.click(screen.getByTestId('store-intake-next'));
    await screen.findByTestId('store-intake-confirm');
    expect(
      (
        screen.getByTestId(
          'store-intake-field-projectPrice'
        ) as HTMLInputElement
      ).value
    ).toBe('239');
    expect(
      (screen.getByTestId('store-intake-field-projectName') as HTMLInputElement)
        .value
    ).toBe('头皮护理');

    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      fireEvent.click(screen.getByTestId(`store-intake-confirm-${field}`));
    }
    fireEvent.click(
      screen.getByTestId('store-intake-field-projectPriceValidity-long-term')
    );
    fireEvent.click(
      screen.getByTestId('store-intake-confirm-projectPriceValidity')
    );
    fireEvent.click(screen.getByTestId('store-intake-save'));

    await waitFor(() => {
      const finalize = commandP1.mock.calls.find(
        (call) =>
          (call[1] as { action: string }).action === 'finalize_store_intake'
      );
      expect(finalize).toBeTruthy();
    });
    const actions = commandP1.mock.calls.map(
      (call) => (call[1] as { action: string }).action
    );
    expect(actions).toContain('start_parse_asset_batch');
    expect(actions).toContain('finalize_store_intake');
    expect(actions).not.toContain('confirm_asset_intake_fact');
  });
});
