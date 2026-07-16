import { zodResolver } from '@hookform/resolvers/zod';
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  integration_byok_billing_notice,
  integration_byok_controlled_profile,
  integration_byok_description,
  integration_byok_execute,
  integration_byok_execute_attention,
  integration_byok_execute_completed,
  integration_byok_execute_failed,
  integration_byok_option_connection,
  integration_byok_option_model,
  integration_byok_option_profile,
  integration_byok_options_unavailable,
  integration_byok_options_unavailable_title,
  integration_byok_prompt_error,
  integration_byok_prompt_label,
  integration_byok_prompt_placeholder,
  integration_byok_provider_cost_external,
  integration_byok_provider_cost_label,
  integration_byok_provider_cost_unknown,
  integration_byok_published_model,
  integration_byok_recorded_description,
  integration_byok_recorded_title,
  integration_byok_refresh_usage,
  integration_byok_result,
  integration_byok_title,
  integration_byok_usage,
  integration_byok_workspace_credential,
  integration_status_completed,
  integration_status_failed,
  integration_status_unknown,
  integration_usage_committed,
  integration_usage_refunded,
  integration_usage_reserved,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import {
  strictByokExecutionFormSchema,
  type StrictByokExecutionFormInput,
} from '@/p1/entitlement-byok-schemas';
import { p1QueryKeys } from '@/p1/query-keys';
import type { IntegrationConnectionView } from '@/p1/settings-view-model';

interface StrictByokOptions {
  executionMode: 'recorded' | 'live';
  profiles: Array<{
    id: string;
    apiFamily: string;
    permittedModels: string[];
  }>;
  usage: {
    allowance: number;
    available: number;
    committed: number;
    reserved: number;
  };
  billingNotice: string;
}

interface StrictByokResult {
  status: 'completed' | 'failed' | 'unknown';
  output?: string;
  usage: { status: 'committed' | 'refunded' | 'reserved'; available: number };
  providerCost: { status: 'externally_billed' | 'unknown' };
}

