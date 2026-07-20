import type {
  PreferenceCandidate,
  PreferenceSignal,
} from '@meiye/contracts';

type SignalInput = Omit<PreferenceSignal, 'workspaceId' | 'occurredAt'>;

export type PreferenceDialogueTurn =
  | {
      type: 'signal';
      utterance: string;
      input: SignalInput;
    }
  | {
      type: 'abstain';
      utterance: string;
    }
  | {
      type: 'propose';
      utterance: string;
      candidate: PreferenceCandidate;
    }
  | {
      type: 'confirm';
      utterance: string;
      input: {
        candidateId: string;
        preferenceId: string;
        expectedRevision: number;
        positiveExamples: string[];
        negativeExamples: string[];
        idempotencyKey: string;
      };
    }
  | {
      type: 'revoke';
      utterance: string;
      input: {
        preferenceId: string;
        expectedRevision: number;
        idempotencyKey: string;
      };
    };

export interface PreferenceDialogueFixture {
  caseId: string;
  description: string;
  turns: PreferenceDialogueTurn[];
}

const workspaceId = 'workspace-preference-eval';
const defaultScope = {
  storeId: 'store-preference-eval',
  personaId: 'persona-owner',
  scene: 'group-buy',
  platform: 'xiaohongshu',
};

function signal(
  suffix: string,
  value: PreferenceSignal['value'],
  utterance: string,
): PreferenceDialogueTurn {
  return {
    type: 'signal',
    utterance,
    input: {
      signalId: `signal-${suffix}`,
      decisionId: `decision-${suffix}`,
      taskId: `task-${suffix}`,
      semanticKey: 'tone.less-promotional',
      value,
      defaultScope,
      kind: 'modified',
    },
  };
}

function explicitCandidate(input: {
  candidateId: string;
  semanticKey: string;
  value: PreferenceCandidate['proposedValue'];
  taskId: string;
  decisionId: string;
  proposedAt: string;
}): PreferenceCandidate {
  return {
    candidateId: input.candidateId,
    workspaceId,
    semanticKey: input.semanticKey,
    proposedValue: input.value,
    defaultScope,
    evidenceDecisionIds: [input.decisionId],
    evidenceTaskIds: [input.taskId],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: input.proposedAt,
  };
}

export const PREFERENCE_DIALOGUE_FIXTURES: PreferenceDialogueFixture[] = [
  {
    caseId: 'temporary-correction-does-not-persist',
    description: 'A one-off correction remains an audit signal, not a preference',
    turns: [
      signal(
        'temporary',
        true,
        '这一次少一点促销感，下一条不用记住。',
      ),
    ],
  },
  {
    caseId: 'uncertain-language-abstains',
    description: 'Uncertain language produces no preference signal or candidate',
    turns: [
      { type: 'abstain', utterance: '也许可以更克制一点？我还不确定。' },
      { type: 'abstain', utterance: '先看看结果，不要记成长期偏好。' },
    ],
  },
  {
    caseId: 'repeated-pattern-stays-pending',
    description: 'Three independent modifications create only a pending candidate',
    turns: [
      signal('repeated-a', true, '这条少一点促销感。'),
      signal('repeated-b', true, '这条也把强促销词拿掉。'),
      signal('repeated-c', true, '这条继续保持克制。'),
    ],
  },
  {
    caseId: 'supersede-removes-old-active-value',
    description: 'An explicit replacement cannot reactivate the revoked old value',
    turns: [
      {
        type: 'propose',
        utterance: '以后都用热情活泼的语气。',
        candidate: explicitCandidate({
          candidateId: 'candidate-tone-warm',
          semanticKey: 'tone.style',
          value: 'warm',
          taskId: 'task-tone-warm',
          decisionId: 'decision-tone-warm',
          proposedAt: '2026-07-18T09:00:00.000Z',
        }),
      },
      {
        type: 'confirm',
        utterance: '确认长期使用热情活泼语气。',
        input: {
          candidateId: 'candidate-tone-warm',
          preferenceId: 'preference-tone-warm',
          expectedRevision: 0,
          positiveExamples: ['热情但不夸张'],
          negativeExamples: ['冷淡陈述'],
          idempotencyKey: 'confirm-tone-warm',
        },
      },
      {
        type: 'revoke',
        utterance: '撤回热情活泼，之后不要再用。',
        input: {
          preferenceId: 'preference-tone-warm',
          expectedRevision: 1,
          idempotencyKey: 'revoke-tone-warm',
        },
      },
      {
        type: 'propose',
        utterance: '以后统一改成简洁克制。',
        candidate: explicitCandidate({
          candidateId: 'candidate-tone-minimal',
          semanticKey: 'tone.style',
          value: 'minimal',
          taskId: 'task-tone-minimal',
          decisionId: 'decision-tone-minimal',
          proposedAt: '2026-07-18T09:04:00.000Z',
        }),
      },
      {
        type: 'confirm',
        utterance: '确认长期使用简洁克制语气。',
        input: {
          candidateId: 'candidate-tone-minimal',
          preferenceId: 'preference-tone-minimal',
          expectedRevision: 0,
          positiveExamples: ['简洁克制'],
          negativeExamples: ['热情叫卖'],
          idempotencyKey: 'confirm-tone-minimal',
        },
      },
    ],
  },
];
