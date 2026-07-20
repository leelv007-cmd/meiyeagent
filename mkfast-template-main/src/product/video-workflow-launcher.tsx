import type { CreativeExecutionContract } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  video_workflow_launcher_catalog_loading,
  video_workflow_launcher_catalog_unavailable,
  video_workflow_launcher_quota,
  video_workflow_launcher_quota_empty,
  video_workflow_launcher_usage_unavailable,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  type CatalogModelView,
} from '@/p1/settings-view-model';
import type { AccountUsageProjection } from '@/product/account-usage';
import { creativeQuoteRevision, quoteFor } from '@/product/creative-quote';
import type { VideoDataClass } from '@/product/video-workflow-model';
import { VideoWorkflowPanel } from '@/product/video-workflow-panel';

interface RawCatalog {
  deployments?: unknown[];
  models?: unknown[];
  payload?: {
    deployments?: unknown[];
    models?: unknown[];
    revisionId?: string;
  };
  revisionId?: string;
}

interface VideoWorkflowCompliance {
  aigcLabelEnabled: boolean;
  watermarkEnabled: boolean;
}

function catalogRevision(value: RawCatalog) {
  return value.payload?.revisionId ?? value.revisionId;
}

export function videoWorkflowLaunchPlan(
  rawCatalog: RawCatalog,
  compliance: VideoWorkflowCompliance,
  quoteAcceptedAt: string,
  dataClass: readonly VideoDataClass[] = []
): {
  contract: CreativeExecutionContract;
  model: CatalogModelView;
  modelNames: Record<string, string>;
} | null {
  const catalog = normalizeCatalog(rawCatalog, 'video.generate');
  const model = catalog.models.find(
    (candidate) => candidate.available && candidate.unitPrice
  );
  const revisionId = catalogRevision(rawCatalog);
  const quote = quoteFor('video.generate', model, '9:16');
  if (
    !model?.unitPrice ||
    !revisionId ||
    quote.estimatedAmount === undefined ||
    !quote.currency ||
    !quote.priceRevision
  ) {
    return null;
  }
  return {
    contract: {
      aigcLabelEnabled: compliance.aigcLabelEnabled,
      aspectRatio: '9:16',
      catalogModelId: model.id,
      catalogRevision: revisionId,
      currency: quote.currency,
      dataClass: [...dataClass],
      durationSeconds: 15,
      estimatedAmount: quote.estimatedAmount,
      operation: 'video.generate',
      outputCount: quote.outputCount,
      outputLabel: quote.outputLabel,
      quoteAcceptedAt,
      quoteRevision: creativeQuoteRevision({
        aspectRatio: '9:16',
        catalogModelId: model.id,
        catalogRevision: revisionId,
        operation: 'video.generate',
        priceRevision: quote.priceRevision,
      }),
      watermarkEnabled: compliance.watermarkEnabled,
    },
    model,
    modelNames: Object.fromEntries(
      catalog.models.map((candidate) => [candidate.id, candidate.displayName])
    ),
  };
}

export function VideoWorkflowLauncher({
  brandWatermarkText,
  className,
  compliance,
  dataClass = [],
  intent,
  referenceAssetIds = [],
  workId,
}: {
  brandWatermarkText?: string;
  className?: string;
  compliance: VideoWorkflowCompliance;
  dataClass?: readonly VideoDataClass[];
  intent: string;
  referenceAssetIds?: readonly string[];
  workId: string;
}) {
  const [quoteAcceptedAt] = useState(() => new Date().toISOString());
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'catalog', {
      operation: 'video.generate',
    }),
    queryFn: ({ signal }) =>
      queryP1<RawCatalog>(
        'model-supply',
        { action: 'catalog', payload: { operation: 'video.generate' } },
        signal
      ),
    retry: false,
  });
  const usageQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
    retry: false,
  });
  const plan = catalogQuery.data
    ? videoWorkflowLaunchPlan(
        catalogQuery.data,
        compliance,
        quoteAcceptedAt,
        dataClass
      )
    : null;

  if (catalogQuery.isPending || usageQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {video_workflow_launcher_catalog_loading()}
      </p>
    );
  }
  if (catalogQuery.error || !plan) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {video_workflow_launcher_catalog_unavailable()}
      </p>
    );
  }
  if (usageQuery.error || !usageQuery.data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {video_workflow_launcher_usage_unavailable()}
      </p>
    );
  }
  const usage = usageQuery.data.usage.video;
  if (usage.available < 1) {
    return (
      <p className="text-sm text-muted-foreground">
        {video_workflow_launcher_quota_empty()}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {video_workflow_launcher_quota({
          allowance: usage.allowance,
          available: usage.available,
        })}
      </p>
      <VideoWorkflowPanel
        aigcLabelEnabled={compliance.aigcLabelEnabled}
        brandWatermarkText={brandWatermarkText}
        catalogModelId={plan.model.id}
        catalogModelName={plan.model.displayName}
        catalogModelNames={plan.modelNames}
        className={className}
        dataClass={dataClass}
        executionContract={plan.contract}
        intent={intent}
        referenceAssetIds={referenceAssetIds}
        workId={workId}
      />
    </div>
  );
}
