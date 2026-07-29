import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../../p1/model-supply/structured-node-runner.js';
import {
  assessRecipeFactSatisfaction,
  type FactRightsAuthorizationPort,
} from '../../p1/harness/fact-satisfaction.js';
import type {
  FactSatisfactionEvalInput,
  FactSatisfactionPromptfooVars,
  FrozenStructuredRequest,
} from './cases.js';

interface PromptfooContext {
  vars?: FactSatisfactionPromptfooVars;
}

interface PromptfooProviderResponse {
  output: string;
  error?: string;
  metadata: {
    evidenceKind: 'recorded_model_output';
    productionSeam: 'assessRecipeFactSatisfaction';
  };
}

export default class FactSatisfactionPromptfooProvider {
  id() {
    return 'meiye:recorded-fact-satisfaction-semantics';
  }

  async callApi(
    _prompt: string,
    context?: PromptfooContext,
  ): Promise<PromptfooProviderResponse> {
    if (!context?.vars) {
      throw new Error('Promptfoo fact-satisfaction case vars are required.');
    }
    const input = JSON.parse(
      context.vars.inputJson,
    ) as FactSatisfactionEvalInput;
    const runner = new RecordedOutputRunner(
      JSON.parse(context.vars.modelOutputsJson) as unknown[],
    );
    const authorizedFactRefs = new Set(
      JSON.parse(context.vars.authorizedFactRefsJson) as string[],
    );
    const rights: FactRightsAuthorizationPort = {
      async isAuthorized({ fact }) {
        return authorizedFactRefs.has(
          `store_fact:${fact.factId}:${fact.revision}`,
        );
      },
    };
    const result = await assessRecipeFactSatisfaction(
      input,
      runner,
      rights,
    );
    return {
      output: JSON.stringify({
        caseId: context.vars.caseId,
        result,
        requests: runner.requests,
      }),
      metadata: {
        evidenceKind: 'recorded_model_output',
        productionSeam: 'assessRecipeFactSatisfaction',
      },
    };
  }
}

class RecordedOutputRunner implements StructuredNodeRunner {
  readonly requests: FrozenStructuredRequest[] = [];
  private readonly outputs: unknown[];

  constructor(outputs: unknown[]) {
    this.outputs = structuredClone(outputs);
  }

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push({
      effectIdempotencyKey: request.effectIdempotencyKey,
      schemaName: request.schemaName,
      schemaRevision: request.schemaRevision,
      instructions: request.instructions,
      prompt: request.prompt,
    });
    const output = this.outputs.shift();
    return {
      output: request.schema.parse(output),
      attempts: 1,
      providerTaskRef: 'recorded-fact-satisfaction-eval',
      replayed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
