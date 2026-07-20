import HeroSection from '@/components/blocks/hero';
import FeaturesSection from '@/components/blocks/features';
import CallToActionSection from '@/components/blocks/calltoaction';
import PricingSection from '@/components/blocks/pricing';
import FaqSection from '@/components/blocks/faqs';
import { websiteConfig } from '@/config/website';

export function HomePage() {
  return (
    <div className="flex flex-col">
      <HeroSection />
      <FeaturesSection />
      <CallToActionSection />
      {websiteConfig.payment?.enable ? <PricingSection /> : null}
      <FaqSection />
    </div>
  );
}
