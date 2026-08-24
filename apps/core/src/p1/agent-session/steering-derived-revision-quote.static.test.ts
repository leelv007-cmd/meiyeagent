/**
 * V31-45: derived_revision has one production path — the quoted workflow.
 * Reintroducing a quote-bypass write (authority shortcut / silent complete)
 * must fail here, not as a silent merchant-facing "accepted".
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import {
  hasCall,
  identifiers,
  parseProductionSource,
  typeMembers,
  type ParsedSource,
} from '../testing/ast-boundary.js';

const root = resolve(process.cwd(), '../..');

function walk(node: ts.Node, visit: (current: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function methodNode(parsed: ParsedSource, name: string): ts.Node | undefined {
  let match: ts.Node | undefined;
  walk(parsed.sourceFile, (node) => {
    if (match) return;
    if (ts.isMethodDeclaration(node) && node.name.getText() === name) {
      match = node;
    }
  });
  return match;
}

function methodIdentifiers(parsed: ParsedSource, name: string): Set<string> {
  const method = methodNode(parsed, name);
  const names = new Set<string>();
  if (!method) return names;
  walk(method, (node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
  });
  return names;
}

function methodCalls(parsed: ParsedSource, name: string): string[] {
  const method = methodNode(parsed, name);
  const names: string[] = [];
  if (!method) return names;
  walk(method, (node) => {
    if (ts.isCallExpression(node)) names.push(node.expression.getText());
  });
  return names;
}

function methodLiterals(parsed: ParsedSource, name: string): string[] {
  const method = methodNode(parsed, name);
  const values: string[] = [];
  if (!method) return values;
  walk(method, (node) => {
    if (ts.isStringLiteralLike(node)) values.push(node.text);
  });
  return values;
}

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

test('consumeDerivedRevision only launches the quoted derived workflow', () => {
  const parsed = parseProductionSource(
    resolve(root, 'apps/core/src/p1/agent-session/steering-service.ts'),
  );
  const method = methodNode(parsed, 'consumeDerivedRevision');
  assert.ok(method, 'consumeDerivedRevision must exist');

  const ids = methodIdentifiers(parsed, 'consumeDerivedRevision');
  const calls = methodCalls(parsed, 'consumeDerivedRevision');
  assert.equal(ids.has('derivedWorkflow'), true);
  assert.equal(ids.has('launchDerivedRevision'), true);
  assert.ok(
    calls.some((callee) => callee.endsWith('launchDerivedRevision')),
    'consumeDerivedRevision must call launchDerivedRevision',
  );
  assert.equal(ids.has('derivedRevision'), false);
  assert.equal(ids.has('derivedRevisionAuthority'), false);
  assert.equal(
    methodLiterals(parsed, 'consumeDerivedRevision').includes('completed'),
    false,
    'must not silently return completed without the quoted launch',
  );
  assert.equal(hasCall(parsed, 'launchDerivedRevision'), true);
});

test('SteeringActionConsumers exposes only the quoted workflow consumer', () => {
  const parsed = parseProductionSource(
    resolve(root, 'apps/core/src/p1/agent-session/steering-service.ts'),
  );
  assert.deepEqual(typeMembers(parsed, 'SteeringActionConsumers'), [
    'derivedWorkflow',
  ]);
});

test('derivedRevisionAuthority is absent from production TypeScript', () => {
  const files = productionTypescriptFiles(resolve(root, 'apps/core/src'));
  const violations = files.filter((file) => {
    const source = readFileSync(file, 'utf8');
    if (!/\bderivedRevisionAuthority\b/u.test(source)) return false;
    return identifiers(parseProductionSource(file)).has(
      'derivedRevisionAuthority',
    );
  });
  assert.deepEqual(
    violations.map((file) => relative(root, file)),
    [],
  );
});
