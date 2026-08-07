import {
  settings_security_reset_password_button,
  settings_security_reset_password_description,
  settings_security_reset_password_info,
  settings_security_reset_password_title,
} from '@/locale/paraglide/messages';
import { Button } from '@/components/ui/button';
import {
  SettingsRow,
  SettingsRowFooter,
  SettingsRowHeader,
} from '@/components/settings/settings-section';
import { authClient } from '@/auth/client';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { Routes } from '@/lib/routes';
interface ResetPasswordCardProps {
  className?: string;
}
/**
 * For users who signed up with social providers: guide them to set a password via forgot-password flow.
 */
export function ResetPasswordCard({ className }: ResetPasswordCardProps) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const handleSetupPassword = () => {
    const email = session?.user?.email;
    navigate({
      to: Routes.ForgotPassword,
      search: email ? { email } : {},
    });
  };
  return (
    <SettingsRow className={cn(className)}>
      <SettingsRowHeader
        description={settings_security_reset_password_description()}
        title={settings_security_reset_password_title()}
      />
      <p className="text-sm text-muted-foreground">
        {settings_security_reset_password_info()}
      </p>
      <SettingsRowFooter>
        <Button onClick={handleSetupPassword}>
          {settings_security_reset_password_button()}
        </Button>
      </SettingsRowFooter>
    </SettingsRow>
  );
}
