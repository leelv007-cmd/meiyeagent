import { ArrowDownRight } from 'lucide-react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  landing_hero_badge,
  landing_hero_h1_line1,
  landing_hero_h1_line2_em,
  landing_hero_h1_line2_lead,
  landing_hero_loop_1,
  landing_hero_loop_2,
  landing_hero_loop_3,
  landing_hero_loop_4,
  landing_hero_loop_5,
  landing_hero_loop_6,
  landing_hero_loop_7,
  landing_hero_loop_8,
  landing_hero_mock_alt,
  landing_hero_subhead,
  landing_nav_register,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { LogoLoop, type LoopItem } from './logo-loop';

const ease = [0.23, 1, 0.32, 1] as const;

const fadeInUp = {
  hidden: { opacity: 0, y: 20, filter: 'blur(8px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
};

const fadeInScale = {
  hidden: { opacity: 0, scale: 0.95, filter: 'blur(8px)' },
  visible: { opacity: 1, scale: 1, filter: 'blur(0px)' },
};

const PARALLAX_INTENSITY = 20;

export function Hero(): ReactNode {
  const sectionRef = useRef<HTMLElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 150 };
  const x = useSpring(mouseX, springConfig);
  const y = useSpring(mouseY, springConfig);

  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (!sectionRef.current) return;

    if (window.innerWidth < 850) return;

    const rect = sectionRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const offsetX = (e.clientX - centerX) / (rect.width / 2);
    const offsetY = (e.clientY - centerY) / (rect.height / 2);

    mouseX.set(offsetX * PARALLAX_INTENSITY);
    mouseY.set(offsetY * PARALLAX_INTENSITY);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  const loopItems: LoopItem[] = [
    landing_hero_loop_1(),
    landing_hero_loop_2(),
    landing_hero_loop_3(),
    landing_hero_loop_4(),
    landing_hero_loop_5(),
    landing_hero_loop_6(),
    landing_hero_loop_7(),
    landing_hero_loop_8(),
  ].map((label) => ({
    node: (
      <span className="inline-flex items-center rounded-full border border-black/10 bg-white/70 px-5 py-2 text-sm font-medium text-black whitespace-nowrap">
        {label}
      </span>
    ),
  }));

  return (
    <section
      ref={sectionRef}
      className="flex flex-col relative"
      style={{ colorScheme: 'light' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="absolute inset-0 min-[850px]:inset-2.5 bg-cover bg-bottom bg-no-repeat -z-10 rounded-br-4xl rounded-bl-4xl min-[850px]:scale-105"
        style={{
          backgroundImage: 'url(/landing/hero-bg.jpg)',
          x,
          y,
        }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-center px-6 pt-64 max-[850px]:pt-32">
        <motion.div
          className="flex flex-col items-center max-[850px]:items-start text-center max-[850px]:text-left max-w-4xl max-[850px]:w-full"
          initial="hidden"
          animate="visible"
          transition={{ staggerChildren: 0.15, delayChildren: 0.2 }}
        >
          <motion.div
            className="inline-flex items-center gap-1.5 pl-4 pr-3 py-1.5 rounded-xl border border-black/10 bg-white text-black text-sm font-medium mb-6"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            {landing_hero_badge()}
            <span className="text-accent">✦</span>
          </motion.div>

          <h1 className="text-8xl max-[850px]:text-5xl font-medium tracking-tight leading-[1.1] mb-6 text-black">
            <motion.span
              className="block"
              variants={fadeInUp}
              transition={{ duration: 0.8, ease }}
            >
              {landing_hero_h1_line1()}
            </motion.span>
            <motion.span
              className="block"
              variants={fadeInUp}
              transition={{ duration: 0.8, ease }}
            >
              {landing_hero_h1_line2_lead()}{' '}
              <span className="italic font-serif text-accent">
                {landing_hero_h1_line2_em()}
              </span>
            </motion.span>
          </h1>

          <motion.p
            className="text-lg text-neutral-600 mb-8"
            variants={fadeInUp}
            transition={{ duration: 0.8, ease }}
          >
            {landing_hero_subhead()}
          </motion.p>

          <motion.div
            className="max-[850px]:w-full"
            variants={fadeInScale}
            transition={{ duration: 0.8, ease }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Link
              to={Routes.Register}
              className="group relative cursor-pointer inline-flex items-center max-[850px]:w-full"
            >
              <span className="absolute right-0 inset-y-0 w-[calc(100%-2rem)] max-[850px]:w-full rounded-xl bg-accent" />
              <span className="relative z-10 px-6 py-3 rounded-xl bg-black text-white font-medium max-[850px]:flex-1">
                {landing_nav_register()}
              </span>
              <span className="relative -left-px z-10 w-11 h-11 rounded-xl flex items-center justify-center text-black">
                <ArrowDownRight className="w-5 h-5 transition-transform duration-300 group-hover:-rotate-45" />
              </span>
            </Link>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="relative px-6 mt-24 max-[850px]:mt-10"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.6, ease }}
      >
        <div className="relative max-w-5xl mx-auto">
          <div className="relative rounded-2xl overflow-hidden border border-neutral-200 shadow-2xl/5 mask-[linear-gradient(to_bottom,black_50%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_50%,transparent_100%)]">
            <img
              src="/landing/product-shot.webp"
              alt={landing_hero_mock_alt()}
              width={1440}
              height={900}
              className="w-full h-auto"
              fetchPriority="high"
            />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="pt-24 pb-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1, ease }}
      >
        <LogoLoop items={loopItems} speed={60} itemHeight={42} gap={124} />
      </motion.div>
    </section>
  );
}
