import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { appPageHead } from '@/lib/seo';
import {
  settings_models_byok_description,
  settings_models_byok_heading,
  settings_models_description,
  settings_models_preferences_heading,
  settings_navigation_models,
  settings_title,
} from '@/locale/paraglide/messages';
import { ModelSettings } from '@/p1/model-settings';
import { ModelByokSettings } from '@/p1/integration-settings';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/settings/models')({
  validateSearch: (search: Record<string, unknown>) => ({
    section: search.section === 'byok' ? 'byok' : undefined,
  }),
  head: () => appPageHead(settings_navigation_models()),
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
        { label: settings_title(), isCurrentPage: false },
        { label: settings_navigation_models(), isCurrentPage: true },
      ]}
      title={settings_navigation_models()}
      description={settings_models_description()}
    >
      <section className="space-y-4">
        <h2 className="meiye-type-body font-semibold">
          {settings_models_preferences_heading()}
        </h2>
        <ModelSettings
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          advancedExtra={
            <section
              className="space-y-3 border-t border-divider pt-6"
              id="byok"
            >
              <div>
                <h3 className="meiye-type-body font-semibold">
                  {settings_models_byok_heading()}
                </h3>
                <p className="meiye-type-aux mt-1 text-muted-foreground">
                  {settings_models_byok_description()}
                </p>
              </div>
              <ModelByokSettings />
            </section>
          }
        />
      </section>
    </DashboardLayout>
  );
}
