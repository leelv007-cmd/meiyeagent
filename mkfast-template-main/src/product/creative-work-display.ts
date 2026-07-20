import type { CreativeWork } from '@meiye/contracts';
import {
  creative_work_preset_loading,
  creative_work_preset_unavailable,
} from '@/locale/paraglide/messages';

export interface CreativeWorkTemplateDisplay {
  id: string;
  inputGuide?: string;
  name: string;
}

export type CreativeWorkDisplay =
  | {
      inputGuide?: string;
      kind: 'preset';
      presetId: string;
      title: string;
    }
  | { kind: 'manual'; title: string }
  | { kind: 'unresolved'; title: string };

export function creativeWorkDisplay(
  work: CreativeWork,
  templates: CreativeWorkTemplateDisplay[],
  catalogLoaded: boolean
): CreativeWorkDisplay {
  const templateIds = work.sourceReferences
    .filter((reference) => reference.kind === 'template')
    .map((reference) => reference.id);
  if (templateIds.length === 0) {
    return { kind: 'manual', title: work.intent };
  }
  if (!catalogLoaded) {
    return { kind: 'unresolved', title: creative_work_preset_loading() };
  }

  const templatesById = new Map(
    templates.map((template) => [template.id, template])
  );
  const resolved = templateIds.map((id) => templatesById.get(id));
  if (resolved.some((template) => !template)) {
    return { kind: 'unresolved', title: creative_work_preset_unavailable() };
  }

  // Z1 removed the hidden prompt contract that used to identify preset-backed
  // work. A template reference alone is not enough evidence: users may attach
  // an unrelated template after writing their own intent. Keep the recorded
  // intent as the honest title instead of guessing a preset identity.
  return { kind: 'manual', title: work.intent };
}
