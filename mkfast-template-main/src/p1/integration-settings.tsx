import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconBrandTiktok,
  IconBuilding,
  IconChevronDown,
  IconCloudLock,
  IconExternalLink,
  IconKey,
  IconPlugConnected,
  IconPlayerPlay,
  IconRefresh,
  IconShieldLock,
  IconUnlink,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { m } from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { StrictByokExecutionPanel } from '@/p1/entitlement-byok-panels';
import {
  createIntegrationConnectionSchema,
  douyinPublishFormSchema,
  douyinScheduledAt,
  feishuArguments,
  feishuArgumentsFormSchema,
  integrationScopes,
  runConnectionCreationAttempt,
  runCredentialRotationAttempt,
  rotateIntegrationCredentialSchema,
  type ConnectionCreationAttempt,
  type CredentialRotationAttempt,
  type CreateIntegrationConnectionInput,
  type DouyinPublishFormInput,
  type FeishuArgumentsFormInput,
  type RotateIntegrationCredentialInput,
} from '@/p1/integration-settings-forms';
import {
  canReconcileFeishuIntent,
  eligibleDouyinPublishAnchorKinds,
  type DouyinOperationsSnapshotView,
  type DouyinPublishJobView,
  type FeishuPendingIntentView,
  type FeishuRecoveryIntentView,
  type FeishuToolView,
  type IntegrationConnectionView,
  type IntegrationProvider,
} from '@/p1/settings-view-model';
import {
  type FeishuProductState,
  useIntegrationSettings,
} from '@/p1/use-integration-settings';
import { useWorkspaceAccess } from '@/p1/use-workspace-access';

interface ProviderDefinition {
  provider: IntegrationProvider;
  title: () => string;
  description: () => string;
  identityMode: 'byok' | 'oauth_user' | 'service';
  subjectLabel: () => string;
  secretLabel: () => string;
  secretPlaceholder: () => string;
  capabilities: Array<{ id: string; label: () => string }>;
  icon: typeof IconCloudLock;
}

const PROVIDERS: ProviderDefinition[] = [
  {
    provider: 'model',
    title: m.integration_provider_model_title,
    description: m.integration_provider_model_description,
    identityMode: 'byok',
    subjectLabel: m.integration_provider_model_subject,
    secretLabel: m.integration_provider_model_secret,
    secretPlaceholder: m.integration_provider_model_secret_placeholder,
    capabilities: [
      {
        id: 'model.invoke',
        label: m.integration_provider_model_capability_invoke,
      },
    ],
    icon: IconCloudLock,
  },
  {
    provider: 'douyin',
    title: m.integration_douyin_title,
    description: m.integration_douyin_description,
    identityMode: 'oauth_user',
    subjectLabel: m.integration_provider_douyin_subject,
    secretLabel: m.integration_provider_douyin_oauth_credential,
    secretPlaceholder: m.integration_provider_douyin_oauth_placeholder,
    capabilities: [
      {
        id: 'publish',
        label: m.integration_provider_douyin_capability_publish,
      },
      {
        id: 'observe',
        label: m.integration_provider_douyin_capability_observe,
      },
      {
        id: 'publish.poi',
        label: m.integration_provider_douyin_capability_poi,
      },
      {
        id: 'publish.mini_program',
        label: m.integration_provider_douyin_capability_mini_program,
      },
    ],
    icon: IconBrandTiktok,
  },
  {
    provider: 'feishu',
    title: m.integration_provider_feishu_title,
    description: m.integration_provider_feishu_description,
    identityMode: 'oauth_user',
    subjectLabel: m.integration_provider_feishu_subject,
    secretLabel: m.integration_provider_feishu_secret,
    secretPlaceholder: m.integration_provider_feishu_secret_placeholder,
    capabilities: [
      {
        id: 'mcp.tools',
        label: m.integration_provider_feishu_capability_tools,
      },
    ],
    icon: IconBuilding,
  },
];

const STATUS_LABELS: Record<string, () => string> = {
  active: m.integration_status_active,
  available: m.integration_status_available,
  authorized: m.integration_status_authorized,
  claimed: m.integration_status_claimed,
  completed: m.integration_status_completed,
  confirmation_pending: m.integration_status_confirmation_pending,
  degraded: m.integration_status_degraded,
  disabled: m.integration_status_disabled,
  draft: m.integration_status_draft,
  empty: m.integration_status_empty,
  executed: m.integration_status_executed,
  exhausted: m.integration_status_exhausted,
  expired: m.integration_status_expired,
  failed: m.integration_status_failed,
  manual_required: m.integration_status_manual_required,
  pending_review: m.integration_status_pending_review,
  permission_missing: m.integration_status_permission_missing,
  published: m.integration_status_published,
  rate_limited: m.integration_status_rate_limited,
  reauthorize_required: m.integration_status_reauthorize_required,
  reconciliation_required: m.integration_status_reconciliation_required,
  retired: m.integration_status_retired,
  reviewing: m.integration_status_reviewing,
  revoked: m.integration_status_revoked,
  scheduled: m.integration_status_scheduled,
  settled: m.integration_status_settled,
  submitted: m.integration_status_submitted,
  submitting: m.integration_status_submitting,
  unavailable: m.integration_status_unavailable,
  unverified: m.integration_status_unverified,
};

const AUDIT_LABELS: Record<string, () => string> = {
  'connection.created': m.integration_audit_action_connection_created,
  'connection.disconnected': m.integration_audit_action_connection_disconnected,
  'credential.rotated': m.integration_audit_action_credential_rotated,
  'byok.completed': m.p1_admin_audit_byok_action_completed,
  'byok.failed': m.p1_admin_audit_byok_action_failed,
  'byok.unknown': m.p1_admin_audit_byok_action_unknown,
};

function providerDefinition(provider: IntegrationProvider) {
  return (
    PROVIDERS.find((candidate) => candidate.provider === provider) ??
    PROVIDERS[0]
  );
}

function connectionPublicName(connection: IntegrationConnectionView) {
  return (
    connection.subject?.trim() ||
    providerDefinition(connection.provider).title()
  );
}

function statusBadge(status: string) {
  const healthy = status === 'available';
  const stopped = status === 'disabled' || status === 'revoked';
  return (
    <Badge
      variant={healthy ? 'secondary' : stopped ? 'outline' : 'destructive'}
    >
      {statusLabel(status)}
    </Badge>
  );
}

function dateTimeLabel(value?: string) {
  if (!value) return m.integration_unknown();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? m.integration_unknown()
    : formatLocaleDateTime(timestamp);
}

function statusLabel(status?: string) {
  const label = status ? STATUS_LABELS[status] : undefined;
  return label?.() ?? m.integration_status_unknown();
}

function toolRiskLabel(risk: FeishuToolView['risk']) {
  if (risk === 'read') return m.integration_tool_risk_read();
  if (risk === 'write') return m.integration_tool_risk_write();
  if (risk === 'destructive') return m.integration_tool_risk_destructive();
  return m.integration_tool_risk_open_world();
}

