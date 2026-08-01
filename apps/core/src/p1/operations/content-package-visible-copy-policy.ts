import type { ContentPackage, ContentPackageVersion } from '@meiye/contracts';

import {
  validateHarnessPolicy,
  type HarnessPolicyResult,
} from '../harness/policy-gates.js';
import type { ContentPackageApprovalPolicyPort } from './content-package-delivery.js';

export async function validateContentPackageVisibleCopyPolicy(input: {
  approvalPolicy?: ContentPackageApprovalPolicyPort;
  contentPackage: ContentPackage;
  intendedUse: 'paid_promotion' | 'public_content';
  phase: 'delivery' | 'export';
  target: string;
  versionId: string;
}): Promise<HarnessPolicyResult> {
  const resolved = input.approvalPolicy
    ? await input.approvalPolicy.resolve({
        contentPackage: input.contentPackage,
        intendedUse: input.intendedUse,
        variantVersionId: input.versionId,
      })
    : fallbackPolicy(input.contentPackage, input.intendedUse, input.versionId);
  return validateHarnessPolicy({
    ...resolved.policy,
    ...(input.phase === 'export'
      ? {
          actionContext: {
            kind: 'export' as const,
            revision: input.contentPackage.revision,
            target: input.target,
          },
          currentRevision: input.contentPackage.revision,
        }
      : {}),
    phase: input.phase,
  });
}

export function contentPackageVersionVisibleText(
  version: Pick<
    ContentPackageVersion,
    'body' | 'conversionHook' | 'note' | 'title'
  >
) {
  return [
    { field: 'title', text: version.title },
    { field: 'body', text: version.body },
    ...(version.conversionHook
      ? [{ field: 'cta', text: version.conversionHook }]
      : []),
    ...(version.note?.plan.pages.flatMap((page) => [
      {
        field: `note.pages.${page.id}.title`,
        text: page.textBlock.title,
      },
      {
        field: `note.pages.${page.id}.body`,
        text: page.textBlock.body,
      },
    ]) ?? []),
  ];
}

function fallbackPolicy(
  contentPackage: ContentPackage,
  intendedUse: 'paid_promotion' | 'public_content',
  versionId: string,
) {
  const version =
    contentPackage.versions.find((candidate) => candidate.id === versionId) ??
    contentPackage.variants
      .flatMap(({ versions }) => versions)
      .find((candidate) => candidate.id === versionId);
  if (!version) {
    throw new Error('The visible-copy policy version was not found.');
  }
  return {
    policy: {
      brief: {},
      bundle: {
        revision: contentPackage.revision,
        workspaceId: contentPackage.workspaceId,
      },
      candidate: {
        assetRefs: [],
        candidateId: version.id,
        factClaims: [],
        intendedUse,
        visibleText: contentPackageVersionVisibleText(version),
        workspaceId: contentPackage.workspaceId,
      },
      identityRefs: [],
      rightsRefs: [],
      sourceRefs: [],
    },
  };
}
