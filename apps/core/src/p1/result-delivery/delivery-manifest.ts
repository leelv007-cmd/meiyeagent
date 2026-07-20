import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * beauty-delivery-manifest/v1 — delivery package contract (D-096 / B3).
 * Records file roles/order/MIME/size/checksum/platform/revision/rights AIGC
 * fact summary/time. MUST NOT include Provider, Credential, or hidden prompt.
 */

export const BEAUTY_DELIVERY_MANIFEST_SCHEMA = 'beauty-delivery-manifest/v1' as const;

export const deliveryManifestFileRoleSchema = z.enum([
  'manifest',
  'caption',
  'cover',
  'image',
  'video',
  'subtitles',
  'checklist',
  'rights_evidence',
]);

export const deliveryManifestPlatformSchema = z.enum([
  'xiaohongshu',
  'douyin',
  'video_account',
]);

export const deliveryManifestKindSchema = z.enum(['image_text', 'video']);

export const deliveryManifestFileEntrySchema = z
  .object({
    mimeType: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    path: z.string().trim().min(1),
    role: deliveryManifestFileRoleSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const deliveryManifestRightsSummarySchema = z
  .object({
    aigcLabelEnabled: z.boolean(),
    factSummary: z.string().trim().min(1).optional(),
    state: z.string().trim().min(1),
    watermarkEnabled: z.boolean(),
  })
  .strict();

/** Forbidden keys that must never appear anywhere in a delivery manifest. */
export const DELIVERY_MANIFEST_FORBIDDEN_KEYS = [
  'provider',
  'Provider',
  'credential',
  'Credential',
  'credentials',
  'hiddenPrompt',
  'hidden_prompt',
  'prompt',
  'apiKey',
  'api_key',
  'secret',
  'deployment',
  'Deployment',
  'fallback',
] as const;

export const beautyDeliveryManifestV1Schema = z
  .object({
    contentPackageRevision: z.number().int().nonnegative(),
    generatedAt: z.iso.datetime(),
    kind: deliveryManifestKindSchema,
    packageId: z.string().trim().min(1),
    platform: deliveryManifestPlatformSchema,
    rightsSummary: deliveryManifestRightsSummarySchema,
    schema: z.literal(BEAUTY_DELIVERY_MANIFEST_SCHEMA),
    files: z.array(deliveryManifestFileEntrySchema).min(1),
    variantVersionId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const orders = manifest.files.map((file) => file.order);
    const sorted = [...orders].sort((a, b) => a - b);
    if (orders.some((order, index) => order !== sorted[index])) {
      context.addIssue({
        code: 'custom',
        message: 'Manifest files must be listed in non-decreasing order.',
        path: ['files'],
      });
    }
    const paths = new Set<string>();
    for (const [index, file] of manifest.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate file path ${file.path}.`,
          path: ['files', index, 'path'],
        });
      }
      paths.add(file.path);
    }
  });

export type DeliveryManifestFileRole = z.infer<
  typeof deliveryManifestFileRoleSchema
>;
export type DeliveryManifestFileEntry = z.infer<
  typeof deliveryManifestFileEntrySchema
>;
export type BeautyDeliveryManifestV1 = z.infer<
  typeof beautyDeliveryManifestV1Schema
>;
export type DeliveryManifestRightsSummary = z.infer<
  typeof deliveryManifestRightsSummarySchema
>;

export type DeliveryManifestBuildFile = {
  bytes: Uint8Array;
  mimeType: string;
  path: string;
  role: DeliveryManifestFileRole;
};

export type BuildBeautyDeliveryManifestInput = {
  contentPackageRevision: number;
  files: readonly DeliveryManifestBuildFile[];
  generatedAt: string;
  kind: BeautyDeliveryManifestV1['kind'];
  packageId: string;
  platform: BeautyDeliveryManifestV1['platform'];
  rightsSummary: DeliveryManifestRightsSummary;
  variantVersionId: string;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fileEntryFromBytes(
  file: DeliveryManifestBuildFile,
  order: number,
): DeliveryManifestFileEntry {
  return {
    mimeType: file.mimeType,
    order,
    path: file.path,
    role: file.role,
    sha256: sha256Hex(file.bytes),
    sizeBytes: file.bytes.byteLength,
  };
}

/**
 * Build a beauty-delivery-manifest/v1 document. File order is the caller order
 * (order field assigned sequentially from 0).
 */
export function buildBeautyDeliveryManifest(
  input: BuildBeautyDeliveryManifestInput,
): BeautyDeliveryManifestV1 {
  const files = input.files.map((file, index) =>
    fileEntryFromBytes(file, index),
  );
  return beautyDeliveryManifestV1Schema.parse({
    contentPackageRevision: input.contentPackageRevision,
    files,
    generatedAt: input.generatedAt,
    kind: input.kind,
    packageId: input.packageId,
    platform: input.platform,
    rightsSummary: input.rightsSummary,
    schema: BEAUTY_DELIVERY_MANIFEST_SCHEMA,
    variantVersionId: input.variantVersionId,
  });
}

export type ManifestValidationResult =
  | { ok: true; manifest: BeautyDeliveryManifestV1 }
  | { ok: false; issues: string[] };

function collectForbiddenKeys(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectForbiddenKeys(item, `${path}[${index}]`, issues);
    }
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (
      (DELIVERY_MANIFEST_FORBIDDEN_KEYS as readonly string[]).includes(key)
    ) {
      issues.push(`Forbidden key ${childPath}`);
    }
    collectForbiddenKeys(child, childPath, issues);
  }
}

/**
 * Validate an unknown payload as beauty-delivery-manifest/v1 and reject
 * forbidden secret/provider fields even if they would otherwise pass zod.
 */
export function validateBeautyDeliveryManifest(
  value: unknown,
): ManifestValidationResult {
  const forbidden: string[] = [];
  collectForbiddenKeys(value, '', forbidden);
  if (forbidden.length > 0) {
    return { ok: false, issues: forbidden };
  }
  const parsed = beautyDeliveryManifestV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, manifest: parsed.data };
}

/** Deterministic JSON serialization for archive embedding. */
export function serializeBeautyDeliveryManifest(
  manifest: BeautyDeliveryManifestV1,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
