import type {
  CapabilityDependencyEdge,
  CapabilityInventoryItem,
  CapabilityRegistryEntry,
} from '@meiye/contracts';

import {
  AvailabilityStatusBadge,
  InstrumentStatusBadge,
} from '@/components/admin/capability/capability-status-badge';
import { MetricEnvelopeView } from '@/components/admin/capability/metric-envelope-view';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Separator } from '@/components/ui/separator';
import type { CapabilitySixQuestionProjection } from '@/p1/admin-capability-registry-model';
import {
  admin_capability_allowed_safe_actions_752db8df,
  admin_capability_call_volume_412ad29f,
  admin_capability_complete_6e6e5811,
  admin_capability_config_revision_and_effective_scope_6bd71afc,
  admin_capability_copy_bbeca838,
  admin_capability_cost_c78bb59f,
  admin_capability_d_051_six_question_fields_b4aaad1c,
  admin_capability_dependencies_b613ae88,
  admin_capability_dependencies_forward_c02e9746,
  admin_capability_dependency_forward_reverse_lookup_static_6cd981d1,
  admin_capability_dependents_reverse_e3de259c,
  admin_capability_evidence_source_suffix,
  admin_capability_evidence_time_d55733fd,
  admin_capability_missing_2fe9b758,
  admin_capability_no_reverse_dependents_033d10df,
  admin_capability_not_instrumented_fbb74e8c,
  admin_capability_not_instrumented_operational_facts_not_w_5fc10507,
  admin_capability_not_verified_0800371a,
  admin_capability_operational_facts_9e7769a3,
  admin_capability_operational_facts_operationalmetric_7efed438,
  admin_capability_operational_facts_summary_d5d5df88,
  admin_capability_p95_latency_ba65a873,
  admin_capability_purpose_and_availability_ae9b9db4,
  admin_capability_quota_headroom_94ccca4a,
  admin_capability_recent_changes_and_audit_refs_4649e007,
  admin_capability_safe_actions_handoff_envelope_40eb0ad5,
  admin_capability_six_question_field_coverage_48d846f5,
  admin_capability_success_rate_df9dc72f,
  admin_capability_technical_handoff_envelope_41c55a95,
} from '@/locale/paraglide/messages';

const QUESTION_TITLES: Record<
  keyof CapabilitySixQuestionProjection['questions'],
  string
> = {
  purposeStatus: admin_capability_purpose_and_availability_ae9b9db4(),
  configRevisionScope:
    admin_capability_config_revision_and_effective_scope_6bd71afc(),
  dependencies: admin_capability_dependencies_b613ae88(),
  runtimeFacts: admin_capability_operational_facts_summary_d5d5df88(),
  recentEvidence: admin_capability_recent_changes_and_audit_refs_4649e007(),
  safeActionsHandoff: admin_capability_safe_actions_handoff_envelope_40eb0ad5(),
};

