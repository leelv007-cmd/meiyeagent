import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CanvasSessionService,
  LaunchCodeError,
  LaunchCodeService,
  MemoryLaunchCodeRepository,
} from './launch-code.js';

const now = new Date('2026-07-16T08:00:00.000Z');
const bytes = (value: number) => () => new Uint8Array(32).fill(value);
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

test('issues a short-lived launch code while persisting only hashes', async () => {
  const repository = new MemoryLaunchCodeRepository();
  const service = new LaunchCodeService({
    repository,
    clock: () => now,
    randomBytes: bytes(7),
    access: {
      async canAccessWorkspace(input) {
        assert.deepEqual(input, {
          mainSessionId: 'main-session-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        });
        return true;
      },
      async canAccessProject() {
        return false;
      },
    },
  });

  const issued = await service.issue({
    audience: { kind: 'workspace' },
    bootstrap: {
      locale: 'zh-CN',
      returnTo: '/dashboard',
      theme: 'system',
    },
    browserNonce: 'browser-nonce',
    mainSessionId: 'main-session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  assert.equal(issued.expiresAt, '2026-07-16T08:00:45.000Z');
  const stored = repository.inspectLaunchCodes()[0];
  assert.ok(stored);
  assert.equal(stored.codeHash, sha256(issued.code));
  assert.equal(stored.browserNonceHash, sha256('browser-nonce'));
  assert.deepEqual(stored.bootstrap, {
    locale: 'zh-CN',
    returnTo: '/dashboard',
    theme: 'system',
  });
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(issued.code));
  assert.doesNotMatch(JSON.stringify(stored), /browser-nonce/);
});

test('project audience is rejected unless the project belongs to the workspace', async () => {
  const service = new LaunchCodeService({
    repository: new MemoryLaunchCodeRepository(),
    clock: () => now,
    randomBytes: bytes(3),
    access: {
      async canAccessWorkspace() {
        return true;
      },
      async canAccessProject() {
        return false;
      },
    },
  });

  await assert.rejects(
    service.issue({
      audience: { kind: 'project', projectId: 'project-other' },
      browserNonce: 'nonce',
      mainSessionId: 'main-session-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }),
    (error: unknown) =>
      error instanceof LaunchCodeError && error.code === 'NOT_FOUND'
  );
});

test('atomically exchanges a nonce-bound code exactly once', async () => {
  let randomCall = 0;
  const repository = new MemoryLaunchCodeRepository();
  const service = new LaunchCodeService({
    repository,
    clock: () => now,
    randomBytes: () => new Uint8Array(32).fill(++randomCall),
    access: {
      async canAccessWorkspace() {
        return true;
      },
      async canAccessProject() {
        return true;
      },
    },
  });
  const issued = await service.issue({
    audience: { kind: 'workspace' },
    bootstrap: {
      locale: 'zh-CN',
      returnTo: '/dashboard',
      theme: 'dark',
    },
    browserNonce: 'correct-nonce',
    mainSessionId: 'main-session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  const results = await Promise.allSettled([
    service.exchange({
      browserNonce: 'correct-nonce',
      code: issued.code,
    }),
    service.exchange({
      browserNonce: 'correct-nonce',
      code: issued.code,
    }),
  ]);

  assert.equal(
    results.filter(({ status }) => status === 'fulfilled').length,
    1
  );
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  const successful = results.find(
    (
      result
    ): result is PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.exchange>>
    > => result.status === 'fulfilled'
  );
  assert.ok(successful);
  assert.equal(successful.value.context.workspaceId, 'workspace-1');
  assert.deepEqual(successful.value.context.bootstrap, {
    locale: 'zh-CN',
    returnTo: '/dashboard',
    theme: 'dark',
  });
  const stored = repository.inspectSessions()[0];
  assert.ok(stored);
  assert.equal(stored.sessionTokenHash, sha256(successful.value.sessionToken));
  assert.doesNotMatch(
    JSON.stringify(stored),
    new RegExp(successful.value.sessionToken)
  );
});

test('rejects a stolen code when the browser nonce does not match', async () => {
  const repository = new MemoryLaunchCodeRepository();
  const service = new LaunchCodeService({
    repository,
    clock: () => now,
    randomBytes: bytes(9),
    access: {
      async canAccessWorkspace() {
        return true;
      },
      async canAccessProject() {
        return true;
      },
    },
  });
  const issued = await service.issue({
    audience: { kind: 'workspace' },
    browserNonce: 'right-nonce',
    mainSessionId: 'main-session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  await assert.rejects(
    service.exchange({ code: issued.code, browserNonce: 'wrong-nonce' }),
    (error: unknown) =>
      error instanceof LaunchCodeError && error.code === 'INVALID_LAUNCH_CODE'
  );
  assert.equal(repository.inspectSessions().length, 0);
});

test('canvas sessions enforce idle, absolute and upstream-session validity', async () => {
  let current = now;
  let upstreamValid = true;
  const repository = new MemoryLaunchCodeRepository();
  const launch = new LaunchCodeService({
    repository,
    clock: () => current,
    randomBytes: bytes(5),
    access: {
      async canAccessWorkspace() {
        return true;
      },
      async canAccessProject() {
        return true;
      },
    },
  });
  const issued = await launch.issue({
    audience: { kind: 'workspace' },
    browserNonce: 'nonce',
    mainSessionId: 'main-session-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });
  const exchanged = await launch.exchange({
    browserNonce: 'nonce',
    code: issued.code,
  });
  const sessions = new CanvasSessionService({
    repository,
    clock: () => current,
    upstream: {
      async isActive(input) {
        assert.equal(input.mainSessionId, 'main-session-1');
        return upstreamValid;
      },
    },
  });

  current = new Date('2026-07-16T08:10:00.000Z');
  assert.equal(
    (await sessions.authenticate(exchanged.sessionToken)).workspaceId,
    'workspace-1'
  );
  upstreamValid = false;
  await assert.rejects(
    sessions.authenticate(exchanged.sessionToken),
    (error: unknown) =>
      error instanceof LaunchCodeError && error.code === 'SESSION_EXPIRED'
  );
});
