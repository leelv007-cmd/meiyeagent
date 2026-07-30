import { BEAUTY_COPYWRITING_INSTRUCTION } from '../../p1/skills/platform-recipes.js';
import type { CopywritingPromptfooVars } from './cases.js';

interface Observation {
  baseline: {
    output: { body: string; title: string };
    quality: { failures: string[]; score: number };
    requestInstructions: string;
  };
  conclusion: 'improved' | 'unchanged' | 'regressed';
  delta: number;
  treatment: {
    output: { body: string; title: string };
    quality: { failures: string[]; score: number };
    requestInstructions: string;
  };
}

export function scoreCopywritingOutput(
  output: string,
  context?: { vars?: CopywritingPromptfooVars }
) {
  if (!context?.vars) {
    return failure('Copywriting scorer requires frozen case vars.');
  }
  let observation: Observation;
  try {
    observation = JSON.parse(output) as Observation;
  } catch {
    return failure('Copywriting provider output must be valid JSON.');
  }
  const marker = `[${context.vars.skillRevisionRef}] ${BEAUTY_COPYWRITING_INSTRUCTION}`;
  const failures = [
    ...(observation.baseline.requestInstructions.includes(marker)
      ? ['Baseline unexpectedly contains the Skill instruction.']
      : []),
    ...(observation.treatment.requestInstructions.includes(marker)
      ? []
      : ['Treatment did not materialize the Skill instruction.']),
    ...(observation.baseline.output.body ===
      observation.treatment.output.body &&
    observation.baseline.output.title === observation.treatment.output.title
      ? ['The paired outputs are identical.']
      : []),
    ...observation.baseline.quality.failures,
    ...observation.treatment.quality.failures,
    ...(observation.conclusion === context.vars.expectedConclusion
      ? []
      : [
          `Expected ${context.vars.expectedConclusion}; observed ${observation.conclusion}.`,
        ]),
  ];
  if (failures.length > 0) return failure(failures.join(' '));
  return {
    pass: true,
    score: 1,
    reason: `Recorded paired fixture is ${observation.conclusion} (delta ${observation.delta}); no causal attribution.`,
  };
}

function failure(reason: string) {
  return { pass: false, score: 0, reason };
}

export default scoreCopywritingOutput;
