import { useCallback, useEffect, useState } from 'react';
import {
  pwa_install_button,
  pwa_install_dismiss,
  pwa_install_ios_hint,
  pwa_install_ios_steps,
  pwa_install_prompt_description,
  pwa_install_prompt_title,
  pwa_install_unavailable,
} from '@/locale/paraglide/messages';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'pwa-install-hint-dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isWebkit;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = window.matchMedia(
    '(display-mode: standalone)'
  ).matches;
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mediaStandalone || iosStandalone;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Ignore quota / private mode.
  }
}

export type InstallPromptVariant = 'settings' | 'mobile-hint';

/**
 * Install entry when beforeinstallprompt is available, plus iOS Safari
 * add-to-home-screen guidance when install is not supported.
 * Low-interruption: settings card always; mobile first-visit hint is dismissible.
 */
export function InstallPrompt({
  variant = 'settings',
  className,
}: {
  variant?: InstallPromptVariant;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    setIos(isIosSafari());
    setDismissed(readDismissed());

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const onInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      setDeferred(null);
    }
  }, [deferred]);

  const onDismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  if (installed) return null;

  if (variant === 'mobile-hint') {
    if (!isMobile || dismissed) return null;
    // Only show light tip when there is something useful to say.
    if (!deferred && !ios) return null;
  }

  const showInstallButton = Boolean(deferred);
  const showIosGuide = !deferred && ios;
  const showUnavailable = !deferred && !ios && variant === 'settings';

  if (!showInstallButton && !showIosGuide && !showUnavailable) return null;

  return (
    <Card
      className={cn(
        'w-full overflow-hidden pt-6 pb-0 flex flex-col',
        variant === 'mobile-hint' &&
          'fixed bottom-20 left-3 right-3 z-40 shadow-lg sm:left-auto sm:right-4 sm:w-96',
        className
      )}
      data-testid={
        variant === 'mobile-hint'
          ? 'pwa-install-mobile-hint'
          : 'pwa-install-settings-card'
      }
    >
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          {pwa_install_prompt_title()}
        </CardTitle>
        <CardDescription>{pwa_install_prompt_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col space-y-3 flex-1 text-sm text-muted-foreground">
        {showIosGuide ? (
          <>
            <p>{pwa_install_ios_hint()}</p>
            <p className="whitespace-pre-line">{pwa_install_ios_steps()}</p>
          </>
        ) : null}
        {showUnavailable ? <p>{pwa_install_unavailable()}</p> : null}
      </CardContent>
      <CardFooter className="px-6 py-4 flex flex-wrap justify-end items-center gap-2 bg-muted rounded-none">
        {variant === 'mobile-hint' ? (
          <Button
            data-testid="pwa-install-dismiss"
            onClick={onDismiss}
            type="button"
            variant="ghost"
          >
            {pwa_install_dismiss()}
          </Button>
        ) : null}
        {showInstallButton ? (
          <Button
            data-testid="pwa-install-button"
            onClick={() => void onInstall()}
            type="button"
          >
            {pwa_install_button()}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
