import {
  auth_social_or,
  auth_social_sign_in_with_google,
} from '@/locale/paraglide/messages';
import { useState } from 'react';
import { DividerWithText } from '@/components/auth/divider-with-text';
import { Button } from '@/components/ui/button';
import { websiteConfig } from '@/config/website';
import { authClient } from '@/auth/client';
import { clearProductSessionClientStateOnAuthBoundary } from '@/product/session-client-state';
import { DEFAULT_LOGIN_REDIRECT, Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { IconBrandGoogleFilled, IconLoader2 } from '@tabler/icons-react';
interface SocialLoginButtonProps {
  callbackUrl?: string;
  showDivider?: boolean;
}
export function SocialLoginButton({
  callbackUrl: propCallbackUrl,
  showDivider = true,
}: SocialLoginButtonProps) {
  const paramCallbackUrl =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('callbackUrl')
      : null;
  const defaultCallbackUrl = getPathWithLocale(DEFAULT_LOGIN_REDIRECT);
  const callbackUrl =
    propCallbackUrl ??
    (paramCallbackUrl ? paramCallbackUrl : defaultCallbackUrl);
  const [isLoading, setIsLoading] = useState<'google' | null>(null);
  if (!websiteConfig.auth?.enableGoogleLogin) {
    return null;
  }
  const onClick = async (provider: 'google') => {
    await authClient.signIn.social(
      {
        provider,
        callbackURL: callbackUrl,
        errorCallbackURL: getPathWithLocale(Routes.AuthError),
      },
      {
        onRequest: () => setIsLoading(provider),
        onResponse: () => setIsLoading(null),
        onSuccess: () => {
          clearProductSessionClientStateOnAuthBoundary();
          setIsLoading(null);
        },
        onError: () => setIsLoading(null),
      }
    );
  };
  return (
    <div className="w-full flex flex-col gap-4">
      {showDivider && <DividerWithText text={auth_social_or()} />}
      <Button
        size="lg"
        className="w-full"
        variant="outline"
        onClick={() => onClick('google')}
        disabled={isLoading === 'google'}
      >
        {isLoading === 'google' ? (
          <IconLoader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <IconBrandGoogleFilled className="size-4 mr-2" />
        )}
        <span>{auth_social_sign_in_with_google()}</span>
      </Button>
    </div>
  );
}
