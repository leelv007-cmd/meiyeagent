import { type ReactNode, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import {
  landing_faq_a1,
  landing_faq_a2,
  landing_faq_a3,
  landing_faq_a4,
  landing_faq_a5,
  landing_faq_a6,
  landing_faq_q1,
  landing_faq_q2,
  landing_faq_q3,
  landing_faq_q4,
  landing_faq_q5,
  landing_faq_q6,
  landing_faq_title,
} from '@/locale/paraglide/messages';

interface FAQItem {
  question: string;
  answer: string;
}

function FAQItemComponent({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      layout
      className="rounded-2xl bg-muted/50"
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span className="text-base font-medium text-foreground">
          {item.question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="shrink-0"
        >
          <Plus className="h-5 w-5 text-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-5 text-muted-foreground">{item.answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function FAQ(): ReactNode {
  const faqs: FAQItem[] = [
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
    <section
      id="faq"
      className="px-4 py-20 sm:px-6 md:py-28 lg:px-8 border-t border-foreground/10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <p className="text-4xl font-medium tracking-tight text-foreground">
              {landing_faq_title()}
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="flex flex-col gap-3">
              {faqs.map((faq, index) => (
                <FAQItemComponent
                  key={faq.question}
                  item={faq}
                  isOpen={openIndex === index}
                  onToggle={() => handleToggle(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
