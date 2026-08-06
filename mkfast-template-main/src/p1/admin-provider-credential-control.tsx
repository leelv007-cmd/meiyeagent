import { IconKey } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { IconTile } from '@/components/admin/shared/icon-tile';
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Routes } from '@/lib/routes';
import {
  admin_provider_credential_activation_note,
  admin_provider_credential_complete_on_supply,
  admin_provider_credential_empty,
  admin_provider_credential_receipt_expires,
  admin_provider_credential_receipt_id,
  admin_provider_credential_receipt_staged,
  admin_provider_credential_restart_effective,
  admin_provider_credential_revoke,
  admin_provider_credential_rotate,
  admin_provider_credential_rotated_at,
  admin_provider_credential_saved,
  admin_provider_credential_scope,
  admin_provider_credential_secret_input,
  admin_provider_credential_source_env,
  admin_provider_credential_source_env_fallback,
  admin_provider_credential_source_vault,
  admin_provider_credential_store,
  admin_provider_credential_test,
  admin_provider_credential_test_network_failed,
  admin_provider_credential_test_passed,
  admin_provider_credential_test_pending,
  admin_provider_credential_test_unauthorized,
  admin_provider_credential_test_unknown,
  admin_provider_credential_tested_at,
  admin_provider_credential_testing,
  admin_provider_credentials_description,
  admin_provider_credentials_title,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from './client';
import {
  stageCredentialRotationHandoff,
  type CredentialRotationHandoffRecord,
} from './provider-credential-rotation-handoff';
import { p1QueryKeys } from './query-keys';

type ProviderSlot = 'model.direct' | 'ark.media';

/** J5: map legacy slot status onto CredentialAccount 3-state trunk. */
type CredentialAccountTrunkStatus = 'pending' | 'active' | 'retired';
type CredentialDrainSubstateUi = 'none' | 'draining';

interface ProviderCredential {
  effectiveSource: 'vault' | 'env_fallback' | 'env';
  id: string;
  status?: string;
  /** CredentialAccount trunk when Core projects registry metadata. */
  accountStatus?: CredentialAccountTrunkStatus;
  drainSubstate?: CredentialDrainSubstateUi;
  credentialAccountId?: string;
  workspaceId?: string;
  credential?: {
    mask: string;
    version: number;
    status: string;
    scope: string[];
    testedAt?: string;
    testStatus?: 'passed' | 'unauthorized' | 'network_failed' | 'unknown';
    testErrorCode?: string;
  };
  updatedAt?: string;
}

/** Public metadata returned by admin_rotate_provider_credential stage path. */
interface StageRotationResponse {
  account?: { id?: string; workspaceId?: string };
  secureWriteReceipt?: {
    id: string;
    workspaceId: string;
    accountId: string;
    nextSecretVersion?: number;
    expiresAt: string;
  };
}

type StagedReceiptView = {
  receiptId: string;
  expiresAt: string;
  accountId: string;
};

type StatusVariant = NonNullable<BadgeProps['variant']>;

function resolveTrunkStatus(
  credential: ProviderCredential | undefined
): CredentialAccountTrunkStatus | 'empty' {
  if (credential?.accountStatus) return credential.accountStatus;
  if (!credential?.credential) return 'empty';
  const raw = credential.credential.status;
  if (raw === 'revoked' || raw === 'retired' || raw === 'expired') {
    return 'retired';
  }
  if (raw === 'active' || raw === 'ready') return 'active';
  return 'pending';
}

function trunkStatusLabel(status: CredentialAccountTrunkStatus | 'empty') {
  switch (status) {
    case 'pending':
      return '待激活';
    case 'active':
      return '已激活';
    case 'retired':
      return '已退役';
    default:
      return admin_provider_credential_empty();
  }
}

function trunkStatusVariant(
  status: CredentialAccountTrunkStatus | 'empty'
): StatusVariant {
  switch (status) {
    case 'active':
      return 'success-outline';
    case 'pending':
      return 'warning-outline';
    default:
      return 'secondary';
  }
}

function activationGateSatisfied(
  credential: ProviderCredential['credential'] | undefined
): boolean {
  return credential?.testStatus === 'passed' && Boolean(credential.testedAt);
}

const slots: readonly ProviderSlot[] = ['model.direct', 'ark.media'];

function readStagedReceipt(
  response: unknown
): CredentialRotationHandoffRecord | null {
  if (!response || typeof response !== 'object') return null;
  const body = response as StageRotationResponse;
  const receipt = body.secureWriteReceipt;
  if (
    !receipt ||
    typeof receipt.id !== 'string' ||
    typeof receipt.workspaceId !== 'string' ||
    typeof receipt.accountId !== 'string' ||
    typeof receipt.expiresAt !== 'string'
  ) {
    return null;
  }
  // Never accept or forward secretReference / raw secret from the response.
  return {
    workspaceId: receipt.workspaceId,
    accountId: receipt.accountId,
    receiptId: receipt.id,
    expiresAt: receipt.expiresAt,
  };
}

export function AdminProviderCredentialControl() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Partial<Record<ProviderSlot, string>>>(
    {}
  );
  const [stagedReceipts, setStagedReceipts] = useState<
    Partial<Record<ProviderSlot, StagedReceiptView>>
  >({});
  const [testingSlot, setTestingSlot] = useState<ProviderSlot>();
  const query = useQuery({
    queryKey: p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    queryFn: ({ signal }) =>
      queryP1<ProviderCredential[]>(
        'integrations',
        { action: 'admin_provider_credentials', payload: {} },
        signal
      ),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.module('integrations'),
    });

  const save = async (slot: ProviderSlot, existing: boolean) => {
    const value = values[slot]?.trim();
    if (!value) return;
    const response = await commandP1('integrations', {
      action: existing
        ? 'admin_rotate_provider_credential'
        : 'admin_store_provider_credential',
      payload: { slot, credential: { scope: ['provider.connect'], value } },
    });
    setValues((current) => ({ ...current, [slot]: '' }));
    const staged = existing ? readStagedReceipt(response) : null;
    if (staged) {
      stageCredentialRotationHandoff(staged);
      setStagedReceipts((current) => ({
        ...current,
        [slot]: {
          receiptId: staged.receiptId,
          expiresAt: staged.expiresAt,
          accountId: staged.accountId,
        },
      }));
      toast.success(admin_provider_credential_receipt_staged());
    } else {
      setStagedReceipts((current) => {
        if (!current[slot]) return current;
        const next = { ...current };
        delete next[slot];
        return next;
      });
      toast.success(admin_provider_credential_saved());
    }
    await refresh();
  };

  const revoke = async (slot: ProviderSlot) => {
    await commandP1('integrations', {
      action: 'admin_revoke_provider_credential',
      payload: { slot },
    });
    await refresh();
  };

  const testConnection = async (slot: ProviderSlot) => {
    setTestingSlot(slot);
    try {
      await commandP1('integrations', {
        action: 'admin_test_provider_connection',
        payload: { slot },
      });
      await refresh();
    } finally {
      setTestingSlot(undefined);
    }
  };

  return (
    <Frame>
      <FrameHeader className="gap-1">
        <FrameTitle>{admin_provider_credentials_title()}</FrameTitle>
        <FrameDescription>
          {admin_provider_credentials_description()}
        </FrameDescription>
      </FrameHeader>
      {slots.map((slot) => {
        const credential = query.data?.find(
          (item) => item.id === `platform:${slot}`
        );
        const hasCredential = Boolean(credential?.credential);
        const trunk = resolveTrunkStatus(credential);
        const drain = credential?.drainSubstate ?? 'none';
        const gateOk = activationGateSatisfied(credential?.credential);
        const envFallback = credential?.effectiveSource === 'env_fallback';
        return (
          <FramePanel
            className="space-y-3"
            data-testid="provider-credential-slot"
            data-slot={slot}
            data-trunk-status={trunk}
            data-drain={drain}
            data-env-fallback={String(envFallback)}
            key={slot}
          >
            <div className="flex items-center gap-3">
              <IconTile>
                <IconKey aria-hidden="true" />
              </IconTile>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{slot}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {credential?.credential
                    ? `${credential.credential.mask} · v${credential.credential.version}`
                    : '—'}
                </span>
              </div>
              <Badge variant={trunkStatusVariant(trunk)} className="shrink-0">
                {trunkStatusLabel(trunk)}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-1">
              {credential?.effectiveSource ? (
                <Badge
                  variant={envFallback ? 'destructive-outline' : 'secondary'}
                >
                  {providerCredentialSource(credential.effectiveSource)}
                </Badge>
              ) : null}
              {hasCredential ? (
                <Badge
                  variant={
                    drain === 'draining' ? 'warning-outline' : 'secondary'
                  }
                >
                  {drain === 'draining' ? '排空中' : '未排空'}
                </Badge>
              ) : null}
              {hasCredential ? (
                <Badge
                  variant={gateOk ? 'success-outline' : 'warning-outline'}
                  data-testid="provider-credential-activation-gate"
                  data-satisfied={String(gateOk)}
                >
                  激活门：{gateOk ? '满足' : '未满足'}
                </Badge>
              ) : null}
            </div>

            {credential?.credential ? (
              <p className="text-muted-foreground text-xs">
                {admin_provider_credential_scope({
                  scope: credential.credential.scope.join(', ') || '—',
                })}
              </p>
            ) : null}
            {envFallback ? (
              <p
                data-testid="provider-credential-migration-entry"
                className="border-destructive/30 text-destructive rounded-lg border p-2 text-xs"
              >
                环境变量回退风险持续可见：迁移到保险箱写入后重启生效。
              </p>
            ) : null}

            <Input
              aria-label={admin_provider_credential_secret_input({ slot })}
              autoComplete="new-password"
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [slot]: event.target.value,
                }))
              }
              type="password"
              value={values[slot] ?? ''}
            />
            <div className="flex gap-2">
              <Button onClick={() => void save(slot, hasCredential)} size="sm">
                {hasCredential
                  ? admin_provider_credential_rotate()
                  : admin_provider_credential_store()}
              </Button>
              {hasCredential ? (
                <>
                  <Button
                    disabled={testingSlot === slot}
                    onClick={() => void testConnection(slot)}
                    size="sm"
                    variant="outline"
                  >
                    {testingSlot === slot
                      ? admin_provider_credential_testing()
                      : admin_provider_credential_test()}
                  </Button>
                  <Button
                    onClick={() => void revoke(slot)}
                    size="sm"
                    variant="outline"
                  >
                    {admin_provider_credential_revoke()}
                  </Button>
                </>
              ) : null}
            </div>

            {stagedReceipts[slot] ? (
              <div
                className="border-primary/30 bg-primary/5 space-y-2 rounded-lg border p-3 text-xs"
                data-testid="provider-credential-rotation-receipt"
                data-slot={slot}
                data-account-id={stagedReceipts[slot]?.accountId}
              >
                <p className="font-medium">
                  {admin_provider_credential_receipt_staged()}
                </p>
                <p
                  className="font-mono break-all"
                  data-testid="provider-credential-receipt-id"
                >
                  {admin_provider_credential_receipt_id({
                    receiptId: stagedReceipts[slot]?.receiptId ?? '',
                  })}
                </p>
                <p data-testid="provider-credential-receipt-expires">
                  {admin_provider_credential_receipt_expires({
                    expiresAt: new Date(
                      stagedReceipts[slot]?.expiresAt ?? 0
                    ).toLocaleString(),
                  })}
                </p>
                {/*
                  Same-origin navigation only — receiptId must never enter query,
                  hash, or the link href (Referer risk). Handoff is SPA memory.
                */}
                <a
                  className="text-primary inline-flex font-medium underline"
                  data-testid="provider-credential-complete-rotation"
                  href={Routes.AdminSupply}
                >
                  {admin_provider_credential_complete_on_supply()}
                </a>
              </div>
            ) : null}

            <div className="text-muted-foreground space-y-1 text-xs">
              <p>{providerTestStatus(credential?.credential?.testStatus)}</p>
              {credential?.updatedAt ? (
                <p>
                  {admin_provider_credential_rotated_at()}:{' '}
                  {new Date(credential.updatedAt).toLocaleString()}
                </p>
              ) : null}
              {credential?.credential?.testedAt ? (
                <p>
                  {admin_provider_credential_tested_at({
                    testedAt: new Date(
                      credential.credential.testedAt
                    ).toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
          </FramePanel>
        );
      })}
      <FrameFooter className="text-muted-foreground text-xs">
        <p>{admin_provider_credential_activation_note()}</p>
        <p>{admin_provider_credential_restart_effective()}</p>
      </FrameFooter>
    </Frame>
  );
}

function providerTestStatus(
  status: NonNullable<ProviderCredential['credential']>['testStatus']
) {
  switch (status) {
    case 'passed':
      return admin_provider_credential_test_passed();
    case 'unauthorized':
      return admin_provider_credential_test_unauthorized();
    case 'network_failed':
      return admin_provider_credential_test_network_failed();
    case 'unknown':
      return admin_provider_credential_test_unknown();
    default:
      return admin_provider_credential_test_pending();
  }
}

function providerCredentialSource(
  source: ProviderCredential['effectiveSource']
) {
  switch (source) {
    case 'vault':
      return admin_provider_credential_source_vault();
    case 'env_fallback':
      return admin_provider_credential_source_env_fallback();
    case 'env':
      return admin_provider_credential_source_env();
  }
}
