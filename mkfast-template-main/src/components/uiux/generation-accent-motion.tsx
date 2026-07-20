import type { GenerationAccentProps } from './generation-accent';

export default function GenerationAccentMotion({
  label,
}: GenerationAccentProps) {
  return (
    <output
      aria-live="polite"
      className="meiye-rose-glow inline-flex min-h-8 items-center gap-2 rounded-full bg-spark-wash px-3 py-1 text-sm font-medium text-spark-deep"
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-spark motion-safe:animate-pulse"
      />
      <span>{label}</span>
    </output>
  );
}
