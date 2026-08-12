/**
 * Type surface for service-liveness-reporter.mjs so the TypeScript contract
 * test (service-liveness-reporter.test.ts) can import it without TS7016.
 * Keep in sync with the .mjs implementation.
 */

export default class ServiceLivenessReporter {
  constructor(options?: {
    environment?: Record<string, string | undefined>;
    pollIntervalMs?: number;
    since?: number;
    report?: (line: string) => void;
    interrupt?: () => void;
  });

  environment: Record<string, string | undefined>;
  pollIntervalMs: number;
  since: number;
  report: (line: string) => void;
  interrupt: () => void;
  failures: string[];
  timer: ReturnType<typeof setInterval> | undefined;

  printsToStdio(): boolean;
  onBegin(): void;
  onEnd(): void;
  onExit(): void;
  start(): void;
  stop(): void;
  check(): void;
}
