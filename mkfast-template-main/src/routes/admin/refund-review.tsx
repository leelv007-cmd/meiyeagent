import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_refund_review_description,
  admin_refund_review_title,
} from '@/locale/paraglide/messages';
import { AdminPaymentRefundReview } from '@/p1/admin-payment-refund-review';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Spec G / #388: refund review is a write workflow — mounts under
 * account_and_commerce (billing domain), not the read-only audit page.
 * Control logic is unchanged; only mounting/navigation moved.
 */
export const Route = createFileRoute('/admin/refund-review')({
  component: RefundReviewPage,
});

function RefundReviewPage() {
  return (
    <AdminRoutePage
      title={admin_refund_review_title()}
      description={admin_refund_review_description()}
    >
      <div className="space-y-4">
        <AdminPaymentRefundReview />
      </div>
    </AdminRoutePage>
  );
}
