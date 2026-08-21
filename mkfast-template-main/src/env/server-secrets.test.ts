import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  allowsDevSecretDefaults,
  isStrictSecretEnv,
  isWeakSecretValue,
} from '@meiye/contracts';

test('allowsDevSecretDefaults is true outside production/staging', () => {
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'e2e' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'development' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({}), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'production' }), false);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'staging' }), false);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'production' }), false);
});

test('isStrictSecretEnv only for production/staging (or bare NODE_ENV=production)', () => {
  assert.equal(isStrictSecretEnv({ APP_ENV: 'production' }), true);
  assert.equal(isStrictSecretEnv({ APP_ENV: 'staging' }), true);
  assert.equal(isStrictSecretEnv({ NODE_ENV: 'production' }), true);
  assert.equal(
    isStrictSecretEnv({ APP_ENV: 'e2e', NODE_ENV: 'production' }),
    false
  );
  assert.equal(isStrictSecretEnv({}), false);
});

test('the shell gate rejects the full shared weak-secret set (drift pin)', () => {
  // Until 2026-08-12 the shell carried a hand-copied 6-item subset that was
  // missing exactly these values, and CORE_SERVICE_TOKEN was gated on the
  // short list. The shell now consumes the shared @meiye/contracts authority;
  // this pins the six formerly-missing rejections so the drift cannot return.
  for (const value of [
    'dev-token',
    'password',
    'secret',
    'test-service-token',
    'test-token',
    'token',
  ]) {
    assert.equal(isWeakSecretValue(value), true, value);
  }
  assert.equal(isWeakSecretValue('prod-rotation-token'), false);
});

/**
 * A declared-but-unread env key is the cheapest kind of 假绿: `.env.example`
 * and the zod schema both say the key matters, provisioning dutifully asks an
 * operator to fill it, and nothing on the other end ever looks. `FAL_KEY`
 * outlived the retired AI-playground routes that way. Two keys legitimately
 * have no textual reader — their *declaration* is the enforcement — so they
 * are named here rather than left to look like the same mistake.
 */
const ENFORCEMENT_ONLY_KEYS = new Map([
  [
    'BETTER_AUTH_SECRET',
    'Better Auth reads process.env itself; the schema only rejects weak values in production/staging.',
  ],
  [
    'INTERNAL_SERVICE_TRANSPORT',
    'docs/production-network-boundary-runbook.md — required by the schema in strict envs so a production boot without it fails fast.',
  ],
]);

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const rootRepo = join(repo, '..');

type SourceUnit = {
  path: string;
  sourceFile: ts.SourceFile;
};

/**
 * Ships-to-users source only. Tests are excluded on purpose: a key whose only
 * reader is a test fixture is exactly the shape this assertion exists to catch.
 * Generated locale files and the guarded E2E-only API are not production
 * consumers either.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        path === join(repo, 'src/locale/paraglide') ||
        path === join(repo, 'src/routes/api/e2e')
      ) {
        return [];
      }
      return sourceFiles(path);
    }
    if (/\.(fixture|test|spec)\.(ts|tsx|mjs)$/.test(entry.name)) return [];
    return /\.(ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

function parseSourceUnits(
  sources: Array<{ path: string; source: string }>
): SourceUnit[] {
  return sources.map(({ path, source }) => ({
    path,
    sourceFile: ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    ),
  }));
}

function productionSourceUnits(): SourceUnit[] {
  return parseSourceUnits(
    sourceFiles(join(repo, 'src'))
      .filter((path) => path !== join(here, 'server.ts'))
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  );
}

function accessedKey(node: ts.Node): {
  object: ts.Expression;
  key: string;
} | null {
  if (ts.isPropertyAccessExpression(node)) {
    return { object: node.expression, key: node.name.text };
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return { object: node.expression, key: node.argumentExpression.text };
  }
  return null;
}

function isProcessEnv(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  );
}

function isRootEnvironment(node: ts.Expression): boolean {
  return (
    (ts.isIdentifier(node) && node.text === 'serverEnv') || isProcessEnv(node)
  );
}

/**
 * A direct `serverEnv.KEY` / `process.env.KEY` access is a reader. A helper
 * parameter access counts only when that exact helper is called with one of
 * those root environment objects. This keeps injectable pure helpers valid
 * without letting an unwired `environment.KEY` function manufacture a reader.
 */
