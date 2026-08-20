/**
 * ARCH-05: Web durable outbox drain belongs on the scheduled trigger.
 * Ordinary fetch must not drain. Preview/dev may throttle a fallback.
 */

export type WebDurableOutboxSurface = 'fetch' | 'scheduled';

export interface WebDurableOutboxDrainDecision {
  drain: boolean;
  reason: string;
}

const PREVIEW_ENVS = new Set([
  'development',
  'dev',
  'preview',
  'test',
  'e2e',
  'local',
]);

export function shouldDrainDurableOutboxOnWebSurface(input: {
  appEnv?: string;
  lastDrainAtMs?: number;
  minIntervalMs?: number;
  nowMs?: number;
  surface: WebDurableOutboxSurface;
}): WebDurableOutboxDrainDecision {
  if (input.surface === 'scheduled') {
    return { drain: true, reason: 'web-scheduled-owner' };
  }
  const appEnv = (input.appEnv ?? '').trim().toLowerCase();
  if (!PREVIEW_ENVS.has(appEnv)) {
    return { drain: false, reason: 'ordinary-request-must-not-drain' };
  }
  const nowMs = input.nowMs ?? Date.now();
  const minIntervalMs = input.minIntervalMs ?? 30_000;
  const lastDrainAtMs = input.lastDrainAtMs ?? 0;
  if (lastDrainAtMs > 0 && nowMs - lastDrainAtMs < minIntervalMs) {
    return { drain: false, reason: 'preview-dev-throttled-fallback' };
  }
  return { drain: true, reason: 'preview-dev-throttled-fallback' };
}
