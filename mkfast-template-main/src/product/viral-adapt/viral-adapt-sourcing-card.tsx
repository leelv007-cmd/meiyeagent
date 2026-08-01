/**
 * Viral adapt 补问卡 — dual-track sourcing UI (#324 / §4.3 / §5.1).
 *
 * Paste track is always available. OpenCLI link slot is reserved but disabled
 * with honest copy while the live gate is unverified (§8.4).
 */

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type {
  ViralAdaptJourneyState,
  ViralPasteDraft,
} from './viral-adapt-journey';
import {
  canAdvanceViralSourcing,
  isViralOpenCliTrackEnabled,
} from './viral-adapt-journey';

export type ViralAdaptSourcingCardProps = {
  state: ViralAdaptJourneyState;
  onDraftChange: (patch: Partial<ViralPasteDraft>) => void;
  onContinue: () => void;
  onCancel: () => void;
  /** Optional: merchant picked image labels (host owns file upload). */
  onAddImageLabel?: (label: string) => void;
  busy?: boolean;
  className?: string;
};

export function ViralAdaptSourcingCard({
  state,
  onDraftChange,
  onContinue,
  onCancel,
  onAddImageLabel,
  busy = false,
  className,
}: ViralAdaptSourcingCardProps) {
  if (state.phase !== 'sourcing') return null;

  const opencliEnabled = isViralOpenCliTrackEnabled(state.liveGate);
  const canContinue = canAdvanceViralSourcing(state.draft) && !busy;

  return (
    <section
      aria-label="爆款复刻取材"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 bg-background',
        className
      )}
      data-testid="viral-adapt-sourcing-card"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">爆款复刻 · 取材</h2>
        <p className="meiye-type-aux">
          粘贴参考笔记文字，或上传参考图。系统不会匿名抓取链接。
        </p>
      </header>

      <div className="flex flex-col gap-2" data-testid="viral-adapt-track-paste">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="viral-adapt-paste-text"
        >
          粘贴笔记文字
        </label>
        <Textarea
          data-testid="viral-adapt-paste-text"
          disabled={busy}
          id="viral-adapt-paste-text"
          onChange={(event) =>
            onDraftChange({ noteText: event.currentTarget.value })
          }
          placeholder="把参考笔记的标题和正文粘贴到这里…"
          rows={6}
          value={state.draft.noteText}
        />
      </div>

      <div className="flex flex-col gap-2" data-testid="viral-adapt-track-images">
        <p className="text-sm font-medium text-foreground">上传参考图（可选）</p>
        {state.draft.imageLabels.length > 0 ? (
          <ul className="meiye-type-aux list-disc pl-5">
            {state.draft.imageLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        ) : (
          <p className="meiye-type-aux">尚未添加参考图</p>
        )}
        {onAddImageLabel ? (
          <Button
            data-testid="viral-adapt-add-image"
            disabled={busy}
            onClick={() =>
              onAddImageLabel(
                `参考图 ${state.draft.imageLabels.length + 1}`
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            添加参考图
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-col gap-1 rounded-xl border border-dashed p-3',
          opencliEnabled ? 'border-border' : 'border-muted bg-muted/30'
        )}
        data-opencli-available={opencliEnabled ? 'true' : 'false'}
        data-testid="viral-adapt-track-opencli"
      >
        <p className="text-sm font-medium text-foreground">
          链接取材（OpenCLI 本机登录态）
        </p>
        <p
          className="meiye-type-aux"
          data-testid="viral-adapt-opencli-status"
        >
          {state.liveGate.statusLabel}
        </p>
        {!opencliEnabled ? (
          <p className="meiye-type-aux" data-testid="viral-adapt-opencli-hint">
            主路径 UI 位已保留；live 门核销前不可用，请先用粘贴轨。
          </p>
        ) : null}
        <Button
          data-testid="viral-adapt-opencli-action"
          disabled={!opencliEnabled || busy}
          size="sm"
          type="button"
          variant="outline"
        >
          {opencliEnabled ? '粘贴笔记链接' : '链接取材暂不可用'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="viral-adapt-sourcing-continue"
          disabled={!canContinue}
          onClick={onContinue}
          type="button"
        >
          继续确认
        </Button>
        <Button
          data-testid="viral-adapt-sourcing-cancel"
          disabled={busy}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          取消
        </Button>
      </div>
    </section>
  );
}
