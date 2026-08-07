import { getAuthErrorMessages } from '@/lib/locale';
import {
  auth_error_back_home,
  auth_error_retry_action,
  auth_error_status_label,
  auth_error_title,
  auth_error_unknown_description,
} from '@/locale/paraglide/messages';
import { AuthCard } from '@/components/auth/auth-card';
import { buttonVariants } from '@/components/ui/button';
import { Routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';

function getDisplayMessage(
  errorCode: string | undefined,
  errorDescription: string | undefined
): string {
  const authErrorMessages = getAuthErrorMessages();
  if (errorCode && authErrorMessages[errorCode]) {
    return authErrorMessages[errorCode];
  }
  if (errorDescription) {
    return errorDescription;
  }
  if (errorCode) {
    return errorCode;
  }
  return auth_error_unknown_description();
}

/**
 * The auth shell's failure state, written to the same shape as the in-app 404:
 * what happened → why → one real action. It used to be a 14px 「哎呀！出错了！」
 * over a red `<p>` with no next step, and its red was the shadcn default rather
 * than DESIGN.md §7's `status-danger` (`oklch(0.55 0.2 27)`), which the tone
 * classes below carry — the same values `components/uiux/product-status.tsx`
 * uses, so the 规范化状态标签 vocabulary is identical inside and outside the app.
 *
 * The heading and the reason now ride the shared auth header, so the status
 * label appears once (as the 规范化状态标签 above the action) instead of twice.
 */
export function ErrorCard({
  errorCode,
  errorDescription,
}: {
  errorCode?: string;
  errorDescription?: string;
} = {}) {
  const displayMessage = getDisplayMessage(errorCode, errorDescription);
  return (
    <AuthCard
      title={auth_error_title()}
      description={displayMessage}
      bottomButtonHref={Routes.Root}
      bottomButtonLabel={auth_error_back_home()}
    >
      <div className="flex w-full flex-col items-start gap-4">
        <span
          className="inline-flex items-center gap-x-1.5 rounded-md bg-[oklch(0.55_0.2_27/0.1)] px-2 py-1 font-medium text-[oklch(0.45_0.16_27)] text-xs dark:bg-[oklch(0.55_0.2_27/0.18)] dark:text-[oklch(0.84_0.1_27)]"
          data-testid="auth-error-status"
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-[oklch(0.55_0.2_27)]"
          />
          {auth_error_status_label()}
        </span>
        <Link
          className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          data-testid="auth-error-retry"
          to={Routes.Login}
        >
          {auth_error_retry_action()}
        </Link>
      </div>
    </AuthCard>
  );
}
