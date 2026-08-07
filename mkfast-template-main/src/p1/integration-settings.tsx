import { zodResolver } from '@hookform/resolvers/zod';
import {
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
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  integration_audit_action_connection_created,
  integration_audit_action_connection_disconnected,
  integration_audit_action_credential_rotated,
  integration_audit_action_unknown,
  integration_audit_connection_name,
  integration_audit_description,
  integration_audit_empty,
  integration_audit_title,
  integration_capabilities,
  integration_capability_active,
  integration_capability_degraded,
  integration_capability_granted,
  integration_capability_not_granted,
  integration_capability_not_granted_description,
  integration_capability_pending_owner,
  integration_configured_connections,
  integration_configured_description,
  integration_connected,
  integration_connection_count,
  integration_connection_created,
  integration_connection_description,
  integration_connection_disconnected,
  integration_connection_empty,
  integration_connection_last_used,
  integration_connection_status,
  integration_connection_type_aria,
  integration_create_connection,
  integration_create_description,
  integration_disconnect_aria,
  integration_error_action_failed,
  integration_feishu_activity_empty,
  integration_feishu_activity_open,
  integration_feishu_activity_summary,
  integration_feishu_catalog_empty,
  integration_feishu_catalog_title,
  integration_feishu_confirm_error,
  integration_feishu_confirm_failed,
  integration_feishu_confirm_pending,
  integration_feishu_confirm_reconciliation,
  integration_feishu_confirm_success,
  integration_feishu_example_query,
  integration_feishu_execute,
  integration_feishu_execute_failed,
  integration_feishu_execute_reconciliation,
  integration_feishu_execute_retry,
  integration_feishu_execute_success,
  integration_feishu_intent_aria,
  integration_feishu_intent_description,
  integration_feishu_intent_placeholder,
  integration_feishu_intent_submit,
  integration_feishu_intent_summary,
  integration_feishu_json_invalid,
  integration_feishu_panel_description,
  integration_feishu_panel_title,
  integration_feishu_pending_title,
  integration_feishu_recent_activity,
  integration_feishu_reconcile,
  integration_feishu_reconcile_attempts,
  integration_feishu_reconcile_error,
  integration_feishu_reconcile_failed,
  integration_feishu_reconcile_last_error,
  integration_feishu_reconcile_next,
  integration_feishu_reconcile_success,
  integration_feishu_reconcile_unknown,
  integration_feishu_recovery_status,
  integration_feishu_recovery_summary,
  integration_feishu_shortcut_add,
  integration_feishu_shortcut_added,
  integration_feishu_shortcut_remove,
  integration_feishu_shortcut_removed,
  integration_feishu_tool_arguments,
  integration_feishu_tool_arguments_placeholder,
  integration_feishu_tool_aria,
  integration_feishu_tool_meta,
  integration_feishu_tool_result,
  integration_feishu_verify,
  integration_feishu_verify_success,
  integration_load_error_title,
  integration_new_connection,
  integration_not_connected,
  integration_not_connected_next_step,
  integration_not_marked,
  integration_not_yet_created,
  integration_pending_configuration,
  integration_pending_configuration_next_step,
  integration_provider_feishu_capability_tools,
  integration_provider_feishu_description,
  integration_provider_feishu_secret,
  integration_provider_feishu_secret_placeholder,
  integration_provider_feishu_subject,
  integration_provider_feishu_title,
  integration_provider_model_capability_invoke,
  integration_provider_model_description,
  integration_provider_model_secret,
  integration_provider_model_secret_placeholder,
  integration_provider_model_subject,
  integration_provider_model_title,
  integration_read_only_description_external,
  integration_read_only_description_model,
  integration_read_only_title,
  integration_refresh,
  integration_request_capabilities,
  integration_request_capabilities_hint,
  integration_request_capability_aria,
  integration_rotate_cancel,
  integration_rotate_confirm,
  integration_rotate_credential,
  integration_rotate_new_credential,
  integration_rotate_placeholder,
  integration_rotate_success,
  integration_secret_write_only,
  integration_status_active,
  integration_status_authorized,
  integration_status_available,
  integration_status_claimed,
  integration_status_completed,
  integration_status_confirmation_pending,
  integration_status_degraded,
  integration_status_disabled,
  integration_status_draft,
  integration_status_empty,
  integration_status_executed,
  integration_status_exhausted,
  integration_status_expired,
  integration_status_failed,
  integration_status_manual_required,
  integration_status_pending_review,
  integration_status_permission_missing,
  integration_status_published,
  integration_status_rate_limited,
  integration_status_reauthorize_required,
  integration_status_reconciliation_required,
  integration_status_retired,
  integration_status_reviewing,
  integration_status_revoked,
  integration_status_scheduled,
  integration_status_settled,
  integration_status_submitted,
  integration_status_submitting,
  integration_status_unavailable,
  integration_status_unknown,
  integration_status_unverified,
  integration_subject_placeholder,
  integration_tool_risk_destructive,
  integration_tool_risk_open_world,
  integration_tool_risk_read,
  integration_tool_risk_write,
  integration_tool_side_effect_create,
  integration_tool_side_effect_delete,
  integration_tool_side_effect_edit,
  integration_tool_side_effect_overwrite,
  integration_tool_side_effect_read,
  integration_tool_side_effect_send,
  integration_unknown,
  integration_write_only_notice_description,
  p1_admin_audit_byok_action_completed,
  p1_admin_audit_byok_action_failed,
  p1_admin_audit_byok_action_unknown,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  createIntegrationConnectionSchema,
  feishuArguments,
  feishuArgumentsFormSchema,
  integrationScopes,
  runConnectionCreationAttempt,
  runCredentialRotationAttempt,
  rotateIntegrationCredentialSchema,
  type ConnectionCreationAttempt,
  type CredentialRotationAttempt,
  type CreateIntegrationConnectionInput,
  type FeishuArgumentsFormInput,
  type RotateIntegrationCredentialInput,
} from '@/p1/integration-settings-forms';
import {
  canReconcileFeishuIntent,
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
    title: integration_provider_model_title,
    description: integration_provider_model_description,
    identityMode: 'byok',
    subjectLabel: integration_provider_model_subject,
    secretLabel: integration_provider_model_secret,
    secretPlaceholder: integration_provider_model_secret_placeholder,
    capabilities: [
      {
        id: 'model.invoke',
        label: integration_provider_model_capability_invoke,
      },
    ],
    icon: IconCloudLock,
  },
  {
    provider: 'feishu',
    title: integration_provider_feishu_title,
    description: integration_provider_feishu_description,
    identityMode: 'oauth_user',
    subjectLabel: integration_provider_feishu_subject,
    secretLabel: integration_provider_feishu_secret,
    secretPlaceholder: integration_provider_feishu_secret_placeholder,
    capabilities: [
      {
        id: 'mcp.tools',
        label: integration_provider_feishu_capability_tools,
      },
    ],
    icon: IconBuilding,
  },
];

