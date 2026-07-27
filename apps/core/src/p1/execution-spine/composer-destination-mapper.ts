import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import type { StructuredObjectExecutor } from '../model-supply/index.js';

const destinationOptionSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const mappedDestinationSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    status: z.literal('mapped'),
  })
  .strict()
  .superRefine((result, context) => {
    if (!result.distributionTarget.startsWith('publish:')) return;
    const publishedPlatform = result.distributionTarget.slice('publish:'.length);
    if (publishedPlatform !== result.contentPackagePlatform) {
      context.addIssue({
        code: 'custom',
        message:
          'A publish target must match its content package variant platform.',
        path: ['distributionTarget'],
      });
    }
  });

const clarificationSchema = z
  .object({
    options: z.array(destinationOptionSchema).max(6),
    question: z.string().trim().min(1).max(200),
    status: z.literal('needs_clarification'),
  })
  .strict();

export const composerDestinationMappingSchema = z.discriminatedUnion('status', [
  mappedDestinationSchema,
  clarificationSchema,
]);

export const composerDestinationMappingRequestSchema = z
  .object({
    destination: z.string().max(1_000),
  })
  .strict();

export type ComposerDestinationMapping = z.infer<
  typeof composerDestinationMappingSchema
>;

const DEFAULT_CLARIFICATION: ComposerDestinationMapping = {
  options: [
    {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      label: '小红书，生成后手动复制',
    },
    {
      contentPackagePlatform: 'douyin',
      distributionTarget: 'manual_copy',
      label: '抖音，生成后手动复制',
    },
    {
      contentPackagePlatform: 'video_account',
      distributionTarget: 'manual_copy',
      label: '视频号，生成后手动复制',
    },
    {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'manual_copy',
      label: '朋友圈，生成后手动复制',
    },
    {
      contentPackagePlatform: 'offline_material',
      distributionTarget: 'export',
      label: '线下物料，导出文件',
    },
  ],
  question: '这份内容准备发到哪里，以及生成后希望怎么交付？',
  status: 'needs_clarification',
};

export interface ComposerDestinationMappingPort {
  map(input: {
    abortSignal?: AbortSignal;
    destination: string;
  }): Promise<ComposerDestinationMapping>;
}

export class StructuredComposerDestinationMapper
  implements ComposerDestinationMappingPort
{
  constructor(private readonly executor: StructuredObjectExecutor) {}

  async map(input: {
    abortSignal?: AbortSignal;
    destination: string;
  }): Promise<ComposerDestinationMapping> {
    const destination = input.destination.trim();
    if (!destination) return DEFAULT_CLARIFICATION;

    try {
      const result = await this.executor.generate({
        abortSignal: input.abortSignal,
        instructions: [
          'Map one merchant answer about where content will be used and how it will be delivered.',
          'Return mapped only when both fields are unambiguous; otherwise return one focused clarification question with safe options.',
          'Allowed contentPackagePlatform values: xiaohongshu, douyin, video_account, wechat_moments, offline_material, generic.',
          'Allowed distributionTarget values: export, manual_copy, assisted_handoff, publish:xiaohongshu, publish:douyin, publish:video_account.',
          'wechat_moments is a delivery destination, not a platform variant, and must never be represented as a publish target.',
          'A publish target must exactly match xiaohongshu, douyin, or video_account.',
          'Do not infer a platform from unrelated merchant facts.',
        ].join(' '),
        prompt: JSON.stringify({ destination }),
        schema: composerDestinationMappingSchema,
        schemaName: 'composer_destination_mapping_v1',
      });
      return composerDestinationMappingSchema.parse(result.output);
    } catch {
      return DEFAULT_CLARIFICATION;
    }
  }
}
