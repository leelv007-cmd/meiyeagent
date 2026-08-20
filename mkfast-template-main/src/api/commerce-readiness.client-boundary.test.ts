import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('commerce readiness exposes a client-safe server-function stub', async () => {
  const [clientStub, paymentStubs, databasePort] = await Promise.all([
    readFile(new URL('./commerce-readiness.ts', import.meta.url), 'utf8'),
    readFile(new URL('./payment.ts', import.meta.url), 'utf8'),
    readFile(new URL('../db/index.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(
    clientStub,
    /from ['"]@\/(?:config\/website|env\/server|payment)(?:['"/])/u
  );
  assert.doesNotMatch(clientStub, /from ['"]@\/db(?:['"/])/u);
  assert.match(
    clientStub,
    /createServerOnlyFn\([\s\S]*?import\(['"]\.\/commerce-readiness\.server['"]\)/u
  );
  assert.match(clientStub, /createServerFn\(\{ method: 'POST' \}\)/u);
  assert.doesNotMatch(clientStub, /createServerFn\(\{ method: 'GET' \}\)/u);

  assert.doesNotMatch(paymentStubs, /from ['"]@\/db['"]/u);
  assert.doesNotMatch(paymentStubs, /from ['"]@\/payment['"]/u);
  assert.match(paymentStubs, /createServerOnlyFn/u);
  assert.match(paymentStubs, /import\(['"]@\/db['"]\)/u);
  assert.match(paymentStubs, /import\(['"]@\/payment['"]\)/u);

  assert.match(databasePort, /createServerOnlyFn/u);
  assert.match(databasePort, /export const getDb = createServerOnlyFn/u);
});
