import { motion, useInView } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import {
  landing_stats_1_category,
  landing_stats_1_manual_display,
  landing_stats_1_ours_display,
  landing_stats_2_category,
  landing_stats_2_manual_display,
  landing_stats_2_ours_display,
  landing_stats_3_category,
  landing_stats_3_manual_display,
  landing_stats_3_ours_display,
  landing_stats_4_category,
  landing_stats_4_manual_display,
  landing_stats_4_ours_display,
  landing_stats_manual,
  landing_stats_ours,
  landing_stats_subtitle,
  landing_stats_title,
} from '@/locale/paraglide/messages';

interface Bar {
  name: string;
  value: number;
  display: string;
  isOurs?: boolean;
}

interface Benchmark {
  category: string;
  bars: Bar[];
}

function BarChart({ benchmark }: { benchmark: Benchmark }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  const maxValue = Math.max(...benchmark.bars.map((c) => c.value));

  return (
    <div ref={ref} className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-medium text-foreground">
          {benchmark.category}
        </h3>
      </div>

      <div className="space-y-3">
        {benchmark.bars.map((bar, index) => {
          const percentage = maxValue > 0 ? (bar.value / maxValue) * 100 : 0;

          return (
            <div key={bar.name} className="flex items-center gap-4">
              <div className="w-28 shrink-0">
                <span
                  className={`text-sm ${
                    bar.isOurs
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {bar.name}
                </span>
              </div>

              <div className="flex flex-1 items-center gap-0">
                <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-muted/30">
                  <motion.div
                    className={`absolute inset-y-0 left-0 rounded-sm ${
                      bar.isOurs
                        ? 'bg-linear-to-r from-[#8A5A2B] to-[#D4A155]'
                        : 'bg-muted/75'
                    }`}
                    initial={{ width: 0 }}
                    animate={
                      isInView ? { width: `${percentage}%` } : { width: 0 }
                    }
                    transition={{
                      duration: 0.8,
                      delay: index * 0.1,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                  />
                </div>

                <div className="w-24 shrink-0 pl-2 text-right">
                  <motion.span
                    className={`text-sm ${
                      bar.isOurs
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground'
                    }`}
                    initial={{ opacity: 0 }}
                    animate={isInView ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                  >
                    {bar.display}
                  </motion.span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Stats(): ReactNode {
  const benchmarks: Benchmark[] = [
    {
      category: landing_stats_1_category(),
      bars: [
        {
          name: landing_stats_ours(),
          value: 2,
          display: landing_stats_1_ours_display(),
          isOurs: true,
        },
        {
          name: landing_stats_manual(),
          value: 8,
          display: landing_stats_1_manual_display(),
        },
      ],
    },
    {
      category: landing_stats_2_category(),
      bars: [
        {
          name: landing_stats_ours(),
          value: 1,
          display: landing_stats_2_ours_display(),
          isOurs: true,
        },
        {
          name: landing_stats_manual(),
          value: 3,
          display: landing_stats_2_manual_display(),
        },
      ],
    },
    {
      category: landing_stats_3_category(),
      bars: [
        {
          name: landing_stats_ours(),
          value: 2,
          display: landing_stats_3_ours_display(),
          isOurs: true,
        },
        {
          name: landing_stats_manual(),
          value: 1,
          display: landing_stats_3_manual_display(),
        },
      ],
    },
    {
      category: landing_stats_4_category(),
      bars: [
        {
          name: landing_stats_ours(),
          value: 0,
          display: landing_stats_4_ours_display(),
          isOurs: true,
        },
        {
          name: landing_stats_manual(),
          value: 8,
          display: landing_stats_4_manual_display(),
        },
      ],
    },
  ];

  return (
    <section className="px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <h2 className="text-2xl font-medium tracking-tight text-foreground md:text-3xl lg:text-4xl">
            {landing_stats_title()}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {landing_stats_subtitle()}
          </p>
        </div>

        <div className="grid gap-12 sm:grid-cols-2">
          {benchmarks.map((benchmark) => (
            <BarChart key={benchmark.category} benchmark={benchmark} />
          ))}
        </div>
      </div>
    </section>
  );
}