function sideEffectLabel(sideEffect: FeishuPendingIntentView['sideEffect']) {
  if (sideEffect === 'read') return m.integration_tool_side_effect_read();
  if (sideEffect === 'create') return m.integration_tool_side_effect_create();
  if (sideEffect === 'edit') return m.integration_tool_side_effect_edit();
  if (sideEffect === 'send') return m.integration_tool_side_effect_send();
  if (sideEffect === 'delete') return m.integration_tool_side_effect_delete();
  return m.integration_tool_side_effect_overwrite();
}

function auditLabel(action: string) {
  return AUDIT_LABELS[action]?.() ?? m.integration_audit_action_unknown();
}

function toolSideEffect(tool: FeishuToolView) {
  if (tool.risk === 'read') return 'read' as const;
  if (tool.risk === 'write') return 'edit' as const;
  if (tool.risk === 'destructive') return 'delete' as const;
  return 'send' as const;
}

const FEISHU_TARGET_ARGUMENTS = new Set([
  'record_id',
  'recordId',
  'message_id',
  'messageId',
  'event_id',
  'eventId',
  'node_token',
  'nodeToken',
  'document_id',
  'documentId',
  'doc_token',
  'docToken',
  'object_id',
  'objectId',
  'task_id',
  'taskId',
  'file_token',
  'fileToken',
  'attachment_token',
  'attachmentToken',
  'view_id',
  'viewId',
  'sheet_id',
  'sheetId',
  'spreadsheet_token',
  'spreadsheetToken',
  'table_id',
  'tableId',
  'app_token',
  'appToken',
  'base_token',
  'baseToken',
  'folder_token',
  'folderToken',
  'chat_id',
  'chatId',
  'calendar_id',
  'calendarId',
  'user_id',
  'userId',
]);

function toolIntentScope(args: Record<string, unknown>) {
  const targetObjectId = Object.entries(args).find(
    ([key, value]) =>
      FEISHU_TARGET_ARGUMENTS.has(key) &&
      typeof value === 'string' &&
      value.trim().length > 0
  )?.[1] as string | undefined;
  return {
    fields: Object.keys(args).filter(
      (key) => !FEISHU_TARGET_ARGUMENTS.has(key)
    ),
    ...(targetObjectId ? { targetObjectId } : {}),
  };
}

interface ConnectionCardProps {
  busy: boolean;
  canManage: boolean;
  connection: IntegrationConnectionView;
  douyinIntegrated?: boolean;
  rotateConnectionId?: string;
  onCapabilityChange: (
    connection: IntegrationConnectionView,
    capability: string,
    active: boolean
  ) => Promise<void>;
  onDisconnect: (connection: IntegrationConnectionView) => Promise<void>;
  onRotate: (
    connection: IntegrationConnectionView,
    secret: string,
    idempotencyKey: string
  ) => Promise<boolean>;
  onRotateConnectionChange: (connectionId?: string) => void;
  onSync: (connection: IntegrationConnectionView) => Promise<void>;
}

