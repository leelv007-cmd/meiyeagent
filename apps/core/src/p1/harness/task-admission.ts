import {
  harnessTaskSubmissionSchema,
  reuseTaskSeedSchema,
  storeFactScopeSchema,
  taskIntentInputSchema,
  type ReuseTaskSeed,
  type StoreFact,
  type TaskIntentInput,
} from '@meiye/contracts';
import { z } from 'zod';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptResolver,
} from './langfuse-prompts.js';

export interface HarnessWorkflowInput {
  actorId: string;
  workspaceId: string;
  packageId: string;
  expectedRevision: number;
  workflowRevision: number;
  rawInput: string;
  intent: TaskIntentInput;
  factScope?: StoreFact['scope'];
  decisionReferences?: Array<{
    id: string;
    field: string;
    value: string;
    revision: number;
  }>;
  reuseSeed?: ReuseTaskSeed;
  prompts?: HarnessFrozenPrompts;
}

export interface HarnessTaskRequest extends Omit<HarnessWorkflowInput, 'prompts'> {
  taskId: string;
}

export const harnessTaskRequestSchema = harnessTaskSubmissionSchema
  .extend({
    actorId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
    expectedRevision: z.number().int().nonnegative(),
    workflowRevision: z.number().int().nonnegative(),
    rawInput: z.string().trim().min(1),
    intent: taskIntentInputSchema,
    factScope: storeFactScopeSchema.optional(),
    reuseSeed: reuseTaskSeedSchema.optional(),
  })
  .strict();

export interface HarnessTaskRequestRegistry {
  claim(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }): Promise<
    | { kind: 'created' }
    | {
        kind: 'existing';
        workflowId: string;
        runtimeId?: string;
        request?: HarnessWorkflowInput;
      }
    | { kind: 'conflict' }
  >;
}

export interface HarnessWorkflowStarter {
  start(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    runtimeId?: string;
  }): Promise<{ workflowId: string }>;
}

export class HarnessAdmissionError extends Error {
  readonly status = 409;

  constructor(
    readonly code: 'REQUEST_FINGERPRINT_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'HarnessAdmissionError';
  }
}

export class HarnessTaskAdmissionService {
  constructor(
    private readonly registry: HarnessTaskRequestRegistry,
    private readonly starter: HarnessWorkflowStarter,
    private readonly prompts?: HarnessPromptResolver,
  ) {}

  async submit(input: HarnessTaskRequest) {
    const normalized = normalizeRequest(input);
    const request = this.prompts
      ? { ...normalized, prompts: await this.prompts.resolve() }
      : normalized;
    const claim = await this.registry.claim({
      taskId: input.taskId,
      fingerprint: fingerprintValue(normalized),
      request,
    });
    if (claim.kind === 'conflict') {
      throw new HarnessAdmissionError(
        'REQUEST_FINGERPRINT_CONFLICT',
        'Task ID was reused with a different harness request payload.',
      );
    }
    if (claim.kind === 'existing') {
      const handle = await this.starter.start({
        workflowId: claim.workflowId,
        request: claim.request ?? request,
        ...(claim.runtimeId ? { runtimeId: claim.runtimeId } : {}),
      });
      return { workflowId: handle.workflowId, replayed: true as const };
    }
    const handle = await this.starter.start({
      workflowId: input.taskId,
      request,
    });
    return { workflowId: handle.workflowId, replayed: false as const };
  }
}

function normalizeRequest(input: HarnessTaskRequest): HarnessWorkflowInput {
  const parsed = harnessTaskRequestSchema.parse(input);
  return {
    actorId: parsed.actorId,
    workspaceId: parsed.workspaceId,
    packageId: parsed.packageId,
    expectedRevision: parsed.expectedRevision,
    workflowRevision: parsed.workflowRevision,
    rawInput: parsed.rawInput,
    intent: parsed.intent,
    factScope: parsed.factScope ?? { storeId: parsed.workspaceId },
    ...(parsed.reuseSeed ? { reuseSeed: parsed.reuseSeed } : {}),
  };
}
