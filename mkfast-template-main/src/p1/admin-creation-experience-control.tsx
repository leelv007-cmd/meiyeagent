import type {
  CatalogArtifactStatus,
  CatalogValidationResult,
  CreationLensId,
  RecipeModelPolicyMode,
  SurfaceRecipeRef,
} from '@meiye/contracts';
import { useRef, useState } from 'react';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
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

const defaultApi: CreationExperienceAdminApi = {
  query: (action, payload) =>
    queryP1('creation-experience', { action, payload }),
  command: (action, payload, idempotencyKey) =>
    commandP1('creation-experience', { action, payload }, idempotencyKey),
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
  sourceRequirements?: Array<Record<string, unknown>>;
  modelPolicy: { mode: RecipeModelPolicyMode; catalogModelId?: string };
  settingsPatches?: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  targetWorkspaceKind: CreationLensId;
  rolledBackToRevision?: number | null;
};

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
  toolEntryRefs: Array<{
    toolEntryId: string;
    order: number;
    visible: boolean;
  }>;
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

function publishedRevisions<T extends { revision: number; status: string }>(
  history: T[],
  currentRevision?: number
) {
  return history.filter(
    (item) => item.status === 'published' && item.revision !== currentRevision
  );
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
    <div className="space-y-2">
      <h4 className="text-sm font-medium">版本历史</h4>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚无版本。</p>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2">
          {[...history].reverse().map((item) => (
            <li
              key={`${item.revision}-${item.status}`}
              className="rounded-lg border border-input px-3 py-2 text-sm"
            >
              r{item.revision} · {item.status}
              {item.rolledBackToRevision
                ? ` · 回滚自 r${item.rolledBackToRevision}`
                : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RecipeEditor({ api }: { api: CreationExperienceAdminApi }) {
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
  const [head, setHead] = useState<RecipeRecord | null>(null);
  const [history, setHistory] = useState<RecipeRecord[]>([]);
  const [rollbackRevision, setRollbackRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operationInFlight = useRef(false);

  const hydrate = (record: RecipeRecord) => {
    setLensId(record.lensId);
    setTitle(record.presentation.title);
    setSummary(record.presentation.summary);
    setPromptRevisionRef(record.promptRevisionRef);
    setModelMode(record.modelPolicy.mode);
    setCatalogModelId(record.modelPolicy.catalogModelId ?? '');
    setDelivery({
      ...defaultRecipeDelivery(record.lensId),
      ...(record.delivery as Partial<RecipeDelivery>),
    });
  };

  const refreshHistory = async () => {
    const result = await api.query('recipe_history', { recipeId });
    setHistory(Array.isArray(result) ? (result as RecipeRecord[]) : []);
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
      if (parsed) hydrate(parsed);
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
    if (record) hydrate(record);
    await refreshHistory();
  };

  const execute = (action: string, payload: AdminPayload) =>
    runOperation(() => executeCommand(action, payload));

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
        sourceRequirements: head?.sourceRequirements ?? [],
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
        targetWorkspaceKind: lensId,
      },
    });
  };

  const transition = async (action: 'recipe_preview' | 'recipe_publish') => {
    if (!head || !reason.trim()) return;
    await runOperation(async () => {
      if (action === 'recipe_publish' && !(await validate())) return;
      await executeCommand(action, {
        recipeId,
        expectedRevision: head.revision,
        reason: reason.trim(),
      });
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
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>Recipe 配置</AdminPanelTitle>
          <AdminPanelDescription>
            用表单编辑用户可见入口，不暴露 Prompt 正文。
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
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
        </AdminPanelContent>
      </AdminPanel>

      <div className="space-y-4">
        <AdminPanel data-testid="recipe-visual-preview">
          <AdminPanelHeader>
            <div className="flex items-center justify-between gap-3">
              <AdminPanelTitle>Recipe 可视预览</AdminPanelTitle>
              <AdminStatusChip
                variant="outline"
                data-testid="recipe-lifecycle-status"
              >
                {head ? `${head.status} · r${head.revision}` : '未保存'}
              </AdminStatusChip>
            </div>
            <AdminPanelDescription>
              {lensLabels[lensId]}入口卡片
            </AdminPanelDescription>
          </AdminPanelHeader>
          <AdminPanelContent className="space-y-2">
            <h3 className="font-semibold">{title || '未填写标题'}</h3>
            <p className="text-sm text-muted-foreground">
              {summary || '未填写摘要'}
            </p>
            <Button type="button" size="sm" disabled>
              选择{lensLabels[lensId]}并套用
            </Button>
          </AdminPanelContent>
        </AdminPanel>
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

function SurfaceEditor({ api }: { api: CreationExperienceAdminApi }) {
  const [surfaceId, setSurfaceId] = useState('');
  const [recipeRefs, setRecipeRefs] = useState<SurfaceRecipeRef[]>([
    newSurfaceRecipeRef(1),
  ]);
  const [reason, setReason] = useState('');
  const [head, setHead] = useState<SurfaceRecord | null>(null);
  const [history, setHistory] = useState<SurfaceRecord[]>([]);
  const [rollbackRevision, setRollbackRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operationInFlight = useRef(false);

  const hydrate = (record: SurfaceRecord) => {
    setRecipeRefs(
      record.recipeRefs.length ? record.recipeRefs : [newSurfaceRecipeRef(1)]
    );
  };

  const refreshHistory = async () => {
    const result = await api.query('surface_history', { surfaceId });
    setHistory(Array.isArray(result) ? (result as SurfaceRecord[]) : []);
  };

  const load = async () => {
    if (!surfaceId.trim()) return;
    setBusy(true);
    setError('');
    try {
      const [record, records] = await Promise.all([
        api.query('surface_get', { surfaceId: surfaceId.trim() }),
        api.query('surface_history', { surfaceId: surfaceId.trim() }),
      ]);
      const parsed = asSurfaceRecord(record);
      setHead(parsed);
      setHistory(Array.isArray(records) ? (records as SurfaceRecord[]) : []);
      if (parsed) hydrate(parsed);
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
      idempotencyKey(action, surfaceId)
    );
    const record = asSurfaceRecord(result);
    setHead(record);
    if (record) hydrate(record);
    await refreshHistory();
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
    void execute('surface_draft', {
      surfaceId: surfaceId.trim(),
      expectedRevision: head?.revision ?? null,
      reason: reason.trim(),
      body: {
        recipeRefs: refs,
        toolEntryRefs: [],
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

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]"
      data-testid="surface-editor"
    >
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>Surface 编排</AdminPanelTitle>
          <AdminPanelDescription>
            按顺序编排已发布 Recipe；工具区只提供通过能力验收的入口。
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
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
            {recipeRefs.map((ref, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-xl border border-input p-3 sm:grid-cols-2"
              >
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`surface-recipe-revision-${index}`}>
                    Recipe revision ID
                  </Label>
                  <Input
                    id={`surface-recipe-revision-${index}`}
                    value={ref.recipeRevisionId}
                    onChange={(event) =>
                      updateRef(index, { recipeRevisionId: event.target.value })
                    }
                  />
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
                    onClick={() =>
                      setRecipeRefs((current) =>
                        current.filter(
                          (_, currentIndex) => currentIndex !== index
                        )
                      )
                    }
                  >
                    移除
                  </Button>
                ) : null}
              </div>
            ))}
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
            <Button type="button" disabled={busy} onClick={draft}>
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
        </AdminPanelContent>
      </AdminPanel>

      <div className="space-y-4">
        <AdminPanel data-testid="surface-visual-preview">
          <AdminPanelHeader>
            <div className="flex items-center justify-between gap-3">
              <AdminPanelTitle>Surface 可视预览</AdminPanelTitle>
              <AdminStatusChip
                variant="outline"
                data-testid="surface-lifecycle-status"
              >
                {head ? `${head.status} · r${head.revision}` : '未保存'}
              </AdminStatusChip>
            </div>
            <AdminPanelDescription>
              {surfaceId || '未填写 Surface ID'}
            </AdminPanelDescription>
          </AdminPanelHeader>
          <AdminPanelContent className="space-y-3">
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
          </AdminPanelContent>
        </AdminPanel>
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
  return (
    <AdminPanel>
      <AdminPanelHeader>
        <AdminPanelTitle>创作入口 Recipe / Surface</AdminPanelTitle>
        <AdminPanelDescription>
          完成草稿、预览、发布与回滚；发布后只影响新的创作会话。
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent>
        <Tabs defaultValue="recipe">
          <TabsList aria-label="创作入口编辑器">
            <TabsTrigger value="recipe">Recipe 编辑</TabsTrigger>
            <TabsTrigger value="surface">Surface 编辑</TabsTrigger>
          </TabsList>
          <TabsContent value="recipe" className="pt-4">
            <RecipeEditor api={api} />
          </TabsContent>
          <TabsContent value="surface" className="pt-4">
            <SurfaceEditor api={api} />
          </TabsContent>
        </Tabs>
      </AdminPanelContent>
    </AdminPanel>
  );
}
