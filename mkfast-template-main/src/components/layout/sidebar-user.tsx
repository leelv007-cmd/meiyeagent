import {
  auth_common_logout,
  auth_common_logout_failed,
  common_mode_dark,
  common_mode_light,
  common_mode_system,
  common_mode_theme,
  common_switch_language,
  sidebar_user_account_settings,
  sidebar_user_enter_admin,
  sidebar_user_menu_aria,
} from '@/locale/paraglide/messages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSidebar } from '@/components/heroui-pro';
import { websiteConfig } from '@/config/website';
import type { SessionUser } from '@/auth/types';
import { localeConfig, locales, type Locale } from '@/lib/locale';
import { useLocaleSwitcher } from '@/components/layout/locale-switcher';
import {
  IconDeviceDesktop,
  IconLanguage,
  IconLogout,
  IconMoon,
  IconSelector,
  IconSettings,
  IconShieldCheck,
  IconSun,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useTheme } from '@/components/theme/theme-provider';
import { UserAvatar } from '@/components/shared/user-avatar';
import { authClient } from '@/auth/client';
import { useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Routes } from '@/lib/routes';
interface SidebarUserProps {
  user: SessionUser;
  className?: string;
}
export function SidebarUser({ user }: SidebarUserProps) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const { currentLocale, switchLocale } = useLocaleSwitcher({
    onLocaleChange: () => setOpen(false),
  });
  const showModeSwitch = websiteConfig.ui?.mode?.enableSwitch ?? false;
  const showLocaleSwitch = locales.length > 1;
  const ThemeIcon =
    theme === 'system'
      ? IconDeviceDesktop
      : theme === 'dark'
        ? IconMoon
        : IconSun;
  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.navigate({ to: '/' });
        },
        onError: (err) => {
          toast.error(auth_common_logout_failed());
          console.error('sign out error:', err);
        },
      },
    });
  };
  return (
    <div className="meiye-sidebar-identity">
      <div>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            render={
              <button
                aria-label={sidebar_user_menu_aria({
                  identity: user.name ?? user.email,
                })}
                className="meiye-sidebar-nav-item meiye-sidebar-nav-item--identity"
                type="button"
              >
                <UserAvatar
                  name={user.name ?? null}
                  image={user.image ?? null}
                  className="size-8 shrink-0 border"
                />
                <div
                  className="grid min-w-0 flex-1 text-left text-sm leading-tight"
                  data-sidebar="label"
                >
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
                <IconSelector
                  className="ml-auto size-4 shrink-0"
                  data-sidebar="label"
                />
              </button>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserAvatar
                    name={user.name ?? null}
                    image={user.image ?? null}
                    className="size-8 border"
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-foreground">
                      {user.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>

              {showModeSwitch && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ThemeIcon className="mr-2 size-4" />
                      {common_mode_theme()}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => setTheme('light')}>
                        <IconSun className="mr-2 size-4" />
                        {common_mode_light()}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTheme('dark')}>
                        <IconMoon className="mr-2 size-4" />
                        {common_mode_dark()}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTheme('system')}>
                        <IconDeviceDesktop className="mr-2 size-4" />
                        {common_mode_system()}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

              {showLocaleSwitch && (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <IconLanguage className="mr-2 size-4" />
                      {common_switch_language()}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {locales.map((locale: Locale) => (
                        <DropdownMenuItem
                          key={locale}
                          onClick={() => switchLocale(locale)}
                          disabled={locale === currentLocale}
                        >
                          {localeConfig[locale].flag ? (
                            <span className="mr-2 text-base">
                              {localeConfig[locale].flag}
                            </span>
                          ) : null}
                          <span>{localeConfig[locale].name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setOpen(false);
                  router.navigate({ to: Routes.SettingsAccount });
                }}
              >
                <IconSettings className="mr-2 size-4" />
                {sidebar_user_account_settings()}
              </DropdownMenuItem>
              {user.role === 'admin' ? (
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false);
                    router.navigate({ to: Routes.AdminModels });
                  }}
                >
                  <IconShieldCheck className="mr-2 size-4" />
                  {sidebar_user_enter_admin()}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async (event) => {
                  event.preventDefault();
                  setOpen(false);
                  await handleSignOut();
                }}
              >
                <IconLogout className="mr-2 size-4" />
                {auth_common_logout()}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
