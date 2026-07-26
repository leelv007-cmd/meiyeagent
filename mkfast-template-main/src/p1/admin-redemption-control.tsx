/**
 * Td-4: platform admin redemption code management.
 * Uses existing admin AdminPanel/Button patterns; calls redemptions P1 module.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  admin_redemption_actions,
  admin_redemption_code,
  admin_redemption_code_placeholder,
  admin_redemption_codes_count,
  admin_redemption_codes_title,
  admin_redemption_create,
  admin_redemption_create_description,
  admin_redemption_create_failed,
  admin_redemption_create_success,
  admin_redemption_create_title,
  admin_redemption_empty,
  admin_redemption_expires_at,
  admin_redemption_grant_transaction,
  admin_redemption_grants,
  admin_redemption_load_failed,
  admin_redemption_resource_audio,
  admin_redemption_resource_copy,
  admin_redemption_resource_image,
  admin_redemption_resource_video,
  admin_redemption_status,
  admin_redemption_status_active,
  admin_redemption_status_expired,
  admin_redemption_status_redeemed,
  admin_redemption_status_voided,
  admin_redemption_void,
  admin_redemption_void_failed,
  admin_redemption_void_success,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';

interface RedemptionCodeRow {
  id: string;
  code: string;
  status: string;
  revision: number;
  grants: Record<string, number>;
  expiresAt: string | null;
  batchId?: string;
  grantTransactionId?: string;
  redeemedWorkspaceId?: string;
}

type GrantResource = 'copy' | 'image' | 'video' | 'audio';

const RESOURCE_LABELS: Record<GrantResource, () => string> = {
  copy: admin_redemption_resource_copy,
  image: admin_redemption_resource_image,
  video: admin_redemption_resource_video,
  audio: admin_redemption_resource_audio,
};

const STATUS_LABELS: Record<string, () => string> = {
  active: admin_redemption_status_active,
  redeemed: admin_redemption_status_redeemed,
  voided: admin_redemption_status_voided,
  expired: admin_redemption_status_expired,
};

export function canRecordRedemptionCode(input: {
  amounts: Record<GrantResource, string>;
  code: string;
  expiresAt: string;
}) {
  const amountValues = Object.values(input.amounts).map(Number);
  const normalizedCode = input.code.trim().toUpperCase();
  return (
    amountValues.every((amount) => Number.isInteger(amount) && amount >= 0) &&
    amountValues.some((amount) => amount > 0) &&
    /^[A-Z0-9_-]{4,64}$/.test(normalizedCode) &&
    (!input.expiresAt || Number.isFinite(Date.parse(input.expiresAt)))
  );
}

export function AdminRedemptionControl() {
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState<Record<GrantResource, string>>({
    copy: '20',
    image: '0',
    video: '0',
    audio: '0',
  });
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const listQuery = useQuery({
    queryKey: ['admin', 'redemptions', 'list'],
    queryFn: () =>
      queryP1<RedemptionCodeRow[]>('redemptions', {
        action: 'list',
        payload: {},
      }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const grants = Object.fromEntries(
        Object.entries(amounts)
          .map(([resource, amount]) => [resource, Number(amount)] as const)
          .filter(([, amount]) => Number.isInteger(amount) && amount > 0)
      );
      return commandP1<RedemptionCodeRow[]>(
        'redemptions',
        {
          action: 'create',
          payload: {
            grants,
            code: code.trim(),
            ...(expiresAt
              ? { expiresAt: new Date(expiresAt).toISOString() }
              : {}),
          },
        },
        `redeem-create-${crypto.randomUUID()}`
      );
    },
    onSuccess: () => {
      toast.success(admin_redemption_create_success());
      setCode('');
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'redemptions', 'list'],
      });
    },
    onError: () => {
      toast.error(admin_redemption_create_failed());
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (row: RedemptionCodeRow) =>
      commandP1(
        'redemptions',
        {
          action: 'void',
          payload: {
            code: row.code,
            expectedRevision: row.revision,
          },
        },
        `redeem-void-${row.id}-${row.revision}`
      ),
    onSuccess: () => {
      toast.success(admin_redemption_void_success());
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'redemptions', 'list'],
      });
    },
    onError: () => {
      toast.error(admin_redemption_void_failed());
    },
  });

  const rows = listQuery.data ?? [];
  const canCreate = canRecordRedemptionCode({
    amounts,
    code,
    expiresAt,
  });

  return (
    <div className="flex flex-col gap-6">
      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_redemption_create_title()}</AdminPanelTitle>
          <AdminPanelDescription>
            {admin_redemption_create_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(RESOURCE_LABELS) as GrantResource[]).map((resource) => (
            <div className="grid gap-2" key={resource}>
              <Label htmlFor={`redeem-${resource}`}>
                {RESOURCE_LABELS[resource]()}
              </Label>
              <Input
                id={`redeem-${resource}`}
                inputMode="numeric"
                min={0}
                step={1}
                type="number"
                value={amounts[resource]}
                onChange={(event) =>
                  setAmounts((current) => ({
                    ...current,
                    [resource]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="redeem-code">{admin_redemption_code()}</Label>
            <Input
              id="redeem-code"
              maxLength={64}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={admin_redemption_code_placeholder()}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="redeem-expires">
              {admin_redemption_expires_at()}
            </Label>
            <Input
              id="redeem-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <Button
            className="self-end"
            type="button"
            disabled={createMutation.isPending || !canCreate}
            onClick={() => createMutation.mutate()}
          >
            {admin_redemption_create()}
          </Button>
        </AdminPanelContent>
      </AdminPanel>

      <AdminPanel>
        <AdminPanelHeader>
          <AdminPanelTitle>{admin_redemption_codes_title()}</AdminPanelTitle>
          <AdminPanelDescription>
            {listQuery.isError
              ? admin_redemption_load_failed()
              : admin_redemption_codes_count({ count: rows.length })}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3">{admin_redemption_code()}</th>
                <th className="py-2 pr-3">{admin_redemption_status()}</th>
                <th className="py-2 pr-3">{admin_redemption_grants()}</th>
                <th className="py-2 pr-3">{admin_redemption_expires_at()}</th>
                <th className="py-2 pr-3">
                  {admin_redemption_grant_transaction()}
                </th>
                <th className="py-2 pr-3">{admin_redemption_actions()}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-mono">{row.code}</td>
                  <td className="py-2 pr-3">
                    {STATUS_LABELS[row.status]?.() ?? row.status}
                  </td>
                  <td className="py-2 pr-3">
                    {Object.entries(row.grants)
                      .map(
                        ([resource, amount]) =>
                          `${RESOURCE_LABELS[resource as GrantResource]?.() ?? resource}: ${amount}`
                      )
                      .join(' ')}
                  </td>
                  <td className="py-2 pr-3">
                    {row.expiresAt
                      ? new Date(row.expiresAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {row.grantTransactionId ?? '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {row.status === 'active' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={voidMutation.isPending}
                        onClick={() => voidMutation.mutate(row)}
                      >
                        {admin_redemption_void()}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !listQuery.isLoading ? (
                <tr>
                  <td className="py-4 text-muted-foreground" colSpan={6}>
                    {admin_redemption_empty()}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}
