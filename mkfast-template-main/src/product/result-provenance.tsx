import type { CreativeJob } from '@meiye/contracts';

import { Badge } from '@/components/ui/badge';
import {
  canonical_canvas_job_actual_model,
  workbench_local_fixture_description,
  workbench_local_fixture_title,
} from '@/locale/paraglide/messages';

export function ResultProvenance({ job }: { job: CreativeJob }) {
  const frozen = job.executionProvenance;
  const provenance =
    frozen?.activationStatus === 'recorded'
      ? 'local_fixture'
      : frozen?.activationStatus === 'live_verified'
        ? 'production'
        : 'unknown';
  const localFixture = provenance === 'local_fixture';
  const modelLabel =
    frozen?.modelDisplayName ??
    frozen?.actualCatalogModelId ??
    job.contract.catalogModelId;

  return (
    <div
      className="mb-4 space-y-2 rounded-md bg-surface-2 p-3"
      data-catalog-model-id={
        frozen?.actualCatalogModelId ?? job.contract.catalogModelId
      }
      data-provider-model={frozen?.providerModel ?? ''}
      data-provenance={provenance}
      data-route-snapshot-id={job.routeSnapshotId ?? ''}
      data-testid="result-provenance"
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {canonical_canvas_job_actual_model({ model: modelLabel })}
        </Badge>
        {localFixture ? (
          <Badge variant="outline">{workbench_local_fixture_title()}</Badge>
        ) : null}
      </div>
      {localFixture ? (
        <p className="text-xs text-muted-foreground">
          {workbench_local_fixture_description()}
        </p>
      ) : null}
    </div>
  );
}