function ConnectionCard({
  busy,
  canManage,
  connection,
  douyinIntegrated,
  rotateConnectionId,
  onCapabilityChange,
  onDisconnect,
  onRotate,
  onRotateConnectionChange,
  onSync,
}: ConnectionCardProps) {
  const definition = providerDefinition(connection.provider);
  const Icon = definition.icon;
  const connectionEnabled = !['disabled', 'revoked'].includes(
    connection.status
  );
  const canSync =
    connectionEnabled &&
    (connection.provider === 'feishu' ||
      (connection.provider === 'douyin' &&
        connection.activeCapabilities.includes('observe')));
  const rotating = rotateConnectionId === connection.id;
  const rotateForm = useForm<RotateIntegrationCredentialInput>({
    defaultValues: { secret: '' },
    resolver: zodResolver(rotateIntegrationCredentialSchema),
  });
  const rotationAttempt = useRef<CredentialRotationAttempt | undefined>(
    undefined
  );

  const toggleRotation = () => {
    rotateForm.reset();
    onRotateConnectionChange(rotating ? undefined : connection.id);
  };

  const submitRotation = rotateForm.handleSubmit(async ({ secret }) => {
    const result = await runCredentialRotationAttempt({
      attempt: rotationAttempt.current,
      createIdempotencyKey: () => crypto.randomUUID(),
      secret,
      submit: (idempotencyKey) => onRotate(connection, secret, idempotencyKey),
    });
    rotationAttempt.current = result.attempt;
    if (!result.succeeded) return;
    rotateForm.reset();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Icon className="size-5" />
          {connectionPublicName(connection)}
          {statusBadge(connection.status)}
        </CardTitle>
        <CardDescription>
          {m.integration_connection_description({
            mask: connection.credential.mask,
            provider: definition.title(),
            version: connection.credential.version,
          })}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button
              aria-label={m.integration_disconnect_aria()}
              disabled={busy || connection.status === 'revoked'}
              onClick={() => void onDisconnect(connection)}
              size="icon-sm"
              variant="destructive"
            >
              <IconUnlink />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.provider === 'douyin' && douyinIntegrated === false ? (
          <Alert>
            <AlertTitle>
              {m.integration_douyin_not_integrated_title()}
            </AlertTitle>
            <AlertDescription>
              {m.integration_douyin_not_integrated_description()}
            </AlertDescription>
          </Alert>
        ) : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {m.integration_connection_status()}
            </dt>
            <dd className="mt-1 font-medium">
              {statusLabel(connection.credential.status)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {m.integration_connection_last_used()}
            </dt>
            <dd className="mt-1 font-medium">
              {dateTimeLabel(connection.credential.lastUsedAt)}
            </dd>
          </div>
        </dl>

        {connection.provider === 'douyin' &&
        connection.refreshReauthorizationReminder ? (
          <Alert>
            <AlertTitle>{m.integration_reauthorize_title()}</AlertTitle>
            <AlertDescription>
              {m.integration_reauthorize_description()}
            </AlertDescription>
          </Alert>
        ) : null}

        <Separator />

        <div className="space-y-3">
          <h3 className="font-medium">{m.integration_capabilities()}</h3>
          {definition.capabilities.map((capability) => {
            const granted = connection.grantedCapabilities.includes(
              capability.id
            );
            const active = connection.activeCapabilities.includes(
              capability.id
            );
            const degraded = connection.degradedCapabilities[capability.id];
            const controllable = connection.provider === 'douyin';
            return (
              <div
                className="flex items-start justify-between gap-4 border-b border-divider p-3 last:border-b-0"
                key={capability.id}
              >
                <div>
                  <p className="font-medium">{capability.label()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {!granted
                      ? m.integration_capability_not_granted_description()
                      : degraded
                        ? m.integration_capability_degraded()
                        : active
                          ? m.integration_capability_active()
                          : m.integration_capability_pending_owner()}
                  </p>
                </div>
                {controllable && canManage ? (
                  <Switch
                    aria-label={m.integration_capability_aria({
                      capability: capability.label(),
                    })}
                    checked={active}
                    disabled={busy || !connectionEnabled || !granted}
                    onCheckedChange={(checked) =>
                      void onCapabilityChange(
                        connection,
                        capability.id,
                        checked
                      )
                    }
                  />
                ) : (
                  <Badge variant={granted ? 'secondary' : 'outline'}>
                    {granted
                      ? m.integration_capability_granted()
                      : m.integration_capability_not_granted()}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {canSync && canManage ? (
            <Button
              disabled={busy}
              onClick={() => void onSync(connection)}
              variant="outline"
            >
              <IconRefresh />
              {connection.provider === 'feishu'
                ? m.integration_feishu_verify()
                : m.integration_douyin_sync()}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              disabled={busy || !connectionEnabled}
              onClick={toggleRotation}
              variant="outline"
            >
              <IconKey />
              {m.integration_rotate_credential()}
            </Button>
          ) : null}
        </div>

        {rotating && canManage ? (
          <form
            className="space-y-3 rounded-lg bg-surface-2 p-3"
            onSubmit={submitRotation}
          >
            <Label htmlFor={`rotate-${connection.id}`}>
              {m.integration_rotate_new_credential()}
            </Label>
            <Input
              autoComplete="new-password"
              id={`rotate-${connection.id}`}
              placeholder={m.integration_rotate_placeholder()}
              type="password"
              {...rotateForm.register('secret')}
            />
            {rotateForm.formState.errors.secret ? (
              <p className="text-xs text-destructive">
                {rotateForm.formState.errors.secret.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                disabled={busy || !connectionEnabled}
                type="submit"
                variant="outline"
              >
                {m.integration_rotate_confirm()}
              </Button>
              <Button
                disabled={busy}
                onClick={toggleRotation}
                type="button"
                variant="ghost"
              >
                {m.integration_rotate_cancel()}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DouyinOperationsPanel({
  busy,
  connection,
  integrated,
  snapshot,
  onConfirm,
  onRefreshJob,
  onSubmit,
  onSync,
}: {
  busy: boolean;
  connection: IntegrationConnectionView;
  integrated?: boolean;
  snapshot: DouyinOperationsSnapshotView;
  onConfirm: (
    connection: IntegrationConnectionView,
    contentSnapshotId: string,
    scheduledAt: string,
    anchor?: { id: string; kind: 'poi' | 'mini_program' }
  ) => Promise<string | undefined>;
  onRefreshJob: (job: DouyinPublishJobView) => Promise<void>;
  onSubmit: (
    confirmationId: string,
    contentSnapshotId: string,
    scheduledAt: string
  ) => Promise<void>;
  onSync: (connection: IntegrationConnectionView) => Promise<void>;
}) {
  const [confirmationId, setConfirmationId] = useState('');
  const [confirmedSnapshotRevision, setConfirmedSnapshotRevision] =
    useState('');
  const publishForm = useForm<DouyinPublishFormInput>({
    defaultValues: {
      anchorId: '',
      anchorKind: 'none',
      contentSnapshotId: '',
      scheduledAt: '',
    },
    resolver: zodResolver(douyinPublishFormSchema),
  });
  const contentSnapshotId = publishForm.watch('contentSnapshotId');
  const anchorKind = publishForm.watch('anchorKind');
  const eligibleAnchors = eligibleDouyinPublishAnchorKinds(connection).map(
    (kind) => ({
      kind,
      label: kind === 'poi' ? 'POI' : m.integration_anchor_kind_mini_program(),
    })
  );
  const selectedSnapshot = snapshot.contentSnapshots.find(
    (candidate) => candidate.id === contentSnapshotId
  );
  const confirmationIsCurrent = Boolean(
    confirmationId &&
      selectedSnapshot &&
      confirmedSnapshotRevision === selectedSnapshot.revision
  );

  useEffect(() => {
    if (contentSnapshotId && !selectedSnapshot) {
      publishForm.setValue('contentSnapshotId', '');
      setConfirmationId('');
      setConfirmedSnapshotRevision('');
    }
  }, [contentSnapshotId, publishForm, selectedSnapshot]);

  useEffect(() => {
    if (
      anchorKind !== 'none' &&
      !eligibleAnchors.some((anchor) => anchor.kind === anchorKind)
    ) {
      publishForm.setValue('anchorKind', 'none');
      publishForm.setValue('anchorId', '');
      setConfirmationId('');
      setConfirmedSnapshotRevision('');
    }
  }, [anchorKind, eligibleAnchors, publishForm]);

  const clearConfirmation = () => {
    setConfirmationId('');
    setConfirmedSnapshotRevision('');
  };

  const confirm = publishForm.handleSubmit(async (values) => {
    const currentSnapshot = snapshot.contentSnapshots.find(
      (candidate) => candidate.id === values.contentSnapshotId
    );
    if (!currentSnapshot) {
      toast.error(m.integration_douyin_snapshot_stale());
      return;
    }
    const id = await onConfirm(
      connection,
      currentSnapshot.id,
      values.scheduledAt,
      values.anchorKind === 'none'
        ? undefined
        : { id: values.anchorId, kind: values.anchorKind }
    );
    if (!id) return;
    setConfirmationId(id);
    setConfirmedSnapshotRevision(currentSnapshot.revision);
  });

  const submit = publishForm.handleSubmit(async (values) => {
    const currentSnapshot = snapshot.contentSnapshots.find(
      (candidate) => candidate.id === values.contentSnapshotId
    );
    if (
      !currentSnapshot ||
      !confirmationId ||
      confirmedSnapshotRevision !== currentSnapshot.revision
    ) {
      toast.error(m.integration_douyin_anchor_stale());
      return;
    }
    await onSubmit(confirmationId, currentSnapshot.id, values.scheduledAt);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.integration_douyin_publish_title()}</CardTitle>
        <CardDescription>
          {m.integration_douyin_publish_description({
            identity: connectionPublicName(connection),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {integrated === false ? (
          <Alert>
            <AlertTitle>
              {m.integration_douyin_not_integrated_title()}
            </AlertTitle>
            <AlertDescription>
              {m.integration_douyin_not_integrated_description()}
            </AlertDescription>
          </Alert>
        ) : null}
        <form className="space-y-3" onSubmit={confirm}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`douyin-snapshot-${connection.id}`}>
                {m.integration_douyin_publishable_label()}
              </Label>
              <Controller
                control={publishForm.control}
                name="contentSnapshotId"
                render={({ field }) => (
                  <Select
                    disabled={snapshot.contentSnapshots.length === 0}
                    onValueChange={(value) => {
                      field.onChange(value ?? '');
                      clearConfirmation();
                    }}
                    value={field.value || null}
                  >
                    <SelectTrigger
                      className="w-full"
                      id={`douyin-snapshot-${connection.id}`}
                    >
                      <SelectValue
                        placeholder={m.integration_douyin_publishable_placeholder()}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {snapshot.contentSnapshots.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.title} ·{' '}
                          {dateTimeLabel(candidate.createdAt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {publishForm.formState.errors.contentSnapshotId ? (
                <p className="text-xs text-destructive">
                  {publishForm.formState.errors.contentSnapshotId.message}
                </p>
              ) : null}
              {snapshot.contentSnapshots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {m.integration_douyin_publishable_empty()}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`douyin-schedule-${connection.id}`}>
                {m.integration_douyin_scheduled_at()}
              </Label>
              <Controller
                control={publishForm.control}
                name="scheduledAt"
                render={({ field }) => (
                  <Input
                    id={`douyin-schedule-${connection.id}`}
                    onBlur={field.onBlur}
                    onChange={(event) => {
                      field.onChange(event);
                      clearConfirmation();
                    }}
                    ref={field.ref}
                    type="datetime-local"
                    value={field.value}
                  />
                )}
              />
              {publishForm.formState.errors.scheduledAt ? (
                <p className="text-xs text-destructive">
                  {publishForm.formState.errors.scheduledAt.message}
                </p>
              ) : null}
            </div>
          </div>
          {eligibleAnchors.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`douyin-anchor-kind-${connection.id}`}>
                  {m.integration_anchor_optional()}
                </Label>
                <Controller
                  control={publishForm.control}
                  name="anchorKind"
                  render={({ field }) => (
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value ?? 'none');
                        publishForm.setValue('anchorId', '');
                        clearConfirmation();
                      }}
                      value={field.value}
                    >
                      <SelectTrigger
                        className="w-full"
                        id={`douyin-anchor-kind-${connection.id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          {m.integration_anchor_none()}
                        </SelectItem>
                        {eligibleAnchors.map((anchor) => (
                          <SelectItem key={anchor.kind} value={anchor.kind}>
                            {anchor.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {anchorKind !== 'none' ? (
                <div className="space-y-2">
                  <Label htmlFor={`douyin-anchor-id-${connection.id}`}>
                    {m.integration_anchor_authorized_id()}
                  </Label>
                  <Controller
                    control={publishForm.control}
                    name="anchorId"
                    render={({ field }) => (
                      <Input
                        id={`douyin-anchor-id-${connection.id}`}
                        onBlur={field.onBlur}
                        onChange={(event) => {
                          field.onChange(event);
                          clearConfirmation();
                        }}
                        placeholder={m.integration_anchor_id_placeholder()}
                        ref={field.ref}
                        value={field.value}
                      />
                    )}
                  />
                  {publishForm.formState.errors.anchorId ? (
                    <p className="text-xs text-destructive">
                      {publishForm.formState.errors.anchorId.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !connection.subject}
              type="submit"
              variant="outline"
            >
              {m.integration_douyin_publish_snapshot_confirm()}
            </Button>
            <Button
              disabled={busy || !confirmationIsCurrent || !selectedSnapshot}
              onClick={() => void submit()}
              type="button"
              variant="outline"
            >
              <IconPlayerPlay />
              {m.integration_douyin_publish_snapshot_submit()}
            </Button>
            <Button
              disabled={
                busy || !connection.activeCapabilities.includes('observe')
              }
              onClick={() => void onSync(connection)}
              type="button"
              variant="outline"
            >
              <IconRefresh />
              {m.integration_douyin_sync()}
            </Button>
          </div>
        </form>
        {confirmationIsCurrent ? (
          <p className="text-xs text-muted-foreground">
            {m.integration_douyin_confirmation({ confirmationId })}
          </p>
        ) : confirmationId ? (
          <p className="text-xs text-destructive">
            {m.integration_douyin_anchor_stale()}
          </p>
        ) : null}

        <Separator />

        <div className="space-y-3">
          <h3 className="font-medium">{m.integration_douyin_jobs()}</h3>
          {snapshot.publishJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.integration_douyin_job_empty()}
            </p>
          ) : (
            snapshot.publishJobs.map((job) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                key={job.id}
              >
                <div>
                  <p className="font-medium">{statusLabel(job.status)}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.integration_douyin_job_summary({
                      effect: job.effectState
                        ? statusLabel(job.effectState)
                        : m.integration_not_marked(),
                      item:
                        job.itemId ?? m.integration_douyin_job_item_missing(),
                      updatedAt: dateTimeLabel(job.updatedAt),
                    })}
                  </p>
                  {job.pollingState ? (
                    <p className="text-xs text-muted-foreground">
                      {job.nextPollAt
                        ? m.integration_douyin_job_polling_next({
                            nextAt: dateTimeLabel(job.nextPollAt),
                            summary: m.integration_douyin_job_polling({
                              attempts: job.pollAttempts ?? 0,
                              limit: job.pollLimit ?? '-',
                              polling: statusLabel(job.pollingState),
                            }),
                          })
                        : m.integration_douyin_job_polling({
                            attempts: job.pollAttempts ?? 0,
                            limit: job.pollLimit ?? '-',
                            polling: statusLabel(job.pollingState),
                          })}
                    </p>
                  ) : null}
                  {job.lastErrorCode ? (
                    <p className="text-xs text-destructive">
                      {m.integration_error_action_failed()}
                    </p>
                  ) : null}
                </div>
                {!['published', 'failed', 'manual_required'].includes(
                  job.status
                ) ? (
                  <Button
                    disabled={busy}
                    onClick={() => void onRefreshJob(job)}
                    size="sm"
                    variant="outline"
                  >
                    {m.integration_douyin_job_query()}
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="space-y-3">
          <h3 className="font-medium">
            {m.integration_douyin_observe_snapshots()}
          </h3>
          {snapshot.observeState ? (
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {snapshot.observeState.status === 'available'
                  ? m.integration_observe_status_available()
                  : snapshot.observeState.status === 'empty'
                    ? m.integration_observe_status_empty()
                    : snapshot.observeState.status === 'unavailable'
                      ? m.integration_observe_status_unavailable()
                      : m.integration_observe_status_unknown()}
              </p>
              <p className="text-xs text-muted-foreground">
                {snapshot.observeState.nextSyncAt
                  ? m.integration_douyin_observe_next_sync({
                      nextSync: dateTimeLabel(snapshot.observeState.nextSyncAt),
                      summary: m.integration_douyin_observe_last_attempt({
                        lastAttempt: dateTimeLabel(
                          snapshot.observeState.lastAttemptAt
                        ),
                      }),
                    })
                  : m.integration_douyin_observe_last_attempt({
                      lastAttempt: dateTimeLabel(
                        snapshot.observeState.lastAttemptAt
                      ),
                    })}
              </p>
            </div>
          ) : null}
          {snapshot.observeSnapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.integration_douyin_observe_empty()}
            </p>
          ) : (
            snapshot.observeSnapshots.slice(0, 10).map((item) => (
              <div
                className="rounded-lg border p-3 text-sm"
                key={item.externalId}
              >
                <p className="font-medium">{item.externalId}</p>
                <p className="text-xs text-muted-foreground">
                  {m.integration_douyin_observe_record({
                    missingCount: item.missingFieldCount,
                    observedAt: dateTimeLabel(item.observedAt),
                    source:
                      item.source === 'product'
                        ? m.integration_source_product()
                        : m.integration_source_external(),
                  })}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface FeishuExecutionView {
  status: string;
  content?: string;
  output?: Record<string, unknown>;
}

function FeishuToolInvocationForm({
  busy,
  connectionId,
  onExecute,
  tool,
}: {
  busy: boolean;
  connectionId: string;
  onExecute: (
    connectionId: string,
    tool: FeishuToolView,
    rawArguments: string
  ) => Promise<FeishuExecutionView | undefined>;
  tool: FeishuToolView;
}) {
  const [result, setResult] = useState<FeishuExecutionView>();
  const form = useForm<FeishuArgumentsFormInput>({
    defaultValues: { rawArguments: '{}' },
    resolver: zodResolver(feishuArgumentsFormSchema),
  });
  const submit = form.handleSubmit(async ({ rawArguments }) => {
    const execution = await onExecute(connectionId, tool, rawArguments);
    if (execution) setResult(execution);
  });

  return (
    <form className="space-y-2" onSubmit={submit}>
      <Label htmlFor={`feishu-tool-${connectionId}-${tool.id}`}>
        {m.integration_feishu_tool_arguments()}
      </Label>
      <Textarea
        id={`feishu-tool-${connectionId}-${tool.id}`}
        placeholder={m.integration_feishu_tool_arguments_placeholder({
          example: JSON.stringify({
            query: m.integration_feishu_example_query(),
          }),
        })}
        {...form.register('rawArguments')}
      />
      {form.formState.errors.rawArguments ? (
        <p className="text-xs text-destructive">
          {m.integration_feishu_json_invalid()}
        </p>
      ) : null}
      <Button disabled={busy} size="sm" type="submit" variant="outline">
        <IconPlayerPlay />
        {m.integration_feishu_execute()}
      </Button>
      {result ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            {m.integration_feishu_tool_result({
              status: statusLabel(result.status),
            })}
          </p>
          {result.status === 'completed' && result.content ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
              {result.content}
            </pre>
          ) : null}
          {result.status === 'completed' && result.output ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function FeishuIntentConfirmationForm({
  busy,
  intent,
  onConfirm,
}: {
  busy: boolean;
  intent: FeishuPendingIntentView;
  onConfirm: (
    intent: FeishuPendingIntentView,
    rawArguments: string
  ) => Promise<void>;
}) {
  const form = useForm<FeishuArgumentsFormInput>({
    defaultValues: { rawArguments: '{}' },
    resolver: zodResolver(feishuArgumentsFormSchema),
  });
  const submit = form.handleSubmit(({ rawArguments }) =>
    onConfirm(intent, rawArguments)
  );

  return (
    <form className="space-y-2" onSubmit={submit}>
      <p className="font-medium">{intent.toolId}</p>
      <p className="text-xs text-muted-foreground">
        {m.integration_feishu_intent_summary({
          sideEffect: sideEffectLabel(intent.sideEffect),
          taskId: intent.confirmationTaskId ?? m.integration_not_yet_created(),
        })}
      </p>
      <Textarea
        aria-label={m.integration_feishu_intent_aria({
          toolId: intent.toolId,
        })}
        placeholder={m.integration_feishu_intent_placeholder()}
        {...form.register('rawArguments')}
      />
      {form.formState.errors.rawArguments ? (
        <p className="text-xs text-destructive">
          {m.integration_feishu_json_invalid()}
        </p>
      ) : null}
      <Button disabled={busy} size="sm" type="submit" variant="outline">
        {m.integration_feishu_intent_submit()}
      </Button>
    </form>
  );
}

function FeishuProductPanel({
  busy,
  connection,
  state,
  onConfirm,
  onExecute,
  onReconcile,
  onToggleShortcut,
}: {
  busy: boolean;
  connection: IntegrationConnectionView;
  state: FeishuProductState;
  onConfirm: (
    intent: FeishuPendingIntentView,
    rawArguments: string
  ) => Promise<void>;
  onExecute: (
    connectionId: string,
    tool: FeishuToolView,
    rawArguments: string
  ) => Promise<FeishuExecutionView | undefined>;
  onReconcile: (intent: FeishuRecoveryIntentView) => Promise<void>;
  onToggleShortcut: (
    connectionId: string,
    toolId: string,
    enabled: boolean
  ) => Promise<void>;
}) {
  const shortcutIds = new Set(
    state.shortcuts
      .filter((shortcut) => !shortcut.hidden)
      .map((shortcut) => shortcut.toolId)
  );
  const latestTools = [...state.tools]
    .filter((tool) => tool.status === 'published')
    .sort((left, right) => right.discoveredAt.localeCompare(left.discoveredAt))
    .filter(
      (tool, index, tools) =>
        tools.findIndex((candidate) => candidate.id === tool.id) === index
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.integration_feishu_panel_title()}</CardTitle>
        <CardDescription>
          {m.integration_feishu_panel_description({
            identity: connectionPublicName(connection),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <h3 className="font-medium">
            {m.integration_feishu_catalog_title()}
          </h3>
          {latestTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.integration_feishu_catalog_empty()}
            </p>
          ) : (
            latestTools.map((tool) => {
              const shortcut = shortcutIds.has(tool.id);
              return (
                <section
                  aria-label={m.integration_feishu_tool_aria({
                    toolId: tool.id,
                  })}
                  className="space-y-3 rounded-lg border p-3"
                  key={`${tool.id}:${tool.revision}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{tool.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.integration_feishu_tool_meta({
                          revision: tool.revision,
                          risk: toolRiskLabel(tool.risk),
                          status: statusLabel(tool.status),
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {tool.status === 'published' ? (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void onToggleShortcut(
                              connection.id,
                              tool.id,
                              !shortcut
                            )
                          }
                          size="sm"
                          variant={shortcut ? 'secondary' : 'outline'}
                        >
                          {shortcut
                            ? m.integration_feishu_shortcut_remove()
                            : m.integration_feishu_shortcut_add()}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {tool.status === 'published' ? (
                    <FeishuToolInvocationForm
                      busy={busy}
                      connectionId={connection.id}
                      onExecute={onExecute}
                      tool={tool}
                    />
                  ) : null}
                </section>
              );
            })
          )}
        </div>

        {state.pendingIntents.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="font-medium">
                {m.integration_feishu_pending_title()}
              </h3>
              <p className="text-sm text-muted-foreground">
                {m.integration_feishu_intent_description()}
              </p>
              {state.pendingIntents.map((intent) => (
                <div
                  className="space-y-2 rounded-lg border p-3"
                  key={intent.id}
                >
                  <FeishuIntentConfirmationForm
                    busy={busy}
                    intent={intent}
                    onConfirm={onConfirm}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {state.recoveryIntents.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="font-medium">
                {m.integration_feishu_recovery_status()}
              </h3>
              {state.recoveryIntents.slice(0, 10).map((intent) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  key={intent.id}
                >
                  <div>
                    <p className="font-medium">{intent.toolId}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.integration_feishu_recovery_summary({
                        effect: intent.effectState
                          ? statusLabel(intent.effectState)
                          : m.integration_not_marked(),
                        outcome: intent.outcomeStatus
                          ? statusLabel(intent.outcomeStatus)
                          : m.integration_status_reconciliation_required(),
                        status: statusLabel(intent.status),
                      })}
                    </p>
                    {intent.reconciliationAttempts !== undefined ? (
                      <p className="text-xs text-muted-foreground">
                        {intent.nextReconcileAt
                          ? m.integration_feishu_reconcile_next({
                              nextAt: dateTimeLabel(intent.nextReconcileAt),
                              summary: m.integration_feishu_reconcile_attempts({
                                count: intent.reconciliationAttempts,
                              }),
                            })
                          : m.integration_feishu_reconcile_attempts({
                              count: intent.reconciliationAttempts,
                            })}
                      </p>
                    ) : null}
                    {intent.lastErrorCode ? (
                      <p className="text-xs text-destructive">
                        {m.integration_feishu_reconcile_last_error()}
                      </p>
                    ) : null}
                  </div>
                  {canReconcileFeishuIntent(intent) ? (
                    <Button
                      disabled={busy}
                      onClick={() => void onReconcile(intent)}
                      size="sm"
                      variant="outline"
                    >
                      {m.integration_feishu_reconcile()}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <Separator />

        <div className="space-y-3">
          <h3 className="font-medium">
            {m.integration_feishu_recent_activity()}
          </h3>
          {state.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.integration_feishu_activity_empty()}
            </p>
          ) : (
            <ol className="space-y-2">
              {[...state.activities]
                .sort((left, right) =>
                  right.executedAt.localeCompare(left.executedAt)
                )
                .slice(0, 5)
                .map((activity) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    key={activity.id}
                  >
                    <div>
                      <p className="font-medium">{activity.toolId}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.integration_feishu_activity_summary({
                          executedAt: dateTimeLabel(activity.executedAt),
                          status: statusLabel(activity.status),
                        })}
                      </p>
                    </div>
                    {activity.externalUrl ? (
                      <Button
                        render={
                          <a
                            href={activity.externalUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <span className="sr-only">
                              {m.integration_feishu_activity_open()}
                            </span>
                          </a>
                        }
                        size="icon-sm"
                        variant="outline"
                      >
                        <IconExternalLink />
                      </Button>
                    ) : null}
                  </li>
                ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function IntegrationSettings({
  scope = 'external',
}: {
  scope?: 'external' | 'model';
}) {
  const access = useWorkspaceAccess();
  const visibleProviders = PROVIDERS.filter((item) =>
    scope === 'model' ? item.provider === 'model' : item.provider !== 'model'
  );
  const initialDefinition = visibleProviders[0] ?? PROVIDERS[0];
  const canManage = access.can(
    scope === 'model'
      ? 'workspace.models.manage'
      : 'workspace.connections.manage'
  );
  const [rotateConnectionId, setRotateConnectionId] = useState<string>();
  const createAttempt = useRef<ConnectionCreationAttempt | undefined>(
    undefined
  );
  const feishuRetryKeys = useRef(new Map<string, string>());
  const feishuIntentRetryIdentities = useRef(new Map<string, string>());
  const {
    audit,
    busy,
    connections,
    douyinIntegrationStatus,
    douyinProducts,
    error,
    executeCommand,
    feishuProducts,
    loading,
    refresh,
    refreshing,
  } = useIntegrationSettings();
  const createForm = useForm<CreateIntegrationConnectionInput>({
    defaultValues: {
      capabilities: initialDefinition.capabilities.map(
        (capability) => capability.id
      ),
      provider: initialDefinition.provider,
      scopes: initialDefinition.capabilities
        .map((capability) => capability.id)
        .join(', '),
      secret: '',
      subject: '',
    },
    resolver: zodResolver(createIntegrationConnectionSchema),
  });
  const provider = createForm.watch('provider');
  const capabilities = createForm.watch('capabilities');
  const definition = providerDefinition(provider);

  const providerConnections = useMemo(
    () =>
      Object.fromEntries(
        PROVIDERS.map((item) => [
          item.provider,
          connections.filter(
            (connection) => connection.provider === item.provider
          ),
        ])
      ) as Record<IntegrationProvider, IntegrationConnectionView[]>,
    [connections]
  );
  const visibleConnections = useMemo(
    () =>
      connections.filter((connection) =>
        visibleProviders.some(
          (provider) => provider.provider === connection.provider
        )
      ),
    [connections, visibleProviders]
  );
  const visibleAudit = useMemo(
    () =>
      audit.filter((event) =>
        visibleConnections.some(
          (connection) => connection.id === event.connectionId
        )
      ),
    [audit, visibleConnections]
  );

  const execute = async (
    action: string,
    payload: Record<string, unknown>,
    successMessage: string,
    idempotencyKey?: string
  ) => {
    try {
      await executeCommand({ action, idempotencyKey, payload });
      toast.success(successMessage);
      return true;
    } catch {
      toast.error(m.integration_error_action_failed());
      return false;
    }
  };

  const changeProvider = (nextProvider: IntegrationProvider) => {
    const next = providerDefinition(nextProvider);
    createForm.reset({
      capabilities: next.capabilities.map((capability) => capability.id),
      provider: nextProvider,
      scopes: next.capabilities.map((capability) => capability.id).join(', '),
      secret: '',
      subject: '',
    });
  };

  const toggleCreateCapability = (capability: string, checked: boolean) => {
    createForm.setValue(
      'capabilities',
      checked
        ? [...new Set([...capabilities, capability])]
        : capabilities.filter((candidate) => candidate !== capability),
      { shouldDirty: true, shouldValidate: true }
    );
  };

  const createConnection = createForm.handleSubmit(async (values) => {
    const submissionDefinition = providerDefinition(values.provider);
    const submission = {
      provider: values.provider,
      identityMode: submissionDefinition.identityMode,
      requestedCapabilities: values.capabilities,
      grantedCapabilities:
        submissionDefinition.identityMode === 'byok' ? values.capabilities : [],
      ...(values.subject ? { subject: values.subject } : {}),
      credential: {
        value: values.secret,
        scope: integrationScopes(values.scopes),
        status: 'unverified',
      },
    };
    const result = await runConnectionCreationAttempt({
      attempt: createAttempt.current,
      createConnectionId: () => crypto.randomUUID(),
      createIdempotencyKey: () => crypto.randomUUID(),
      submissionFingerprint: JSON.stringify(submission),
      submit: (attempt) =>
        execute(
          'create_connection',
          { id: attempt.connectionId, ...submission },
          m.integration_connection_created(),
          attempt.idempotencyKey
        ),
    });
    createAttempt.current = result.attempt;
    if (!result.succeeded) return;
    createForm.reset({
      ...values,
      secret: '',
      subject: '',
    });
  });

  const rotateCredential = async (
    connection: IntegrationConnectionView,
    credentialValue: string,
    idempotencyKey: string
  ) => {
    const rotated = await execute(
      'rotate_credential',
      {
        connectionId: connection.id,
        credential: {
          value: credentialValue,
          scope: connection.credential.scope,
          status: 'unverified',
        },
      },
      m.integration_rotate_success(),
      idempotencyKey
    );
    if (rotated) setRotateConnectionId(undefined);
    return rotated;
  };

  const changeCapability = async (
    connection: IntegrationConnectionView,
    capability: string,
    active: boolean
  ) => {
    await execute(
      active ? 'activate_douyin_capability' : 'deactivate_douyin_capability',
      active
        ? {
            connectionId: connection.id,
            capability,
          }
        : { connectionId: connection.id, capability },
      active
        ? m.integration_capability_enabled_success()
        : m.integration_capability_disabled_success()
    );
  };

  const syncConnection = async (connection: IntegrationConnectionView) => {
    await execute(
      connection.provider === 'feishu'
        ? 'verify_feishu_connection'
        : 'sync_douyin_observe',
      { connectionId: connection.id },
      connection.provider === 'feishu'
        ? m.integration_feishu_verify_success()
        : m.integration_douyin_sync_success()
    );
  };

  const confirmDouyinPublish = async (
    connection: IntegrationConnectionView,
    contentSnapshotId: string,
    localScheduledAt: string,
    anchor?: { id: string; kind: 'poi' | 'mini_program' }
  ) => {
    if (!connection.subject) {
      toast.error(m.integration_douyin_account_missing());
      return undefined;
    }
    try {
      const result = await executeCommand<{ id: string }>({
        action: 'confirm_douyin_publish',
        payload: {
          accountSubject: connection.subject,
          ...(anchor ? { anchor } : {}),
          connectionId: connection.id,
          contentSnapshotId: contentSnapshotId.trim(),
          scheduledAt: douyinScheduledAt(localScheduledAt),
        },
      });
      toast.success(m.integration_douyin_confirm_success());
      return result.id;
    } catch {
      toast.error(m.integration_douyin_confirm_failed());
      return undefined;
    }
  };

  const submitDouyinPublish = async (
    confirmationId: string,
    contentSnapshotId: string,
    localScheduledAt: string
  ) => {
    await execute(
      'submit_douyin_publish',
      {
        confirmationId,
        contentSnapshotId: contentSnapshotId.trim(),
        scheduledAt: douyinScheduledAt(localScheduledAt),
      },
      m.integration_douyin_publish_job_submitted()
    );
  };

  const refreshDouyinPublish = async (job: DouyinPublishJobView) => {
    await execute(
      'refresh_douyin_publish',
      { jobId: job.id },
      m.integration_douyin_sync_updated()
    );
  };

  const toggleFeishuShortcut = async (
    connectionId: string,
    toolId: string,
    enabled: boolean
  ) => {
    const current = feishuProducts[connectionId]?.shortcuts ?? [];
    const shortcuts = enabled
      ? [
          ...current.filter((shortcut) => shortcut.toolId !== toolId),
          { hidden: false, order: current.length, toolId },
        ]
      : current.filter((shortcut) => shortcut.toolId !== toolId);
    await execute(
      'set_feishu_shortcuts',
      {
        connectionId,
        shortcuts: shortcuts.map((shortcut, order) => ({
          ...shortcut,
          order,
        })),
      },
      enabled
        ? m.integration_feishu_shortcut_added()
        : m.integration_feishu_shortcut_removed()
    );
  };

  const executeFeishuIntent = async (
    connectionId: string,
    tool: FeishuToolView,
    rawArguments: string
  ) => {
    let args: Record<string, unknown>;
    try {
      args = feishuArguments(rawArguments);
    } catch {
      toast.error(m.integration_feishu_json_invalid());
      return;
    }
    const retryIdentity = JSON.stringify({
      arguments: args,
      connectionId,
      toolId: tool.id,
    });
    const idempotencyKey =
      feishuRetryKeys.current.get(retryIdentity) ?? crypto.randomUUID();
    feishuRetryKeys.current.set(retryIdentity, idempotencyKey);
    try {
      const result = await executeCommand<{
        status: string;
        content?: string;
        output?: Record<string, unknown>;
        intent?: { id?: string };
      }>({
        action: 'execute_feishu_intent',
        payload: {
          arguments: args,
          connectionId,
          ...toolIntentScope(args),
          sideEffect: toolSideEffect(tool),
          source: 'explicit_user',
          toolId: tool.id,
        },
        idempotencyKey,
      });
      if (
        result.status !== 'confirmation_pending' &&
        result.status !== 'unknown' &&
        result.status !== 'reconciliation_required'
      ) {
        feishuRetryKeys.current.delete(retryIdentity);
      }
      if (result.status === 'confirmation_pending' && result.intent?.id) {
        feishuIntentRetryIdentities.current.set(
          result.intent.id,
          retryIdentity
        );
      }
      if (result.status === 'confirmation_pending') {
        toast.success(m.integration_feishu_confirm_pending());
      } else if (
        result.status === 'unknown' ||
        result.status === 'reconciliation_required'
      ) {
        toast.warning(m.integration_feishu_execute_reconciliation());
      } else if (result.status === 'completed') {
        toast.success(m.integration_feishu_execute_success());
      } else {
        toast.error(m.integration_feishu_execute_failed());
      }
      return result;
    } catch {
      toast.error(m.integration_feishu_execute_retry());
    }
    return undefined;
  };

  const confirmFeishuIntent = async (
    intent: FeishuPendingIntentView,
    rawArguments: string
  ) => {
    let args: Record<string, unknown>;
    try {
      args = feishuArguments(rawArguments);
    } catch {
      toast.error(m.integration_feishu_json_invalid());
      return;
    }
    try {
      const result = await executeCommand<{ status: string }>({
        action: 'confirm_feishu_intent',
        payload: { arguments: args, intentId: intent.id },
      });
      if (result.status === 'completed' || result.status === 'failed') {
        const retryIdentity = feishuIntentRetryIdentities.current.get(
          intent.id
        );
        if (retryIdentity) feishuRetryKeys.current.delete(retryIdentity);
        feishuIntentRetryIdentities.current.delete(intent.id);
      }
      if (
        result.status === 'unknown' ||
        result.status === 'reconciliation_required'
      ) {
        toast.warning(m.integration_feishu_confirm_reconciliation());
      } else if (result.status === 'completed') {
        toast.success(m.integration_feishu_confirm_success());
      } else {
        toast.error(m.integration_feishu_confirm_failed());
      }
    } catch {
      toast.error(m.integration_feishu_confirm_error());
    }
  };

  const reconcileFeishuIntent = async (intent: FeishuRecoveryIntentView) => {
    try {
      const result = await executeCommand<{ status: string }>({
        action: 'reconcile_feishu_intent',
        payload: { intentId: intent.id },
      });
      if (result.status === 'completed') {
        toast.success(m.integration_feishu_reconcile_success());
      } else if (result.status === 'failed') {
        toast.warning(m.integration_feishu_reconcile_failed());
      } else {
        toast.warning(m.integration_feishu_reconcile_unknown());
      }
    } catch {
      toast.error(m.integration_feishu_reconcile_error());
    }
  };

  return (
    <div className="space-y-6">
      {scope === 'model' && canManage ? (
        <StrictByokExecutionPanel connections={visibleConnections} />
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {visibleProviders.map((item) => {
          const Icon = item.icon;
          const activeConnections = providerConnections[item.provider].filter(
            (connection) => connection.status !== 'revoked'
          );
          return (
            <Card className="bg-surface-1" key={item.provider}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-5" />
                  {item.title()}
                  {item.provider === 'douyin' &&
                  douyinIntegrationStatus?.integrated === false ? (
                    <Badge variant="outline">
                      {m.integration_douyin_not_integrated_badge()}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>{item.description()}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {activeConnections.length > 0
                    ? m.integration_connection_count({
                        count: activeConnections.length,
                      })
                    : m.integration_not_connected()}
                </span>
                {activeConnections.some(
                  (connection) => connection.status === 'available'
                ) ? (
                  <Badge variant="secondary">{m.integration_available()}</Badge>
                ) : (
                  <Badge variant="outline">
                    {m.integration_pending_configuration()}
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canManage ? (
        <Card className="bg-surface-1">
          <CardHeader>
            <CardTitle>{m.integration_new_connection()}</CardTitle>
            <CardDescription>
              {m.integration_create_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createConnection}>
              <Tabs
                onValueChange={(value) =>
                  changeProvider(value as IntegrationProvider)
                }
                value={provider}
              >
                <TabsList aria-label={m.integration_connection_type_aria()}>
                  {visibleProviders.map((item) => (
                    <TabsTrigger key={item.provider} value={item.provider}>
                      {item.title()}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {provider === 'douyin' &&
                douyinIntegrationStatus?.integrated === false ? (
                  <Alert className="my-4">
                    <AlertTitle>
                      {m.integration_douyin_not_integrated_title()}
                    </AlertTitle>
                    <AlertDescription>
                      {m.integration_douyin_not_integrated_description()}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {visibleProviders.map((item) => (
                  <TabsContent key={item.provider} value={item.provider}>
                    <p className="mb-4 text-sm text-muted-foreground">
                      {item.description()}
                    </p>
                  </TabsContent>
                ))}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="integration-subject">
                      {definition.subjectLabel()}
                    </Label>
                    <Input
                      id="integration-subject"
                      placeholder={m.integration_subject_placeholder()}
                      {...createForm.register('subject')}
                    />
                    {createForm.formState.errors.subject ? (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.subject.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="integration-secret">
                      {m.integration_secret_write_only({
                        secretLabel: definition.secretLabel(),
                      })}
                    </Label>
                    <Input
                      autoComplete="new-password"
                      id="integration-secret"
                      placeholder={definition.secretPlaceholder()}
                      type="password"
                      {...createForm.register('secret')}
                    />
                    <p className="text-xs text-muted-foreground">
                      {m.integration_write_only_notice_description()}
                    </p>
                    {createForm.formState.errors.secret ? (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.secret.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="integration-scopes">
                      {m.integration_scopes()}
                    </Label>
                    <Input
                      id="integration-scopes"
                      placeholder={m.integration_scopes_placeholder()}
                      {...createForm.register('scopes')}
                    />
                    {createForm.formState.errors.scopes ? (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.scopes.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <Label>{m.integration_request_capabilities()}</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {definition.capabilities.map((capability) => (
                      <div
                        className="flex items-center justify-between rounded-lg bg-surface-2 p-3"
                        key={capability.id}
                      >
                        <span className="text-sm font-medium">
                          {capability.label()}
                        </span>
                        <Switch
                          aria-label={m.integration_request_capability_aria({
                            capability: capability.label(),
                          })}
                          checked={capabilities.includes(capability.id)}
                          onCheckedChange={(checked) =>
                            toggleCreateCapability(capability.id, checked)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <Button className="mt-4" disabled={busy} type="submit">
                  <IconPlugConnected />
                  {m.integration_create_connection()}
                </Button>
              </Tabs>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <IconShieldLock />
          <AlertTitle>{m.integration_read_only_title()}</AlertTitle>
          <AlertDescription>
            {scope === 'model'
              ? m.integration_read_only_description_model()
              : m.integration_read_only_description_external()}
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              {m.integration_configured_connections()}
            </h2>
            <p className="text-sm text-muted-foreground">
              {m.integration_configured_description()}
            </p>
          </div>
          <Button
            disabled={refreshing}
            onClick={() => void refresh()}
            variant="outline"
          >
            <IconRefresh />
            {m.integration_refresh()}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{m.integration_load_error_title()}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        ) : visibleConnections.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {m.integration_connection_empty()}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleConnections.map((connection) => (
              <ConnectionCard
                busy={busy}
                canManage={canManage}
                connection={connection}
                douyinIntegrated={douyinIntegrationStatus?.integrated}
                key={connection.id}
                onCapabilityChange={changeCapability}
                onDisconnect={async (candidate) => {
                  await execute(
                    'disconnect',
                    { connectionId: candidate.id },
                    m.integration_connection_disconnected()
                  );
                }}
                onRotate={rotateCredential}
                onRotateConnectionChange={setRotateConnectionId}
                onSync={syncConnection}
                rotateConnectionId={rotateConnectionId}
              />
            ))}
          </div>
        )}
      </section>

      {scope === 'external'
        ? connections
            .filter(
              (connection) =>
                connection.provider === 'douyin' &&
                connection.status !== 'revoked'
            )
            .map((connection) => (
              <DouyinOperationsPanel
                busy={busy}
                connection={connection}
                integrated={douyinIntegrationStatus?.integrated}
                key={`douyin-operations:${connection.id}`}
                onConfirm={confirmDouyinPublish}
                onRefreshJob={refreshDouyinPublish}
                onSubmit={submitDouyinPublish}
                onSync={syncConnection}
                snapshot={
                  douyinProducts[connection.id] ?? {
                    connectionId: connection.id,
                    contentSnapshots: [],
                    observeSnapshots: [],
                    publishJobs: [],
                    refreshedAt: '',
                  }
                }
              />
            ))
        : null}

      {scope === 'external'
        ? connections
            .filter(
              (connection) =>
                connection.provider === 'feishu' &&
                connection.status !== 'revoked'
            )
            .map((connection) => (
              <FeishuProductPanel
                busy={busy}
                connection={connection}
                key={`feishu-product:${connection.id}`}
                onConfirm={confirmFeishuIntent}
                onExecute={executeFeishuIntent}
                onReconcile={reconcileFeishuIntent}
                onToggleShortcut={toggleFeishuShortcut}
                state={
                  feishuProducts[connection.id] ?? {
                    activities: [],
                    pendingIntents: [],
                    recoveryIntents: [],
                    shortcuts: [],
                    tools: [],
                  }
                }
              />
            ))
        : null}

      <Collapsible>
        <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-4 rounded-lg bg-surface-1 p-4 text-left">
          <span>
            <span className="block font-semibold">
              {m.integration_audit_title()}
            </span>
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              {m.integration_audit_description()}
            </span>
          </span>
          <IconChevronDown aria-hidden="true" className="size-5 shrink-0" />
        </CollapsibleTrigger>
        <CollapsibleContent className="rounded-b-lg bg-surface-1 px-4 pb-4">
          {visibleAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.integration_audit_empty()}
            </p>
          ) : (
            <ol className="divide-y divide-divider">
              {visibleAudit.slice(0, 10).map((event) => {
                const connection = visibleConnections.find(
                  (candidate) => candidate.id === event.connectionId
                );
                return (
                  <li
                    className="flex flex-col justify-between gap-1 py-3 sm:flex-row sm:items-center"
                    key={event.id}
                  >
                    <div>
                      <p className="font-medium">{auditLabel(event.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.integration_audit_connection_name({
                          name: connection
                            ? connectionPublicName(connection)
                            : m.integration_unknown(),
                        })}
                      </p>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {dateTimeLabel(event.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function ModelByokSettings() {
  return <IntegrationSettings scope="model" />;
}
