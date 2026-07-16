export type ProviderCredentialSlot =
  | 'model.direct'
  | 'ark.media'
  | 'douyin.platform';

export type ProviderConnectivityStatus =
  | 'passed'
  | 'unauthorized'
  | 'network_failed'
  | 'unknown'
  | 'not_wired';

export interface ProviderConnectivityProbePort {
  probe(input: {
    slot: ProviderCredentialSlot;
    credential: string;
  }): Promise<{
    status: ProviderConnectivityStatus;
    errorCode?: string;
  }>;
}

type ProviderFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class HttpProviderConnectivityProbe
  implements ProviderConnectivityProbePort
{
  constructor(
    private readonly endpoints: Partial<
      Record<Exclude<ProviderCredentialSlot, 'douyin.platform'>, string>
    >,
    private readonly request: ProviderFetch = fetch,
  ) {}

  async probe(input: {
    slot: ProviderCredentialSlot;
    credential: string;
  }): Promise<{
    status: ProviderConnectivityStatus;
    errorCode?: string;
  }> {
    if (input.slot === 'douyin.platform') {
      return { errorCode: 'recorded_adapter', status: 'not_wired' };
    }
    const endpoint = this.endpoints[input.slot]?.trim();
    if (!endpoint) {
      return { errorCode: 'endpoint_not_configured', status: 'unknown' };
    }
    try {
      const response = await this.request(
        `${endpoint.replace(/\/+$/, '')}/models`,
        {
          headers: { authorization: `Bearer ${input.credential}` },
          method: 'GET',
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.ok) return { status: 'passed' };
      const errorCode = `http_${response.status}`;
      if (response.status === 401 || response.status === 403) {
        return { errorCode, status: 'unauthorized' };
      }
      return { errorCode, status: 'unknown' };
    } catch {
      return { errorCode: 'network_error', status: 'network_failed' };
    }
  }
}

export function providerConnectivityProbeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  request: ProviderFetch = fetch,
) {
  return new HttpProviderConnectivityProbe(
    {
      'ark.media': env.ARK_MEDIA_BASE_URL,
      'model.direct': env.MODEL_DIRECT_BASE_URL,
    },
    request,
  );
}
