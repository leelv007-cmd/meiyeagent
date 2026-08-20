import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { requiredP1Capability } from './capability-permission.js';
import {
  P1_OPERATIONS,
  P1_REGISTRY_OWNED_MODULES,
  UnregisteredP1OperationError,
  createP1OperationRequest,
  isP1OperationKey,
  isP1RegistryOwnedModule,
  lookupRegisteredP1Capability,
  p1HttpPath,
  resolveP1ModuleOperation,
  resolveP1Operation,
  type P1OperationKey,
} from './p1-operation-registry.js';

type IsRegisteredKey<K extends string> = K extends P1OperationKey
  ? true
  : false;

test('ARCH-01 unknown action is not a registered operation key at compile time', () => {
  const unknownRegistered: IsRegisteredKey<'memory.not_registered'> = false;
  const knownRegistered: IsRegisteredKey<'memory.entries_page'> = true;
  assert.equal(unknownRegistered, false);
  assert.equal(knownRegistered, true);
});

test('ARCH-01 unknown action fails closed at runtime', () => {
  assert.equal(isP1OperationKey('memory.not_registered'), false);
  assert.throws(
    () => resolveP1Operation('memory.not_registered'),
    (error: unknown) =>
      error instanceof UnregisteredP1OperationError &&
      error.operation === 'memory.not_registered' &&
      error.message.includes('not registered'),
  );
  assert.throws(
    () => resolveP1ModuleOperation('memory', 'not_registered', 'query'),
    (error: unknown) => error instanceof UnregisteredP1OperationError,
  );
  assert.throws(
    () => resolveP1ModuleOperation('memory', 'entries_page', 'command'),
    (error: unknown) => error instanceof UnregisteredP1OperationError,
  );
});

test('ARCH-01 authorization is declared once on the registry', () => {
  for (const key of Object.keys(P1_OPERATIONS) as P1OperationKey[]) {
    const operation = P1_OPERATIONS[key];
    assert.equal(operation.handler, key);
    if (operation.module === 'composer') {
      assert.equal(
        lookupRegisteredP1Capability(
          operation.kind,
          'operations',
          operation.action,
        ).found,
        false,
      );
      continue;
    }
    if (!isP1RegistryOwnedModule(operation.module)) continue;
    assert.deepEqual(
      lookupRegisteredP1Capability(
        operation.kind,
        operation.module,
        operation.action,
      ),
      { found: true, capability: operation.auth },
    );
    assert.equal(
      requiredP1Capability(
        operation.kind,
        operation.module,
        operation.action,
      ),
      operation.auth,
    );
  }
});

test('ARCH-01 owned-module authorization is not redeclared beside the registry', () => {
  const path = new URL('./capability-permission.ts', import.meta.url);
  const sourceFile = ts.createSourceFile(
    path.pathname,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  const moduleEquals: string[] = [];
  const calls = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.add(node.expression.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'module' &&
      ts.isStringLiteralLike(node.right)
    ) {
      moduleEquals.push(node.right.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const banned of [
    'memoryQueryActions',
    'memoryCreateActions',
    'assetMemoryCreateActions',
    'assetMemoryQueryActions',
  ]) {
    assert.equal(names.has(banned), false, banned);
  }
  for (const module of [
    'memory',
    'asset-memory',
    'context',
    'result-delivery',
    'entitlements',
    'product-billing',
    'redemptions',
  ]) {
    assert.equal(
      moduleEquals.includes(module),
      false,
      `capability-permission must not branch on module === '${module}'`,
    );
  }
  assert.equal(calls.has('lookupRegisteredP1Capability'), true);
});

test('ARCH-01 unknown owned-module actions fail closed through requiredP1Capability', () => {
  for (const module of P1_REGISTRY_OWNED_MODULES) {
    assert.equal(
      requiredP1Capability('query', module, 'not_registered'),
      null,
    );
    assert.equal(
      requiredP1Capability('command', module, 'not_registered'),
      null,
    );
  }
});

test('canonical handoff consume accepts the one-shot token payload', () => {
  const operation = resolveP1ModuleOperation(
    'result-delivery',
    'assisted_consume_handoff',
    'command',
  );
  const parsed = operation.input.parse({
    now: '2026-08-08T12:01:00.000Z',
    token: 'canonical-handoff-token-0001',
  });
  assert.equal(parsed.token, 'canonical-handoff-token-0001');
  assert.equal(
    operation.input.safeParse({ receiptId: 'receipt-1' }).success,
    false,
  );
});

test('ARCH-01 module operations keep the existing P1 HTTP URLs', () => {
  for (const operation of Object.values(P1_OPERATIONS)) {
    if (operation.module === 'composer') {
      assert.match(operation.http.path, /^\/api\/core\/p1\/composer\//u);
      continue;
    }
    assert.equal(
      operation.http.path,
      operation.kind === 'query'
        ? '/api/core/p1/query'
        : '/api/core/p1/commands',
    );
  }
  assert.equal(
    p1HttpPath('composer.submit'),
    '/api/core/p1/composer/submissions',
  );
  assert.equal(
    p1HttpPath('composer.map_destination'),
    '/api/core/p1/composer/destination-map',
  );
  assert.equal(
    p1HttpPath('composer.start_task', { taskId: 'task 1' }),
    '/api/core/p1/composer/tasks/task%201/start',
  );
});

test('ARCH-01 contract request builder wraps module payload and keeps composer bodies', () => {
  const query = createP1OperationRequest('memory.entries_page', { limit: 20 });
  assert.deepEqual(query, {
    url: '/api/core/p1/query',
    method: 'POST',
    body: {
      module: 'memory',
      action: 'entries_page',
      payload: { limit: 20 },
    },
    headers: { 'content-type': 'application/json' },
  });

  const command = createP1OperationRequest(
    'memory.revoke_memory',
    { expectedRevision: 1, memoryId: 'mem-1' },
    { idempotencyKey: 'memory:revoke:mem-1' },
  );
  assert.equal(command.url, '/api/core/p1/commands');
  assert.equal(command.headers['idempotency-key'], 'memory:revoke:mem-1');

  const submit = createP1OperationRequest(
    'composer.submit',
    { idempotencyKey: 'composer:1' },
    { idempotencyKey: 'composer:1' },
  );
  assert.equal(submit.url, '/api/core/p1/composer/submissions');
  assert.deepEqual(submit.body, { idempotencyKey: 'composer:1' });
});
