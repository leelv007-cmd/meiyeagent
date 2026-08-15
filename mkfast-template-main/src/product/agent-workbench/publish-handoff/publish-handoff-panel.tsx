/**
 * V31-17 Delivered publish handoff panel (agent-workbench).
 *
 * Title/body/topics/CTA block copy · deterministic ZIP name · MobilePublishHandoff
 * QR · capability three-state · 「我已发布」bound to exact revision · self-report
 * journey strip.
 */

import { cn } from '@/lib/utils';
import type {
  OutcomeSelfReportChipSignal,
  PublishFromHandoffIntent,
} from '@meiye/contracts';
import { useState } from 'react';

import { MobilePublishHandoffQr } from './mobile-publish-handoff-qr';
import {
  evaluateDrivenPublishFromQr,
  SELF_REPORT_CHIP_LABEL,
  type PublishHandoffPanelView,
} from './publish-handoff-model';

export type PublishHandoffPanelProps = {
  view: PublishHandoffPanelView;
  selfReportPrompt?: string | null;
  selfReportChips?: readonly OutcomeSelfReportChipSignal[];
  pending?: boolean;
  onCopyBlock?: (role: string, value: string) => void;
  /** Triggers existing result_export → asset download channel. */
  onDownloadZip?: (fileName: string) => void | Promise<void>;
  onRecordPublished?: (input: {
    contentPackageId: string;
    contentPackageRevision: number;
    platformUrl?: string;
    note?: string;
  }) => void | Promise<void>;
  onSelfReport?: (signal: OutcomeSelfReportChipSignal) => void | Promise<void>;
  onIgnoreSelfReport?: () => void | Promise<void>;
  /**
   * Optional: attempt driven publish from QR (tests A19). Production UI never
   * exposes a driven button; this is a fail-closed seam.
   */
  onAttemptDrivenPublish?: (
    intent: PublishFromHandoffIntent
  ) => void | Promise<void>;
  className?: string;
};

