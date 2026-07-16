import {
  video_workflow_aida_action_direction,
  video_workflow_aida_action_label,
  video_workflow_aida_attention_direction,
  video_workflow_aida_attention_label,
  video_workflow_aida_desire_direction,
  video_workflow_aida_desire_label,
  video_workflow_aida_interest_direction,
  video_workflow_aida_interest_label,
  video_workflow_quality_review_warning,
  video_workflow_quality_score,
  video_workflow_quality_subtitle_warning,
  video_workflow_quality_unavailable,
  video_workflow_shot_prompt,
  video_workflow_status_awaiting_quality_review_description,
  video_workflow_status_awaiting_quality_review_label,
  video_workflow_status_cancel_requested_description,
  video_workflow_status_cancel_requested_label,
  video_workflow_status_cancelled_description,
  video_workflow_status_cancelled_label,
  video_workflow_status_completed_description,
  video_workflow_status_completed_label,
  video_workflow_status_draft_description,
  video_workflow_status_draft_label,
  video_workflow_status_failed_description,
  video_workflow_status_failed_label,
  video_workflow_status_running_description,
  video_workflow_status_running_label,
  video_workflow_step_composition,
  video_workflow_step_confirmation,
  video_workflow_step_generation,
  video_workflow_step_review,
  video_workflow_step_storyboard,
} from '@/locale/paraglide/messages';

export type VideoDataClass = 'contains_face' | 'pii' | 'medical';

export type AidaStage = 'attention' | 'interest' | 'desire' | 'action';

export interface AidaStoryboardShot {
  id: string;
  stage: AidaStage;
  label: string;
  prompt: string;
}

export type VideoWorkflowStatus =
  | 'draft'
  | 'running'
  | 'awaiting_quality_review'
  | 'cancel_requested'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type VideoWorkflowDisplayStatus = VideoWorkflowStatus;

export interface VideoWorkflowAsset {
  contentType: 'image/png' | 'video/mp4';
  /** Missing only from historical lightweight workflow responses. */
  id?: string;
  objectKey: string;
  /** Missing only from historical lightweight workflow responses. */
  sha256?: string;
  technicalValidation?: {
    playable: boolean;
  };
}

export interface VideoWorkflowCandidate {
  asset?: VideoWorkflowAsset;
  index: number;
  quality?: {
    calibration: 'recorded_human_fixture' | 'unscored_requires_human_review';
    publishWarnings: string[];
    score: number;
  };
  selectionReason?: string;
  status: 'generated' | 'completed' | 'unknown' | 'failed';
}

export interface VideoWorkflowShot {
  candidates: VideoWorkflowCandidate[];
  candidatesPerShot: number;
  id: string;
  prompt: string;
  selectedCandidateIndex?: number;
  selectionReason?: string;
}

export interface VideoWorkflow {
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  catalogModelId: string;
  composedAsset?: VideoWorkflowAsset;
  confirmed: boolean;
  derivedFromWorkflowId?: string;
  id: string;
  referenceAssetIds?: string[];
  failureCode?: string;
  revision: number;
  shots: VideoWorkflowShot[];
  status: VideoWorkflowStatus;
  storyboardRevision: string;
  storyboardVersion: number;
  updatedAt: string;
  workId?: string;
}

export interface VideoWorkflowJob {
  error?: string | null;
  id?: string;
  status?: string;
}

export interface VideoWorkflowEnvelope {
  job: VideoWorkflowJob | null;
  workflow: VideoWorkflow;
}

export type VideoWorkflowStepState =
  | 'failed'
  | 'waiting'
  | 'running'
  | 'suspended'
  | 'success';

export interface VideoWorkflowStep {
  id: 'storyboard' | 'confirmation' | 'generation' | 'review' | 'composition';
  label: string;
  state: VideoWorkflowStepState;
}

const AIDA_BLUEPRINT: Array<{
  direction: () => string;
  id: string;
  label: () => string;
  stage: AidaStage;
}> = [
  {
    id: 'aida-attention',
    label: video_workflow_aida_attention_label,
    direction: video_workflow_aida_attention_direction,
    stage: 'attention',
  },
  {
    id: 'aida-interest',
    label: video_workflow_aida_interest_label,
    direction: video_workflow_aida_interest_direction,
    stage: 'interest',
  },
  {
    id: 'aida-desire',
    label: video_workflow_aida_desire_label,
    direction: video_workflow_aida_desire_direction,
    stage: 'desire',
  },
  {
    id: 'aida-action',
    label: video_workflow_aida_action_label,
    direction: video_workflow_aida_action_direction,
    stage: 'action',
  },
];

