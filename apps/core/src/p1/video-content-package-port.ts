import type { VideoExecutionContract } from './model-supply/index.js';

export interface VideoContentPackageConfirmation {
  approvalReceiptId?: string;
  actorId: string;
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  catalogModelId: string;
  dataClass: string[];
  executionContract?: VideoExecutionContract;
  referenceAssetIds: string[];
  shots: Array<{ id: string; prompt: string }>;
  storyboardRevision: string;
  storyboardVersion: number;
  workflowId: string;
  workspaceId: string;
  workId?: string;
}

export type VideoContentPackageOutcome =
  | {
      actorId: string;
      status: 'awaiting_quality_review';
      workflowId: string;
      workspaceId: string;
    }
  | {
      actorId: string;
      status: 'cancelled';
      workflowId: string;
      workspaceId: string;
    }
  | {
      actorId: string;
      failureCode: string;
      status: 'failed';
      workflowId: string;
      workspaceId: string;
    };

export interface VideoContentPackagePort {
  confirm(input: VideoContentPackageConfirmation): Promise<void>;
  reconcile(input: VideoContentPackageOutcome): Promise<void>;
}
