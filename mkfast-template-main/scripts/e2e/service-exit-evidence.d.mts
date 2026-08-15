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

export function createServiceIncarnationId(input: {
  pid: number;
  service: string;
  startedAt: number;
}): string;

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

export type ProductionCandidateNetworkLossFailure = {
  kind: 'workerd-network-connection-lost';
  message: 'Network connection lost';
  stream: 'stdout' | 'stderr';
};

export type InstrumentFailureResolution =
  | 'pending'
  | 'healthy'
  | 'restarted'
  | 'fatal';
export type InstrumentFailureResolutionReason =
  | 'door-ended'
  | 'embedded-workerd'
  | 'service-exit'
  | 'service-restarted'
  | 'service-responsive'
  | 'service-unresponsive'
  | 'shutdown-requested';

export function createViteWorkerdFailureDetector(
  onFailure: (failure: ViteWorkerdFailure) => boolean
): {
  append(stream: 'stdout' | 'stderr', chunk: string): void;
  retry(): boolean;
};

export function createProductionCandidateNetworkLossDetector(
  onFailure: (failure: ProductionCandidateNetworkLossFailure) => boolean
): {
  append(stream: 'stdout' | 'stderr', chunk: string): void;
  retry(): boolean;
};

export type InstrumentFailureRecord = (
  | ViteWorkerdFailure
  | ProductionCandidateNetworkLossFailure
) & {
  detectedAt: string;
  incarnationId: string;
  pid: number;
  resolution: InstrumentFailureResolution;
  resolutionReason: InstrumentFailureResolutionReason | null;
  resolvedAt: string | null;
  service: string;
  shutdownRequested: boolean;
  startedAt: string;
  tail: string[];
};

export function writeInstrumentFailureRecord(
  input: Omit<
    InstrumentFailureRecord,
    | 'detectedAt'
    | 'incarnationId'
    | 'resolution'
    | 'resolutionReason'
    | 'resolvedAt'
    | 'shutdownRequested'
    | 'startedAt'
    | 'tail'
  > & {
    detectedAt?: number;
    environment?: Record<string, string | undefined>;
    incarnationId?: string;
    resolution?: InstrumentFailureResolution;
    resolutionReason?: InstrumentFailureResolutionReason | null;
    resolvedAt?: number | null;
    shutdownRequested?: boolean;
    startedAt?: number;
    tail?: string[];
  }
): { file: string; record: InstrumentFailureRecord };

export function writeInstrumentFailureFallbackRecord(
  input: Omit<
    InstrumentFailureRecord,
    | 'detectedAt'
    | 'incarnationId'
    | 'resolution'
    | 'resolutionReason'
    | 'resolvedAt'
    | 'shutdownRequested'
    | 'startedAt'
    | 'tail'
  > & {
    detectedAt?: number;
    environment?: Record<string, string | undefined>;
    incarnationId?: string;
    resolution?: InstrumentFailureResolution;
    resolutionReason?: InstrumentFailureResolutionReason | null;
    resolvedAt?: number | null;
    shutdownRequested?: boolean;
    startedAt?: number;
    tail?: string[];
  }
): { file: string; record: InstrumentFailureRecord };

export function resolveInstrumentFailureRecord(input: {
  file: string;
  resolution: Exclude<InstrumentFailureResolution, 'pending'>;
  resolutionReason: InstrumentFailureResolutionReason;
  resolvedAt?: number;
}): { file: string; record: InstrumentFailureRecord };

export function readInstrumentFailureRecords(input?: {
  environment?: Record<string, string | undefined>;
  since?: number;
}): Array<{ file: string; record: InstrumentFailureRecord }>;

export type ServiceExitRecord = {
  args: string[];
  command: string;
  exitCode: number | null;
  exitedAt: string;
  incarnationId: string;
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
  exitedAt?: number;
  incarnationId?: string;
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
