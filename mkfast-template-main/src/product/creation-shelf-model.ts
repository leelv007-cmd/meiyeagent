import type {
  CreativeInheritanceFieldId,
  CreativeSourceReference,
} from '@meiye/contracts';
import { m } from '@/locale/paraglide/messages';

export const INHERITANCE_FIELD_OPTIONS: Array<{
  id: CreativeInheritanceFieldId;
  label: string;
}> = [
  {
    id: 'content_structure',
    get label() {
      return m.creation_shelf_field_content_structure();
    },
  },
  {
    id: 'layout_slots',
    get label() {
      return m.creation_shelf_field_layout_slots();
    },
  },
  {
    id: 'copy_skeleton',
    get label() {
      return m.creation_shelf_field_copy_skeleton();
    },
  },
  {
    id: 'output_specification',
    get label() {
      return m.creation_shelf_field_output_specification();
    },
  },
  {
    id: 'visual_style',
    get label() {
      return m.creation_shelf_field_visual_style();
    },
  },
];

export const DEFAULT_INHERITANCE_FIELDS: CreativeInheritanceFieldId[] = [
  'content_structure',
  'layout_slots',
  'copy_skeleton',
  'output_specification',
];

export function inheritanceDefaults(
  entry: 'shelf' | 'command_palette' | 'decomposition'
): CreativeInheritanceFieldId[] {
  return entry === 'decomposition' ? [] : [...DEFAULT_INHERITANCE_FIELDS];
}

export function referenceWithInheritance(
  reference: CreativeSourceReference,
  fields: CreativeInheritanceFieldId[]
) {
  return {
    ...reference,
    inheritanceFields: [...fields],
  } satisfies CreativeSourceReference;
}

export function quickTemplateEntries<
  T extends { owner: 'official' | 'user'; shortcut?: boolean },
>(entries: T[]) {
  return [
    ...entries.filter((entry) => entry.shortcut),
    ...entries.filter((entry) => entry.owner === 'official' && !entry.shortcut),
  ].slice(0, 3);
}
