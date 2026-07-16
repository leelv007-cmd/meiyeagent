import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyCanvasSnapshotCliUsage,
  runLegacyCanvasSnapshotCli,
} from './polotno-retirement-snapshot-cli.js';

test('snapshot CLI exposes its production contract before opening PostgreSQL', async () => {
  assert.deepEqual(await runLegacyCanvasSnapshotCli(['--help'], {}), {
    help: legacyCanvasSnapshotCliUsage,
  });
  assert.deepEqual(await runLegacyCanvasSnapshotCli(['--', '--help'], {}), {
    help: legacyCanvasSnapshotCliUsage,
  });
  await assert.rejects(
    runLegacyCanvasSnapshotCli(
      [
        '--workspace-id',
        'workspace-1',
        '--deployment',
        'production-cn',
        '--capture-id',
        'capture-1',
        '--object-inventory',
        '/tmp/objects.json',
      ],
      {}
    ),
    /DATABASE_URL is required/u
  );
});
