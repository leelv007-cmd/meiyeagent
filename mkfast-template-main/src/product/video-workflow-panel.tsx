import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  common_correlation_id,
  copy_candidate_view_in_content,
  video_workflow_aigc_disabled,
  video_workflow_aigc_enabled,
  video_workflow_cancel_task,
  video_workflow_candidate_legend,
  video_workflow_candidate_select,
  video_workflow_candidate_select_aria,
  video_workflow_candidate_video_aria,
  video_workflow_composer_description,
  video_workflow_confirm_and_generate,
  video_workflow_create_version_from_this,
  video_workflow_edit_on_desktop,
  video_workflow_editor_description,
  video_workflow_editor_title,
  video_workflow_failure_desktop_recovery,
  video_workflow_final_video_aria,
  video_workflow_lock_storyboard,
  video_workflow_locked_model,
  video_workflow_locking,
  video_workflow_mutation_failed,
  video_workflow_panel_aria,
  video_workflow_panel_title,
  video_workflow_progress_description,
  video_workflow_query_failed_description,
  video_workflow_query_failed_title,
  video_workflow_query_retry,
  video_workflow_restoring,
  video_workflow_return_and_create_version,
  video_workflow_review_candidates_pending,
  video_workflow_source_storyboard_version,
  video_workflow_step_state_failed,
  video_workflow_step_state_running,
  video_workflow_step_state_success,
  video_workflow_step_state_suspended,
  video_workflow_step_state_waiting,
  video_workflow_steps_aria,
  video_workflow_storyboard_number,
  video_workflow_storyboard_version,
  video_workflow_submitting,
  video_workflow_submitting_action,
} from '@/locale/paraglide/messages';
import { friendlyProductError } from '@/lib/correlated-api-error';
import { cn } from '@/lib/utils';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

import {
  buildVideoWorkflowDraft,
  buildVideoWorkflowMutation,
  createAidaStoryboard,
  videoAssetUrl,
  videoCandidateQualityText,
  videoWorkflowEffectiveStatus,
  videoWorkflowReviewShots,
  videoWorkflowShouldPoll,
  videoWorkflowSteps,
  videoWorkflowStatusView,
  type AidaStoryboardShot,
  type VideoDataClass,
  type VideoWorkflow,
  type VideoWorkflowCandidate,
  type VideoWorkflowEnvelope,
} from './video-workflow-model';

const POLL_INTERVAL_MS = 5_000;

export function videoWorkflowMutationFailure(error: unknown) {
  return friendlyProductError(error, video_workflow_mutation_failed());
}

type WorkflowAction =
  | { kind: 'cancel' | 'confirm'; workflowId: string }
  | {
      candidateIndex: number;
      kind: 'select';
      shotId: string;
      workflowId: string;
    };

interface VideoWorkflowPanelBaseProps {
  className?: string;
  workId: string;
}

interface VideoWorkflowComposerProps extends VideoWorkflowPanelBaseProps {
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  catalogModelId: string;
  catalogModelNames: Readonly<Record<string, string>>;
  catalogModelName?: string;
  dataClass: readonly VideoDataClass[];
  intent: string;
  mode?: 'composer';
  referenceAssetIds?: readonly string[];
}

interface VideoWorkflowProgressProps extends VideoWorkflowPanelBaseProps {
  mode: 'progress';
  recoveryHref?: string;
  workflowId?: string;
}

export type VideoWorkflowPanelProps =
  | VideoWorkflowComposerProps
  | VideoWorkflowProgressProps;

