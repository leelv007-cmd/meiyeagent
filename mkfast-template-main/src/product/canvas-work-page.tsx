import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { StatePanel } from '@/components/uiux/state-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  canonical_history_works_title,
  canvas_work_action_failed,
  canvas_work_description,
  canvas_work_download_latest,
  canvas_work_export_data_missing,
  canvas_work_exports_empty,
  canvas_work_loading_description,
  canvas_work_loading_title,
  canvas_work_not_found_description,
  canvas_work_not_found_title,
  canvas_work_revision,
  canvas_work_revision_count,
  canvas_work_revision_saved,
  canvas_work_template_blank,
  canvas_work_template_fixed,
  canvas_work_template_label,
  canvas_work_template_name,
  canvas_work_template_saved,
  canvas_work_templates_exports_title,
  canvas_work_update_copy,
  canvas_work_update_current,
  canvas_work_update_description,
  canvas_work_update_title,
  object_evidence_source_canvas,
} from '@/locale/paraglide/messages';
import { formatBytes } from '@/lib/formatter';
import { formatLocaleDateTime } from '@/lib/locale';
import { productAssetsToCanvasLibrary } from '@/p1/canvas-product-assets';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { canvasName } from '@/p1/canvas-name';
import type { RawTemplate } from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { useProductState } from '@/product/client';
import type { RawCanvasWork } from './canonical-history-model';
import {
  LightComposerCanvas,
  type LightCanvasSnapshot,
} from './light-composer-canvas';
import { parseLightCanvasDocument } from './light-composer-document';

function currentRevision(work: RawCanvasWork) {
  return work.revisions.find(
    (revision) => revision.id === work.currentRevisionId
  );
}

async function canvasRenderEvidenceMarker(
  dataUrl: string,
  document: Record<string, unknown>
) {
  const encoded = dataUrl.split(',', 2)[1];
  if (!encoded) throw new Error(canvas_work_export_data_missing());
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const rasterSha256 = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const elements = Array.isArray(document.pages)
    ? document.pages.flatMap((page) => {
        if (!page || typeof page !== 'object') return [];
        const value = (page as { elements?: unknown }).elements;
        return Array.isArray(value) ? value : [];
      })
    : [];
  const imageElementIds = new Set<string>();
  const fontFamilies = new Set<string>();
  const cjkLineBreakElementIds = new Set<string>();
  for (const value of elements) {
    if (!value || typeof value !== 'object') continue;
    const element = value as Record<string, unknown>;
    if (element.kind === 'image' && typeof element.id === 'string') {
      imageElementIds.add(element.id);
    }
    if (element.kind !== 'text') continue;
    if (typeof element.fontFamily === 'string' && element.fontFamily.trim()) {
      fontFamilies.add(element.fontFamily.trim());
    }
    if (
      typeof element.id === 'string' &&
      typeof element.text === 'string' &&
      /\p{Script=Han}/u.test(element.text) &&
      /\r?\n/u.test(element.text)
    ) {
      cjkLineBreakElementIds.add(element.id);
    }
  }
  return {
    cjkLineBreakElementIds: [...cjkLineBreakElementIds].sort(),
    fontFamilies: [...fontFamilies].sort(),
    imageElementIds: [...imageElementIds].sort(),
    rasterSha256,
    version: 'canvas-raster-v1' as const,
  };
}

