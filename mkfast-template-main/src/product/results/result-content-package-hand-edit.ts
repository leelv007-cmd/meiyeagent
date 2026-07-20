/**
 * Result Center deterministic hand-edit write seam.
 *
 * Compiles directly to the existing Operations ContentPackage OCC command.
 * The returned package is the canonical server response; this module owns no
 * Result revision, cache, or parallel history.
 */

import { operationsCommand } from '@/p1/client';
import type { ContentPackage, ContentPackageVersion } from '@meiye/contracts';

type EditableContentPackageFields = Pick<
  ContentPackageVersion,
  'body' | 'conversionHook' | 'orderedAssetIds' | 'title' | 'topics'
>;

export type ResultContentPackageHandEditInput = {
  contentPackage: ResultContentPackageHandEditResult;
  changes: Partial<EditableContentPackageFields>;
  idempotencyKey: string;
};

export type ResultContentPackageHandEditResult = Pick<
  ContentPackage,
  'currentVersionId' | 'id' | 'revision' | 'versions'
>;

export type ResultContentPackageHandEditCommand = {
  action: 'edit_content_package_version';
  idempotencyKey: string;
  payload: {
    baseVersionId: string;
    changes: EditableContentPackageFields;
    expectedRevision: number;
    packageId: string;
  };
};

export type ResultContentPackageHandEditSubmit = (
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) => Promise<ResultContentPackageHandEditResult>;

function currentVersion(
  contentPackage: ResultContentPackageHandEditInput['contentPackage']
): ContentPackageVersion {
  const version = contentPackage.versions.find(
    (candidate) => candidate.id === contentPackage.currentVersionId
  );
  if (!version) {
    throw new Error('The current ContentPackage version was not found.');
  }
  return version;
}

/** Build the single canonical OCC write. */
export function buildResultContentPackageHandEditCommand(
  input: ResultContentPackageHandEditInput
): ResultContentPackageHandEditCommand {
  const version = currentVersion(input.contentPackage);
  const changes = input.changes;

  return {
    action: 'edit_content_package_version',
    idempotencyKey: input.idempotencyKey,
    payload: {
      baseVersionId: version.id,
      changes: {
        body: changes.body !== undefined ? changes.body : version.body,
        conversionHook:
          changes.conversionHook !== undefined
            ? changes.conversionHook
            : (version.conversionHook ?? ''),
        orderedAssetIds:
          changes.orderedAssetIds !== undefined
            ? [...changes.orderedAssetIds]
            : [...version.orderedAssetIds],
        title: changes.title !== undefined ? changes.title : version.title,
        topics:
          changes.topics !== undefined
            ? [...changes.topics]
            : [...version.topics],
      },
      expectedRevision: input.contentPackage.revision,
      packageId: input.contentPackage.id,
    },
  };
}

/** Execute once through Operations; OCC conflicts deliberately propagate. */
export async function executeResultContentPackageHandEdit(
  input: ResultContentPackageHandEditInput,
  submit: ResultContentPackageHandEditSubmit = (action, payload, key) =>
    operationsCommand<ContentPackage>(action, payload, key)
): Promise<ResultContentPackageHandEditResult> {
  const command = buildResultContentPackageHandEditCommand(input);
  return submit(command.action, command.payload, command.idempotencyKey);
}
