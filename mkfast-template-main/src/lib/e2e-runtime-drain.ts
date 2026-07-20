const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_QUIESCENCE_MS = 500;

export async function waitForE2ERuntimeDrain(input: {
  pendingCount: () => Promise<number>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  quiescenceMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const quiescenceMs = input.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
  const now = input.now ?? Date.now;
  const wait =
    input.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  let quiescentSince: number | undefined;

  while (true) {
    const pendingCount = await input.pendingCount();
    if (pendingCount === 0) {
      quiescentSince ??= now();
      if (now() - quiescentSince >= quiescenceMs) return;
    } else {
      quiescentSince = undefined;
    }
    if (now() >= deadline) {
      throw new Error('Timed out waiting for E2E runtime settlement.');
    }
    await wait(pollIntervalMs);
  }
}
