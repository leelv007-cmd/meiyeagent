import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  admin_provider_credential_activation_note,
  admin_provider_credential_douyin_recorded,
  admin_provider_credential_empty,
  admin_provider_credential_restart_effective,
  admin_provider_credential_revoke,
  admin_provider_credential_rotate,
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
import { p1QueryKeys } from './query-keys';

type ProviderSlot = 'model.direct' | 'ark.media' | 'douyin.platform';

interface ProviderCredential {
  effectiveSource: 'vault' | 'env_fallback' | 'env';
  id: string;
  status: string;
  credential: {
    mask: string;
    version: number;
    status: string;
    scope: string[];
    testedAt?: string;
    testStatus?:
      | 'passed'
      | 'unauthorized'
      | 'network_failed'
      | 'unknown'
      | 'not_wired';
    testErrorCode?: string;
  };
  updatedAt: string;
}

const slots: readonly ProviderSlot[] = [
  'model.direct',
  'ark.media',
  'douyin.platform',
];

export function AdminProviderCredentialControl() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Partial<Record<ProviderSlot, string>>>(
    {}
  );
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
    await commandP1('integrations', {
      action: existing
        ? 'admin_rotate_provider_credential'
        : 'admin_store_provider_credential',
      payload: { slot, credential: { scope: ['provider.connect'], value } },
    });
    setValues((current) => ({ ...current, [slot]: '' }));
    await refresh();
    toast.success(admin_provider_credential_saved());
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
    <Card>
      <CardHeader>
        <CardTitle>{admin_provider_credentials_title()}</CardTitle>
        <CardDescription>
          {admin_provider_credentials_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-3">
        {slots.map((slot) => {
          const credential = query.data?.find(
            (item) => item.id === `platform:${slot}`
          );
          return (
            <div className="space-y-3 rounded-lg border p-4" key={slot}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{slot}</span>
                <Badge variant="outline">
                  {credential?.credential.status ??
                    admin_provider_credential_empty()}
                </Badge>
              </div>
              <p className="font-mono text-sm">
                {credential
                  ? `${credential.credential.mask} · v${credential.credential.version}`
                  : '—'}
              </p>
              {credential?.effectiveSource ? (
                <Badge
                  variant={
                    credential.effectiveSource === 'env_fallback'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {providerCredentialSource(credential.effectiveSource)}
                </Badge>
              ) : null}
              {credential ? (
                <p className="text-xs text-muted-foreground">
                  {admin_provider_credential_scope({
                    scope: credential.credential.scope.join(', ') || '—',
                  })}
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
                <Button
                  onClick={() => void save(slot, Boolean(credential))}
                  size="sm"
                >
                  {credential
                    ? admin_provider_credential_rotate()
                    : admin_provider_credential_store()}
                </Button>
                {credential ? (
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
              <p className="text-xs text-muted-foreground">
                {providerTestStatus(credential?.credential.testStatus)}
              </p>
              {credential?.credential.testedAt ? (
                <p className="text-xs text-muted-foreground">
                  {admin_provider_credential_tested_at({
                    testedAt: new Date(
                      credential.credential.testedAt
                    ).toLocaleString(),
                  })}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {admin_provider_credential_activation_note()}
              </p>
              <p className="text-xs text-muted-foreground">
                {admin_provider_credential_restart_effective()}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function providerTestStatus(
  status: ProviderCredential['credential']['testStatus']
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
    case 'not_wired':
      return admin_provider_credential_douyin_recorded();
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
