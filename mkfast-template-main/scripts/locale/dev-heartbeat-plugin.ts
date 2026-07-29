import type { Plugin } from 'vite';
import {
  DEV_HEARTBEAT_FILE,
  removeDevHeartbeat,
  writeDevHeartbeat,
} from './paraglide-sync';

let exitCleanupRegistered = false;

/**
 * Tiny dev-server heartbeat (#266): while `vite dev` runs it keeps a pid
 * file next to the paraglide output so `locale:compile` can detect the live
 * server in this worktree and refuse to rewrite src/locale/paraglide under
 * it. Cleanup is best effort — readers validate pid liveness, so a stale
 * file after a hard kill cannot cause false positives.
 */
export function paraglideDevHeartbeatPlugin(): Plugin {
  return {
    name: 'paraglide-dev-heartbeat',
    apply: 'serve',
    configureServer() {
      writeDevHeartbeat(DEV_HEARTBEAT_FILE, process.pid);
      if (!exitCleanupRegistered) {
        exitCleanupRegistered = true;
        process.once('exit', () => {
          removeDevHeartbeat(DEV_HEARTBEAT_FILE, process.pid);
        });
      }
    },
  };
}
