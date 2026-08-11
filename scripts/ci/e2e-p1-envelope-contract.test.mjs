import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const e2eRoot = join(repositoryRoot, 'mkfast-template-main/tests/e2e');

function skipQuotedOrComment(source, index) {
  const delimiter = source[index];
  if (delimiter === '/' && source[index + 1] === '/') {
    const newline = source.indexOf('\n', index + 2);
    return newline === -1 ? source.length : newline + 1;
  }
  if (delimiter === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (!['\'', '"', '`'].includes(delimiter)) {
    return index;
  }

  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === delimiter) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
}

function fulfillCalls(source) {
  const calls = [];
  const marker = 'route.fulfill(';
  let start = source.indexOf(marker);
  while (start !== -1) {
    let cursor = start + marker.length;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const skipped = skipQuotedOrComment(source, cursor);
      if (skipped !== cursor) {
        cursor = skipped;
        continue;
      }
      if (source[cursor] === '(') depth += 1;
      if (source[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth === 0) {
      calls.push({ source: source.slice(start, cursor), start });
    }
    start = source.indexOf(marker, start + marker.length);
  }
  return calls;
}

export function envelopeViolations(source) {
  return fulfillCalls(source).filter(({ source: call }) => {
    const hasJsonObject = /\bjson\s*:\s*\{/u.test(call);
    const hasJsonString = /\bbody\s*:\s*JSON\.stringify\s*\(\s*\{/u.test(
      call
    );
    const hasDataOrError = /\bdata\s*:/u.test(call) ||
      /\berror\s*:\s*\{/u.test(call);
    const hasMeta = /\bmeta\s*:/u.test(call);
    const forwardsExistingEnvelope = /\.\.\.envelope\b/u.test(call);
    const isServerSentEvent =
      /\bcontentType\s*:\s*['"]text\/event-stream['"]/u.test(call) &&
      /\bbody\s*:/u.test(call);

    return (hasJsonObject || hasJsonString) &&
      hasDataOrError &&
      !hasMeta &&
      !forwardsExistingEnvelope &&
      !isServerSentEvent;
  });
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    })
  );
  return files.flat();
}

test('P1 route fulfill mocks keep the strict API envelope', async () => {
  const files = await sourceFiles(e2eRoot);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const violation of envelopeViolations(source)) {
      const line = source.slice(0, violation.start).split('\n').length;
      violations.push(`${relative(repositoryRoot, file)}:${line}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    'route.fulfill JSON envelopes with data or error require meta.correlationId.\n' +
      'SSE body fulfills with contentType: text/event-stream are intentionally exempt.\n' +
      `Offenders:\n${violations.map((entry) => `  - ${entry}`).join('\n')}`
  );
});

test('the envelope gate rejects missing meta and permits valid JSON and SSE fixtures', () => {
  const missingMeta = `await route.fulfill({ json: { data: { id: 'missing-meta' } } });`;
  const validEnvelope = `await route.fulfill({
    json: { data: { id: 'valid-envelope' }, meta: { correlationId: 'e2e-valid' } },
  });`;
  const serverSentEvent = `await route.fulfill({
    contentType: 'text/event-stream',
    body: 'data: {"data": {"id": "sse"}}\\n\\n',
  });`;

  assert.equal(envelopeViolations(missingMeta).length, 1);
  assert.deepEqual(envelopeViolations(validEnvelope), []);
  assert.deepEqual(envelopeViolations(serverSentEvent), []);
});
