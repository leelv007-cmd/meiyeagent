import {
  BOUNDED_EXECUTION_LIMITS,
  boundedExecutionConsumptionSchema,
  boundedExecutionSnapshotSchema,
  type BoundedExecutionConsumption,
  type BoundedExecutionLimitName,
  type BoundedExecutionSnapshot,
} from '@meiye/contracts';

const CONSUMPTION_BY_LIMIT = {
  maxIterations: 'iterations',
  maxCostCents: 'costCents',
  maxWallClockMs: 'wallClockMs',
  maxDelegations: 'delegations',
} as const satisfies Record<
  BoundedExecutionLimitName,
  keyof BoundedExecutionConsumption
>;

export type BoundedExecutionDecision<CurrentBest> =
  | {
      state: 'continue';
      snapshot: BoundedExecutionSnapshot;
    }
  | {
      state: 'suspended';
      snapshot: BoundedExecutionSnapshot;
      currentBest: CurrentBest;
      unmetExplanation: string;
      resumable: true;
    };

export type BoundedExecutionSuspension<CurrentBest> = Extract<
  BoundedExecutionDecision<CurrentBest>,
  { state: 'suspended' }
>;

export function isBoundedExecutionSuspension(
  input: unknown,
): input is BoundedExecutionSuspension<unknown> {
  return (
    typeof input === 'object' &&
    input !== null &&
    'state' in input &&
    input.state === 'suspended' &&
    'resumable' in input &&
    input.resumable === true
  );
}

export class BoundedExecutionResumeError extends Error {
  readonly code = 'BOUNDED_EXECUTION_RESUME_INVALID';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'BoundedExecutionResumeError';
  }
}

export function advanceBoundedExecution(
  input: BoundedExecutionSnapshot,
  observedConsumption: Partial<BoundedExecutionConsumption>,
): BoundedExecutionSnapshot {
  const snapshot = boundedExecutionSnapshotSchema.parse(input);
  if (snapshot.stopReason !== null) {
    throw new BoundedExecutionResumeError(
      'A suspended execution must be resumed before it can consume more resources.',
    );
  }
  const observed = boundedExecutionConsumptionSchema
    .partial()
    .parse(observedConsumption);
  if (Object.keys(observed).length === 0) {
    throw new Error(
      'Advancing bounded execution requires at least one observed consumption fact.',
    );
  }
  assertMonotonicConsumption(snapshot.consumption, observed);
  return boundedExecutionSnapshotSchema.parse({
    ...snapshot,
    consumption: {
      ...snapshot.consumption,
      ...observed,
    },
  });
}

export function evaluateBoundedExecution<CurrentBest>(
  input: BoundedExecutionSnapshot,
  observation: {
    consumption: Partial<BoundedExecutionConsumption>;
    currentBest: CurrentBest;
    unmetExplanation: string;
  },
): BoundedExecutionDecision<CurrentBest> {
  const snapshot = boundedExecutionSnapshotSchema.parse(input);
  const observed = boundedExecutionConsumptionSchema.partial().parse(
    observation.consumption,
  );
  const observedKeys = Object.keys(observed) as Array<
    keyof BoundedExecutionConsumption
  >;
  if (observedKeys.length === 0) {
    throw new Error(
      'A bounded execution checkpoint requires at least one observed consumption fact.',
    );
  }
  assertMonotonicConsumption(snapshot.consumption, observed);
  const consumption = boundedExecutionConsumptionSchema.parse({
    ...snapshot.consumption,
    ...observed,
  });
  if (snapshot.stopReason !== null) {
    throw new BoundedExecutionResumeError(
      'A suspended execution must be resumed before it can consume more resources.',
    );
  }
  const triggeredLimit = BOUNDED_EXECUTION_LIMITS.find((limit) => {
    const value = snapshot[limit];
    const consumptionKey = CONSUMPTION_BY_LIMIT[limit];
    return (
      Object.hasOwn(observed, consumptionKey) &&
      value !== 'unset' &&
      consumption[consumptionKey] >= value
    );
  });
  const next = boundedExecutionSnapshotSchema.parse({
    ...snapshot,
    consumption,
    stopReason: triggeredLimit ? 'limit_reached' : null,
    triggeredLimit: triggeredLimit ?? null,
  });
  if (!triggeredLimit) {
    return { state: 'continue', snapshot: next };
  }
  const unmetExplanation = observation.unmetExplanation.trim();
  if (unmetExplanation.length === 0) {
    throw new Error(
      'A bounded execution suspension requires an unmet explanation.',
    );
  }
  return {
    state: 'suspended',
    snapshot: next,
    currentBest: observation.currentBest,
    unmetExplanation,
    resumable: true,
  };
}

export function resumeWithRaisedServerLimit(
  input: BoundedExecutionSnapshot,
  raise: {
    limit: BoundedExecutionLimitName;
    value: number;
  },
): BoundedExecutionSnapshot {
  const snapshot = boundedExecutionSnapshotSchema.parse(input);
  if (
    snapshot.stopReason !== 'limit_reached' ||
    snapshot.triggeredLimit !== raise.limit
  ) {
    throw new BoundedExecutionResumeError(
      'The raised limit must match the limit that suspended the execution.',
    );
  }
  const previous = snapshot[raise.limit];
  const consumed = snapshot.consumption[CONSUMPTION_BY_LIMIT[raise.limit]];
  if (
    previous === 'unset' ||
    !Number.isSafeInteger(raise.value) ||
    raise.value <= previous ||
    raise.value <= consumed
  ) {
    throw new BoundedExecutionResumeError(
      'The server-provided limit must be a safe integer above both the prior limit and current consumption.',
    );
  }
  return boundedExecutionSnapshotSchema.parse({
    ...snapshot,
    [raise.limit]: raise.value,
    stopReason: null,
    triggeredLimit: null,
  });
}

function assertMonotonicConsumption(
  previous: BoundedExecutionConsumption,
  current: Partial<BoundedExecutionConsumption>,
) {
  for (const key of Object.keys(current) as Array<
    keyof BoundedExecutionConsumption
  >) {
    if (current[key] !== undefined && current[key] < previous[key]) {
      throw new Error(
        `Bounded execution consumption cannot move backwards for ${key}.`,
      );
    }
  }
}
