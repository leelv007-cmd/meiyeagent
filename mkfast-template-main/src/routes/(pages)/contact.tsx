import {
  contact_description,
  contact_title,
} from '@/locale/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import Container from '@/components/layout/container';
import { ContactFormCard } from '@/components/contact/contact-form-card';
import { websiteConfig } from '@/config/website';
import { seo } from '@/lib/seo';

interface ContactSearch {
  /** Set by /pricing's「开通后通知我」so the form can name the plan back. */
  plan?: string;
}

export const Route = createFileRoute('/(pages)/contact')({
  validateSearch: (search: Record<string, unknown>): ContactSearch =>
    typeof search.plan === 'string' && search.plan.length > 0
      ? { plan: search.plan }
      : {},
  head: () =>
    seo('/contact', {
      title: `${contact_title()} | ${websiteConfig.metadata?.name}`,
      description: contact_description(),
    }),
  component: ContactPage,
});

function ContactPage() {
  const { plan } = Route.useSearch();
  return (
    <Container className="py-16 px-4">
      <div className="mx-auto max-w-4xl space-y-8 pb-16">
        <div className="space-y-4">
          <h1 className="text-center text-3xl font-bold tracking-tight">
            {contact_title()}
          </h1>
          <p className="text-center text-lg text-muted-foreground">
            {contact_description()}
          </p>
        </div>
        <ContactFormCard planId={plan} />
      </div>
    </Container>
  );
}
