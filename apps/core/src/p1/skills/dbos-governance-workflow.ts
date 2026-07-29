import { DBOS } from '@dbos-inc/dbos-sdk';

import type { SkillService } from './service.js';
import type { SkillGovernanceResult } from './types.js';

const WORKFLOW_NAME = 'skillGovernanceWorkflow';
const STATE_EVENT = 'skill-governance-state';
const CONTROL_TOPIC = 'skill-governance-control';
const APPLY_STEP = 'apply-skill-governance-revision';
const CANCEL_STEP = 'cancel-skill-governance-revision';

type RegisteredWorkflow<Input, Output> = (
  input: Input,
) => Promise<Output>;

export interface SkillGovernanceDbosAdapter {
  currentWorkflowId(): string | undefined;
  registerWorkflow<Input, Output>(
    workflow: RegisteredWorkflow<Input, Output>,
    options: { name: string },
  ): RegisteredWorkflow<Input, Output>;
  startWorkflow<Input, Output>(
    workflow: RegisteredWorkflow<Input, Output>,
    options: { workflowId: string },
    input: Input,
  ): Promise<{ workflowId: string }>;
  runStep<Output>(
    operation: () => Promise<Output>,
    options: { name: string },
  ): Promise<Output>;
  setEvent<Value>(key: string, value: Value): Promise<void>;
  getEvent<Value>(
    workflowId: string,
    key: string,
    options: { timeoutSeconds: number },
  ): Promise<Value | null>;
  recv<Value>(
    topic: string,
    options: { timeoutSeconds: number },
  ): Promise<Value | null>;
  send<Value>(
    workflowId: string,
    message: Value,
    topic: string,
    idempotencyKey: string,
  ): Promise<void>;
  resumeWorkflow(workflowId: string): Promise<void>;
  cancelWorkflow(workflowId: string): Promise<void>;
  getWorkflowStatus(
    workflowId: string,
  ): Promise<{ status: string } | null>;
}

export type SkillGovernanceWorkflowInput = Parameters<
  SkillService['applyGovernanceRevision']
>[0];

export type SkillGovernanceCancellationResult = {
  runId: string;
  success: true;
  applied: false;
  validationResults: [
    {
      fieldPath: '$workflow';
      reasonCode: 'governance_cancelled';
      status: 'not_applied';
    },
  ];
};

export type SkillGovernanceWorkflowResult =
  | SkillGovernanceResult
  | SkillGovernanceCancellationResult;

export type SkillGovernanceWorkflowState =
  | {
      runId: string;
      status: 'awaiting_approval' | 'applying';
      workspaceId: string;
    }
  | {
      result: SkillGovernanceWorkflowResult;
      runId: string;
      status: 'cancelled' | 'completed';
      workspaceId: string;
    };

type SkillGovernanceControl = {
  action: 'approve' | 'cancel';
  actorId: string;
  runId: string;
  workspaceId: string;
};

type SkillGovernanceWriter = Pick<
  SkillService,
  | 'applyGovernanceRevision'
  | 'cancelGovernanceRevision'
  | 'inspectGovernanceRun'
  | 'reserveGovernanceRevision'
>;

export function skillGovernanceWorkflowId(
  workspaceId: string,
  runId: string,
) {
  return `skill-governance:${encodeId(workspaceId, 'Workspace ID')}:${encodeId(
    runId,
    'Governance run ID',
  )}`;
}

export function registerSkillGovernanceDbosWorkflow(
  service: SkillGovernanceWriter,
  dbos: SkillGovernanceDbosAdapter = DBOS_SKILL_GOVERNANCE_ADAPTER,
) {
  const workflow = async (
    input: SkillGovernanceWorkflowInput,
  ): Promise<SkillGovernanceWorkflowResult> => {
    const workflowId = skillGovernanceWorkflowId(
      input.workspaceId,
      input.runId,
    );
    if (dbos.currentWorkflowId() !== workflowId) {
      throw new Error(
        'Skill governance workflow requires its stable workspace-scoped workflow ID.',
      );
    }

    await dbos.setEvent<SkillGovernanceWorkflowState>(STATE_EVENT, {
      runId: input.runId,
      status: 'awaiting_approval',
      workspaceId: input.workspaceId,
    });
    const control = await waitForControl(dbos);
    assertControl(control, input);

    if (control.action === 'cancel') {
      const result = await dbos.runStep(
        () =>
          service.cancelGovernanceRevision({
            actorId: control.actorId,
            runId: input.runId,
            workspaceId: input.workspaceId,
          }),
        { name: CANCEL_STEP },
      );
      await dbos.setEvent<SkillGovernanceWorkflowState>(STATE_EVENT, {
        result,
        runId: input.runId,
        status: 'cancelled',
        workspaceId: input.workspaceId,
      });
      return result;
    }

    await dbos.setEvent<SkillGovernanceWorkflowState>(STATE_EVENT, {
      runId: input.runId,
      status: 'applying',
      workspaceId: input.workspaceId,
    });
    const result = await dbos.runStep(
      () =>
        service.applyGovernanceRevision({
          ...structuredClone(input),
          actorId: control.actorId,
          initiatingActorId: input.actorId,
        }),
      { name: APPLY_STEP },
    );
    await dbos.setEvent<SkillGovernanceWorkflowState>(STATE_EVENT, {
      result,
      runId: input.runId,
      status: 'completed',
      workspaceId: input.workspaceId,
    });
    return result;
  };

  return dbos.registerWorkflow(workflow, { name: WORKFLOW_NAME });
}

