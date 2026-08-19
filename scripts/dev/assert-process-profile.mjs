import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  joinStackStateParticipant,
  leaveStackStateParticipant,
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
  let cleanupComplete = false;
  let cleanupPromise;
  process.on('beforeExit', async () => {
    if (cleanupComplete) return;
    cleanupPromise ??= leaveStackStateParticipant(statePath, {
      participantToken: loaded.participantToken,
      pid: process.pid,
    });
    try {
      const cleaned = await cleanupPromise;
      if (!cleaned) throw new Error('participant ownership no longer matches');
      cleanupComplete = true;
    } catch (error) {
      process.stderr.write(
        `Stack participant cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      cleanupComplete = true;
    }
  });
  process.once('exit', () => {
    if (cleanupComplete) return;
    const cleaned = leaveStackStateParticipantSync(statePath, {
      participantToken: loaded.participantToken,
      pid: process.pid,
    });
    if (!cleaned) queueParticipantCleanup();
  });

  function queueParticipantCleanup() {
    const cleanupSource = `
      import { pathToFileURL } from 'node:url';
      const state = await import(pathToFileURL(process.argv[1]));
      try {
        const cleaned = await state.leaveStackStateParticipant(
          process.env.MEIYE_STACK_STATE_PATH,
          {
            participantToken: process.env.MEIYE_PARTICIPANT_TOKEN,
            pid: Number(process.env.MEIYE_PARTICIPANT_PID),
          },
        );
        if (!cleaned) throw new Error('participant ownership no longer matches');
      } catch (error) {
        process.stderr.write('Stack participant cleanup failed: ' + error.message + '\\n');
        process.exitCode = 1;
      }
    `;
    try {
      const cleanup = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          cleanupSource,
          fileURLToPath(new URL('./stack-state.mjs', import.meta.url)),
        ],
        {
          detached: true,
          env: {
            ...process.env,
            MEIYE_PARTICIPANT_PID: String(process.pid),
            MEIYE_PARTICIPANT_TOKEN: loaded.participantToken,
            MEIYE_STACK_STATE_PATH: statePath,
          },
          stdio: ['ignore', 'ignore', 'inherit'],
        },
      );
      cleanup.once('error', (error) => {
        process.stderr.write(
          `Stack participant cleanup could not be queued: ${error.message}\n`,
        );
      });
      cleanup.unref();
    } catch (error) {
      process.stderr.write(
        `Stack participant cleanup could not be queued: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}
assertPairedRuntimeProfile(process.env, loaded.expected);
