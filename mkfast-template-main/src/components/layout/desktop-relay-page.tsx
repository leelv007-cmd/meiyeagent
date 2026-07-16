import { Logo } from '@/components/shared/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ShellMode } from '@/config/sidebar-config';
import { getPathWithLocale } from '@/lib/urls';
import { m } from '@/locale/paraglide/messages';
import { IconCheck, IconCopy, IconDeviceDesktop } from '@tabler/icons-react';
import { useState } from 'react';

export function DesktopRelayPage({
  mode,
}: {
  mode: Extract<ShellMode, 'settings' | 'admin'>;
}) {
  const [copied, setCopied] = useState(false);
  const title =
    mode === 'admin'
      ? m.desktop_relay_admin_title()
      : m.desktop_relay_settings_title();
  const description =
    mode === 'admin'
      ? m.desktop_relay_admin_description()
      : m.desktop_relay_settings_description();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-5 p-5">
      <div className="flex items-center gap-2">
        <Logo className="size-6" />
        <span className="font-semibold">{m.site_name()}</span>
      </div>
      <Card>
        <CardHeader>
          <IconDeviceDesktop className="size-8 text-primary" />
          <h1 className="mt-2 text-xl font-semibold">{title}</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <Alert>
            <AlertTitle>{m.desktop_relay_safe_link_title()}</AlertTitle>
            <AlertDescription>
              {m.desktop_relay_safe_link_description()}
            </AlertDescription>
          </Alert>
          <div className="grid gap-2">
            <Button
              className="min-h-touch-target"
              onClick={() => {
                void navigator.clipboard.writeText(window.location.href);
                setCopied(true);
              }}
            >
              {copied ? <IconCheck /> : <IconCopy />}
              {copied ? m.desktop_relay_copied() : m.desktop_relay_copy()}
            </Button>
            <a
              className={buttonVariants({
                className: 'min-h-touch-target',
                variant: 'outline',
              })}
              href={getPathWithLocale('/dashboard')}
            >
              {m.desktop_relay_return_mobile()}
            </a>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
