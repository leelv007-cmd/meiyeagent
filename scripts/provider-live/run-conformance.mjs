import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

export async function runConformance({
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const endpoint = required(environment, 'PROVIDER_LIVE_CONFORMANCE_ENDPOINT');
  const token = required(environment, 'PROVIDER_LIVE_CONFORMANCE_TOKEN');
  const runNonce = required(environment, 'PROVIDER_LIVE_RUN_NONCE');
  const outputPath = required(
    environment,
    'PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH',
  );
  const url = new URL(endpoint);

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(
      'PROVIDER_LIVE_CONFORMANCE_ENDPOINT must use HTTPS without URL credentials.',
    );
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      runNonce,
      costCapUsd: Number(
        required(environment, 'PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD'),
      ),
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(45 * 60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Provider conformance service returned HTTP ${response.status}.`,
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Provider conformance service did not return JSON.');
  }

  const evidence = JSON.parse(
    await readResponseBody(response, MAX_EVIDENCE_BYTES),
  );
  assertRunNonce(evidence, runNonce);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(evidence)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, outputPath);
}

async function readResponseBody(response, maxBytes) {
  if (!response.body) throw new Error('Provider conformance response is empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Provider conformance evidence exceeds 2 MiB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertRunNonce(evidence, expected) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Provider conformance evidence must be an object.');
  }
  const entries = [
    evidence.costEvidence,
    ...(Array.isArray(evidence.lifecycleEvidence)
      ? evidence.lifecycleEvidence
      : []),
    ...(Array.isArray(evidence.transportFaultEvidence)
      ? evidence.transportFaultEvidence
      : []),
    ...(Array.isArray(evidence.secondaryProbes)
      ? evidence.secondaryProbes.map((probe) => probe?.operationEvidence)
      : []),
  ];
  if (
    entries.length === 0 ||
    entries.some((entry) => entry?.runNonce !== expected)
  ) {
    throw new Error('Provider conformance evidence run nonce mismatch.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runConformance();
}
