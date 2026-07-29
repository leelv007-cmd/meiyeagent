import {
  HARNESS_GATE_IDS,
  type HarnessGateId,
} from './policy-gates.js';

export type HarnessActionCaller = 'server' | 'worker';
export type HarnessActionAuthoritySource =
  | 'durable_execution_snapshot'
  | 'durable_job_envelope'
  | 'durable_task_scope'
  | 'external_action_policy'
  | 'server_request'
  | 'workflow_input';

export interface HarnessActionDefinition<ActionId extends string = string> {
  actionId: ActionId;
  authoritySource: HarnessActionAuthoritySource;
  gateIds: readonly HarnessGateId[];
  trustedCallers: readonly HarnessActionCaller[];
}

export class HarnessActionAuthorizationError extends Error {
  readonly code = 'HARNESS_ACTION_DENIED';

  constructor(message: string) {
    super(message);
    this.name = 'HarnessActionAuthorizationError';
  }
}

export const HARNESS_ACTION_DEFINITIONS = [
  definition('workflow.start', 'server_request', ['server']),
  definition('workflow.replay', 'workflow_input', ['server']),
  definition(
    'workflow.decision_resume',
    'durable_task_scope',
    ['server'],
  ),
  definition(
    'workflow.semantic_resubmission',
    'durable_execution_snapshot',
    ['server'],
  ),
  definition(
    'workflow.media_queue_submit',
    'durable_execution_snapshot',
    ['server'],
  ),
  definition(
    'workflow.media_signal',
    'durable_job_envelope',
    ['worker'],
  ),
  definition(
    'workflow.approval_callback',
    'external_action_policy',
    ['server'],
  ),
  definition(
    'workflow.subscription',
    'durable_task_scope',
    ['server'],
  ),
] as const;

export type HarnessActionId =
  (typeof HARNESS_ACTION_DEFINITIONS)[number]['actionId'];

const PRODUCTION_HARNESS_ACTION_IDS = HARNESS_ACTION_DEFINITIONS.map(
  ({ actionId }) => actionId,
);

export function createHarnessActionRegistry(definitions: readonly unknown[]) {
  const byId = new Map<HarnessActionId, HarnessActionDefinition>();
  for (const candidate of definitions) {
    const parsed = parseDefinition(candidate);
    if (byId.has(parsed.actionId)) {
      throw new Error(`Harness action "${parsed.actionId}" is duplicated.`);
    }
    byId.set(parsed.actionId, parsed);
  }
  for (const actionId of PRODUCTION_HARNESS_ACTION_IDS) {
    if (!byId.has(actionId)) {
      throw new Error(
        `Harness action "${actionId}" is missing canonical gate metadata.`,
      );
    }
  }
  return {
    authorize(input: {
      actionId: HarnessActionId;
      caller: HarnessActionCaller;
    }) {
      const action = byId.get(input.actionId);
      if (!action || !action.trustedCallers.includes(input.caller)) {
        throw new HarnessActionAuthorizationError(
          'The Harness action is unknown or is not authorized for this caller.',
        );
      }
      return action;
    },
    definition(actionId: string) {
      const action = byId.get(actionId as HarnessActionId);
      if (!action) {
        throw new HarnessActionAuthorizationError(
          'The Harness action is not registered.',
        );
      }
      return action;
    },
  };
}

const productionHarnessActionRegistry = createHarnessActionRegistry(
  HARNESS_ACTION_DEFINITIONS,
);

export function authorizeHarnessAction(input: {
  actionId: HarnessActionId;
  caller: HarnessActionCaller;
}) {
  return productionHarnessActionRegistry.authorize(input);
}

function definition<const ActionId extends string>(
  actionId: ActionId,
  authoritySource: HarnessActionAuthoritySource,
  trustedCallers: readonly HarnessActionCaller[],
): HarnessActionDefinition<ActionId> {
  return {
    actionId,
    authoritySource,
    gateIds: HARNESS_GATE_IDS,
    trustedCallers,
  };
}

function parseDefinition(candidate: unknown): HarnessActionDefinition<HarnessActionId> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Harness action is missing canonical gate metadata.');
  }
  const value = candidate as Partial<HarnessActionDefinition>;
  if (
    !PRODUCTION_HARNESS_ACTION_IDS.includes(value.actionId as HarnessActionId) ||
    !isAuthoritySource(value.authoritySource) ||
    !Array.isArray(value.gateIds) ||
    value.gateIds.length !== HARNESS_GATE_IDS.length ||
    value.gateIds.some((gateId, index) => gateId !== HARNESS_GATE_IDS[index]) ||
    !Array.isArray(value.trustedCallers) ||
    value.trustedCallers.length === 0 ||
    value.trustedCallers.some(
      (caller) => caller !== 'server' && caller !== 'worker',
    )
  ) {
    throw new Error('Harness action is missing canonical gate metadata.');
  }
  return {
    actionId: value.actionId as HarnessActionId,
    authoritySource: value.authoritySource,
    gateIds: [...value.gateIds] as HarnessGateId[],
    trustedCallers: [...value.trustedCallers] as HarnessActionCaller[],
  };
}

function isAuthoritySource(
  value: unknown,
): value is HarnessActionAuthoritySource {
  return [
    'durable_execution_snapshot',
    'durable_job_envelope',
    'durable_task_scope',
    'external_action_policy',
    'server_request',
    'workflow_input',
  ].includes(value as HarnessActionAuthoritySource);
}
