import type { GenerationAccentProps } from './generation-accent';

export default function GenerationAccentMotion({
  label,
}: GenerationAccentProps) {
  return (
    <output
      aria-live="polite"
      className="inline-flex min-h-6 items-center gap-2 text-sm font-medium"
    >
      <span
        aria-hidden="true"
        className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
      />
      <span className="bg-linear-to-r from-muted-foreground via-primary to-muted-foreground bg-clip-text text-transparent motion-reduce:bg-none motion-reduce:text-muted-foreground">
        {label}
      </span>
    </output>
  );
}
