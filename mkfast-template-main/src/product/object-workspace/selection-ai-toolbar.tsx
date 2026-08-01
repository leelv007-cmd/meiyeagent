/**
 * Selection AI toolbar — six actions (P2-10 / #322).
 */

import { Button } from '@/components/ui/button';
import { useState } from 'react';

import {
  SELECTION_AI_LABELS,
  selectionAiNeedsInstruction,
  selectionAiToolbarItems,
  type SelectionAiAction,
} from './selection-ai-model';

export type SelectionAiToolbarProps = {
  onAction: (
    action: SelectionAiAction,
    instruction?: string
  ) => void | Promise<void>;
  disabled?: boolean;
  /** Scope hint already resolved by the parent (selection vs whole doc). */
  scopeHint?: string;
  scopeKind?: 'selection' | 'whole_document';
};

export function SelectionAiToolbar(props: SelectionAiToolbarProps) {
  const [pendingAction, setPendingAction] = useState<SelectionAiAction | null>(
    null
  );
  const [instruction, setInstruction] = useState('');
  const [busyAction, setBusyAction] = useState<SelectionAiAction | null>(null);
  const [error, setError] = useState<string | undefined>();

  const submit = async (
    action: SelectionAiAction,
    actionInstruction?: string
  ) => {
    if (busyAction) return false;
    setBusyAction(action);
    setError(undefined);
    try {
      await (actionInstruction === undefined
        ? props.onAction(action)
        : props.onAction(action, actionInstruction));
      return true;
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : '暂时无法提交调整，请重试。'
      );
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const run = async (action: SelectionAiAction) => {
    if (selectionAiNeedsInstruction(action)) {
      setPendingAction(action);
      setInstruction('');
      setError(undefined);
      return;
    }
    await submit(action);
  };

  const confirmInstruction = async () => {
    if (!pendingAction) return;
    const submitted = await submit(
      pendingAction,
      instruction.trim() || undefined
    );
    if (!submitted) return;
    setPendingAction(null);
    setInstruction('');
  };

  return (
    <section
      className="space-y-2 rounded-lg border p-4"
      data-testid="object-workspace-selection-ai"
      data-rewrite-scope={props.scopeKind}
    >
      <h3 className="text-sm font-medium">选区 AI</h3>
      {props.scopeHint ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="object-workspace-selection-ai-scope"
        >
          {props.scopeHint}
        </p>
      ) : null}
      <div
        className="flex flex-wrap gap-2"
        data-testid="object-workspace-selection-ai-actions"
        role="toolbar"
        aria-label="选区 AI 六动作"
      >
        {selectionAiToolbarItems().map((item) => (
          <Button
            key={item.action}
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || busyAction !== null}
            data-testid={`selection-ai-${item.action}`}
            data-selection-ai-action={item.action}
            onClick={() => void run(item.action)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {pendingAction ? (
        <div
          className="space-y-2 rounded-md border p-3"
          data-testid="object-workspace-selection-ai-instruction"
          data-pending-action={pendingAction}
        >
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">
              {pendingAction === 'tone'
                ? '想要的语气（例如：专业温和 / 闺蜜分享）'
                : '自定义要求'}
            </span>
            <input
              className="w-full rounded-md border bg-background px-3 py-2"
              data-testid="selection-ai-instruction-input"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={
                pendingAction === 'tone'
                  ? '专业温和的美容顾问口吻'
                  : '例如：更口语、少用感叹号'
              }
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="selection-ai-instruction-confirm"
              disabled={busyAction !== null}
              onClick={() => void confirmInstruction()}
            >
              {busyAction === pendingAction ? '准备中…' : '准备调整'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="selection-ai-instruction-cancel"
              onClick={() => {
                setPendingAction(null);
                setInstruction('');
              }}
            >
              取消
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            当前动作：{SELECTION_AI_LABELS[pendingAction]}
          </p>
        </div>
      ) : null}
      {error ? (
        <p
          className="text-sm text-destructive"
          data-testid="selection-ai-submit-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
