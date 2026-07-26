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
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { IconExternalLink } from '@tabler/icons-react';
import type { PublicContentPackage } from '@meiye/contracts';

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { getPathWithLocale } from '@/lib/urls';
import { commandP1 } from '@/p1/client';
import { ContentPackageExportCarrier } from '@/p1/content-package-export-carrier';

import { WorksLightEditPage } from './works-light-edit-page';
import { WorksMediaGallery } from './works-media-gallery';
import { useWorksProjection, WORKS_TITLE } from './works-list-page';
import {
  WORK_OUTPUT_SHAPE_LABELS,
  workCopyText,
  workDetail,
  workExportIdempotencyKey,
  workHandoffHref,
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
          { label: WORKS_TITLE, href: '/dashboard/works' },
          { label: title, isCurrentPage: true },
        ]}
      />
      <div
        className="meiye-heroui-glass @container/main flex flex-1 flex-col gap-2"
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
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [exported, setExported] = useState<ExportOutcome>();
  const handoffHref = workHandoffHref(detail);
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
        throw new Error('这份作品还没有可导出的成品版本。');
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
    onError: (error) =>
      setFailure(error instanceof Error ? error.message : '导出暂时没成功。'),
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
      setFailure('这台设备不让直接复制，长按选中文字也可以。');
    }
  };

  return (
    <>
      <div className="meiye-ambient-copy">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="meiye-glass-piece rounded-full px-2.5 py-0.5 text-xs"
            data-testid="works-detail-shape"
          >
            {WORK_OUTPUT_SHAPE_LABELS[detail.outputShape]}
          </span>
          <span className="text-muted text-xs">{detail.statusLabel}</span>
          {detail.confirmedRevision ? (
            <span
              className="text-muted text-xs"
              data-package-id={detail.confirmedRevision.packageId}
              data-revision={detail.confirmedRevision.revision}
              data-testid="works-detail-revision"
              data-version-id={detail.confirmedRevision.versionId}
            >
              第 {detail.confirmedRevision.revision} 版
            </span>
          ) : null}
        </div>
        <h1 className="meiye-type-title mt-2">{detail.title}</h1>
      </div>

      {detail.media.length > 0 ? (
        <WorksMediaGallery media={detail.media} />
      ) : null}

      {detail.body ? (
        <section className="meiye-porcelain rounded-2xl p-4">
          <p
            className="meiye-type-body whitespace-pre-wrap"
            data-testid="works-detail-body"
          >
            {detail.body}
          </p>
          {detail.topics.length > 0 ? (
            <p className="text-muted mt-3 text-xs">
              {detail.topics.map((topic) => `#${topic}`).join(' ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className="meiye-porcelain rounded-2xl p-4"
        data-testid="works-detail-guidance"
      >
        <h2 className="meiye-type-body font-semibold">怎么用这份作品</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {detail.guidance.map((line) => (
            <li className="text-muted text-sm" key={line}>
              {line}
            </li>
          ))}
        </ul>
        {detail.evidence.length > 0 ? (
          <>
            <h2 className="meiye-type-body mt-4 font-semibold">生成依据</h2>
            <ul
              className="mt-2 flex flex-wrap gap-2"
              data-testid="works-detail-evidence"
            >
              {detail.evidence.map((chip) => (
                <li
                  className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
                  key={chip.id}
                >
                  {chip.label}
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
          <ActionButton
            busy={exportPackage.isPending || !detail.confirmedRevision}
            onClick={() => exportPackage.mutate()}
            testId="works-action-export"
          >
            {exportPackage.isPending ? '正在导出…' : '导出使用'}
          </ActionButton>
          <ActionButton onClick={copy} testId="works-action-copy">
            {copied ? '已复制' : '复制文字'}
          </ActionButton>
          {handoffHref ? (
            <a
              className="meiye-glass-piece min-h-touch-target inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm"
              data-testid="works-action-handoff"
              href={getPathWithLocale(handoffHref)}
            >
              协办交接
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
            下载这一版的交付包
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

export function WorksDetailPage({ workId }: { workId: string }) {
  const navigate = useNavigate();
  const { contentPackages, history } = useWorksProjection();
  const source = useMemo(
    () => ({
      canvasWorks: history.data?.canvasWorks ?? [],
      contentPackages: contentPackages.data ?? [],
      id: workId,
    }),
    [contentPackages.data, history.data, workId]
  );
  const detail = useMemo(() => workDetail(source), [source]);

  if (contentPackages.isLoading || history.isLoading) {
    return (
      <WorksFrame title={WORKS_TITLE}>
        <p className="text-muted text-sm" data-testid="works-detail-loading">
          正在打开这份作品…
        </p>
      </WorksFrame>
    );
  }

  if (detail.kind === 'canvas') {
    return <WorksLightEditPage workId={detail.workId} />;
  }

  if (detail.kind === 'missing') {
    return (
      <WorksFrame title={WORKS_TITLE}>
        <div
          className="meiye-porcelain rounded-2xl p-6"
          data-testid="works-detail-missing"
        >
          <h1 className="meiye-type-body font-semibold">没找到这份作品</h1>
          <p className="text-muted mt-2 text-sm">
            它可能还没生成完，或者已经被换成了新的一版。
          </p>
          <button
            className="meiye-glass-piece mt-4 rounded-full px-4 py-2 text-sm"
            onClick={() => void navigate({ to: '/dashboard/works' })}
            type="button"
          >
            回到作品列表
          </button>
        </div>
      </WorksFrame>
    );
  }

  const contentPackage = (contentPackages.data ?? []).find(
    (candidate) => candidate.id === detail.packageId
  );

  return (
    <WorksFrame title={detail.title}>
      {contentPackage ? (
        <WorkPackageBody contentPackage={contentPackage} detail={detail} />
      ) : (
        <>
          <div className="meiye-ambient-copy">
            <h1 className="meiye-type-title">{detail.title}</h1>
            <p className="meiye-type-aux mt-1">{detail.statusLabel}</p>
          </div>
          <section
            className="meiye-porcelain rounded-2xl p-4"
            data-testid="works-detail-guidance"
          >
            <ul className="flex flex-col gap-1">
              {detail.guidance.map((line) => (
                <li className="text-muted text-sm" key={line}>
                  {line}
                </li>
              ))}
            </ul>
          </section>
          <Link
            className="text-sm underline underline-offset-4"
            to="/dashboard/works"
          >
            回到作品列表
          </Link>
        </>
      )}
    </WorksFrame>
  );
}
