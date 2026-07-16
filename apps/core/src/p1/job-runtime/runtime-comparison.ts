export interface RuntimeComparisonDimension {
  dimension:
    | 'migration'
    | 'connection_pool'
    | 'cron'
    | 'lease'
    | 'retry_dlq'
    | 'cancellation'
    | 'observability';
  pgBoss: string;
  graphileWorker: string;
  consequence: string;
}

/**
 * This is executable architecture evidence, kept beside both adapters so a
 * later switch is reviewed against the behavior we actually implemented.
 */
export const POSTGRES_JOB_RUNTIME_COMPARISON = {
  evaluatedVersions: {
    pgBoss: { version: '12.26.0', license: 'MIT' },
    graphileWorker: { version: '0.17.3', license: 'MIT' },
  },
  recommendation: 'pg-boss',
  summary:
    'pg-boss remains the primary runtime. Graphile Worker is a viable control adapter, but matching the required lease, dynamic cron, cancellation, DLQ, and metrics contract adds product-owned extensions.',
  dimensions: [
    {
      dimension: 'migration',
      pgBoss:
        'Starts and migrates its own schema, creates named queues idempotently, and accepts an IDatabase backed by the caller transaction.',
      graphileWorker:
        'WorkerUtils migrates its schema; transaction enqueue uses the versioned add_job SQL function because WorkerUtils normally owns its connection.',
      consequence:
        'Both fit one Postgres, but Graphile transaction enqueue is more coupled to its SQL schema and pinned package version.',
    },
    {
      dimension: 'connection_pool',
      pgBoss:
        'One PgBoss instance owns a pool; optional LISTEN/NOTIFY needs one pinned listener connection while polling remains the correctness floor.',
      graphileWorker:
        'WorkerUtils and Runner can each create a pool from a connection string; deployment should pass a shared pg Pool when connection pressure matters.',
      consequence:
        'Graphile needs more deliberate pool wiring in the current two-entrypoint deployment.',
    },
    {
      dimension: 'cron',
      pgBoss:
        'schedule/unschedule persist dynamic named schedules in Postgres and permit runtime administration.',
      graphileWorker:
        'Cron definitions are process configuration loaded at worker start; known_crontabs persists checkpoints, not an administrator-editable definition source.',
      consequence:
        'Graphile cron changes require a configuration revision and worker restart; pg-boss matches the P1 admin-trigger model directly.',
    },
    {
      dimension: 'lease',
      pgBoss:
        'Queue heartbeatSeconds plus worker heartbeatRefreshSeconds renew active leases natively; touch supports explicit renewal.',
      graphileWorker:
        'Locked jobs are eventually reset by the worker. The control adapter adds a narrow locked_at renewal query and handler heartbeat.',
      consequence:
        'Graphile lease parity depends on an internal-table extension that must be revalidated on upgrades.',
    },
    {
      dimension: 'retry_dlq',
      pgBoss:
        'Queue policies provide retry limits, exponential backoff, a separate dead-letter queue, terminal routing, and bounded redrive.',
      graphileWorker:
        'Failed jobs retry with max_attempts and remain permanently failed in the jobs table; redrive is rescheduleJobs and there is no separate DLQ.',
      consequence:
        'Graphile can preserve the recovery outcome, but operational DLQ isolation and reporting require an additional projection.',
    },
    {
      dimension: 'cancellation',
      pgBoss:
        'cancel transitions queued or active jobs to a durable cancelled state addressable by deterministic transport id.',
      graphileWorker:
        'completeJobs removes an unlocked queued job; an active locked job has no equivalent per-job cancellation primitive.',
      consequence:
        'Graphile cannot meet active cancellation semantics without a separate product cancellation intent checked by handlers.',
    },
    {
      dimension: 'observability',
      pgBoss:
        'getQueue and findJobs expose ready/deferred/active/failed depth and job metadata for age, claim, lease, attempt, and recovery metrics.',
      graphileWorker:
        'The control adapter reads versioned private job/task rows to derive the same metrics; the public jobs view omits payload and some fields.',
      consequence:
        'Graphile metrics have higher upgrade coupling; pg-boss provides the required P1 queue dashboard primitives with less custom SQL.',
    },
  ] satisfies RuntimeComparisonDimension[],
} as const;
