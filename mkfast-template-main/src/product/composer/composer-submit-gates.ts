export const COMPOSER_SUBMIT_GATES = [
  'imageCardinality',
  'canSubmit',
  'viralReadiness',
  'destinationPreflight',
  'quota',
  'grounding',
  'confirm',
] as const;

export type ComposerSubmitGate = (typeof COMPOSER_SUBMIT_GATES)[number];

export type ComposerSubmitGateChecks = Record<
  ComposerSubmitGate,
  () => boolean | Promise<boolean>
>;

export type ComposerSubmitGateResult =
  | { kind: 'passed' }
  | { gate: ComposerSubmitGate; kind: 'blocked' };

export async function runComposerSubmitGateLadder(
  checks: ComposerSubmitGateChecks
): Promise<ComposerSubmitGateResult> {
  for (const gate of COMPOSER_SUBMIT_GATES) {
    if (!(await checks[gate]())) return { gate, kind: 'blocked' };
  }
  return { kind: 'passed' };
}
