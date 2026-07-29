export const HARNESS_ACTION_CARRIERS = {
  approvalCallback: 'workflow.approval_callback',
  decisionResume: 'workflow.decision_resume',
  mediaQueueSubmit: 'workflow.media_queue_submit',
  mediaSignal: 'workflow.media_signal',
  replay: 'workflow.replay',
  semanticResubmission: 'workflow.semantic_resubmission',
  start: 'workflow.start',
  subscription: 'workflow.subscription',
} as const;

export type HarnessActionId =
  (typeof HARNESS_ACTION_CARRIERS)[keyof typeof HARNESS_ACTION_CARRIERS];