function CompletenessMark({
  status,
}: {
  status: CapabilitySixQuestionProjection['questions'][keyof CapabilitySixQuestionProjection['questions']]['status'];
}) {
  if (status === 'complete') {
    return (
      <Badge variant="success-outline" data-completeness="complete">
        {admin_capability_complete_6e6e5811()}
      </Badge>
    );
  }
  if (status === 'not_instrumented') {
    return (
      <Badge
        variant="secondary"
        data-completeness="not_instrumented"
        data-testid="not-instrumented-mark"
      >
        {admin_capability_not_instrumented_fbb74e8c()}
      </Badge>
    );
  }
  if (status === 'not_verified') {
    return (
      <Badge variant="secondary" data-completeness="not_verified">
        {admin_capability_not_verified_0800371a()}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive-outline" data-completeness="missing">
      {admin_capability_missing_2fe9b758()}
    </Badge>
  );
}

export function CapabilityDetailCard({
  item,
  entry,
  projection,
  dependsOn,
  dependents,
}: {
  item: CapabilityInventoryItem;
  entry: CapabilityRegistryEntry;
  projection: CapabilitySixQuestionProjection;
  dependsOn: CapabilityDependencyEdge[];
  dependents: CapabilityDependencyEdge[];
}) {
  const facts = entry.runtimeFacts;
  const showRuntimeMetrics =
    entry.instrumentStatus === 'instrumented' && facts != null;

  return (
    <Frame data-testid="capability-detail-card" data-capability-id={entry.id}>
      <FrameHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FrameTitle className="text-base">{item.name}</FrameTitle>
          <AvailabilityStatusBadge status={entry.availability} />
          <InstrumentStatusBadge status={entry.instrumentStatus} />
        </div>
        <FrameDescription className="space-y-1">
          <p>{entry.purpose}</p>
          <p className="font-mono text-xs">
            id={entry.id} · owner={entry.owner} · drilldown={entry.drilldownKey}
          </p>
          {entry.evidenceFreshness?.capturedAt ? (
            <p className="text-xs">
              {admin_capability_evidence_time_d55733fd()}{' '}
              {entry.evidenceFreshness.capturedAt}
              {entry.evidenceFreshness.source
                ? admin_capability_evidence_source_suffix({
                    source: entry.evidenceFreshness.source,
                  })
                : ''}
            </p>
          ) : null}
        </FrameDescription>
      </FrameHeader>

      <FramePanel
        className="flex flex-col gap-0 p-0!"
        data-testid="six-question-projection"
        aria-label={admin_capability_six_question_field_coverage_48d846f5()}
      >
        <h3 className="text-muted-foreground px-4 py-2 text-sm font-medium">
          {admin_capability_d_051_six_question_fields_b4aaad1c()}
        </h3>
        <Separator />
        <dl>
          {(
            Object.keys(QUESTION_TITLES) as Array<keyof typeof QUESTION_TITLES>
          ).map((key) => {
            const question = projection.questions[key];
            return (
              <div
                key={key}
                className="border-b px-4 py-3 last:border-b-0"
                data-question={key}
                data-question-status={question.status}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <dt className="text-sm font-medium">
                    {QUESTION_TITLES[key]}
                  </dt>
                  <CompletenessMark status={question.status} />
                </div>
                <dd className="text-muted-foreground text-sm">
                  {question.summary}
                  {question.reason ? (
                    <span className="mt-1 block font-mono text-xs">
                      reason={question.reason}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </FramePanel>

      {showRuntimeMetrics ? (
        <FramePanel className="space-y-3" data-testid="runtime-facts-metrics">
          <h3 className="text-sm font-semibold">
            {admin_capability_operational_facts_operationalmetric_7efed438()}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.calls ? (
              <MetricEnvelopeView
                label={admin_capability_call_volume_412ad29f()}
                metric={facts.calls}
              />
            ) : null}
            {facts.successRate ? (
              <MetricEnvelopeView
                label={admin_capability_success_rate_df9dc72f()}
                metric={facts.successRate}
                format={(value) =>
                  typeof value === 'number'
                    ? `${(value * 100).toFixed(1)}%`
                    : String(value)
                }
              />
            ) : null}
            {facts.p95LatencyMs ? (
              <MetricEnvelopeView
                label={admin_capability_p95_latency_ba65a873()}
                metric={facts.p95LatencyMs}
                format={(value) => `${value} ms`}
              />
            ) : null}
            {facts.entitlementHeadroom ? (
              <MetricEnvelopeView
                label={admin_capability_quota_headroom_94ccca4a()}
                metric={facts.entitlementHeadroom}
              />
            ) : null}
            {facts.costMicros ? (
              <MetricEnvelopeView
                label={admin_capability_cost_c78bb59f()}
                metric={facts.costMicros}
              />
            ) : null}
          </dl>
          {facts.note ? (
            <p className="text-muted-foreground text-xs">{facts.note}</p>
          ) : null}
        </FramePanel>
      ) : (
        <FramePanel
          className="border-dashed"
          data-testid="runtime-facts-not-instrumented"
        >
          <h3 className="text-sm font-semibold">
            {admin_capability_operational_facts_9e7769a3()}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {admin_capability_not_instrumented_operational_facts_not_w_5fc10507()}
          </p>
          {facts?.note ? (
            <p className="text-muted-foreground mt-1 text-xs">{facts.note}</p>
          ) : null}
        </FramePanel>
      )}

      <FramePanel className="space-y-3" data-testid="dependency-join">
        <h3 className="text-sm font-semibold">
          {admin_capability_dependency_forward_reverse_lookup_static_6cd981d1()}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              {admin_capability_dependencies_forward_c02e9746()}
            </p>
            {dependsOn.length === 0 ? (
              <p className="mt-1 text-sm">{admin_capability_copy_bbeca838()}</p>
            ) : (
              <ul className="mt-1 space-y-1 font-mono text-sm">
                {dependsOn.map((edge) => (
                  <li key={`${edge.capabilityId}->${edge.dependsOnId}`}>
                    → {edge.dependsOnId}{' '}
                    <span className="text-muted-foreground">
                      ({edge.relation})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              {admin_capability_dependents_reverse_e3de259c()}
            </p>
            {dependents.length === 0 ? (
              <p className="mt-1 text-sm">
                {admin_capability_no_reverse_dependents_033d10df()}
              </p>
            ) : (
              <ul className="mt-1 space-y-1 font-mono text-sm">
                {dependents.map((edge) => (
                  <li key={`${edge.capabilityId}<-${edge.dependsOnId}`}>
                    ← {edge.capabilityId}{' '}
                    <span className="text-muted-foreground">
                      ({edge.relation})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </FramePanel>

      {entry.allowedSafeActions && entry.allowedSafeActions.length > 0 ? (
        <FramePanel className="space-y-2" data-testid="safe-actions">
          <h3 className="text-sm font-semibold">
            {admin_capability_allowed_safe_actions_752db8df()}
          </h3>
          <ul className="flex flex-wrap gap-2">
            {entry.allowedSafeActions.map((action) => (
              <li key={action}>
                <Badge variant="outline" className="font-mono">
                  {action}
                </Badge>
              </li>
            ))}
          </ul>
        </FramePanel>
      ) : null}

      {entry.technicalHandoff ? (
        <FramePanel className="space-y-2" data-testid="technical-handoff">
          <h3 className="text-sm font-semibold">
            {admin_capability_technical_handoff_envelope_41c55a95()}
          </h3>
          {entry.technicalHandoff.deepLink ? (
            <p className="font-mono text-xs">
              deepLink={entry.technicalHandoff.deepLink}
            </p>
          ) : null}
          {entry.technicalHandoff.correlationHints &&
          entry.technicalHandoff.correlationHints.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              hints: {entry.technicalHandoff.correlationHints.join(' · ')}
            </p>
          ) : null}
          {entry.technicalHandoff.redactedContext ? (
            <dl className="grid gap-1 text-xs">
              {Object.entries(entry.technicalHandoff.redactedContext).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground inline">{key}: </dt>
                    <dd className="inline font-mono">{value}</dd>
                  </div>
                )
              )}
            </dl>
          ) : null}
        </FramePanel>
      ) : null}
    </Frame>
  );
}
