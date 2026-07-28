import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { motion, useScroll, useTransform } from 'motion/react';
import { Download, MessageSquare, Sparkles, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  landing_nav_register,
  landing_steps_1_desc,
  landing_steps_1_title,
  landing_steps_2_desc,
  landing_steps_2_title,
  landing_steps_3_desc,
  landing_steps_3_title,
  landing_steps_4_desc,
  landing_steps_4_title,
  landing_steps_eyebrow,
  landing_steps_title,
} from '@/locale/paraglide/messages';

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

function StepItem({
  step,
  isLast,
}: {
  step: Step;
  isLast: boolean;
}): ReactNode {
  const Icon = step.icon;

  return (
    <div className={`relative flex gap-5 ${isLast ? '' : 'pb-64'}`}>
      <div
        className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5 text-black" strokeWidth={2} />
      </div>

      <div className="pt-1">
        <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
          {step.title}
        </h3>
        <p className="mt-2 max-w-sm text-base leading-relaxed text-foreground/60">
          {step.description}
        </p>
      </div>
    </div>
  );
}

export function HowItWorks(): ReactNode {
  const steps: Step[] = [
    {
      icon: MessageSquare,
      title: landing_steps_1_title(),
      description: landing_steps_1_desc(),
    },
    {
      icon: Sparkles,
      title: landing_steps_2_title(),
      description: landing_steps_2_desc(),
    },
    {
      icon: Wand2,
      title: landing_steps_3_title(),
      description: landing_steps_3_desc(),
    },
    {
      icon: Download,
      title: landing_steps_4_title(),
      description: landing_steps_4_desc(),
    },
  ];

  const containerRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 0.3', 'end 0.7'],
  });

  const lineHeight = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  return (
    <section
      id="how"
      ref={containerRef}
      className="relative w-full bg-background"
    >
      <div className="mx-auto grid max-w-5xl gap-12 px-6 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20">
        <div className="lg:sticky lg:top-48 lg:h-fit lg:self-start">
          <p className="text-sm font-medium text-muted-foreground">
            {landing_steps_eyebrow()}
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {landing_steps_title()}
          </h2>
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="mt-8 w-fit"
          >
            <Link
              to="/auth/register"
              className="inline-flex items-center rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {landing_nav_register()}
            </Link>
          </motion.div>
        </div>

        <div className="relative">
          <div
            className="absolute left-6 top-6 h-[calc(100%-6rem)] w-0.5 -translate-x-1/2 bg-foreground/10"
            aria-hidden="true"
          >
            <motion.div
              style={{ height: lineHeight, willChange: 'height' }}
              className="w-full bg-accent"
            />
          </div>

          <ol className="relative list-none p-0 m-0">
            {steps.map((step, index) => (
              <li key={step.title}>
                <StepItem step={step} isLast={index === steps.length - 1} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