export class SkillGovernanceDbosRuntime {
  private readonly workflow: RegisteredWorkflow<
    SkillGovernanceWorkflowInput,
    SkillGovernanceWorkflowResult
  >;

  constructor(
    private readonly service: SkillGovernanceWriter,
    private readonly dbos: SkillGovernanceDbosAdapter,
  ) {
    this.workflow = registerSkillGovernanceDbosWorkflow(service, dbos);
  }

  async start(input: SkillGovernanceWorkflowInput) {
    const workflowId = skillGovernanceWorkflowId(
      input.workspaceId,
      input.runId,
    );
    await this.service.reserveGovernanceRevision(
      structuredClone(input),
    );
    await this.dbos.startWorkflow(
      this.workflow,
      { workflowId },
      structuredClone(input),
    );
    return { runId: input.runId, workflowId };
  }

  approve(input: {
    actorId: string;
    idempotencyKey: string;
    runId: string;
    workspaceId: string;
  }) {
    return this.sendControl('approve', input);
  }

  businessCancel(input: {
    actorId: string;
    idempotencyKey: string;
    runId: string;
    workspaceId: string;
  }) {
    return this.sendControl('cancel', input);
  }

  async cancel(input: {
    actorId: string;
    runId: string;
    workspaceId: string;
  }) {
    const workflowId = skillGovernanceWorkflowId(
      input.workspaceId,
      input.runId,
    );
    await this.dbos.cancelWorkflow(workflowId);
    return { runId: input.runId, workflowId };
  }

  async resume(input: {
    actorId: string;
    runId: string;
    workspaceId: string;
  }) {
    const workflowId = skillGovernanceWorkflowId(
      input.workspaceId,
      input.runId,
    );
    await this.dbos.resumeWorkflow(workflowId);
    return { runId: input.runId, workflowId };
  }

  async inspect(workspaceId: string, runId: string) {
    const workflowId = skillGovernanceWorkflowId(workspaceId, runId);
    const [state, workflowStatus, run] = await Promise.all([
      this.dbos.getEvent<SkillGovernanceWorkflowState>(
        workflowId,
        STATE_EVENT,
        { timeoutSeconds: 0 },
      ),
      this.dbos.getWorkflowStatus(workflowId),
      this.service.inspectGovernanceRun(runId),
    ]);
    const visibleRun = run?.workspaceId === workspaceId ? run : null;
    return {
      runId,
      workflowId,
      workflowStatus: workflowStatus?.status ?? null,
      state,
      run: visibleRun,
    };
  }

  private sendControl(
    action: SkillGovernanceControl['action'],
    input: {
      actorId: string;
      idempotencyKey: string;
      runId: string;
      workspaceId: string;
    },
  ) {
    const idempotencyKey = encodeId(
      input.idempotencyKey,
      'Control idempotency key',
    );
    const workflowId = skillGovernanceWorkflowId(
      input.workspaceId,
      input.runId,
    );
    return this.dbos.send<SkillGovernanceControl>(
      workflowId,
      {
        action,
        actorId: input.actorId,
        runId: input.runId,
        workspaceId: input.workspaceId,
      },
      CONTROL_TOPIC,
      `skill-governance-control:${workflowId}:${action}:${idempotencyKey}`,
    );
  }
}

export function createSkillGovernanceDbosRuntime(input: {
  service: SkillGovernanceWriter;
  dbos?: SkillGovernanceDbosAdapter;
}) {
  return new SkillGovernanceDbosRuntime(
    input.service,
    input.dbos ?? DBOS_SKILL_GOVERNANCE_ADAPTER,
  );
}

function assertControl(
  control: SkillGovernanceControl | null,
  input: SkillGovernanceWorkflowInput,
): asserts control is SkillGovernanceControl {
  if (
    !control ||
    (control.action !== 'approve' && control.action !== 'cancel') ||
    control.runId !== input.runId ||
    control.workspaceId !== input.workspaceId
  ) {
    throw new Error('Skill governance control does not match the suspended run.');
  }
}

async function waitForControl(dbos: SkillGovernanceDbosAdapter) {
  const control = await dbos.recv<SkillGovernanceControl>(
    CONTROL_TOPIC,
    { timeoutSeconds: 31_536_000 },
  );
  if (!control) {
    throw new Error('Skill governance approval window expired.');
  }
  return control;
}

function encodeId(value: string, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return encodeURIComponent(normalized);
}

export const DBOS_SKILL_GOVERNANCE_ADAPTER: SkillGovernanceDbosAdapter = {
  currentWorkflowId() {
    return DBOS.workflowID;
  },
  registerWorkflow(workflow, options) {
    return DBOS.registerWorkflow(workflow, { name: options.name });
  },
  async startWorkflow(workflow, options, input) {
    const handle = await DBOS.startWorkflow(workflow, {
      workflowID: options.workflowId,
    })(input);
    return { workflowId: handle.workflowID };
  },
  runStep(operation, options) {
    return DBOS.runStep(operation, { name: options.name });
  },
  setEvent(key, value) {
    return DBOS.setEvent(key, value);
  },
  getEvent(workflowId, key, options) {
    return DBOS.getEvent(workflowId, key, options);
  },
  recv(topic, options) {
    return DBOS.recv(topic, options);
  },
  send(workflowId, message, topic, idempotencyKey) {
    return DBOS.send(workflowId, message, topic, idempotencyKey);
  },
  async resumeWorkflow(workflowId) {
    await DBOS.resumeWorkflow(workflowId);
  },
  async cancelWorkflow(workflowId) {
    await DBOS.cancelWorkflow(workflowId);
  },
  getWorkflowStatus(workflowId) {
    return DBOS.getWorkflowStatus(workflowId);
  },
};
