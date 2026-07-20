import { useScroll, useTransform, useSpring, motion } from 'motion/react';
import {
  Paperclip,
  Lightbulb,
  PenTool,
  Layout,
  Mic,
  ArrowRight,
  ArrowDown,
} from 'lucide-react';
import { useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  landing_a11y_add_material,
  landing_a11y_voice_input,
  landing_hero_free_note,
  landing_hero_h1_line1_em,
  landing_hero_h1_line1_lead,
  landing_hero_h1_line2_em,
  landing_hero_h1_line2_lead,
  landing_hero_h1_sep,
  landing_hero_input_placeholder,
  landing_hero_mode_daily,
  landing_hero_mode_promo,
  landing_hero_mode_trend,
  landing_hero_send_aria,
  landing_hero_subhead,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { useTheme } from '@/components/theme/theme-provider';
import { FluidCursor } from './fluid-cursor';

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      mediaQuery.addEventListener('change', callback);
      return () => mediaQuery.removeEventListener('change', callback);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  );
}

export function Hero(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);
  const { resolvedTheme } = useTheme();
  const prefersReducedMotion = usePrefersReducedMotion();

  const cursorColor = useMemo(
    () =>
      resolvedTheme === 'dark'
        ? { r: 0.91, g: 0.66, b: 0.35 }
        : { r: 0.66, g: 0.44, b: 0.18 },
    [resolvedTheme]
  );

  const { scrollY, scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  const scaleYRaw = useTransform(scrollYProgress, [0.0, 0.5], [1, 0]);
  const scaleY = useSpring(scaleYRaw, { stiffness: 100, damping: 30 });

  const y = useTransform(scrollY, (value) => value * 0.7);

  return (
    <section ref={sectionRef} className="relative min-h-dvh w-full">
      {!prefersReducedMotion && (
        <FluidCursor color={cursorColor} className="absolute inset-0 -z-5" />
      )}

      <motion.div
        className="pointer-events-none absolute inset-0 -z-10 origin-top scale-125 will-change-transform"
        style={{ scaleY, y }}
        aria-hidden="true"
      >
        <img
          src="/landing/gradient-fade.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-top dark:-scale-y-100"
        />
        <div className="from-background absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t to-transparent" />
      </motion.div>

      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col items-start justify-center gap-6 px-4 py-20 sm:justify-start sm:gap-0 sm:py-0 sm:pt-40 lg:px-8 lg:pt-68">
        <motion.p
          className="landing-display text-background/70 mb-3 text-xs tracking-[0.3em] uppercase sm:mb-5"
          initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          BEAUTY · TRAFFIC · CLIENTS
        </motion.p>

        <motion.h1
          className="text-background dark:text-background text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <span className="block">
            {landing_hero_h1_line1_lead()}
            <em className="text-background/80 dark:text-background/80 italic">
              {landing_hero_h1_line1_em()}
            </em>
            {landing_hero_h1_sep()}
          </span>
          <span className="block">
            {landing_hero_h1_line2_lead()}
            <em className="text-background/80 dark:text-background/80 italic">
              {landing_hero_h1_line2_em()}
            </em>
          </span>
        </motion.h1>

        <motion.div
          className="w-full sm:mt-12 lg:mt-16"
          initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{
            duration: 0.6,
            delay: 0.15,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
        >
          <div
            className="relative rounded-4xl rounded-b-[2.3rem] border border-border bg-[var(--l-card)] p-3"
            style={{
              boxShadow:
                '0 8px 32px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(201, 143, 63, 0.12)',
            }}
          >
            <div className="flex items-start gap-3">
              <textarea
                placeholder={landing_hero_input_placeholder()}
                className="no-focus-ring mx-4 my-2 min-h-15 w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground"
                rows={2}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="focus-ring isolate flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  aria-label={landing_a11y_add_material()}
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  className="focus-ring isolate flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-muted px-5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  <Lightbulb className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">
                    {landing_hero_mode_daily()}
                  </span>
                </button>

                <button
                  type="button"
                  className="focus-ring isolate hidden h-12 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-muted px-5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground sm:flex"
                >
                  <PenTool className="h-4 w-4 shrink-0" />
                  <span>{landing_hero_mode_trend()}</span>
                </button>

                <button
                  type="button"
                  className="focus-ring isolate hidden h-12 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-muted px-5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground md:flex"
                >
                  <Layout className="h-4 w-4 shrink-0" />
                  <span>{landing_hero_mode_promo()}</span>
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="focus-ring isolate hidden h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground sm:flex"
                  aria-label={landing_a11y_voice_input()}
                >
                  <Mic className="h-4 w-4" />
                </button>
                <Link
                  to={Routes.Register}
                  aria-label={landing_hero_send_aria()}
                  className="focus-ring bg-foreground dark:bg-background hover:bg-foreground/90 dark:hover:bg-background/90 isolate flex h-12 w-12 cursor-pointer items-center justify-center rounded-full text-white transition-colors"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>

          <p className="text-background/85 mt-6 text-center text-xs">
            {landing_hero_free_note()}
          </p>
        </motion.div>
      </div>

      <motion.div
        className="relative mx-auto mt-10 flex max-w-4xl items-center justify-between px-4 pb-16 sm:absolute sm:inset-x-0 sm:bottom-24 sm:mt-0 sm:px-6 sm:pb-0 lg:px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.5,
          delay: 0.4,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        <p className="text-foreground/60 dark:text-foreground/50 max-w-sm text-sm">
          {landing_hero_subhead()}
        </p>

        <ArrowDown
          className="text-foreground/60 dark:text-foreground/50 h-12 w-12"
          strokeWidth={1}
        />
      </motion.div>
    </section>
  );
}
