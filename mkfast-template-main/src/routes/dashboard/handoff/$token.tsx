import { DashboardHeader } from '@/components/layout/dashboard-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
  dashboard_handoff_aigc_explicit_implicit,
  dashboard_handoff_aigc_label_off,
  dashboard_handoff_aigc_label_on,
  dashboard_handoff_aigc_missing,
  dashboard_handoff_asset_alt,
  dashboard_handoff_authorized_image,
  dashboard_handoff_checklist_title,
  dashboard_handoff_copied,
  dashboard_handoff_copy,
  dashboard_handoff_description,
  dashboard_handoff_download_file,
  dashboard_handoff_download_image,
  dashboard_handoff_download_labeled_video_aria,
  dashboard_handoff_download_video_aria,
  dashboard_handoff_field_body,
  dashboard_handoff_field_conversion,
  dashboard_handoff_field_title,
  dashboard_handoff_field_topics,
  dashboard_handoff_mobile_package,
  dashboard_handoff_outcome_failed,
  dashboard_handoff_outcome_not_published,
  dashboard_handoff_platform_title,
  dashboard_handoff_platform_url_label,
  dashboard_handoff_report_description,
  dashboard_handoff_report_failed_success,
  dashboard_handoff_report_log,
  dashboard_handoff_report_log_with_note,
  dashboard_handoff_report_not_published_success,
  dashboard_handoff_report_note_label,
  dashboard_handoff_report_note_placeholder,
  dashboard_handoff_report_published_success,
  dashboard_handoff_report_title,
  dashboard_handoff_reported,
  dashboard_handoff_save_or_share,
  dashboard_handoff_share_failed,
  dashboard_handoff_share_opened,
  dashboard_handoff_share_unsupported,
  dashboard_handoff_status_title,
  dashboard_handoff_unavailable_description,
  dashboard_handoff_unavailable_title,
  dashboard_handoff_video_summary,
  dashboard_handoff_waiting_report,
  p1_filter_content_published,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { useProductState } from '@/product/client';
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDownload,
  IconPhoto,
  IconShare,
  IconVideo,
} from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/dashboard/handoff/$token')({
  component: MobileHandoffPage,
});

function platformLabel(platform: 'xiaohongshu' | 'douyin') {
  return platform === 'xiaohongshu'
    ? creation_entry_platform_xiaohongshu()
    : creation_entry_platform_douyin();
}

function reportOutcomeLabel(outcome: 'published' | 'not_published' | 'failed') {
  switch (outcome) {
    case 'published':
      return p1_filter_content_published();
    case 'not_published':
      return dashboard_handoff_outcome_not_published();
    case 'failed':
      return dashboard_handoff_outcome_failed();
  }
}

