/**
 * 作品轻编辑壳 — T32 / #226.
 *
 * 归桶矩阵 §3: LightComposerCanvas is the KEEP capability core (Composer 轻编辑,
 * ADR-0012 P1 主线) and only its *page shell* reshells with 作品. So this file
 * carries the same canonical commands the old `canvas-work-page` shell issued —
 * save_canvas_revision / save_user_template / set_creation_labels / export_work
 * / adopt_canvas_work_export / upgrade_work_template — and changes nothing
 * about the core's props or behaviour.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { PromotionalMaterialReceiptExtension } from '@meiye/contracts';

import { DashboardHeader } from '@/components/layout/dashboard-header';
import { formatBytes } from '@/lib/formatter';
import { formatLocaleDateTime } from '@/lib/locale';
import { canvasName } from '@/p1/canvas-name';
import { productAssetsToCanvasLibrary } from '@/p1/canvas-product-assets';
import type { RawTemplate } from '@/p1/operations-view-model';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { RawCanvasWork } from '@/product/canonical-history-model';
import { useProductState } from '@/product/client';
import {
  LightComposerCanvas,
  type LightCanvasSnapshot,
} from '@/product/light-composer-canvas';
import type { parseLightComposerCarrier } from '@/p1/content-package-export-carrier';
import { parseLightCanvasDocument } from '@/product/light-composer-document';
import { PromotionalMaterialReceiptStatus } from '@/product/promotional-material-receipt';

import { WORKS_TITLE } from './works-list-page';
import { canvasRenderEvidenceMarker } from './works-render-evidence';

type ExportCarrier = ReturnType<typeof parseLightComposerCarrier>;

type ExportReceipt = {
  id: string;
  bytes: number;
  createdAt: string;
  format: string;
  promotionalMaterialReceipt?: PromotionalMaterialReceiptExtension;
  sha256: string;
  workRevisionId: string;
};

export function WorksLightEditPage({
  exportUseDelivery,
  workId,
}: {
  exportUseDelivery?: ExportCarrier;
  workId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const product = useProductState();
  const [templateName, setTemplateName] = useState('');
  const [exportUrl, setExportUrl] = useState<string>();

  const workQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'work', { workId }),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanvasWork>('work', { workId }, signal),
  });
  const templatesQuery = useQuery({
    enabled: Boolean(workQuery.data?.templateId),
    queryKey: p1QueryKeys.request('operations', 'templates'),
    queryFn: ({ signal }) =>
      operationsQuery<RawTemplate[]>('templates', {}, signal),
  });
  const receiptsQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'export_receipts', { workId }),
    queryFn: ({ signal }) =>
      operationsQuery<ExportReceipt[]>('export_receipts', { workId }, signal),
  });

  const work = workQuery.data;
  const revision = work?.revisions.find(
    (candidate) => candidate.id === work.currentRevisionId
  );

  const refreshWork = async () => {
    await Promise.all([
      workQuery.refetch(),
      receiptsQuery.refetch(),
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'canonical_history'),
      }),
    ]);
  };
  const command = useMutation({
    mutationFn: (input: { action: string; payload: Record<string, unknown> }) =>
      operationsCommand(input.action, input.payload),
    onSuccess: refreshWork,
    onError: () => toast.error('这一步没成功，请再试一次。'),
  });

  const frame = (children: React.ReactNode, title: string) => (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: WORKS_TITLE, href: '/dashboard/works' },
          { label: title, isCurrentPage: true },
        ]}
      />
      <div
        className="meiye-heroui-glass @container/main flex flex-1 flex-col gap-2"
        data-testid="works-light-edit-surface"
      >
        <div className="flex flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-6 lg:py-6">
          {children}
        </div>
      </div>
    </>
  );

  if (workQuery.isLoading) {
    return frame(
      <p className="text-muted text-sm" data-testid="works-light-edit-loading">
        正在打开轻编辑…
      </p>,
      WORKS_TITLE
    );
  }
  if (workQuery.isError || !work || !revision) {
    return frame(
      <div className="meiye-porcelain rounded-2xl p-6">
        <p className="meiye-type-body font-semibold">没找到这份作品</p>
        <p className="text-muted mt-2 text-sm">它可能已经被替换或删除了。</p>
      </div>,
      WORKS_TITLE
    );
  }

  const displayName = canvasName(work.name);
  const lightDocument = parseLightCanvasDocument(revision.document);
  const template = templatesQuery.data?.find(
    (candidate) => candidate.id === work.templateId
  );
  const templateUpdate =
    work.templateVersionId &&
    template?.publishedVersionId &&
    work.templateVersionId !== template.publishedVersionId
      ? {
          publishedVersionId: template.publishedVersionId,
          templateId: template.id,
        }
      : undefined;

  return frame(
    <>
      <div className="meiye-ambient-copy">
        <div className="flex flex-wrap items-center gap-2">
          <span className="meiye-glass-piece rounded-full px-2.5 py-0.5 text-xs">
            轻编辑
          </span>
          <span
            className="text-muted text-xs"
            data-revision={revision.revision}
            data-testid="works-light-edit-revision"
          >
            第 {revision.revision} 版 · 共 {work.revisions.length} 版
          </span>
        </div>
        <h1 className="meiye-type-title mt-2">{displayName}</h1>
      </div>

      {templateUpdate ? (
        <section
          className="meiye-porcelain rounded-2xl p-4"
          data-testid="works-template-update"
        >
          <p className="meiye-type-body font-semibold">这个版式有新版本</p>
          <p className="text-muted mt-1 text-sm">
            可以把这份作品换到新版式，也可以另存一份再改。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="meiye-glass-piece rounded-full px-4 py-2 text-sm disabled:opacity-50"
              disabled={command.isPending}
              onClick={() =>
                command.mutate({
                  action: 'upgrade_work_template',
                  payload: {
                    templateVersionId: templateUpdate.publishedVersionId,
                    workId: work.id,
                  },
                })
              }
              type="button"
            >
              换到新版式
            </button>
            <button
              className="meiye-glass-piece rounded-full px-4 py-2 text-sm disabled:opacity-50"
              disabled={command.isPending}
              onClick={() =>
                command.mutate({
                  action: 'copy_template_version_to_work',
                  payload: {
                    sourceWorkId: work.id,
                    templateId: templateUpdate.templateId,
                    templateVersionId: templateUpdate.publishedVersionId,
                  },
                })
              }
              type="button"
            >
              另存一份新的
            </button>
          </div>
        </section>
      ) : null}

      <LightComposerCanvas
        aigcLabelEnabled={work.aigcLabelEnabled}
        document={lightDocument}
        documentRevision={revision.id}
        exporting={command.isPending}
        initialPromotionalMaterialPurpose={
          exportUseDelivery?.materialSpecs[0]?.purpose
        }
        libraryAssets={productAssetsToCanvasLibrary(
          product.state?.assets ?? []
        )}
        onAigcLabelChange={(enabled) =>
          command.mutate({
            action: 'set_creation_labels',
            payload: {
              aigcLabelEnabled: enabled,
              brandWatermarkEnabled: work.brandWatermarkEnabled,
              workId: work.id,
            },
          })
        }
        onExport={async (result) => {
          const document = result.snapshot.document;
          const saved = await operationsCommand<{ id: string }>(
            'save_canvas_revision',
            {
              document,
              sourceRevisionId: result.snapshot.sourceRevision,
              workId: work.id,
            }
          );
          const receipt = await operationsCommand<{ id: string }>(
            exportUseDelivery?.receiptCommand ?? 'export_work',
            {
              request: {
                aigcLabelEnabled: result.snapshot.aigcLabelEnabled,
                brandWatermarkEnabled: result.snapshot.watermarkEnabled,
                brandWatermarkText: displayName,
                format: 'png',
                height: Number(document.height ?? 1350),
                renderedDataUrl: result.dataUrl,
                renderEvidenceMarker: await canvasRenderEvidenceMarker(
                  result.dataUrl,
                  document as unknown as Record<string, unknown>
                ),
                ...(result.materialSpec
                  ? { promotionalMaterialSpec: result.materialSpec }
                  : {}),
                ...(result.promotionalMaterialReceipt
                  ? {
                      promotionalMaterialReceipt: {
                        ...result.promotionalMaterialReceipt,
                        provenanceRef: saved.id,
                      },
                    }
                  : {}),
                width: Number(document.width ?? 1080),
                workRevisionId: saved.id,
              },
              workId: work.id,
            }
          );
          const contentPackage = await operationsCommand<{ id: string }>(
            'adopt_canvas_work_export',
            {
              exportReceiptId: receipt.id,
              workId: work.id,
              workRevisionId: saved.id,
            }
          );
          setExportUrl(result.dataUrl);
          await refreshWork();
          await navigate({
            params: { workId: contentPackage.id },
            to: '/dashboard/works/$workId',
          });
        }}
        onSave={async (snapshot: LightCanvasSnapshot) => {
          await operationsCommand('save_canvas_revision', {
            document: snapshot.document,
            sourceRevisionId: snapshot.sourceRevision,
            workId: work.id,
          });
          await refreshWork();
          toast.success('这一版已保存。');
        }}
        onSaveAsTemplate={async (snapshot) => {
          const name = templateName.trim();
          await operationsCommand('save_user_template', {
            document: snapshot.document,
            ...(name ? { name } : {}),
            sourceRevisionId: snapshot.sourceRevision,
            workId: work.id,
          });
          await refreshWork();
          toast.success('已存为你的模板。');
        }}
        onWatermarkChange={(enabled) =>
          command.mutate({
            action: 'set_creation_labels',
            payload: {
              aigcLabelEnabled: work.aigcLabelEnabled,
              brandWatermarkEnabled: enabled,
              workId: work.id,
            },
          })
        }
        promotionalMaterialSpecs={exportUseDelivery?.materialSpecs}
        saving={command.isPending}
        watermarkEnabled={work.brandWatermarkEnabled}
        watermarkText={displayName}
      />

      <section className="meiye-porcelain rounded-2xl p-4">
        <label
          className="grid max-w-md gap-1.5 text-sm font-medium"
          htmlFor="works-template-name"
        >
          存为模板时叫什么
          <input
            className="meiye-glass-piece rounded-full px-3 py-2 text-sm outline-none"
            id="works-template-name"
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder={`${displayName} 模板`}
            value={templateName}
          />
        </label>
        {exportUrl ? (
          <a
            className="mt-3 inline-block text-sm underline underline-offset-4"
            download={`${displayName}.png`}
            href={exportUrl}
          >
            下载刚导出的这张
          </a>
        ) : null}
        {(receiptsQuery.data ?? []).length > 0 ? (
          <ol className="text-muted mt-3 space-y-2 text-xs">
            {receiptsQuery.data!.slice(0, 5).map((receipt) => (
              <li className="rounded-xl border p-2" key={receipt.id}>
                {formatLocaleDateTime(receipt.createdAt)} ·{' '}
                {receipt.format.toUpperCase()} · {formatBytes(receipt.bytes)}
                {receipt.promotionalMaterialReceipt ? (
                  <PromotionalMaterialReceiptStatus
                    receipt={receipt.promotionalMaterialReceipt}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted mt-3 text-sm">还没有导出记录。</p>
        )}
      </section>
    </>,
    displayName
  );
}
