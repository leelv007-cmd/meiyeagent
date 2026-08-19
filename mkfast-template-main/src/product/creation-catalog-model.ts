import type { CreativeSourceReference } from '@meiye/contracts';
import {
  canonical_media_kind_image,
  canonical_media_kind_video,
  creation_catalog_asset_reference,
  creation_catalog_current_work_unavailable,
  creation_catalog_historical_work,
  creation_catalog_mode_agent,
  creation_catalog_mode_direct,
  creation_catalog_template_retired,
  creation_catalog_template_unpublished,
  workbench_source_already_present,
} from '@/locale/paraglide/messages';
import { productStatusView } from '@/lib/uiux/status';
import {
  templateViews,
  type RawTemplate,
  type RawTemplateShortcut,
  type RawUserTemplate,
} from '@/p1/operations-view-model';
import type { TemplateCatalogItemView } from '@/p1/types';
import type { RawCanonicalHistory } from './canonical-history-model';
import { creativeWorkDisplay } from './creative-work-display';

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
  kind: 'template' | 'reference';
  label: string;
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

function unavailableReason(template: TemplateCatalogItemView) {
  if (template.retired) return creation_catalog_template_retired();
  if (!template.canCreate) return creation_catalog_template_unpublished();
  return undefined;
}

export function projectCreationCatalog(
  catalog?: CreationCatalogResponse,
  history?: RawCanonicalHistory,
  context: CreationCatalogContext = {}
): CreationCatalogEntry[] {
  const sourceKeys = new Set(
    (context.sourceReferences ?? []).map(
      (reference) => `${reference.kind}:${reference.id}`
    )
  );
  const referenceReason = (reference: CreativeSourceReference) => {
    if (reference.kind === 'work' && reference.id === context.currentWorkId) {
      return creation_catalog_current_work_unavailable();
    }
    if (sourceKeys.has(`${reference.kind}:${reference.id}`)) {
      return workbench_source_already_present();
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
      detail: creation_catalog_asset_reference(),
      id: asset.id,
      key: `asset:${asset.id}`,
      kind: 'reference',
      label: asset.title,
      owner: 'user',
      reference,
      tags: [
        asset.kind === 'video'
          ? canonical_media_kind_video()
          : canonical_media_kind_image(),
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
        detail: creation_catalog_historical_work(),
        id: work.id,
        key: `work:${work.id}`,
        kind: 'reference',
        label: display.title,
        owner: 'user',
        reference,
        tags: [
          work.mode === 'agent'
            ? creation_catalog_mode_agent()
            : creation_catalog_mode_direct(),
          productStatusView(work.status).label,
        ],
        ...(reason ? { unavailableReason: reason } : {}),
      };
    }
  );

  return [...templates, ...assets, ...works];
}
