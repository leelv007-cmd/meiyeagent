import type {
  CatalogArtifactStatus,
  CatalogValidationResult,
  CreationLensId,
  RecipeModelPolicyMode,
  SurfaceRecipeRef,
} from '@meiye/contracts';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { commandP1, queryP1 } from '@/p1/client';

type AdminPayload = Record<string, unknown>;

export interface CreationExperienceAdminApi {
  query(action: string, payload: AdminPayload): Promise<unknown>;
  command(
    action: string,
    payload: AdminPayload,
    idempotencyKey: string
  ): Promise<unknown>;
}

/** Published revision candidate from recipe_published_revisions (#373 / #376). */
type RecipePublishedRevisionCandidate = {
  recipeId: string;
  revisionId: string;
  revision: number;
  title: string;
  lensId: CreationLensId;
  publishedAt: string;
};

type RecipePublishedRevisionGroup = {
  recipeId: string;
  candidates: RecipePublishedRevisionCandidate[];
};

type RecipePublishedRevisionsResult = {
  groups: RecipePublishedRevisionGroup[];
  availableRecipeHeads: RecipePublishedRevisionCandidate[];
};

export type RecipePublishSuccess = {
  recipeId: string;
  revisionId: string;
};

export type SurfaceBridgeRequest = {
  nonce: number;
  surfaceId: string;
  pendingRecipeRevisionId: string;
};

const defaultApi: CreationExperienceAdminApi = {
  query: (action, payload) =>
    queryP1('creation-experience', { action, payload }),
  command: (action, payload, idempotencyKey) =>
    commandP1('creation-experience', { action, payload }, idempotencyKey),
};

/** Server compilation receipt attached by recipe_governance_save (never client-built). */
type RecipeCompilationReceipt = {
  receiptId: string;
  compiledAt?: string;
  industryKey: string;
  promptRevisionRef: string;
  skillRevisionRefs: string[];
  workflowRevisionRef?: string;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
};

type RecipeStudioReleaseProjection = {
  phase: string;
  compilationReceipt?: RecipeCompilationReceipt;
  validation?: { checkedAt?: string; passed?: boolean } | null;
};

/** Four Spec I #397 presentation states for a recipe evidence gate. */
type RecipeEvidencePresentationStatus =
  | 'none'
  | 'expired'
  | 'prompt_mismatch'
  | 'ready';

type RecipeEvidenceFailedCase = {
  caseId: string;
  reason: string;
};

type RecipeEvidenceGateView = {
  evidenceKind: 'recipe_evaluation' | 'recipe_internal_test';
  status: RecipeEvidencePresentationStatus;
  receiptId: string | null;
  runId: string | null;
  passed: boolean | null;
  expiresAt: string | null;
  promptRevisionRef: string | null;
  failedCases: RecipeEvidenceFailedCase[];
};

type RecipeEvidenceStatusResult = {
  recipeId: string;
  recipeRevision: number;
  currentPromptRevisionRef: string;
  evaluation: RecipeEvidenceGateView;
  internalTest: RecipeEvidenceGateView;
};

const EVIDENCE_STATUS_LABELS: Record<
  RecipeEvidencePresentationStatus,
  string
> = {
  none: '无证据',
  expired: '证据已过期',
  prompt_mismatch: '证据与当前 Prompt 不符',
  ready: '已具备',
};

type RecipeRecord = {
  recipeId: string;
  revision: number;
  revisionId: string;
  status: CatalogArtifactStatus;
  lensId: CreationLensId;
  familyId?: string;
  presentation: {
    title: string;
    summary: string;
    actionLabel?: string;
    previewAssetRef?: string;
  };
  delivery?: Record<string, unknown>;
  contextPatches?: Record<string, unknown>;
  /** Loaded from head; carried through draft payload so title-only edits do not wipe. */
  factTypes?: string[];
  sourceRequirements?: Array<Record<string, unknown>>;
  modelPolicy: { mode: RecipeModelPolicyMode; catalogModelId?: string };
  settingsPatches?: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  /** Loaded from head; carried through draft payload so title-only edits do not wipe. */
  skillRevisionRefs?: string[];
  targetWorkspaceKind: CreationLensId;
  rolledBackToRevision?: number | null;
  /** Server-only release evidence; present on admin command responses / heads. */
  studioRelease?: RecipeStudioReleaseProjection;
};

/**
 * Deterministic defaults for governance-only fields that lack dedicated editors
 * in this ticket (pass-through / create defaults — Spec D3 / #372).
 * industryKey is never inferred from lens.
 */
const RECIPE_GOVERNANCE_DEFAULTS = {
  industryKey: 'beauty_general',
  workflowRevisionRef: 'workflow.recipe-studio@1',
  outputContractRef: 'output.image-text-note@1',
  quotePolicyRevisionRef: 'quote.policy@1',
  intentTypes: ['daily_exposure'] as string[],
  storySegments: [
    'pain_point',
    'professional_insight',
    'service_solution',
    'cta',
  ] as string[],
  candidateStrategy: 'dual_style_user_choice' as
    | 'single_primary'
    | 'dual_style_user_choice',
};

type GovernanceCandidateStrategy =
  (typeof RECIPE_GOVERNANCE_DEFAULTS)['candidateStrategy'];

type RecipeDelivery = {
  contentPackagePlatform: string;
  distributionTarget: string;
  deliverableKind: 'copy_document' | 'note' | 'video_package';
  quantity: number;
  aspectRatio?: string;
  notePageBound?: number;
  durationSeconds?: number;
};

type SurfaceRecord = {
  surfaceId: string;
  revision: number;
  revisionId: string;
  status: CatalogArtifactStatus;
  recipeRefs: SurfaceRecipeRef[];
  rolledBackToRevision?: number | null;
};

const lensLabels: Record<CreationLensId, string> = {
  copy: '文案',
  image_text: '图文',
  video: '视频',
};

function defaultRecipeDelivery(lensId: CreationLensId): RecipeDelivery {
  if (lensId === 'copy') {
    return {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'export',
      deliverableKind: 'copy_document',
      quantity: 1,
    };
  }
  if (lensId === 'video') {
    return {
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverableKind: 'video_package',
      quantity: 1,
      aspectRatio: '9:16',
      durationSeconds: 15,
    };
  }
  return {
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'export',
    deliverableKind: 'note',
    quantity: 1,
    aspectRatio: '3:4',
    notePageBound: 3,
  };
}

/** Map structured delivery controls to governance outputKind (not lens-guessing). */
function outputKindFromDelivery(delivery: RecipeDelivery): string {
  if (delivery.deliverableKind === 'copy_document') return 'copy';
  if (delivery.deliverableKind === 'video_package') return 'video';
  if (delivery.deliverableKind === 'note') return 'image_text_note';
  return 'image_text_note';
}

function stringArrayField(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  return items.length > 0 ? items.map((item) => item.trim()) : [...fallback];
}

function readRecipeStudioPlan(contextPatches?: Record<string, unknown>) {
  const plan = contextPatches?.recipeStudioPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return null;
  }
  return plan as Record<string, unknown>;
}

function idempotencyKey(action: string, id: string) {
  return `${action}:${id}:${crypto.randomUUID()}`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试。';
}

function asRecipeRecord(value: unknown): RecipeRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as RecipeRecord;
}

function asSurfaceRecord(value: unknown): SurfaceRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as SurfaceRecord;
}

/** Parse `recipeId@revision` revision ids (mirrors Core parseRecipeRevisionId). */
export function parseRecipeRevisionId(
  revisionId: string
): { recipeId: string; revision: number } | null {
  const at = revisionId.lastIndexOf('@');
  if (at <= 0) return null;
  const recipeId = revisionId.slice(0, at);
  const revision = Number(revisionId.slice(at + 1));
  if (!recipeId || !Number.isInteger(revision) || revision < 1) return null;
  return { recipeId, revision };
}

