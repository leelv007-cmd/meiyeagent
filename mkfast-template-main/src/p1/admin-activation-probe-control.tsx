import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  admin_activation_probe_action,
  admin_activation_probe_cancel,
  admin_activation_probe_configuration,
  admin_activation_probe_configuration_missing,
  admin_activation_probe_configuration_ready,
  admin_activation_probe_confirm,
  admin_activation_probe_confirm_description,
  admin_activation_probe_confirm_title,
  admin_activation_probe_correlation,
  admin_activation_probe_cost_estimated,
  admin_activation_probe_cost_observed,
  admin_activation_probe_cost_unavailable,
  admin_activation_probe_created,
  admin_activation_probe_deployment,
  admin_activation_probe_description,
  admin_activation_probe_empty,
  admin_activation_probe_estimated_cost,
  admin_activation_probe_evidence,
  admin_activation_probe_evidence_details,
  admin_activation_probe_evidence_live,
  admin_activation_probe_evidence_ref,
  admin_activation_probe_evidence_stale,
  admin_activation_probe_evidence_unverified,
  admin_activation_probe_failure_category,
  admin_activation_probe_history,
  admin_activation_probe_history_empty,
  admin_activation_probe_latency,
  admin_activation_probe_latest,
  admin_activation_probe_never_run,
  admin_activation_probe_none,
  admin_activation_probe_observed_cost,
  admin_activation_probe_onboarding_flow,
  admin_activation_probe_outcome,
  admin_activation_probe_output_digest,
  admin_activation_probe_refresh,
  admin_activation_probe_run,
  admin_activation_probe_run_action,
  admin_activation_probe_running,
  admin_activation_probe_status_failed,
  admin_activation_probe_status_passed,
  admin_activation_probe_title,
  admin_activation_probe_toast_failed,
  admin_activation_probe_toast_passed,
  admin_activation_probe_usage,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import type { ModelOperation } from './admin-view-model';
import { commandP1, queryP1 } from './client';
import { p1QueryKeys } from './query-keys';

interface ActivationEvidence {
  configurationRevision: string;
  evidenceRef: string;
  status: 'live_verified';
  verifiedAt: string;
}

interface ActivationProbeRun {
  catalogModelId: string;
  configurationRevision: string;
  correlationId: string;
  createdAt: string;
  deploymentId: string;
  failureCategory?: string;
  id: string;
  latencyMs: number;
  operation: ModelOperation;
  outcome: 'passed' | 'failed';
  outputDigest?: string;
  providerCost?: {
    amount: number;
    currency: 'CNY' | 'USD';
    status: 'estimated' | 'observed';
    usage: {
      inputTokens?: number;
      mediaUnits?: number;
      outputTokens?: number;
    };
  };
}

type ActivationProbeUsage = NonNullable<
  ActivationProbeRun['providerCost']
>['usage'];

interface ActivationStatus {
  catalogModelId: string;
  configurationRevision: string | null;
  deploymentId: string;
  estimatedUnitPrice: {
    amount: number;
    currency: 'CNY' | 'USD';
    revision: string;
    unit: string;
  } | null;
  evidence: ActivationEvidence | null;
  latestProbe: ActivationProbeRun | null;
  operations: ModelOperation[];
  stale: boolean;
  verifiedOperations: ModelOperation[];
}

function costLabel(
  cost:
    | ActivationStatus['estimatedUnitPrice']
    | ActivationProbeRun['providerCost']
) {
  if (!cost) return admin_activation_probe_cost_unavailable();
  if ('unit' in cost) return `${cost.amount} ${cost.currency}/${cost.unit}`;
  const status =
    cost.status === 'observed'
      ? admin_activation_probe_cost_observed()
      : admin_activation_probe_cost_estimated();
  return `${cost.amount} ${cost.currency} · ${status}`;
}

function outcomeLabel(outcome: ActivationProbeRun['outcome']) {
  return outcome === 'passed'
    ? admin_activation_probe_status_passed()
    : admin_activation_probe_status_failed();
}

