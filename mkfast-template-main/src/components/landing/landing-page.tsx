import { BlurInHeadline } from '@/components/landing/blur-in-headline';
import { FAQ } from '@/components/landing/faq';
import { FeaturesBento } from '@/components/landing/features-bento';
import { Footer } from '@/components/landing/footer';
import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Pricing } from '@/components/landing/pricing';
import { SiteFrame } from '@/components/landing/site-frame';
import { SkipToContent } from '@/components/landing/skip-to-content';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { Testimonials } from '@/components/landing/testimonials';
import { ThemeSwitch } from '@/components/landing/theme-switch';

/**
 * Section order follows the SaaS template baseline
 * (references/repos/saas首页模板/app/page.tsx) one for one.
 */
export function LandingPage() {
  return (
    <SmoothScroll>
      <div className="meiye-landing flex min-h-screen flex-col">
        <SkipToContent />
        <SiteFrame />
        <Header />
        <ThemeSwitch />
        <main id="main-content" className="flex-1">
          <Hero />
          <BlurInHeadline />
          <FeaturesBento />
          <Testimonials />
          <HowItWorks />
          <Pricing />
          <FAQ />
        </main>
        <Footer />
      </div>
    </SmoothScroll>
  );
}
