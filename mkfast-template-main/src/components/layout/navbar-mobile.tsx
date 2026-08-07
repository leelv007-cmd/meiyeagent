import {
  auth_common_login,
  auth_common_signup,
  common_mobile_navigation,
  common_toggle_menu,
} from '@/locale/paraglide/messages';
import { getNavbarLinks } from '@/config/navbar-config';
import { authClient } from '@/auth/client';
import { isLinkActive } from '@/lib/urls';
import { cn } from '@/lib/utils';
import { Routes } from '@/lib/routes';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Link, useLocation } from '@tanstack/react-router';
import { IconChevronRight, IconMenu2, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Logo } from '@/components/shared/logo';
import { ModeSwitcherHorizontal } from '@/components/theme/mode-switcher-horizontal';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { UserButtonMobile } from '@/components/shared/user-button-mobile';
import { LoginWrapper } from '@/components/auth/login-wrapper';
import { websiteConfig } from '@/config/website';
// p-2 around one line of text is a 40px row (36 for the sub-links) — under the
// touch-target floor on the one surface that is only ever read with a thumb.
const mobileLinkClass =
  'flex w-full items-center rounded-md p-2 text-base text-muted-foreground transition-colors duration-150 hover:text-foreground pointer-coarse:min-h-touch-target';
const mobileLinkActiveClass = 'font-semibold text-primary';
const mobileSubLinkClass =
  'flex w-full items-center gap-4 rounded-md p-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground pointer-coarse:min-h-touch-target';
interface NavbarMobileProps extends React.HTMLAttributes<HTMLDivElement> {}
export function NavbarMobile({ className, ...props }: NavbarMobileProps) {
  const pathname = useLocation().pathname;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;
  const menuLinks = getNavbarLinks();
  // Sync mount (avoid hydration mismatch) and close drawer on route change
  useEffect(() => {
    setMounted(true);
    setOpen(false);
  }, [pathname]);
  if (!mounted) return null;
  return (
    <>
      <div
        className={cn('flex items-center justify-between', className)}
        {...props}
      >
        <Link to="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-xl font-semibold">
            {websiteConfig.metadata?.name}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {websiteConfig.auth?.enable &&
            (isPending ? (
              <Skeleton className="size-8 rounded-full" />
            ) : user ? (
              <UserButtonMobile user={user} />
            ) : (
              /*
                注册 used to live only inside the hamburger: on a phone the one
                action the whole marketing site is asking for took a tap to
                reveal. It stays in the drawer too (with 登录 next to it) —
                this is the visible copy of it, not a move.
              */
              <Link
                className={cn(
                  buttonVariants({ size: 'sm' }),
                  'shrink-0 pointer-coarse:px-4'
                )}
                to={Routes.Register}
              >
                {auth_common_signup()}
              </Link>
            ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-label={common_toggle_menu()}
            onClick={() => setOpen((o) => !o)}
            className="size-8 rounded-md border pointer-coarse:size-touch-target"
          >
            {open ? (
              <IconX className="size-4" />
            ) : (
              <IconMenu2 className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={common_mobile_navigation()}
          /*
            top-* has to clear the bar itself: py-4 plus a 32px row is 57px,
            plus a touch-target row is 80px. Growing the controls without moving
            this would drop the sheet over the hamburger that closes it.
          */
          className="fixed inset-0 top-14.25 z-50 flex flex-col overflow-y-auto bg-background animate-in fade-in-0 duration-200 pointer-coarse:top-20"
        >
          <div className="flex flex-1 flex-col items-start gap-4 p-4">
            {websiteConfig.auth?.enable && !user && (
              <div className="flex w-full flex-col gap-4">
                <LoginWrapper mode="redirect" asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full"
                    onClick={() => setOpen(false)}
                  >
                    {auth_common_login()}
                  </Button>
                </LoginWrapper>
                <Link
                  to={Routes.Register}
                  onClick={() => setOpen(false)}
                  className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
                >
                  {auth_common_signup()}
                </Link>
              </div>
            )}

            <ul className="w-full space-y-1">
              {menuLinks?.map((item) => {
                const active = item.href
                  ? isLinkActive(item.href, pathname)
                  : item.items?.some((sub) => isLinkActive(sub.href, pathname));
                return (
                  <li key={item.title} className="py-1">
                    {item.items ? (
                      <Collapsible>
                        <CollapsibleTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              className={cn(
                                'w-full justify-between text-left text-base',
                                'bg-transparent text-muted-foreground hover:text-foreground',
                                active && 'font-semibold text-primary'
                              )}
                            >
                              {item.title}
                              <IconChevronRight className="size-4" />
                            </Button>
                          }
                          nativeButton={false}
                        />
                        <CollapsibleContent className="pl-2">
                          <ul className="mt-2 space-y-2">
                            {item.items.map((sub) => (
                              <li key={sub.title}>
                                <Link
                                  to={sub.href ?? '#'}
                                  target={sub.external ? '_blank' : undefined}
                                  rel={
                                    sub.external
                                      ? 'noopener noreferrer'
                                      : undefined
                                  }
                                  onClick={() => setOpen(false)}
                                  className={cn(
                                    mobileSubLinkClass,
                                    isLinkActive(sub.href, pathname) &&
                                      mobileLinkActiveClass
                                  )}
                                >
                                  {sub.icon ? (
                                    <sub.icon className="size-4 shrink-0" />
                                  ) : null}
                                  {sub.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <Link
                        to={item.href ?? '#'}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noopener noreferrer' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          mobileLinkClass,
                          active && mobileLinkActiveClass
                        )}
                      >
                        {item.title}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-auto w-full border-t border-border/50 p-4 flex items-center justify-end gap-2">
              <LocaleSwitcher onLocaleChange={() => setOpen(false)} />
              <ModeSwitcherHorizontal />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
