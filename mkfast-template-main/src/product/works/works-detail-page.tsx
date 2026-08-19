/**
 * 作品详情 — T32 / #226, WORK-01 / R-P1-08.
 *
 * Read-only archive: versions, source, evidence, local copy. Adopt / AI adjust /
 * server export / handoff deep-link the exact Result revision via ResultAction.
 * This page never submits the Result export command.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { IconExternalLink } from '@tabler/icons-react';

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { getLocale } from '@/lib/locale';
import { getPathWithLocale } from '@/lib/urls';
import { resultActionHref } from '@/product/results/result-action';
import type { ResultReturnFocusKey } from '@/product/results/result-return-navigation';

import { ThisRunExperienceEntry } from '@/product/this-run-experience';

import { WorksLightEditPage } from './works-light-edit-page';
import { WorksMediaGallery } from './works-media-gallery';
import { translateWorksSystemText, worksCopy } from './works-copy';
import { useWorksProjection } from './works-queries';
import {
  workCopyText,
  workDetail,
  workResultAction,
  workTextExport,
  type WorkPackageDetail,
} from './works-projection';

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

function archiveHref(
  detail: WorkPackageDetail,
  intent: 'adjust' | 'adopt' | 'export' | 'handoff',
  archiveId: string
): string | null {
  const plan = workResultAction(detail, intent);
  if (!plan) return null;
  if (intent === 'export' && detail.exportability !== 'ready') return null;
  if (intent === 'adopt' && detail.exportability !== 'needs_adoption') {
    return null;
  }
  return resultActionHref(plan.target, {
    archiveId,
    focusKey: 'works-detail-actions',
    kind: 'works',
    scrollY: 0,
  });
}

function ResultDoorway({
  children,
  href,
  testId,
}: {
  children: React.ReactNode;
  href: string;
  testId: string;
}) {
  return (
    <a
      className="meiye-glass-piece min-h-touch-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm"
      data-result-writer="result"
      data-testid={testId}
      href={getPathWithLocale(href)}
    >
      {children}
      <IconExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

function WorkPackageBody({
  archiveId,
  detail,
}: {
  archiveId: string;
  detail: WorkPackageDetail;
}) {
  const locale = getLocale();
  const copyText = worksCopy(locale);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string>();
  const adoptHref = archiveHref(detail, 'adopt', archiveId);
  const adjustHref = archiveHref(detail, 'adjust', archiveId);
  const exportHref = archiveHref(detail, 'export', archiveId);
  const handoffHref = archiveHref(detail, 'handoff', archiveId);
  const textExport = workTextExport(detail);
  const legacyVideo =
    detail.outputShape === 'video' && detail.legacyVideoArchive;


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

      {legacyVideo ? (
        <section
          className="meiye-porcelain rounded-2xl p-4"
          data-testid="works-video-readonly"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="meiye-glass-piece rounded-full px-3 py-1 text-xs">
              {copyText.detail.archive}
            </span>
            <span className="meiye-type-aux">{copyText.detail.readonly}</span>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {copyText.detail.readonlyDescription}
          </p>
        </section>
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

      <ThisRunExperienceEntry taskId={detail.sourceTaskId} />

      <section
        className="flex flex-col gap-3"
        data-testid="works-detail-actions"
        tabIndex={-1}
      >
        <div className="flex flex-wrap gap-2">
          {legacyVideo ? (
            <button
              className="meiye-glass-piece min-h-touch-target rounded-full px-4 py-2 text-sm opacity-50"
              data-testid="works-video-confirm-unavailable"
              disabled
              type="button"
            >
              {copyText.detail.confirmUnavailable}
            </button>
          ) : null}
          {!legacyVideo && exportHref ? (
            <ResultDoorway href={exportHref} testId="works-action-export">
              {copyText.detail.export}
            </ResultDoorway>
          ) : null}
          {!legacyVideo && adoptHref ? (
            <ResultDoorway href={adoptHref} testId="works-action-adopt">
              {copyText.detail.adopt}
            </ResultDoorway>
          ) : null}
          {!legacyVideo && adjustHref ? (
            <ResultDoorway href={adjustHref} testId="works-action-adjust">
              {copyText.detail.adjust}
            </ResultDoorway>
          ) : null}
          {!legacyVideo &&
          detail.exportability === 'text_only' &&
          textExport ? (
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
          {!legacyVideo && handoffHref ? (
            <ResultDoorway href={handoffHref} testId="works-action-handoff">
              {copyText.detail.handoff}
            </ResultDoorway>
          ) : null}
        </div>
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

export function WorksDetailPage({
  restoreFocusKey,
  restoreScrollY,
  workId,
}: {
  restoreFocusKey?: ResultReturnFocusKey;
  restoreScrollY?: number;
  workId: string;
}) {
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

  useEffect(() => {
    if (loading || failed || detail.kind !== 'package') return;
    if (restoreScrollY && restoreScrollY > 0) {
      window.scrollTo(0, restoreScrollY);
    }
    if (restoreFocusKey === 'works-detail-actions') {
      document
        .querySelector<HTMLElement>('[data-testid="works-detail-actions"]')
        ?.focus();
    }
  }, [detail.kind, failed, loading, restoreFocusKey, restoreScrollY]);

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
      <WorkPackageBody archiveId={workId} detail={detail} />
    </WorksFrame>
  );
}
