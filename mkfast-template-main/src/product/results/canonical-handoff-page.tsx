/**
 * Canonical handoff page body (four-section paradigm, #101).
 *
 * Replaces legacy handoffPackages data source. Route shell keeps
 * /dashboard/handoff/$token; data comes from CanonicalDeliveryHandoff only.
 */

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconShare,
} from '@tabler/icons-react';
import { useState } from 'react';
import type {
  CanonicalHandoffPageView,
  CanonicalHandoffResolveResult,
} from './delivery-handoff-canonical';
import {
  projectDeliveryOutcome,
  type DeliveryOutcome,
} from './delivery-outcomes-a11y';
import { recordShareAttempt } from './delivery-share-degrade';

export type CanonicalHandoffPageProps = {
  resolve: CanonicalHandoffResolveResult;
  onCopy?: (fieldId: string, value: string) => void;
  onDownload?: (href: string) => void;
  onShare?: () => Promise<
    'shared' | 'cancelled' | 'downloaded' | 'failed' | 'unsupported'
  >;
  onReport?: (input: {
    outcome: 'published' | 'not_published' | 'failed';
    platformUrl?: string;
    note?: string;
  }) => void | Promise<void>;
  /** Unavailable links only recover to an authenticated safe surface. */
  onUnavailableRecovery?: (reason: 'expired' | 'not_found') => void;
};

