import { landing_statement } from '@/locale/paraglide/messages';
import { BottomCTA } from '@/components/landing/bottom-cta';
import { FAQ } from '@/components/landing/faq';
import { Footer } from '@/components/landing/footer';
import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { ImageReveal } from '@/components/landing/image-reveal';
import { Pricing } from '@/components/landing/pricing';
import { ShowcaseCards } from '@/components/landing/showcase-cards';
import { SkipToContent } from '@/components/landing/skip-to-content';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { Stats } from '@/components/landing/stats';
import { Testimonials } from '@/components/landing/testimonials';
import { TextReveal } from '@/components/landing/text-reveal';
import { ThemeSwitch } from '@/components/landing/theme-switch';
import { ToolsCarousel } from '@/components/landing/tools-carousel';

export function LandingPage() {
  return (
    <SmoothScroll>
      <div className="meiye-landing flex min-h-screen flex-col">
        <SkipToContent />
        <Header />
        <ThemeSwitch />
        <main id="main-content" className="flex-1">
          <Hero />
          <section className="relative py-32 md:py-48">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
              <TextReveal
                text={landing_statement()}
                className="text-4xl font-medium tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl"
              />
            </div>
          </section>
          <ImageReveal />
          <ToolsCarousel />
          <ShowcaseCards />
          <Stats />
          <Testimonials />
          <Pricing />
          <FAQ />
          <BottomCTA />
        </main>
        <Footer />
      </div>
    </SmoothScroll>
  );
}
