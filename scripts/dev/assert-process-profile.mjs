import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  claimStackState,
  readStackState,
  stackStatePathFromEnv,
} from './stack-state.mjs';

/**
 * Shared API/worker start-path check. start-stack writes the expected triple
 * first; a later process must match. When someone launches core `dev` /
 * `dev:worker` without start-stack, the first process claims the file.
 */
const statePath = stackStatePathFromEnv();
const expected = await loadExpectedProfile(statePath);
assertPairedRuntimeProfile(process.env, expected);

async function loadExpectedProfile(path) {
  try {
    return await readStackState(path);
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

  const { payload } = await claimStackState(process.env, { path });
  return payload;
}
