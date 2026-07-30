import type { Server } from 'node:http';

export async function closeHttpServerWithDeadline(
  server: Server,
  deadlineMs: number,
) {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => server.closeAllConnections(), deadlineMs);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function shutdownCoreRuntime(input: {
  closeHttp(): Promise<void>;
  shutdownDbos(): Promise<void>;
  shutdownTracing(): Promise<void>;
  stopJobs(): Promise<void>;
  closePool(): Promise<void>;
}) {
  const settled = await Promise.allSettled([
    input.closeHttp(),
    input.shutdownDbos(),
    input.stopJobs(),
  ]);
  try {
    await input.closePool();
  } catch (error) {
    settled.push({ status: 'rejected', reason: error });
  }
  try {
    await input.shutdownTracing();
  } catch (error) {
    settled.push({ status: 'rejected', reason: error });
  }
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Core runtime shutdown failed.');
  }
}
