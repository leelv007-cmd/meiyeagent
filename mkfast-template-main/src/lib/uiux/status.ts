import {
  product_status_accepted_explanation,
  product_status_accepted_label,
  product_status_accepted_next_action,
  product_status_cancel_requested_explanation,
  product_status_cancel_requested_label,
  product_status_cancel_requested_next_action,
  product_status_cancelled_explanation,
  product_status_cancelled_label,
  product_status_cancelled_next_action,
  product_status_completed_explanation,
  product_status_completed_label,
  product_status_completed_next_action,
  product_status_draft_explanation,
  product_status_draft_label,
  product_status_draft_next_action,
  product_status_failed_explanation,
  product_status_failed_label,
  product_status_failed_next_action,
  product_status_permission_denied_explanation,
  product_status_permission_denied_label,
  product_status_permission_denied_next_action,
  product_status_queued_explanation,
  product_status_queued_label,
  product_status_queued_next_action,
  product_status_recoverable_explanation,
  product_status_recoverable_label,
  product_status_recoverable_next_action,
  product_status_running_explanation,
  product_status_running_label,
  product_status_running_next_action,
  product_status_submitting_explanation,
  product_status_submitting_label,
  product_status_submitting_next_action,
  product_status_unknown_explanation,
  product_status_unknown_label,
  product_status_unknown_next_action,
  product_status_unmapped_explanation,
  product_status_unmapped_label,
  product_status_unmapped_next_action,
} from '@/locale/paraglide/messages';

export type ProductStatusTone =
  | 'neutral'
  | 'progress'
  | 'success'
  | 'warning'
  | 'danger';

export interface ProductStatusView {
  explanation: string;
  label: string;
  nextAction: string;
  tone: ProductStatusTone;
}

const statuses: Record<string, () => ProductStatusView> = {
  draft: () => ({
    label: product_status_draft_label(),
    tone: 'neutral',
    explanation: product_status_draft_explanation(),
    nextAction: product_status_draft_next_action(),
  }),
  submitting: () => ({
    label: product_status_submitting_label(),
    tone: 'progress',
    explanation: product_status_submitting_explanation(),
    nextAction: product_status_submitting_next_action(),
  }),
  queued: () => ({
    label: product_status_queued_label(),
    tone: 'progress',
    explanation: product_status_queued_explanation(),
    nextAction: product_status_queued_next_action(),
  }),
  running: () => ({
    label: product_status_running_label(),
    tone: 'progress',
    explanation: product_status_running_explanation(),
    nextAction: product_status_running_next_action(),
  }),
  cancel_requested: () => ({
    label: product_status_cancel_requested_label(),
    tone: 'warning',
    explanation: product_status_cancel_requested_explanation(),
    nextAction: product_status_cancel_requested_next_action(),
  }),
  recoverable: () => ({
    label: product_status_recoverable_label(),
    tone: 'warning',
    explanation: product_status_recoverable_explanation(),
    nextAction: product_status_recoverable_next_action(),
  }),
  unknown: () => ({
    label: product_status_unknown_label(),
    tone: 'warning',
    explanation: product_status_unknown_explanation(),
    nextAction: product_status_unknown_next_action(),
  }),
  completed: () => ({
    label: product_status_completed_label(),
    tone: 'success',
    explanation: product_status_completed_explanation(),
    nextAction: product_status_completed_next_action(),
  }),
  accepted: () => ({
    label: product_status_accepted_label(),
    tone: 'success',
    explanation: product_status_accepted_explanation(),
    nextAction: product_status_accepted_next_action(),
  }),
  failed: () => ({
    label: product_status_failed_label(),
    tone: 'danger',
    explanation: product_status_failed_explanation(),
    nextAction: product_status_failed_next_action(),
  }),
  cancelled: () => ({
    label: product_status_cancelled_label(),
    tone: 'neutral',
    explanation: product_status_cancelled_explanation(),
    nextAction: product_status_cancelled_next_action(),
  }),
  permission_denied: () => ({
    label: product_status_permission_denied_label(),
    tone: 'danger',
    explanation: product_status_permission_denied_explanation(),
    nextAction: product_status_permission_denied_next_action(),
  }),
};

function unknownStatus(): ProductStatusView {
  return {
    label: product_status_unmapped_label(),
    tone: 'neutral',
    explanation: product_status_unmapped_explanation(),
    nextAction: product_status_unmapped_next_action(),
  };
}

export function productStatusView(status: string): ProductStatusView {
  return statuses[status]?.() ?? unknownStatus();
}
