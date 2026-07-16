import { z } from 'zod';
import {
  AIGC_VISIBLE_LABEL,
  productAssetMediaTypes,
  type ProductCommand,
} from './product.js';

const id = z.string().min(1);
const platform = z.enum(['xiaohongshu', 'douyin']);
const jobStatus = z.enum([
  'queued',
  'running',
  'needs_action',
  'completed',
  'cancelled',
  'failed',
]);

const storeSchema = z.object({
  name: id,
  city: id,
  district: id,
  address: id,
  booking: id,
  brandVoice: id,
  prohibitions: z.array(id),
  accounts: z.array(
    z.object({
      platform,
      nickname: id,
      homepageUrl: z.url().optional(),
      verificationStatus: z
        .enum(['unverified', 'verified', 'restricted'])
        .optional(),
      notes: z.string().optional(),
    })
  ),
  projects: z.array(
    z.object({
      id,
      name: id,
      price: z.number().nonnegative(),
      durationMinutes: z.number().int().positive(),
      confirmed: z.boolean(),
    })
  ),
  regulated: z.boolean(),
});

const qualificationSchema = z.object({
  admitted: z.boolean(),
  institutionLicense: z.string().optional(),
  treatmentScope: z.string().optional(),
  platformCertification: z.string().optional(),
  advertisingCertificate: z.string().optional(),
  validUntil: z.string().optional(),
  intakeAt: z.string().optional(),
});

const renderEvidenceSchema = z.object({
  sourceAssetId: id,
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  fileSizeBytes: z.number().int().positive(),
  provider: id,
  model: id,
  durationSeconds: z.number().positive(),
  aspectRatio: z.literal('9:16'),
  visibleLabel: z.literal(AIGC_VISIBLE_LABEL).optional(),
  implicitMetadata: z.object({
    contentType: z.literal('ai_generated'),
    serviceProvider: id,
    serviceCode: id,
    contentId: id,
  }).optional(),
  compliancePassed: z.boolean().optional(),
  providerCostCents: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  usableQuality: z.object({
    usable: z.boolean(),
    reason: id,
    aestheticScore: z.number().min(0).max(100).optional(),
    imageQualityScore: z.number().min(0).max(100).optional(),
    assessmentMethod: id.optional(),
  }),
  firstFrameManifest: z.record(z.string(), z.unknown()),
  clipManifest: z.array(z.record(z.string(), z.unknown())),
  composeManifest: z.record(z.string(), z.unknown()),
});

