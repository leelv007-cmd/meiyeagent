/**
 * Three-state sensitive-words gate alert (Spec F / D9 / #384).
 * Shared by exception home and audit; derived state only — no audit events.
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import {
  useAdminEnabledSensitiveWordsGate,
  type SensitiveWordsGateStatus,
} from './admin-sensitive-words-gate';
import {
  admin_sensitive_words_cannot_confirm_whether_the_enabled_lexic_736644b6,
  admin_sensitive_words_checking_sensitive_words_gate_96eae102,
  admin_sensitive_words_no_enabled_sensitive_words_generation_an_851bc69b,
  admin_sensitive_words_sensitive_words_gate_not_active_fac27e2b,
  admin_sensitive_words_sensitive_words_gate_status_unverifiable_df2c0c92,
} from '@/locale/paraglide/messages';

export const SENSITIVE_WORDS_GATE_COPY = {
  loading: admin_sensitive_words_checking_sensitive_words_gate_96eae102(),
  error:
    admin_sensitive_words_sensitive_words_gate_status_unverifiable_df2c0c92(),
  inactive: admin_sensitive_words_sensitive_words_gate_not_active_fac27e2b(),
  inactiveDescription:
    admin_sensitive_words_no_enabled_sensitive_words_generation_an_851bc69b(),
} as const;

function GateStatusAlert({ status }: { status: SensitiveWordsGateStatus }) {
  if (status.kind === 'active') {
    return null;
  }

  if (status.kind === 'loading') {
    return (
      <output
        data-testid="sensitive-words-gate-alert"
        data-gate-status="loading"
        className="block text-sm text-muted-foreground"
      >
        {SENSITIVE_WORDS_GATE_COPY.loading}
      </output>
    );
  }

  if (status.kind === 'error') {
    return (
      <Alert
        variant="destructive"
        data-testid="sensitive-words-gate-alert"
        data-gate-status="error"
      >
        <AlertTitle>{SENSITIVE_WORDS_GATE_COPY.error}</AlertTitle>
        <AlertDescription>
          {admin_sensitive_words_cannot_confirm_whether_the_enabled_lexic_736644b6()}
        </AlertDescription>
      </Alert>
    );
  }

  // inactive: total === 0 only after successful query
  return (
    <Alert
      variant="destructive"
      data-testid="sensitive-words-gate-alert"
      data-gate-status="inactive"
      data-enabled-total="0"
    >
      <AlertTitle>{SENSITIVE_WORDS_GATE_COPY.inactive}</AlertTitle>
      <AlertDescription>
        {SENSITIVE_WORDS_GATE_COPY.inactiveDescription}
      </AlertDescription>
    </Alert>
  );
}

/** Live three-state alert — both pages mount this, sharing one query key. */
export function AdminSensitiveWordsGateAlert() {
  const { status } = useAdminEnabledSensitiveWordsGate();
  return <GateStatusAlert status={status} />;
}

/** Pure presentation for SSR / unit tests with an explicit status. */
export function AdminSensitiveWordsGateAlertView({
  status,
}: {
  status: SensitiveWordsGateStatus;
}) {
  return <GateStatusAlert status={status} />;
}