function MobileHandoffPage() {
  const { token } = Route.useParams();
  const { state, loading, execute } = useProductState();
  const [message, setMessage] = useState<string>();
  const [platformUrl, setPlatformUrl] = useState('');
  const [reportNote, setReportNote] = useState('');
  const handoff = state?.handoffPackages.find((item) => item.token === token);
  const expired = handoff
    ? new Date(handoff.expiresAt).getTime() <= Date.now()
    : false;
  const handoffId = handoff?.id;

  useEffect(() => {
    if (!handoffId || expired) return;
    void execute(
      {
        type: 'record_handoff_export',
        packageId: handoffId,
        event: 'opened',
      },
      `handoff-opened-${handoffId}`
    ).catch(() => undefined);
  }, [execute, expired, handoffId]);

  if (loading || !state)
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  if (!handoff || expired) {
    return (
      <div className="mx-auto max-w-lg p-5">
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{dashboard_handoff_unavailable_title()}</AlertTitle>
          <AlertDescription>
            {dashboard_handoff_unavailable_description()}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  const activeHandoff = handoff;
  const artifact = handoff.artifactId
    ? state.videoArtifacts.find((item) => item.id === handoff.artifactId)
    : undefined;
  const asset = state.assets.find((item) =>
    (handoff.assetIds ?? []).includes(item.id)
  );
  const mediaObjectKey = artifact?.objectKey ?? asset?.objectKey;
  const mediaUrl = mediaObjectKey
    ? `/api/storage/file?key=${encodeURIComponent(mediaObjectKey)}`
    : undefined;

  async function sharePackage() {
    if (!navigator.share) {
      setMessage(dashboard_handoff_share_unsupported());
      return;
    }
    try {
      const shareData: ShareData = {
        title: activeHandoff.title,
        text: activeHandoff.body,
        url: window.location.href,
      };
      if (mediaUrl) {
        const response = await fetch(mediaUrl);
        if (response.ok) {
          const contentType = artifact
            ? 'video/mp4'
            : asset?.mediaType === 'image'
              ? (response.headers.get('content-type') ?? 'image/jpeg')
              : 'application/octet-stream';
          const media = new File(
            [await response.blob()],
            `${activeHandoff.id}.${artifact ? 'mp4' : 'jpg'}`,
            { type: contentType }
          );
          if (navigator.canShare?.({ files: [media] })) {
            shareData.files = [media];
          }
        }
      }
      await navigator.share(shareData);
      await execute({
        type: 'record_handoff_export',
        packageId: activeHandoff.id,
        event: 'shared',
      });
      setMessage(dashboard_handoff_share_opened());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(dashboard_handoff_share_failed());
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    await execute({
      type: 'record_handoff_export',
      packageId: activeHandoff.id,
      event: 'copied',
    });
    setMessage(dashboard_handoff_copied());
  }

  async function reportResult(
    outcome: 'published' | 'not_published' | 'failed'
  ) {
    try {
      await execute({
        type: 'report_handoff_result',
        packageId: activeHandoff.id,
        outcome,
        ...(reportNote.trim() ? { note: reportNote.trim() } : {}),
        ...(outcome === 'published' && platformUrl.trim()
          ? { platformUrl: platformUrl.trim() }
          : {}),
      });
      setMessage(
        outcome === 'published'
          ? dashboard_handoff_report_published_success()
          : outcome === 'failed'
            ? dashboard_handoff_report_failed_success()
            : dashboard_handoff_report_not_published_success()
      );
      setReportNote('');
    } catch {
      // Shared Product error is surfaced by the page state.
    }
  }

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          {
            label: dashboard_handoff_mobile_package(),
            isCurrentPage: true,
          },
        ]}
        actions={
          artifact ? (
            <Badge variant="outline">
              {artifact.visibleLabel
                ? dashboard_handoff_aigc_label_on()
                : dashboard_handoff_aigc_label_off()}
            </Badge>
          ) : undefined
        }
      />
      <main className="mx-auto w-full max-w-xl space-y-4 p-4 pb-24">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">
            {dashboard_handoff_platform_title({
              platform: platformLabel(handoff.platform),
            })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard_handoff_description()}
          </p>
        </div>
        {message && (
          <Alert>
            <IconCheck />
            <AlertTitle>{dashboard_handoff_status_title()}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {artifact && (
          <Card className="rounded-md shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconVideo className="size-4" />
                  {dashboard_handoff_video_summary({
                    seconds: artifact.durationSeconds.toFixed(1),
                  })}
                </CardTitle>
                <Badge variant="outline">
                  {artifact.visibleLabel
                    ? dashboard_handoff_aigc_explicit_implicit()
                    : dashboard_handoff_aigc_missing()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => void sharePackage()}>
                <IconShare />
                {dashboard_handoff_save_or_share()}
              </Button>
              {mediaUrl && (
                <a
                  className={buttonVariants({ variant: 'outline' })}
                  href={mediaUrl}
                  download
                  aria-label={
                    artifact.visibleLabel
                      ? dashboard_handoff_download_labeled_video_aria()
                      : dashboard_handoff_download_video_aria()
                  }
                  onClick={() =>
                    void execute({
                      type: 'record_handoff_export',
                      packageId: activeHandoff.id,
                      event: 'downloaded',
                    })
                  }
                >
                  <IconDownload />
                  {dashboard_handoff_download_file()}
                </a>
              )}
            </CardContent>
          </Card>
        )}
        {!artifact && asset && mediaUrl && (
          <Card className="rounded-md shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconPhoto className="size-4" />
                {dashboard_handoff_authorized_image()}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <img
                alt={dashboard_handoff_asset_alt()}
                className="max-h-96 w-full object-contain"
                src={mediaUrl}
              />
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={mediaUrl}
                download
                onClick={() =>
                  void execute({
                    type: 'record_handoff_export',
                    packageId: activeHandoff.id,
                    event: 'downloaded',
                  })
                }
              >
                <IconDownload />
                {dashboard_handoff_download_image()}
              </a>
            </CardContent>
          </Card>
        )}

        {[
          [dashboard_handoff_field_title(), handoff.title],
          [dashboard_handoff_field_body(), handoff.body],
          [
            dashboard_handoff_field_topics(),
            handoff.topics.map((topic) => `#${topic}`).join(' '),
          ],
          [dashboard_handoff_field_conversion(), handoff.conversionText],
        ].map(([label, value]) => (
          <section key={label} className="border-y py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{label}</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copy(value)}
              >
                <IconCopy />
                {dashboard_handoff_copy()}
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {value}
            </p>
          </section>
        ))}

        <Card className="rounded-md shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">
              {dashboard_handoff_checklist_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {handoff.checklist.map((item) => (
              <p key={item} className="flex gap-2 text-sm">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                {item}
              </p>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-md shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">
                {dashboard_handoff_report_title()}
              </CardTitle>
              <Badge
                variant={
                  handoff.status === 'published' ? 'secondary' : 'outline'
                }
              >
                {handoff.status === 'published'
                  ? dashboard_handoff_reported()
                  : dashboard_handoff_waiting_report()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {dashboard_handoff_report_description()}
            </p>
            {handoff.status === 'ready' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="handoff-platform-url">
                    {dashboard_handoff_platform_url_label()}
                  </Label>
                  <Input
                    id="handoff-platform-url"
                    inputMode="url"
                    onChange={(event) => setPlatformUrl(event.target.value)}
                    placeholder="https://"
                    value={platformUrl}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="handoff-report-note">
                    {dashboard_handoff_report_note_label()}
                  </Label>
                  <Textarea
                    id="handoff-report-note"
                    onChange={(event) => setReportNote(event.target.value)}
                    placeholder={dashboard_handoff_report_note_placeholder()}
                    value={reportNote}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button onClick={() => void reportResult('published')}>
                    {p1_filter_content_published()}
                  </Button>
                  <Button
                    onClick={() => void reportResult('not_published')}
                    variant="outline"
                  >
                    {dashboard_handoff_outcome_not_published()}
                  </Button>
                  <Button
                    onClick={() => void reportResult('failed')}
                    variant="destructive"
                  >
                    {dashboard_handoff_outcome_failed()}
                  </Button>
                </div>
              </>
            ) : null}
            {handoff.manualReports.length > 0 ? (
              <ol className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
                {handoff.manualReports.map((report) => (
                  <li key={report.id}>
                    {report.note
                      ? dashboard_handoff_report_log_with_note({
                          date: formatLocaleDateTime(report.createdAt),
                          note: report.note,
                          outcome: reportOutcomeLabel(report.outcome),
                        })
                      : dashboard_handoff_report_log({
                          date: formatLocaleDateTime(report.createdAt),
                          outcome: reportOutcomeLabel(report.outcome),
                        })}
                  </li>
                ))}
              </ol>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
