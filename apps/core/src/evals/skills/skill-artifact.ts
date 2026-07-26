import {
  evalCaseResultSchema,
  evalRunSchema,
  type EvalRun,
} from '@meiye/contracts';

import { skillAcceptanceGateFailure } from '../../p1/skills/service.js';
import type { SkillRevision } from '../../p1/skills/types.js';
import {
  SKILL_ACCEPTANCE_CASES,
  type SkillAcceptanceCase,
} from './cases.js';

export type SkillAcceptanceValidator = (
  revision: SkillRevision,
  run: EvalRun,
) => string | null;

export function evaluateSkillAcceptanceCase(
  evalCase: SkillAcceptanceCase,
  validator: SkillAcceptanceValidator = skillAcceptanceGateFailure,
) {
  const observedFailure = validator(
    structuredClone(evalCase.revision),
    structuredClone(evalCase.evalRun),
  );
  const passed = observedFailure === evalCase.expectedFailure;
  return evalCaseResultSchema.parse({
    caseId: evalCase.caseId,
    gateId: 'skill_revision_acceptance',
    promptRevision: `${evalCase.revision.prompt.name}@${evalCase.revision.prompt.version}`,
    skillRevisionRef: evalCase.revision.skillRevisionRef,
    scorerRevision: 'skill-routing-scorer@2',
    passed,
    reason: passed
      ? evalCase.description
      : `Expected ${String(evalCase.expectedFailure)}; observed ${String(observedFailure)}.`,
    memoryDiff: null,
  });
}

export function createRecordedSkillEvalRun(
  validator: SkillAcceptanceValidator = skillAcceptanceGateFailure,
): EvalRun {
  const results = SKILL_ACCEPTANCE_CASES.map((evalCase) =>
    evaluateSkillAcceptanceCase(evalCase, validator),
  );
  return evalRunSchema.parse({
    schemaVersion: 'eval-run/v1',
    runId: 'skills-five-piece-recorded-v2',
    suiteId: 'harness-skills',
    suiteRevision: 'harness-skills-fixtures-v2',
    mode: 'recorded_fixture',
    createdAt: '2026-07-26T02:30:00.000Z',
    passed: results.every((result) => result.passed),
    results,
  });
}
