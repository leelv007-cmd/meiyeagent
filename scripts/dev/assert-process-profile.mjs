import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  joinStackStateParticipant,
  leaveStackStateParticipantSync,
  stackStatePathFromEnv,
} from './stack-state.mjs';

/**
 * Shared API/worker start-path check. start-stack writes the expected fingerprint
 * first; a later process must match. When someone launches core `dev` /
 * `dev:worker` without start-stack, the first process claims the file.
 */
const statePath = stackStatePathFromEnv();
const loaded = await joinStackStateParticipant(process.env, {
  path: statePath,
});
if (loaded.participantToken) {
  process.once('exit', () => {
    leaveStackStateParticipantSync(statePath, {
      participantToken: loaded.participantToken,
      pid: process.pid,
    });
  });
}
assertPairedRuntimeProfile(process.env, loaded.expected);
