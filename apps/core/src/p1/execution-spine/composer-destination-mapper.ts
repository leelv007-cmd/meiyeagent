import {
  composerDestinationMappingSchema,
  type ComposerDestinationMapping,
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

export const composerDestinationMappingRequestSchema = z
  .object({
    destination: z.string().max(1_000),
  })
  .strict();

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
      /**
       * workspaceId is required: the release pin is workspace-scoped, and a
       * workspace-less resolve silently returns bare production.
       */
      resolve(input: { workspaceId: string }): Promise<ModelSupplyPromptBinding>;
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
    const prompt = this.prompt
      ? await this.prompt.resolve({
          workspaceId: requirePromptWorkspaceId(input.workspaceId),
        })
      : undefined;
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

/**
 * Fail closed rather than resolve a workspace-scoped release pin without a
 * workspace, which would silently fall back to bare production.
 */
function requirePromptWorkspaceId(workspaceId?: string): string {
  const trimmed = workspaceId?.trim();
  if (!trimmed) {
    throw new Error(
      'Destination mapping requires a workspaceId to resolve its release-pinned prompt.',
    );
  }
  return trimmed;
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
