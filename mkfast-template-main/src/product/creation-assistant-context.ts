import type { CreativeSourceReference } from '@meiye/contracts';
import { m } from '@/locale/paraglide/messages';

type LabeledSource = { id: string; label: string };

const genericSourceLabels: Record<
  CreativeSourceReference['kind'],
  () => string
> = {
  asset: m.creation_assistant_source_asset,
  content: m.creation_assistant_source_content,
  task: m.creation_assistant_source_task,
  template: m.creation_assistant_source_template,
  work: m.creation_assistant_source_work,
};

const sourcePrefixes: Record<CreativeSourceReference['kind'], () => string> = {
  asset: m.creation_assistant_prefix_asset,
  content: m.creation_assistant_prefix_content,
  task: m.creation_assistant_prefix_task,
  template: m.creation_assistant_prefix_template,
  work: m.creation_assistant_prefix_work,
};

export function assistantSourceSummaries(input: {
  assets?: LabeledSource[];
  contents?: LabeledSource[];
  references: CreativeSourceReference[];
  tasks?: LabeledSource[];
  templates?: LabeledSource[];
  works?: LabeledSource[];
}) {
  const sourcesByKind: Record<
    CreativeSourceReference['kind'],
    LabeledSource[] | undefined
  > = {
    asset: input.assets,
    content: input.contents,
    task: input.tasks,
    template: input.templates,
    work: input.works,
  };

  return input.references.map((reference) => {
    const source = sourcesByKind[reference.kind]?.find(
      (candidate) => candidate.id === reference.id
    );
    return source?.label
      ? m.creation_assistant_labeled_source({
          kind: sourcePrefixes[reference.kind](),
          label: source.label,
        })
      : genericSourceLabels[reference.kind]();
  });
}
