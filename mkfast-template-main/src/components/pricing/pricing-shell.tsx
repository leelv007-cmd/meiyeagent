/**
 * Brand-scoped token shell for pricing surfaces (homepage + /pricing).
 * Shop Window tokens (DESIGN.md: ink primary, porcelain cards, Inter stack,
 * rose-gold spark only) cascade into shadcn primitives inside
 * `.meiye-pricing-shell`. Both themes.
 */
export function PricingShellStyles() {
  return (
    <style>{`
      .meiye-pricing-shell {
        --ink: oklch(0.22 0 0);
        --ink-90: oklch(0 0 0 / 0.9);
        --ink-60: oklch(0 0 0 / 0.6);
        --paper: oklch(1 0 0);
        --canvas: oklch(0.965 0 0);
        --spark: oklch(0.63 0.13 18);
        --spark-wash: oklch(0.95 0.025 18);
        --spark-deep: oklch(0.45 0.1 18);
        --surface-0: var(--canvas);
        --surface-1: oklch(0.985 0 0);
        --surface-2: var(--paper);
        --surface-divider: oklch(0 0 0 / 0.04);
        --background: var(--canvas);
        --foreground: var(--ink);
        --card: var(--paper);
        --card-foreground: var(--ink);
        --popover: var(--paper);
        --popover-foreground: var(--ink);
        --primary: var(--ink);
        --primary-foreground: var(--paper);
        --secondary: oklch(0.42 0 0 / 0.08);
        --secondary-foreground: var(--ink-90);
        --muted: oklch(0.42 0 0 / 0.04);
        --muted-foreground: var(--ink-60);
        --accent: oklch(0.42 0 0 / 0.04);
        --accent-foreground: var(--ink-90);
        --border: oklch(0 0 0 / 0.08);
        --input: oklch(0 0 0 / 0.12);
        --ring: var(--ink);
        --radius: 0.75rem;
        min-height: 100%;
        background: var(--background);
        color: var(--foreground);
        font-family:
          Inter, "HarmonyOS Sans", MiSans, "PingFang SC", "Microsoft YaHei",
          ui-sans-serif, system-ui, sans-serif;
      }
      .dark .meiye-pricing-shell {
        --ink: oklch(0.94 0 0);
        --ink-90: oklch(1 0 0 / 0.92);
        --ink-60: oklch(1 0 0 / 0.66);
        --paper: oklch(0.21 0 0);
        --canvas: oklch(0.17 0 0);
        --spark: oklch(0.72 0.11 18);
        --spark-wash: oklch(0.3 0.045 18);
        --spark-deep: oklch(0.88 0.05 18);
        --surface-1: oklch(0.21 0 0);
        --surface-divider: oklch(1 0 0 / 0.1);
        --secondary: oklch(1 0 0 / 0.1);
        --muted: oklch(1 0 0 / 0.06);
        --accent: oklch(1 0 0 / 0.06);
        --border: oklch(1 0 0 / 0.1);
        --input: oklch(1 0 0 / 0.14);
        --ring: oklch(0.85 0.08 18);
        --primary-foreground: var(--canvas);
      }
      .meiye-pricing-shell button[data-slot="button"].bg-primary:hover {
        background: oklch(0.32 0 0);
      }
      .dark .meiye-pricing-shell button[data-slot="button"].bg-primary:hover {
        background: oklch(0.86 0 0);
      }
    `}</style>
  );
}

export function PricingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="meiye-pricing-shell">
      <PricingShellStyles />
      {children}
    </div>
  );
}
