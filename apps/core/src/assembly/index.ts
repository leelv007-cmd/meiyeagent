import type { CoreRole } from './core-assembly.js';

export async function assembleCore(
  env: NodeJS.ProcessEnv,
  options: { role: CoreRole }
) {
  if (options.role === 'worker') {
    const { startWorker } = await import('./worker-runtime.js');
    return startWorker(env);
  }
  const { startApi } = await import('./api-runtime.js');
  return startApi(env);
}
