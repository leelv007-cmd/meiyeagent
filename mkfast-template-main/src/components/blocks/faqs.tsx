import {
  home_faqs_items_item_1_answer,
  home_faqs_items_item_1_question,
  home_faqs_items_item_2_answer,
  home_faqs_items_item_2_question,
  home_faqs_items_item_3_answer,
  home_faqs_items_item_3_question,
  home_faqs_items_item_4_answer,
  home_faqs_items_item_4_question,
  home_faqs_items_item_5_answer,
  home_faqs_items_item_5_question,
  home_faqs_subtitle,
  home_faqs_title,
} from '@/locale/paraglide/messages';
import { HeaderSection } from '@/components/shared/header-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
export default function FaqSection() {
  const faqItems = [
    {
      id: 'item-1',
      question: home_faqs_items_item_1_question(),
      answer: home_faqs_items_item_1_answer(),
    },
    {
      id: 'item-2',
      question: home_faqs_items_item_2_question(),
      answer: home_faqs_items_item_2_answer(),
    },
    {
      id: 'item-3',
      question: home_faqs_items_item_3_question(),
      answer: home_faqs_items_item_3_answer(),
    },
    {
      id: 'item-4',
      question: home_faqs_items_item_4_question(),
      answer: home_faqs_items_item_4_answer(),
    },
    {
      id: 'item-5',
      question: home_faqs_items_item_5_question(),
      answer: home_faqs_items_item_5_answer(),
    },
  ];
  return (
    <section id="faqs" className="px-4 py-16 md:py-24">
      <div className="mx-auto max-w-4xl">
        <ScrollReveal>
          <HeaderSection
            title={home_faqs_title()}
            subtitle={home_faqs_subtitle()}
          />
        </ScrollReveal>

        <ScrollReveal delay={150} className="mx-auto mt-12 max-w-4xl">
          <Accordion className="ring-primary/10 w-full rounded-2xl border border-primary/15 px-4 py-3 shadow-sm ring-4 dark:ring-primary/5 dark:border-primary/10 sm:px-8">
            {faqItems.map((item) => (
              <AccordionItem
                key={item.id}
                value={item.id}
                className="border-dashed"
              >
                <AccordionTrigger className="text-base hover:no-underline">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-base text-muted-foreground">
                    {item.answer}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollReveal>
      </div>
    </section>
  );
}
