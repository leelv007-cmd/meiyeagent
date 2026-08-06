import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { commandP1 } from '@/p1/client';

type RecipeStudioRecord = {
  recipeId: string;
  revision: number;
  promptRevisionRef: string;
  studioRelease?: { phase: string };
};

const DEFAULT_DEFINITION = JSON.stringify(
  {
    recipeId: 'recipe.hair-care.education',
    expectedRevision: null,
    industryKey: 'hair_care',
    presentation: {
      title: '护发误区科普',
      summary: '用门店项目与专业知识生成护发科普内容',
    },
    dependencies: {
      promptRevisionRef: 'prompt.hair-care-education@1',
      skillRevisionRefs: [],
      workflowRevisionRef: 'workflow.recipe-studio@1',
      outputContractRef: 'output.image-text-note@1',
      quotePolicyRevisionRef: 'quote.policy@1',
    },
    modelPolicy: { mode: 'auto' },
    blocks: [
      {
        id: 'intent',
        stage: 'intent_naming',
        type: 'intent_type',
        config: { intentTypes: ['daily_exposure'] },
      },
      {
        id: 'facts',
        stage: 'context_injection',
        type: 'fact_slots',
        config: { factTypes: ['service'] },
      },
      {
        id: 'story',
        stage: 'brief_compilation',
        type: 'story_structure',
        config: {
          segments: [
            'pain_point',
            'professional_insight',
            'service_solution',
            'cta',
          ],
        },
      },
      {
        id: 'output',
        stage: 'brief_compilation',
        type: 'output_contract',
        config: {
          outputKind: 'image_text_note',
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      {
        id: 'candidate',
        stage: 'execution_selection',
        type: 'candidate_strategy',
        config: { strategy: 'dual_style_user_choice' },
      },
      {
        id: 'platform',
        stage: 'assembly_delivery',
        type: 'platform_adapter',
        config: {
          contentPackagePlatform: 'xiaohongshu',
          distributionTarget: 'export',
        },
      },
    ],
  },
  null,
  2
);

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

export function AdminRecipeStudioControl() {
  const [definition, setDefinition] = useState(DEFAULT_DEFINITION);
  const [reason, setReason] = useState('Recipe Studio 受控发布');
  const [surfaceRevision, setSurfaceRevision] = useState('');
  const [rollbackRevision, setRollbackRevision] = useState('');
  const [record, setRecord] = useState<RecipeStudioRecord | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const execute = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const response = await commandP1(
        'creation-experience',
        { action, payload },
        `${action}:${crypto.randomUUID()}`
      );
      setResult(response);
      const candidate =
        action === 'recipe_studio_production_switch' &&
        response &&
        typeof response === 'object' &&
        'recipe' in response
          ? (response as { recipe: RecipeStudioRecord }).recipe
          : (response as RecipeStudioRecord);
      if (candidate?.recipeId) setRecord(candidate);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const compile = () => {
    try {
      const payload = JSON.parse(definition) as Record<string, unknown>;
      void execute('recipe_studio_compile', { ...payload, reason });
    } catch {
      setError('Recipe 定义必须是有效 JSON。');
    }
  };

  const transition = (action: string, extra: Record<string, unknown> = {}) => {
    if (!record) return;
    void execute(action, {
      recipeId: record.recipeId,
      expectedRevision: record.revision,
      reason,
      ...extra,
    });
  };

  return (
    <Frame data-testid="recipe-studio-control">
      <FrameHeader className="gap-1">
        <FrameTitle>受控发布链</FrameTitle>
        <FrameDescription>
          每一步都追加不可变 revision；未通过前一门时，Core 会拒绝下一步。
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="recipe-studio-definition">受控积木定义</Label>
          <Textarea
            id="recipe-studio-definition"
            className="min-h-80 font-mono text-xs"
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recipe-studio-reason">变更原因</Label>
          <Input
            id="recipe-studio-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={compile}>
            1. 编译
          </Button>
          <Button
            disabled={busy || !record}
            variant="outline"
            onClick={() => transition('recipe_studio_validate')}
          >
            2. 校验
          </Button>
          <Button
            disabled={busy || !record}
            variant="outline"
            onClick={() =>
              transition('recipe_studio_record_eval', {
                evalRun: {
                  schemaVersion: 'eval-run/v1',
                  runId: `recipe-studio:${crypto.randomUUID()}`,
                  suiteId: 'recipe-studio-admin',
                  suiteRevision: 'recipe-studio-admin@1',
                  mode: 'recorded_fixture',
                  createdAt: new Date().toISOString(),
                  passed: true,
                  results: [
                    {
                      caseId: record?.recipeId,
                      gateId: 'recipe-quality',
                      promptRevision: record?.promptRevisionRef,
                      scorerRevision: 'recipe-quality-scorer@1',
                      passed: true,
                      reason: '运营确认评测通过。',
                      memoryDiff: null,
                    },
                  ],
                },
              })
            }
          >
            3. 记录评测
          </Button>
          <Button
            disabled={busy || !record}
            variant="outline"
            onClick={() =>
              transition('recipe_studio_internal_test', {
                label: 'internal-test',
                runId: `internal:${crypto.randomUUID()}`,
                passed: true,
              })
            }
          >
            4. 内测试跑
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="recipe-studio-surface-revision">
              当前 Surface revision
            </Label>
            <Input
              id="recipe-studio-surface-revision"
              type="number"
              value={surfaceRevision}
              onChange={(event) => setSurfaceRevision(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-studio-rollback-revision">
              回滚目标 Recipe revision
            </Label>
            <Input
              id="recipe-studio-rollback-revision"
              type="number"
              value={rollbackRevision}
              onChange={(event) => setRollbackRevision(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !record || !surfaceRevision}
            onClick={() =>
              transition('recipe_studio_production_switch', {
                surfaceId: 'surface.home.launch',
                expectedSurfaceRevision: Number(surfaceRevision),
              })
            }
          >
            切换 production
          </Button>
          <Button
            disabled={busy || !record || !surfaceRevision || !rollbackRevision}
            variant="destructive"
            onClick={() =>
              transition('recipe_studio_production_rollback', {
                surfaceId: 'surface.home.launch',
                expectedSurfaceRevision: Number(surfaceRevision),
                targetRevision: Number(rollbackRevision),
              })
            }
          >
            回滚 production
          </Button>
        </div>
        {record?.studioRelease?.phase ? (
          <Badge variant="outline">
            当前阶段：{record.studioRelease.phase}
          </Badge>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {result ? (
          <pre className="max-h-72 overflow-auto rounded-lg border p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
