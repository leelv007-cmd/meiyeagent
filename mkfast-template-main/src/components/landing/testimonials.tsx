import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  landing_a11y_goto_scene,
  landing_a11y_next_scene,
  landing_a11y_prev_scene,
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
  landing_testimonial_sketch_label,
  landing_testimonial_stat_scene_label,
  landing_testimonial_stat_scene_value,
  landing_testimonials_title,
} from '@/locale/paraglide/messages';

interface Testimonial {
  badge: string;
  company: string;
  quote: string;
  name: string;
  role: string;
  image: string;
  imageAlt: string;
  stats: {
    label: string;
    value: string;
  }[];
}

function TestimonialCard({
  testimonial,
  isActive,
}: {
  testimonial: Testimonial;
  isActive: boolean;
}) {
  return (
    <div
      className={`flex h-full w-full flex-col rounded-3xl p-6 sm:p-8 lg:flex-row lg:gap-12 lg:p-12 transition-colors duration-300 ${isActive ? 'bg-accent/20' : 'bg-muted'}`}
    >
      <div className="flex flex-1 flex-col">
        <span className="w-fit rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground sm:px-4 sm:py-1.5 sm:text-sm">
          {testimonial.badge}
        </span>

        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:mt-6 sm:text-4xl lg:text-5xl">
          {testimonial.company}
        </h3>

        <p className="mt-4 flex-1 text-base leading-relaxed text-foreground/80 sm:mt-6 sm:text-lg lg:mt-8 lg:text-xl">
          {testimonial.quote}
        </p>

        <div className="mt-6 flex items-center gap-3 sm:mt-8">
          <img
            src={testimonial.image}
            alt={testimonial.imageAlt}
            width={40}
            height={40}
            loading="lazy"
            className="h-10 w-10 rounded-full object-cover lg:hidden"
          />
          <div>
            <p className="text-sm font-medium text-foreground sm:text-base">
              {testimonial.name}
            </p>
            <p className="text-xs text-muted-foreground sm:text-sm lg:hidden leading-snug">
              {testimonial.role}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs font-medium uppercase text-muted-foreground/60 lg:mt-6">
          {testimonial.company}
        </p>
      </div>

      <div className="hidden flex-col lg:flex lg:w-72">
        <div className="relative h-60 w-40 overflow-hidden rounded-full">
          <img
            src={testimonial.image}
            alt={testimonial.imageAlt}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div className="mt-2 pt-6">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {testimonial.role}
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground leading-snug">
            {testimonial.name}
          </p>
        </div>

        <div className="mt-6 border-t border-foreground/10 pt-8">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {landing_testimonial_sketch_label()}
          </p>
          <div className="mt-4 space-y-2">
            {testimonial.stats.map((stat) => (
              <div key={stat.label} className="flex justify-between">
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
      role: landing_testimonial_badge(),
      image: '/seed/asset/asset-nail-milkwhite.webp',
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
        {
          label: landing_testimonial_stat_scene_label(),
          value: landing_testimonial_stat_scene_value(),
        },
      ],
    },
    {
      badge: landing_testimonial_badge(),
      company: landing_testimonial_2_company(),
      quote: landing_testimonial_2_quote(),
      name: landing_testimonial_2_name(),
      role: landing_testimonial_badge(),
      image: '/seed/asset/asset-hair-bob.webp',
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
        {
          label: landing_testimonial_stat_scene_label(),
          value: landing_testimonial_stat_scene_value(),
        },
      ],
    },
    {
      badge: landing_testimonial_badge(),
      company: landing_testimonial_3_company(),
      quote: landing_testimonial_3_quote(),
      name: landing_testimonial_3_name(),
      role: landing_testimonial_badge(),
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
        {
          label: landing_testimonial_stat_scene_label(),
          value: landing_testimonial_stat_scene_value(),
        },
      ],
    },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [measurements, setMeasurements] = useState({ cardWidth: 0, gap: 24 });

  const x = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 80, damping: 20 });

  const measure = useCallback(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const gap = 24;
      const peekWidth = 0;
      const cardWidth = containerWidth - peekWidth;
      setMeasurements({ cardWidth, gap });
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    const { cardWidth, gap } = measurements;
    if (cardWidth > 0) {
      x.set(-currentIndex * (cardWidth + gap));
    }
  }, [currentIndex, measurements, x]);

  const paginate = (direction: number) => {
    setCurrentIndex((prev) => {
      const next = prev + direction;
      if (next < 0) return 0;
      if (next >= testimonials.length) return testimonials.length - 1;
      return next;
    });
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const { cardWidth, gap } = measurements;

  return (
    <section className="overflow-hidden py-20 md:py-28">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl mb-12">
          <p className="text-4xl font-medium tracking-tight text-foreground">
            {landing_testimonials_title()}
          </p>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8">
        <div ref={containerRef} className="mx-auto max-w-7xl">
          <div className="overflow-visible">
            <motion.div className="flex" style={{ x: springX, gap }}>
              {testimonials.map((testimonial, index) => (
                <div
                  key={testimonial.company}
                  className="shrink-0"
                  style={{ width: cardWidth || '90%' }}
                >
                  <TestimonialCard
                    testimonial={testimonial}
                    isActive={index === currentIndex}
                  />
                </div>
              ))}
            </motion.div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <div className="flex gap-2">
              {testimonials.map((testimonial, index) => (
                <button
                  key={testimonial.company}
                  type="button"
                  onClick={() => goToSlide(index)}
                  className={`h-2 cursor-pointer rounded-full transition-all duration-300 ${
                    index === currentIndex
                      ? 'w-8 bg-foreground'
                      : 'w-2 bg-foreground/30 hover:bg-foreground/50'
                  }`}
                  aria-label={landing_a11y_goto_scene({ index: index + 1 })}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => paginate(-1)}
                disabled={currentIndex === 0}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-muted/75 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={landing_a11y_prev_scene()}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => paginate(1)}
                disabled={currentIndex === testimonials.length - 1}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-muted/75 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={landing_a11y_next_scene()}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
