/**
 * ResultAction write vs Works navigation (WORK-01 / R-P1-08).
 *
 * Export from Works is a Result deep-link. Only Result submits result_export.
 */
import { expect, test, vi } from 'vitest';

import {
  executeResultActionWrite,
  resultActionForRevision,
} from './result-action';
import type { ResultCommandTransport } from './use-result-commands';

const revision = {
  contentId: 'package-note',
  platform: 'xiaohongshu' as const,
  revision: 3,
  versionId: 'version-1',
  workId: 'work-note',
};

test('Result consumes ResultAction and is the only result_export writer', async () => {
  const transport = vi.fn<ResultCommandTransport>(async () => ({
    downloadUrl: '/api/core/p1/assets?objectKey=pkg.zip',
    receiptId: 'receipt-1',
  }));
  const plan = resultActionForRevision(revision, 'export');

  await executeResultActionWrite(plan, transport);

  expect(transport).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith(
    'result-delivery',
    {
      action: 'result_export',
      payload: {
        expectedRevision: 3,
        packageId: 'package-note',
        platform: 'xiaohongshu',
      },
    },
    'export:package-note:3:xiaohongshu'
  );
});

test('Works/Workbench ResultAction for export is a navigate, not a write call', () => {
  const transport = vi.fn<ResultCommandTransport>(async () => {
    throw new Error('Works must not submit result_export');
  });
  const fromWorks = resultActionForRevision(revision, 'export');
  const fromWorkbench = resultActionForRevision(revision, 'export');

  expect(fromWorks.href).toContain('/dashboard/results/work-note');
  expect(fromWorks.href).toContain('panel=delivery');
  expect(fromWorks.writer).toBe('result');
  expect(fromWorks.target).toEqual(fromWorkbench.target);
  expect(fromWorks.actionId).toBe(fromWorkbench.actionId);
  expect(transport).not.toHaveBeenCalled();
});
