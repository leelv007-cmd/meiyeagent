/**
 * Type surface for service-exit-evidence.mjs so the TypeScript contract tests
 * (run-service.test.ts / service-liveness-reporter.test.ts) can import it
 * without TS7016. Keep in sync with the .mjs exports.
 */

export const repositoryRoot: string;
export const DEFAULT_EVIDENCE_DIRECTORY: string;

export function resolveEvidenceDirectory(
  environment?: Record<string, string | undefined>
): string;

export function serviceExitDirectory(
  environment?: Record<string, string | undefined>
): string;

export function instrumentFailureDirectory(
  environment?: Record<string, string | undefined>
): string;

export function createOutputTail(options?: {
  maxLines?: number;
  maxLineLength?: number;
}): {
  append(stream: 'stdout' | 'stderr', chunk: string): void;
  lines(): string[];
};

export type ViteWorkerdFailure = {
  kind: 'vite-workerd-disconnected';
  message: `Internal server error: ${'fetch failed' | 'terminated'}`;
  stream: 'stdout' | 'stderr';
};

export function createViteWorkerdFailureDetector(
  onFailure: (failure: ViteWorkerdFailure) => void
): {
  append(stream: 'stdout' | 'stderr', chunk: string): void;
};

export type InstrumentFailureRecord = ViteWorkerdFailure & {
  detectedAt: string;
  pid: number;
  service: string;
  tail: string[];
};

export function writeInstrumentFailureRecord(
  input: Omit<InstrumentFailureRecord, 'detectedAt' | 'tail'> & {
    environment?: Record<string, string | undefined>;
    tail?: string[];
  }
): { file: string; record: InstrumentFailureRecord };

export function readInstrumentFailureRecords(input?: {
  environment?: Record<string, string | undefined>;
  since?: number;
}): Array<{ file: string; record: InstrumentFailureRecord }>;

export type ServiceExitRecord = {
  args: string[];
  command: string;
  exitCode: number | null;
  exitedAt: string;
  pid: number;
  restarted: boolean;
  service: string;
  shutdownRequested: boolean;
  signal: string | null;
  startedAt: string;
  tail: string[];
  uptimeMs: number;
};

export function writeServiceExitRecord(input: {
  args?: string[];
  code?: number | null;
  command: string;
  environment?: Record<string, string | undefined>;
  pid: number;
  restarted?: boolean;
  service: string;
  shutdownRequested?: boolean;
  signal?: string | null;
  startedAt: number;
  tail?: string[];
}): { file: string; record: ServiceExitRecord };

export function readServiceExitRecords(input?: {
  environment?: Record<string, string | undefined>;
  since?: number;
}): Array<{ file: string; record: ServiceExitRecord }>;

export function formatInstrumentFailure(input: {
  file: string;
  record: ServiceExitRecord | InstrumentFailureRecord;
}): string;
