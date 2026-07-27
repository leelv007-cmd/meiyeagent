/**
 * 作品详情 — T32 / #226.
 *
 * 成品 revision → 媒体画廊 → 生成依据与使用导购 → 动作. Everything on this page is
 * bound to the revision the canonical projection reports as current, which is
 * the same revision the Composer 交付卡 (T31) binds: 我确认的就是我拿到的 (story 40).
 *
 * Actions run on the canonical delivery seam and nowhere else:
 *  - 导出   → `result-delivery/result_export`, the same command Result Center
 *             issues, with a revision-scoped idempotency key.
 *  - 复制   → client-side clipboard over the delivered version's own words.
 *  - 协办交接 → opens the canonical delivery panel bound to this revision.
 *             ADR-0014 forbids a second submit truth, and the assisted receipt
 *             chain needs an approved ApprovalReceipt that only that flow
 *             issues, so this surface is the doorway, not a second state
 *             machine.
 *  - 轻编辑  → the canonical ContentPackage → LightComposerCanvas carrier.
 */

import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { IconExternalLink } from '@tabler/icons-react';
import type { PublicContentPackage } from '@meiye/contracts';

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { getLocale } from '@/lib/locale';
import { getPathWithLocale } from '@/lib/urls';
import { commandP1, p1ErrorCode } from '@/p1/client';
import { ContentPackageExportCarrier } from '@/p1/content-package-export-carrier';

import { WorksLightEditPage } from './works-light-edit-page';
import { WorksMediaGallery } from './works-media-gallery';
import { translateWorksSystemText, worksCopy } from './works-copy';
import { useWorksProjection } from './works-queries';
import {
  workAdoptHref,
  workCopyText,
  workDetail,
  workExportIdempotencyKey,
  workHandoffHref,
  workTextExport,
  type WorkPackageDetail,
} from './works-projection';

type ExportOutcome = { downloadUrl: string; receiptId: string };

function WorksFrame({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: worksCopy(getLocale()).title, href: '/dashboard/works' },
          { label: title, isCurrentPage: true },
        ]}
      />
      <div
        className="@container/main flex flex-1 flex-col gap-2"
        data-testid="works-detail-surface"
      >
        <div className="flex flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-6 lg:py-6">
          {children}
        </div>
      </div>
    </>
  );
}

