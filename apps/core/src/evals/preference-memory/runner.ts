import {
  evalMemoryDiffSchema,
  evalRunSchema,
  type EvalCaseResult,
  type EvalRun,
} from '@meiye/contracts';

import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from '../../p1/operations/reuse-memory-service.js';
import {
  PREFERENCE_DIALOGUE_FIXTURES,
  type PreferenceDialogueFixture,
} from './dialogue-fixtures.js';

export interface BeautyPreferenceMemoryMetrics {
  false_persistence_rate: number;
  superseded_old_value_reappeared: boolean;
  abstention_persisted: boolean;
  erroneous_promotion_count: number;
}

export interface BeautyPreferenceMemoryEvaluation {
  metrics: BeautyPreferenceMemoryMetrics;
  artifact: EvalRun;
}

export type PreferencePromotionVariant =
  | 'canonical'
  | 'auto_promote_pending';

interface MemorySnapshot {
  signals: Array<{
    signalId: string;
    taskId: string;
    semanticKey: string;
    value: unknown;
    kind: string;
  }>;
  candidates: Array<{
    candidateId: string;
    semanticKey: string;
    proposedValue: unknown;
    status: string;
  }>;
  preferences: Array<{
    preferenceId: string;
    revision: number;
    semanticKey: string;
    value: unknown;
    recordState: string;
  }>;
  activePreferences: Array<{
    preferenceId: string;
    semanticKey: string;
    value: unknown;
  }>;
}

interface FixtureEvaluation {
  result: EvalCaseResult;
  after: MemorySnapshot;
}

export async function runBeautyPreferenceMemoryEval(
  options: { promotionVariant?: PreferencePromotionVariant } = {},
): Promise<BeautyPreferenceMemoryEvaluation> {
  const promotionVariant = options.promotionVariant ?? 'canonical';
  const fixtureResults = await Promise.all(
    PREFERENCE_DIALOGUE_FIXTURES.map((fixture) =>
      runFixture(fixture, promotionVariant),
    ),
  );
  const byCaseId = new Map(
    fixtureResults.map((evaluation) => [
      evaluation.result.caseId,
      evaluation,
    ]),
  );
  const falsePersistenceCases = [
    byCaseId.get('temporary-correction-does-not-persist')!,
    byCaseId.get('uncertain-language-abstains')!,
  ];
  const falsePersisted = falsePersistenceCases.filter(
    ({ after }) => after.activePreferences.length > 0,
  ).length;
  const supersede = byCaseId.get('supersede-removes-old-active-value')!;
  const abstention = byCaseId.get('uncertain-language-abstains')!;
  const repeated = byCaseId.get('repeated-pattern-stays-pending')!;
  const metrics: BeautyPreferenceMemoryMetrics = {
    false_persistence_rate: falsePersisted / falsePersistenceCases.length,
    superseded_old_value_reappeared: supersede.after.activePreferences.some(
      ({ value }) => value === 'warm',
    ),
    abstention_persisted:
      abstention.after.signals.length > 0 ||
      abstention.after.candidates.length > 0 ||
      abstention.after.preferences.length > 0,
    erroneous_promotion_count: repeated.after.preferences.length,
  };
  const results = fixtureResults.map(({ result }) => result);
  return {
    metrics,
    artifact: evalRunSchema.parse({
      schemaVersion: 'eval-run/v1',
      runId: `beauty-preference-memory-${promotionVariant}-v1`,
      suiteId: 'beauty-preference-memory',
      suiteRevision: 'preference-dialogues-v1',
      mode: 'recorded_fixture',
      createdAt: '2026-07-18T09:30:00.000Z',
      passed: results.every((result) => result.passed),
      results,
    }),
  };
}