export function StrictByokExecutionPanel({
  connections,
}: {
  connections: IntegrationConnectionView[];
}) {
  const activeConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.provider === 'model' && connection.status !== 'revoked'
      ),
    [connections]
  );
  const queryClient = useQueryClient();
  const form = useForm<StrictByokExecutionFormInput>({
    defaultValues: {
      connectionId: '',
      modelId: '',
      profileId: '',
      prompt: '',
    },
    resolver: zodResolver(strictByokExecutionFormSchema),
  });
  const [result, setResult] = useState<StrictByokResult>();
  const optionsQuery = useQuery({
    enabled: activeConnections.length > 0,
    queryKey: p1QueryKeys.request('integrations', 'strict_byok_options'),
    queryFn: ({ signal }) =>
      queryP1<StrictByokOptions>(
        'integrations',
        { action: 'strict_byok_options', payload: {} },
        signal
      ),
  });
  const executeMutation = useMutation<
    StrictByokResult,
    Error,
    StrictByokExecutionFormInput
  >({
    mutationFn: (values) =>
      commandP1<StrictByokResult>('integrations', {
        action: 'submit_strict_byok',
        payload: {
          connectionId: values.connectionId,
          endpointProfileId: values.profileId,
          catalogModelId: values.modelId,
          prompt: values.prompt,
        },
      }),
    onError: () => toast.error(integration_byok_execute_failed()),
    onSuccess: async (next) => {
      setResult(next);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('integrations'),
      });
      toast[next.status === 'completed' ? 'success' : 'warning'](
        next.status === 'completed'
          ? integration_byok_execute_completed()
          : integration_byok_execute_attention()
      );
    },
  });

  const options = optionsQuery.data;
  const profileId = useWatch({ control: form.control, name: 'profileId' });
  const profile = options?.profiles.find(
    (candidate) => candidate.id === profileId
  );
  const errorCause = optionsQuery.error;
  const error = errorCause ? integration_byok_options_unavailable() : undefined;
  const busy = executeMutation.isPending;
  const { getValues, setValue } = form;

  useEffect(() => {
    const current = getValues('connectionId');
    if (
      activeConnections.length > 0 &&
      !activeConnections.some((connection) => connection.id === current)
    ) {
      setValue('connectionId', activeConnections[0].id);
    }
  }, [activeConnections, getValues, setValue]);

  useEffect(() => {
    if (!options?.profiles.length) return;
    const currentProfile = options.profiles.find(
      (candidate) => candidate.id === getValues('profileId')
    );
    const nextProfile = currentProfile ?? options.profiles[0];
    if (!currentProfile) {
      setValue('profileId', nextProfile.id);
    }
    if (!nextProfile.permittedModels.includes(getValues('modelId'))) {
      setValue('modelId', nextProfile.permittedModels[0] ?? '');
    }
  }, [getValues, options, setValue]);

  if (activeConnections.length === 0) return null;

  const profileRegistration = form.register('profileId');

  return (
    <Card className="overflow-hidden shadow-sm">
      <form
        onSubmit={form.handleSubmit((values) => executeMutation.mutate(values))}
      >
        <CardHeader className="gap-4 border-b px-4 py-5 sm:flex sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-xl space-y-1.5">
            <CardTitle className="text-base">
              {integration_byok_title()}
            </CardTitle>
            <CardDescription className="text-sm leading-6">
              {integration_byok_description()}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:ml-6">
            <Button disabled={busy || optionsQuery.isPending} type="submit">
              <IconPlayerPlay />
              {integration_byok_execute()}
            </Button>
            <Button
              disabled={busy || optionsQuery.isFetching}
              onClick={() => void optionsQuery.refetch()}
              type="button"
              variant="outline"
            >
              <IconRefresh />
              {integration_byok_refresh_usage()}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 px-4 py-5 sm:px-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>
                {integration_byok_options_unavailable_title()}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {options ? (
            <>
              {options.executionMode === 'recorded' ? (
                <Alert>
                  <AlertTitle>{integration_byok_recorded_title()}</AlertTitle>
                  <AlertDescription>
                    {integration_byok_recorded_description()}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Alert>
                <AlertTitle>
                  {integration_byok_usage({
                    allowance: options.usage.allowance,
                    available: options.usage.available,
                  })}
                </AlertTitle>
                <AlertDescription>
                  {integration_byok_billing_notice()}
                </AlertDescription>
              </Alert>
            </>
          ) : null}
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="byok-connection">
                  {integration_byok_workspace_credential()}
                </Label>
                <select
                  aria-invalid={Boolean(form.formState.errors.connectionId)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  id="byok-connection"
                  {...form.register('connectionId')}
                >
                  {activeConnections.map((connection, index) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.subject?.trim() ||
                        integration_byok_option_connection({
                          index: index + 1,
                          version: connection.credential.version,
                        })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="byok-profile">
                  {integration_byok_controlled_profile()}
                </Label>
                <select
                  aria-invalid={Boolean(form.formState.errors.profileId)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  id="byok-profile"
                  {...profileRegistration}
                  onChange={(event) => {
                    void profileRegistration.onChange(event);
                    const next = options?.profiles.find(
                      (candidate) => candidate.id === event.target.value
                    );
                    setValue('modelId', next?.permittedModels[0] ?? '', {
                      shouldValidate: true,
                    });
                  }}
                >
                  {(options?.profiles ?? []).map((candidate, index) => (
                    <option key={candidate.id} value={candidate.id}>
                      {integration_byok_option_profile({ index: index + 1 })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="byok-model">
                  {integration_byok_published_model()}
                </Label>
                <select
                  aria-invalid={Boolean(form.formState.errors.modelId)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  id="byok-model"
                  {...form.register('modelId')}
                >
                  {(profile?.permittedModels ?? []).map((modelId, index) => (
                    <option key={modelId} value={modelId}>
                      {integration_byok_option_model({ index: index + 1 })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="byok-prompt">
                {integration_byok_prompt_label()}
              </Label>
              <Textarea
                aria-invalid={Boolean(form.formState.errors.prompt)}
                id="byok-prompt"
                placeholder={integration_byok_prompt_placeholder()}
                {...form.register('prompt')}
              />
              {form.formState.errors.prompt ? (
                <p className="text-xs text-destructive" role="alert">
                  {integration_byok_prompt_error()}
                </p>
              ) : null}
            </div>
          </div>
          {result ? (
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {integration_byok_result({
                  available: result.usage.available,
                  result: byokResultStatus(result.status),
                  usage: byokUsageStatus(result.usage.status),
                })}
              </p>
              <p className="mt-1 text-muted-foreground">
                {integration_byok_provider_cost_label()}
                {result.providerCost.status === 'externally_billed'
                  ? integration_byok_provider_cost_external()
                  : integration_byok_provider_cost_unknown()}
              </p>
              {result.output ? (
                <p className="mt-3 whitespace-pre-wrap">{result.output}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </form>
    </Card>
  );
}

function byokResultStatus(status: StrictByokResult['status']) {
  if (status === 'completed') return integration_status_completed();
  if (status === 'failed') return integration_status_failed();
  return integration_status_unknown();
}

function byokUsageStatus(status: StrictByokResult['usage']['status']) {
  if (status === 'committed') return integration_usage_committed();
  if (status === 'refunded') return integration_usage_refunded();
  return integration_usage_reserved();
}
