import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion, type Transition } from 'motion/react';
import {
  CircleCheck,
  Copy,
  FileText,
  Handshake,
  Image as ImageIcon,
  Layers,
  Package,
  StickyNote,
  Video,
} from 'lucide-react';
import {
  landing_bento_1_card_line1,
  landing_bento_1_card_line2,
  landing_bento_1_card_meta_1,
  landing_bento_1_card_meta_2,
  landing_bento_1_card_meta_3,
  landing_bento_1_desc,
  landing_bento_1_phone_desc,
  landing_bento_1_phone_line1,
  landing_bento_1_phone_line2,
  landing_bento_1_title,
  landing_bento_2_desc,
  landing_bento_2_float_badge,
  landing_bento_2_float_label,
  landing_bento_2_float_value,
  landing_bento_2_phone_label,
  landing_bento_2_phone_search,
  landing_bento_2_phone_tag_1,
  landing_bento_2_phone_tag_2,
  landing_bento_2_phone_tag_3,
  landing_bento_2_phone_value,
  landing_bento_2_title,
  landing_bento_3_chip_1,
  landing_bento_3_chip_2,
  landing_bento_3_chip_3,
  landing_bento_3_chip_4,
  landing_bento_3_chip_more,
  landing_bento_3_note,
  landing_bento_3_title_line1,
  landing_bento_3_title_line2,
  landing_bento_4_desc,
  landing_bento_4_stat_1_label,
  landing_bento_4_stat_1_value,
  landing_bento_4_stat_2_label,
  landing_bento_4_stat_2_value,
  landing_bento_4_stat_3_label,
  landing_bento_4_stat_3_value,
  landing_bento_4_title,
} from '@/locale/paraglide/messages';

const EASE = [0.23, 1, 0.32, 1] as const;

const cardAnimation = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
};

const getCardTransition = (delay = 0): Transition => ({
  duration: 0.8,
  ease: EASE,
  delay,
});

function PhoneMockup({
  children,
  variant = 'full',
}: {
  children: ReactNode;
  variant?: 'full' | 'compact';
}): ReactNode {
  const isCompact = variant === 'compact';

  return (
    <div
      className={`
        relative bg-background shadow-2xl border-neutral-800 overflow-hidden z-10
        ${
          isCompact
            ? 'w-44 md:w-48 h-64 md:h-72 rounded-3xl border-4'
            : 'w-56 md:w-64 h-96 md:h-115 rounded-t-4xl border-6 border-b-0'
        }
      `}
    >
      <div
        className={`
          absolute left-1/2 -translate-x-1/2 bg-neutral-800 rounded-full z-10
          ${isCompact ? 'top-2 w-16 h-4' : 'top-2 w-20 h-5'}
        `}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

function OutputKindStack(): ReactNode {
  const kinds: { icon: LucideIcon; label: string }[] = [
    { icon: FileText, label: landing_bento_3_chip_1() },
    { icon: ImageIcon, label: landing_bento_3_chip_2() },
    { icon: StickyNote, label: landing_bento_3_chip_3() },
    { icon: Video, label: landing_bento_3_chip_4() },
  ];

  return (
    <div className="flex items-center">
      {kinds.map(({ icon: Icon, label }) => (
        <div
          key={label}
          role="img"
          aria-label={label}
          className="size-12 rounded-full border-2 border-card-secondary bg-frame flex items-center justify-center overflow-hidden -ml-4 first:ml-0"
        >
          <Icon className="size-5 text-card-foreground" aria-hidden="true" />
        </div>
      ))}
      <div className="h-12 min-w-12 px-3 rounded-full border-2 border-card-secondary bg-accent text-black flex items-center justify-center whitespace-nowrap text-xs font-semibold -ml-4">
        {landing_bento_3_chip_more()}
      </div>
    </div>
  );
}

function DeliveryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="flex items-center justify-between bg-background rounded-xl p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4.5 text-foreground" aria-hidden="true" />
        <span className="text-foreground font-medium">{label}</span>
      </div>
      <span className="text-foreground text-sm font-medium">{value}</span>
    </div>
  );
}

