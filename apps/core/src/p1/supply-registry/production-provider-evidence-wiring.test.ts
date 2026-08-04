import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('production provider evidence assembly', () => {
  it('wires HTTP AdminSupply to request-time provider probes and operational refresh', async () => {
    const source = await readFile(
      new URL('../../assembly/core-assembly.ts', import.meta.url),
      'utf8'
    );

    assert.match(
      source,
      /new ProductionAdminProviderEvidence\(\{[\s\S]*?credentials: providerCredentialSecretBroker,[\s\S]*?connectivity: providerConnectivity,[\s\S]*?conformance: modelControlPlane,[\s\S]*?health: supplyPlanningControlPlane\.health,[\s\S]*?verification: providerCredentialOperator,[\s\S]*?credentialWorkspaceId: '__global__',/,
    );
    assert.match(
      source,
      /createPostgresAdminSupplyControlPlane\(\{[\s\S]*?providerProbes: adminProviderEvidence,[\s\S]*?operationalEvidence: adminProviderEvidence,/,
    );
  });

  it('wires the worker integration consumer to the real provider connectivity adapter', async () => {
    const source = await readFile(
      new URL('../../assembly/core-assembly.ts', import.meta.url),
      'utf8',
    );

    assert.match(
      source,
      /const providerConnectivity = providerConnectivityProbeFromEnv\(\s*providerCredentialRuntime\.env,?\s*\)/,
    );
    assert.match(
      source,
      /new IntegrationApplicationService\(\{[\s\S]*?providerConnectivity,/,
    );
  });
});