function asPublishedRevisionsResult(
  value: unknown
): RecipePublishedRevisionsResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RecipePublishedRevisionsResult>;
  if (!Array.isArray(record.groups) || !Array.isArray(record.availableRecipeHeads)) {
    return null;
  }
  return {
    groups: record.groups as RecipePublishedRevisionGroup[],
    availableRecipeHeads:
      record.availableRecipeHeads as RecipePublishedRevisionCandidate[],
  };
}

function isEvidencePresentationStatus(
  value: unknown
): value is RecipeEvidencePresentationStatus {
  return (
    value === 'none' ||
    value === 'expired' ||
    value === 'prompt_mismatch' ||
    value === 'ready'
  );
}

function asEvidenceGateView(
  value: unknown,
  fallbackKind: RecipeEvidenceGateView['evidenceKind']
): RecipeEvidenceGateView {
  if (!value || typeof value !== 'object') {
    return {
      evidenceKind: fallbackKind,
      status: 'none',
      receiptId: null,
      runId: null,
      passed: null,
      expiresAt: null,
      promptRevisionRef: null,
      failedCases: [],
    };
  }
  const record = value as Partial<RecipeEvidenceGateView>;
  const failedCases = Array.isArray(record.failedCases)
    ? record.failedCases
        .filter(
          (entry): entry is RecipeEvidenceFailedCase =>
            !!entry &&
            typeof entry === 'object' &&
            typeof entry.caseId === 'string' &&
            typeof entry.reason === 'string'
        )
        .map((entry) => ({
          caseId: entry.caseId,
          reason: entry.reason,
        }))
    : [];
  return {
    evidenceKind:
      record.evidenceKind === 'recipe_internal_test'
        ? 'recipe_internal_test'
        : fallbackKind,
    status: isEvidencePresentationStatus(record.status) ? record.status : 'none',
    receiptId:
      typeof record.receiptId === 'string' && record.receiptId.trim()
        ? record.receiptId
        : null,
    runId:
      typeof record.runId === 'string' && record.runId.trim()
        ? record.runId
        : null,
    passed: typeof record.passed === 'boolean' ? record.passed : null,
    expiresAt:
      typeof record.expiresAt === 'string' ? record.expiresAt : null,
    promptRevisionRef:
      typeof record.promptRevisionRef === 'string'
        ? record.promptRevisionRef
        : null,
    failedCases,
  };
}

function asEvidenceStatusResult(
  value: unknown
): RecipeEvidenceStatusResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RecipeEvidenceStatusResult>;
  if (
    typeof record.recipeId !== 'string' ||
    typeof record.recipeRevision !== 'number'
  ) {
    return null;
  }
  return {
    recipeId: record.recipeId,
    recipeRevision: record.recipeRevision,
    currentPromptRevisionRef:
      typeof record.currentPromptRevisionRef === 'string'
        ? record.currentPromptRevisionRef
        : '',
    evaluation: asEvidenceGateView(record.evaluation, 'recipe_evaluation'),
    internalTest: asEvidenceGateView(
      record.internalTest,
      'recipe_internal_test'
    ),
  };
}

function emptyEvidenceStatus(
  recipeId: string,
  recipeRevision: number
): RecipeEvidenceStatusResult {
  return {
    recipeId,
    recipeRevision,
    currentPromptRevisionRef: '',
    evaluation: asEvidenceGateView(null, 'recipe_evaluation'),
    internalTest: asEvidenceGateView(null, 'recipe_internal_test'),
  };
}

