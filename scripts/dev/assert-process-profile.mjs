import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  claimStackState,
  clearStackStateSync,
  readStackState,
  stackStatePathFromEnv,
} from './stack-state.mjs';

/**
 * Shared API/worker start-path check. start-stack writes the expected fingerprint
 * first; a later process must match. When someone launches core `dev` /
 * `dev:worker` without start-stack, the first process claims the file.
 */
const statePath = stackStatePathFromEnv();
const loaded = await loadExpectedProfile(statePath);
if (loaded.ownerToken) {
  process.once('exit', () => {
    clearStackStateSync(statePath, {
      ownerPid: process.pid,
      ownerToken: loaded.ownerToken,
    });
  });
}
assertPairedRuntimeProfile(process.env, loaded.expected);

async function loadExpectedProfile(path) {
  try {
    return {
      expected: await readStackState(path, { allowStarting: true }),
      ownerToken: undefined,
    };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('no running stack found')
    ) {
      throw error;
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'API/worker profile check requires DATABASE_URL (start with pnpm dev so start-stack writes the shared triple).',
    );
  }

  const { ownerToken, payload } = await claimStackState(process.env, { path });
  return { expected: payload, ownerToken };
}
