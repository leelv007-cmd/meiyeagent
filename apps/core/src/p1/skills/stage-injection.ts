import type { ResolvedSkillInstruction } from './types.js';

export function materializeSkillInstructions(
  baseInstructions: string,
  skills: readonly ResolvedSkillInstruction[] | undefined,
) {
  if (!skills?.length) return baseInstructions;
  return [
    baseInstructions,
    '',
    'Apply only these accepted and frozen Skills for the current stage:',
    ...skills.map(
      (skill) => `[${skill.skillRevisionRef}] ${skill.instruction}`,
    ),
  ].join('\n');
}
