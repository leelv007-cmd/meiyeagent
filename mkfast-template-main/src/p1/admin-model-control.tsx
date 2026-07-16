import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconFilePlus,
  IconPlayerPlay,
  IconRefresh,
  IconRocket,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { m } from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  createAdminCatalogDraftJson,
  createRouteSimulationPayload,
  normalizeAdminCatalog,
  normalizeAdminCatalogControl,
  normalizeAdminRouteSimulation,
  parseAdminCatalogDraft,
  routeSimulatorFormSchema,
  type AdminCatalogModelView,
  type AdminRouteSimulation,
  type AdminRouteSimulationPayload,
  type ModelOperation,
  type RouteSimulatorFormValues,
} from '@/p1/admin-view-model';
import { commandP1, queryP1 } from '@/p1/client';
import { AdminActivationProbeControl } from '@/p1/admin-activation-probe-control';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';

const OPERATIONS: Array<{
  id: ModelOperation;
  label: () => string;
}> = [
  { id: 'copy.generate', label: m.p1_admin_model_operation_copy },
  { id: 'image.generate', label: m.p1_admin_model_operation_image_generate },
  { id: 'image.edit', label: m.p1_admin_model_operation_image_edit },
  { id: 'video.generate', label: m.p1_admin_model_operation_video },
];

const EMPTY_CATALOG_MODELS: AdminCatalogModelView[] = [];

const ROUTE_REASON_LABELS: Record<
  AdminRouteSimulation['expectedOutcome']['reason'],
  () => string
> = {
  fallback_not_authorized: m.p1_admin_model_route_reason_fallback_unauthorized,
  no_eligible_candidate: m.p1_admin_model_route_reason_no_candidate,
  no_safe_fallback_candidate: m.p1_admin_model_route_reason_no_safe_fallback,
  provider_acceptance_unknown: m.p1_admin_model_route_reason_acceptance_unknown,
  provider_already_accepted: m.p1_admin_model_route_reason_already_accepted,
  provider_completed: m.p1_admin_model_route_reason_completed,
  safe_auto_fallback: m.p1_admin_model_route_reason_safe_fallback,
};

const FILTER_REASON_LABELS: Record<
  AdminRouteSimulation['candidateEvaluations'][number]['exclusionReasons'][number],
  () => string
> = {
  catalog_model_missing: m.p1_admin_model_filter_catalog_missing,
  custom_requires_fixed_selection:
    m.p1_admin_model_filter_custom_requires_fixed,
  data_class_disallowed: m.p1_admin_model_filter_data_class,
  deployment_inactive: m.p1_admin_model_filter_deployment_inactive,
  fixed_model_mismatch: m.p1_admin_model_filter_fixed_mismatch,
  operation_unsupported: m.p1_admin_model_filter_operation_unsupported,
  simulated_unavailable: m.p1_admin_model_filter_simulated_unavailable,
};

function formatRouteCost(
  cost: AdminRouteSimulation['rankedCandidates'][number]['costEstimate']
) {
  return `${(cost.amountMicros / 1_000_000).toFixed(4)} ${cost.currency}/${cost.unit}`;
}

const evaluationFormSchema = z.object({
  catalogModelId: z
    .string()
    .trim()
    .min(1, m.p1_admin_model_validation_evaluation_model()),
});

const rollbackFormSchema = z
  .object({
    catalogRevisionId: z.string(),
    kind: z.enum(['prompt', 'catalog']),
    promptRevisionId: z.string(),
    reason: z
      .string()
      .trim()
      .min(1, m.p1_admin_model_validation_rollback_reason()),
  })
  .superRefine((value, context) => {
    const targetRevisionId =
      value.kind === 'prompt'
        ? value.promptRevisionId
        : value.catalogRevisionId;
    if (!targetRevisionId.trim()) {
      context.addIssue({
        code: 'custom',
        message: m.p1_admin_model_validation_rollback_revision(),
        path: [
          value.kind === 'prompt' ? 'promptRevisionId' : 'catalogRevisionId',
        ],
      });
    }
  });

const catalogDraftFormSchema = z.object({
  editor: z.string().trim().min(1, m.p1_admin_model_validation_catalog_json()),
});

const revisionFormSchema = z.object({
  revisionId: z
    .string()
    .trim()
    .min(1, m.p1_admin_model_validation_revision_id()),
});

type EvaluationFormValues = z.infer<typeof evaluationFormSchema>;
type RollbackFormValues = z.infer<typeof rollbackFormSchema>;
type CatalogDraftFormValues = z.infer<typeof catalogDraftFormSchema>;
type RevisionFormValues = z.infer<typeof revisionFormSchema>;

interface ModelSupplyCommandRequest {
  action: string;
  payload: Record<string, unknown>;
}

interface CatalogRevisionActivity {
  createdAt: string;
  id: string;
  number: number;
  previousRevisionId?: string;
  stage: 'draft' | 'enabled' | 'published' | 'retired';
}

type QualityEvaluationEvidenceKind =
  | 'recorded_contract'
  | 'live_provider'
  | 'historical_unknown';

interface QualityEvaluationRun {
  id: string;
  status: 'completed' | 'failed';
  datasetRevision: string;
  promptRevision: string;
  exampleSetRevision: string;
  catalogRevisionId: string;
  requestedCatalogModelId: string;
  evidenceKind: QualityEvaluationEvidenceKind;
  createdAt: string;
  summary: { caseCount: number; passed: number; passRate: number };
  cases: Array<{
    id: string;
    fixtureId: string;
    scenario: string;
    platform: string;
    catalogModelId: string;
    evidenceKind: QualityEvaluationEvidenceKind;
    passed: boolean;
    evaluation: { dimensionScore: number; warnings: string[] };
  }>;
  failure?: string;
}

const QUALITY_EVIDENCE_PRESENTATION: Record<
  QualityEvaluationEvidenceKind,
  {
    casePassLabel: () => string;
    description: () => string;
    label: () => string;
    runPassLabel: () => string;
  }