function usageLabel(usage: ActivationProbeUsage | undefined) {
  if (!usage) return admin_activation_probe_none();
  const parts = [
    usage.inputTokens === undefined ? null : `inputTokens=${usage.inputTokens}`,
    usage.outputTokens === undefined
      ? null
      : `outputTokens=${usage.outputTokens}`,
    usage.mediaUnits === undefined ? null : `mediaUnits=${usage.mediaUnits}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' / ') : admin_activation_probe_none();
}

export function AdminActivationProbeControl() {
  const [selected, setSelected] = useState<{
    operation: ModelOperation;
    status: ActivationStatus;
  }>();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'activation_status'),
    queryFn: ({ signal }) =>
      queryP1<ActivationStatus[]>(
        'model-supply',
        { action: 'activation_status' },
        signal
      ),
  });
  const runsQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'activation_probe_runs'),
    queryFn: ({ signal }) =>
      queryP1<ActivationProbeRun[]>(
        'model-supply',
        { action: 'activation_probe_runs' },
        signal
      ),
  });
  const runMutation = useMutation({
    mutationFn: (input: { deploymentId: string; operation: ModelOperation }) =>
      commandP1<ActivationProbeRun>('model-supply', {
        action: 'activation_probe_run',
        payload: input,
      }),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('model-supply'),
      });
      if (run.outcome === 'passed') {
        toast.success(admin_activation_probe_toast_passed());
      } else {
        toast.error(admin_activation_probe_toast_failed());
      }
    },
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.module('model-supply'),
    });
  const confirmRun = async () => {
    if (!selected) return;
    await runMutation.mutateAsync({
      deploymentId: selected.status.deploymentId,
      operation: selected.operation,
    });
    setSelected(undefined);
  };
  const statuses = statusQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{admin_activation_probe_title()}</CardTitle>
          <CardDescription>
            {admin_activation_probe_description()}
          </CardDescription>
        </div>
        <Button
          disabled={statusQuery.isFetching || runsQuery.isFetching}
          onClick={() => void refresh()}
          type="button"
          variant="outline"
        >
          <IconRefresh />
          {admin_activation_probe_refresh()}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {admin_activation_probe_onboarding_flow()}
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{admin_activation_probe_deployment()}</TableHead>
                <TableHead>{admin_activation_probe_configuration()}</TableHead>
                <TableHead>{admin_activation_probe_evidence()}</TableHead>
                <TableHead>{admin_activation_probe_latest()}</TableHead>
                <TableHead>{admin_activation_probe_estimated_cost()}</TableHead>
                <TableHead className="text-right">
                  {admin_activation_probe_action()}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((status) => (
                <TableRow key={status.deploymentId}>
                  <TableCell>
                    <p className="font-medium">{status.deploymentId}</p>
                    <p className="text-xs text-muted-foreground">
                      {status.catalogModelId}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status.configurationRevision ? 'outline' : 'destructive'
                      }
                    >
                      {status.configurationRevision
                        ? admin_activation_probe_configuration_ready()
                        : admin_activation_probe_configuration_missing()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status.stale
                          ? 'destructive'
                          : status.evidence
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {status.stale
                        ? admin_activation_probe_evidence_stale()
                        : status.evidence
                          ? admin_activation_probe_evidence_live()
                          : admin_activation_probe_evidence_unverified()}
                    </Badge>
                    {status.evidence ? (
                      <p className="mt-1 max-w-52 truncate font-mono text-xs text-muted-foreground">
                        {status.evidence.evidenceRef}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {status.latestProbe ? (
                      <>
                        <Badge
                          variant={
                            status.latestProbe.outcome === 'passed'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {outcomeLabel(status.latestProbe.outcome)}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatLocaleDateTime(status.latestProbe.createdAt)}
                        </p>
                      </>
                    ) : (
                      admin_activation_probe_never_run()
                    )}
                  </TableCell>
                  <TableCell>{costLabel(status.estimatedUnitPrice)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {status.operations.map((operation) => (
                        <Button
                          disabled={
                            !status.configurationRevision ||
                            runMutation.isPending
                          }
                          key={operation}
                          onClick={() => setSelected({ operation, status })}
                          size="sm"
                          type="button"
                        >
                          <IconPlayerPlay />
                          {admin_activation_probe_run_action()} · {operation}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {statuses.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center" colSpan={6}>
                    {admin_activation_probe_empty()}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <section className="space-y-3">
          <h3 className="font-medium">{admin_activation_probe_history()}</h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{admin_activation_probe_run()}</TableHead>
                  <TableHead>{admin_activation_probe_deployment()}</TableHead>
                  <TableHead>{admin_activation_probe_outcome()}</TableHead>
                  <TableHead>
                    {admin_activation_probe_observed_cost()}
                  </TableHead>
                  <TableHead>{admin_activation_probe_latency()}</TableHead>
                  <TableHead>
                    {admin_activation_probe_evidence_details()}
                  </TableHead>
                  <TableHead>{admin_activation_probe_created()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const evidenceRef =
                    run.outcome === 'passed' ? run.id : undefined;
                  const details = [
                    [admin_activation_probe_action(), run.operation],
                    [
                      admin_activation_probe_configuration(),
                      run.configurationRevision,
                    ],
                    [admin_activation_probe_correlation(), run.correlationId],
                    [
                      admin_activation_probe_usage(),
                      usageLabel(run.providerCost?.usage),
                    ],
                    [
                      admin_activation_probe_failure_category(),
                      run.failureCategory ?? admin_activation_probe_none(),
                    ],
                    [
                      admin_activation_probe_output_digest(),
                      run.outputDigest ?? admin_activation_probe_none(),
                    ],
                    [
                      admin_activation_probe_evidence_ref(),
                      evidenceRef ?? admin_activation_probe_none(),
                    ],
                  ];
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="max-w-56 truncate font-mono text-xs">
                        {run.id}
                      </TableCell>
                      <TableCell>{run.deploymentId}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.outcome === 'passed'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {outcomeLabel(run.outcome)}
                        </Badge>
                      </TableCell>
                      <TableCell>{costLabel(run.providerCost)}</TableCell>
                      <TableCell>{run.latencyMs} ms</TableCell>
                      <TableCell>
                        <dl className="min-w-72 space-y-1 text-xs">
                          {details.map(([label, value]) => (
                            <div
                              className="grid grid-cols-[7rem_1fr] gap-2"
                              key={label}
                            >
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="break-all font-mono">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </TableCell>
                      <TableCell>
                        {formatLocaleDateTime(run.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center" colSpan={7}>
                      {admin_activation_probe_history_empty()}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </section>
      </CardContent>

      <AlertDialog
        open={Boolean(selected)}
        onOpenChange={(open) => (open ? undefined : setSelected(undefined))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {admin_activation_probe_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {admin_activation_probe_confirm_description({
                deployment: selected
                  ? `${selected.status.deploymentId} · ${selected.operation}`
                  : '—',
                estimate: costLabel(selected?.status.estimatedUnitPrice),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runMutation.isPending}>
              {admin_activation_probe_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={runMutation.isPending}
              onClick={() => void confirmRun()}
            >
              {runMutation.isPending
                ? admin_activation_probe_running()
                : admin_activation_probe_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