function envKeyReaders(units: SourceUnit[]): Set<string> {
  const readers = new Set<string>();
  const parameterReads = new Map<string, Map<number, Set<string>>>();
  const rootedCalls = new Map<string, Set<number>>();

  for (const { sourceFile } of units) {
    const visit = (node: ts.Node) => {
      const access = accessedKey(node);
      if (access && isRootEnvironment(access.object)) {
        readers.add(access.key);
      }

      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.body &&
        node.parameters.length > 0
      ) {
        const byParameter = new Map<number, Set<string>>();
        node.parameters.forEach((parameter, index) => {
          if (!ts.isIdentifier(parameter.name)) return;
          const parameterName = parameter.name.text;
          const keys = new Set<string>();
          const findParameterReads = (child: ts.Node) => {
            const childAccess = accessedKey(child);
            if (
              childAccess &&
              ts.isIdentifier(childAccess.object) &&
              childAccess.object.text === parameterName
            ) {
              keys.add(childAccess.key);
            }
            ts.forEachChild(child, findParameterReads);
          };
          findParameterReads(node.body!);
          if (keys.size > 0) byParameter.set(index, keys);
        });
        if (byParameter.size > 0) {
          parameterReads.set(node.name.text, byParameter);
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.arguments.length > 0
      ) {
        const functionName = node.expression.text;
        node.arguments.forEach((argument, index) => {
          if (!isRootEnvironment(argument)) return;
          const indexes = rootedCalls.get(functionName) ?? new Set<number>();
          indexes.add(index);
          rootedCalls.set(functionName, indexes);
        });
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const [functionName, indexes] of rootedCalls) {
    const byParameter = parameterReads.get(functionName);
    if (!byParameter) continue;
    for (const index of indexes) {
      for (const key of byParameter.get(index) ?? []) readers.add(key);
    }
  }

  return readers;
}

function declaredKeys(path: string): string[] {
  return [
    ...readFileSync(path, 'utf8').matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm),
  ].map(([, name]) => name);
}

function exampleKeys(path: string): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(
    ([, name]) => name
  );
}

test('env reader inventory ignores prose and requires a rooted property access', () => {
  const readers = envKeyReaders(
    parseSourceUnits([
      {
        path: 'direct.ts',
        source: `
          // serverEnv.COMMENT_ONLY
          const prose = 'process.env.STRING_ONLY';
          const direct = serverEnv.DIRECT_KEY;
          const bracket = process.env['BRACKET_KEY'];
          function consume(environment: Record<string, string | undefined>) {
            return environment.INDIRECT_KEY;
          }
          consume(process.env);
          function unwired(environment: Record<string, string | undefined>) {
            return environment.UNWIRED_KEY;
          }
        `,
      },
    ])
  );

  assert.deepEqual([...readers].sort(), [
    'BRACKET_KEY',
    'DIRECT_KEY',
    'INDIRECT_KEY',
  ]);
});

test('every declared server env key has a reader, or is named as enforcement-only', () => {
  const declared = declaredKeys(join(here, 'server.ts'));
  // Floor lowered after Pro Studio / Canvas product-surface retirement
  // (D-170): CANVAS_* and PRO_STUDIO_* no longer declared on web.
  assert.ok(declared.length >= 15, `failed to parse server.ts (${declared})`);

  const readers = envKeyReaders(productionSourceUnits());

  const orphans = declared.filter(
    (name) => !ENFORCEMENT_ONLY_KEYS.has(name) && !readers.has(name)
  );
  assert.deepEqual(
    orphans,
    [],
    'these env keys are declared and provisioned but nothing reads them — ' +
      'wire them up, drop them, or add them to ENFORCEMENT_ONLY_KEYS with the reason'
  );

  // The escape hatch has to stay honest too: an entry that grew a real reader
  // should leave the list rather than sit there excusing nothing.
  for (const name of ENFORCEMENT_ONLY_KEYS.keys()) {
    assert.ok(
      declared.includes(name),
      `${name} is excused as enforcement-only but server.ts no longer declares it`
    );
  }
});

test('web .env.example exactly mirrors web schemas and tool-owned keys', () => {
  const expected = new Set([
    ...declaredKeys(join(here, 'server.ts')),
    ...declaredKeys(join(here, 'client.ts')),
    // Local database tooling and Wrangler own these rather than createEnv.
    'DATABASE_URL',
    'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE',
    // CLI-owned dry-run snapshot for Waffo provisioning, not createEnv.
    'WAFFO_COMMERCE_SNAPSHOT_FILE',
  ]);
  const example = new Set(exampleKeys(join(repo, '.env.example')));

  assert.deepEqual(
    {
      missingFromExample: [...expected].filter((name) => !example.has(name)),
      unknownInExample: [...example].filter((name) => !expected.has(name)),
    },
    { missingFromExample: [], unknownInExample: [] }
  );
});

test('root .env.example owns the web keys needed by the monorepo stack', () => {
  const rootExample = new Set(exampleKeys(join(rootRepo, '.env.example')));
  // Canvas / Pro Studio seams retired with product surface (D-170).
  const rootStackWebKeys = [
    'DATABASE_URL',
    'INTERNAL_SERVICE_TRANSPORT',
    'CORE_SERVICE_URL',
    'CORE_SERVICE_TOKEN',
  ];

  assert.deepEqual(
    rootStackWebKeys.filter((name) => !rootExample.has(name)),
    [],
    'the root example starts the full stack and must carry its web service seams'
  );
});
