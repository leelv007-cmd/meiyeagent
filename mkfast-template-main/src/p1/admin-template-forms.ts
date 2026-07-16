import { z } from 'zod';

import {
  p1_admin_template_validation_document,
  p1_admin_template_validation_document_json,
  p1_admin_template_validation_family,
  p1_admin_template_validation_name,
  p1_admin_template_validation_rollout,
  p1_admin_template_validation_tags,
  p1_admin_template_validation_template,
  p1_admin_template_validation_version,
} from '@/locale/paraglide/messages';
import {
  parseCanvasDocument,
  parseRolloutPercent,
} from '@/p1/admin-view-model';

function acceptsCanvasDocument(value: string) {
  try {
    parseCanvasDocument(value);
    return true;
  } catch {
    return false;
  }
}

function acceptsRolloutPercent(value: string) {
  try {
    parseRolloutPercent(value);
    return true;
  } catch {
    return false;
  }
}

const templateId = z
  .string()
  .trim()
  .min(1, p1_admin_template_validation_template());
const versionId = z
  .string()
  .trim()
  .min(1, p1_admin_template_validation_version());

export const createAdminTemplateSchema = z.object({
  family: z
    .string()
    .trim()
    .min(1, p1_admin_template_validation_family())
    .max(128),
  name: z.string().trim().min(1, p1_admin_template_validation_name()).max(256),
  tags: z.string().max(1_024, p1_admin_template_validation_tags()),
});

export const adminTemplateVersionFormSchema = z.object({
  document: z
    .string()
    .trim()
    .min(1, p1_admin_template_validation_document())
    .refine(
      acceptsCanvasDocument,
      p1_admin_template_validation_document_json()
    ),
  rollout: z
    .string()
    .trim()
    .refine(acceptsRolloutPercent, p1_admin_template_validation_rollout()),
  templateId,
  versionId: z.string().trim().max(256),
});

export const adminTemplateVersionTargetSchema = z.object({
  templateId,
  versionId,
});

export const adminTemplateRetireSchema = z.object({ templateId });

export type CreateAdminTemplateInput = z.infer<
  typeof createAdminTemplateSchema
>;
export type AdminTemplateVersionFormInput = z.infer<
  typeof adminTemplateVersionFormSchema
>;

export function adminTemplateDocument(value: string) {
  return parseCanvasDocument(
    adminTemplateVersionFormSchema.shape.document.parse(value)
  );
}

export function adminTemplateRollout(value: string) {
  return parseRolloutPercent(
    adminTemplateVersionFormSchema.shape.rollout.parse(value)
  );
}

export function adminTemplateTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
