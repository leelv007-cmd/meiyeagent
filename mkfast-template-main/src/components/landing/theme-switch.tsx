import { IconMoon as Moon, IconSun as Sun } from '@tabler/icons-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import {
  landing_a11y_theme_to_dark,
  landing_a11y_theme_to_light,
  landing_a11y_theme_toggle,
} from '@/locale/paraglide/messages';
import { useTheme } from '@/components/theme/theme-provider';

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function ThemeSwitch(): ReactNode {
  const mounted = useIsMounted();
  const { setTheme, resolvedTheme } = useTheme();

  const toggleTheme = (): void => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  if (!mounted) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          className="w-12 h-12 rounded-full bg-foreground/10 opacity-30 cursor-not-allowed"
          aria-label={landing_a11y_theme_toggle()}
          disabled
        />
      </div>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <button
        onClick={toggleTheme}
        className="w-10 h-10 cursor-pointer rounded-full bg-muted text-foreground flex items-center justify-center opacity-30 hover:opacity-100 transition-opacity duration-300 shadow-lg hover:shadow-xl"
        aria-label={
          isDark ? landing_a11y_theme_to_light() : landing_a11y_theme_to_dark()
        }
        aria-pressed={isDark}
        type="button"
      >
        {isDark ? (
          <Sun className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Moon className="w-5 h-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
