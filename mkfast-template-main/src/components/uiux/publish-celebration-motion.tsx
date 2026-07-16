import type { PublishCelebrationProps } from './publish-celebration';

const PARTICLES = [
  ['-top-1 left-1 bg-primary', 'animate-[bounce_700ms_ease-out_1]'],
  ['top-0 right-2 bg-secondary-foreground', 'animate-[ping_700ms_ease-out_1]'],
  ['-bottom-1 left-1/2 bg-primary', 'animate-[bounce_700ms_ease-out_1]'],
] as const;

export default function PublishCelebrationMotion({
  label,
}: PublishCelebrationProps) {
  return (
    <output
      aria-live="polite"
      className="relative inline-flex min-h-6 items-center px-3 text-sm font-medium text-primary"
    >
      <span aria-hidden="true" className="motion-reduce:hidden">
        {PARTICLES.map(([position, animation]) => (
          <span
            className={`absolute size-1.5 rounded-full ${position} ${animation}`}
            key={position}
          />
        ))}
      </span>
      {label}
    </output>
  );
}
