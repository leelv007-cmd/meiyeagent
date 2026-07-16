import { lazy, Suspense } from 'react';

const PublishCelebrationMotion = lazy(
  () => import('./publish-celebration-motion')
);

export interface PublishCelebrationProps {
  label: string;
}

export function PublishCelebrationFallback({ label }: PublishCelebrationProps) {
  return (
    <output
      aria-live="polite"
      className="inline-flex min-h-6 items-center text-sm font-medium text-primary"
    >
      {label}
    </output>
  );
}

export function PublishCelebration(props: PublishCelebrationProps) {
  return (
    <Suspense fallback={<PublishCelebrationFallback {...props} />}>
      <PublishCelebrationMotion {...props} />
    </Suspense>
  );
}
