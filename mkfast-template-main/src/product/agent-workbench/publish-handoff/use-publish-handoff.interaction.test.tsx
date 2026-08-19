import { renderHook, waitFor } from '@testing-library/react';
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
  p1.queryP1.mockResolvedValue({ kind: 'skip', reason: 'no_publish_handoff' });
  p1.commandP1.mockResolvedValue({
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
    publicationBindingRevision: 7,
    schemaVersion: 'publish-handoff/v1',
    workId: 'work-1',
  });
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
