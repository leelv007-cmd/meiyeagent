import type { ResolvedSkillInstruction } from './types.js';

export function materializeSkillInstructions(
  baseInstructions: string,
  skills: readonly ResolvedSkillInstruction[] | undefined,
) {
  if (!skills?.length) return baseInstructions;
  const resolvedPrompts = skills.filter((skill) => skill.promptContent);
  if (
    resolvedPrompts.some(
      (skill) =>
        skill.prompt?.contentHash !==
        resolvedPrompts[0]?.prompt?.contentHash,
    )
  ) {
    throw new Error(
      'Resolved Skills disagree on the frozen prompt snapshot.',
    );
  }
  return [
    resolvedPrompts[0]?.promptContent ?? baseInstructions,
    '',
    'Apply only these accepted and frozen Skills for the current stage:',
    ...skills.map(
      (skill) => `[${skill.skillRevisionRef}] ${skill.instruction}`,
    ),
  ].join('\n');
}