export function CanvasWorkPage({ workId }: { workId: string }) {
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
      operationsQuery<
        Array<{
          id: string;
          bytes: number;
          createdAt: string;
          format: string;
          sha256: string;
          workRevisionId: string;
        }>
      >('export_receipts', { workId }, signal),
  });
  const work = workQuery.data;
  const revision = work ? currentRevision(work) : undefined;
  const template = templatesQuery.data?.find(
    (item) => item.id === work?.templateId
  );
  const updateAvailable = Boolean(
    work?.templateVersionId &&
      template?.publishedVersionId &&
      work.templateVersionId !== template.publishedVersionId
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
    onError: () => toast.error(canvas_work_action_failed()),
  });

  const save = async (snapshot: LightCanvasSnapshot) => {
    if (!work || !revision) return;
    await operationsCommand('save_canvas_revision', {
      document: snapshot.document,
      sourceRevisionId: snapshot.sourceRevision,
      workId: work.id,
    });
    await refreshWork();
    toast.success(canvas_work_revision_saved());
  };

  if (workQuery.isLoading) {
    return (
      <StatePanel
        kind="loading"
        title={canvas_work_loading_title()}
        description={canvas_work_loading_description()}
      />
    );
  }
  if (workQuery.isError || !work || !revision) {
    return (
      <StatePanel
        kind="empty"
        title={canvas_work_not_found_title()}
        description={canvas_work_not_found_description()}
      />
    );
  }
  const displayName = canvasName(work.name);
  const lightDocument = parseLightCanvasDocument(revision.document);

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: canonical_history_works_title(), isCurrentPage: false },
        { label: displayName, isCurrentPage: true },
      ]}
      description={canvas_work_description()}
      title={displayName}
    >
      <ObjectEvidence
        id={work.id}
        kind="Work"
        source={object_evidence_source_canvas()}
      />
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {canvas_work_revision({ revision: revision.revision })}
        </Badge>
        <Badge variant="outline">
          {canvas_work_revision_count({ count: work.revisions.length })}
        </Badge>
        <Badge variant="outline">
          {work.templateVersionId
            ? canvas_work_template_fixed()
            : canvas_work_template_blank()}
        </Badge>
      </div>

      {updateAvailable && template?.publishedVersionId ? (
        <Alert>
          <AlertTitle>{canvas_work_update_title()}</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>{canvas_work_update_description()}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={command.isPending}
                onClick={() =>
                  command.mutate({
                    action: 'upgrade_work_template',
                    payload: {
                      templateVersionId: template.publishedVersionId!,
                      workId: work.id,
                    },
                  })
                }
              >
                {canvas_work_update_current()}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={command.isPending}
                onClick={() =>
                  command.mutate({
                    action: 'copy_template_version_to_work',
                    payload: {
                      sourceWorkId: work.id,
                      templateId: template.id,
                      templateVersionId: template.publishedVersionId!,
                    },
                  })
                }
              >
                {canvas_work_update_copy()}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <LightComposerCanvas
        document={lightDocument}
        documentRevision={revision.id}
        libraryAssets={productAssetsToCanvasLibrary(
          product.state?.assets ?? []
        )}
        watermarkEnabled={work.brandWatermarkEnabled}
        watermarkText={displayName}
        aigcLabelEnabled={work.aigcLabelEnabled}
        saving={command.isPending}
        exporting={command.isPending}
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
        onSave={save}
        onSaveAsTemplate={async (snapshot) => {
          const name = templateName.trim();
          await operationsCommand('save_user_template', {
            document: snapshot.document,
            ...(name ? { name } : {}),
            sourceRevisionId: snapshot.sourceRevision,
            workId: work.id,
          });
          await refreshWork();
          toast.success(canvas_work_template_saved());
        }}
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
            'export_work',
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
            search: { packageId: contentPackage.id },
            to: '/dashboard/content',
          });
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {canvas_work_templates_exports_title()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            className="grid max-w-md gap-1.5 text-sm font-medium"
            htmlFor="canvas-template-name"
          >
            {canvas_work_template_label()}
            <Input
              id="canvas-template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder={canvas_work_template_name({ name: displayName })}
            />
          </label>
          {exportUrl ? (
            <a
              className="text-sm font-medium text-primary underline"
              href={exportUrl}
              download={`${displayName}.png`}
            >
              {canvas_work_download_latest()}
            </a>
          ) : null}
          {(receiptsQuery.data ?? []).length > 0 ? (
            <ol className="space-y-2 text-xs text-muted-foreground">
              {receiptsQuery.data!.slice(0, 5).map((receipt) => (
                <li key={receipt.id} className="rounded-md border p-2">
                  {formatLocaleDateTime(receipt.createdAt)} ·{' '}
                  {receipt.format.toUpperCase()} · {formatBytes(receipt.bytes)}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canvas_work_exports_empty()}
            </p>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
