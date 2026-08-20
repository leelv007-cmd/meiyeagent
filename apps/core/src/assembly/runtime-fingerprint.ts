/**
 * Shared DBOS / queue fingerprint contract for Core API and Worker.
 *
 * Both roles of one digest must enqueue and resume against the same queue
 * prefix and harness application identity (ARCH-04).
 */
export const PRODUCTION_DBOS_APP_NAME = 'beauty-marketing-harness';
export const PRODUCTION_JOB_QUEUE_PREFIX = 'meiye-p1';

export type ProductionRuntimeFingerprint = {
  applicationVersion: string | null;
  dbosName: string;
  queuePrefix: string;
};

export function productionRuntimeFingerprint(
  env: NodeJS.ProcessEnv = process.env,
): ProductionRuntimeFingerprint {
  const applicationVersion =
    env.HARNESS_DBOS_APPLICATION_VERSION?.trim() ||
    env.DBOS__APPVERSION?.trim() ||
    null;
  const queuePrefix = env.JOB_QUEUE_PREFIX?.trim() || PRODUCTION_JOB_QUEUE_PREFIX;
  return {
    applicationVersion,
    dbosName: PRODUCTION_DBOS_APP_NAME,
    queuePrefix,
  };
}

export function assertSameRuntimeFingerprint(
  left: ProductionRuntimeFingerprint,
  right: ProductionRuntimeFingerprint,
): void {
  if (
    left.applicationVersion !== right.applicationVersion ||
    left.dbosName !== right.dbosName ||
    left.queuePrefix !== right.queuePrefix
  ) {
    throw new Error(
      'API and worker DBOS/queue fingerprint contract diverged.',
    );
  }
}
