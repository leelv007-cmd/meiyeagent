import type { CreativeSourceReference } from '@meiye/contracts';
import { m } from '@/locale/paraglide/messages';
import { productStatusView } from '@/lib/uiux/status';
import {
  templateViews,
  type RawTemplate,
  type RawTemplateShortcut,
  type RawUserTemplate,
} from '@/p1/operations-view-model';
import type { ModelOperation } from '@/p1/settings-view-model';
import type { TemplateCatalogItemView } from '@/p1/types';
import type { RawCanonicalHistory } from './canonical-history-model';
import { creativeWorkDisplay } from './creative-work-display';
import type { CreativeToolAvailabilityMap } from './creative-tool-availability';

export interface CreationCatalogResponse {
  shortcuts: RawTemplateShortcut[];
  templates: RawTemplate[];
  userTemplates: RawUserTemplate[];
}

export interface CreationCatalogEntry {
  available: boolean;
  detail: string;
  id: string;
  key: string;
  kind: 'template' | 'tool' | 'reference';
  label: string;
  operation?: ModelOperation;
  owner: 'official' | 'user';
  rawTemplate?: RawTemplate;
  reference?: CreativeSourceReference;
  shortcut?: boolean;
  tags: string[];
  template?: TemplateCatalogItemView;
  unavailableReason?: string;
}

export interface CreationCatalogContext {
  currentWorkId?: string;
  sourceReferences?: CreativeSourceReference[];
}

function toolEntries(): CreationCatalogEntry[] {
  return [
    {
      available: true,
      detail: m.creation_catalog_copy_detail(),
      id: 'copy.generate',
      key: 'tool:copy.generate',
      kind: 'tool',
      label: m.creation_catalog_copy_label(),
      operation: 'copy.generate',
      owner: 'official',
      tags: [m.creation_catalog_tag_copy(), m.creation_catalog_tag_content()],
    },
    {
      available: true,
      detail: m.creation_catalog_image_detail(),
      id: 'image.generate',
      key: 'tool:image.generate',
      kind: 'tool',
      label: m.creation_catalog_image_label(),
      operation: 'image.generate',
      owner: 'official',
      tags: [m.canonical_media_kind_image(), m.creation_catalog_tag_visual()],
    },
    {
      available: true,
      detail: m.creation_catalog_video_detail(),
      id: 'video.generate',
      key: 'tool:video.generate',
      kind: 'tool',
      label: m.creation_catalog_video_label(),
      operation: 'video.generate',
      owner: 'official',
      tags: [m.canonical_media_kind_video()],
    },
  ];
}

function unavailableReason(template: TemplateCatalogItemView) {
  if (template.retired) return m.creation_catalog_template_retired();
  if (!template.canCreate) return m.creation_catalog_template_unpublished();
  return undefined;
}

export function projectCreationCatalog(
  catalog?: CreationCatalogResponse,
  history?: RawCanonicalHistory,
  toolAvailability?: CreativeToolAvailabilityMap,
  context: CreationCatalogContext = {}
): CreationCatalogEntry[] {
  const sourceKeys = new Set(
    (context.sourceReferences ?? []).map(
      (reference) => `${reference.kind}:${reference.id}`
    )
  );
  const referenceReason = (reference: CreativeSourceReference) => {
    if (reference.kind === 'work' && reference.id === context.currentWorkId) {
      return m.creation_catalog_current_work_unavailable();
    }
    if (sourceKeys.has(`${reference.kind}:${reference.id}`)) {
      return m.workbench_source_already_present();
    }
    return undefined;
  };
  const rawTemplateById = new Map(
    (catalog?.templates ?? []).map((template) => [template.id, template])
  );
  const templateItems = templateViews(
    catalog?.templates ?? [],
    catalog?.userTemplates ?? [],
    catalog?.shortcuts ?? []
  );
  const templates = templateItems.map((template): CreationCatalogEntry => {
    const reference = { id: template.id, kind: 'template' } as const;
    const reason = unavailableReason(template) ?? referenceReason(reference);
    const rawTemplate = rawTemplateById.get(template.id);
    return {
      available: !reason,
      detail: `${template.familyLabel} · ${template.versionLabel}`,
      id: template.id,
      key: `template:${template.id}`,
      kind: 'template',
      label: template.name,
      owner: template.ownerKind === 'official' ? 'official' : 'user',
      ...(rawTemplate ? { rawTemplate } : {}),
      reference,
      shortcut: template.isShortcut,
      tags: rawTemplate?.tags ?? [],
      template,
      ...(reason ? { unavailableReason: reason } : {}),
    };
  });
  const assets = (history?.assets ?? []).map((asset): CreationCatalogEntry => {
    const reference = { id: asset.id, kind: 'asset' } as const;
    const reason = referenceReason(reference);
    return {
      available: !reason,
      detail: m.creation_catalog_asset_reference(),
      id: asset.id,
      key: `asset:${asset.id}`,
      kind: 'reference',
      label: asset.title,
      owner: 'user',
      reference,
      tags: [
        asset.kind === 'video'
          ? m.canonical_media_kind_video()
          : m.canonical_media_kind_image(),
      ],
      ...(reason ? { unavailableReason: reason } : {}),
    };
  });
  const works = (history?.creativeWorks ?? []).map(
    (work): CreationCatalogEntry => {
      const display = creativeWorkDisplay(
        work,
        templateItems,
        Boolean(catalog)
      );
      const reference = { id: work.id, kind: 'work' } as const;
      const reason = referenceReason(reference);
      return {
        available: !reason,
        detail: m.creation_catalog_historical_work(),
        id: work.id,
        key: `work:${work.id}`,
        kind: 'reference',
        label: display.title,
        owner: 'user',
        reference,
        tags: [
          work.mode === 'agent'
            ? m.creation_catalog_mode_agent()
            : m.creation_catalog_mode_direct(),
          productStatusView(work.status).label,
        ],
        ...(reason ? { unavailableReason: reason } : {}),
      };
    }
  );

  const tools = toolEntries().map((entry) => {
    const availability = entry.operation
      ? toolAvailability?.[entry.operation]
      : undefined;
    return availability
      ? {
          ...entry,
          available: availability.available,
          ...(availability.unavailableReason
            ? { unavailableReason: availability.unavailableReason }
            : {}),
        }
      : entry;
  });

  return [...templates, ...tools, ...assets, ...works];
}
