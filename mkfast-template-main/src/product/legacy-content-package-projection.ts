import {
  legacy_projection_delivery_available,
  legacy_projection_delivery_creating,
  legacy_projection_delivery_needs_attention,
  legacy_projection_old_record,
  legacy_projection_old_record_description,
  legacy_projection_true_draft,
  legacy_projection_true_draft_description,
} from '@/locale/paraglide/messages';
import {
  contentPackageStatusGroup,
  type CreativeJob,
  type CreativeWork,
} from '@meiye/contracts';
import type { ContentPackageProjection } from './content-package-presentation';

export type { ContentPackageProjection } from './content-package-presentation';

export type LegacyContentPackageState =
  | {
      contentPackage: ContentPackageProjection;
      description: string;
      kind: 'content_package';
      label: string;
    }
  | {
      description: string;
      kind: 'draft' | 'legacy';
      label: string;
    };

export function latestContentPackageForWork(
  contentPackages: readonly ContentPackageProjection[],
  workId: string
) {
  return contentPackages
    .filter((contentPackage) => contentPackage.source.workId === workId)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.revision - left.revision ||
        right.id.localeCompare(left.id)
    )[0];
}

export function contentPackageProjectionState(
  contentPackage: ContentPackageProjection
): LegacyContentPackageState {
  const statusGroup = contentPackageStatusGroup(contentPackage.status);
  const label =
    statusGroup === 'usable'
      ? legacy_projection_delivery_available({
          revision: contentPackage.revision,
        })
      : statusGroup === 'needs_attention'
        ? legacy_projection_delivery_needs_attention({
            revision: contentPackage.revision,
          })
        : legacy_projection_delivery_creating({
            revision: contentPackage.revision,
          });
  return {
    contentPackage,
    description: label,
    kind: 'content_package',
    label,
  };
}

export function legacyRecordProjectionState(): LegacyContentPackageState {
  return {
    description: legacy_projection_old_record_description(),
    kind: 'legacy',
    label: legacy_projection_old_record(),
  };
}

export function creativeWorkProjectionState(
  work: CreativeWork,
  jobs: readonly CreativeJob[],
  contentPackages: readonly ContentPackageProjection[]
): LegacyContentPackageState {
  const contentPackage = latestContentPackageForWork(contentPackages, work.id);
  if (contentPackage) return contentPackageProjectionState(contentPackage);

  const isPreExecutionDraft =
    work.status === 'draft' && !jobs.some((job) => job.workId === work.id);
  return isPreExecutionDraft
    ? {
        description: legacy_projection_true_draft_description(),
        kind: 'draft',
        label: legacy_projection_true_draft(),
      }
    : legacyRecordProjectionState();
}
