import { createHash } from 'node:crypto';

import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../../p1/model-supply/structured-node-runner.js';
import { executeCopySelection } from '../../p1/harness/execution-selection.js';
import { BEAUTY_COPYWRITING_INSTRUCTION } from '../../p1/skills/platform-recipes.js';
import type {
  CopywritingCandidateFixture,
  CopywritingPromptfooVars,
} from './cases.js';
import { scoreCopywritingCandidate } from './quality.js';

export default class CopywritingPromptfooProvider {
  id() {
    return 'meiye:recorded-copywriting-single-variable-production-seam';
  }

  async callApi(
    _prompt: string,
    context?: { vars?: CopywritingPromptfooVars }
  ) {
    if (!context?.vars) {
      throw new Error('Promptfoo copywriting case vars are required.');
    }
    const vars = context.vars;
    const baselineRunner = new RecordedCopyRunner(vars.baselineOutputJson);
    const treatmentRunner = new RecordedCopyRunner(vars.baselineOutputJson);
    const input = copySelectionInput(vars.caseId);
    const prompt = {
      content: 'Generate one grounded copy candidate from the accepted brief.',
      contentHash: vars.promptContentHash,
      isFallback: false,
      label: 'production',
      name: vars.promptName,
      source: 'langfuse' as const,
      version: vars.promptVersion,
    };
    const baseline = await executeCopySelection(
      { ...input, prompt },
      { runner: baselineRunner, validator: passingValidator }
    );
    const treatment = await executeCopySelection(
      {
        ...input,
        prompt,
        skillInstructions: [
          {
            contentHash: createHash('sha256')
              .update(BEAUTY_COPYWRITING_INSTRUCTION)
              .digest('hex'),
            executionMode: 'prompt_materialized',
            instruction: BEAUTY_COPYWRITING_INSTRUCTION,
            requiredModelCapabilities: ['structured_output'],
            skillRevisionRef: vars.skillRevisionRef,
          },
        ],
      },
      { runner: treatmentRunner, validator: passingValidator }
    );
    const baselineQuality = scoreCopywritingCandidate(baseline.winner, vars);
    const treatmentQuality = scoreCopywritingCandidate(treatment.winner, vars);
    const delta = treatmentQuality.score - baselineQuality.score;
    return {
      output: JSON.stringify({
        baseline: {
          output: baseline.winner,
          quality: baselineQuality,
          requestInstructions: baselineRunner.instructions,
        },
        caseId: vars.caseId,
        conclusion:
          delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'unchanged',
        coordinates: {
          catalogRevision: vars.catalogRevision,
          prompt: `${vars.promptName}@${vars.promptVersion}`,
          promptContentHash: vars.promptContentHash,
          skillRevisionRef: vars.skillRevisionRef,
          workflowId: input.workflowId,
        },
        delta,
        treatment: {
          output: treatment.winner,
          quality: treatmentQuality,
          requestInstructions: treatmentRunner.instructions,
        },
      }),
      metadata: {
        evidenceKind: 'recorded_model_output',
        comparisonInputs: ['skillInstructions'],
        causalAttribution: false,
        fixtureOutputPolicy: 'shared_between_arms',
        productionSeam: 'executeCopySelection',
      },
    };
  }
}

class RecordedCopyRunner implements StructuredNodeRunner {
  instructions = '';

  constructor(private readonly outputJson: string) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.instructions = request.instructions;
    return {
      attempts: 1,
      output: request.schema.parse(
        JSON.parse(this.outputJson) as CopywritingCandidateFixture
      ),
      providerTaskRef: 'recorded-copywriting-single-variable-eval',
      replayed: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

const passingValidator = {
  validate() {
    return { failures: [], passed: true };
  },
};

function copySelectionInput(caseId: string) {
  return {
    brief: {
      assetRefs: [],
      constraints: ['不得编造事实'],
      cta: '私信预约',
      factRefs: ['store_fact:service-hydration:1'],
      identityRefs: ['identity-owner-260'],
      instructions: '为已确认的深层补水护理写一条小红书项目介绍。',
      kind: 'copy' as const,
      platform: 'xiaohongshu' as const,
    },
    generationContext: {
      bundle: { revision: 1, workspaceId: 'workspace-copywriting-eval' },
      identityRefs: [{ id: 'identity-owner-260', status: 'registered' }],
      rightsRefs: [],
      sourceRefs: ['store_fact:service-hydration:1'],
    },
    intendedUse: 'public_content' as const,
    unitId: 'copy-primary',
    workflowId: `copywriting-eval-${caseId}`,
    workspaceId: 'workspace-copywriting-eval',
  };
}