> = {
  historical_unknown: {
    casePassLabel: m.p1_admin_model_evidence_historical_result,
    description: m.p1_admin_model_evidence_historical_description,
    label: m.p1_admin_model_evidence_historical_label,
    runPassLabel: m.p1_admin_model_evidence_historical_result,
  },
  live_provider: {
    casePassLabel: m.p1_admin_model_evidence_live_passed,
    description: m.p1_admin_model_evidence_live_description,
    label: m.p1_admin_model_evidence_live_label,
    runPassLabel: m.p1_admin_model_evidence_live_passed,
  },
  recorded_contract: {
    casePassLabel: m.p1_admin_model_evidence_recorded_passed,
    description: m.p1_admin_model_evidence_recorded_description,
    label: m.p1_admin_model_evidence_recorded_label,
    runPassLabel: m.p1_admin_model_evidence_recorded_passed,
  },
};

function qualityRunResultLabel(run: QualityEvaluationRun) {
  const result = `${run.summary.passed}/${run.summary.caseCount}`;
  return `${result} ${QUALITY_EVIDENCE_PRESENTATION[run.evidenceKind].runPassLabel()}`;
}

interface QualityDashboard {
  northStar:
    | {
        status: 'unknown';
        target: number;
        sampleSize: number;
        minimumSampleSize: number;
      }
    | {
        status: 'known';
        target: number;
        sampleSize: number;
        minimumSampleSize: number;
        accepted: number;
        rate: number;
        met: boolean;
      };
  byModel: QualityDashboardGroup[];
  byPromptRevision: QualityDashboardGroup[];
  byTemplateRevision: QualityDashboardGroup[];
  byScenario: QualityDashboardGroup[];
  funnel: {
    adoptedDirectly: number;
    adoptedWithSmallEdit: number;
    rerolled: number;
    abandoned: number;
    published: number;
  };
}

interface QualityDashboardGroup {
  key: string;
  sampleSize: number;
  accepted: number;
  rate: number;
}

interface PromptRevisionView {
  currentPromptRevision: string;
  currentExampleSetRevision: string;
  revisions: Array<{
    promptRevision: string;
    exampleSetRevision: string;
    label: string;
    current: boolean;
  }>;
}

interface CatalogRevisionList {
  currentRevisionId: string;
  expectedHeadRevisionId: string | null;
  revisions: Array<{
    id: string;
    number: number;
    stage: 'draft' | 'enabled' | 'published' | 'retired' | 'recorded';
    createdAt: string | null;
    current: boolean;
  }>;
}

interface RevisionRollbackAudit {
  id: string;
  kind: 'prompt' | 'catalog';
  actorId: string;
  fromRevisionId: string;
  toRevisionId: string;
  reason: string;
  createdAt: string;
}

function availabilityVariant(
  availability: AdminCatalogModelView['availability']
) {
  if (availability === 'available') return 'secondary' as const;
  if (availability === 'recorded') return 'outline' as const;
  return 'destructive' as const;
}

