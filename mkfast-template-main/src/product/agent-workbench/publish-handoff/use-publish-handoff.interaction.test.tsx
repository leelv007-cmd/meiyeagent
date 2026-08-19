import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { usePublishHandoff } from './use-publish-handoff';

const p1 = vi.hoisted(() => ({
  commandP1: vi.fn(),
  operationsQuery: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1);

beforeEach(() => {
  p1.commandP1.mockReset();
  p1.operationsQuery.mockReset();
  p1.queryP1.mockReset();
  p1.operationsQuery.mockResolvedValue([
    {
      id: 'package-1',
      revision: 7,
      variants: [{ platform: 'xiaohongshu', currentVersionId: 'version-7' }],
    },
  ]);
  p1.queryP1
    .mockResolvedValueOnce({ kind: 'skip', reason: 'no_publish_handoff' })
    .mockResolvedValue({
      chips: ['inquiry'],
      contentPackageRevision: 8,
      kind: 'ask',
      prompt: '发布后有人咨询吗？',
    });
  const prepared = {
    capability: {
      description: '请使用辅助交接。',
      label: '辅助交接',
      mode: 'assisted',
      showAssistedHandoff: true,
      showDirectPublish: false,
      showExportAndCopy: true,
    },
    contentPackageRef: { id: 'package-1', revision: 7 },
    copyBlocks: [],
    mobileHandoff: {
      contentPackageRef: { id: 'package-1', revision: 7 },
      expiresAt: '2026-08-11T00:00:00.000Z',
      handoffId: 'assisted-package-1-version-7',
      handoffUrl: '/dashboard/handoff/canonical-handoff-token-0001',
      platform: 'xiaohongshu',
      publishActor: 'merchant_self_publish',
      schemaVersion: 'publish-handoff/v1',
      systemDrivenPublishAllowed: false,
      token: 'canonical-handoff-token-0001',
    },
    orderedImagePaths: [],
    platform: 'xiaohongshu',
    publicationBindingRevision: 8,
    schemaVersion: 'publish-handoff/v1',
    workId: 'work-1',
  };
  p1.commandP1.mockImplementation(
    (_module: string, input: { action?: string }) => {
      if (input.action === 'prepare_mobile_publish_handoff') {
        return Promise.resolve(prepared);
      }
      if (input.action === 'result_export') {
        return Promise.resolve({ downloadUrl: '/api/core/p1/assets?key=zip' });
      }
      if (input.action === 'record_self_report_ask') {
        return Promise.resolve({ askId: 'ask-1' });
      }
      if (input.action === 'record_merchant_published') {
        return Promise.resolve({ id: 'package-1', revision: 9 });
      }
      return Promise.resolve({});
    }
  );
});

test('running self-report hydration does not suppress delivered handoff preparation', async () => {
  const hook = renderHook(
    ({ phase }) =>
      usePublishHandoff({
        packageId: 'package-1',
        phase,
        platform: 'xiaohongshu',
        variantVersionId: 'version-7',
        workId: 'work-1',
      }),
    { initialProps: { phase: 'running' } }
  );

  await waitFor(() => expect(p1.queryP1).toHaveBeenCalledTimes(1));
  expect(p1.commandP1).not.toHaveBeenCalledWith(
    'operations',
    expect.objectContaining({ action: 'prepare_mobile_publish_handoff' }),
    expect.any(String)
  );

  hook.rerender({ phase: 'delivered' });

  await waitFor(() =>
    expect(p1.commandP1).toHaveBeenCalledWith(
      'operations',
      {
        action: 'prepare_mobile_publish_handoff',
        payload: {
          expectedRevision: 7,
          packageId: 'package-1',
          platform: 'xiaohongshu',
          variantVersionId: 'version-7',
          workId: 'work-1',
        },
      },
      'prepare-mobile-publish-handoff:package-1:7:version-7:delivered'
    )
  );
  expect(hook.result.current.publishHandoffView?.mobileHandoff?.token).toBe(
    'canonical-handoff-token-0001'
  );
  expect(
    hook.result.current.publishHandoffView?.publicationBindingRevision
  ).toBe(8);
  await waitFor(() => expect(p1.queryP1).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(p1.commandP1).toHaveBeenCalledWith(
      'operations',
      expect.objectContaining({
        action: 'record_self_report_ask',
        payload: expect.objectContaining({ contentPackageRevision: 8 }),
      }),
      'self-report-ask:work-1'
    )
  );

  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  await act(() =>
    hook.result.current.onPublishHandoffDownloadZip('package.zip')
  );
  expect(p1.commandP1).toHaveBeenCalledWith(
    'result-delivery',
    {
      action: 'result_export',
      payload: {
        expectedRevision: 8,
        packageId: 'package-1',
        platform: 'xiaohongshu',
      },
    },
    'export:package-1:8:xiaohongshu'
  );
  click.mockRestore();

  await act(() =>
    hook.result.current.onPublishHandoffRecordPublished({
      contentPackageId: 'package-1',
      contentPackageRevision: 8,
    })
  );
  expect(p1.commandP1).toHaveBeenCalledWith(
    'operations',
    expect.objectContaining({
      action: 'record_merchant_published',
      payload: expect.objectContaining({ expectedRevision: 8 }),
    }),
    'merchant-published:package-1:8'
  );

  await act(() => hook.result.current.onSelfReportChip('inquiry'));
  expect(p1.commandP1).toHaveBeenCalledWith(
    'operations',
    expect.objectContaining({
      action: 'record_content_package_result_signal',
      payload: expect.objectContaining({ expectedRevision: 9 }),
    }),
    'self-report-signal:package-1:inquiry'
  );

  hook.rerender({ phase: 'running' });
  hook.rerender({ phase: 'delivered' });
  await waitFor(() =>
    expect(p1.operationsQuery.mock.calls.length).toBeGreaterThan(2)
  );
  expect(
    p1.commandP1.mock.calls.filter(
      ([module, input]) =>
        module === 'operations' &&
        (input as { action?: string }).action ===
          'prepare_mobile_publish_handoff'
    )
  ).toHaveLength(1);
});

test('delivered handoff failure exposes a recoverable merchant error', async () => {
  p1.commandP1.mockRejectedValueOnce(new Error('approval already consumed'));
  const hook = renderHook(() =>
    usePublishHandoff({
      packageId: 'package-1',
      phase: 'delivered',
      platform: 'xiaohongshu',
      variantVersionId: 'version-7',
      workId: 'work-1',
    })
  );

  await waitFor(() =>
    expect(hook.result.current.publishHandoffError).toContain('结果中心')
  );
  expect(hook.result.current.publishHandoffView).toBeNull();
  expect(p1.queryP1).not.toHaveBeenCalled();
});
