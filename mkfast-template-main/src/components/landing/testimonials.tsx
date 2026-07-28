import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  landing_a11y_goto_scene,
  landing_a11y_next_scene,
  landing_a11y_prev_scene,
  landing_ai_disclosure,
  landing_testimonial_1_company,
  landing_testimonial_1_image_alt,
  landing_testimonial_1_name,
  landing_testimonial_1_quote,
  landing_testimonial_1_stat_1_label,
  landing_testimonial_1_stat_1_value,
  landing_testimonial_1_stat_2_label,
  landing_testimonial_1_stat_2_value,
  landing_testimonial_2_company,
  landing_testimonial_2_image_alt,
  landing_testimonial_2_name,
  landing_testimonial_2_quote,
  landing_testimonial_2_stat_1_label,
  landing_testimonial_2_stat_1_value,
  landing_testimonial_2_stat_2_label,
  landing_testimonial_2_stat_2_value,
  landing_testimonial_3_company,
  landing_testimonial_3_image_alt,
  landing_testimonial_3_name,
  landing_testimonial_3_quote,
  landing_testimonial_3_stat_1_label,
  landing_testimonial_3_stat_1_value,
  landing_testimonial_3_stat_2_label,
  landing_testimonial_3_stat_2_value,
  landing_testimonial_badge,
  landing_testimonials_eyebrow,
  landing_testimonials_title,
} from '@/locale/paraglide/messages';

interface Testimonial {
  badge: string;
  company: string;
  quote: string;
  name: string;
  image: string;
  imageAlt: string;
  stats: {
    label: string;
    value: string;
  }[];
}

function TestimonialCard({
  testimonial,
}: {
  testimonial: Testimonial;
}): ReactNode {
  return (
    <div className="flex h-full w-full flex-col rounded-3xl bg-background p-6 sm:p-8 lg:flex-row lg:gap-12 lg:p-12">
      <div className="flex flex-1 flex-col">
        <span className="w-fit rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-muted-foreground sm:px-4 sm:py-1.5 sm:text-sm">
          {testimonial.badge}
        </span>

        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:mt-6 sm:text-4xl lg:text-5xl">
          {testimonial.company}
        </h3>

        <blockquote className="mt-6 flex-1 text-xl leading-relaxed text-foreground/80">
          &ldquo;{testimonial.quote}&rdquo;
        </blockquote>

        <div className="mt-6 text-base font-medium text-foreground sm:text-lg">
          {testimonial.name}
          <span className="ml-2 font-normal text-muted-foreground">
            {testimonial.company}
          </span>
        </div>
      </div>

      <div className="mt-8 flex flex-col lg:mt-0 lg:w-72">
        <div className="relative h-60 w-full overflow-hidden rounded-3xl lg:w-40 lg:rounded-full">
          <img
            src={testimonial.image}
            alt={testimonial.imageAlt}
            width={320}
            height={480}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div className="mt-6 space-y-2 border-t border-foreground/10 pt-6">
          {testimonial.stats.map((stat) => (
            <div key={stat.label} className="flex justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                {stat.label}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Testimonials(): ReactNode {
  const testimonials: Testimonial[] = [
    {
      badge: landing_testimonial_badge(),
      company: landing_testimonial_1_company(),
      quote: landing_testimonial_1_quote(),
      name: landing_testimonial_1_name(),
      image: '/seed/asset/asset-nail-aurora.webp',
      imageAlt: landing_testimonial_1_image_alt(),
      stats: [
        {
          label: landing_testimonial_1_stat_1_label(),
          value: landing_testimonial_1_stat_1_value(),
        },
        {
          label: landing_testimonial_1_stat_2_label(),
          value: landing_testimonial_1_stat_2_value(),
        },
      ],
    },
    {
      badge: landing_testimonial_badge(),
      company: landing_testimonial_2_company(),
      quote: landing_testimonial_2_quote(),
      name: landing_testimonial_2_name(),
      image: '/seed/asset/asset-hair-curl.webp',
      imageAlt: landing_testimonial_2_image_alt(),
      stats: [
        {
          label: landing_testimonial_2_stat_1_label(),
          value: landing_testimonial_2_stat_1_value(),
        },
        {
          label: landing_testimonial_2_stat_2_label(),
          value: landing_testimonial_2_stat_2_value(),
        },
      ],
    },
    {
      badge: landing_testimonial_badge(),
      company: landing_testimonial_3_company(),
      quote: landing_testimonial_3_quote(),
      name: landing_testimonial_3_name(),
      image: '/seed/asset/asset-skin-glow.webp',
      imageAlt: landing_testimonial_3_image_alt(),
      stats: [
        {
          label: landing_testimonial_3_stat_1_label(),
          value: landing_testimonial_3_stat_1_value(),
        },
        {
          label: landing_testimonial_3_stat_2_label(),
          value: landing_testimonial_3_stat_2_value(),
        },
      ],
    },
  ];

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, 10000);

    return () => clearInterval(timer);
  }, []);

  const paginate = (direction: number) => {
    setActiveIndex(
      (prev) => (prev + direction + testimonials.length) % testimonials.length
    );
  };

  const active = testimonials[activeIndex];

  return (
    <section className="w-full bg-frame border-t border-b border-accent/15 px-6 py-32">
      <div className="mx-auto max-w-5xl">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-sm font-medium text-muted-foreground"
        >
          {landing_testimonials_eyebrow()}
        </motion.p>

        <motion.h2
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="mt-4 mb-16 text-4xl leading-tight font-medium text-foreground sm:text-5xl lg:mb-20 lg:text-6xl"
        >
          {landing_testimonials_title()}
        </motion.h2>

        <div aria-live="polite">
          <AnimatePresence mode="wait">
            {active && (
              <motion.div
                key={activeIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
              >
                <TestimonialCard testimonial={active} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-8 flex items-center justify-between gap-6 lg:gap-8">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            {testimonials.map((testimonial, index) => {
              const isActive = index === activeIndex;
              return (
                <motion.button
                  key={testimonial.company}
                  type="button"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  animate={{ scale: isActive ? 1.1 : 1 }}
                  onClick={() => setActiveIndex(index)}
                  aria-label={landing_a11y_goto_scene({
                    index: String(index + 1),
                  })}
                  className={`cursor-pointer text-sm font-medium transition-colors duration-300 sm:text-base ${
                    isActive
                      ? 'text-accent'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  {testimonial.company}
                </motion.button>
              );
            })}
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => paginate(-1)}
              className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-muted/75 text-foreground transition-colors hover:bg-muted"
              aria-label={landing_a11y_prev_scene()}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => paginate(1)}
              className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-muted/75 text-foreground transition-colors hover:bg-muted"
              aria-label={landing_a11y_next_scene()}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <p className="mt-12 text-center text-xs text-muted-foreground">
          {landing_ai_disclosure()}
        </p>
      </div>
    </section>
  );
}