function RecipeEvidencePanel({
  status,
  busy,
  onRunEvaluation,
}: {
  status: RecipeEvidenceStatusResult | null;
  busy: boolean;
  onRunEvaluation: () => void;
}) {
  const evaluation = status?.evaluation;
  const internalTest = status?.internalTest;
  const failedCases = evaluation?.failedCases ?? [];

  return (
    <Frame dense headingLevel={3} data-testid="recipe-evidence-panel">
      <FrameHeader>
        <FrameTitle>评测证据</FrameTitle>
        <FrameDescription>
          Per-revision server-issued evidence only. Status and receiptId are
          read-only — no pass-state inputs.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="space-y-3 text-sm">
        {!status ? (
          <p
            className="text-muted-foreground"
            data-testid="recipe-evidence-empty"
          >
            Load a Recipe revision to inspect evidence status.
          </p>
        ) : (
          <>
            <p data-testid="recipe-evidence-revision">
              revision: r{status.recipeRevision}
            </p>
            <div
              className="space-y-1 rounded-md border border-input px-3 py-2"
              data-testid="recipe-evidence-evaluation"
              data-status={evaluation?.status ?? 'none'}
            >
              <p className="font-medium">评测门</p>
              <p data-testid="recipe-evidence-evaluation-status">
                状态: {EVIDENCE_STATUS_LABELS[evaluation?.status ?? 'none']}
              </p>
              <p
                className="break-all"
                data-testid="recipe-evidence-evaluation-receipt"
              >
                receiptId: {evaluation?.receiptId ?? '—'}
              </p>
            </div>
            <div
              className="space-y-1 rounded-md border border-input px-3 py-2"
              data-testid="recipe-evidence-internal-test"
              data-status={internalTest?.status ?? 'none'}
            >
              <p className="font-medium">内测门</p>
              <p data-testid="recipe-evidence-internal-test-status">
                状态: {EVIDENCE_STATUS_LABELS[internalTest?.status ?? 'none']}
              </p>
              <p
                className="break-all"
                data-testid="recipe-evidence-internal-test-receipt"
              >
                receiptId: {internalTest?.receiptId ?? '—'}
              </p>
            </div>
            {failedCases.length > 0 ? (
              <div
                className="space-y-1 rounded-md border border-destructive/40 px-3 py-2"
                data-testid="recipe-evidence-failed-cases"
              >
                <p className="font-medium text-destructive">评测失败用例</p>
                <ul className="space-y-1">
                  {failedCases.map((item) => (
                    <li
                      key={item.caseId}
                      data-testid="recipe-evidence-failed-case"
                      data-case-id={item.caseId}
                    >
                      <span className="font-mono text-xs">{item.caseId}</span>
                      {': '}
                      {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={busy || !status}
              data-testid="recipe-evidence-run-evaluation"
              onClick={onRunEvaluation}
            >
              运行评测并签发证据
            </Button>
          </>
        )}
      </FramePanel>
    </Frame>
  );
}

/**
 * Replace every Surface recipeRef that matches pending recipeId with the new
 * revisionId; preserve lens/order/featured/visible on each match.
 */
export function applyPendingRecipeRevisionToRefs(
  refs: SurfaceRecipeRef[],
  pendingRecipeRevisionId: string
): { refs: SurfaceRecipeRef[]; matchedCount: number } {
  const pending = parseRecipeRevisionId(pendingRecipeRevisionId);
  if (!pending) return { refs, matchedCount: 0 };
  let matchedCount = 0;
  const next = refs.map((ref) => {
    const current = parseRecipeRevisionId(ref.recipeRevisionId);
    if (current?.recipeId === pending.recipeId) {
      matchedCount += 1;
      return { ...ref, recipeRevisionId: pendingRecipeRevisionId };
    }
    return ref;
  });
  return { refs: next, matchedCount };
}

function publishedRevisions<T extends { revision: number; status: string }>(
  history: T[],
  currentRevision?: number
) {
  return history.filter(
    (item) => item.status === 'published' && item.revision !== currentRevision
  );
}

function lifecycleBadgeVariant(status?: CatalogArtifactStatus) {
  if (status === 'published') return 'success-light' as const;
  if (status === 'preview') return 'info-light' as const;
  if (status === 'draft') return 'secondary' as const;
  return 'outline' as const;
}

function LifecycleHistory({
  history,
}: {
  history: Array<{
    revision: number;
    status: CatalogArtifactStatus;
    rolledBackToRevision?: number | null;
  }>;
}) {
  return (
    <Frame dense headingLevel={3}>
      <FrameHeader>
        <FrameTitle>版本历史</FrameTitle>
      </FrameHeader>
      <FramePanel>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚无版本。</p>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2">
            {[...history].reverse().map((item) => (
              <li
                key={`${item.revision}-${item.status}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm"
              >
                r{item.revision}
                <Badge variant={lifecycleBadgeVariant(item.status)}>
                  {item.status}
                </Badge>
                {item.rolledBackToRevision
                  ? `回滚自 r${item.rolledBackToRevision}`
                  : ''}
              </li>
            ))}
          </ol>
        )}
      </FramePanel>
    </Frame>
  );
}

function RecipeEditor({
  api,
  onPublishSuccess,
}: {
  api: CreationExperienceAdminApi;
  onPublishSuccess?: (success: RecipePublishSuccess) => void;
}) {
  const [recipeId, setRecipeId] = useState('');
  const [lensId, setLensId] = useState<CreationLensId>('image_text');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [promptRevisionRef, setPromptRevisionRef] = useState('');
  const [modelMode, setModelMode] = useState<RecipeModelPolicyMode>('auto');
  const [catalogModelId, setCatalogModelId] = useState('');
  const [delivery, setDelivery] = useState<RecipeDelivery>(() =>
    defaultRecipeDelivery('image_text')
  );
  const [reason, setReason] = useState('');
  const [factTypes, setFactTypes] = useState<string[]>([]);
  const [skillRevisionRefs, setSkillRevisionRefs] = useState<string[]>([]);
  // Governance-only pass-through (no dedicated editors this ticket — Spec D3).
  const [industryKey, setIndustryKey] = useState(
    RECIPE_GOVERNANCE_DEFAULTS.industryKey
  );
  const [workflowRevisionRef, setWorkflowRevisionRef] = useState(
    RECIPE_GOVERNANCE_DEFAULTS.workflowRevisionRef
  );
  const [outputContractRef, setOutputContractRef] = useState(
    RECIPE_GOVERNANCE_DEFAULTS.outputContractRef
  );
  const [quotePolicyRevisionRef, setQuotePolicyRevisionRef] = useState(
    RECIPE_GOVERNANCE_DEFAULTS.quotePolicyRevisionRef
  );
  const [intentTypes, setIntentTypes] = useState<string[]>([
    ...RECIPE_GOVERNANCE_DEFAULTS.intentTypes,
  ]);
  const [storySegments, setStorySegments] = useState<string[]>([
    ...RECIPE_GOVERNANCE_DEFAULTS.storySegments,
  ]);
  const [candidateStrategy, setCandidateStrategy] =
    useState<GovernanceCandidateStrategy>(
      RECIPE_GOVERNANCE_DEFAULTS.candidateStrategy
    );
  const [sourceRequirements, setSourceRequirements] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [outputKind, setOutputKind] = useState(() =>
    outputKindFromDelivery(defaultRecipeDelivery('image_text'))
  );
  const [studioRelease, setStudioRelease] =
    useState<RecipeStudioReleaseProjection | null>(null);
  const [head, setHead] = useState<RecipeRecord | null>(null);
  const [history, setHistory] = useState<RecipeRecord[]>([]);
  const [rollbackRevision, setRollbackRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidenceStatus, setEvidenceStatus] =
    useState<RecipeEvidenceStatusResult | null>(null);
  const operationInFlight = useRef(false);

  const hydrate = (record: RecipeRecord) => {
    const nextDelivery = {
      ...defaultRecipeDelivery(record.lensId),
      ...(record.delivery as Partial<RecipeDelivery>),
    };
    setLensId(record.lensId);
    setTitle(record.presentation.title);
    setSummary(record.presentation.summary);
    setPromptRevisionRef(record.promptRevisionRef);
    setModelMode(record.modelPolicy.mode);
    setCatalogModelId(record.modelPolicy.catalogModelId ?? '');
    setDelivery(nextDelivery);
    // Carry server bindings into edit state (no dedicated UI — still round-trip).
    setFactTypes(
      Array.isArray(record.factTypes) ? [...record.factTypes] : []
    );
    setSkillRevisionRefs(
      Array.isArray(record.skillRevisionRefs)
        ? [...record.skillRevisionRefs]
        : []
    );
    setSourceRequirements(
      Array.isArray(record.sourceRequirements)
        ? record.sourceRequirements.map((item) => ({ ...item }))
        : []
    );
    const plan = readRecipeStudioPlan(record.contextPatches);
    setIndustryKey(
      typeof plan?.industryKey === 'string' && plan.industryKey.trim()
        ? plan.industryKey.trim()
        : RECIPE_GOVERNANCE_DEFAULTS.industryKey
    );
    setIntentTypes(
      stringArrayField(plan?.intentTypes, RECIPE_GOVERNANCE_DEFAULTS.intentTypes)
    );
    setStorySegments(
      stringArrayField(
        plan?.storySegments,
        RECIPE_GOVERNANCE_DEFAULTS.storySegments
      )
    );
    const settings = record.settingsPatches ?? {};
    const strategy = settings.candidateStrategy;
    setCandidateStrategy(
      strategy === 'single_primary' || strategy === 'dual_style_user_choice'
        ? strategy
        : RECIPE_GOVERNANCE_DEFAULTS.candidateStrategy
    );
    setOutputKind(
      typeof settings.outputKind === 'string' && settings.outputKind.trim()
        ? settings.outputKind.trim()
        : outputKindFromDelivery(nextDelivery)
    );
    setWorkflowRevisionRef(
      record.workflowRevisionRef?.trim() ||
        RECIPE_GOVERNANCE_DEFAULTS.workflowRevisionRef
    );
    setOutputContractRef(
      record.outputContractRef?.trim() ||
        RECIPE_GOVERNANCE_DEFAULTS.outputContractRef
    );
    setQuotePolicyRevisionRef(
      record.quotePolicyRevisionRef?.trim() ||
        RECIPE_GOVERNANCE_DEFAULTS.quotePolicyRevisionRef
    );
    setStudioRelease(record.studioRelease ?? null);
  };

  const refreshHistory = async () => {
    const result = await api.query('recipe_history', { recipeId });
    setHistory(Array.isArray(result) ? (result as RecipeRecord[]) : []);
  };

  const refreshEvidenceStatus = async (
    id: string,
    revision: number | null | undefined
  ) => {
    const trimmed = id.trim();
    if (!trimmed || revision == null || !Number.isInteger(revision)) {
      setEvidenceStatus(null);
      return;
    }
    try {
      const result = asEvidenceStatusResult(
        await api.query('recipe_evidence_status', {
          recipeId: trimmed,
          recipeRevision: revision,
        })
      );
      setEvidenceStatus(result ?? emptyEvidenceStatus(trimmed, revision));
    } catch {
      setEvidenceStatus(emptyEvidenceStatus(trimmed, revision));
    }
  };

  const load = async () => {
    if (!recipeId.trim()) return;
    setBusy(true);
    setError('');
    try {
      const [record, records] = await Promise.all([
        api.query('recipe_get', { recipeId: recipeId.trim() }),
        api.query('recipe_history', { recipeId: recipeId.trim() }),
      ]);
      const parsed = asRecipeRecord(record);
      setHead(parsed);
      setHistory(Array.isArray(records) ? (records as RecipeRecord[]) : []);
      if (parsed) {
        hydrate(parsed);
        await refreshEvidenceStatus(parsed.recipeId, parsed.revision);
      } else {
        setEvidenceStatus(null);
      }
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setBusy(false);
    }
  };

  const runOperation = async (operation: () => Promise<void>) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (commandError) {
      setError(messageOf(commandError));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const executeCommand = async (action: string, payload: AdminPayload) => {
    const result = await api.command(
      action,
      payload,
      idempotencyKey(action, recipeId)
    );
    const record = asRecipeRecord(result);
    setHead(record);
    if (record) {
      hydrate(record);
      await refreshEvidenceStatus(record.recipeId, record.revision);
    } else {
      setEvidenceStatus(null);
    }
    await refreshHistory();
  };

  const execute = (action: string, payload: AdminPayload) =>
    runOperation(() => executeCommand(action, payload));

  const runEvaluationEvidence = () => {
    if (!head) {
      setError('请先加载 Recipe revision。');
      return;
    }
    void runOperation(async () => {
      const result = await api.command(
        'recipe_evidence_run_evaluation',
        {
          recipeId: head.recipeId,
          expectedRevision: head.revision,
          reason: reason.trim() || 'Templates evaluation run',
        },
        idempotencyKey('recipe_evidence_run_evaluation', head.recipeId)
      );
      // Prefer command projection (includes failed cases from the run).
      const fromCommand = asEvidenceStatusResult(result);
      if (fromCommand) {
        setEvidenceStatus(fromCommand);
        return;
      }
      // Fallback: re-query status for the same revision.
      await refreshEvidenceStatus(head.recipeId, head.revision);
    });
  };

  const validate = async () => {
    const result = (await api.query('recipe_validate', {
      recipeId,
      ...(head ? { revision: head.revision } : {}),
    })) as CatalogValidationResult;
    if (result.ok) return true;
    setError(result.errors.join('；'));
    return false;
  };

  const draft = () => {
    const normalizedId = recipeId.trim();
    if (
      !normalizedId ||
      !title.trim() ||
      !summary.trim() ||
      !promptRevisionRef.trim()
    ) {
      setError('请填写 Recipe ID、标题、摘要和 Prompt revision。');
      return;
    }
    if (modelMode === 'fixed' && !catalogModelId.trim()) {
      setError('固定模型策略需要填写 Catalog model ID。');
      return;
    }
    if (!reason.trim()) {
      setError('请填写变更原因。');
      return;
    }
    // Plain draft path remains for title/binding round-trips (#361). Governed
    // compile+validate uses recipe_governance_save separately (Spec D3 / #372).
    void execute('recipe_draft', {
      recipeId: normalizedId,
      expectedRevision: head?.revision ?? null,
      reason: reason.trim(),
      body: {
        lensId,
        ...(head?.familyId ? { familyId: head.familyId } : {}),
        presentation: {
          title: title.trim(),
          summary: summary.trim(),
          actionLabel: `选择${lensLabels[lensId]}并套用`,
          ...(head?.presentation.previewAssetRef
            ? { previewAssetRef: head.presentation.previewAssetRef }
            : {}),
        },
        delivery,
        contextPatches: head?.contextPatches ?? {},
        factTypes,
        sourceRequirements:
          sourceRequirements.length > 0
            ? sourceRequirements
            : (head?.sourceRequirements ?? []),
        modelPolicy: {
          mode: modelMode,
          ...(modelMode === 'fixed' && catalogModelId.trim()
            ? { catalogModelId: catalogModelId.trim() }
            : {}),
        },
        settingsPatches: head?.settingsPatches ?? {},
        ...(head?.outputContractRef
          ? { outputContractRef: head.outputContractRef }
          : {}),
        ...(head?.quotePolicyRevisionRef
          ? { quotePolicyRevisionRef: head.quotePolicyRevisionRef }
          : {}),
        ...(head?.workflowRevisionRef
          ? { workflowRevisionRef: head.workflowRevisionRef }
          : {}),
        promptRevisionRef: promptRevisionRef.trim(),
        skillRevisionRefs,
        targetWorkspaceKind: lensId,
      },
    });
  };

  /**
   * Build RecipeGovernanceFormInput-shaped payload from structured controls +
   * pass-through governance fields. Never includes studioRelease / passed /
   * hiddenPromptBody / blocks / evalRun (server-only).
   */
  const buildGovernanceFormPayload = (
    normalizedId: string
  ): AdminPayload => {
    const presentation: Record<string, string> = {
      title: title.trim(),
      summary: summary.trim(),
    };
    const actionLabel = head?.presentation.actionLabel?.trim();
    if (actionLabel) presentation.actionLabel = actionLabel;

    const modelPolicy: Record<string, string> = { mode: modelMode };
    if (modelMode === 'fixed' && catalogModelId.trim()) {
      modelPolicy.catalogModelId = catalogModelId.trim();
    }

    const output: Record<string, unknown> = {
      outputKind,
      quantity: delivery.quantity,
      deliverableKind: delivery.deliverableKind,
    };
    if (delivery.aspectRatio?.trim()) {
      output.aspectRatio = delivery.aspectRatio.trim();
    }
    if (typeof delivery.durationSeconds === 'number') {
      output.durationSeconds = delivery.durationSeconds;
    }
    if (typeof delivery.notePageBound === 'number') {
      output.notePageBound = delivery.notePageBound;
    }

    const payload: AdminPayload = {
      recipeId: normalizedId,
      expectedRevision: head?.revision ?? null,
      reason: reason.trim(),
      industryKey: industryKey.trim() || RECIPE_GOVERNANCE_DEFAULTS.industryKey,
      presentation,
      modelPolicy,
      promptRevisionRef: promptRevisionRef.trim(),
      skillRevisionRefs: [...skillRevisionRefs],
      workflowRevisionRef:
        workflowRevisionRef.trim() ||
        RECIPE_GOVERNANCE_DEFAULTS.workflowRevisionRef,
      outputContractRef:
        outputContractRef.trim() || RECIPE_GOVERNANCE_DEFAULTS.outputContractRef,
      quotePolicyRevisionRef:
        quotePolicyRevisionRef.trim() ||
        RECIPE_GOVERNANCE_DEFAULTS.quotePolicyRevisionRef,
      factTypes: [...factTypes],
      sourceRequirements: sourceRequirements.map((item) => ({ ...item })),
      intentTypes: [...intentTypes],
      storySegments: [...storySegments],
      output,
      candidateStrategy,
      platform: {
        contentPackagePlatform: delivery.contentPackagePlatform,
        distributionTarget: delivery.distributionTarget,
      },
    };

    if (head?.familyId?.trim()) {
      payload.familyId = head.familyId.trim();
    }
    if (head?.contextPatches && Object.keys(head.contextPatches).length > 0) {
      payload.contextPatches = structuredClone(head.contextPatches);
    }
    if (head?.settingsPatches && Object.keys(head.settingsPatches).length > 0) {
      payload.settingsPatches = structuredClone(head.settingsPatches);
    }

    return payload;
  };

  const governanceSave = () => {
    const normalizedId = recipeId.trim();
    if (
      !normalizedId ||
      !title.trim() ||
      !summary.trim() ||
      !promptRevisionRef.trim()
    ) {
      setError('请填写 Recipe ID、标题、摘要和 Prompt revision。');
      return;
    }
    if (modelMode === 'fixed' && !catalogModelId.trim()) {
      setError('固定模型策略需要填写 Catalog model ID。');
      return;
    }
    if (!reason.trim()) {
      setError('请填写变更原因。');
      return;
    }
    void execute('recipe_governance_save', buildGovernanceFormPayload(normalizedId));
  };

  const transition = async (action: 'recipe_preview' | 'recipe_publish') => {
    if (!head || !reason.trim()) return;
    await runOperation(async () => {
      if (action === 'recipe_publish' && !(await validate())) return;
      const result = await api.command(
        action,
        {
          recipeId,
          expectedRevision: head.revision,
          reason: reason.trim(),
        },
        idempotencyKey(action, recipeId)
      );
      const record = asRecipeRecord(result);
      setHead(record);
      if (record) {
        hydrate(record);
        await refreshEvidenceStatus(record.recipeId, record.revision);
      }
      await refreshHistory();
      if (
        action === 'recipe_publish' &&
        record?.status === 'published' &&
        record.revisionId
      ) {
        onPublishSuccess?.({
          recipeId: record.recipeId,
          revisionId: record.revisionId,
        });
      }
    });
  };

  const rollback = () => {
    if (!head || !rollbackRevision || !reason.trim()) return;
    void execute('recipe_rollback', {
      recipeId,
      expectedRevision: head.revision,
      targetRevision: Number(rollbackRevision),
      reason: reason.trim(),
    });
  };

  const rollbackOptions = publishedRevisions(history, head?.revision);

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]"
      data-testid="recipe-editor"
    >
      <Frame dense headingLevel={3}>
        <FrameHeader>
          <FrameTitle>Recipe 配置</FrameTitle>
          <FrameDescription>
            用表单编辑用户可见入口，不暴露 Prompt 正文。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="recipe-id">Recipe ID</Label>
              <Input
                id="recipe-id"
                value={recipeId}
                onChange={(event) => setRecipeId(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !recipeId.trim()}
              onClick={() => void load()}
            >
              加载 Recipe
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-lens">创作形式</Label>
            <select
              id="recipe-lens"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={lensId}
              onChange={(event) => {
                const nextLens = event.target.value as CreationLensId;
                setLensId(nextLens);
                setDelivery(defaultRecipeDelivery(nextLens));
              }}
            >
              <option value="copy">文案</option>
              <option value="image_text">图文</option>
              <option value="video">视频</option>
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipe-delivery-platform">交付平台</Label>
              <select
                id="recipe-delivery-platform"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={delivery.contentPackagePlatform}
                onChange={(event) =>
                  setDelivery((current) => ({
                    ...current,
                    contentPackagePlatform: event.target.value,
                  }))
                }
              >
                <option value="xiaohongshu">小红书</option>
                <option value="douyin">抖音</option>
                <option value="video_account">视频号</option>
                <option value="wechat_moments">朋友圈</option>
                <option value="offline_material">线下物料</option>
                <option value="generic">通用</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipe-distribution-target">交付方式</Label>
              <select
                id="recipe-distribution-target"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={delivery.distributionTarget}
                onChange={(event) =>
                  setDelivery((current) => ({
                    ...current,
                    distributionTarget: event.target.value,
                  }))
                }
              >
                <option value="export">导出成品</option>
                <option value="manual_copy">手动复制发布</option>
                <option value="assisted_handoff">辅助交接</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipe-delivery-quantity">成品数量</Label>
              <Input
                id="recipe-delivery-quantity"
                type="number"
                min={1}
                value={delivery.quantity}
                onChange={(event) =>
                  setDelivery((current) => ({
                    ...current,
                    quantity: Number(event.target.value),
                  }))
                }
              />
            </div>
            {lensId !== 'copy' ? (
              <div className="space-y-2">
                <Label htmlFor="recipe-aspect-ratio">画面比例</Label>
                <Input
                  id="recipe-aspect-ratio"
                  value={delivery.aspectRatio ?? ''}
                  onChange={(event) =>
                    setDelivery((current) => ({
                      ...current,
                      aspectRatio: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            {lensId === 'image_text' ? (
              <div className="space-y-2">
                <Label htmlFor="recipe-note-page-bound">图文页数</Label>
                <Input
                  id="recipe-note-page-bound"
                  type="number"
                  min={1}
                  value={delivery.notePageBound ?? 3}
                  onChange={(event) =>
                    setDelivery((current) => ({
                      ...current,
                      notePageBound: Number(event.target.value),
                    }))
                  }
                />
              </div>
            ) : null}
            {lensId === 'video' ? (
              <div className="space-y-2">
                <Label htmlFor="recipe-duration-seconds">视频时长（秒）</Label>
                <Input
                  id="recipe-duration-seconds"
                  type="number"
                  min={1}
                  value={delivery.durationSeconds ?? 15}
                  onChange={(event) =>
                    setDelivery((current) => ({
                      ...current,
                      durationSeconds: Number(event.target.value),
                    }))
                  }
                />
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-title">标题</Label>
            <Input
              id="recipe-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-summary">摘要</Label>
            <Textarea
              id="recipe-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-prompt-revision">Prompt revision</Label>
            <Input
              id="recipe-prompt-revision"
              value={promptRevisionRef}
              onChange={(event) => setPromptRevisionRef(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipe-model-mode">模型策略</Label>
              <select
                id="recipe-model-mode"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={modelMode}
                onChange={(event) =>
                  setModelMode(event.target.value as RecipeModelPolicyMode)
                }
              >
                <option value="auto">自动</option>
                <option value="fixed">固定模型</option>
              </select>
            </div>
            {modelMode === 'fixed' ? (
              <div className="space-y-2">
                <Label htmlFor="recipe-model-id">Catalog model ID</Label>
                <Input
                  id="recipe-model-id"
                  value={catalogModelId}
                  onChange={(event) => setCatalogModelId(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-reason">变更原因</Label>
            <Input
              id="recipe-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={draft}>
              保存 Recipe 草稿
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              data-testid="recipe-governance-save"
              onClick={governanceSave}
            >
              治理保存 Recipe
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy || !head || !['draft', 'preview'].includes(head.status)
              }
              onClick={() => void transition('recipe_preview')}
            >
              生成 Recipe 预览
            </Button>
            <Button
              type="button"
              disabled={busy || head?.status !== 'preview'}
              onClick={() => void transition('recipe_publish')}
            >
              发布 Recipe
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="recipe-rollback">Recipe 回滚版本</Label>
              <select
                id="recipe-rollback"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={rollbackRevision}
                onChange={(event) => setRollbackRevision(event.target.value)}
              >
                <option value="">选择已发布版本</option>
                {rollbackOptions.map((record) => (
                  <option key={record.revision} value={record.revision}>
                    r{record.revision}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !rollbackRevision}
              onClick={rollback}
            >
              回滚 Recipe
            </Button>
          </div>
        </FramePanel>
      </Frame>

      <div className="space-y-4">
        <Frame dense headingLevel={3} data-testid="recipe-visual-preview">
          <FrameHeader>
            <div className="flex items-center justify-between gap-3">
              <FrameTitle>Recipe 可视预览</FrameTitle>
              <Badge
                variant={lifecycleBadgeVariant(head?.status)}
                data-testid="recipe-lifecycle-status"
              >
                {head ? `${head.status} · r${head.revision}` : '未保存'}
              </Badge>
            </div>
            <FrameDescription>{lensLabels[lensId]}入口卡片</FrameDescription>
          </FrameHeader>
          <FramePanel className="space-y-2">
            <p className="font-semibold">{title || '未填写标题'}</p>
            <p className="text-sm text-muted-foreground">
              {summary || '未填写摘要'}
            </p>
            <Button type="button" size="sm" disabled>
              选择{lensLabels[lensId]}并套用
            </Button>
          </FramePanel>
        </Frame>
        {studioRelease?.compilationReceipt ? (
          <Frame dense headingLevel={3} data-testid="recipe-compilation-receipt">
            <FrameHeader>
              <FrameTitle>编译回执</FrameTitle>
              <FrameDescription>
                Server-issued compile/validate receipt (read-only).
              </FrameDescription>
            </FrameHeader>
            <FramePanel className="space-y-1 text-sm">
              <p data-testid="recipe-studio-phase">
                phase: {studioRelease.phase}
              </p>
              <p>
                industry: {studioRelease.compilationReceipt.industryKey}
              </p>
              <p className="break-all">
                receipt: {studioRelease.compilationReceipt.receiptId}
              </p>
              <p className="break-all">
                prompt: {studioRelease.compilationReceipt.promptRevisionRef}
              </p>
              {studioRelease.validation?.passed ? (
                <p data-testid="recipe-validation-passed">validation: passed</p>
              ) : null}
            </FramePanel>
          </Frame>
        ) : null}
        <RecipeEvidencePanel
          status={evidenceStatus}
          busy={busy}
          onRunEvaluation={runEvaluationEvidence}
        />
        <LifecycleHistory history={history} />
      </div>
    </div>
  );
}

function newSurfaceRecipeRef(order: number): SurfaceRecipeRef {
  return {
    recipeRevisionId: '',
    lensId: 'image_text',
    order,
    featured: true,
    visible: true,
  };
}

function groupCandidatesForRecipe(
  groups: RecipePublishedRevisionGroup[],
  recipeId: string
): RecipePublishedRevisionCandidate[] {
  const group = groups.find((entry) => entry.recipeId === recipeId);
  if (!group) return [];
  // Core already sorts revision DESC; re-sort defensively for UI contract.
  return [...group.candidates].sort((a, b) => b.revision - a.revision);
}

function SurfaceEditor({
  api,
  bridgeRequest,
  onLoadedSurfaceIdChange,
}: {
  api: CreationExperienceAdminApi;
  bridgeRequest?: SurfaceBridgeRequest | null;
  onLoadedSurfaceIdChange?: (surfaceId: string) => void;
}) {
  const [surfaceId, setSurfaceId] = useState('');
  const [recipeRefs, setRecipeRefs] = useState<SurfaceRecipeRef[]>([
    newSurfaceRecipeRef(1),
  ]);
  /** Recipe pick for new cards that do not yet have a revisionId. */
  const [draftRecipeIds, setDraftRecipeIds] = useState<Record<number, string>>(
    {}
  );
  const [reason, setReason] = useState('');
  const [head, setHead] = useState<SurfaceRecord | null>(null);
  const [history, setHistory] = useState<SurfaceRecord[]>([]);
  const [rollbackRevision, setRollbackRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refUpdateNotice, setRefUpdateNotice] = useState('');
  const [groups, setGroups] = useState<RecipePublishedRevisionGroup[]>([]);
  const [availableRecipeHeads, setAvailableRecipeHeads] = useState<
    RecipePublishedRevisionCandidate[]
  >([]);
  const [candidatesReady, setCandidatesReady] = useState(false);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const operationInFlight = useRef(false);
  const handledBridgeNonce = useRef<number | null>(null);

  const hydrate = (record: SurfaceRecord) => {
    setRecipeRefs(
      record.recipeRefs.length ? record.recipeRefs : [newSurfaceRecipeRef(1)]
    );
    setDraftRecipeIds({});
  };

  const refreshHistory = async (id = surfaceId) => {
    const result = await api.query('surface_history', { surfaceId: id });
    setHistory(Array.isArray(result) ? (result as SurfaceRecord[]) : []);
  };

  const refreshPublishedCandidates = async (
    id: string,
    extraRecipeIds: string[] = []
  ) => {
    const trimmed = id.trim();
    if (!trimmed) {
      setGroups([]);
      setAvailableRecipeHeads([]);
      setCandidatesReady(false);
      setCandidatesFailed(false);
      return;
    }
    try {
      const result = asPublishedRevisionsResult(
        await api.query('recipe_published_revisions', {
          surfaceId: trimmed,
          recipeIds: extraRecipeIds,
        })
      );
      if (!result) {
        setGroups([]);
        setAvailableRecipeHeads([]);
        setCandidatesReady(false);
        setCandidatesFailed(true);
        return;
      }
      setGroups(result.groups);
      setAvailableRecipeHeads(result.availableRecipeHeads);
      setCandidatesReady(true);
      setCandidatesFailed(false);
    } catch {
      setGroups([]);
      setAvailableRecipeHeads([]);
      setCandidatesReady(false);
      setCandidatesFailed(true);
    }
  };

  const loadSurface = async (
    id: string,
    options?: { pendingRecipeRevisionId?: string }
  ) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setRefUpdateNotice('');
    try {
      const [record, records] = await Promise.all([
        api.query('surface_get', { surfaceId: trimmed }),
        api.query('surface_history', { surfaceId: trimmed }),
      ]);
      const parsed = asSurfaceRecord(record);
      setSurfaceId(trimmed);
      setHead(parsed);
      setHistory(Array.isArray(records) ? (records as SurfaceRecord[]) : []);
      let nextRefs: SurfaceRecipeRef[] = parsed?.recipeRefs.length
        ? parsed.recipeRefs
        : [newSurfaceRecipeRef(1)];
      if (options?.pendingRecipeRevisionId) {
        const applied = applyPendingRecipeRevisionToRefs(
          nextRefs,
          options.pendingRecipeRevisionId
        );
        nextRefs = applied.refs;
        if (applied.matchedCount === 0) {
          setRefUpdateNotice('该 Surface 未引用此 Recipe');
        } else {
          setRefUpdateNotice(
            `已更新 ${applied.matchedCount} 处匹配的 Recipe 引用至 ${options.pendingRecipeRevisionId}`
          );
        }
      }
      setRecipeRefs(nextRefs);
      setDraftRecipeIds({});
      if (parsed) {
        onLoadedSurfaceIdChange?.(trimmed);
      }
      const extraIds = [
        ...nextRefs
          .map((ref) => parseRecipeRevisionId(ref.recipeRevisionId)?.recipeId)
          .filter((value): value is string => Boolean(value)),
        ...(options?.pendingRecipeRevisionId
          ? [
              parseRecipeRevisionId(options.pendingRecipeRevisionId)?.recipeId,
            ].filter((value): value is string => Boolean(value))
          : []),
      ];
      await refreshPublishedCandidates(trimmed, [...new Set(extraIds)]);
    } catch (loadError) {
      setError(messageOf(loadError));
      setCandidatesReady(false);
      setCandidatesFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    await loadSurface(surfaceId);
  };

  useEffect(() => {
    if (!bridgeRequest) return;
    if (handledBridgeNonce.current === bridgeRequest.nonce) return;
    handledBridgeNonce.current = bridgeRequest.nonce;
    void loadSurface(bridgeRequest.surfaceId, {
      pendingRecipeRevisionId: bridgeRequest.pendingRecipeRevisionId,
    });
  }, [bridgeRequest]);

  const runOperation = async (operation: () => Promise<void>) => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (commandError) {
      setError(messageOf(commandError));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const executeCommand = async (action: string, payload: AdminPayload) => {
    const result = await api.command(
      action,
      payload,
      idempotencyKey(action, surfaceId)
    );
    const record = asSurfaceRecord(result);
    setHead(record);
    if (record) {
      hydrate(record);
      onLoadedSurfaceIdChange?.(surfaceId.trim());
    }
    await refreshHistory(surfaceId.trim());
    await refreshPublishedCandidates(
      surfaceId.trim(),
      record?.recipeRefs
        .map((ref) => parseRecipeRevisionId(ref.recipeRevisionId)?.recipeId)
        .filter((value): value is string => Boolean(value)) ?? []
    );
  };

  const execute = (action: string, payload: AdminPayload) =>
    runOperation(() => executeCommand(action, payload));

  const validate = async () => {
    const result = (await api.query('surface_validate', {
      surfaceId,
      ...(head ? { revision: head.revision } : {}),
    })) as CatalogValidationResult;
    if (result.ok) return true;
    setError(result.errors.join('；'));
    return false;
  };

  const updateRef = (index: number, patch: Partial<SurfaceRecipeRef>) => {
    setRecipeRefs((current) =>
      current.map((ref, currentIndex) =>
        currentIndex === index ? { ...ref, ...patch } : ref
      )
    );
  };

  const recipeIdForCard = (ref: SurfaceRecipeRef, index: number): string => {
    const parsed = parseRecipeRevisionId(ref.recipeRevisionId);
    if (parsed) return parsed.recipeId;
    return draftRecipeIds[index] ?? '';
  };

  const candidatesForCard = (
    ref: SurfaceRecipeRef,
    index: number
  ): RecipePublishedRevisionCandidate[] => {
    const recipeId = recipeIdForCard(ref, index);
    if (!recipeId) return [];
    return groupCandidatesForRecipe(groups, recipeId);
  };

  const cardBlocksSave = (ref: SurfaceRecipeRef, index: number): boolean => {
    if (!candidatesReady || candidatesFailed) return true;
    const recipeId = recipeIdForCard(ref, index);
    if (!recipeId) return true;
    const candidates = candidatesForCard(ref, index);
    if (candidates.length === 0) return true;
    if (!ref.recipeRevisionId.trim()) return true;
    return !candidates.some(
      (candidate) => candidate.revisionId === ref.recipeRevisionId
    );
  };

  const anyCardBlocksSave = recipeRefs.some((ref, index) =>
    cardBlocksSave(ref, index)
  );

  const selectRecipeForNewCard = async (index: number, recipeId: string) => {
    setDraftRecipeIds((current) => ({ ...current, [index]: recipeId }));
    const headCandidate = availableRecipeHeads.find(
      (entry) => entry.recipeId === recipeId
    );
    updateRef(index, {
      recipeRevisionId: '',
      ...(headCandidate ? { lensId: headCandidate.lensId } : {}),
    });
    if (surfaceId.trim()) {
      await refreshPublishedCandidates(surfaceId.trim(), [recipeId]);
    }
  };

  const selectRevisionForCard = (
    index: number,
    revisionId: string,
    candidates: RecipePublishedRevisionCandidate[]
  ) => {
    const candidate = candidates.find(
      (entry) => entry.revisionId === revisionId
    );
    updateRef(index, {
      recipeRevisionId: revisionId,
      ...(candidate ? { lensId: candidate.lensId } : {}),
    });
  };

  const draft = () => {
    const refs = recipeRefs
      .filter((ref) => ref.recipeRevisionId.trim())
      .map((ref) => ({
        ...ref,
        recipeRevisionId: ref.recipeRevisionId.trim(),
      }));
    if (!surfaceId.trim() || refs.length === 0) {
      setError('请填写 Surface ID，并至少添加一个 Recipe revision。');
      return;
    }
    if (!reason.trim()) {
      setError('请填写变更原因。');
      return;
    }
    if (candidatesFailed || !candidatesReady) {
      setError('已发布版本候选不可用，无法保存该卡。');
      return;
    }
    if (anyCardBlocksSave) {
      setError('存在未选择已发布版本的 Recipe 卡，无法保存。');
      return;
    }
    void execute('surface_draft', {
      surfaceId: surfaceId.trim(),
      expectedRevision: head?.revision ?? null,
      reason: reason.trim(),
      body: {
        recipeRefs: refs,
      },
    });
  };

  const transition = async (action: 'surface_preview' | 'surface_publish') => {
    if (!head || !reason.trim()) return;
    await runOperation(async () => {
      if (action === 'surface_publish' && !(await validate())) return;
      await executeCommand(action, {
        surfaceId,
        expectedRevision: head.revision,
        reason: reason.trim(),
      });
    });
  };

  const rollback = () => {
    if (!head || !rollbackRevision || !reason.trim()) return;
    void execute('surface_rollback', {
      surfaceId,
      expectedRevision: head.revision,
      targetRevision: Number(rollbackRevision),
      reason: reason.trim(),
    });
  };

  const rollbackOptions = publishedRevisions(history, head?.revision);
  const draftDisabled = busy || anyCardBlocksSave || candidatesFailed;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]"
      data-testid="surface-editor"
    >
      <Frame dense headingLevel={3}>
        <FrameHeader>
          <FrameTitle>Surface 编排</FrameTitle>
          <FrameDescription>
            按顺序编排已发布 Recipe；版本仅能从已发布候选中选择。
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="surface-id">Surface ID</Label>
              <Input
                id="surface-id"
                value={surfaceId}
                onChange={(event) => setSurfaceId(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !surfaceId.trim()}
              onClick={() => void load()}
            >
              加载 Surface
            </Button>
          </div>
          {refUpdateNotice ? (
            <p
              role="status"
              data-testid="surface-ref-update-notice"
              className="text-sm text-muted-foreground"
            >
              {refUpdateNotice}
            </p>
          ) : null}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Recipe 卡片</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setRecipeRefs((current) => [
                    ...current,
                    newSurfaceRecipeRef(current.length + 1),
                  ])
                }
              >
                添加 Recipe
              </Button>
            </div>
            {recipeRefs.map((ref, index) => {
              const recipeId = recipeIdForCard(ref, index);
              const candidates = candidatesForCard(ref, index);
              const isNewCard = !parseRecipeRevisionId(ref.recipeRevisionId);
              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-input p-3 sm:grid-cols-2"
                  data-testid={`surface-recipe-card-${index}`}
                >
                  {isNewCard ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor={`surface-recipe-pick-${index}`}>
                        Recipe
                      </Label>
                      <select
                        id={`surface-recipe-pick-${index}`}
                        data-testid={`surface-recipe-pick-${index}`}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={recipeId}
                        onChange={(event) =>
                          void selectRecipeForNewCard(index, event.target.value)
                        }
                      >
                        <option value="">选择已发布 Recipe</option>
                        {availableRecipeHeads.map((headCandidate) => (
                          <option
                            key={headCandidate.recipeId}
                            value={headCandidate.recipeId}
                          >
                            {headCandidate.title} ({headCandidate.recipeId})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1 sm:col-span-2">
                      <p className="text-sm font-medium">{recipeId}</p>
                    </div>
                  )}
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor={`surface-recipe-revision-${index}`}>
                      Recipe 版本
                    </Label>
                    <select
                      id={`surface-recipe-revision-${index}`}
                      data-testid={`surface-recipe-revision-${index}`}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={ref.recipeRevisionId}
                      disabled={!recipeId || candidates.length === 0}
                      onChange={(event) =>
                        selectRevisionForCard(
                          index,
                          event.target.value,
                          candidates
                        )
                      }
                    >
                      <option value="">
                        {candidates.length === 0
                          ? '暂无已发布版本'
                          : '选择已发布版本'}
                      </option>
                      {candidates.map((candidate) => (
                        <option
                          key={candidate.revisionId}
                          value={candidate.revisionId}
                        >
                          r{candidate.revision} · {candidate.title} (
                          {candidate.revisionId})
                        </option>
                      ))}
                    </select>
                    {recipeId && candidates.length === 0 ? (
                      <p
                        className="text-sm text-muted-foreground"
                        data-testid={`surface-recipe-empty-${index}`}
                      >
                        暂无已发布版本
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`surface-recipe-lens-${index}`}>
                      创作形式
                    </Label>
                    <select
                      id={`surface-recipe-lens-${index}`}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={ref.lensId}
                      onChange={(event) =>
                        updateRef(index, {
                          lensId: event.target.value as CreationLensId,
                        })
                      }
                    >
                      <option value="copy">文案</option>
                      <option value="image_text">图文</option>
                      <option value="video">视频</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`surface-recipe-order-${index}`}>顺序</Label>
                    <Input
                      id={`surface-recipe-order-${index}`}
                      type="number"
                      value={ref.order}
                      onChange={(event) =>
                        updateRef(index, { order: Number(event.target.value) })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ref.featured}
                      onChange={(event) =>
                        updateRef(index, { featured: event.target.checked })
                      }
                    />
                    首页推荐
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ref.visible}
                      onChange={(event) =>
                        updateRef(index, { visible: event.target.checked })
                      }
                    />
                    可见
                  </label>
                  {recipeRefs.length > 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRecipeRefs((current) =>
                          current.filter(
                            (_, currentIndex) => currentIndex !== index
                          )
                        );
                        setDraftRecipeIds((current) => {
                          const next: Record<number, string> = {};
                          for (const [key, value] of Object.entries(current)) {
                            const cardIndex = Number(key);
                            if (cardIndex === index) continue;
                            next[cardIndex > index ? cardIndex - 1 : cardIndex] =
                              value;
                          }
                          return next;
                        });
                      }}
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="space-y-2">
            <Label htmlFor="surface-reason">变更原因</Label>
            <Input
              id="surface-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={draftDisabled}
              data-testid="surface-draft-button"
              onClick={draft}
            >
              保存 Surface 草稿
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                busy || !head || !['draft', 'preview'].includes(head.status)
              }
              onClick={() => void transition('surface_preview')}
            >
              生成 Surface 预览
            </Button>
            <Button
              type="button"
              disabled={busy || head?.status !== 'preview'}
              onClick={() => void transition('surface_publish')}
            >
              发布 Surface
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="surface-rollback">Surface 回滚版本</Label>
              <select
                id="surface-rollback"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={rollbackRevision}
                onChange={(event) => setRollbackRevision(event.target.value)}
              >
                <option value="">选择已发布版本</option>
                {rollbackOptions.map((record) => (
                  <option key={record.revision} value={record.revision}>
                    r{record.revision}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !rollbackRevision}
              onClick={rollback}
            >
              回滚 Surface
            </Button>
          </div>
        </FramePanel>
      </Frame>

      <div className="space-y-4">
        <Frame dense headingLevel={3} data-testid="surface-visual-preview">
          <FrameHeader>
            <div className="flex items-center justify-between gap-3">
              <FrameTitle>Surface 可视预览</FrameTitle>
              <Badge
                variant={lifecycleBadgeVariant(head?.status)}
                data-testid="surface-lifecycle-status"
              >
                {head ? `${head.status} · r${head.revision}` : '未保存'}
              </Badge>
            </div>
            <FrameDescription>
              {surfaceId || '未填写 Surface ID'}
            </FrameDescription>
          </FrameHeader>
          <FramePanel className="space-y-3">
            {recipeRefs
              .filter((ref) => ref.visible)
              .map((ref, index) => (
                <div
                  key={`${ref.recipeRevisionId}-${index}`}
                  className="rounded-xl border border-input p-3"
                >
                  <p className="font-medium">
                    {ref.recipeRevisionId || '未填写 Recipe revision'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {lensLabels[ref.lensId]} · 顺序 {ref.order}
                    {ref.featured ? ' · 推荐' : ''}
                  </p>
                </div>
              ))}
          </FramePanel>
        </Frame>
        <LifecycleHistory history={history} />
      </div>
    </div>
  );
}

export function AdminCreationExperienceControl({
  api = defaultApi,
}: {
  api?: CreationExperienceAdminApi;
}) {
  const [tab, setTab] = useState('recipe');
  const [loadedSurfaceId, setLoadedSurfaceId] = useState('');
  const [publishSuccess, setPublishSuccess] =
    useState<RecipePublishSuccess | null>(null);
  const [targetSurfaceId, setTargetSurfaceId] = useState('');
  const [bridgeRequest, setBridgeRequest] =
    useState<SurfaceBridgeRequest | null>(null);

  const handlePublishSuccess = (success: RecipePublishSuccess) => {
    setPublishSuccess(success);
    setTargetSurfaceId((current) => current || loadedSurfaceId);
  };

  const handleUpdateSurfaceRefs = () => {
    if (!publishSuccess || !targetSurfaceId.trim()) return;
    // Same-page only — no route navigation (Spec D5 / #376).
    setTab('surface');
    setBridgeRequest({
      nonce: Date.now(),
      surfaceId: targetSurfaceId.trim(),
      pendingRecipeRevisionId: publishSuccess.revisionId,
    });
  };

  return (
    <Frame data-testid="creation-experience-control">
      <FrameHeader>
        <FrameTitle>创作入口 Recipe / Surface</FrameTitle>
        <FrameDescription>
          完成草稿、预览、发布与回滚；发布后只影响新的创作会话。
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="space-y-4">
        {publishSuccess ? (
          <Frame
            dense
            headingLevel={3}
            data-testid="recipe-publish-success-panel"
          >
            <FrameHeader>
              <FrameTitle>Recipe 发布成功</FrameTitle>
              <FrameDescription>
                前台仍引用旧 revision，直到你更新并发布目标 Surface。
              </FrameDescription>
            </FrameHeader>
            <FramePanel className="space-y-3">
              <p className="text-sm" data-testid="recipe-publish-success-revision">
                已发布版本：{publishSuccess.revisionId}
              </p>
              <div className="space-y-2">
                <Label htmlFor="publish-success-surface-id">目标 Surface ID</Label>
                <Input
                  id="publish-success-surface-id"
                  data-testid="publish-success-surface-id"
                  value={targetSurfaceId}
                  onChange={(event) => setTargetSurfaceId(event.target.value)}
                  placeholder={
                    loadedSurfaceId
                      ? loadedSurfaceId
                      : '填写要更新引用的 Surface ID'
                  }
                />
              </div>
              <Button
                type="button"
                data-testid="update-surface-refs-button"
                disabled={!targetSurfaceId.trim()}
                onClick={handleUpdateSurfaceRefs}
              >
                更新 Surface 引用
              </Button>
            </FramePanel>
          </Frame>
        ) : null}
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (typeof value === 'string') setTab(value);
          }}
        >
          <TabsList aria-label="创作入口编辑器">
            <TabsTrigger value="recipe">Recipe 编辑</TabsTrigger>
            <TabsTrigger value="surface">Surface 编辑</TabsTrigger>
          </TabsList>
          <TabsContent value="recipe" className="pt-4">
            <RecipeEditor api={api} onPublishSuccess={handlePublishSuccess} />
          </TabsContent>
          <TabsContent value="surface" className="pt-4">
            <SurfaceEditor
              api={api}
              bridgeRequest={bridgeRequest}
              onLoadedSurfaceIdChange={(id) => {
                setLoadedSurfaceId(id);
                setTargetSurfaceId((current) => current || id);
              }}
            />
          </TabsContent>
        </Tabs>
      </FramePanel>
    </Frame>
  );
}