function DecorativeCircles(): ReactNode {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="absolute size-56 border border-accent/80 rounded-full" />
      <div className="absolute size-72 border border-accent/60 rounded-full" />
      <div className="absolute size-88 border border-accent/40 rounded-full" />
    </div>
  );
}

function StepByStepCard(): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0)}
      className="group bg-card-primary rounded-4xl p-8 pb-0 overflow-hidden min-h-140 md:row-span-2 flex flex-col"
    >
      <div className="relative z-10 text-center mb-6 transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-2xl md:text-4xl font-medium text-neutral-900 leading-tight mb-3">
          {landing_bento_1_title()}
        </h3>
        <p className="text-neutral-700 text-sm">{landing_bento_1_desc()}</p>
      </div>

      <div className="flex-1 flex justify-center items-end transition-transform duration-500 ease-out group-hover:scale-[1.02]">
        <PhoneMockup variant="full">
          <div className="absolute inset-0 bg-phone-screen pt-14 px-5">
            <h4 className="text-3xl font-medium text-neutral-900 leading-none tracking-tight mt-4">
              {landing_bento_1_phone_line1()}
            </h4>
            <h4 className="text-3xl font-medium text-neutral-900 leading-none tracking-tight mb-4">
              {landing_bento_1_phone_line2()}
            </h4>
            <p className="text-sm text-neutral-500 leading-snug mb-8">
              {landing_bento_1_phone_desc()}
            </p>

            {/* Project Card */}
            <div className="relative bg-linear-to-br from-accent via-accent/80 to-accent/50 rounded-2xl p-4 h-52 shadow-xl overflow-hidden">
              <ProjectCardContent />
            </div>
          </div>
        </PhoneMockup>
      </div>
    </motion.div>
  );
}

function ProjectCardContent(): ReactNode {
  return (
    <>
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0,60 Q30,40 60,50 T100,30"
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="0.5"
        />
        <path
          d="M0,55 Q40,35 70,45 T100,25"
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="0.5"
        />
      </svg>

      <div className="relative z-10 flex items-start justify-between gap-3 h-full">
        <div>
          <p className="text-base font-semibold text-neutral-900">
            {landing_bento_1_card_line1()}
          </p>
          <p className="text-base font-semibold text-neutral-900">
            {landing_bento_1_card_line2()}
          </p>
        </div>
        <CircleCheck className="opacity-25 text-black" aria-hidden="true" />
      </div>

      <div
        className="absolute bottom-3 left-5 flex items-center gap-1.5 text-neutral-700 text-[10px] md:text-xs"
        aria-hidden="true"
      >
        <span>{landing_bento_1_card_meta_1()}</span>
        <span>•</span>
        <span>{landing_bento_1_card_meta_2()}</span>
        <span>•</span>
        <span>{landing_bento_1_card_meta_3()}</span>
      </div>
    </>
  );
}

