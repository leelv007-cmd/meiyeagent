import { useState } from 'react';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { commandP1 } from '@/p1/client';

const ACTION_TEMPLATES = {
  skill_define: {
    skillId: 'skill.beauty-story',
    name: '美业故事结构',
    presentationPolicy: 'explainable',
  },
  skill_accept: {
    skillRevisionRef: 'skill.beauty-story@1',
    evalRun: {},
  },
  skill_bind: {
    bindingId: 'binding.beauty-story.intent',
    workflowRevisionRef: 'workflow.copy@1',
    stage: 'intent_naming',
    skillRevisionRef: 'skill.beauty-story@1',
    mode: 'required',
  },
  skill_rollback: {
    bindingId: 'binding.beauty-story.rollback',
    sourceBindingId: 'binding.beauty-story.intent',
    targetSkillRevisionRef: 'skill.beauty-story@1',
    workflowRevisionRef: 'workflow.copy@1',
  },
} as const;

type SkillAction = keyof typeof ACTION_TEMPLATES;

export function AdminSkillsControl() {
  const [action, setAction] = useState<SkillAction>('skill_define');
  const [payload, setPayload] = useState(
    JSON.stringify(ACTION_TEMPLATES.skill_define, null, 2)
  );
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const chooseAction = (next: SkillAction) => {
    setAction(next);
    setPayload(JSON.stringify(ACTION_TEMPLATES[next], null, 2));
    setError('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      setResult(
        await commandP1(
          'skills',
          { action, payload: parsed },
          `${action}:${crypto.randomUUID()}`
        )
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Skill 操作失败，请重试。'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel data-testid="admin-skills-control">
      <AdminPanelHeader>
        <AdminPanelTitle>Skill 受理与绑定</AdminPanelTitle>
        <AdminPanelDescription>
          所有操作都走 Core Skills command seam；版本引用必须精确，不能使用
          latest。
        </AdminPanelDescription>
      </AdminPanelHeader>
      <AdminPanelContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="skills-action">操作</Label>
          <select
            id="skills-action"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={action}
            onChange={(event) =>
              chooseAction(event.target.value as SkillAction)
            }
          >
            <option value="skill_define">定义 Skill</option>
            <option value="skill_accept">受理并冻结</option>
            <option value="skill_bind">绑定 Workflow 阶段</option>
            <option value="skill_rollback">回滚绑定</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="skills-payload">命令 payload</Label>
          <Textarea
            id="skills-payload"
            className="min-h-64 font-mono text-xs"
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
          />
        </div>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? '提交中…' : '提交受控命令'}
        </Button>
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
      </AdminPanelContent>
    </AdminPanel>
  );
}
