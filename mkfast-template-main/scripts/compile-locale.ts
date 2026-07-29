/**
 * Locale compile CLI (#266): write-if-changed + mutex + dev fast fail.
 *
 * Compiles into a scratch stage directory, diffs it against
 * src/locale/paraglide per file, and only writes the difference. When the
 * output is already current the run is effectively read-only (no mtime
 * churn), so typecheck/test/test:interaction cannot tear down a running
 * dev server. When a live dev server is detected and a write would be
 * required, the compile fails fast instead of racing the vite plugin.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from '@inlang/paraglide-js';
import { paraglideCompilerOptions } from '../paraglide.config';
import {
  DEV_HEARTBEAT_FILE,
  PARAGLIDE_LOCK_DIR,
  PARAGLIDE_OUTDIR,
  STAGE_ROOT_DIR,
  acquireLock,
  applyDirectoryDiff,
  diffDirectories,
  readAliveDevHeartbeat,
} from './locale/paraglide-sync';

const requestedStructure = process.argv.includes('--dev')
  ? 'locale-modules'
  : 'message-modules';

const releaseLock = await acquireLock(PARAGLIDE_LOCK_DIR);
try {
  const devServer = readAliveDevHeartbeat(DEV_HEARTBEAT_FILE);
  // A live dev server's paraglide vite plugin maintains the locale-modules
  // layout in the outdir (upstream dev default, issue #486). Stage that
  // same layout while dev is up so a current output diffs empty and the
  // gates stay read-only; both layouts expose identical entrypoints.
  const outputStructure = devServer ? 'locale-modules' : requestedStructure;
  await mkdir(STAGE_ROOT_DIR, { recursive: true });
  const stageDir = await mkdtemp(join(STAGE_ROOT_DIR, `${outputStructure}-`));
  try {
    await compile({
      ...paraglideCompilerOptions,
      outdir: stageDir,
      outputStructure,
    });
    const diff = await diffDirectories(stageDir, PARAGLIDE_OUTDIR);
    if (diff.changed.length === 0 && diff.removed.length === 0) {
      console.log(
        `[locale:compile] ${outputStructure} output is up to date — ` +
          'no files written'
      );
    } else if (devServer) {
      console.error(
        `[locale:compile] 已拒绝写入 src/locale/paraglide：dev server 在跑` +
          `（pid ${devServer.pid}）：请换 worktree，或先停 dev 再编译。`
      );
      process.exitCode = 1;
    } else {
      await applyDirectoryDiff(stageDir, PARAGLIDE_OUTDIR, diff);
      console.log(
        `[locale:compile] ${outputStructure}: wrote ${diff.changed.length} ` +
          `file(s), removed ${diff.removed.length}`
      );
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
} finally {
  releaseLock();
}
