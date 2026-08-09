/**
 * Ops Console control panels (V31-22).
 * Release desk + Tool Policy + Kill Switch + recent audit.
 * Metrics/trace/eval open Langfuse via releaseId-tagged fixed entry.
 */
import { IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  admin_ops_console_audit_title,
  admin_ops_console_empty_releases,
  admin_ops_console_kill_switch_title,
  admin_ops_console_langfuse_link,
  admin_ops_console_promote,
  admin_ops_console_provider_not_landed,
  admin_ops_console_refresh,
  admin_ops_console_releases_title,
  admin_ops_console_rollback,
  admin_ops_console_rollback_reason_required,
  admin_ops_console_status_canary,
  admin_ops_console_status_draft,
  admin_ops_console_status_production,
  admin_ops_console_tool_policy_title,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

import {
  bucketReleases,
  canSubmitRollback,
  shortHash,
  type OpsAuditEntryView,
  type OpsDiffView,
  type OpsKillSwitchView,
  type OpsReleaseListView,
  type OpsToolPolicyListView,
} from './admin-ops-console-model';

const MODULE = 'ops-console' as const;

function statusLabel(status: string): string {
  if (status === 'production') return admin_ops_console_status_production();
  if (status === 'canary') return admin_ops_console_status_canary();
  if (status === 'draft') return admin_ops_console_status_draft();
  return status;
}

export function AdminOpsConsoleControl() {
  const queryClient = useQueryClient();
  const [rollbackTarget, setRollbackTarget] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackEvidence, setRollbackEvidence] = useState('');
  const [allowlistReleaseId, setAllowlistReleaseId] = useState('');
  const [allowlistWorkspaces, setAllowlistWorkspaces] = useState('');
  const [allowlistReason, setAllowlistReason] = useState('');
  const [promoteReleaseId, setPromoteReleaseId] = useState('');
  const [promoteReason, setPromoteReason] = useState('');
  const [advanceReleaseId, setAdvanceReleaseId] = useState('');
  const [advanceToStatus, setAdvanceToStatus] = useState('evaluating');
  const [advanceReason, setAdvanceReason] = useState('');
  const [trialWorkspaceId, setTrialWorkspaceId] = useState('');
  const [trialReleaseId, setTrialReleaseId] = useState('');
  const [trialReason, setTrialReason] = useState('');
  const [diffLeft, setDiffLeft] = useState('');
  const [diffRight, setDiffRight] = useState('');
  const [diff, setDiff] = useState<OpsDiffView | null>(null);
  const [toolName, setToolName] = useState('read_confirmed_store_facts');
  const [toolRevision, setToolRevision] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [toolReason, setToolReason] = useState('');
  const [killReason, setKillReason] = useState('');
  const [publishReleaseId, setPublishReleaseId] = useState('');
  const [publishVersion, setPublishVersion] = useState('1');
  const [publishToolPolicy, setPublishToolPolicy] = useState('tool-policy/v1');
  const [publishManifest, setPublishManifest] = useState('');
  const [publishReason, setPublishReason] = useState('');
  const [evalReleaseId, setEvalReleaseId] = useState('');
  const [evalReason, setEvalReason] = useState('');
  const [evalTrace, setEvalTrace] = useState('');
  const [drillEvidence, setDrillEvidence] = useState('');
  const [evalObservation, setEvalObservation] = useState<{
    releaseId: string;
    verdict: string;
  } | null>(null);

  const releasesQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_releases'),
    queryFn: () =>
      queryP1<OpsReleaseListView>(MODULE, { action: 'list_releases' }),
  });
  const killQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_kill_switches'),
    queryFn: () =>
      queryP1<{ items: OpsKillSwitchView[] }>(MODULE, {
        action: 'list_kill_switches',
      }),
  });
  const auditQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_audit', { limit: 30 }),
    queryFn: () =>
      queryP1<{ items: OpsAuditEntryView[] }>(MODULE, {
        action: 'list_audit',
        payload: { limit: 30 },
      }),
  });
  const toolQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_tool_policies'),
    queryFn: () =>
      queryP1<OpsToolPolicyListView>(MODULE, { action: 'list_tool_policies' }),
  });
  const trialsQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_candidate_trials'),
    queryFn: () =>
      queryP1<{
        items: Array<{
          workspaceId: string;
          candidateReleaseId: string;
          consumedByRunId: string | null;
        }>;
      }>(MODULE, { action: 'list_candidate_trials' }),
  });
  const runPinsQuery = useQuery({
    queryKey: p1QueryKeys.request(MODULE, 'list_recent_run_pins'),
    queryFn: () =>
      queryP1<{
        items: Array<{
          runId: string;
          workspaceId: string;
          harnessReleaseId: string;
          status: string;
        }>;
      }>(MODULE, { action: 'list_recent_run_pins' }),
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module(MODULE),
      }),
    ]);
  };

  const promoteMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'promote_to_production',
        payload: {
          releaseId: promoteReleaseId.trim(),
          reason: promoteReason.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Promoted to production');
      setPromoteReason('');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      const manifest = JSON.parse(publishManifest) as Record<string, unknown>;
      return commandP1(MODULE, {
        action: 'publish_release',
        payload: {
          ...manifest,
          releaseId: publishReleaseId.trim(),
          version: Number(publishVersion),
          toolPolicyRevision: publishToolPolicy.trim(),
          reason: publishReason.trim(),
        },
      });
    },
    onSuccess: async () => {
      toast.success('Published exact-pin candidate');
      setPublishReason('');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const evalMutation = useMutation({
    mutationFn: () =>
      commandP1<{ releaseId: string; verdict: string }>(MODULE, {
        action: 'run_release_eval',
        payload: {
          releaseId: evalReleaseId.trim(),
          reason: evalReason.trim(),
          trace: JSON.parse(evalTrace) as Record<string, unknown>,
        },
      }),
    onSuccess: async (result) => {
      setEvalObservation(result);
      toast.success('Release-bound eval recorded');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const drillMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'record_rollback_drill',
        payload: {
          releaseId: evalReleaseId.trim(),
          result: 'passed',
          reason: evalReason.trim(),
          evidence: drillEvidence.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Rollback drill recorded');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const advanceMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'transition_lifecycle',
        payload: {
          releaseId: advanceReleaseId.trim(),
          toStatus: advanceToStatus,
          reason: advanceReason.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success(`Lifecycle → ${advanceToStatus}`);
      setAdvanceReason('');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rollbackMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'rollback_production',
        payload: {
          toReleaseId: rollbackTarget.trim(),
          reason: rollbackReason.trim(),
          evidence: rollbackEvidence.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Rolled back production pin');
      setRollbackReason('');
      setRollbackEvidence('');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const allowlistMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'set_canary_allowlist',
        payload: {
          releaseId: allowlistReleaseId.trim(),
          workspaceAllowlist: allowlistWorkspaces
            .split(/[,\s]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          reason: allowlistReason.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Canary allowlist updated');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const trialMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'set_candidate_trial',
        payload: {
          workspaceId: trialWorkspaceId.trim(),
          candidateReleaseId: trialReleaseId.trim(),
          reason: trialReason.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Candidate trial assigned');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toolMutation = useMutation({
    mutationFn: () =>
      commandP1(MODULE, {
        action: 'create_tool_policy_revision',
        payload: {
          toolName: toolName.trim(),
          revision: toolRevision.trim(),
          description: toolDescription.trim() || toolName.trim(),
          sideEffect: 'none',
          riskClass: 'read',
          approval: 'never',
          allowedPhases: ['intent', 'plan'],
          dataClasses: [],
          maxCallsPerRun: 4,
          timeoutMs: 5_000,
          recentDenialReasons: [],
          reason: toolReason.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success('Tool policy revision created');
      setToolRevision('');
      setToolReason('');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const killMutation = useMutation({
    mutationFn: (input: { switchId: string; enabled: boolean }) =>
      commandP1(MODULE, {
        action: 'set_kill_switch',
        payload: {
          switchId: input.switchId,
          enabled: input.enabled,
          reason: killReason.trim() || 'ops toggle',
        },
      }),
    onSuccess: async () => {
      toast.success('Kill switch updated');
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const buckets = useMemo(
    () =>
      releasesQuery.data
        ? bucketReleases(releasesQuery.data)
        : { production: [], canary: [], draft: [], other: [] },
    [releasesQuery.data]
  );

  const loadDiff = async () => {
    if (!diffLeft.trim() || !diffRight.trim()) return;
    try {
      const result = await queryP1<OpsDiffView>(MODULE, {
        action: 'diff_releases',
        payload: {
          leftReleaseId: diffLeft.trim(),
          rightReleaseId: diffRight.trim(),
        },
      });
      setDiff(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Diff failed');
    }
  };

  const openLangfuse = async (releaseId: string) => {
    try {
      const result = await queryP1<{ url: string | null }>(MODULE, {
        action: 'langfuse_release_url',
        payload: { releaseId },
      });
      if (!result.url) {
        toast.error('Langfuse base URL is not configured');
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Langfuse link failed'
      );
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-ops-console">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="admin-ops-console-refresh"
          onClick={() => void invalidateAll()}
        >
          <IconRefresh className="size-4" />
          {admin_ops_console_refresh()}
        </Button>
      </div>

      <Frame data-testid="admin-ops-console-releases">
        <FrameHeader>
          <FrameTitle>{admin_ops_console_releases_title()}</FrameTitle>
          <FrameDescription>
            production / canary / draft · readable diff · allowlist · trial ·
            U12 promote · rollback with reason+evidence
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          {releasesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : releasesQuery.isError ? (
            <p className="text-sm text-destructive">
              {(releasesQuery.error as Error).message}
            </p>
          ) : !releasesQuery.data?.items.length ? (
            <p className="text-sm text-muted-foreground">
              {admin_ops_console_empty_releases()}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Release</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manifest</TableHead>
                  <TableHead>Allowlist</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ...buckets.production,
                  ...buckets.canary,
                  ...buckets.draft,
                  ...buckets.other,
                ].map((item) => (
                  <TableRow
                    key={item.releaseId}
                    data-testid={`admin-ops-console-release-${item.releaseId}`}
                    data-status={item.status}
                  >
                    <TableCell className="font-mono text-xs">
                      {item.releaseId}
                      <span className="ml-2 text-muted-foreground">
                        v{item.version}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {shortHash(item.manifestHash)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.workspaceAllowlist.length
                        ? item.workspaceAllowlist.join(', ')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`admin-ops-console-langfuse-${item.releaseId}`}
                        onClick={() => void openLangfuse(item.releaseId)}
                      >
                        <IconExternalLink className="size-4" />
                        {admin_ops_console_langfuse_link()}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div
            className="grid gap-3 md:grid-cols-2"
            data-testid="admin-ops-console-release-actions"
          >
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Publish exact-pin candidate</p>
              <Input
                data-testid="admin-ops-console-publish-release"
                placeholder="releaseId"
                value={publishReleaseId}
                onChange={(event) => setPublishReleaseId(event.target.value)}
              />
              <Input
                data-testid="admin-ops-console-publish-version"
                placeholder="version"
                value={publishVersion}
                onChange={(event) => setPublishVersion(event.target.value)}
              />
              <Input
                data-testid="admin-ops-console-publish-tool-policy"
                placeholder="tool policy revision"
                value={publishToolPolicy}
                onChange={(event) => setPublishToolPolicy(event.target.value)}
              />
              <Textarea
                data-testid="admin-ops-console-publish-manifest"
                placeholder="full HarnessRelease manifest JSON"
                value={publishManifest}
                onChange={(event) => setPublishManifest(event.target.value)}
              />
              <Input
                data-testid="admin-ops-console-publish-reason"
                placeholder="reason"
                value={publishReason}
                onChange={(event) => setPublishReason(event.target.value)}
              />
              <Button
                data-testid="admin-ops-console-publish-submit"
                type="button"
                size="sm"
                disabled={
                  !publishReleaseId.trim() ||
                  !publishManifest.trim() ||
                  !publishReason.trim() ||
                  publishMutation.isPending
                }
                onClick={() => publishMutation.mutate()}
              >
                Publish
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Release-bound quick check</p>
              <Input
                data-testid="admin-ops-console-eval-release"
                placeholder="releaseId"
                value={evalReleaseId}
                onChange={(event) => setEvalReleaseId(event.target.value)}
              />
              <Input
                data-testid="admin-ops-console-eval-reason"
                placeholder="reason"
                value={evalReason}
                onChange={(event) => setEvalReason(event.target.value)}
              />
              <Textarea
                data-testid="admin-ops-console-eval-trace"
                placeholder="QuickCheckTrace JSON"
                value={evalTrace}
                onChange={(event) => setEvalTrace(event.target.value)}
              />
              <Button
                data-testid="admin-ops-console-eval-submit"
                type="button"
                size="sm"
                disabled={
                  !evalReleaseId.trim() ||
                  !evalReason.trim() ||
                  !evalTrace.trim() ||
                  evalMutation.isPending
                }
                onClick={() => evalMutation.mutate()}
              >
                Run production evaluator
              </Button>
              {evalObservation ? (
                <p
                  data-testid="admin-ops-console-eval-observation"
                  className="text-xs"
                >
                  {evalObservation.releaseId}: {evalObservation.verdict}
                </p>
              ) : null}
              <Input
                data-testid="admin-ops-console-drill-evidence"
                placeholder="rollback drill evidence"
                value={drillEvidence}
                onChange={(event) => setDrillEvidence(event.target.value)}
              />
              <Button
                data-testid="admin-ops-console-drill-submit"
                type="button"
                size="sm"
                disabled={
                  !evalReleaseId.trim() ||
                  !evalReason.trim() ||
                  !drillEvidence.trim() ||
                  drillMutation.isPending
                }
                onClick={() => drillMutation.mutate()}
              >
                Record passed rollback drill
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Advance lifecycle</p>
              <Input
                placeholder="releaseId"
                value={advanceReleaseId}
                onChange={(event) => setAdvanceReleaseId(event.target.value)}
                data-testid="admin-ops-console-advance-release"
              />
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={advanceToStatus}
                onChange={(event) => setAdvanceToStatus(event.target.value)}
                data-testid="admin-ops-console-advance-status"
              >
                <option value="evaluating">evaluating</option>
                <option value="canary">canary</option>
                <option value="draft">draft</option>
                <option value="retired">retired</option>
              </select>
              <Input
                placeholder="reason"
                value={advanceReason}
                onChange={(event) => setAdvanceReason(event.target.value)}
                data-testid="admin-ops-console-advance-reason"
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  !advanceReleaseId.trim() ||
                  !advanceReason.trim() ||
                  advanceMutation.isPending
                }
                data-testid="admin-ops-console-advance-submit"
                onClick={() => advanceMutation.mutate()}
              >
                Transition
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                {admin_ops_console_promote()} (U12)
              </p>
              <Label htmlFor="promote-id">releaseId</Label>
              <Input
                id="promote-id"
                value={promoteReleaseId}
                onChange={(event) => setPromoteReleaseId(event.target.value)}
                data-testid="admin-ops-console-promote-release"
              />
              <Label htmlFor="promote-reason">reason</Label>
              <Input
                id="promote-reason"
                value={promoteReason}
                onChange={(event) => setPromoteReason(event.target.value)}
                data-testid="admin-ops-console-promote-reason"
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  !promoteReleaseId.trim() ||
                  !promoteReason.trim() ||
                  promoteMutation.isPending
                }
                data-testid="admin-ops-console-promote-submit"
                onClick={() => promoteMutation.mutate()}
              >
                {admin_ops_console_promote()}
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                {admin_ops_console_rollback()}
              </p>
              <Label htmlFor="rollback-id">toReleaseId</Label>
              <Input
                id="rollback-id"
                value={rollbackTarget}
                onChange={(event) => setRollbackTarget(event.target.value)}
                data-testid="admin-ops-console-rollback-target"
              />
              <Label htmlFor="rollback-reason">reason *</Label>
              <Input
                id="rollback-reason"
                value={rollbackReason}
                onChange={(event) => setRollbackReason(event.target.value)}
                data-testid="admin-ops-console-rollback-reason"
              />
              <Label htmlFor="rollback-evidence">evidence *</Label>
              <Input
                id="rollback-evidence"
                value={rollbackEvidence}
                onChange={(event) => setRollbackEvidence(event.target.value)}
                data-testid="admin-ops-console-rollback-evidence"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={
                  !rollbackTarget.trim() ||
                  !canSubmitRollback({
                    reason: rollbackReason,
                    evidence: rollbackEvidence,
                  }) ||
                  rollbackMutation.isPending
                }
                data-testid="admin-ops-console-rollback-submit"
                onClick={() => rollbackMutation.mutate()}
              >
                {admin_ops_console_rollback()}
              </Button>
              {!canSubmitRollback({
                reason: rollbackReason,
                evidence: rollbackEvidence,
              }) && rollbackTarget ? (
                <p className="text-xs text-muted-foreground">
                  {admin_ops_console_rollback_reason_required()}
                </p>
              ) : null}
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Canary allowlist</p>
              <Input
                placeholder="releaseId"
                value={allowlistReleaseId}
                onChange={(event) => setAllowlistReleaseId(event.target.value)}
                data-testid="admin-ops-console-allowlist-release"
              />
              <Input
                placeholder="workspace ids (comma/space)"
                value={allowlistWorkspaces}
                onChange={(event) => setAllowlistWorkspaces(event.target.value)}
                data-testid="admin-ops-console-allowlist-workspaces"
              />
              <Input
                placeholder="reason"
                value={allowlistReason}
                onChange={(event) => setAllowlistReason(event.target.value)}
                data-testid="admin-ops-console-allowlist-reason"
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  !allowlistReleaseId.trim() ||
                  !allowlistReason.trim() ||
                  allowlistMutation.isPending
                }
                data-testid="admin-ops-console-allowlist-submit"
                onClick={() => allowlistMutation.mutate()}
              >
                Set allowlist
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Candidate trial</p>
              <Input
                placeholder="workspaceId"
                value={trialWorkspaceId}
                onChange={(event) => setTrialWorkspaceId(event.target.value)}
                data-testid="admin-ops-console-trial-workspace"
              />
              <Input
                placeholder="candidateReleaseId"
                value={trialReleaseId}
                onChange={(event) => setTrialReleaseId(event.target.value)}
                data-testid="admin-ops-console-trial-release"
              />
              <Input
                placeholder="reason"
                value={trialReason}
                onChange={(event) => setTrialReason(event.target.value)}
                data-testid="admin-ops-console-trial-reason"
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  !trialWorkspaceId.trim() ||
                  !trialReleaseId.trim() ||
                  !trialReason.trim() ||
                  trialMutation.isPending
                }
                data-testid="admin-ops-console-trial-submit"
                onClick={() => trialMutation.mutate()}
              >
                Assign trial
              </Button>
            </div>
          </div>

          <div
            className="space-y-2 rounded-md border p-3"
            data-testid="admin-ops-console-diff"
          >
            <p className="text-sm font-medium">Readable release diff</p>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="left releaseId"
                value={diffLeft}
                onChange={(event) => setDiffLeft(event.target.value)}
                data-testid="admin-ops-console-diff-left"
              />
              <Input
                placeholder="right releaseId"
                value={diffRight}
                onChange={(event) => setDiffRight(event.target.value)}
                data-testid="admin-ops-console-diff-right"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="admin-ops-console-diff-submit"
                onClick={() => void loadDiff()}
              >
                Diff
              </Button>
            </div>
            {diff ? (
              <ul className="max-h-48 space-y-1 overflow-auto font-mono text-xs">
                {diff.changes.length === 0 ? (
                  <li>No changes</li>
                ) : (
                  diff.changes.map((change) => (
                    <li key={change.path}>
                      {change.path}: {JSON.stringify(change.left)} →{' '}
                      {JSON.stringify(change.right)}
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </FramePanel>
      </Frame>

      <Frame data-testid="admin-ops-console-run-pins">
        <FrameHeader>
          <FrameTitle>Recent release pins</FrameTitle>
        </FrameHeader>
        <FramePanel className="space-y-1">
          <Button
            data-testid="admin-ops-console-refresh-run-pins"
            type="button"
            variant="outline"
            size="sm"
            disabled={runPinsQuery.isFetching}
            onClick={() => void runPinsQuery.refetch()}
          >
            Refresh release pins
          </Button>
          {trialsQuery.data?.items.map((item) => (
            <p
              key={item.workspaceId}
              data-testid={`admin-ops-console-trial-observation-${item.candidateReleaseId}`}
              className="text-xs"
            >
              trial {item.workspaceId}: {item.candidateReleaseId} /{' '}
              {item.consumedByRunId ?? 'pending'}
            </p>
          ))}
          {runPinsQuery.data?.items.map((item) => (
            <p
              key={item.runId}
              data-testid="admin-ops-console-run-pin"
              data-run-id={item.runId}
              data-run-status={item.status}
              className="text-xs"
            >
              {item.workspaceId}: {item.runId} / {item.harnessReleaseId} /{' '}
              {item.status}
            </p>
          ))}
        </FramePanel>
      </Frame>

      <Frame data-testid="admin-ops-console-tool-policy">
        <FrameHeader>
          <FrameTitle>{admin_ops_console_tool_policy_title()}</FrameTitle>
          <FrameDescription>
            Edits only create new revisions; production pin is via new release
            assembly.
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-3">
          {toolQuery.data?.items?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Revisions</TableHead>
                  <TableHead>Production pin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {toolQuery.data.items.map((item) => (
                  <TableRow key={item.toolName}>
                    <TableCell className="font-mono text-xs">
                      {item.toolName}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.revisions.map((rev) => rev.revision).join(', ')}
                    </TableCell>
                    <TableCell>
                      {item.productionPinned ? 'yes' : 'no'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tool policies yet
            </p>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              value={toolName}
              onChange={(event) => setToolName(event.target.value)}
              data-testid="admin-ops-console-tool-name"
              placeholder="toolName"
            />
            <Input
              value={toolRevision}
              onChange={(event) => setToolRevision(event.target.value)}
              data-testid="admin-ops-console-tool-revision"
              placeholder="new revision id"
            />
            <Input
              value={toolDescription}
              onChange={(event) => setToolDescription(event.target.value)}
              data-testid="admin-ops-console-tool-description"
              placeholder="description"
            />
            <Input
              value={toolReason}
              onChange={(event) => setToolReason(event.target.value)}
              data-testid="admin-ops-console-tool-reason"
              placeholder="reason"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={
              !toolName.trim() ||
              !toolRevision.trim() ||
              !toolReason.trim() ||
              toolMutation.isPending
            }
            data-testid="admin-ops-console-tool-submit"
            onClick={() => toolMutation.mutate()}
          >
            Create new revision
          </Button>
        </FramePanel>
      </Frame>

      <Frame data-testid="admin-ops-console-kill-switch">
        <FrameHeader>
          <FrameTitle>{admin_ops_console_kill_switch_title()}</FrameTitle>
          <FrameDescription>
            Seven granular switches with blast radius. Unlanded switches cannot
            be enabled.
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-3">
          <Input
            placeholder="reason for toggle"
            value={killReason}
            onChange={(event) => setKillReason(event.target.value)}
            data-testid="admin-ops-console-kill-reason"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Switch</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(killQuery.data?.items ?? []).map((item) => (
                <TableRow
                  key={item.switchId}
                  data-testid={`admin-ops-console-kill-${item.switchId}`}
                >
                  <TableCell className="font-mono text-xs">
                    {item.switchId}
                    <div className="text-muted-foreground">
                      {item.providerTicket}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md text-xs">
                    {item.impactScope}
                  </TableCell>
                  <TableCell>
                    {item.canEnable ? (
                      <Badge
                        variant={item.enabled ? 'destructive' : 'secondary'}
                      >
                        {item.enabled ? 'ON' : 'OFF'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {admin_ops_console_provider_not_landed()}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!item.canEnable || killMutation.isPending}
                      data-testid={`admin-ops-console-kill-toggle-${item.switchId}`}
                      onClick={() =>
                        killMutation.mutate({
                          switchId: item.switchId,
                          enabled: !item.enabled,
                        })
                      }
                    >
                      {item.canEnable
                        ? item.enabled
                          ? 'Disable'
                          : 'Enable'
                        : '—'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <Frame data-testid="admin-ops-console-audit">
        <FrameHeader>
          <FrameTitle>{admin_ops_console_audit_title()}</FrameTitle>
        </FrameHeader>
        <FramePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(auditQuery.data?.items ?? []).map((entry) => (
                <TableRow
                  key={entry.id}
                  data-testid="admin-ops-console-audit-row"
                >
                  <TableCell className="text-xs">{entry.createdAt}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.operatorId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.action}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.target}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.reason}
                    {entry.evidence ? (
                      <div className="text-muted-foreground">
                        evidence: {entry.evidence}
                      </div>
                    ) : null}
                    <div className="text-muted-foreground">
                      detail: {JSON.stringify(entry.detail)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>
    </div>
  );
}
