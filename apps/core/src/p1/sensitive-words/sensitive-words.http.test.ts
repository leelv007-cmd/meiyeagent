import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { SENSITIVE_SCAN_LIMITS } from '@meiye/contracts';

import { createCoreServer } from '../../server.js';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  MemorySensitiveWordsRepository,
  SensitiveWordsFoundationModule,
} from './index.js';

test('P1 HTTP scan returns complete at 50,000 and INVALID_STATE at 50,001', async (t) => {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-sensitive', 'owner-sensitive');
  const application = new P1ApplicationService(foundation, {
    operations: [
      new SensitiveWordsFoundationModule(
        new MemorySensitiveWordsRepository()
      ),
    ],
  });
  const server = createCoreServer({
    p1ApplicationService: application,
    serviceToken: 'sensitive-http-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-sensitive/p1/query`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-sensitive-http',
    'x-service-token': 'sensitive-http-token',
    'x-user-id': 'owner-sensitive',
    'x-workspace-id': 'workspace-sensitive',
    'x-workspace-role': 'owner',
  };
  const query = (text: string) =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        module: 'sensitive-words',
        action: 'scan',
        payload: { text },
      }),
    });

  const boundary = await query(
    '清'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength)
  );
  assert.equal(boundary.status, 200);
  const boundaryPayload = (await boundary.json()) as {
    data: { complete: boolean; textLength: number };
  };
  assert.equal(boundaryPayload.data.complete, true);
  assert.equal(
    boundaryPayload.data.textLength,
    SENSITIVE_SCAN_LIMITS.maxTextLength
  );

  const overLimit = await query(
    '清'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength + 1)
  );
  assert.equal(overLimit.status, 409);
  const errorPayload = (await overLimit.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(errorPayload.error.code, 'INVALID_STATE');
  assert.match(errorPayload.error.message, /maxTextLength/u);
  assert.doesNotMatch(errorPayload.error.message, /Zod/u);
});
