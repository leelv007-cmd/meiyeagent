import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_sensitive_words_description,
  admin_sensitive_words_title,
} from '@/locale/paraglide/messages';
import { AdminSensitiveWordsControl } from '@/p1/admin-sensitive-words-control';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Spec G / #388: sensitive-words CRUD is compliance governance — mounts under
 * runtime_and_governance, not the templates container.
 * Control logic is unchanged; only mounting/navigation moved.
 * #384 gate alert stays on exception home + audit (derived banner, not CRUD).
 */
export const Route = createFileRoute('/admin/sensitive-words')({
  component: SensitiveWordsPage,
});

function SensitiveWordsPage() {
  return (
    <AdminRoutePage
      title={admin_sensitive_words_title()}
      description={admin_sensitive_words_description()}
    >
      <div className="space-y-4">
        <AdminSensitiveWordsControl />
      </div>
    </AdminRoutePage>
  );
}
