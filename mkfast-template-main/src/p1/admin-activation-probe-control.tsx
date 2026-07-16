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
  admin_activation_probe_cost_unavailable,
  admin_activation_probe_created,
  admin_activation_probe_deployment,
  admin_activation_probe_description,
  admin_activation_probe_empty,
  admin_activation_probe_estimated_cost,
  admin_activation_probe_evidence,
  admin_activation_probe_evidence_live,
  admin_activation_probe_evidence_stale,
  admin_activation_probe_evidence_unverified,
  admin_activation_probe_history,
  admin_activation_probe_history_empty,
  admin_activation_probe_latency,
  admin_activation_probe_latest,
  admin_activation_probe_never_run,
  admin_activation_probe_observed_cost,
  admin_activation_probe_onboarding_flow,
  admin_activation_probe_outcome,
  admin_activation_probe_refresh,
  admin_activation_probe_run,
  admin_activation_probe_run_action,
  admin_activation_probe_running,
  admin_activation_probe_status_failed,
  admin_activation_probe_status_passed,
  admin_activation_probe_title,
  admin_activation_probe_toast_failed,
  admin_activation_probe_toast_passed,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
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
  createdAt: string;
  deploymentId: string;
  failureCategory?: string;
  id: string;
  latencyMs: number;
  operation: string;
  outcome: 'passed' | 'failed';
  providerCost?: {
    amount: number;
    currency: 'CNY' | 'USD';
    status: 'observed';
  };
}

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
  stale: boolean;
}

function costLabel(
  cost:
    | ActivationStatus['estimatedUnitPrice']
    | ActivationProbeRun['providerCost']
) {
  if (!cost) return admin_activation_probe_cost_unavailable();
  return `${cost.amount} ${cost.currency}${'unit' in cost ? `/${cost.unit}` : ''}`;
}

function outcomeLabel(outcome: ActivationProbeRun['outcome']) {
  return outcome === 'passed'
    ? admin_activation_probe_status_passed()
    : admin_activation_probe_status_failed();
}

export function AdminActivationProbeControl() {
  const [selected, setSelected] = useState<ActivationStatus>();
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
    mutationFn: (deploymentId: string) =>
      commandP1<ActivationProbeRun>('model-supply', {
        action: 'activation_probe_run',
        payload: { deploymentId },
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
    await runMutation.mutateAsync(selected.deploymentId);
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
                    <Button
                      disabled={
                        !status.configurationRevision || runMutation.isPending
                      }
                      onClick={() => setSelected(status)}
                      size="sm"
                      type="button"
                    >
                      <IconPlayerPlay />
                      {admin_activation_probe_run_action()}
                    </Button>
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
                  <TableHead>{admin_activation_probe_created()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="max-w-56 truncate font-mono text-xs">
                      {run.id}
                    </TableCell>
                    <TableCell>{run.deploymentId}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.outcome === 'passed' ? 'secondary' : 'destructive'
                        }
                      >
                        {outcomeLabel(run.outcome)}
                      </Badge>
                    </TableCell>
                    <TableCell>{costLabel(run.providerCost)}</TableCell>
                    <TableCell>{run.latencyMs} ms</TableCell>
                    <TableCell>{formatLocaleDateTime(run.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center" colSpan={6}>
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
                deployment: selected?.deploymentId ?? '—',
                estimate: costLabel(selected?.estimatedUnitPrice),
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
