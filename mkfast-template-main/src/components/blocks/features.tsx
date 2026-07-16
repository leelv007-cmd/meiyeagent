import {
  home_features_description,
  home_features_items_item_1_description,
  home_features_items_item_1_title,
  home_features_items_item_2_description,
  home_features_items_item_2_title,
  home_features_items_item_3_description,
  home_features_items_item_3_title,
  home_features_items_item_4_description,
  home_features_items_item_4_title,
  home_features_subtitle,
  home_features_title,
} from '@/locale/paraglide/messages';
import { HeaderSection } from '@/components/shared/header-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import type { Icon } from '@tabler/icons-react';
import {
  IconCalendarCheck,
  IconPhoto,
  IconSparkles,
  IconTimeline,
} from '@tabler/icons-react';
type ImageKey = 'item-1' | 'item-2' | 'item-3' | 'item-4';
const icons: Record<ImageKey, Icon> = {
  'item-1': IconSparkles,
  'item-2': IconPhoto,
  'item-3': IconCalendarCheck,
  'item-4': IconTimeline,
};
export default function FeaturesSection() {
  const featureItems = [
    {
      key: 'item-1' as const,
      title: home_features_items_item_1_title(),
      description: home_features_items_item_1_description(),
    },
    {
      key: 'item-2' as const,
      title: home_features_items_item_2_title(),
      description: home_features_items_item_2_description(),
    },
    {
      key: 'item-3' as const,
      title: home_features_items_item_3_title(),
      description: home_features_items_item_3_description(),
    },
    {
      key: 'item-4' as const,
      title: home_features_items_item_4_title(),
      description: home_features_items_item_4_description(),
    },
  ];
  return (
    <section id="features" className="px-4 py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-2 lg:px-0 space-y-8 lg:space-y-20 dark:[--color-border:color-mix(in_oklab,var(--color-white)_10%,transparent)]">
        <ScrollReveal>
          <HeaderSection
            title={home_features_title()}
            subtitle={home_features_subtitle()}
            description={home_features_description()}
          />
        </ScrollReveal>

        <ScrollReveal delay={150}>
          <div className="grid gap-4 sm:grid-cols-2">
            {featureItems.map((item) => {
              const ItemIcon = icons[item.key];
              return (
                <article
                  className="rounded-2xl border bg-card p-6 shadow-sm"
                  key={item.key}
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ItemIcon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </article>
              );
            })}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