const STATUS_LABELS: Record<string, () => string> = {
  active: integration_status_active,
  available: integration_status_available,
  authorized: integration_status_authorized,
  claimed: integration_status_claimed,
  completed: integration_status_completed,
  confirmation_pending: integration_status_confirmation_pending,
  degraded: integration_status_degraded,
  disabled: integration_status_disabled,
  draft: integration_status_draft,
  empty: integration_status_empty,
  executed: integration_status_executed,
  exhausted: integration_status_exhausted,
  expired: integration_status_expired,
  failed: integration_status_failed,
  manual_required: integration_status_manual_required,
  pending_review: integration_status_pending_review,
  permission_missing: integration_status_permission_missing,
  published: integration_status_published,
  rate_limited: integration_status_rate_limited,
  reauthorize_required: integration_status_reauthorize_required,
  reconciliation_required: integration_status_reconciliation_required,
  retired: integration_status_retired,
  reviewing: integration_status_reviewing,
  revoked: integration_status_revoked,
  scheduled: integration_status_scheduled,
  settled: integration_status_settled,
  submitted: integration_status_submitted,
  submitting: integration_status_submitting,
  unavailable: integration_status_unavailable,
  unverified: integration_status_unverified,
};

const AUDIT_LABELS: Record<string, () => string> = {
  'connection.created': integration_audit_action_connection_created,
  'connection.disconnected': integration_audit_action_connection_disconnected,
  'credential.rotated': integration_audit_action_credential_rotated,
  'byok.completed': p1_admin_audit_byok_action_completed,
  'byok.failed': p1_admin_audit_byok_action_failed,
  'byok.unknown': p1_admin_audit_byok_action_unknown,
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
  if (!value) return integration_unknown();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? integration_unknown()
    : formatLocaleDateTime(timestamp);
}

