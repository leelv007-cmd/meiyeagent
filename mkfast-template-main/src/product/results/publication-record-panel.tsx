/**
 * Manual publication record panel (P1-D2 / #157).
 *
 * Fail-closed without package revision. Never claims automatic publish
 * success when live gate is closed.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMemo, useState } from 'react';
import type { ContentPackagePlatform } from '@meiye/contracts';

import {
  validateManualPublicationForm,
  type ManualPublicationFormInput,
  type PublicationRecordPanelView,
} from './publication-record-model';

export type PublicationRecordPanelProps = {
  view: PublicationRecordPanelView;
  contentPackageId?: string;
  contentPackageRevision?: number;
  variantVersionId?: string;
  /** Exact platform for the bound ContentPackage variant. */
  platform?: ContentPackagePlatform;
  pending?: boolean;
  onRecordManual?: (
    input: ManualPublicationFormInput & { idempotencyKey: string }
  ) => void | Promise<void>;
};

const PLATFORMS: readonly { id: ContentPackagePlatform; label: string }[] = [
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'douyin', label: '抖音' },
  { id: 'video_account', label: '视频号' },
] as const;

export function PublicationRecordPanel(props: PublicationRecordPanelProps) {
  const { view } = props;
  const [platform, setPlatform] = useState<ContentPackagePlatform>(
    props.platform ?? 'xiaohongshu'
  );
  const [accountDisplayLabel, setAccountDisplayLabel] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [platformUrl, setPlatformUrl] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (view.kind === 'fail_closed') return view.canRecordManual;
    return view.canRecordManual;
  }, [view]);
  const platforms = props.platform
    ? PLATFORMS.filter((item) => item.id === props.platform)
    : PLATFORMS;

  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      data-testid="publication-record-panel"
      data-panel-kind={view.kind}
      aria-label={view.heading}
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{view.heading}</h3>
        {view.kind === 'ready' ? (
          <p className="text-xs text-muted-foreground">{view.summary}</p>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="publication-record-fail-closed"
            data-reason={view.reason}
          >
            {view.message}
          </p>
        )}
        {!view.automaticPublishAllowed && view.automaticPublishBlockedReason ? (
          <p
            className="text-xs text-amber-800 dark:text-amber-200"
            data-testid="publication-record-manual-only"
          >
            {view.automaticPublishBlockedReason}
          </p>
        ) : null}
      </header>

      {view.kind === 'ready' ? (
        <ul className="space-y-2" data-testid="publication-record-list">
          {view.records.map((record) => (
            <li
              key={record.id}
              className="rounded-md border px-3 py-2 text-sm"
              data-testid="publication-record-row"
              data-superseded={record.isSuperseded ? 'true' : 'false'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{record.platformLabel}</span>
                <Badge variant="outline">{record.sourceTierLabel}</Badge>
                <Badge
                  variant={
                    record.statusLabel === '已发布' ? 'secondary' : 'outline'
                  }
                >
                  {record.statusLabel}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {record.revisionLabel}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {record.accountDisplayLabel} · {record.publishedAtLabel}
                {record.supersedesLabel ? ` · ${record.supersedesLabel}` : null}
              </p>
              {record.platformUrl ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {record.platformUrl}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {view.kind === 'ready' ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="publication-record-revision-notice"
        >
          {view.editCreatesNewRevisionNotice}（{view.currentRevisionLabel}）
        </p>
      ) : null}

      {canSubmit && props.onRecordManual ? (
        <form
          className="space-y-3 rounded-md border p-3"
          data-testid="publication-record-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              props.contentPackageId === undefined ||
              props.contentPackageRevision === undefined ||
              !props.variantVersionId
            ) {
              setFormError('缺少成品版本绑定，无法提交。');
              return;
            }
            const result = validateManualPublicationForm(
              {
                platform,
                accountDisplayLabel,
                publishedAt: publishedAt
                  ? new Date(publishedAt).toISOString()
                  : '',
                platformUrl: platformUrl || undefined,
                note: note || undefined,
                status: 'published',
              },
              {
                contentPackageId: props.contentPackageId,
                contentPackageRevision: props.contentPackageRevision,
                variantVersionId: props.variantVersionId,
              }
            );
            if (!result.ok) {
              setFormError(result.errors[0] ?? '请检查表单');
              return;
            }
            setFormError(null);
            await props.onRecordManual?.({
              ...result.normalized,
              idempotencyKey: result.idempotencyKey,
            });
          }}
        >
          <p className="text-sm font-medium">人工补记发布</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {platforms.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={platform === item.id ? 'default' : 'outline'}
                data-testid={`publication-platform-${item.id}`}
                onClick={() => setPlatform(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="publication-account">账号显示标识</Label>
            <Input
              id="publication-account"
              data-testid="publication-account"
              value={accountDisplayLabel}
              onChange={(e) => setAccountDisplayLabel(e.target.value)}
              placeholder="例如：本店抖音"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="publication-at">发布时间</Label>
            <Input
              id="publication-at"
              data-testid="publication-at"
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="publication-url">发布链接（可选）</Label>
            <Input
              id="publication-url"
              data-testid="publication-url"
              value={platformUrl}
              onChange={(e) => setPlatformUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="publication-note">备注（可选）</Label>
            <Input
              id="publication-note"
              data-testid="publication-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {formError ? (
            <p
              className="text-xs text-destructive"
              data-testid="publication-form-error"
            >
              {formError}
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={props.pending}
            data-testid="publication-record-submit"
          >
            记录已发布
          </Button>
        </form>
      ) : null}
    </section>
  );
}
