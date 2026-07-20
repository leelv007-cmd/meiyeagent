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
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CapabilitySixQuestionProjection } from '@/p1/admin-capability-registry-model';

const QUESTION_TITLES: Record<
  keyof CapabilitySixQuestionProjection['questions'],
  string
> = {
  purposeStatus: '① 用途与可用状态',
  configRevisionScope: '② 配置 revision 与生效范围',
  dependencies: '③ 依赖',
  runtimeFacts: '④ 运行事实摘要',
  recentEvidence: '⑤ 最近变更与审计引用',
  safeActionsHandoff: '⑥ 安全操作 / 移交 envelope',
};

function CompletenessMark({
  status,
}: {
  status: CapabilitySixQuestionProjection['questions'][keyof CapabilitySixQuestionProjection['questions']]['status'];
}) {
  if (status === 'complete') {
    return (
      <Badge variant="secondary" data-completeness="complete">
        完整
      </Badge>
    );
  }
  if (status === 'not_instrumented') {
    return (
      <Badge
        variant="outline"
        data-completeness="not_instrumented"
        data-testid="not-instrumented-mark"
      >
        未插桩
      </Badge>
    );
  }
  if (status === 'not_verified') {
    return (
      <Badge variant="outline" data-completeness="not_verified">
        未核验
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" data-completeness="missing">
      缺失
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
    <Card data-testid="capability-detail-card" data-capability-id={entry.id}>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{item.name}</CardTitle>
          <AvailabilityStatusBadge status={entry.availability} />
          <InstrumentStatusBadge status={entry.instrumentStatus} />
        </div>
        <CardDescription className="space-y-1">
          <p>{entry.purpose}</p>
          <p className="font-mono text-xs">
            id={entry.id} · owner={entry.owner} · drilldown={entry.drilldownKey}
          </p>
          {entry.evidenceFreshness?.capturedAt ? (
            <p className="text-xs">
              证据时间 {entry.evidenceFreshness.capturedAt}
              {entry.evidenceFreshness.source
                ? ` · 来源 ${entry.evidenceFreshness.source}`
                : ''}
            </p>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section
          className="space-y-3"
          data-testid="six-question-projection"
          aria-label="六问字段承载"
        >
          <h3 className="text-sm font-semibold">D-051 六问字段</h3>
          <dl className="space-y-3">
            {(
              Object.keys(QUESTION_TITLES) as Array<
                keyof typeof QUESTION_TITLES
              >
            ).map((key) => {
              const question = projection.questions[key];
              return (
                <div
                  key={key}
                  className="rounded-lg border p-3"
                  data-question={key}
                  data-question-status={question.status}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <dt className="text-sm font-medium">
                      {QUESTION_TITLES[key]}
                    </dt>
                    <CompletenessMark status={question.status} />
                  </div>
                  <dd className="text-sm text-muted-foreground">
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
        </section>

        {showRuntimeMetrics ? (
          <section className="space-y-3" data-testid="runtime-facts-metrics">
            <h3 className="text-sm font-semibold">
              运行事实（OperationalMetric）
            </h3>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {facts.calls ? (
                <MetricEnvelopeView label="调用量" metric={facts.calls} />
              ) : null}
              {facts.successRate ? (
                <MetricEnvelopeView
                  label="成功率"
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
                  label="p95 延迟"
                  metric={facts.p95LatencyMs}
                  format={(value) => `${value} ms`}
                />
              ) : null}
              {facts.entitlementHeadroom ? (
                <MetricEnvelopeView
                  label="额度余量"
                  metric={facts.entitlementHeadroom}
                />
              ) : null}
              {facts.costMicros ? (
                <MetricEnvelopeView
                  label="成本 (µ)"
                  metric={facts.costMicros}
                />
              ) : null}
            </dl>
            {facts.note ? (
              <p className="text-xs text-muted-foreground">{facts.note}</p>
            ) : null}
          </section>
        ) : (
          <section
            className="rounded-lg border border-dashed p-3"
            data-testid="runtime-facts-not-instrumented"
          >
            <h3 className="text-sm font-semibold">运行事实</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              not_instrumented — 运行事实未接入；其余五问仍由
              manifest/自报承载。
            </p>
            {facts?.note ? (
              <p className="mt-1 text-xs text-muted-foreground">{facts.note}</p>
            ) : null}
          </section>
        )}

        <section className="space-y-3" data-testid="dependency-join">
          <h3 className="text-sm font-semibold">依赖正反查（静态查找表）</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">依赖（正向）</p>
              {dependsOn.length === 0 ? (
                <p className="mt-1 text-sm">无关键依赖</p>
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
              <p className="text-xs text-muted-foreground">被依赖（反向）</p>
              {dependents.length === 0 ? (
                <p className="mt-1 text-sm">无反向依赖</p>
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
        </section>

        {entry.allowedSafeActions && entry.allowedSafeActions.length > 0 ? (
          <section className="space-y-2" data-testid="safe-actions">
            <h3 className="text-sm font-semibold">允许的安全操作</h3>
            <ul className="flex flex-wrap gap-2">
              {entry.allowedSafeActions.map((action) => (
                <li key={action}>
                  <Badge variant="outline" className="font-mono">
                    {action}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {entry.technicalHandoff ? (
          <section
            className="space-y-2 rounded-lg border p-3"
            data-testid="technical-handoff"
          >
            <h3 className="text-sm font-semibold">技术移交 envelope</h3>
            {entry.technicalHandoff.deepLink ? (
              <p className="font-mono text-xs">
                deepLink={entry.technicalHandoff.deepLink}
              </p>
            ) : null}
            {entry.technicalHandoff.correlationHints &&
            entry.technicalHandoff.correlationHints.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                hints: {entry.technicalHandoff.correlationHints.join(' · ')}
              </p>
            ) : null}
            {entry.technicalHandoff.redactedContext ? (
              <dl className="grid gap-1 text-xs">
                {Object.entries(entry.technicalHandoff.redactedContext).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt className="inline text-muted-foreground">{key}: </dt>
                      <dd className="inline font-mono">{value}</dd>
                    </div>
                  )
                )}
              </dl>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