export const productCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hide_example'), hidden: z.boolean() }),
  z.object({
    type: z.literal('save_store_draft'),
    sourceText: id,
    extracted: z.object({
      name: id.optional(),
      projectName: id.optional(),
      projectPrice: z.number().nonnegative().optional(),
    }),
  }),
  z.object({ type: z.literal('confirm_store'), store: storeSchema }),
  z.object({
    type: z.literal('confirm_qualification'),
    qualification: qualificationSchema,
  }),
  z.object({
    type: z.literal('add_asset'),
    asset: z.object({
      id,
      objectKey: id,
      mediaType: z.enum(productAssetMediaTypes),
      sourceType: z.enum(['real', 'ai_generated']),
      category: z
        .enum(['store', 'before_after', 'customer_case', 'price_list', 'other'])
        .optional(),
      tags: z.array(id),
      rightsOwner: id,
      rightsEvidence: z.string().min(1).optional(),
      consentScope: z.enum([
        'internal_only',
        'public_marketing',
        'paid_advertising',
      ]),
      containsPerson: z.boolean(),
      containsSensitiveData: z.boolean(),
      minorStatus: z.enum(['none', 'minor']),
    }),
  }),
  z.object({
    type: z.literal('authorize_asset'),
    assetId: id,
    consentScope: z.enum([
      'internal_only',
      'public_marketing',
      'paid_advertising',
    ]),
    rightsEvidence: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('update_asset_metadata'),
    assetId: id,
    category: z.enum([
      'store',
      'before_after',
      'customer_case',
      'price_list',
      'other',
    ]),
    tags: z.array(id),
    rightsOwner: id,
    containsPerson: z.boolean(),
    containsSensitiveData: z.boolean(),
    minorStatus: z.enum(['none', 'minor']),
  }),
  z.object({ type: z.literal('withdraw_asset'), assetId: id }),
  z.object({ type: z.literal('check_content'), text: id }),
  z.object({
    type: z.literal('generate_copy'),
    brief: z.object({
      assetIds: z.array(id).min(1),
      conversionGoal: id,
      hook: id,
      platform,
      projectId: id,
      scenario: id,
      tone: id,
      requestedSelection: z
        .discriminatedUnion('mode', [
          z.object({ mode: z.literal('auto') }),
          z.object({
            mode: z.literal('fixed'),
            catalogModelId: id,
          }),
        ])
        .optional(),
    }),
  }),
  z.object({ type: z.literal('select_content'), contentId: id }),
  z.object({
    type: z.literal('create_douyin_variant'),
    contentId: id,
    durationSeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  }),
  z.object({
    type: z.literal('quick_edit'),
    contentId: id,
    instruction: z.enum([
      'conversational',
      'professional',
      'weaker_advertising',
      'local_positioning',
    ]),
  }),
  z.object({ type: z.literal('undo_edit'), contentId: id, platform }),
  z.object({ type: z.literal('revert_to_ai'), contentId: id, platform }),
  z.object({ type: z.literal('create_weekly_set'), contentId: id }),
  z.object({ type: z.literal('remix_content'), contentId: id }),
  z.object({ type: z.literal('abandon_content'), contentId: id }),
  z.object({ type: z.literal('create_storyboard'), contentId: id }),
  z.object({
    type: z.literal('replace_storyboard_shot'),
    storyboardId: id,
    shotId: id,
    visualDirection: id,
  }),
  z.object({ type: z.literal('confirm_storyboard'), storyboardId: id }),
  z.object({ type: z.literal('start_video'), storyboardId: id }),
  z.object({
    type: z.literal('claim_video'),
    jobId: id,
    workerId: id,
    leaseSeconds: z.number().int().min(5).max(300),
  }),
  z.object({
    type: z.literal('heartbeat_video'),
    jobId: id,
    workerId: id,
    leaseSeconds: z.number().int().min(5).max(300),
  }),
  z.object({
    type: z.literal('transition_video'),
    jobId: id,
    workerId: id,
    nextStatus: jobStatus,
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('resume_video'), jobId: id, constraint: id }),
  z.object({
    type: z.literal('record_video_render'),
    jobId: id,
    workerId: id,
    evidence: renderEvidenceSchema,
  }),
  z.object({
    type: z.literal('complete_video'),
    jobId: id,
    renderEvidenceId: id,
    storage: z.object({
      objectKey: id,
      storageEtag: id,
      fileSha256: z.string().regex(/^[a-f0-9]{64}$/i),
      fileSizeBytes: z.number().int().positive(),
      contentType: z.literal('video/mp4'),
      storageVerifiedAt: z.iso.datetime(),
    }),
  }),
  z.object({ type: z.literal('cancel_video'), jobId: id }),
  z.object({ type: z.literal('retry_video'), jobId: id }),
  z.object({
    type: z.literal('display_preflight'),
    contentId: id,
    trigger: z.enum(['adopt', 'handoff', 'publish']),
  }),
  z.object({ type: z.literal('confirm_responsibility'), contentId: id }),
  z.object({
    type: z.literal('create_handoff'),
    contentId: id,
    artifactId: id.optional(),
    platform,
  }),
  z.object({
    type: z.literal('record_handoff_export'),
    packageId: id,
    event: z.enum(['opened', 'downloaded', 'shared', 'copied']),
  }),
  z.object({
    type: z.literal('report_handoff_result'),
    packageId: id,
    outcome: z.enum(['published', 'not_published', 'failed']),
    note: z.string().trim().max(500).optional(),
    platformUrl: z.url().optional(),
  }),
  z.object({
    type: z.literal('mark_published'),
    packageId: id,
    platformUrl: z.url().optional(),
  }),
  z.object({
    type: z.literal('create_lead'),
    contentId: id,
    lead: z.object({
      source: z.enum([
        'direct_message',
        'comment',
        'wechat',
        'booking',
        'coupon',
        'redemption',
        'visit',
      ]),
      projectId: id,
      amountCents: z.number().int().nonnegative().optional(),
      note: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('update_lead'),
    leadId: id,
    status: z.enum([
      'new',
      'contacted',
      'booked',
      'redeemed',
      'lost',
      'invalid',
    ]),
  }),
  z.object({
    type: z.literal('record_insight'),
    contentId: id.optional(),
    kind: id,
    note: id,
  }),
  z.object({
    type: z.literal('apply_plan'),
    plan: z.enum(['starter', 'growth', 'pro']),
    eventId: id,
    effectiveAt: z.iso.datetime(),
  }),
]) satisfies z.ZodType<ProductCommand>;
