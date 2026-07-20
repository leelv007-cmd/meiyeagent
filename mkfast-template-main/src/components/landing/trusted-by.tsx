import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  landing_trustedby_cta,
  landing_trustedby_subtitle,
  landing_trustedby_title,
} from '@/locale/paraglide/messages';

interface Logo {
  name: string;
  src: string;
  href: string;
}

const logosSetA: Logo[] = [
  { name: 'Acme Corp', src: '/landing/logos/acmecorp.svg', href: '#acme' },
  {
    name: 'Boltshift',
    src: '/landing/logos/boltshift.svg',
    href: '#boltshift',
  },
  { name: 'Capsule', src: '/landing/logos/capsule.svg', href: '#capsule' },
  { name: 'Catalog', src: '/landing/logos/catalog.svg', href: '#catalog' },
  {
    name: 'Cloudwatch',
    src: '/landing/logos/cloudwatch.svg',
    href: '#cloudwatch',
  },
  {
    name: 'Featherdev',
    src: '/landing/logos/featherdev.svg',
    href: '#featherdev',
  },
];

const logosSetB: Logo[] = [
  { name: 'Altshift', src: '/landing/logos/altshift.svg', href: '#altshift' },
  {
    name: 'Biosynthesis',
    src: '/landing/logos/biosynthesis.svg',
    href: '#biosynthesis',
  },
  { name: 'Commandr', src: '/landing/logos/commandr.svg', href: '#commandr' },
  {
    name: 'Epicurious',
    src: '/landing/logos/epicurious.svg',
    href: '#epicurious',
  },
  {
    name: 'Focalpoint',
    src: '/landing/logos/focalpoint.svg',
    href: '#focalpoint',
  },
  { name: 'Galileo', src: '/landing/logos/galileo.svg', href: '#galileo' },
];

function LogoCell({
  logoA,
  logoB,
  index,
}: {
  logoA: Logo;
  logoB: Logo;
  index: number;
}): ReactNode {
  const [showSecond, setShowSecond] = useState(false);
  const activeLogo = showSecond ? logoB : logoA;

  const scheduleSwap = useCallback(() => {
    const baseDelay = 3000 + Math.random() * 4000;
    const staggerDelay = index * 300;
    return setTimeout(() => {
      setShowSecond((prev) => !prev);
    }, baseDelay + staggerDelay);
  }, [index]);

  useEffect(() => {
    let timeout = scheduleSwap();
    const interval = setInterval(
      () => {
        clearTimeout(timeout);
        timeout = scheduleSwap();
      },
      7000 + Math.random() * 3000
    );

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [scheduleSwap]);

  return (
    <a
      href={activeLogo.href}
      className="relative flex h-24 items-center justify-center rounded-xl bg-muted/50 px-6 transition-colors hover:bg-muted focus-ring overflow-hidden"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={showSecond ? 'b' : 'a'}
          initial={{ opacity: 0, filter: 'blur(8px)', scale: 0.9 }}
          animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
          exit={{ opacity: 0, filter: 'blur(8px)', scale: 0.9 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="flex items-center justify-center"
        >
          <img
            src={activeLogo.src}
            alt={activeLogo.name}
            width={120}
            height={40}
            loading="lazy"
            className="h-8 w-auto object-contain opacity-70 grayscale transition-all hover:opacity-100 hover:grayscale-0 dark:invert"
          />
        </motion.div>
      </AnimatePresence>
    </a>
  );
}

export function TrustedBy(): ReactNode {
  return (
    <section className="py-20 md:py-28">
      <div className="px-4 sm:px-6 lg:px-[max(2rem,calc((100vw-85rem)/2+2rem))]">
        <div className="mb-10 flex items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-medium tracking-tight text-foreground md:text-3xl lg:text-4xl">
              {landing_trustedby_title()}
            </h2>
            <p className="mt-2 text-base text-muted-foreground md:text-lg">
              {landing_trustedby_subtitle()}
            </p>
          </div>
          <Link
            to="/auth/register"
            className="group flex shrink-0 items-center leading-0 gap-2 text-xl font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {landing_trustedby_cta()}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
          {logosSetA.map((logoA, index) => (
            <LogoCell
              key={logoA.name}
              logoA={logoA}
              logoB={logosSetB[index] ?? logoA}
              index={index}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
