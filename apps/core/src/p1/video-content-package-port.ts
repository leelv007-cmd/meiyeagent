export interface VideoContentPackageConfirmation {
  actorId: string;
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  catalogModelId: string;
  dataClass: string[];
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
      clipAssetIds: string[];
      composedAsset: {
        contentType: 'video/mp4';
        id: string;
        objectKey: string;
        sha256: string;
      };
      shots: Array<{ id: string; prompt: string }>;
      status: 'completed';
      storyboardRevision: string;
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
