import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaCommandError, runMediaCommand } from './media-tools.js';

test('runMediaCommand returns complete stdout and stderr', async () => {
  const result = await runMediaCommand(process.execPath, [
    '-e',
    "process.stdout.write('media-out'); process.stderr.write('media-note');",
  ]);

  assert.deepEqual(result, {
    stdout: 'media-out',
    stderr: 'media-note',
  });
});

test('runMediaCommand reports nonzero exit code and stderr', async () => {
  const args = [
    '-e',
    "process.stderr.write('media-failed'); process.exit(7);",
  ] as const;

  await assert.rejects(
    runMediaCommand(process.execPath, args),
    (error: unknown) => {
      assert.ok(error instanceof MediaCommandError);
      assert.equal(error.command, process.execPath);
      assert.deepEqual(error.args, args);
      assert.equal(error.exitCode, 7);
      assert.equal(error.stderr, 'media-failed');
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('runMediaCommand preserves the missing-command cause', async () => {
  const command = `meiye-missing-media-command-${process.pid}`;

  await assert.rejects(runMediaCommand(command, []), (error: unknown) => {
    assert.ok(error instanceof MediaCommandError);
    assert.equal(error.command, command);
    assert.equal(error.exitCode, null);
    assert.equal(error.stderr, '');
    assert.ok(error.cause instanceof Error);
    assert.equal((error.cause as NodeJS.ErrnoException).code, 'ENOENT');
    return true;
  });
});

test('runMediaCommand wraps an AbortSignal cancellation with its cause', async () => {
  const controller = new AbortController();
  const command = runMediaCommand(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1_000);'],
    controller.signal,
  );
  const abortTimer = setTimeout(() => controller.abort(), 25);

  try {
    await assert.rejects(command, (error: unknown) => {
      assert.ok(error instanceof MediaCommandError);
      assert.equal(error.exitCode, null);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.name, 'AbortError');
      assert.equal(
        (error.cause as NodeJS.ErrnoException).code,
        'ABORT_ERR',
      );
      return true;
    });
  } finally {
    clearTimeout(abortTimer);
  }
});
