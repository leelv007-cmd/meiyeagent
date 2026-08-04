import { z } from 'zod';
import type {
  ContentPackage,
  ContentPackageChildRun,
} from './content-package.js';
import {
  contentPackageChildRunSchema,
  contentPackageGeneratedSchema,
  contentPackageSchema,
} from './content-package.js';

/** Supplier routing and internal unit economics never cross browser boundaries. */
export type PublicContentPackageChildRun = Omit<
  ContentPackageChildRun,
  | 'apiCounterparty'
  | 'providerCost'
  | 'providerCosts'
  | 'providerModel'
  | 'providerAttempts'
  | 'routeSnapshot'
  | 'routeSnapshotId'
>;

export type PublicContentPackage = Omit<ContentPackage, 'generated'> & {
  generated: Omit<ContentPackage['generated'], 'childRuns'> & {
    childRuns: PublicContentPackageChildRun[];
  };
};

const publicContentPackageChildRunSchema = contentPackageChildRunSchema
  .omit({
    apiCounterparty: true,
    providerCost: true,
    providerCosts: true,
    providerModel: true,
    providerAttempts: true,
    routeSnapshot: true,
    routeSnapshotId: true,
  })
  .strict();

export const publicContentPackageSchema: z.ZodType<PublicContentPackage> =
  contentPackageSchema.safeExtend({
    generated: contentPackageGeneratedSchema
      .extend({
        childRuns: z.array(publicContentPackageChildRunSchema),
      })
      .strict(),
  }).strict();

/**
 * The sole ContentPackage serializer for merchant/browser responses.
 * Internal persistence retains the complete supplier audit record.
 */
export function toPublicContentPackage(
  contentPackage: ContentPackage,
): PublicContentPackage {
  return {
    ...structuredClone(contentPackage),
    generated: {
      ...structuredClone(contentPackage.generated),
      childRuns: contentPackage.generated.childRuns.map(
        ({
          apiCounterparty: _apiCounterparty,
          providerCost: _providerCost,
          providerCosts: _providerCosts,
          providerModel: _providerModel,
          providerAttempts: _providerAttempts,
          routeSnapshot: _routeSnapshot,
          routeSnapshotId: _routeSnapshotId,
          ...run
        }) => structuredClone(run),
      ),
    },
  };
}
