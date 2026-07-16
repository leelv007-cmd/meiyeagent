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
import { m } from '@/locale/paraglide/messages';
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
  if (!cost) return m.admin_activation_probe_cost_unavailable();
  return `${cost.amount} ${cost.currency}${'unit' in cost ? `/${cost.unit}` : ''}`;
}

function outcomeLabel(outcome: ActivationProbeRun['outcome']) {
  return outcome === 'passed'
    ? m.admin_activation_probe_status_passed()
    : m.admin_activation_probe_status_failed();
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
        toast.success(m.admin_activation_probe_toast_passed());
      } else {
        toast.error(m.admin_activation_probe_toast_failed());
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
          <CardTitle>{m.admin_activation_probe_title()}</CardTitle>
          <CardDescription>
            {m.admin_activation_probe_description()}
          </CardDescription>
        </div>
        <Button
          disabled={statusQuery.isFetching || runsQuery.isFetching}
          onClick={() => void refresh()}
          type="button"
          variant="outline"
        >
          <IconRefresh />
          {m.admin_activation_probe_refresh()}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {m.admin_activation_probe_onboarding_flow()}
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.admin_activation_probe_deployment()}</TableHead>
                <TableHead>
                  {m.admin_activation_probe_configuration()}
                </TableHead>
                <TableHead>{m.admin_activation_probe_evidence()}</TableHead>
                <TableHead>{m.admin_activation_probe_latest()}</TableHead>
                <TableHead>
                  {m.admin_activation_probe_estimated_cost()}
                </TableHead>
                <TableHead className="text-right">
                  {m.admin_activation_probe_action()}
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
                        ? m.admin_activation_probe_configuration_ready()
                        : m.admin_activation_probe_configuration_missing()}
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
                        ? m.admin_activation_probe_evidence_stale()
                        : status.evidence
                          ? m.admin_activation_probe_evidence_live()
                          : m.admin_activation_probe_evidence_unverified()}
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
                      m.admin_activation_probe_never_run()
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
                      {m.admin_activation_probe_run_action()}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {statuses.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center" colSpan={6}>
                    {m.admin_activation_probe_empty()}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <section className="space-y-3">
          <h3 className="font-medium">{m.admin_activation_probe_history()}</h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_activation_probe_run()}</TableHead>
                  <TableHead>{m.admin_activation_probe_deployment()}</TableHead>
                  <TableHead>{m.admin_activation_probe_outcome()}</TableHead>
                  <TableHead>
                    {m.admin_activation_probe_observed_cost()}
                  </TableHead>
                  <TableHead>{m.admin_activation_probe_latency()}</TableHead>
                  <TableHead>{m.admin_activation_probe_created()}</TableHead>
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
                      {m.admin_activation_probe_history_empty()}
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
              {m.admin_activation_probe_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_activation_probe_confirm_description({
                deployment: selected?.deploymentId ?? '—',
                estimate: costLabel(selected?.estimatedUnitPrice),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runMutation.isPending}>
              {m.admin_activation_probe_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={runMutation.isPending}
              onClick={() => void confirmRun()}
            >
              {runMutation.isPending
                ? m.admin_activation_probe_running()
                : m.admin_activation_probe_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