export function VideoWorkflowPanel(props: VideoWorkflowPanelProps) {
  const { className, workId } = props;
  const composer = props.mode === 'progress' ? undefined : props;
  const requestedWorkflowId =
    props.mode === 'progress' ? props.workflowId : undefined;
  const recoveryHref =
    props.mode === 'progress' ? props.recoveryHref : undefined;
  const queryClient = useQueryClient();
  const [shots, setShots] = useState(() =>
    composer ? createAidaStoryboard(composer.intent) : []
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState('');
  const [editingFromWorkflow, setEditingFromWorkflow] = useState<Pick<
    VideoWorkflow,
    'id' | 'storyboardVersion'
  > | null>(null);
  const latestKey = p1QueryKeys.request(
    'model-supply',
    'video_workflow_latest',
    { workId }
  );
  const latestQuery = useQuery({
    enabled: !requestedWorkflowId,
    queryKey: latestKey,
    queryFn: ({ signal }) =>
      queryP1<VideoWorkflowEnvelope | null>(
        'model-supply',
        { action: 'video_workflow_latest', payload: { workId } },
        signal
      ),
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const workflowId =
    activeWorkflowId ||
    requestedWorkflowId ||
    latestQuery.data?.workflow.id ||
    '';
  const workflowKey = p1QueryKeys.request('model-supply', 'video_workflow', {
    workflowId,
  });
  const workflowQuery = useQuery({
    enabled: Boolean(workflowId),
    queryKey: workflowKey,
    queryFn: ({ signal }) =>
      queryP1<VideoWorkflowEnvelope>(
        'model-supply',
        { action: 'video_workflow', payload: { workflowId } },
        signal
      ),
    refetchInterval: (query) => {
      const envelope = query.state.data;
      return !envelope || videoWorkflowShouldPoll(envelope)
        ? POLL_INTERVAL_MS
        : false;
    },
    refetchOnWindowFocus: true,
    retry: 2,
  });

  const rememberWorkflow = (envelope: VideoWorkflowEnvelope) => {
    setActiveWorkflowId(envelope.workflow.id);
    queryClient.setQueryData(
      p1QueryKeys.request('model-supply', 'video_workflow', {
        workflowId: envelope.workflow.id,
      }),
      envelope
    );
    queryClient.setQueryData(latestKey, envelope);
  };

  const createDraft = useMutation({
    mutationFn: async () => {
      if (!composer) throw new Error('Video composer is unavailable.');
      const plan = buildVideoWorkflowDraft({
        aigcLabelEnabled: composer.aigcLabelEnabled,
        brandWatermarkText: composer.brandWatermarkText,
        catalogModelId: composer.catalogModelId,
        dataClass: composer.dataClass,
        derivedFrom: editingFromWorkflow ?? undefined,
        referenceAssetIds: composer.referenceAssetIds,
        shots,
        workId,
      });
      return commandP1<VideoWorkflow>(
        'model-supply',
        { action: plan.action, payload: plan.payload },
        plan.idempotencyKey
      );
    },
    onSuccess: (workflow) => {
      setEditingFromWorkflow(null);
      rememberWorkflow({ workflow, job: null });
    },
  });

  const workflowAction = useMutation({
    mutationFn: async (input: WorkflowAction) => {
      const plan =
        input.kind === 'select'
          ? buildVideoWorkflowMutation('select', input.workflowId, {
              candidateIndex: input.candidateIndex,
              shotId: input.shotId,
            })
          : buildVideoWorkflowMutation(input.kind, input.workflowId);
      return commandP1<VideoWorkflowEnvelope>(
        'model-supply',
        { action: plan.action, payload: plan.payload },
        plan.idempotencyKey
      );
    },
    onSuccess: rememberWorkflow,
  });

  const envelope =
    workflowQuery.data ?? (requestedWorkflowId ? undefined : latestQuery.data);
  const workflow = envelope?.workflow;
  const queryError =
    workflowQuery.error ??
    (requestedWorkflowId ? undefined : latestQuery.error);
  const recoveryQuery = requestedWorkflowId ? workflowQuery : latestQuery;
  const mutationError = createDraft.error ?? workflowAction.error;
  const mutationFailure = mutationError
    ? videoWorkflowMutationFailure(mutationError)
    : undefined;
  const editable =
    Boolean(composer) &&
    ((!workflow && !latestQuery.isPending && !latestQuery.error) ||
      Boolean(editingFromWorkflow));
  const lockedModelName = workflow
    ? (composer?.catalogModelNames[workflow.catalogModelId] ??
      video_workflow_locked_model())
    : composer
      ? (composer.catalogModelNames[composer.catalogModelId] ??
        composer.catalogModelName ??
        video_workflow_locked_model())
      : undefined;

  if (
    props.mode === 'progress' &&
    recoveryQuery.isSuccess &&
    !workflow &&
    !queryError
  ) {
    return null;
  }

  return (
    <Card
      aria-label={video_workflow_panel_aria()}
      className={cn('border-primary/15', className)}
    >
      <CardHeader>
        <CardTitle>{video_workflow_panel_title()}</CardTitle>
        <CardDescription>
          {composer
            ? video_workflow_composer_description({
                aigcState:
                  (workflow?.aigcLabelEnabled ?? composer.aigcLabelEnabled)
                    ? video_workflow_aigc_enabled()
                    : video_workflow_aigc_disabled(),
                model: lockedModelName ?? video_workflow_locked_model(),
              })
            : video_workflow_progress_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recoveryQuery.isPending && !workflow ? (
          <output className="text-sm text-muted-foreground">
            {video_workflow_restoring()}
          </output>
        ) : null}

        {queryError ? (
          <QueryFailure
            onRetry={() => {
              if (workflowId) void workflowQuery.refetch();
              else void latestQuery.refetch();
            }}
          />
        ) : null}

        {editable ? (
          <StoryboardEditor
            pending={createDraft.isPending}
            shots={shots}
            onChange={setShots}
            onLock={() => createDraft.mutate()}
          />
        ) : null}

        {workflow && !editingFromWorkflow ? (
          <WorkflowState
            job={envelope?.job ?? null}
            onEditDraft={
              composer
                ? () => {
                    const promptById = new Map(
                      workflow.shots.map((shot) => [shot.id, shot.prompt])
                    );
                    setShots(
                      createAidaStoryboard(composer.intent).map((shot) => ({
                        ...shot,
                        prompt: promptById.get(shot.id) ?? shot.prompt,
                      }))
                    );
                    setEditingFromWorkflow({
                      id: workflow.id,
                      storyboardVersion: workflow.storyboardVersion,
                    });
                  }
                : undefined
            }
            pending={workflowAction.isPending}
            recoveryHref={recoveryHref}
            workflow={workflow}
            onAction={(action) => workflowAction.mutate(action)}
          />
        ) : null}

        {mutationFailure ? (
          <p className="text-sm text-destructive" role="alert">
            {mutationFailure.description}
            {mutationFailure.correlationId ? (
              <>
                <br />
                {common_correlation_id({
                  id: mutationFailure.correlationId,
                })}
              </>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StoryboardEditor({
  onChange,
  onLock,
  pending,
  shots,
}: {
  onChange: (shots: AidaStoryboardShot[]) => void;
  onLock: () => void;
  pending: boolean;
  shots: AidaStoryboardShot[];
}) {
  const canLock = shots.every((shot) => shot.prompt.trim().length > 0);
  return (
    <section className="space-y-3" aria-labelledby="video-storyboard-title">
      <div>
        <h3 className="font-medium" id="video-storyboard-title">
          {video_workflow_editor_title()}
        </h3>
        <p className="text-xs text-muted-foreground">
          {video_workflow_editor_description()}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {shots.map((shot, index) => (
          <div className="space-y-1.5" key={shot.id}>
            <label
              className="text-sm font-medium"
              htmlFor={`video-shot-${shot.id}`}
            >
              {shot.label}
            </label>
            <Textarea
              disabled={pending}
              id={`video-shot-${shot.id}`}
              value={shot.prompt}
              onChange={(event) => {
                const next = [...shots];
                next[index] = { ...shot, prompt: event.currentTarget.value };
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
      <Button disabled={!canLock || pending} type="button" onClick={onLock}>
        {pending ? video_workflow_locking() : video_workflow_lock_storyboard()}
      </Button>
    </section>
  );
}

function WorkflowState({
  job,
  onAction,
  onEditDraft,
  pending,
  recoveryHref,
  workflow,
}: {
  job: VideoWorkflowEnvelope['job'];
  onAction: (action: WorkflowAction) => void;
  onEditDraft?: () => void;
  pending: boolean;
  recoveryHref?: string;
  workflow: VideoWorkflow;
}) {
  const effectiveStatus = videoWorkflowEffectiveStatus({ job, workflow });
  const status = videoWorkflowStatusView(effectiveStatus);
  const steps = videoWorkflowSteps(workflow, job?.status);
  const reviewShots =
    effectiveStatus === 'failed' ? [] : videoWorkflowReviewShots(workflow);
  const canCancel =
    effectiveStatus !== 'failed' &&
    (workflow.status === 'running' ||
      workflow.status === 'awaiting_quality_review');
  const sourceWorkflowId = workflow.derivedFromWorkflowId;
  return (
    <section className="space-y-4" aria-labelledby="video-workflow-status">
      <div
        className={cn(
          'rounded-lg p-3',
          effectiveStatus === 'failed'
            ? 'border border-destructive/30 bg-destructive/5'
            : 'bg-muted/60'
        )}
        role={effectiveStatus === 'failed' ? 'alert' : undefined}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {video_workflow_storyboard_version({
              version: workflow.storyboardVersion,
            })}
          </Badge>
          {sourceWorkflowId ? (
            <span className="text-xs text-muted-foreground">
              {video_workflow_source_storyboard_version({
                version: Math.max(1, workflow.storyboardVersion - 1),
              })}
            </span>
          ) : null}
        </div>
        <h3 className="font-medium" id="video-workflow-status">
          {status.label}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {status.description}
        </p>
      </div>

      <ol
        aria-label={video_workflow_steps_aria()}
        className="overflow-hidden rounded-xl border bg-card xl:grid xl:grid-cols-5"
      >
        {steps.map((step, index) => (
          <li
            className={cn(
              'relative border-b p-4 text-sm last:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0',
              step.state === 'success' && 'bg-primary/5',
              step.state === 'running' &&
                'bg-primary/10 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary xl:before:inset-x-0 xl:before:top-auto xl:before:bottom-0 xl:before:h-1 xl:before:w-auto',
              step.state === 'suspended' &&
                'bg-amber-500/10 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-600 xl:before:inset-x-0 xl:before:top-auto xl:before:bottom-0 xl:before:h-1 xl:before:w-auto',
              step.state === 'failed' && 'bg-destructive/5'
            )}
            data-step-state={step.state}
            key={step.id}
          >
            <span className="flex items-start gap-3">
              <span
                className={cn(
                  'relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  step.state === 'success' &&
                    'border-primary bg-primary text-primary-foreground',
                  step.state === 'running' &&
                    'border-primary bg-background text-primary ring-4 ring-primary/10',
                  step.state === 'waiting' &&
                    'border-muted-foreground/30 bg-muted/60 text-muted-foreground',
                  step.state === 'suspended' &&
                    'border-amber-600/50 bg-background text-amber-700',
                  step.state === 'failed' &&
                    'border-destructive bg-destructive text-destructive-foreground'
                )}
              >
                {step.state === 'success' ? (
                  <IconCheck className="size-5" stroke={2.5} />
                ) : step.state === 'running' ? (
                  <span className="size-2.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                ) : step.state === 'failed' ? (
                  <IconX className="size-5" stroke={2.5} />
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {index + 1}/5
                  </span>
                  <Badge variant="outline">
                    {videoWorkflowStepStateLabel(step.state)}
                  </Badge>
                </span>
                <span
                  className={cn(
                    'mt-1.5 block font-medium',
                    step.state === 'waiting' && 'text-muted-foreground',
                    step.state === 'running' && 'text-primary'
                  )}
                >
                  {step.label}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ol>

      <ReadOnlyStoryboard shots={workflow.shots} />

      {effectiveStatus === 'draft' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            type="button"
            onClick={() =>
              onAction({
                kind: 'confirm',
                workflowId: workflow.id,
              })
            }
          >
            {pending
              ? video_workflow_submitting()
              : video_workflow_confirm_and_generate()}
          </Button>
          {onEditDraft ? (
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={onEditDraft}
            >
              {video_workflow_create_version_from_this()}
            </Button>
          ) : (
            <p className="self-center text-xs text-muted-foreground">
              {video_workflow_edit_on_desktop()}
            </p>
          )}
        </div>
      ) : null}

      {effectiveStatus === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2">
          {onEditDraft ? (
            <Button
              disabled={pending}
              type="button"
              variant="outline"
              onClick={onEditDraft}
            >
              {video_workflow_return_and_create_version()}
            </Button>
          ) : recoveryHref ? (
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={recoveryHref}
            >
              {video_workflow_return_and_create_version()}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              {video_workflow_failure_desktop_recovery()}
            </p>
          )}
        </div>
      ) : null}

      {reviewShots.map((shot, index) => (
        <CandidateReview
          key={shot.id}
          pending={pending}
          shot={shot}
          shotNumber={index + 1}
          onSelect={(candidateIndex) =>
            onAction({
              candidateIndex,
              kind: 'select',
              shotId: shot.id,
              workflowId: workflow.id,
            })
          }
        />
      ))}

      {effectiveStatus === 'awaiting_quality_review' &&
      reviewShots.length === 0 ? (
        <output className="text-sm text-muted-foreground">
          {video_workflow_review_candidates_pending()}
        </output>
      ) : null}

      {effectiveStatus === 'completed' && workflow.composedAsset ? (
        <div className="space-y-3">
          {/* biome-ignore lint/a11y/useMediaCaption: Generated media has no caption artifact to attach. */}
          <video
            aria-label={video_workflow_final_video_aria()}
            className="max-h-[70vh] w-full rounded-xl bg-black object-contain"
            controls
            playsInline
            poster="/seed/video/video-poster-wide.webp"
            preload="metadata"
            src={videoAssetUrl(workflow.composedAsset.objectKey)}
          />
          <a
            className={buttonVariants({ variant: 'outline' })}
            href="/dashboard/content"
          >
            {copy_candidate_view_in_content()}
          </a>
        </div>
      ) : null}

      {canCancel ? (
        <Button
          disabled={pending}
          type="button"
          variant="destructive"
          onClick={() => onAction({ kind: 'cancel', workflowId: workflow.id })}
        >
          {pending
            ? video_workflow_submitting_action()
            : video_workflow_cancel_task()}
        </Button>
      ) : null}
    </section>
  );
}

function ReadOnlyStoryboard({ shots }: { shots: VideoWorkflow['shots'] }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {shots.map((shot, index) => (
        <article className="rounded-lg border p-3" key={shot.id}>
          <p className="text-xs font-medium text-muted-foreground">
            {video_workflow_storyboard_number({ number: index + 1 })}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{shot.prompt}</p>
        </article>
      ))}
    </div>
  );
}

function CandidateReview({
  onSelect,
  pending,
  shot,
  shotNumber,
}: {
  onSelect: (candidateIndex: number) => void;
  pending: boolean;
  shot: VideoWorkflow['shots'][number];
  shotNumber: number;
}) {
  const candidates = shot.candidates.filter(isPlayableCandidate);
  return (
    <fieldset className="space-y-3 rounded-xl border p-3">
      <legend className="px-1 font-medium">
        {video_workflow_candidate_legend({ number: shotNumber })}
      </legend>
      <div className="grid gap-3 lg:grid-cols-2">
        {candidates.map((candidate) => (
          <article
            className="space-y-2 rounded-lg bg-muted/50 p-2"
            key={candidate.index}
          >
            {/* biome-ignore lint/a11y/useMediaCaption: Generated candidates have no caption artifact to attach. */}
            <video
              aria-label={video_workflow_candidate_video_aria({
                candidate: candidate.index + 1,
                shot: shotNumber,
              })}
              className="aspect-[9/16] max-h-80 w-full rounded-lg bg-black object-contain"
              controls
              playsInline
              poster="/seed/video/video-poster-vertical.webp"
              preload="metadata"
              src={videoAssetUrl(candidate.asset.objectKey)}
            />
            <p className="text-xs text-muted-foreground">
              {videoCandidateQualityText(candidate)}
            </p>
            <Button
              aria-label={video_workflow_candidate_select_aria({
                candidate: candidate.index + 1,
                shot: shotNumber,
              })}
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onSelect(candidate.index)}
            >
              {video_workflow_candidate_select()}
            </Button>
          </article>
        ))}
      </div>
    </fieldset>
  );
}

function QueryFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <Card size="sm" role="alert">
      <CardHeader>
        <CardTitle>{video_workflow_query_failed_title()}</CardTitle>
        <CardDescription>
          {video_workflow_query_failed_description()}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm" type="button" variant="outline" onClick={onRetry}>
          {video_workflow_query_retry()}
        </Button>
      </CardFooter>
    </Card>
  );
}

function videoWorkflowStepStateLabel(
  state: ReturnType<typeof videoWorkflowSteps>[number]['state']
) {
  if (state === 'success') return video_workflow_step_state_success();
  if (state === 'running') return video_workflow_step_state_running();
  if (state === 'suspended') return video_workflow_step_state_suspended();
  if (state === 'failed') return video_workflow_step_state_failed();
  return video_workflow_step_state_waiting();
}

function isPlayableCandidate(
  candidate: VideoWorkflowCandidate
): candidate is VideoWorkflowCandidate & {
  asset: NonNullable<VideoWorkflowCandidate['asset']>;
} {
  return (
    candidate.status === 'completed' &&
    candidate.asset?.contentType === 'video/mp4' &&
    candidate.asset.technicalValidation?.playable !== false
  );
}