function statusLabel(status?: string) {
  const label = status ? STATUS_LABELS[status] : undefined;
  return label?.() ?? integration_status_unknown();
}

function toolRiskLabel(risk: FeishuToolView['risk']) {
  if (risk === 'read') return integration_tool_risk_read();
  if (risk === 'write') return integration_tool_risk_write();
  if (risk === 'destructive') return integration_tool_risk_destructive();
  return integration_tool_risk_open_world();
}

function sideEffectLabel(sideEffect: FeishuPendingIntentView['sideEffect']) {
  if (sideEffect === 'read') return integration_tool_side_effect_read();
  if (sideEffect === 'create') return integration_tool_side_effect_create();
  if (sideEffect === 'edit') return integration_tool_side_effect_edit();
  if (sideEffect === 'send') return integration_tool_side_effect_send();
  if (sideEffect === 'delete') return integration_tool_side_effect_delete();
  return integration_tool_side_effect_overwrite();
}

function auditLabel(action: string) {
  return AUDIT_LABELS[action]?.() ?? integration_audit_action_unknown();
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
  rotateConnectionId?: string;
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
  rotateConnectionId,
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
  const canSync = connectionEnabled && connection.provider === 'feishu';
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
          {integration_connection_description({
            mask: connection.credential.mask,
            provider: definition.title(),
            version: connection.credential.version,
          })}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button
              aria-label={integration_disconnect_aria()}
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
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {integration_connection_status()}
            </dt>
            <dd className="mt-1 font-medium">
              {statusLabel(connection.credential.status)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {integration_connection_last_used()}
            </dt>
            <dd className="mt-1 font-medium">
              {dateTimeLabel(connection.credential.lastUsedAt)}
            </dd>
          </div>
        </dl>

        <Separator />

        <div className="space-y-3">
          <h3 className="font-medium">{integration_capabilities()}</h3>
          {definition.capabilities.map((capability) => {
            const granted = connection.grantedCapabilities.includes(
              capability.id
            );
            const active = connection.activeCapabilities.includes(
              capability.id
            );
            const degraded = connection.degradedCapabilities[capability.id];
            return (
              <div
                className="flex items-start justify-between gap-4 border-b border-divider p-3 last:border-b-0"
                key={capability.id}
              >
                <div>
                  <p className="font-medium">{capability.label()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {!granted
                      ? integration_capability_not_granted_description()
                      : degraded
                        ? integration_capability_degraded()
                        : active
                          ? integration_capability_active()
                          : integration_capability_pending_owner()}
                  </p>
                </div>
                <Badge variant={granted ? 'secondary' : 'outline'}>
                  {granted
                    ? integration_capability_granted()
                    : integration_capability_not_granted()}
                </Badge>
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
              {integration_feishu_verify()}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              disabled={busy || !connectionEnabled}
              onClick={toggleRotation}
              variant="outline"
            >
              <IconKey />
              {integration_rotate_credential()}
            </Button>
          ) : null}
        </div>

        {rotating && canManage ? (
          <form
            className="space-y-3 rounded-lg bg-surface-2 p-3"
            onSubmit={submitRotation}
          >
            <Label htmlFor={`rotate-${connection.id}`}>
              {integration_rotate_new_credential()}
            </Label>
            <Input
              autoComplete="new-password"
              id={`rotate-${connection.id}`}
              placeholder={integration_rotate_placeholder()}
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
                {integration_rotate_confirm()}
              </Button>
              <Button
                disabled={busy}
                onClick={toggleRotation}
                type="button"
                variant="ghost"
              >
                {integration_rotate_cancel()}
              </Button>
            </div>
          </form>
        ) : null}
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
        {integration_feishu_tool_arguments()}
      </Label>
      <Textarea
        id={`feishu-tool-${connectionId}-${tool.id}`}
        placeholder={integration_feishu_tool_arguments_placeholder({
          example: JSON.stringify({
            query: integration_feishu_example_query(),
          }),
        })}
        {...form.register('rawArguments')}
      />
      {form.formState.errors.rawArguments ? (
        <p className="text-xs text-destructive">
          {integration_feishu_json_invalid()}
        </p>
      ) : null}
      <Button disabled={busy} size="sm" type="submit" variant="outline">
        <IconPlayerPlay />
        {integration_feishu_execute()}
      </Button>
      {result ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            {integration_feishu_tool_result({
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
        {integration_feishu_intent_summary({
          sideEffect: sideEffectLabel(intent.sideEffect),
          taskId: intent.confirmationTaskId ?? integration_not_yet_created(),
        })}
      </p>
      <Textarea
        aria-label={integration_feishu_intent_aria({
          toolId: intent.toolId,
        })}
        placeholder={integration_feishu_intent_placeholder()}
        {...form.register('rawArguments')}
      />
      {form.formState.errors.rawArguments ? (
        <p className="text-xs text-destructive">
          {integration_feishu_json_invalid()}
        </p>
      ) : null}
      <Button disabled={busy} size="sm" type="submit" variant="outline">
        {integration_feishu_intent_submit()}
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
        <CardTitle>{integration_feishu_panel_title()}</CardTitle>
        <CardDescription>
          {integration_feishu_panel_description({
            identity: connectionPublicName(connection),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <h3 className="font-medium">{integration_feishu_catalog_title()}</h3>
          {latestTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {integration_feishu_catalog_empty()}
            </p>
          ) : (
            latestTools.map((tool) => {
              const shortcut = shortcutIds.has(tool.id);
              return (
                <section
                  aria-label={integration_feishu_tool_aria({
                    toolId: tool.id,
                  })}
                  className="space-y-3 rounded-lg border p-3"
                  key={`${tool.id}:${tool.revision}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{tool.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {integration_feishu_tool_meta({
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
                            ? integration_feishu_shortcut_remove()
                            : integration_feishu_shortcut_add()}
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
                {integration_feishu_pending_title()}
              </h3>
              <p className="text-sm text-muted-foreground">
                {integration_feishu_intent_description()}
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
                {integration_feishu_recovery_status()}
              </h3>
              {state.recoveryIntents.slice(0, 10).map((intent) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  key={intent.id}
                >
                  <div>
                    <p className="font-medium">{intent.toolId}</p>
                    <p className="text-xs text-muted-foreground">
                      {integration_feishu_recovery_summary({
                        effect: intent.effectState
                          ? statusLabel(intent.effectState)
                          : integration_not_marked(),
                        outcome: intent.outcomeStatus
                          ? statusLabel(intent.outcomeStatus)
                          : integration_status_reconciliation_required(),
                        status: statusLabel(intent.status),
                      })}
                    </p>
                    {intent.reconciliationAttempts !== undefined ? (
                      <p className="text-xs text-muted-foreground">
                        {intent.nextReconcileAt
                          ? integration_feishu_reconcile_next({
                              nextAt: dateTimeLabel(intent.nextReconcileAt),
                              summary: integration_feishu_reconcile_attempts({
                                count: intent.reconciliationAttempts,
                              }),
                            })
                          : integration_feishu_reconcile_attempts({
                              count: intent.reconciliationAttempts,
                            })}
                      </p>
                    ) : null}
                    {intent.lastErrorCode ? (
                      <p className="text-xs text-destructive">
                        {integration_feishu_reconcile_last_error()}
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
                      {integration_feishu_reconcile()}
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
            {integration_feishu_recent_activity()}
          </h3>
          {state.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {integration_feishu_activity_empty()}
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
                        {integration_feishu_activity_summary({
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
                              {integration_feishu_activity_open()}
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
  settings,
}: {
  scope?: 'external' | 'model';
  settings?: ReturnType<typeof useIntegrationSettings>;
}) {
  const liveSettings = useIntegrationSettings(settings === undefined);
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
  const canReadAudit = access.can('audit.view');
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
    error,
    executeCommand,
    feishuProducts,
    loading,
    refresh,
    refreshing,
  } = settings ?? liveSettings;
  const createForm = useForm<CreateIntegrationConnectionInput>({
    defaultValues: {
      // Every capability starts off. Granting 发布 to a public platform is a
      // consequential act, and a pre-checked switch makes it something the
      // merchant did without deciding to; turning one on is now the explicit
      // action. The scope list the server receives is derived from these
      // switches, so it can never be wider than what was switched on.
      capabilities: [],
      provider: initialDefinition.provider,
      scopes: '',
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
      toast.error(integration_error_action_failed());
      return false;
    }
  };

  const changeProvider = (nextProvider: IntegrationProvider) => {
    createForm.reset({
      capabilities: [],
      provider: nextProvider,
      scopes: '',
      secret: '',
      subject: '',
    });
  };

  const toggleCreateCapability = (capability: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...capabilities, capability])]
      : capabilities.filter((candidate) => candidate !== capability);
    createForm.setValue('capabilities', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // The raw scope string (`publish, observe, publish.poi,
    // publish.mini_program`) used to be a merchant-editable text field. It is
    // the platform's vocabulary, not the shop owner's, so the switches above —
    // which carry Chinese capability names — are now the only control and the
    // scope list is compiled from them.
    createForm.setValue('scopes', next.join(', '), {
      shouldDirty: true,
      shouldValidate: true,
    });
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
          integration_connection_created(),
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
      integration_rotate_success(),
      idempotencyKey
    );
    if (rotated) setRotateConnectionId(undefined);
    return rotated;
  };

  const syncConnection = async (connection: IntegrationConnectionView) => {
    await execute(
      'verify_feishu_connection',
      { connectionId: connection.id },
      integration_feishu_verify_success()
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
        ? integration_feishu_shortcut_added()
        : integration_feishu_shortcut_removed()
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
      toast.error(integration_feishu_json_invalid());
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
        toast.success(integration_feishu_confirm_pending());
      } else if (
        result.status === 'unknown' ||
        result.status === 'reconciliation_required'
      ) {
        toast.warning(integration_feishu_execute_reconciliation());
      } else if (result.status === 'completed') {
        toast.success(integration_feishu_execute_success());
      } else {
        toast.error(integration_feishu_execute_failed());
      }
      return result;
    } catch {
      toast.error(integration_feishu_execute_retry());
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
      toast.error(integration_feishu_json_invalid());
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
        toast.warning(integration_feishu_confirm_reconciliation());
      } else if (result.status === 'completed') {
        toast.success(integration_feishu_confirm_success());
      } else {
        toast.error(integration_feishu_confirm_failed());
      }
    } catch {
      toast.error(integration_feishu_confirm_error());
    }
  };

  const reconcileFeishuIntent = async (intent: FeishuRecoveryIntentView) => {
    try {
      const result = await executeCommand<{ status: string }>({
        action: 'reconcile_feishu_intent',
        payload: { intentId: intent.id },
      });
      if (result.status === 'completed') {
        toast.success(integration_feishu_reconcile_success());
      } else if (result.status === 'failed') {
        toast.warning(integration_feishu_reconcile_failed());
      } else {
        toast.warning(integration_feishu_reconcile_unknown());
      }
    } catch {
      toast.error(integration_feishu_reconcile_error());
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {visibleProviders.map((item) => {
          const Icon = item.icon;
          const activeConnections = providerConnections[item.provider].filter(
            (connection) => connection.status !== 'revoked'
          );
          /*
            One connector, one status word. The card used to print two at once
            — a "not connected" line beside a "needs setup" badge — which read
            as two verdicts on the same thing. The three states are ordered by
            how far the merchant has got, and the line beside the badge says
            what happens next instead of repeating the badge.
          */
          const status = activeConnections.some(
            (connection) => connection.status === 'available'
          )
            ? 'connected'
            : activeConnections.length > 0
              ? 'pending'
              : 'disconnected';
          return (
            <Card className="bg-surface-1" key={item.provider}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-5" />
                  {item.title()}
                </CardTitle>
                <CardDescription>{item.description()}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {status === 'connected'
                    ? integration_connection_count({
                        count: activeConnections.length,
                      })
                    : status === 'pending'
                      ? integration_pending_configuration_next_step()
                      : integration_not_connected_next_step()}
                </span>
                <Badge
                  data-testid={`integration-status-${item.provider}`}
                  variant={status === 'connected' ? 'secondary' : 'outline'}
                >
                  {status === 'connected'
                    ? integration_connected()
                    : status === 'pending'
                      ? integration_pending_configuration()
                      : integration_not_connected()}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canManage ? (
        <Card className="bg-surface-1">
          <CardHeader>
            <CardTitle>{integration_new_connection()}</CardTitle>
            <CardDescription>
              {integration_create_description()}
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
                <TabsList aria-label={integration_connection_type_aria()}>
                  {visibleProviders.map((item) => (
                    <TabsTrigger key={item.provider} value={item.provider}>
                      {item.title()}
                    </TabsTrigger>
                  ))}
                </TabsList>
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
                      placeholder={integration_subject_placeholder()}
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
                      {integration_secret_write_only({
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
                      {integration_write_only_notice_description()}
                    </p>
                    {createForm.formState.errors.secret ? (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.secret.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <Label>{integration_request_capabilities()}</Label>
                  <p className="text-xs text-muted-foreground">
                    {integration_request_capabilities_hint()}
                  </p>
                  {createForm.formState.errors.scopes ? (
                    <p className="text-xs text-destructive">
                      {createForm.formState.errors.scopes.message}
                    </p>
                  ) : null}
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
                          aria-label={integration_request_capability_aria({
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
                  {integration_create_connection()}
                </Button>
              </Tabs>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <IconShieldLock />
          <AlertTitle>{integration_read_only_title()}</AlertTitle>
          <AlertDescription>
            {scope === 'model'
              ? integration_read_only_description_model()
              : integration_read_only_description_external()}
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              {integration_configured_connections()}
            </h2>
            <p className="text-sm text-muted-foreground">
              {integration_configured_description()}
            </p>
          </div>
          <Button
            disabled={refreshing}
            onClick={() => void refresh()}
            variant="outline"
          >
            <IconRefresh />
            {integration_refresh()}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{integration_load_error_title()}</AlertTitle>
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
              {integration_connection_empty()}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleConnections.map((connection) => (
              <ConnectionCard
                busy={busy}
                canManage={canManage}
                connection={connection}
                key={connection.id}
                onDisconnect={async (candidate) => {
                  await execute(
                    'disconnect',
                    { connectionId: candidate.id },
                    integration_connection_disconnected()
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

      {/*
        The activity panel reads `integrations/audit`, which the capability
        registry pins to `audit.view` — a platform-admin key. On a merchant's
        own settings page it could only ever report "no activity yet" while
        the request behind it 403'd, so it is shown to the roles that can
        actually read it.
      */}
      {canReadAudit ? (
        <Collapsible>
          <CollapsibleTrigger className="flex min-h-touch-target w-full items-center justify-between gap-4 rounded-lg bg-surface-1 p-4 text-left">
            <span>
              <span className="block font-semibold">
                {integration_audit_title()}
              </span>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                {integration_audit_description()}
              </span>
            </span>
            <IconChevronDown aria-hidden="true" className="size-5 shrink-0" />
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-b-lg bg-surface-1 px-4 pb-4">
            {visibleAudit.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {integration_audit_empty()}
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
                        <p className="font-medium">
                          {auditLabel(event.action)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {integration_audit_connection_name({
                            name: connection
                              ? connectionPublicName(connection)
                              : integration_unknown(),
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
      ) : null}
    </div>
  );
}

export function ModelByokSettings() {
  return <IntegrationSettings scope="model" />;
}
