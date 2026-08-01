/**
 * Viral adapt dual-track sourcing card (#324 paste + #328 logged-in read).
 *
 * The host owns the OpenCLI bridge. This component never calls localhost,
 * XHS, or Core with the complete note URL.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type {
  ViralAdaptJourneyState,
  ViralAdaptSourceTrack,
  ViralPasteDraft,
} from './viral-adapt-journey';
import {
  canAdvanceViralSourcing,
  isValidViralOpenCliNoteUrl,
} from './viral-adapt-journey';

export type ViralAdaptSourcingCardProps = {
  state: ViralAdaptJourneyState;
  onTrackChange: (track: ViralAdaptSourceTrack) => void;
  onOpenCliLinkChange: (noteUrl: string) => void;
  onOpenCliRead: () => void;
  onDraftChange: (patch: Partial<ViralPasteDraft>) => void;
  onContinue: () => void;
  onCancel: () => void;
  /** Opens/focuses the host's real upload + rights-aware Composer seam. */
  onRequestImageUpload?: () => void;
  busy?: boolean;
  className?: string;
};

export function ViralAdaptSourcingCard({
  state,
  onTrackChange,
  onOpenCliLinkChange,
  onOpenCliRead,
  onDraftChange,
  onContinue,
  onCancel,
  onRequestImageUpload,
  busy = false,
  className,
}: ViralAdaptSourcingCardProps) {
  if (state.phase !== 'sourcing') return null;

  const opencliSelected = state.sourceTrack === 'opencli_link';
  const pasteSelected = state.sourceTrack === 'paste';
  const reading = state.opencli.status === 'reading';
  const canRead =
    state.liveGate.available &&
    state.opencli.bridgeReady &&
    isValidViralOpenCliNoteUrl(state.opencli.noteUrl) &&
    !busy &&
    !reading;
  const canContinue = canAdvanceViralSourcing(state) && !busy;

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
        <h2 className="text-sm font-semibold text-foreground">
          爆款复刻 · 取材
        </h2>
        <p className="meiye-type-aux">
          默认用本机已登录的小红书读取；也可随时改用手动粘贴。
          系统不会匿名抓取链接。
        </p>
      </header>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">取材方式</legend>
        <Button
          aria-pressed={opencliSelected}
          data-testid="viral-adapt-select-opencli"
          disabled={!state.liveGate.available || busy}
          onClick={() => onTrackChange('opencli_link')}
          size="sm"
          type="button"
          variant={opencliSelected ? 'default' : 'outline'}
        >
          登录态读取（默认）
        </Button>
        <Button
          aria-pressed={pasteSelected}
          data-testid="viral-adapt-select-paste"
          disabled={busy}
          onClick={() => onTrackChange('paste')}
          size="sm"
          type="button"
          variant={pasteSelected ? 'default' : 'outline'}
        >
          手动粘贴
        </Button>
      </fieldset>

      <div
        className={cn(
          'flex flex-col gap-2 rounded-xl border p-3',
          opencliSelected ? 'border-border' : 'border-muted bg-muted/20'
        )}
        data-opencli-available={state.liveGate.available ? 'true' : 'false'}
        data-selected={opencliSelected ? 'true' : 'false'}
        data-testid="viral-adapt-track-opencli"
      >
        <p className="text-sm font-medium text-foreground">
          链接取材（OpenCLI 本机登录态）
        </p>
        <p className="meiye-type-aux" data-testid="viral-adapt-opencli-status">
          {state.liveGate.statusLabel}
        </p>
        {state.liveGate.available ? (
          <p
            className="meiye-type-aux"
            data-testid="viral-adapt-opencli-device-status"
          >
            {state.opencli.bridgeReady
              ? '本机桥已连接，可读取用户自有登录态'
              : '本机桥未连接，请检查 OpenCLI daemon 与浏览器扩展'}
          </p>
        ) : (
          <p className="meiye-type-aux" data-testid="viral-adapt-opencli-hint">
            live 门未核销，当前仅手动粘贴可用。
          </p>
        )}

        {opencliSelected || !state.liveGate.available ? (
          <>
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="viral-adapt-opencli-link"
            >
              完整小红书笔记链接
            </label>
            <Input
              autoComplete="off"
              data-testid="viral-adapt-opencli-link"
              disabled={!state.liveGate.available || busy || reading}
              id="viral-adapt-opencli-link"
              onChange={(event) =>
                onOpenCliLinkChange(event.currentTarget.value)
              }
              placeholder="https://www.xiaohongshu.com/..."
              type="url"
              value={state.opencli.noteUrl}
            />
            <p className="meiye-type-aux">
              链接只会在本机交给已注入的 OpenCLI 桥，不写入任务、日志或证据。
            </p>
            {state.opencli.status === 'ready' ? (
              <p
                className="text-sm text-foreground"
                data-testid="viral-adapt-opencli-read-summary"
              >
                已读取笔记文字；已授权 {state.draft.imageAssetIds.length}{' '}
                张参考图
              </p>
            ) : null}
            {state.opencli.status === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                本机登录态读取失败。可重试，或改用手动粘贴。
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                data-testid="viral-adapt-opencli-action"
                disabled={!canRead}
                onClick={onOpenCliRead}
                size="sm"
                type="button"
                variant="outline"
              >
                {!state.liveGate.available
                  ? '链接取材暂不可用'
                  : !state.opencli.bridgeReady
                    ? '本机桥未连接'
                    : reading
                      ? '正在读取…'
                      : '用登录态读取'}
              </Button>
              <Button
                data-testid="viral-adapt-opencli-fallback"
                disabled={busy}
                onClick={() => onTrackChange('paste')}
                size="sm"
                type="button"
                variant="ghost"
              >
                改用手动粘贴
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl border p-3',
          pasteSelected ? 'border-border' : 'border-muted bg-muted/20'
        )}
        data-selected={pasteSelected ? 'true' : 'false'}
        data-testid="viral-adapt-track-paste"
      >
        <p className="text-sm font-medium text-foreground">手动粘贴取材</p>
        {pasteSelected ? (
          <>
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
            <div
              className="flex flex-col gap-2"
              data-testid="viral-adapt-track-images"
            >
              <p className="text-sm font-medium text-foreground">
                上传参考图（可选）
              </p>
              {state.draft.imageAssetIds.length > 0 ? (
                <p className="meiye-type-aux">
                  已附加 {state.draft.imageAssetIds.length} 张经 Composer
                  授权的参考图
                </p>
              ) : (
                <p className="meiye-type-aux">尚未附加参考图</p>
              )}
              <p className="meiye-type-aux">
                上传与授权在下方 Composer 完成，只有成功附加的资产会进入仿写。
              </p>
              {onRequestImageUpload ? (
                <Button
                  data-testid="viral-adapt-add-image"
                  disabled={busy}
                  onClick={onRequestImageUpload}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  前往上传参考图
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
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
