import { DashboardLayout } from '@/components/layout/dashboard-layout';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { m } from '@/locale/paraglide/messages';
import { ModelSettings } from '@/p1/model-settings';
import { ModelByokSettings } from '@/p1/integration-settings';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/settings/models')({
  validateSearch: (search: Record<string, unknown>) => ({
    section: search.section === 'byok' ? 'byok' : undefined,
  }),
  component: ModelsPage,
});

function ModelsPage() {
  const { section } = Route.useSearch();
  const [advancedOpen, setAdvancedOpen] = useState(section === 'byok');
  useEffect(() => {
    if (section === 'byok') {
      setAdvancedOpen(true);
      const frame = window.requestAnimationFrame(() =>
        document.getElementById('byok')?.scrollIntoView({ block: 'start' })
      );
      return () => window.cancelAnimationFrame(frame);
    }
  }, [section]);
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: m.settings_title(), isCurrentPage: false },
        { label: m.settings_navigation_models(), isCurrentPage: true },
      ]}
      title={m.settings_navigation_models()}
      description={m.settings_models_description()}
    >
      <section className="space-y-4">
        <h2 className="meiye-type-body font-semibold">
          {m.settings_models_preferences_heading()}
        </h2>
        <ModelSettings />
      </section>
      <Collapsible
        className="border-t border-divider pt-6"
        id="byok"
        onOpenChange={setAdvancedOpen}
        open={advancedOpen}
      >
        <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-4 rounded-lg bg-surface-1 p-4 text-left">
          <span>
            <span className="meiye-type-body block font-semibold">
              {m.settings_models_byok_heading()}
            </span>
            <span className="meiye-type-aux mt-1 block">
              {m.settings_models_byok_description()}
            </span>
          </span>
          {advancedOpen ? (
            <IconChevronUp aria-hidden="true" className="size-5 shrink-0" />
          ) : (
            <IconChevronDown aria-hidden="true" className="size-5 shrink-0" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <ModelByokSettings />
        </CollapsibleContent>
      </Collapsible>
    </DashboardLayout>
  );
}
