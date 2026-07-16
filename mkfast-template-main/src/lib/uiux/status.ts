import { m } from '@/locale/paraglide/messages';

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
    label: m.product_status_draft_label(),
    tone: 'neutral',
    explanation: m.product_status_draft_explanation(),
    nextAction: m.product_status_draft_next_action(),
  }),
  submitting: () => ({
    label: m.product_status_submitting_label(),
    tone: 'progress',
    explanation: m.product_status_submitting_explanation(),
    nextAction: m.product_status_submitting_next_action(),
  }),
  queued: () => ({
    label: m.product_status_queued_label(),
    tone: 'progress',
    explanation: m.product_status_queued_explanation(),
    nextAction: m.product_status_queued_next_action(),
  }),
  running: () => ({
    label: m.product_status_running_label(),
    tone: 'progress',
    explanation: m.product_status_running_explanation(),
    nextAction: m.product_status_running_next_action(),
  }),
  cancel_requested: () => ({
    label: m.product_status_cancel_requested_label(),
    tone: 'warning',
    explanation: m.product_status_cancel_requested_explanation(),
    nextAction: m.product_status_cancel_requested_next_action(),
  }),
  recoverable: () => ({
    label: m.product_status_recoverable_label(),
    tone: 'warning',
    explanation: m.product_status_recoverable_explanation(),
    nextAction: m.product_status_recoverable_next_action(),
  }),
  unknown: () => ({
    label: m.product_status_unknown_label(),
    tone: 'warning',
    explanation: m.product_status_unknown_explanation(),
    nextAction: m.product_status_unknown_next_action(),
  }),
  completed: () => ({
    label: m.product_status_completed_label(),
    tone: 'success',
    explanation: m.product_status_completed_explanation(),
    nextAction: m.product_status_completed_next_action(),
  }),
  accepted: () => ({
    label: m.product_status_accepted_label(),
    tone: 'success',
    explanation: m.product_status_accepted_explanation(),
    nextAction: m.product_status_accepted_next_action(),
  }),
  failed: () => ({
    label: m.product_status_failed_label(),
    tone: 'danger',
    explanation: m.product_status_failed_explanation(),
    nextAction: m.product_status_failed_next_action(),
  }),
  cancelled: () => ({
    label: m.product_status_cancelled_label(),
    tone: 'neutral',
    explanation: m.product_status_cancelled_explanation(),
    nextAction: m.product_status_cancelled_next_action(),
  }),
  permission_denied: () => ({
    label: m.product_status_permission_denied_label(),
    tone: 'danger',
    explanation: m.product_status_permission_denied_explanation(),
    nextAction: m.product_status_permission_denied_next_action(),
  }),
};

function unknownStatus(): ProductStatusView {
  return {
    label: m.product_status_unmapped_label(),
    tone: 'neutral',
    explanation: m.product_status_unmapped_explanation(),
    nextAction: m.product_status_unmapped_next_action(),
  };
}

export function productStatusView(status: string): ProductStatusView {
  return statuses[status]?.() ?? unknownStatus();
}
