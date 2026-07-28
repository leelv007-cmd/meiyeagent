/**
 * W12② — the browser side of the identity draft assistant.
 *
 * A reference image takes the same road every other merchant upload takes:
 * `uploadWorkspaceIntakeAsset` → `parse_single_asset`, target
 * `brand_reference`. Core hands back a draft whose `brand_reference.summary`
 * field is what it actually read. The browser sends only the exact draft id
 * and revision to the assistant; Core resolves the text again from its own
 * parse store.
 */

import {
  marketingIdentityDraftResultSchema,
  type AssetDraftView,
  type MarketingIdentityDraftRequest,
  type MarketingIdentityDraftResult,
} from '@meiye/contracts';

import { commandP1 } from '@/p1/client';
import { uploadWorkspaceIntakeAsset } from '@/p1/workspace-asset-upload';

const REFERENCE_SUMMARY_KEY = 'brand_reference.summary';

export class MarketingIdentityReferenceReadError extends Error {
  constructor(readonly stage: 'upload' | 'parse' | 'empty') {
    super(`Marketing identity reference failed during ${stage}.`);
    this.name = 'MarketingIdentityReferenceReadError';
  }
}

/** Read a reference image through the existing parse chain. */
export async function readMarketingIdentityReference(input: {
  file: File;
  workspaceId: string;
}): Promise<{ draftId: string; revision: number }> {
  let upload: Awaited<ReturnType<typeof uploadWorkspaceIntakeAsset>>;
  try {
    upload = await uploadWorkspaceIntakeAsset({
      file: input.file,
      workspaceId: input.workspaceId,
    });
  } catch {
    throw new MarketingIdentityReferenceReadError('upload');
  }
  const taskId = `identity-reference-task:${crypto.randomUUID()}`;
  let result: AssetDraftView | { draft: AssetDraftView };
  try {
    result = await commandP1<AssetDraftView | { draft: AssetDraftView }>(
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
            sourceUrl: upload.sourceUrl,
            target: 'brand_reference',
          },
        },
      },
      taskId
    );
  } catch {
    throw new MarketingIdentityReferenceReadError('parse');
  }
  const draft = 'draft' in result ? result.draft : result;
  const summary = draft.fields.find(
    (field) => field.key === REFERENCE_SUMMARY_KEY
  );
  if (typeof summary?.value !== 'string' || !summary.value.trim()) {
    throw new MarketingIdentityReferenceReadError('empty');
  }
  return { draftId: draft.draftId, revision: draft.revision };
}

export async function draftMarketingIdentity(
  request: MarketingIdentityDraftRequest
): Promise<MarketingIdentityDraftResult> {
  const result = await commandP1<unknown>(
    'marketing-identity',
    { action: 'draft_marketing_identity', payload: request },
    `identity-draft:${crypto.randomUUID()}`
  );
  return marketingIdentityDraftResultSchema.parse(result);
}
