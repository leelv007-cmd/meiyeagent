import { NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts/note-plan';
import { createFileRoute } from '@tanstack/react-router';
import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FrameTitle,
} from '@/components/reui/frame';
import { AdminTemplateControl } from '@/p1/admin-template-control';
import { AdminCreationExperienceControl } from '@/p1/admin-creation-experience-control';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import {
  admin_config_key_note_styles,
  admin_note_styles_description,
  admin_templates_description,
  admin_templates_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/templates')({
  component: TemplatesPage,
});

/**
 * Templates + note styles + creation experience.
 * Spec G / #388 moved sensitive-words governance to /admin/sensitive-words.
 */
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
        {/* Ghost frame: the control renders its own Frame chrome, so this
            wrapper only carries the section heading and the testid. */}
        <Frame variant="ghost" data-testid="admin-note-styles">
          <FrameHeader>
            <FrameTitle>{admin_config_key_note_styles()}</FrameTitle>
            <FrameDescription>
              {admin_note_styles_description()}
            </FrameDescription>
          </FrameHeader>
          <AdminRuntimeConfigControl keys={[NOTE_STYLE_CONFIG_KEY]} />
        </Frame>
        <AdminTemplateControl />
      </div>
    </AdminRoutePage>
  );
}
