import {
  SkillInvocationValidationError,
  SkillService,
} from './service.js';
import type {
  SkillInvocationExecution,
  SkillInvocationExecutor,
  SkillInvocationRequest,
  SkillInvocationResultPublisher,
  SkillOutputValidator,
} from './types.js';

export type SkillInvocationToolResult =
  | {
      ok: true;
      execution: SkillInvocationExecution;
    }
  | {
      ok: false;
      error: {
        code: 'SKILL_INPUT_INVALID' | 'SKILL_OUTPUT_INVALID';
        message: string;
        retryable: false;
      };
    };

export class SkillInvocationToolAdapter {
  constructor(
    private readonly service: SkillService,
    private readonly executor: SkillInvocationExecutor,
    private readonly resultPublisher: SkillInvocationResultPublisher,
    private readonly outputValidator?: SkillOutputValidator,
  ) {}

  async execute(
    request: SkillInvocationRequest,
  ): Promise<SkillInvocationToolResult> {
    try {
      const execution = await this.service.invoke(
        request,
        this.executor,
        this.resultPublisher,
        this.outputValidator,
      );
      return { ok: true, execution };
    } catch (error) {
      if (!(error instanceof SkillInvocationValidationError)) throw error;
      return {
        ok: false,
        error: {
          code:
            error.phase === 'input'
              ? 'SKILL_INPUT_INVALID'
              : 'SKILL_OUTPUT_INVALID',
          message: error.message,
          retryable: false,
        },
      };
    }
  }
}
