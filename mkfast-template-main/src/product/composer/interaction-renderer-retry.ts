import { P1RequestError } from '@/p1/client';

const MAX_RENDERER_ACK_ATTEMPTS = 5;

export function rendererAckRetryDelay(
  error: unknown,
  completedAttempts: number
) {
  if (completedAttempts >= MAX_RENDERER_ACK_ATTEMPTS) return null;
  const status = error instanceof P1RequestError ? error.status : undefined;
  if (
    status !== undefined &&
    status !== 408 &&
    status !== 429 &&
    status < 500
  ) {
    return null;
  }
  return 1_000 * 2 ** (completedAttempts - 1);
}

export function rendererAckNeedsRefetch(error: unknown) {
  return (
    error instanceof P1RequestError &&
    (error.status === 409 || error.status === 426)
  );
}
