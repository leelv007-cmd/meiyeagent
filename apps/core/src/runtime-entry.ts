/**
 * Single immutable runtime entry for Core API and Worker.
 *
 * Production image builds this package once and starts either role:
 *   node --import tsx src/runtime-entry.ts api
 *   node --import tsx src/runtime-entry.ts worker
 *
 * Prefer the package scripts `start` / `start:worker` which pin the same entry.
 * A future emit step may replace the TypeScript loader with plain `node dist/…`
 * without changing the dual-command contract.
 */
import './instrumentation.js';

const role = (process.argv[2] ?? 'api').trim().toLowerCase();

if (role === 'worker' || role === 'start:worker') {
  await import('./job-worker.js');
} else if (role === 'api' || role === 'start' || role === 'main') {
  await import('./main.js');
} else {
  console.error(
    `Unknown runtime role "${role}". Use "api" or "worker".`,
  );
  process.exit(2);
}
