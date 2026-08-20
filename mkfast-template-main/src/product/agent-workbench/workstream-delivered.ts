/**
 * Workstream `data-delivered` is the merchant-visible delivery statement.
 *
 * `work.delivered` is never emitted (result-delivery projection owns delivery).
 * Publish handoff waits on export receipts copy/FREE packages do not grow.
 * Composer session phase `delivered` is the same moment the delivery card lands.
 */

export function isAgentWorkstreamDelivered(input: {
  deliveredKeyCount: number;
  publishHandoffView?: unknown;
  publishHandoffError?: string | null;
  sessionDelivered?: boolean;
}): boolean {
  return (
    input.deliveredKeyCount > 0 ||
    Boolean(input.publishHandoffView) ||
    Boolean(input.publishHandoffError) ||
    input.sessionDelivered === true
  );
}