const STATUS_VIEWS: Record<
  VideoWorkflowDisplayStatus,
  {
    description: () => string;
    label: () => string;
    poll: boolean;
    terminal: boolean;
  }
> = {
  draft: {
    label: video_workflow_status_draft_label,
    description: video_workflow_status_draft_description,
    poll: true,
    terminal: false,
  },
  running: {
    label: video_workflow_status_running_label,
    description: video_workflow_status_running_description,
    poll: true,
    terminal: false,
  },
  awaiting_quality_review: {
    label: video_workflow_status_awaiting_quality_review_label,
    description: video_workflow_status_awaiting_quality_review_description,
    poll: true,
    terminal: false,
  },
  cancel_requested: {
    label: video_workflow_status_cancel_requested_label,
    description: video_workflow_status_cancel_requested_description,
    poll: true,
    terminal: false,
  },
  completed: {
    label: video_workflow_status_completed_label,
    description: video_workflow_status_completed_description,
    poll: false,
    terminal: true,
  },
  cancelled: {
    label: video_workflow_status_cancelled_label,
    description: video_workflow_status_cancelled_description,
    poll: false,
    terminal: true,
  },
  failed: {
    label: video_workflow_status_failed_label,
    description: video_workflow_status_failed_description,
    poll: false,
    terminal: true,
  },
};

export function createAidaStoryboard(intent: string): AidaStoryboardShot[] {
  const normalizedIntent = intent.trim();
  return AIDA_BLUEPRINT.map((item) => ({
    id: item.id,
    stage: item.stage,
    label: item.label(),
    prompt: video_workflow_shot_prompt({
      direction: item.direction(),
      intent: normalizedIntent,
    }),
  }));
}

export function buildVideoWorkflowDraft(input: {
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  catalogModelId: string;
  dataClass: readonly VideoDataClass[];
  derivedFrom?: Pick<VideoWorkflow, 'id' | 'storyboardVersion'>;
  referenceAssetIds?: readonly string[];
  shots: readonly AidaStoryboardShot[];
  workId: string;
}) {
  const shots = input.shots.map((shot) => ({
    id: shot.id,
    prompt: shot.prompt.trim(),
    candidatesPerShot: 1 as const,
  }));
  const storyboardRevision = `storyboard-${stableHash(
    JSON.stringify(shots.map(({ id, prompt }) => ({ id, prompt })))
  )}`;
  const dataClass = [...new Set(input.dataClass)].sort();
  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])].sort();
  const workflowId = `video-workflow-${stableHash(
    JSON.stringify({
      workId: input.workId,
      storyboardRevision,
      catalogModelId: input.catalogModelId,
      dataClass,
      referenceAssetIds,
      aigcLabelEnabled: input.aigcLabelEnabled,
      brandWatermarkText: input.brandWatermarkText,
      derivedFromWorkflowId: input.derivedFrom?.id,
    })
  )}`;
  return {
    action: 'video_workflow_create_draft' as const,
    idempotencyKey: `create:${workflowId}`,
    payload: {
      workId: input.workId,
      workflowId,
      storyboardRevision,
      catalogModelId: input.catalogModelId,
      dataClass,
      referenceAssetIds,
      aigcLabelEnabled: input.aigcLabelEnabled,
      ...(input.brandWatermarkText
        ? { brandWatermarkText: input.brandWatermarkText }
        : {}),
      ...(input.derivedFrom
        ? { derivedFromWorkflowId: input.derivedFrom.id }
        : {}),
      shots,
    },
  };
}

export function videoWorkflowStatusView(status: VideoWorkflowDisplayStatus) {
  const view = STATUS_VIEWS[status];
  return {
    description: view.description(),
    label: view.label(),
    poll: view.poll,
    terminal: view.terminal,
  };
}

export function videoWorkflowEffectiveStatus(envelope: {
  job: Pick<VideoWorkflowJob, 'status'> | null;
  workflow: Pick<VideoWorkflow, 'status'>;
}): VideoWorkflowDisplayStatus {
  return envelope.job?.status === 'failed'
    ? 'failed'
    : envelope.workflow.status;
}

export function videoWorkflowShouldPoll(envelope: {
  job: Pick<VideoWorkflowJob, 'status'> | null;
  workflow: Pick<VideoWorkflow, 'status'>;
}) {
  return videoWorkflowStatusView(videoWorkflowEffectiveStatus(envelope)).poll;
}