function ActionButton({
  busy,
  children,
  onClick,
  testId,
}: {
  busy?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className="meiye-glass-piece min-h-touch-target rounded-full px-4 py-2 text-sm disabled:opacity-50"
      data-testid={testId}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function WorkPackageBody({
  contentPackage,
  detail,
}: {
  contentPackage: PublicContentPackage;
  detail: WorkPackageDetail;
}) {
  const locale = getLocale();
  const copyText = worksCopy(locale);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [exported, setExported] = useState<ExportOutcome>();
  const adoptHref = workAdoptHref(detail);
  const handoffHref = workHandoffHref(detail);
  const textExport = workTextExport(detail);
  const lightComposerDelivery = useMemo(() => {
    const version = contentPackage.versions.find(
      (candidate) => candidate.id === contentPackage.currentVersionId
    );
    const delivery = version?.exportUseDelivery;
    return delivery?.kind === 'light_composer' ? delivery : undefined;
  }, [contentPackage]);

  const exportPackage = useMutation({
    mutationFn: async () => {
      const key = workExportIdempotencyKey(detail);
      if (!detail.confirmedRevision || !detail.platform || !key) {
        throw new Error('这份内容还没有可导出的成品版本。');
      }
      return commandP1<ExportOutcome>(
        'result-delivery',
        {
          action: 'result_export',
          payload: {
            expectedRevision: detail.confirmedRevision.revision,
            packageId: detail.confirmedRevision.packageId,
            platform: detail.platform,
          },
        },
        key
      );
    },
    // The server sentence is an engineering string with a correlation id; a
    // merchant card never carries one (D-116). One failure is worth telling
    // apart, because 稍后再试 is wrong advice for it: core refuses the export
    // while an approval is still pending on the creation task, and retrying
    // changes nothing until that confirmation is dealt with.
    onError: (error) =>
      setFailure(
        p1ErrorCode(error) === 'TASK_BLOCKING_NODE_CONFLICT'
          ? copyText.detail.pendingConfirmation
          : copyText.detail.exportFailed
      ),
    onSuccess: (result) => {
      setFailure(undefined);
      setExported(result);
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workCopyText(detail));
      setCopied(true);
      setFailure(undefined);
    } catch {
      setFailure(
        locale === 'en'
          ? 'Copy is unavailable on this device. Select the text manually.'
          : '这台设备不让直接复制，长按选中文字也可以。'
      );
    }
  };

  const downloadText = () => {
    if (!textExport) return;
    const url = URL.createObjectURL(
      new Blob([textExport.text], { type: textExport.contentType })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = textExport.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="meiye-ambient-copy">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="meiye-glass-piece rounded-full px-2.5 py-0.5 text-xs"
            data-testid="works-detail-shape"
          >
            {copyText.shapes[detail.outputShape]}
          </span>
          {/*
            These two float on the ambient band, so they take the shell's
            ambient treatment (--ambient-text + scrim shadow), not the ink
            gradient. DESIGN.md:251 holds every .meiye-ambient-copy header to
            ≥4.5:1 measured in both themes, and 60% ink on a darkened photo is
            not that.
          */}
          <span className="meiye-type-aux" data-testid="works-detail-status">
            {translateWorksSystemText(locale, detail.statusLabel)}
          </span>
          {detail.confirmedRevision ? (
            <span
              className="meiye-type-aux"
              data-package-id={detail.confirmedRevision.packageId}
              data-revision={detail.confirmedRevision.revision}
              data-testid="works-detail-revision"
              data-version-id={detail.confirmedRevision.versionId}
            >
              {copyText.revision(detail.confirmedRevision.revision)}
            </span>
          ) : null}
        </div>
        <h1
          className="meiye-type-title mt-2"
          data-i18n-pass-through="content-title"
        >
          {detail.title}
        </h1>
      </div>

      {detail.media.length > 0 ? (
        <WorksMediaGallery media={detail.media} />
      ) : null}

      {detail.body ? (
        <section className="meiye-porcelain rounded-2xl p-4">
          <p
            className="meiye-type-body whitespace-pre-wrap"
            data-i18n-pass-through="content-body"
            data-testid="works-detail-body"
          >
            {detail.body}
          </p>
          {detail.topics.length > 0 ? (
            <p
              className="text-muted-foreground mt-3 text-xs"
              data-i18n-pass-through="content-topics"
            >
              {detail.topics.map((topic) => `#${topic}`).join(' ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className="meiye-porcelain rounded-2xl p-4"
        data-testid="works-detail-guidance"
      >
        <h2 className="meiye-type-body font-semibold">{copyText.detail.use}</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {detail.guidance.map((line) => (
            <li className="text-muted-foreground text-sm" key={line}>
              {translateWorksSystemText(locale, line)}
            </li>
          ))}
        </ul>
        {detail.evidence.length > 0 ? (
          <>
            <h2 className="meiye-type-body mt-4 font-semibold">
              {copyText.detail.evidence}
            </h2>
            <ul
              className="mt-2 flex flex-wrap gap-2"
              data-testid="works-detail-evidence"
            >
              {detail.evidence.map((chip) => (
                <li
                  className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
                  key={chip.id}
                >
                  {translateWorksSystemText(locale, chip.label)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-3"
        data-testid="works-detail-actions"
      >
        <div className="flex flex-wrap gap-2">
          {detail.exportability === 'ready' ? (
            <ActionButton
              busy={exportPackage.isPending || !detail.confirmedRevision}
              onClick={() => exportPackage.mutate()}
              testId="works-action-export"
            >
              {exportPackage.isPending
                ? copyText.detail.exporting
                : copyText.detail.export}
            </ActionButton>
          ) : detail.exportability === 'needs_adoption' && adoptHref ? (
            // 导出 on an un-adopted 成品 is a server error, not a file. Point at
            // 采用 — the canonical Result Center action — bound to this revision.
            // `text_only` falls through to neither: a 文案 作品 has no delivery
            // package at all, and 复制文字 below is how it gets used.
            <a
              className="meiye-glass-piece min-h-touch-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm"
              data-testid="works-action-adopt"
              href={getPathWithLocale(adoptHref)}
            >
              {copyText.detail.adopt}
              <IconExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          {detail.exportability === 'text_only' && textExport ? (
            <ActionButton
              onClick={downloadText}
              testId="works-action-download-text"
            >
              {copyText.detail.download}
            </ActionButton>
          ) : null}
          <ActionButton onClick={copy} testId="works-action-copy">
            {copied ? copyText.detail.copied : copyText.detail.copy}
          </ActionButton>
          {handoffHref ? (
            <a
              className="meiye-glass-piece min-h-touch-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm"
              data-testid="works-action-handoff"
              href={getPathWithLocale(handoffHref)}
            >
              {copyText.detail.handoff}
              <IconExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          {lightComposerDelivery ? (
            <span data-testid="works-action-light-edit">
              <ContentPackageExportCarrier delivery={lightComposerDelivery} />
            </span>
          ) : null}
        </div>

        {exported ? (
          <a
            className="text-sm underline underline-offset-4"
            data-testid="works-export-download"
            href={exported.downloadUrl}
          >
            {copyText.detail.downloadPackage}
          </a>
        ) : null}
        {failure ? (
          <p className="text-sm" data-testid="works-action-error" role="alert">
            {failure}
          </p>
        ) : null}
      </section>
    </>
  );
}

function WorksDetailNotice({
  description,
  testId,
  title,
}: {
  description: string;
  testId: string;
  title: string;
}) {
  const copy = worksCopy(getLocale());
  return (
    <WorksFrame title={copy.title}>
      <div
        className="meiye-porcelain rounded-2xl p-6"
        data-testid={testId}
        role="alert"
      >
        <h1 className="meiye-type-body font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{description}</p>
        <Link
          className="mt-4 inline-block text-sm underline underline-offset-4"
          to="/dashboard/works"
        >
          {copy.detail.back}
        </Link>
      </div>
    </WorksFrame>
  );
}

export function WorksDetailPage({ workId }: { workId: string }) {
  const copy = worksCopy(getLocale());
  const { failed, loading, source } = useWorksProjection();
  const detail = useMemo(
    () => workDetail({ ...source, id: workId }),
    [source, workId]
  );
  const contentPackage = source.contentPackages.find(
    (candidate) =>
      candidate.id === (detail.kind === 'package' ? detail.packageId : '')
  );

  if (loading) {
    return (
      <WorksFrame title={copy.title}>
        <p
          className="text-muted-foreground text-sm"
          data-testid="works-detail-loading"
        >
          {copy.detail.loading}
        </p>
      </WorksFrame>
    );
  }

  if (failed) {
    // 「取不回来」 and 「不存在」 are different sentences; saying the wrong one
    // would tell a merchant their 作品 is gone when the read simply failed.
    return (
      <WorksDetailNotice
        description={copy.detail.unavailableDescription}
        testId="works-detail-unavailable"
        title={copy.detail.unavailableTitle}
      />
    );
  }

  if (detail.kind === 'canvas') {
    return <WorksLightEditPage workId={detail.workId} />;
  }

  if (detail.kind !== 'package' || !contentPackage) {
    return (
      <WorksDetailNotice
        description={copy.detail.missingDescription}
        testId="works-detail-missing"
        title={copy.detail.missingTitle}
      />
    );
  }

  return (
    <WorksFrame title={detail.title}>
      <WorkPackageBody contentPackage={contentPackage} detail={detail} />
    </WorksFrame>
  );
}