export function CanonicalHandoffPage({
  resolve,
  onCopy,
  onDownload,
  onShare,
  onReport,
  onUnavailableRecovery,
}: CanonicalHandoffPageProps) {
  const [outcome, setOutcome] = useState<DeliveryOutcome | null>(null);
  const [message, setMessage] = useState<string>();
  const [platformUrl, setPlatformUrl] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reporting, setReporting] = useState(false);

  if (resolve.kind === 'not_found' || resolve.kind === 'expired') {
    return (
      <div
        className="mx-auto max-w-lg p-5"
        data-testid="canonical-handoff-unavailable"
      >
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>交接包不可用</AlertTitle>
          <AlertDescription>
            {resolve.kind === 'expired'
              ? '交接链接已过期。请返回工作台，由原发布者重新生成。'
              : '该交接链接不可用。请返回工作台，由原发布者获取新的交接链接。'}
          </AlertDescription>
        </Alert>
        {onUnavailableRecovery ? (
          <Button
            className="mt-4"
            data-testid="canonical-handoff-recover"
            onClick={() => onUnavailableRecovery(resolve.kind)}
            type="button"
          >
            返回工作台
          </Button>
        ) : null}
      </div>
    );
  }

  const view: CanonicalHandoffPageView = resolve;
  const outcomeProjection = outcome ? projectDeliveryOutcome(outcome) : null;

  async function handleShare() {
    if (!onShare) {
      setMessage('当前环境无法分享，请下载或复制链接。');
      return;
    }
    const result = await onShare();
    const record = recordShareAttempt(
      result === 'shared'
        ? { kind: 'shared' }
        : result === 'cancelled'
          ? { kind: 'cancelled' }
          : result === 'unsupported'
            ? { kind: 'unsupported' }
            : { kind: 'failed', reason: 'share_failed' }
    );
    if (result === 'downloaded') {
      setOutcome('download_done');
      setMessage('已改用下载');
      return;
    }
    setMessage(record.message);
    if (record.markDelivered) {
      setOutcome('share_done');
    }
    // cancel → markDelivered false, no outcome
  }

  function handleDownload(href: string) {
    onDownload?.(href);
    setOutcome('download_done');
    setMessage('下载已开始');
  }

  function handleCopy(fieldId: string, value: string) {
    onCopy?.(fieldId, value);
    setMessage('已复制');
  }

  async function handleReport(
    result: 'published' | 'not_published' | 'failed'
  ) {
    if (!onReport || reporting) return;
    setReporting(true);
    try {
      await onReport({
        outcome: result,
        ...(result === 'published' && platformUrl.trim()
          ? { platformUrl: platformUrl.trim() }
          : {}),
        ...(reportNote.trim() ? { note: reportNote.trim() } : {}),
      });
      if (result === 'published') {
        setOutcome('published');
        setMessage('已记录发布结果');
      } else {
        setMessage('已记录回报');
      }
    } finally {
      setReporting(false);
    }
  }

  return (
    <main
      className="mx-auto w-full max-w-xl space-y-4 p-4 pb-24"
      data-testid="canonical-handoff-page"
      data-source="canonical-delivery"
      data-token={view.token}
    >
      <div>
        <h1 className="text-xl font-semibold tracking-normal">
          {view.heading}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{view.description}</p>
      </div>

      <output
        id={view.outcomeLiveRegionId}
        aria-live="polite"
        className="sr-only"
        data-testid="handoff-outcome-live"
      >
        {outcomeProjection?.announcement ?? ''}
      </output>

      {outcomeProjection ? (
        <output
          id={outcomeProjection.focusId}
          tabIndex={-1}
          data-testid={outcomeProjection.testId}
          data-outcome={outcomeProjection.outcome}
          className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <IconCheck className="mr-1 inline size-4 text-emerald-700" />
          {outcomeProjection.announcement}
        </output>
      ) : null}

      {message && !outcomeProjection ? (
        <Alert>
          <IconCheck />
          <AlertTitle>状态</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {/* 1. Share */}
      <Card
        className="rounded-md shadow-none"
        data-testid="handoff-section-share"
        data-section="share"
      >
        <CardHeader>
          <CardTitle className="text-sm">{view.sections.share.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Button type="button" onClick={() => void handleShare()}>
            <IconShare />
            系统分享
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              handleCopy('share_url', view.sections.share.shareUrl)
            }
          >
            <IconCopy />
            复制交接链接
          </Button>
        </CardContent>
      </Card>

      {/* 2. Download */}
      <Card
        className="rounded-md shadow-none"
        data-testid="handoff-section-download"
        data-section="download"
      >
        <CardHeader>
          <CardTitle className="text-sm">
            {view.sections.download.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {view.sections.download.media.map((media) => (
            <a
              key={media.id}
              className={buttonVariants({ variant: 'outline' })}
              href={media.href}
              download={media.downloadName}
              data-testid={`handoff-download-${media.id}`}
              onClick={() => handleDownload(media.href)}
            >
              <IconDownload />
              {media.label}
            </a>
          ))}
          {view.sections.download.fullPackageHref ? (
            <a
              className={buttonVariants({ variant: 'default' })}
              href={view.sections.download.fullPackageHref}
              download={view.sections.download.fullPackageFileName}
              data-testid="handoff-download-full-package"
              onClick={() =>
                handleDownload(view.sections.download.fullPackageHref!)
              }
            >
              <IconDownload />
              完整发布包
            </a>
          ) : null}
        </CardContent>
      </Card>

      {/* 3. Copy */}
      <section data-testid="handoff-section-copy" data-section="copy">
        {view.sections.copy.fields.map((field) => (
          <div key={field.id} className="border-y py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{field.label}</h2>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                data-testid={`handoff-copy-${field.id}`}
                onClick={() => handleCopy(field.id, field.value)}
              >
                <IconCopy />
                复制
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {field.value}
            </p>
          </div>
        ))}
      </section>

      {/* 4. Report */}
      <Card
        className="rounded-md shadow-none"
        data-testid="handoff-section-report"
        data-section="report"
        data-published={view.sections.report.isPublished ? 'true' : 'false'}
        data-handed-over-not-published={
          view.sections.report.handedOverIsNotPublished ? 'true' : 'false'
        }
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">
              {view.sections.report.title}
            </CardTitle>
            <Badge
              variant={
                view.sections.report.isPublished ? 'secondary' : 'outline'
              }
              data-testid="handoff-report-status"
            >
              {view.sections.report.statusLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {view.sections.report.description}
          </p>
          {view.sections.report.awaitingReport ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="canonical-handoff-platform-url">平台链接</Label>
                <Input
                  id="canonical-handoff-platform-url"
                  inputMode="url"
                  placeholder="https://"
                  value={platformUrl}
                  onChange={(event) => setPlatformUrl(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="canonical-handoff-report-note">备注</Label>
                <Textarea
                  id="canonical-handoff-report-note"
                  value={reportNote}
                  onChange={(event) => setReportNote(event.target.value)}
                  placeholder="可选"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  disabled={reporting}
                  data-testid="handoff-report-published"
                  onClick={() => void handleReport('published')}
                >
                  已发布
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={reporting}
                  data-testid="handoff-report-not-published"
                  onClick={() => void handleReport('not_published')}
                >
                  未发布
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={reporting}
                  data-testid="handoff-report-failed"
                  onClick={() => void handleReport('failed')}
                >
                  失败
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
