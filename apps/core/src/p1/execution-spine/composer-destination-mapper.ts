import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import type {
  ModelSupplyPromptAuditPort,
  ModelSupplyPromptBinding,
  StructuredObjectExecutor,
} from '../model-supply/index.js';
import {
  assertModelSupplyPromptBinding,
  promptFallbackAuditId,
} from '../model-supply/route-contracts.js';

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
  .strict();

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
    idempotencyKey?: string;
    workspaceId?: string;
  }): Promise<ComposerDestinationMapping>;
}

export class StructuredComposerDestinationMapper
  implements ComposerDestinationMappingPort
{
  constructor(
    private readonly executor: StructuredObjectExecutor,
    private readonly prompt?: {
      resolve(): Promise<ModelSupplyPromptBinding>;
    },
    private readonly promptAudits?: ModelSupplyPromptAuditPort,
  ) {}

  async map(input: {
    abortSignal?: AbortSignal;
    destination: string;
    idempotencyKey?: string;
    workspaceId?: string;
  }): Promise<ComposerDestinationMapping> {
    const destination = input.destination.trim();
    if (!destination) return DEFAULT_CLARIFICATION;
    const prompt = await this.prompt?.resolve();
    if (prompt) {
      assertModelSupplyPromptBinding(
        prompt,
        'harness/destination-mapping',
      );
    }
    if (prompt?.isFallback && this.promptAudits) {
      if (!input.workspaceId || !input.idempotencyKey) {
        throw new Error(
          'Destination prompt fallback audit requires workspace and idempotency context.',
        );
      }
      const promptLineage = promptReference(prompt);
      await this.promptAudits.appendPromptAudit({
        workspaceId: input.workspaceId,
        id: promptFallbackAuditId({
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
          promptKey: 'destinationMapping',
          prompt: promptLineage,
        }),
        workflowId: input.idempotencyKey,
        stage: 'prompt_resolution',
        eventType: 'langfuse_prompt_fallback',
        payload: {
          promptKey: 'destinationMapping',
          prompt: promptLineage,
          operation: 'destination.map',
        },
      });
    }
    const instructions =
      prompt?.content ??
      [
        'Map one merchant answer about where content will be used and how it will be delivered.',
        'Return mapped only when both fields are unambiguous; otherwise return one focused clarification question with safe options.',
        'Allowed contentPackagePlatform values: xiaohongshu, douyin, video_account, wechat_moments, offline_material, generic.',
        'Allowed distributionTarget values: export, manual_copy, assisted_handoff.',
        'Every platform delivery is completed by the merchant or an assistant; never select an automatic platform delivery target.',
        'Do not infer a platform from unrelated merchant facts.',
      ].join(' ');

    try {
      const result = await this.executor.generate({
        abortSignal: input.abortSignal,
        instructions,
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

function promptReference(prompt: ModelSupplyPromptBinding) {
  return {
    name: prompt.name,
    version: prompt.version,
    contentHash: prompt.contentHash,
    label: prompt.label,
    source: prompt.source,
    isFallback: prompt.isFallback,
    ...(prompt.fallbackReason
      ? { fallbackReason: prompt.fallbackReason }
      : {}),
  };
}
