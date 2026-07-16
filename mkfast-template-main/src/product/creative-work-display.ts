import type { CreativeWork } from '@meiye/contracts';
import {
  creative_work_preset_loading,
  creative_work_preset_unavailable,
} from '@/locale/paraglide/messages';

export interface CreativeWorkTemplateDisplay {
  id: string;
  inputGuide?: string;
  internalIntent?: string;
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

  const preset = resolved
    .reverse()
    .find(
      (template) =>
        template?.internalIntent && template.internalIntent === work.intent
    );
  if (!preset) {
    return { kind: 'manual', title: work.intent };
  }
  return {
    ...(preset.inputGuide ? { inputGuide: preset.inputGuide } : {}),
    kind: 'preset',
    presetId: preset.id,
    title: preset.name,
  };
}
