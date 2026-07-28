/**
 * W12② — the browser side of the identity draft assistant.
 *
 * A reference file takes the same road every other merchant upload takes:
 * `uploadWorkspaceIntakeAsset` → `parse_single_asset`, target
 * `brand_reference`. Core hands back a draft whose `brand_reference.summary`
 * field is what it actually read, and only that text travels on to the
 * assistant — there is no second upload channel and no file ever reaches the
 * model command.
 */

import {
  marketingIdentitySuggestionSchema,
  type AssetDraftView,
  type MarketingIdentityDraftRequest,
  type MarketingIdentitySuggestion,
} from '@meiye/contracts';

import { commandP1 } from '@/p1/client';
import { uploadWorkspaceIntakeAsset } from '@/p1/workspace-asset-upload';

const REFERENCE_SUMMARY_KEY = 'brand_reference.summary';

/** Read a reference file through the existing parse chain. */
export async function readMarketingIdentityReference(input: {
  file: File;
  workspaceId: string;
}): Promise<string> {
  const upload = await uploadWorkspaceIntakeAsset({
    file: input.file,
    workspaceId: input.workspaceId,
  });
  const taskId = `identity-reference-task:${crypto.randomUUID()}`;
  const result = await commandP1<AssetDraftView | { draft: AssetDraftView }>(
    'asset-memory',
    {
      action: 'parse_single_asset',
      payload: {
        taskId,
        source: {
          assetId: `identity-reference:${upload.sha256.slice(0, 24)}`,
          contentType: upload.contentType,
          inputKind: 'document_image',
          objectKey: upload.objectKey,
          // The merchant is describing their own brand material; the rights
          // prompt is non-blocking in the parse contract, so an unanswered one
          // travels as `unconfirmed` rather than stopping the draft.
          rightsStatus: 'unconfirmed',
          sha256: upload.sha256,
          sizeBytes: upload.sizeBytes,
          sourceUrl: null,
          target: 'brand_reference',
        },
      },
    },
    taskId
  );
  const draft = 'draft' in result ? result.draft : result;
  const summary = draft.fields.find(
    (field) => field.key === REFERENCE_SUMMARY_KEY
  );
  return typeof summary?.value === 'string' ? summary.value.trim() : '';
}

export async function draftMarketingIdentity(
  request: MarketingIdentityDraftRequest
): Promise<MarketingIdentitySuggestion> {
  const suggestion = await commandP1<unknown>(
    'marketing-identity',
    { action: 'draft_marketing_identity', payload: request },
    `identity-draft:${crypto.randomUUID()}`
  );
  return marketingIdentitySuggestionSchema.parse(suggestion);
}
