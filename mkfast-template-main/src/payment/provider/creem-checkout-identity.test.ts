import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('Creem persists the real checkout object id as payment session identity', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/payment/provider/creem.ts'),
    'utf8'
  );
  const recordWriters = source.match(
    /sessionId: object\.id,[\s\S]{0,500}invoiceId: event\.id/g
  );
  assert.equal(recordWriters?.length, 2);
  assert.doesNotMatch(
    source,
    /sessionId: event\.id,[\s\S]{0,500}invoiceId: event\.id/u
  );
});
