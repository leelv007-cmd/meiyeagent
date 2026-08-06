/**
 * Three-state sensitive-words gate alert (Spec F / D9 / #384).
 * Shared by exception home and audit; derived state only — no audit events.
 */
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import {
  useAdminEnabledSensitiveWordsGate,
  type SensitiveWordsGateStatus,
} from './admin-sensitive-words-gate';

export const SENSITIVE_WORDS_GATE_COPY = {
  loading: '正在核验敏感词门状态…',
  error: '敏感词门状态无法核验',
  inactive: '敏感词门未生效',
  inactiveDescription:
    '当前没有启用中的违禁词。生成链与红线门会跳过扫描（冷启动友好，非 fail-closed）。请在违禁词库启用至少一条词条后，内容红线才会把关。',
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
          无法确认已启用词库是否为空。不得假定门已生效或未生效；请刷新后重试。
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
