export const DEFAULT_HEALTH_REQUEST_TIMEOUT_MS = 5_000;

export async function fetchHealthy(
  label,
  url,
  init = {},
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_HEALTH_REQUEST_TIMEOUT_MS,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Health request timeout must be a positive number.');
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    ...init,
    signal: init.signal ?? timeoutSignal,
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return response;
}
