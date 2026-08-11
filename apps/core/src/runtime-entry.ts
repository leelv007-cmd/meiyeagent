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
  const { startWorker } = await import('./assembly/worker-runtime.js');
  await startWorker(process.env);
} else if (role === 'api' || role === 'start' || role === 'main') {
  const { startApi } = await import('./assembly/api-runtime.js');
  await startApi(process.env);
} else {
  console.error(
    `Unknown runtime role "${role}". Use "api" or "worker".`,
  );
  process.exit(2);
}
