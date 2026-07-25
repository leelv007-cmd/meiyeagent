/**
 * 后台壳的身份区 —— `components/layout/sidebar-user` 的 template-dashboard 对应物。
 *
 * 那一个绑死在 shadcn `SidebarMenuButton` 与它的 `useSidebar()` 上下文上，塞不进
 * HeroUI Sidebar；这里换成 HeroUI 壳内的触发器，菜单本体仍复用 app 既有的
 * DropdownMenu（它走 portal，不依赖任何侧栏上下文）。能力对齐：主题、语言、
 * 账户设置、登出；「进入管理模式」在后台壳里没有意义，故不再出现。
 */
import type { SessionUser } from '@/auth/types';
import { authClient } from '@/auth/client';
import { useLocaleSwitcher } from '@/components/layout/locale-switcher';
import { UserAvatar } from '@/components/shared/user-avatar';
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
import { useTheme } from '@/components/theme/theme-provider';
import { websiteConfig } from '@/config/website';
import { localeConfig, locales, type Locale } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import {
  auth_common_logout,
  auth_common_logout_failed,
  common_mode_dark,
  common_mode_light,
  common_mode_system,
  common_mode_theme,
  common_switch_language,
  sidebar_user_account_settings,
  sidebar_user_menu_aria,
} from '@/locale/paraglide/messages';
import {
  IconDeviceDesktop,
  IconLanguage,
  IconLogout,
  IconMoon,
  IconSelector,
  IconSettings,
  IconSun,
} from '@tabler/icons-react';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';

export function AdminShellUser({ user }: { user: SessionUser }) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();
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
        onError: (error) => {
          toast.error(auth_common_logout_failed());
          console.error('sign out error:', error);
        },
      },
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={sidebar_user_menu_aria({
              identity: user.name ?? user.email,
            })}
            className="hover:bg-surface-secondary flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors"
            type="button"
          >
            <UserAvatar
              className="size-8 border"
              image={user.image ?? null}
              name={user.name ?? null}
            />
            <span className="grid min-w-0 flex-1 text-sm leading-tight">
              <span className="text-foreground truncate font-semibold">
                {user.name}
              </span>
              <span className="text-muted truncate text-xs">{user.email}</span>
            </span>
            <IconSelector className="ml-auto size-4 shrink-0" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56" side="right">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <UserAvatar
                className="size-8 border"
                image={user.image ?? null}
                name={user.name ?? null}
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs opacity-70">
                  {user.email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>

          {showModeSwitch ? (
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
          ) : null}

          {showLocaleSwitch ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconLanguage className="mr-2 size-4" />
                {common_switch_language()}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {locales.map((locale: Locale) => (
                  <DropdownMenuItem
                    disabled={locale === currentLocale}
                    key={locale}
                    onClick={() => switchLocale(locale)}
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
          ) : null}

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
  );
}
