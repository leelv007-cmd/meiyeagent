import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminTemplateControl } from '@/p1/admin-template-control';
import { AdminCreationExperienceControl } from '@/p1/admin-creation-experience-control';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { AdminSensitiveWordsControl } from '@/p1/admin-sensitive-words-control';
import { NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_config_key_note_styles,
  admin_note_styles_description,
  admin_templates_description,
  admin_templates_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/templates')({
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <AdminRoutePage
      title={admin_templates_title()}
      description={admin_templates_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="templates" />
        <AdminCreationExperienceControl />
        {/*
          图文笔记的风格集合以前只在契约里，运营改不动（U05 / D-107）。
          现在走的是和别的受控配置同一条路：结构化表单 + 影响面确认 + 写入原因 + 版本回滚。
        */}
        <section className="space-y-3" data-testid="admin-note-styles">
          <div className="space-y-1">
            <h2 className="font-medium text-lg">
              {admin_config_key_note_styles()}
            </h2>
            <p className="text-muted-foreground text-sm">
              {admin_note_styles_description()}
            </p>
          </div>
          <AdminRuntimeConfigControl keys={[NOTE_STYLE_CONFIG_KEY]} />
        </section>
        <AdminSensitiveWordsControl />
        <AdminTemplateControl />
      </div>
    </AdminRoutePage>
  );
}