function ModelEvidence({ model }: { model: AdminCatalogModelView }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{model.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {model.manufacturer} · {model.stableModelName} · {model.version}
          </p>
        </div>
        <Badge variant={availabilityVariant(model.availability)}>
          {model.availability}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Activation evidence</dt>
          <dd>{model.activationEvidence.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {m.p1_admin_model_evidence_time()}
          </dt>
          <dd>
            {model.activationEvidence.verifiedAt ?? m.p1_common_not_provided()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {m.p1_admin_model_evidence_reference()}
          </dt>
          <dd>
            {model.activationEvidence.evidenceRef ?? m.p1_common_not_provided()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {m.p1_admin_model_allowed_data_classes()}
          </dt>
          <dd>
            {model.allowedDataClasses.join(', ') || m.p1_common_none_short()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {m.p1_admin_model_denied_data_classes()}
          </dt>
          <dd>
            {model.deniedDataClasses.join(', ') || m.p1_common_none_short()}
          </dd>
        </div>
      </dl>
      {model.unavailableReason ? (
        <p className="mt-3 text-xs text-destructive">
          {m.p1_admin_model_unavailable_reason({
            reason: model.unavailableReason,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function AdminModelControl() {
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const [activities, setActivities] = useState<CatalogRevisionActivity[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [routeSimulationRequest, setRouteSimulationRequest] = useState<{
    payload: AdminRouteSimulationPayload;
    requestId: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const routeSimulatorForm = useForm<RouteSimulatorFormValues>({
    defaultValues: {
      catalogModelId: '',
      dataClass: 'public',
      failureScenario: 'rejected_before_accept',
      fallbackConsent: true,
      operation: 'copy.generate',
      selectionMode: 'auto',
      unavailableDeploymentIds: '',
    },
    resolver: zodResolver(routeSimulatorFormSchema),
  });
  const evaluationForm = useForm<EvaluationFormValues>({
    defaultValues: { catalogModelId: '' },
    resolver: zodResolver(evaluationFormSchema),
  });
  const rollbackForm = useForm<RollbackFormValues>({
    defaultValues: {
      catalogRevisionId: '',
      kind: 'prompt',
      promptRevisionId: '',
      reason: '',
    },
    resolver: zodResolver(rollbackFormSchema),
  });
  const catalogDraftForm = useForm<CatalogDraftFormValues>({
    defaultValues: { editor: '' },
    resolver: zodResolver(catalogDraftFormSchema),
  });
  const revisionForm = useForm<RevisionFormValues>({
    defaultValues: { revisionId: '' },
    resolver: zodResolver(revisionFormSchema),
  });

  const catalogsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'admin_catalogs', {
      operations: OPERATIONS.map(({ id }) => id),
    }),
    queryFn: ({ signal }) =>
      Promise.all(
        OPERATIONS.map(async ({ id }) => ({
          id,
          value: await queryP1<unknown>(
            'model-supply',
            { action: 'catalog', payload: { operation: id } },
            signal
          ),
        }))
      ),
    select: (responses) =>
      responses.map(({ id, value }) => normalizeAdminCatalog(value, id)),
  });
  const catalogControlQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'admin_catalog_control'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'admin_catalog_control' },
        signal
      ),
    select: normalizeAdminCatalogControl,
  });
  const qualityDashboardQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'quality_dashboard'),
    queryFn: ({ signal }) =>
      queryP1<QualityDashboard>(
        'model-supply',
        { action: 'quality_dashboard' },
        signal
      ),
  });
  const qualityRunsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'quality_evaluations'),
    queryFn: ({ signal }) =>
      queryP1<QualityEvaluationRun[]>(
        'model-supply',
        { action: 'quality_evaluations' },
        signal
      ),
  });
  const promptRevisionsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'prompt_revisions'),
    queryFn: ({ signal }) =>
      queryP1<PromptRevisionView>(
        'model-supply',
        { action: 'prompt_revisions' },
        signal
      ),
  });
  const catalogRevisionsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'catalog_revisions'),
    queryFn: ({ signal }) =>
      queryP1<CatalogRevisionList>(
        'model-supply',
        { action: 'catalog_revisions' },
        signal
      ),
  });
  const rollbackAuditsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'revision_rollback_audits'),
    queryFn: ({ signal }) =>
      queryP1<RevisionRollbackAudit[]>(
        'model-supply',
        { action: 'revision_rollback_audits' },
        signal
      ),
  });
  const routeSimulationQuery = useQuery({
    enabled: routeSimulationRequest !== null,
    queryKey: p1QueryKeys.request('model-supply', 'route_simulation', {
      ...(routeSimulationRequest?.payload ?? {}),
      requestId: routeSimulationRequest?.requestId ?? 'idle',
    }),
    queryFn: async ({ signal }) => {
      if (!routeSimulationRequest) {
        throw new Error(m.p1_admin_model_route_not_ready());
      }
      return queryP1<unknown>(
        'model-supply',
        {
          action: 'route_simulation',
          payload: { ...routeSimulationRequest.payload },
        },
        signal
      );
    },
    select: normalizeAdminRouteSimulation,
  });
  const commandMutation = useMutation<
    unknown,
    Error,
    ModelSupplyCommandRequest
  >({
    mutationFn: ({ action, payload }) =>
      commandP1('model-supply', { action, payload }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('model-supply'),
      }),
  });

  const snapshots = catalogsQuery.data ?? [];
  const catalogControl = catalogControlQuery.data;
  const qualityDashboard = qualityDashboardQuery.data;
  const qualityRuns = qualityRunsQuery.data ?? [];
  const promptRevisions = promptRevisionsQuery.data;
  const catalogRevisions = catalogRevisionsQuery.data;
  const rollbackAudits = rollbackAuditsQuery.data ?? [];
  const routeSimulation = routeSimulationQuery.data;
  const queries = [
    catalogsQuery,
    catalogControlQuery,
    qualityDashboardQuery,
    qualityRunsQuery,
    promptRevisionsQuery,
    catalogRevisionsQuery,
    rollbackAuditsQuery,
  ];
  const loading = queries.some((query) => query.isPending);
  const fetching = queries.some((query) => query.isFetching);
  const errorCause = queries.find((query) => query.error)?.error;
  const error = errorCause
    ? m.p1_admin_model_catalog_load_error_description()
    : undefined;
  const busy = commandMutation.isPending
    ? commandMutation.variables?.action
    : undefined;
  const copyModels =
    snapshots.find((snapshot) => snapshot.operation === 'copy.generate')
      ?.models ?? EMPTY_CATALOG_MODELS;
  const evaluableCopyModels = copyModels.filter(
    (model) => model.activationEvidence.status !== 'documented'
  );
  const simulatorOperation = routeSimulatorForm.watch('operation');
  const simulatorSelectionMode = routeSimulatorForm.watch('selectionMode');
  const simulatorModels =
    snapshots.find((snapshot) => snapshot.operation === simulatorOperation)
      ?.models ?? EMPTY_CATALOG_MODELS;

  useEffect(() => {
    if (!selectedRunId && qualityRuns[0]) {
      setSelectedRunId(qualityRuns[0].id);
    }
  }, [qualityRuns, selectedRunId]);

  useEffect(() => {
    if (
      !evaluationForm.getValues('catalogModelId') &&
      evaluableCopyModels.length > 0
    ) {
      evaluationForm.setValue(
        'catalogModelId',
        evaluableCopyModels[0]?.id ?? ''
      );
    }
  }, [evaluableCopyModels, evaluationForm]);

  useEffect(() => {
    if (
      simulatorOperation !== 'copy.generate' &&
      simulatorSelectionMode === 'auto'
    ) {
      routeSimulatorForm.setValue('selectionMode', 'fixed', {
        shouldValidate: true,
      });
    }
    const currentModelId = routeSimulatorForm.getValues('catalogModelId');
    if (!simulatorModels.some((model) => model.id === currentModelId)) {
      const nextModelId =
        simulatorModels.find((model) => model.availability !== 'unavailable')
          ?.id ?? '';
      if (nextModelId !== currentModelId) {
        routeSimulatorForm.setValue('catalogModelId', nextModelId);
      }
    }
  }, [
    routeSimulatorForm,
    simulatorModels,
    simulatorOperation,
    simulatorSelectionMode,
  ]);

  useEffect(() => {
    if (
      catalogControl &&
      !catalogDraftForm.formState.isDirty &&
      !catalogDraftForm.getValues('editor')
    ) {
      catalogDraftForm.setValue(
        'editor',
        createAdminCatalogDraftJson(catalogControl)
      );
    }
  }, [catalogControl, catalogDraftForm]);

  useEffect(() => {
    if (promptRevisions && !rollbackForm.getValues('promptRevisionId')) {
      rollbackForm.setValue(
        'promptRevisionId',
        promptRevisions.revisions.find((revision) => !revision.current)
          ?.promptRevision ?? ''
      );
    }
  }, [promptRevisions, rollbackForm]);

  useEffect(() => {
    if (catalogRevisions && !rollbackForm.getValues('catalogRevisionId')) {
      rollbackForm.setValue(
        'catalogRevisionId',
        [...catalogRevisions.revisions]
          .reverse()
          .find(
            (revision) =>
              !revision.current &&
              (revision.stage === 'published' || revision.stage === 'recorded')
          )?.id ?? ''
      );
    }
  }, [catalogRevisions, rollbackForm]);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.module('model-supply'),
    });

  const executeCommand = async <T,>(request: ModelSupplyCommandRequest) =>
    (await commandMutation.mutateAsync(request)) as T;

  const remember = (revision: CatalogRevisionActivity) => {
    setActivities((current) => [revision, ...current]);
    revisionForm.setValue('revisionId', revision.id, {
      shouldDirty: false,
    });
  };

  const createDraft = async ({ editor }: CatalogDraftFormValues) => {
    try {
      const catalog = parseAdminCatalogDraft(editor);
      const revision = await executeCommand<CatalogRevisionActivity>({
        action: 'catalog_create_draft',
        payload: { catalog },
      });
      remember(revision);
      toast.success(
        m.p1_admin_model_catalog_draft_created({ revision: revision.id })
      );
    } catch {
      toast.error(m.p1_admin_model_catalog_draft_error());
    }
  };

  const transition = async (
    action: 'catalog_enable' | 'catalog_publish' | 'catalog_retire',
    label: string,
    { revisionId }: RevisionFormValues,
    reason?: string
  ) => {
    if (action === 'catalog_publish' && !catalogRevisions) {
      throw new Error(m.p1_admin_model_catalog_refresh_before_publish());
    }
    const revision = await executeCommand<CatalogRevisionActivity>({
      action,
      payload: {
        revisionId,
        ...(reason ? { reason } : {}),
        ...(action === 'catalog_publish'
          ? {
              expectedHeadRevisionId:
                catalogRevisions?.expectedHeadRevisionId ?? null,
            }
          : {}),
      },
    });
    remember(revision);
    toast.success(label);
  };

  const runQualityEvaluation = async ({
    catalogModelId,
  }: EvaluationFormValues) => {
    try {
      const run = await executeCommand<QualityEvaluationRun>({
        action: 'quality_evaluation_run',
        payload: { catalogModelId },
      });
      setSelectedRunId(run.id);
      toast.success(m.p1_admin_model_quality_success());
    } catch {
      toast.error(m.p1_admin_model_quality_error());
    }
  };

  const runRouteSimulation = (values: RouteSimulatorFormValues) => {
    setRouteSimulationRequest({
      payload: createRouteSimulationPayload(values),
      requestId: crypto.randomUUID(),
    });
  };

  const rollback = async (values: RollbackFormValues, reason: string) => {
    const targetRevisionId =
      values.kind === 'prompt'
        ? values.promptRevisionId
        : values.catalogRevisionId;
    const action =
      values.kind === 'prompt'
        ? 'prompt_revision_rollback'
        : 'catalog_rollback';
    await executeCommand({
      action,
      payload: {
        revisionId: targetRevisionId,
        reason,
      },
    });
    rollbackForm.reset({
      catalogRevisionId: '',
      kind: 'prompt',
      promptRevisionId: '',
      reason: '',
    });
    toast.success(m.p1_admin_model_rollback_success());
  };

  const submitRollback = (kind: RollbackFormValues['kind']) => {
    rollbackForm.setValue('kind', kind);
    void rollbackForm.handleSubmit(
      (values) => {
        const targetRevisionId =
          values.kind === 'prompt'
            ? values.promptRevisionId
            : values.catalogRevisionId;
        setImpactReview({
          title:
            values.kind === 'prompt'
              ? m.p1_admin_model_rollback_prompt_title()
              : m.p1_admin_model_rollback_catalog_title(),
          description: m.p1_admin_model_rollback_description(),
          scope: `${values.kind} → ${targetRevisionId}`,
          changes: [
            m.p1_admin_model_rollback_change_new_execution(),
            m.p1_admin_model_rollback_change_history(),
            m.p1_admin_model_rollback_change_audit(),
          ],
          confirmLabel: m.p1_admin_model_rollback_confirm(),
          initialReason: values.reason,
          onConfirm: (reason) => rollback(values, reason),
        });
      },
      () => toast.error(m.p1_admin_model_rollback_validation_error())
    )();
  };

  const submitTransition = (
    action: 'catalog_enable' | 'catalog_publish' | 'catalog_retire',
    label: string
  ) => {
    void revisionForm.handleSubmit(
      (values) => {
        if (action === 'catalog_enable') {
          void transition(action, label, values).catch(() =>
            toast.error(m.p1_admin_model_catalog_operation_error())
          );
          return;
        }
        if (action === 'catalog_publish' && !catalogRevisions) {
          toast.error(m.p1_admin_model_catalog_refresh_before_publish());
          return;
        }
        setImpactReview({
          title:
            action === 'catalog_publish'
              ? m.p1_admin_model_catalog_publish_review_title()
              : m.p1_admin_model_catalog_retire_review_title(),
          description:
            action === 'catalog_publish'
              ? m.p1_admin_model_catalog_publish_review_description()
              : m.p1_admin_model_catalog_retire_review_description(),
          scope: m.p1_admin_model_catalog_review_scope({
            revision: values.revisionId,
          }),
          changes:
            action === 'catalog_publish'
              ? [
                  m.p1_admin_model_catalog_publish_change_head({
                    from:
                      catalogRevisions?.expectedHeadRevisionId ??
                      'recorded baseline',
                    to: values.revisionId,
                  }),
                  m.p1_admin_model_catalog_publish_change_new_execution(),
                  m.p1_admin_model_catalog_publish_change_history(),
                ]
              : [
                  m.p1_admin_model_catalog_retire_change_stage({
                    revision: values.revisionId,
                  }),
                  m.p1_admin_model_catalog_retire_change_selection(),
                  m.p1_admin_model_catalog_retire_change_history(),
                ],
          confirmLabel:
            action === 'catalog_publish'
              ? m.p1_admin_model_catalog_publish_confirm()
              : m.p1_admin_model_catalog_retire_confirm(),
          onConfirm: (reason) => transition(action, label, values, reason),
        });
      },
      () => toast.error(m.p1_admin_model_validation_revision_id())
    )();
  };

  const selectedRun = qualityRuns.find((run) => run.id === selectedRunId);
  const qualityBreakdowns = qualityDashboard
    ? [
        {
          dimension: m.p1_admin_model_quality_dimension_model(),
          rows: qualityDashboard.byModel,
        },
        {
          dimension: 'Prompt revision',
          rows: qualityDashboard.byPromptRevision,
        },
        {
          dimension: 'Template revision',
          rows: qualityDashboard.byTemplateRevision,
        },
        {
          dimension: m.p1_admin_model_quality_dimension_scenario(),
          rows: qualityDashboard.byScenario,
        },
      ]
    : [];
  const evaluationModelId = evaluationForm.watch('catalogModelId');
  const promptRollbackTarget = rollbackForm.watch('promptRevisionId');
  const catalogRollbackTarget = rollbackForm.watch('catalogRevisionId');

  return (
    <div className="space-y-6">
      <Alert>
        <IconAlertTriangle />
        <AlertTitle>{m.p1_admin_model_notice_title()}</AlertTitle>
        <AlertDescription>
          {m.p1_admin_model_notice_description()}
        </AlertDescription>
      </Alert>

      <AdminActivationProbeControl />

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_model_catalog_safe_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_model_catalog_safe_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {m.p1_admin_model_catalog_load_error_title()}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex justify-end">
            <Button
              disabled={loading || fetching}
              onClick={() => void refresh()}
              variant="outline"
            >
              <IconRefresh />
              {m.p1_admin_model_refresh_catalog_channels()}
            </Button>
          </div>
          {snapshots.map((snapshot) => (
            <section className="space-y-3" key={snapshot.operation}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">
                  {OPERATIONS.find(
                    (item) => item.id === snapshot.operation
                  )?.label() ?? snapshot.operation}
                </h3>
                <Badge variant="outline">{snapshot.stage}</Badge>
                <span className="text-xs text-muted-foreground">
                  revision: {snapshot.revisionId}
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {snapshot.models.map((model) => (
                  <ModelEvidence key={model.id} model={model} />
                ))}
              </div>
              {snapshot.models.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {m.p1_admin_model_catalog_operation_empty()}
                </p>
              ) : null}
            </section>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Route simulator</CardTitle>
          <CardDescription>
            {m.p1_admin_model_route_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            className="grid gap-4 lg:grid-cols-3"
            onSubmit={routeSimulatorForm.handleSubmit(runRouteSimulation, () =>
              toast.error(m.p1_admin_model_route_validation_error())
            )}
          >
            <div className="space-y-2">
              <Label htmlFor="route-simulator-operation">Operation</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                id="route-simulator-operation"
                {...routeSimulatorForm.register('operation')}
              >
                {OPERATIONS.map((operation) => (
                  <option key={operation.id} value={operation.id}>
                    {operation.label()}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-simulator-selection">
                {m.p1_admin_model_route_selection_mode()}
              </Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                id="route-simulator-selection"
                {...routeSimulatorForm.register('selectionMode')}
              >
                <option value="fixed">
                  {m.p1_admin_model_route_selection_fixed()}
                </option>
                <option
                  disabled={simulatorOperation !== 'copy.generate'}
                  value="auto"
                >
                  LLM Auto
                </option>
              </select>
              {routeSimulatorForm.formState.errors.selectionMode ? (
                <p className="text-xs text-destructive">
                  {routeSimulatorForm.formState.errors.selectionMode.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-simulator-model">
                {m.p1_admin_model_route_fixed_model()}
              </Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                disabled={simulatorSelectionMode === 'auto'}
                id="route-simulator-model"
                {...routeSimulatorForm.register('catalogModelId')}
              >
                <option value="">
                  {m.p1_admin_model_route_select_model()}
                </option>
                {simulatorModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName} · {model.availability}
                  </option>
                ))}
              </select>
              {routeSimulatorForm.formState.errors.catalogModelId ? (
                <p className="text-xs text-destructive">
                  {routeSimulatorForm.formState.errors.catalogModelId.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-simulator-data-class">Data class</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                id="route-simulator-data-class"
                {...routeSimulatorForm.register('dataClass')}
              >
                <option value="public">public</option>
                <option value="contains_face">contains_face</option>
                <option value="pii">pii</option>
                <option value="medical">medical</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-simulator-failure">
                {m.p1_admin_model_route_failure_scenario()}
              </Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                id="route-simulator-failure"
                {...routeSimulatorForm.register('failureScenario')}
              >
                <option value="success">
                  {m.p1_admin_model_route_failure_success()}
                </option>
                <option value="rejected_before_accept">
                  {m.p1_admin_model_route_failure_rejected_before_accept()}
                </option>
                <option value="accepted_failure">
                  {m.p1_admin_model_route_failure_accepted()}
                </option>
                <option value="acceptance_unknown">
                  {m.p1_admin_model_route_failure_unknown()}
                </option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-simulator-unavailable">
                {m.p1_admin_model_route_unavailable_deployments()}
              </Label>
              <Input
                id="route-simulator-unavailable"
                placeholder="openai-direct, gemini-direct"
                {...routeSimulatorForm.register('unavailableDeploymentIds')}
              />
              <p className="text-xs text-muted-foreground">
                {m.p1_admin_model_route_unavailable_description()}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm lg:col-span-2">
              <input
                className="size-4"
                disabled={simulatorSelectionMode !== 'auto'}
                type="checkbox"
                {...routeSimulatorForm.register('fallbackConsent')}
              />
              {m.p1_admin_model_route_fallback_consent()}
            </label>
            <div className="flex justify-end">
              <Button disabled={routeSimulationQuery.isFetching} type="submit">
                <IconPlayerPlay />
                {routeSimulationQuery.isFetching
                  ? m.p1_admin_model_route_running()
                  : m.p1_admin_model_route_run()}
              </Button>
            </div>
          </form>

          {routeSimulationQuery.error ? (
            <Alert variant="destructive">
              <AlertTitle>{m.p1_admin_model_route_error_title()}</AlertTitle>
              <AlertDescription>
                {m.p1_admin_model_route_error_description()}
              </AlertDescription>
            </Alert>
          ) : null}

          {routeSimulation ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {m.p1_admin_model_route_expected_action()}
                  </p>
                  <p className="mt-1 font-medium">
                    {routeSimulation.expectedOutcome.action}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROUTE_REASON_LABELS[
                      routeSimulation.expectedOutcome.reason
                    ]()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {m.p1_admin_model_route_expected_attempts()}
                  </p>
                  <p className="mt-1 font-medium">
                    {routeSimulation.expectedOutcome.expectedAttempts} /{' '}
                    {routeSimulation.expectedOutcome.attemptLimit}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    revision {routeSimulation.catalogRevisionId}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {m.p1_admin_model_route_estimated_cost()}
                  </p>
                  <p className="mt-1 font-medium">
                    {routeSimulation.estimatedMaximumCost
                      ? formatRouteCost(routeSimulation.estimatedMaximumCost)
                      : m.p1_admin_model_route_cost_unavailable()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {routeSimulation.estimatedMaximumCost?.source ??
                      m.p1_admin_model_route_cost_no_candidate()}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {m.p1_admin_model_route_column_rank()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_route_column_model()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_route_column_region()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_route_column_cost()}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routeSimulation.rankedCandidates.map((candidate) => (
                      <TableRow key={candidate.deploymentId}>
                        <TableCell>#{candidate.rank}</TableCell>
                        <TableCell>
                          <p className="font-medium">
                            {candidate.catalogModelId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {candidate.deploymentId}
                          </p>
                        </TableCell>
                        <TableCell>
                          {candidate.region} · {candidate.channel}
                        </TableCell>
                        <TableCell>
                          {formatRouteCost(candidate.costEstimate)}
                          <p className="text-xs text-muted-foreground">
                            {candidate.costEstimate.source}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {routeSimulation.rankedCandidates.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    {m.p1_admin_model_route_no_ranked_candidates()}
                  </p>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deployment</TableHead>
                      <TableHead>
                        {m.p1_admin_model_route_column_decision()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_route_column_filter_reason()}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routeSimulation.candidateEvaluations.map((candidate) => (
                      <TableRow key={candidate.deploymentId}>
                        <TableCell>
                          <p className="font-medium">
                            {candidate.catalogModelId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {candidate.deploymentId}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              candidate.eligible ? 'secondary' : 'outline'
                            }
                          >
                            {candidate.eligible
                              ? m.p1_admin_model_route_eligible()
                              : m.p1_admin_model_route_filtered()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {candidate.exclusionReasons.length > 0
                            ? candidate.exclusionReasons
                                .map((reason) => FILTER_REASON_LABELS[reason]())
                                .join(m.p1_admin_model_reason_separator())
                            : m.p1_common_none_short()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
              {m.p1_admin_model_route_empty_description()}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_model_quality_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_model_quality_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {m.p1_admin_model_quality_north_star()}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {qualityDashboard?.northStar.status === 'known'
                  ? `${Math.round(qualityDashboard.northStar.rate * 100)}%`
                  : 'unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.p1_admin_model_quality_target_sample({
                  minimum: qualityDashboard?.northStar.minimumSampleSize ?? 20,
                  sample: qualityDashboard?.northStar.sampleSize ?? 0,
                })}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {m.p1_admin_model_quality_latest_offline()}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {qualityRuns[0]
                  ? qualityRunResultLabel(qualityRuns[0])
                  : m.p1_admin_model_quality_not_run()}
              </p>
              <p className="text-xs text-muted-foreground">
                {qualityRuns[0]
                  ? `${qualityRuns[0].datasetRevision} · ${QUALITY_EVIDENCE_PRESENTATION[qualityRuns[0].evidenceKind].label()}`
                  : m.p1_admin_model_quality_no_revision()}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {m.p1_admin_model_quality_current_prompt()}
              </p>
              <p className="mt-1 text-sm font-medium">
                {promptRevisions?.currentPromptRevision ??
                  m.p1_admin_model_quality_reading()}
              </p>
              <p className="text-xs text-muted-foreground">
                {promptRevisions?.currentExampleSetRevision ?? '—'}
              </p>
            </div>
          </div>

          {qualityDashboard ? (
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {m.p1_admin_model_quality_column_dimension()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_quality_column_group()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_quality_column_rate()}
                      </TableHead>
                      <TableHead>
                        {m.p1_admin_model_quality_column_sample()}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualityBreakdowns.flatMap(({ dimension, rows }) =>
                      rows.map((group) => (
                        <TableRow key={`${dimension}:${group.key}`}>
                          <TableCell>{dimension}</TableCell>
                          <TableCell className="font-medium">
                            {group.key}
                          </TableCell>
                          <TableCell>{Math.round(group.rate * 100)}%</TableCell>
                          <TableCell>{group.sampleSize}</TableCell>
                        </TableRow>
                      ))
                    )}
                    {qualityBreakdowns.every(
                      ({ rows }) => rows.length === 0
                    ) ? (
                      <TableRow>
                        <TableCell
                          className="text-muted-foreground"
                          colSpan={4}
                        >
                          {m.p1_admin_model_quality_sample_empty()}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">
                  {m.p1_admin_model_quality_funnel_title()}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[
                    [
                      m.p1_admin_model_quality_funnel_direct(),
                      qualityDashboard.funnel.adoptedDirectly,
                    ],
                    [
                      m.p1_admin_model_quality_funnel_small_edit(),
                      qualityDashboard.funnel.adoptedWithSmallEdit,
                    ],
                    [
                      m.p1_admin_model_quality_funnel_reroll(),
                      qualityDashboard.funnel.rerolled,
                    ],
                    [
                      m.p1_admin_model_quality_funnel_abandoned(),
                      qualityDashboard.funnel.abandoned,
                    ],
                    [
                      m.p1_admin_model_quality_funnel_published(),
                      qualityDashboard.funnel.published,
                    ],
                  ].map(([label, value]) => (
                    <div className="rounded-md bg-muted/40 p-3" key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ) : null}

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={evaluationForm.handleSubmit(runQualityEvaluation, () =>
              toast.error(m.p1_admin_model_quality_no_model())
            )}
          >
            <div className="min-w-64 space-y-2">
              <Label htmlFor="quality-evaluation-model">
                {m.p1_admin_model_quality_model()}
              </Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                id="quality-evaluation-model"
                {...evaluationForm.register('catalogModelId')}
              >
                {evaluableCopyModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName} · {model.availability}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={Boolean(busy) || !evaluationModelId}
              type="submit"
            >
              <IconPlayerPlay />
              {busy === 'quality_evaluation_run'
                ? m.p1_admin_model_quality_running()
                : m.p1_admin_model_quality_run()}
            </Button>
          </form>

          <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {m.p1_admin_model_quality_history_title()}
              </p>
              {qualityRuns.map((run) => (
                <button
                  className={`w-full rounded-lg border p-3 text-left text-sm ${
                    selectedRunId === run.id
                      ? 'border-primary bg-primary/5'
                      : ''
                  }`}
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {qualityRunResultLabel(run)}
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      <Badge variant="secondary">
                        {QUALITY_EVIDENCE_PRESENTATION[
                          run.evidenceKind
                        ].label()}
                      </Badge>
                      <Badge
                        variant={
                          run.status === 'completed' ? 'outline' : 'destructive'
                        }
                      >
                        {run.status}
                      </Badge>
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {run.promptRevision} · {run.catalogRevisionId}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatLocaleDateTime(run.createdAt)}
                  </span>
                </button>
              ))}
              {qualityRuns.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  {m.p1_admin_model_quality_history_empty()}
                </p>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-lg border">
              {selectedRun ? (
                <div className="border-b bg-muted/30 px-4 py-3 text-sm">
                  <p className="font-medium">
                    {QUALITY_EVIDENCE_PRESENTATION[
                      selectedRun.evidenceKind
                    ].label()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {QUALITY_EVIDENCE_PRESENTATION[
                      selectedRun.evidenceKind
                    ].description()}
                  </p>
                </div>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {m.p1_admin_model_quality_column_fixture()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_quality_column_scenario()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_quality_column_score()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_quality_column_result()}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRun?.cases.map((testCase) => (
                    <TableRow key={testCase.id}>
                      <TableCell>
                        <p className="font-medium">{testCase.fixtureId}</p>
                        <p className="text-xs text-muted-foreground">
                          {testCase.catalogModelId}
                        </p>
                      </TableCell>
                      <TableCell>
                        {testCase.scenario} · {testCase.platform}
                      </TableCell>
                      <TableCell>
                        {Math.round(testCase.evaluation.dimensionScore * 100)}%
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            testCase.passed ? 'secondary' : 'destructive'
                          }
                        >
                          {testCase.passed
                            ? QUALITY_EVIDENCE_PRESENTATION[
                                testCase.evidenceKind
                              ].casePassLabel()
                            : m.p1_admin_model_quality_failed()}
                        </Badge>
                        {testCase.evaluation.warnings.length > 0 ? (
                          <p className="mt-1 text-xs text-destructive">
                            {testCase.evaluation.warnings.join(', ')}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!selectedRun ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {m.p1_admin_model_quality_select_run()}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_model_rollback_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_model_rollback_card_description()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="revision-rollback-reason">
                {m.p1_admin_model_rollback_reason()}
              </Label>
              <Input
                id="revision-rollback-reason"
                placeholder={m.p1_admin_model_rollback_reason_placeholder()}
                {...rollbackForm.register('reason')}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Prompt revision</p>
                  <p className="text-xs text-muted-foreground">
                    {m.p1_admin_model_current_revision({
                      revision: promptRevisions?.currentPromptRevision ?? '—',
                    })}
                  </p>
                </div>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  {...rollbackForm.register('promptRevisionId')}
                >
                  <option value="">
                    {m.p1_admin_model_rollback_select_prompt()}
                  </option>
                  {promptRevisions?.revisions
                    .filter((revision) => !revision.current)
                    .map((revision) => (
                      <option
                        key={revision.promptRevision}
                        value={revision.promptRevision}
                      >
                        {revision.label} · {revision.promptRevision} ·{' '}
                        {revision.exampleSetRevision}
                      </option>
                    ))}
                </select>
                <Button
                  disabled={Boolean(busy) || !promptRollbackTarget}
                  onClick={() => submitRollback('prompt')}
                  type="button"
                  variant="outline"
                >
                  {m.p1_admin_model_rollback_prompt_button()}
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Catalog revision</p>
                  <p className="text-xs text-muted-foreground">
                    {m.p1_admin_model_current_revision({
                      revision: catalogRevisions?.currentRevisionId ?? '—',
                    })}
                  </p>
                </div>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  {...rollbackForm.register('catalogRevisionId')}
                >
                  <option value="">
                    {m.p1_admin_model_rollback_select_catalog()}
                  </option>
                  {catalogRevisions?.revisions
                    .filter(
                      (revision) =>
                        !revision.current &&
                        (revision.stage === 'published' ||
                          revision.stage === 'recorded')
                    )
                    .map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        #{revision.number} · {revision.id} · {revision.stage}
                      </option>
                    ))}
                </select>
                <Button
                  disabled={Boolean(busy) || !catalogRollbackTarget}
                  onClick={() => submitRollback('catalog')}
                  type="button"
                  variant="outline"
                >
                  {m.p1_admin_model_rollback_catalog_button()}
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {m.p1_admin_model_rollback_column_time()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_rollback_column_type()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_rollback_column_from()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_rollback_column_to()}
                    </TableHead>
                    <TableHead>
                      {m.p1_admin_model_rollback_column_reason()}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollbackAudits.map((audit) => (
                    <TableRow key={audit.id}>
                      <TableCell>
                        {formatLocaleDateTime(audit.createdAt)}
                      </TableCell>
                      <TableCell>{audit.kind}</TableCell>
                      <TableCell className="max-w-48 truncate">
                        {audit.fromRevisionId}
                      </TableCell>
                      <TableCell className="max-w-48 truncate">
                        {audit.toRevisionId}
                      </TableCell>
                      <TableCell>{audit.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rollbackAudits.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {m.p1_admin_model_rollback_audit_empty()}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{m.p1_admin_model_catalog_editor_title()}</CardTitle>
            <CardDescription>
              {m.p1_admin_model_catalog_editor_description()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {catalogControl ? (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <p className="font-medium">
                  {m.p1_admin_model_catalog_current({
                    revision: catalogControl.revisionId,
                    stage: catalogControl.stage,
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Provider {catalogControl.catalog.providerProfiles.length}
                  </Badge>
                  <Badge variant="outline">
                    Channel {catalogControl.catalog.executionChannels.length}
                  </Badge>
                  <Badge variant="outline">
                    Deployment {catalogControl.catalog.deployments.length}
                  </Badge>
                  <Badge variant="outline">
                    Capability {catalogControl.catalog.capabilities.length}
                  </Badge>
                  <Badge variant="outline">
                    Price {catalogControl.catalog.prices.length}
                  </Badge>
                  <Badge variant="outline">
                    Route {catalogControl.catalog.routes.length}
                  </Badge>
                </div>
              </div>
            ) : null}
            <form
              className="space-y-4"
              onSubmit={catalogDraftForm.handleSubmit(createDraft, () =>
                toast.error(m.p1_admin_model_catalog_json_invalid())
              )}
            >
              <Textarea
                aria-label={m.p1_admin_model_catalog_json_aria()}
                className="min-h-[32rem] font-mono text-xs"
                spellCheck={false}
                {...catalogDraftForm.register('editor')}
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={Boolean(busy)} type="submit">
                  <IconFilePlus />
                  {busy === 'catalog_create_draft'
                    ? m.p1_admin_model_catalog_validating()
                    : m.p1_admin_model_catalog_create_draft()}
                </Button>
                <Button
                  disabled={Boolean(busy) || !catalogControl}
                  onClick={() => {
                    if (catalogControl) {
                      catalogDraftForm.reset({
                        editor: createAdminCatalogDraftJson(catalogControl),
                      });
                    }
                  }}
                  type="button"
                  variant="outline"
                >
                  <IconRefresh />
                  {m.p1_admin_model_catalog_load_current()}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{m.p1_admin_model_lifecycle_title()}</CardTitle>
            <CardDescription>
              {m.p1_admin_model_lifecycle_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-model-revision-id">Revision ID</Label>
                <Input
                  id="admin-model-revision-id"
                  placeholder={m.p1_admin_model_revision_placeholder()}
                  {...revisionForm.register('revisionId')}
                />
              </div>
              <div className="grid gap-2">
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    submitTransition(
                      'catalog_enable',
                      m.p1_admin_model_catalog_enable_success()
                    )
                  }
                  type="button"
                  variant="outline"
                >
                  <IconPlayerPlay />
                  {busy === 'catalog_enable'
                    ? m.p1_admin_model_catalog_enabling()
                    : m.p1_admin_model_catalog_enable_draft()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    submitTransition(
                      'catalog_publish',
                      m.p1_admin_model_catalog_publish_success()
                    )
                  }
                  type="button"
                >
                  <IconRocket />
                  {busy === 'catalog_publish'
                    ? m.p1_admin_model_catalog_publishing()
                    : m.p1_admin_model_catalog_publish_enabled()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    submitTransition(
                      'catalog_retire',
                      m.p1_admin_model_catalog_retire_success()
                    )
                  }
                  type="button"
                  variant="destructive"
                >
                  <IconTrash />
                  {busy === 'catalog_retire'
                    ? m.p1_admin_model_catalog_retiring()
                    : m.p1_admin_model_catalog_retire_published()}
                </Button>
              </div>
              <Alert>
                <IconCircleCheck />
                <AlertTitle>{m.p1_admin_model_preflight_title()}</AlertTitle>
                <AlertDescription>
                  {m.p1_admin_model_preflight_description()}
                </AlertDescription>
              </Alert>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_model_activity_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_model_activity_description()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Revision ID</TableHead>
                <TableHead>
                  {m.p1_admin_model_activity_column_stage()}
                </TableHead>
                <TableHead>
                  {m.p1_admin_model_activity_column_previous()}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((activity) => (
                <TableRow key={activity.id}>
                  <TableCell>{activity.number}</TableCell>
                  <TableCell>{activity.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{activity.stage}</Badge>
                  </TableCell>
                  <TableCell>{activity.previousRevisionId ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {activities.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {m.p1_admin_model_activity_empty()}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </div>
  );
}