async function runFixture(
  fixture: PreferenceDialogueFixture,
  promotionVariant: PreferencePromotionVariant,
): Promise<FixtureEvaluation> {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    {
      verifyCandidate: async () => {},
      verifyRevision: async () => {},
    },
    fixtureClock(),
  );
  const context = {
    workspaceId: 'workspace-preference-eval',
    userId: 'owner-preference-eval',
  };
  const before = await snapshot(service, context.workspaceId);
  for (const turn of fixture.turns) {
    switch (turn.type) {
      case 'abstain':
        break;
      case 'signal': {
        const recorded = await service.recordPreferenceSignal(
          context,
          turn.input,
        );
        if (
          promotionVariant === 'auto_promote_pending' &&
          recorded.candidate
        ) {
          await service.confirmPreference(context, {
            candidateId: recorded.candidate.candidateId,
            preferenceId: `faulty-${recorded.candidate.candidateId}`,
            expectedRevision: 0,
            positiveExamples: [],
            negativeExamples: [],
            idempotencyKey: `faulty-${recorded.candidate.candidateId}`,
          });
        }
        break;
      }
      case 'propose':
        await service.proposePreference(turn.candidate);
        break;
      case 'confirm':
        await service.confirmPreference(context, turn.input);
        break;
      case 'revoke':
        await service.revokePreference(context, turn.input);
        break;
    }
  }
  const after = await snapshot(service, context.workspaceId);
  const passed = fixturePassed(fixture.caseId, after);
  return {
    after,
    result: {
      caseId: fixture.caseId,
      gateId: null,
      promptRevision: 'preference-dialogues-v1',
      scorerRevision: 'beauty-preference-memory-v1',
      passed,
      reason: fixtureReason(fixture.caseId, passed),
      memoryDiff: memoryDiff(before, after),
    },
  };
}

async function snapshot(
  service: ReuseMemoryService,
  workspaceId: string,
): Promise<MemorySnapshot> {
  const view = await service.preferenceView(workspaceId);
  const preferences = view.preferences.map((preference) => ({
    preferenceId: preference.preferenceId,
    revision: preference.revision,
    semanticKey: preference.semanticKey,
    value: preference.value,
    recordState: preference.recordState,
  }));
  return {
    signals: view.signals.map((signal) => ({
      signalId: signal.signalId,
      taskId: signal.taskId,
      semanticKey: signal.semanticKey,
      value: signal.value,
      kind: signal.kind,
    })),
    candidates: view.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      semanticKey: candidate.semanticKey,
      proposedValue: candidate.proposedValue,
      status: candidate.status,
    })),
    preferences,
    activePreferences: preferences
      .filter(({ recordState }) => recordState === 'current')
      .map(({ preferenceId, semanticKey, value }) => ({
        preferenceId,
        semanticKey,
        value,
      })),
  };
}

function fixturePassed(caseId: string, after: MemorySnapshot) {
  switch (caseId) {
    case 'temporary-correction-does-not-persist':
      return (
        after.candidates.length === 0 && after.preferences.length === 0
      );
    case 'uncertain-language-abstains':
      return (
        after.signals.length === 0 &&
        after.candidates.length === 0 &&
        after.preferences.length === 0
      );
    case 'repeated-pattern-stays-pending':
      return (
        after.candidates.length === 1 &&
        after.candidates[0]?.status === 'pending' &&
        after.preferences.length === 0
      );
    case 'supersede-removes-old-active-value':
      return (
        after.activePreferences.length === 1 &&
        after.activePreferences[0]?.value === 'minimal'
      );
    default:
      return false;
  }
}

function fixtureReason(caseId: string, passed: boolean) {
  if (!passed) return `Memory hard equality failed for ${caseId}.`;
  switch (caseId) {
    case 'temporary-correction-does-not-persist':
      return 'The one-off correction created no candidate or preference.';
    case 'uncertain-language-abstains':
      return 'Uncertain dialogue created no signal, candidate, or preference.';
    case 'repeated-pattern-stays-pending':
      return 'Repeated modifications created one pending candidate and no preference.';
    case 'supersede-removes-old-active-value':
      return 'Only the explicitly confirmed replacement remains active.';
    default:
      return `Memory hard equality passed for ${caseId}.`;
  }
}

function memoryDiff(before: MemorySnapshot, after: MemorySnapshot) {
  const changes = (
    ['signals', 'candidates', 'preferences', 'activePreferences'] as const
  ).flatMap((key) => {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) return [];
    return [
      {
        path: `/${key}`,
        before: before[key],
        after: after[key],
      },
    ];
  });
  return evalMemoryDiffSchema.parse({ before, after, changes });
}

function fixtureClock() {
  let tick = 0;
  return () =>
    new Date(Date.UTC(2026, 6, 18, 9, 10, tick++)).toISOString();
}
