import { lazy, Suspense } from 'react';

const GenerationAccentMotion = lazy(() => import('./generation-accent-motion'));

export interface GenerationAccentProps {
  label: string;
}

export function GenerationAccentFallback({ label }: GenerationAccentProps) {
  return (
    <output
      aria-live="polite"
      className="inline-flex min-h-6 items-center gap-2 text-sm text-muted-foreground"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </output>
  );
}

export function GenerationAccent(props: GenerationAccentProps) {
  return (
    <Suspense fallback={<GenerationAccentFallback {...props} />}>
      <GenerationAccentMotion {...props} />
    </Suspense>
  );
}
