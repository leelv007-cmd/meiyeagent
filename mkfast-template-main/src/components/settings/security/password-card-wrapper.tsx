import {
  settings_security_update_password_description,
  settings_security_update_password_title,
} from '@/locale/paraglide/messages';
import {
  SettingsRow,
  SettingsRowFooter,
  SettingsRowHeader,
} from '@/components/settings/settings-section';
import { Skeleton } from '@/components/ui/skeleton';
import { useHasCredentialProvider } from '@/hooks/use-auth';
import { authClient } from '@/auth/client';
import { UpdatePasswordCard } from './update-password-card';
import { ResetPasswordCard } from './reset-password-card';
export function PasswordCardWrapper() {
  const { data: session } = authClient.useSession();
  const { hasCredentialProvider, isLoading, error } = useHasCredentialProvider(
    session?.user?.id
  );
  if (error) {
    console.error('check credential provider error:', error);
    return null;
  }
  if (isLoading) {
    return (
      <SettingsRow>
        <SettingsRowHeader
          description={settings_security_update_password_description()}
          title={settings_security_update_password_title()}
        />
        <div className="flex flex-col space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-6 w-full" />
        </div>
        <SettingsRowFooter>
          <Skeleton className="h-8 w-1/4" />
        </SettingsRowFooter>
      </SettingsRow>
    );
  }
  if (hasCredentialProvider) return <UpdatePasswordCard />;
  if (session?.user?.email) return <ResetPasswordCard />;
  return null;
}
