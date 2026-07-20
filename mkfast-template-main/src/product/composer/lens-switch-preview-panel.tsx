import { Button } from '@/components/ui/button';

import {
  cancelSwitch,
  confirmSwitch,
  undoChange,
  type ComposerLensState,
} from './lens-state-machine';

export function LensSwitchPreviewPanel({
  state,
  onChange,
}: {
  state: ComposerLensState;
  onChange: (state: ComposerLensState) => void;
}) {
  if (state.phase === 'switch_preview') {
    return (
      <section
        className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"
        data-testid="composer-lens-switch-preview"
      >
        <div>
          <h3 className="text-sm font-medium">确认创作类型切换</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            已输入的文案与素材会保留；当前模型、参数和报价会按新类型重新计算。
          </p>
        </div>
        <dl className="grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">保留</dt>
            <dd>{state.preview.preserve.join('、') || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">暂存</dt>
            <dd>{state.preview.stash.join('、') || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">改变</dt>
            <dd>{state.preview.change.join('、') || '—'}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            data-testid="composer-lens-switch-cancel"
            onClick={() => onChange(cancelSwitch(state))}
            type="button"
            variant="outline"
          >
            {state.preview.cancelCtaLabel}
          </Button>
          <Button
            data-testid="composer-lens-switch-confirm"
            onClick={() => onChange(confirmSwitch(state))}
            type="button"
          >
            {state.preview.primaryCtaLabel}
          </Button>
        </div>
      </section>
    );
  }

  if (state.phase === 'selected' && state.undoStack.length > 0) {
    return (
      <div className="flex justify-end">
        <Button
          data-testid="composer-lens-switch-undo"
          onClick={() => onChange(undoChange(state))}
          size="sm"
          type="button"
          variant="ghost"
        >
          撤销上次切换
        </Button>
      </div>
    );
  }

  return null;
}
