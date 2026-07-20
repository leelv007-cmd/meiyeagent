import { lazy, Suspense } from 'react';

const GenerationAccentMotion = lazy(() => import('./generation-accent-motion'));

export interface GenerationAccentProps {
  label: string;
}

export function GenerationAccentFallback({ label }: GenerationAccentProps) {
  return (
    <output
      aria-live="polite"
      className="inline-flex min-h-8 items-center gap-2 rounded-full border border-spark/40 bg-spark-wash px-3 py-1 text-sm font-medium text-spark-deep"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-spark" />
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