export function videoWorkflowSteps(
  workflow: Pick<VideoWorkflow, 'confirmed' | 'shots' | 'status'>,
  jobStatus?: string
): VideoWorkflowStep[] {
  const steps: VideoWorkflowStep[] = [
    {
      id: 'storyboard',
      label: video_workflow_step_storyboard(),
      state: 'waiting',
    },
    {
      id: 'confirmation',
      label: video_workflow_step_confirmation(),
      state: 'waiting',
    },
    {
      id: 'generation',
      label: video_workflow_step_generation(),
      state: 'waiting',
    },
    {
      id: 'review',
      label: video_workflow_step_review(),
      state: 'waiting',
    },
    {
      id: 'composition',
      label: video_workflow_step_composition(),
      state: 'waiting',
    },
  ];
  if (jobStatus === 'failed') {
    return steps.map((step) => ({ ...step, state: 'failed' }));
  }
  steps[0]!.state = 'success';

  if (workflow.status === 'completed') {
    return steps.map((step) => ({ ...step, state: 'success' }));
  }
  if (workflow.status === 'draft' || !workflow.confirmed) {
    steps[1]!.state = 'running';
    return steps;
  }

  steps[1]!.state = 'success';
  if (workflow.status === 'awaiting_quality_review') {
    steps[2]!.state = 'success';
    steps[3]!.state = 'suspended';
    return steps;
  }

  const readyForComposition =
    workflow.shots.length > 0 &&
    workflow.shots.every((shot) => shot.selectedCandidateIndex !== undefined);
  if (readyForComposition) {
    steps[2]!.state = 'success';
    steps[3]!.state = 'success';
    steps[4]!.state =
      workflow.status === 'cancel_requested' ? 'suspended' : 'running';
    return steps;
  }
  steps[2]!.state =
    workflow.status === 'cancel_requested' || workflow.status === 'cancelled'
      ? 'suspended'
      : 'running';
  return steps;
}

export function buildVideoWorkflowMutation(
  kind: 'confirm' | 'cancel',
  workflowId: string
): {
  action: 'video_workflow_confirm' | 'video_workflow_cancel';
  idempotencyKey: string;
  payload: { workflowId: string };
};
export function buildVideoWorkflowMutation(
  kind: 'select',
  workflowId: string,
  selection: { candidateIndex: number; shotId: string }
): {
  action: 'video_workflow_select_candidate';
  idempotencyKey: string;
  payload: {
    candidateIndex: number;
    shotId: string;
    workflowId: string;
  };
};
export function buildVideoWorkflowMutation(
  kind: 'confirm' | 'cancel' | 'select',
  workflowId: string,
  selection?: { candidateIndex: number; shotId: string }
) {
  if (kind === 'select') {
    if (!selection) throw new Error('Candidate selection is required.');
    return {
      action: 'video_workflow_select_candidate' as const,
      idempotencyKey: `select:${workflowId}:${selection.shotId}:${selection.candidateIndex}`,
      payload: { workflowId, ...selection },
    };
  }
  return {
    action:
      kind === 'confirm'
        ? ('video_workflow_confirm' as const)
        : ('video_workflow_cancel' as const),
    idempotencyKey: `${kind}:${workflowId}`,
    payload: { workflowId },
  };
}

export function videoWorkflowReviewShots(
  workflow: Pick<VideoWorkflow, 'shots' | 'status'>
) {
  if (workflow.status !== 'awaiting_quality_review') return [];
  return workflow.shots.filter(
    (shot) =>
      shot.selectedCandidateIndex === undefined &&
      shot.candidates.some(
        (candidate) =>
          candidate.status === 'completed' &&
          candidate.asset?.contentType === 'video/mp4'
      )
  );
}

export function videoAssetUrl(objectKey: string) {
  return `/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`;
}

export function videoCandidateQualityText(candidate: VideoWorkflowCandidate) {
  const score = candidate.quality?.score;
  const scoreText = Number.isFinite(score)
    ? video_workflow_quality_score({ score: score!.toFixed(2) })
    : video_workflow_quality_unavailable();
  const warnings = candidate.quality?.publishWarnings ?? [];
  const warningText = warnings.includes(
    'review_subtitle_safe_area_before_publish'
  )
    ? video_workflow_quality_subtitle_warning()
    : warnings.length > 0
      ? video_workflow_quality_review_warning()
      : '';
  return `${scoreText}${warningText}`;
}

function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
