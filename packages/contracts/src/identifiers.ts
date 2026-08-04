import { z } from 'zod';

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

// Use this named fallback when one field carries multiple legacy identifier
// families and branding would require non-mechanical caller changes.
export const identifierSchema = nonEmptyTrimmedStringSchema;

export const approvalReceiptIdSchema =
  identifierSchema.brand<'ApprovalReceiptId'>();
export const assetIntakeBatchIdSchema = identifierSchema;
export const marketingIdentityIdSchema = identifierSchema;

export type ApprovalReceiptId = z.infer<typeof approvalReceiptIdSchema>;
export type AssetIntakeBatchId = z.infer<typeof assetIntakeBatchIdSchema>;
export type MarketingIdentityId = z.infer<typeof marketingIdentityIdSchema>;
