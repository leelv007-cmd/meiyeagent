import { createHash } from 'node:crypto';

import type { EvalRun } from '@meiye/contracts';

import type { SkillRevision } from '../../p1/skills/types.js';

export interface SkillAcceptanceCase {
  caseId: string;
  description: string;
  expectedFailure: string | null;
  revision: SkillRevision;
  evalRun: EvalRun;
}

const NOW = '2026-07-26T02:30:00.000Z';
const SKILL_REVISION_REF = 'skill.daily-industry@1';
const PROMPT_NAME = 'skills/daily-industry';
const PROMPT_VERSION = '1';
const INSTRUCTION =
  'Use the accepted industry context only at the declared intent stage.';

function revision(): SkillRevision {
  return {
    acceptedAt: null,
    acceptedBy: null,
    contentHash: createHash('sha256').update(INSTRUCTION).digest('hex'),
    createdAt: NOW,
    createdBy: 'operator-eval',
    evalRunId: null,
    instruction: INSTRUCTION,
    manifest: {
      description:
        'Uses accepted industry context. Use during intent classification.',
      name: 'daily-industry',
    },
    governance: {
      allowedTools: [],
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      contextScopes: ['industry_category'],
      executionMode: 'prompt_materialized',
      fallback: 'skip',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.copy@1'],
    },
    prompt: {
      contentHash: createHash('sha256').update(INSTRUCTION).digest('hex'),
      fallbackContent: INSTRUCTION,
      isFallback: false,
      label: 'production',
      name: PROMPT_NAME,
      source: 'langfuse',
      version: PROMPT_VERSION,
    },
    revision: 1,
    skillId: 'skill.daily-industry',
    skillRevisionRef: SKILL_REVISION_REF,
    status: 'draft',
  };
}

function evalRun(skillRevisionRef: string): EvalRun {
  return {
    createdAt: NOW,
    mode: 'recorded_fixture',
    passed: true,
    results: [
      {
        caseId: 'daily-industry-acceptance',
        gateId: 'skill_revision_acceptance',
        memoryDiff: null,
        passed: true,
        promptRevision: `${PROMPT_NAME}@${PROMPT_VERSION}`,
        reason: 'The exact frozen Skill and prompt revision passed.',
        scorerRevision: 'skill-routing-scorer@2',
        skillRevisionRef,
      },
    ],
    runId: 'skills-daily-industry-recorded-v2',
    schemaVersion: 'eval-run/v1',
    suiteId: 'harness-skills',
    suiteRevision: 'harness-skills-fixtures-v2',
  };
}

export const SKILL_ACCEPTANCE_CASES: SkillAcceptanceCase[] = [
  {
    caseId: 'exact-frozen-skill-eval-is-accepted',
    description: 'Accepts the exact frozen prompt and Skill revision evidence.',
    expectedFailure: null,
    revision: revision(),
    evalRun: evalRun(SKILL_REVISION_REF),
  },
  {
    caseId: 'different-skill-eval-is-rejected',
    description: 'Rejects evaluation evidence bound to another Skill revision.',
    expectedFailure:
      'Skill revision must pass its exact prompt and Skill eval gate.',
    revision: revision(),
    evalRun: evalRun('skill.daily-industry@2'),
  },
];