export function PublishHandoffPanel({
  view,
  selfReportPrompt,
  selfReportChips,
  pending,
  onCopyBlock,
  onDownloadZip,
  onRecordPublished,
  onSelfReport,
  onIgnoreSelfReport,
  onAttemptDrivenPublish,
  className,
}: PublishHandoffPanelProps) {
  const [copiedRole, setCopiedRole] = useState<string | null>(null);
  const [platformUrl, setPlatformUrl] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [drivenReject, setDrivenReject] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  function handleCopy(role: string, value: string) {
    onCopyBlock?.(role, value);
    setCopiedRole(role);
    setMessage('已复制');
  }

  async function handleDownloadZip() {
    if (!onDownloadZip || !view.zipFileName || zipBusy || pending) return;
    setZipBusy(true);
    try {
      await onDownloadZip(view.zipFileName);
      setMessage('发布包下载已开始');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '发布包下载失败，请稍后重试'
      );
    } finally {
      setZipBusy(false);
    }
  }

  async function handlePublished() {
    if (!onRecordPublished || pending) return;
    try {
      await onRecordPublished({
        contentPackageId: view.contentPackageId,
        contentPackageRevision: view.publicationBindingRevision,
        ...(platformUrl.trim() ? { platformUrl: platformUrl.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMessage('已记录发布（绑定当前版本）');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '记录发布失败，请稍后重试'
      );
    }
  }

  function handleDrivenAttempt(intent: PublishFromHandoffIntent) {
    const decision = evaluateDrivenPublishFromQr(intent);
    if (!decision.ok) {
      setDrivenReject(decision.message);
      void onAttemptDrivenPublish?.(intent);
      return;
    }
    setDrivenReject(null);
  }

  return (
    <section
      className={cn(
        'border-border bg-background flex flex-col gap-4 rounded-xl border p-4',
        className
      )}
      data-capability-mode={view.capability.mode}
      data-content-package-id={view.contentPackageId}
      data-content-package-revision={view.publicationBindingRevision}
      data-show-direct-publish={view.showDirectPublishCta ? 'true' : 'false'}
      data-surface="publish_handoff_panel"
      data-testid={view.testId}
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-foreground text-sm font-medium">发布交接</h3>
        <p className="text-muted text-xs leading-relaxed">
          {view.capability.description}
        </p>
        <p
          className="text-muted text-[11px]"
          data-testid="publish-handoff-capability-label"
        >
          能力：{view.capability.label}
        </p>
      </header>

      {/* Capability three-state: never render direct publish when not verified */}
      {view.showDirectPublishCta ? (
        <p
          className="text-foreground text-xs"
          data-testid="publish-handoff-direct-publish"
        >
          可直发（已验证）
        </p>
      ) : (
        <p
          className="text-muted text-xs"
          data-testid="publish-handoff-no-direct-publish"
        >
          未验证直发 — 请复制/下载后由你在平台 App 自行发布
        </p>
      )}

      {/* Copy blocks */}
      <div
        className="flex flex-col gap-2"
        data-testid="publish-handoff-copy-blocks"
      >
        {view.copyBlocks.map((block) => (
          <div
            className="border-border flex items-start justify-between gap-2 rounded-lg border px-3 py-2"
            data-copy-role={block.role}
            data-testid="publish-handoff-copy-block"
            key={block.role}
          >
            <div className="min-w-0 flex-1">
              <p className="text-muted text-[11px] font-medium">
                {block.label}
              </p>
              <p className="text-foreground mt-0.5 whitespace-pre-wrap text-xs">
                {block.value}
              </p>
            </div>
            <button
              className="text-foreground shrink-0 rounded-md border px-2 py-1 text-[11px]"
              data-testid={`publish-handoff-copy-${block.role}`}
              onClick={() => handleCopy(block.role, block.value)}
              type="button"
            >
              {copiedRole === block.role ? '已复制' : '复制'}
            </button>
          </div>
        ))}
      </div>

      {/* Deterministic ZIP */}
      {view.zipFileName ? (
        <div
          className="flex items-center justify-between gap-2"
          data-testid="publish-handoff-zip"
        >
          <div className="min-w-0">
            <p className="text-muted text-[11px]">完整发布包</p>
            <p
              className="text-foreground truncate text-xs"
              data-testid="publish-handoff-zip-name"
            >
              {view.zipFileName}
            </p>
            {view.orderedImagePaths.length > 0 ? (
              <p
                className="text-muted mt-0.5 text-[10px]"
                data-testid="publish-handoff-image-order"
              >
                {view.orderedImagePaths.join(' · ')}
              </p>
            ) : null}
          </div>
          <button
            className="text-foreground shrink-0 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
            data-testid="publish-handoff-download-zip"
            disabled={pending || zipBusy || !onDownloadZip}
            onClick={() => void handleDownloadZip()}
            type="button"
          >
            {zipBusy ? '导出中…' : '下载'}
          </button>
        </div>
      ) : null}

      {/* Video safety */}
      {view.videoSafety ? (
        <div
          className="border-border rounded-lg border px-3 py-2"
          data-testid="publish-handoff-video-safety"
        >
          <p className="text-foreground text-xs font-medium">视频发布检查</p>
          <p className="text-muted mt-1 text-[11px] leading-relaxed">
            {view.videoSafety.platformSafeZoneReminder}
          </p>
          <ul className="text-muted mt-1 list-inside list-disc text-[11px]">
            {view.videoSafety.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* MobilePublishHandoff QR */}
      {view.mobileHandoff ? (
        <div
          className="border-border flex flex-col gap-2 rounded-lg border px-3 py-2"
          data-publish-actor={view.mobileHandoff.publishActor}
          data-system-driven-allowed={
            view.mobileHandoff.systemDrivenPublishAllowed ? 'true' : 'false'
          }
          data-testid="mobile-publish-handoff"
        >
          <p className="text-foreground text-xs font-medium">手机扫码继续</p>
          <p className="text-muted text-[11px] leading-relaxed">
            扫码后在手机上查看交接材料，由你自己在平台 App 发布。系统不会代发。
          </p>
          <MobilePublishHandoffQr handoffUrl={view.mobileHandoff.handoffUrl} />
          <p
            className="text-muted break-all text-[10px]"
            data-testid="mobile-publish-handoff-url"
          >
            {view.mobileHandoff.handoffUrl}
          </p>
          {/* Hidden fail-closed control for A19 tests — never a merchant CTA */}
          <button
            className="sr-only"
            data-testid="mobile-publish-handoff-driven-attempt"
            onClick={() => handleDrivenAttempt('system_driven_publish')}
            type="button"
          >
            尝试系统代发（应被拒绝）
          </button>
          {drivenReject ? (
            <p
              className="text-destructive text-[11px]"
              data-testid="mobile-publish-handoff-driven-reject"
              role="alert"
            >
              {drivenReject}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 「我已发布」bound to exact revision */}
      <div
        className="border-border flex flex-col gap-2 rounded-lg border px-3 py-2"
        data-binding-revision={view.publicationBindingRevision}
        data-testid="publish-handoff-i-published"
      >
        <p className="text-foreground text-xs font-medium">我已发布</p>
        <p className="text-muted text-[11px]">
          将绑定内容版本 r{view.publicationBindingRevision}
        </p>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">链接（可选）</span>
          <input
            className="border-border rounded-md border px-2 py-1 text-xs"
            data-testid="publish-handoff-platform-url"
            onChange={(e) => setPlatformUrl(e.target.value)}
            placeholder="https://"
            value={platformUrl}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted">备注（可选）</span>
          <input
            className="border-border rounded-md border px-2 py-1 text-xs"
            data-testid="publish-handoff-note"
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
            value={note}
          />
        </label>
        <button
          className="bg-foreground text-background rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          data-testid="publish-handoff-confirm-published"
          disabled={pending || !onRecordPublished}
          onClick={() => void handlePublished()}
          type="button"
        >
          确认已发布
        </button>
      </div>

      {/* Self-report journey */}
      {selfReportPrompt && selfReportChips && selfReportChips.length > 0 ? (
        <div
          className="border-border flex flex-col gap-2 rounded-lg border px-3 py-2"
          data-testid="self-report-journey"
        >
          <p
            className="text-foreground text-xs font-medium"
            data-testid="self-report-prompt"
          >
            {selfReportPrompt}
          </p>
          <div className="flex flex-wrap gap-2" data-testid="self-report-chips">
            {selfReportChips.map((signal) => (
              <button
                className="border-border min-h-11 min-w-11 rounded-full border px-3 py-2 text-xs"
                data-signal={signal}
                data-testid={`self-report-chip-${signal}`}
                disabled={pending}
                key={signal}
                onClick={() => void onSelfReport?.(signal)}
                type="button"
              >
                {SELF_REPORT_CHIP_LABEL[signal]}
              </button>
            ))}
          </div>
          {onIgnoreSelfReport ? (
            <button
              className="text-muted text-[11px] underline"
              data-testid="self-report-ignore"
              disabled={pending}
              onClick={() => void onIgnoreSelfReport()}
              type="button"
            >
              稍后再说
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          aria-live="polite"
          className="text-muted text-[11px]"
          data-testid="publish-handoff-message"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
