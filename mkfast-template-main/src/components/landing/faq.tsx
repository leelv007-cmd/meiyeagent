import { type ReactNode, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  landing_faq_a1,
  landing_faq_a2,
  landing_faq_a3,
  landing_faq_a4,
  landing_faq_a5,
  landing_faq_a6,
  landing_faq_eyebrow,
  landing_faq_heading,
  landing_faq_q1,
  landing_faq_q2,
  landing_faq_q3,
  landing_faq_q4,
  landing_faq_q5,
  landing_faq_q6,
  landing_faq_subtitle,
  landing_footer_link_contact,
  landing_nav_register,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';

interface FAQEntry {
  question: string;
  answer: string;
}

const ease = [0.23, 1, 0.32, 1] as const;

function FAQItem({
  faq,
  index,
  isOpen,
  onToggle,
}: {
  faq: FAQEntry;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}): ReactNode {
  const triggerId = `faq-trigger-${index}`;
  const panelId = `faq-panel-${index}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, ease, delay: index * 0.05 }}
      className="rounded-2xl bg-frame p-5 shadow-sm sm:p-6"
    >
      <button
        type="button"
        id={triggerId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center justify-between gap-4 text-left"
      >
        <span className="text-base font-medium text-foreground sm:text-lg">
          {faq.question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease }}
          className="shrink-0"
          aria-hidden="true"
        >
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="overflow-hidden"
          >
            <p className="pt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {faq.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function FAQ(): ReactNode {
  const faqs: FAQEntry[] = [
    { question: landing_faq_q1(), answer: landing_faq_a1() },
    { question: landing_faq_q2(), answer: landing_faq_a2() },
    { question: landing_faq_q3(), answer: landing_faq_a3() },
    { question: landing_faq_q4(), answer: landing_faq_a4() },
    { question: landing_faq_q5(), answer: landing_faq_a5() },
    { question: landing_faq_q6(), answer: landing_faq_a6() },
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const handleToggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="w-full px-6 py-20 sm:py-28 scroll-mt-24">
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mb-12 text-center sm:mb-16"
        >
          <span className="text-sm font-medium text-muted-foreground">
            {landing_faq_eyebrow()}
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {landing_faq_heading()}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            {landing_faq_subtitle()}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={Routes.Register}
              className="inline-flex items-center rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {landing_nav_register()}
            </Link>
            <Link
              to={Routes.Contact}
              className="inline-flex items-center rounded-xl border border-border bg-frame px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {landing_footer_link_contact()}
            </Link>
          </div>
        </motion.div>

        <div className="flex flex-col gap-3">
          {faqs.map((faq, index) => (
            <FAQItem
              key={faq.question}
              faq={faq}
              index={index}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