function DashboardCard(): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.1)}
      className="group bg-card-secondary rounded-4xl p-8 overflow-hidden min-h-80 relative flex flex-col md:block"
    >
      <div className="relative z-10 max-w-48 transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-xl md:text-2xl whitespace-nowrap font-medium text-card-foreground leading-tight mb-3">
          {landing_bento_2_title()}
        </h3>
        <p className="text-card-foreground-muted text-sm">
          {landing_bento_2_desc()}
        </p>
      </div>

      <div className="relative md:absolute mt-8 md:mt-0 md:right-12 md:top-1/2 md:-translate-y-1/2 flex items-center justify-center transition-transform duration-500 ease-out group-hover:scale-105 self-center md:self-auto">
        <DecorativeCircles />

        <PhoneMockup variant="compact">
          <div className="absolute inset-0 bg-phone-screen pt-9 px-3">
            <div className="bg-white rounded-full px-2 py-1.5 mb-3 flex items-center gap-1.5 border border-neutral-200">
              <span className="text-neutral-400 text-xs">
                {landing_bento_2_phone_search()}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mb-0.5">
              {landing_bento_2_phone_label()}
            </p>
            <p className="text-xl font-medium text-neutral-900 mb-3">
              {landing_bento_2_phone_value()}
            </p>

            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="bg-accent text-black text-xs px-2.5 py-1 rounded-full">
                {landing_bento_2_phone_tag_1()}
              </span>
              <span className="text-neutral-400 text-xs px-2 py-1">
                {landing_bento_2_phone_tag_2()}
              </span>
              <span className="text-neutral-400 text-xs px-2 py-1">
                {landing_bento_2_phone_tag_3()}
              </span>
            </div>
          </div>
        </PhoneMockup>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-neutral-900 rounded-2xl px-5 py-3 shadow-xl z-20 whitespace-nowrap">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-neutral-400 text-xs">
              {landing_bento_2_float_label()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-medium text-white">
              {landing_bento_2_float_value()}
            </span>
            <span className="text-xs font-medium text-accent bg-accent/20 px-2 py-0.5 rounded">
              {landing_bento_2_float_badge()}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function OutputKindsCard(): ReactNode {
  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.2)}
      className="group bg-card-secondary rounded-4xl p-6 md:p-8 flex flex-col items-center justify-center text-center min-h-64"
    >
      <div className="transition-transform duration-500 ease-out group-hover:scale-110">
        <h3 className="text-2xl md:text-3xl font-medium text-card-foreground leading-tight mb-1">
          {landing_bento_3_title_line1()}
        </h3>
        <h3 className="text-2xl md:text-3xl font-medium text-card-foreground leading-tight mb-5">
          {landing_bento_3_title_line2()}
        </h3>
      </div>

      <div className="transition-transform duration-500 ease-out group-hover:scale-105">
        <OutputKindStack />
      </div>

      <div className="flex items-center gap-2 mt-5 text-card-foreground-muted transition-transform duration-500 ease-out group-hover:scale-105">
        <Layers className="size-4" aria-hidden="true" />
        <span className="text-xs font-medium">{landing_bento_3_note()}</span>
      </div>
    </motion.div>
  );
}

function IntegrationsCard(): ReactNode {
  const stats: { icon: LucideIcon; label: string; value: string }[] = [
    {
      icon: Copy,
      label: landing_bento_4_stat_1_label(),
      value: landing_bento_4_stat_1_value(),
    },
    {
      icon: Package,
      label: landing_bento_4_stat_2_label(),
      value: landing_bento_4_stat_2_value(),
    },
    {
      icon: Handshake,
      label: landing_bento_4_stat_3_label(),
      value: landing_bento_4_stat_3_value(),
    },
  ];

  return (
    <motion.div
      {...cardAnimation}
      transition={getCardTransition(0.3)}
      className="group bg-card-primary rounded-4xl p-6 md:p-8 flex flex-col min-h-64"
    >
      <div className="mb-auto transition-transform duration-500 ease-out group-hover:scale-105">
        <h3 className="text-xl md:text-2xl font-medium text-neutral-900 leading-tight mb-2">
          {landing_bento_4_title()}
        </h3>
        <p className="text-neutral-700 text-sm">{landing_bento_4_desc()}</p>
      </div>

      <div className="flex flex-col gap-2 mt-6 transition-transform duration-500 ease-out group-hover:scale-[1.02]">
        {stats.map((stat) => (
          <DeliveryStat key={stat.label} {...stat} />
        ))}
      </div>
    </motion.div>
  );
}

export function FeaturesBento(): ReactNode {
  return (
    <section id="features" className="w-full px-6 mb-32 bg-background">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-4">
          <StepByStepCard />
          <DashboardCard />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <OutputKindsCard />
            <IntegrationsCard />
          </div>
        </div>
      </div>
    </section>
  );
}
