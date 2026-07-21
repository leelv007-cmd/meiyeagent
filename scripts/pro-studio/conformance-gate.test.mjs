import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectCanvasBuildArtifactFiles,
  discoverExactCopyTargets,
  findForbiddenBuildArtifactFindings,
  findForbiddenSourceFindings,
  findFrontendFetchViolations,
  validateCanvasBuildArtifacts,
  validateCopyManifest,
  validateDiscoveredCopySet,
  validateReleaseEvidence,
} from './conformance-gate.mjs';

test('local live development sends Canvas session validation to the Vite listener', () => {
  const rootPackage = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  );

  assert.match(
    rootPackage.scripts['dev:live'],
    /MAIN_APP_ORIGIN=http:\/\/localhost:3000/
  );
});

test('Playwright starts Canvas as the fourth required web server', () => {
  const config = readFileSync(
    new URL('../../mkfast-template-main/playwright.config.ts', import.meta.url),
    'utf8'
  );
  const canvasStart = config.indexOf("name: 'Canvas'");
  const candidateStart = config.indexOf('...(productionCandidate');

  assert.ok(canvasStart > 0, 'Canvas webServer must be declared explicitly');
  assert.ok(
    candidateStart > canvasStart,
    'the optional production candidate must follow Canvas'
  );
  assert.match(config, /PLAYWRIGHT_CANVAS_PORT/);
  const canvasBlock = config.slice(canvasStart, candidateStart);
  for (const expected of [
    'DATABASE_URL',
    'CORE_SERVICE_URL',
    'CORE_SERVICE_TOKEN',
    'CANVAS_SERVICE_TOKEN',
    'CANVAS_ORIGIN',
    'MAIN_APP_ORIGIN',
    'PORT=\\$\\{canvasPort\\}',
    '@meiye/canvas',
  ]) {
    assert.match(canvasBlock, new RegExp(expected));
  }
});

test('copy manifest requires a pinned commit and per-file A2/A3 evidence', () => {
  const copied = Buffer.from('authorized canvas copy fixture');
  const sha256 = createHash('sha256').update(copied).digest('hex');
  const issues = validateCopyManifest(
    {
      upstream: {
        commit: 'a2c52c7aacf68d825563b7455efa9c34f3db0123',
        repository: 'https://github.com/csyqlz/vozeb',
      },
      copies: [
        {
          source: 'web/src/canvas.tsx',
          target: 'apps/canvas/src/vendor/vozeb/canvas.tsx',
          authorizationStatus: 'pending',
          a2Evidence: 'docs/evidence/pro-studio/a2.md',
          a3Evidence: 'docs/evidence/pro-studio/a3.md',
          sha256,
        },
      ],
    },
    {
      evidenceExists: () => false,
      readSource: () => copied,
      readTarget: () => copied,
    }
  );

  assert.deepEqual(issues, [
    'apps/canvas/src/vendor/vozeb/canvas.tsx: authorizationStatus must be authorized',
    'apps/canvas/src/vendor/vozeb/canvas.tsx: missing A2 evidence docs/evidence/pro-studio/a2.md',
    'apps/canvas/src/vendor/vozeb/canvas.tsx: missing A3 evidence docs/evidence/pro-studio/a3.md',
  ]);
});

test('copy manifest rejects missing or mismatched targets and omitted exact copies', () => {
  const source = Buffer.from('upstream source fixture');
  const sha256 = createHash('sha256').update(source).digest('hex');
  const manifest = {
    copies: [
      {
        a2Evidence: 'a2.md',
        a3Evidence: 'a3.md',
        authorizationStatus: 'authorized',
        sha256,
        source: 'web/src/copied.ts',
        target: 'apps/canvas/src/vendor/vozeb/copied.ts',
      },
    ],
    upstream: {
      commit: 'a2c52c7aacf68d825563b7455efa9c34f3db0123',
      repository: 'https://github.com/csyqlz/vozeb',
    },
  };

  assert.deepEqual(
    validateCopyManifest(manifest, {
      evidenceExists: () => true,
      readSource: () => source,
      readTarget: () => undefined,
    }),
    ['apps/canvas/src/vendor/vozeb/copied.ts: copied target is missing']
  );
  assert.deepEqual(
    validateCopyManifest(manifest, {
      evidenceExists: () => true,
      readSource: () => source,
      readTarget: () => Buffer.from('tampered target'),
    }),
    [
      'apps/canvas/src/vendor/vozeb/copied.ts: source and target do not match the declared sha256',
    ]
  );
  assert.deepEqual(
    validateDiscoveredCopySet(manifest.copies, [
      'apps/canvas/src/vendor/vozeb/copied.ts',
      'apps/canvas/src/vendor/vozeb/omitted.ts',
    ]),
    [
      'apps/canvas/src/vendor/vozeb/omitted.ts: exact upstream copy is missing from the manifest',
    ]
  );

  assert.deepEqual(
    validateCopyManifest(
      {
        ...manifest,
        copies: [
          {
            ...manifest.copies[0],
            target: 'apps/canvas/src/vendor/vozeb/wrong.ts',
          },
        ],
      },
      {
        evidenceExists: () => true,
        readSource: () => source,
        readTarget: () => source,
      }
    ),
    [
      'apps/canvas/src/vendor/vozeb/wrong.ts: target must map web/src/copied.ts to apps/canvas/src/vendor/vozeb/copied.ts',
    ]
  );
});

test('copy manifest rejects forbidden local-agent, arbitrary-proxy, and provider-direct sources', () => {
  const cases = [
    {
      expected: 'forbidden local-agent bridge',
      source: 'const token = localStorage.getItem("canvas-agent-token");',
    },
    {
      expected: 'forbidden arbitrary proxy',
      source:
        'return `/api/media-proxy?url=$' + '{encodeURIComponent(value)}`;',
    },
    {
      expected: 'forbidden provider-direct runtime',
      source: 'import { createImageGenerationTask } from "@/services/api/image";',
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const source = Buffer.from(testCase.source);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const target = `apps/canvas/src/vendor/vozeb/unsafe-${index}.ts`;
    const issues = validateCopyManifest(
      {
        copies: [
          {
            a2Evidence: 'a2.md',
            a3Evidence: 'a3.md',
            authorizationStatus: 'authorized',
            sha256,
            source: `web/src/unsafe-${index}.ts`,
            target,
          },
        ],
        upstream: {
          commit: 'a2c52c7aacf68d825563b7455efa9c34f3db0123',
          repository: 'https://github.com/csyqlz/vozeb',
        },
      },
      {
        evidenceExists: () => true,
        readSource: () => source,
        readTarget: () => source,
      }
    );

    assert.ok(
      issues.includes(`${target}: ${testCase.expected}`),
      `${testCase.expected}: ${issues.join(', ')}`
    );
  }
});

test('copy manifest rejects a tampered written authorization instrument', () => {
  const copied = Buffer.from('safe canvas copy');
  const instrument = Buffer.from('authorized instrument');
  const tampered = Buffer.from('tampered instrument');
  const copiedSha = createHash('sha256').update(copied).digest('hex');
  const instrumentSha = createHash('sha256').update(instrument).digest('hex');
  const issues = validateCopyManifest(
    {
      authorization: {
        instrument: {
          evidenceCopyPath: 'evidence-instrument.md',
          sha256: instrumentSha,
          sourcePath: 'source-instrument.md',
        },
      },
      copies: [
        {
          a2Evidence: 'a2.md',
          a3Evidence: 'a3.md',
          authorizationStatus: 'authorized',
          sha256: copiedSha,
          source: 'web/src/safe.ts',
          target: 'apps/canvas/src/vendor/vozeb/safe.ts',
        },
      ],
      upstream: {
        commit: 'a2c52c7aacf68d825563b7455efa9c34f3db0123',
        repository: 'https://github.com/csyqlz/vozeb',
      },
    },
    {
      evidenceExists: () => true,
      readEvidence: (path) =>
        path === 'source-instrument.md' ? instrument : tampered,
      readSource: () => copied,
      readTarget: () => copied,
    }
  );

  assert.deepEqual(issues, [
    'authorization.instrument: evidence copy does not match the declared sha256',
  ]);
});

test('exact-copy discovery includes binary files and source dot-directories', () => {
  const upstream = mkdtempSync(join(tmpdir(), 'pro-studio-upstream-'));
  const target = mkdtempSync(join(tmpdir(), 'pro-studio-target-'));
  try {
    mkdirSync(join(upstream, '.storybook'), { recursive: true });
    mkdirSync(join(upstream, 'public'), { recursive: true });
    mkdirSync(join(upstream, 'node_modules', 'ignored'), { recursive: true });
    mkdirSync(join(target, 'src', '.storybook'), { recursive: true });
    mkdirSync(join(target, 'public'), { recursive: true });
    mkdirSync(join(target, 'node_modules', 'ignored'), { recursive: true });

    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(join(upstream, 'public', 'copied.png'), binary);
    writeFileSync(join(target, 'public', 'copied.png'), binary);
    writeFileSync(
      join(upstream, '.storybook', 'preview.cjs'),
      'copied dot source'
    );
    writeFileSync(
      join(target, 'src', '.storybook', 'preview.cjs'),
      'copied dot source'
    );
    writeFileSync(
      join(upstream, 'node_modules', 'ignored', 'same.wasm'),
      binary
    );
    writeFileSync(join(target, 'node_modules', 'ignored', 'same.wasm'), binary);

    assert.deepEqual(discoverExactCopyTargets(upstream, target).sort(), [
      'apps/canvas/public/copied.png',
      'apps/canvas/src/.storybook/preview.cjs',
    ]);
  } finally {
    rmSync(upstream, { force: true, recursive: true });
    rmSync(target, { force: true, recursive: true });
  }
});

test('production exact-copy discovery can stay inside the frozen vendor namespace', () => {
  const upstream = mkdtempSync(join(tmpdir(), 'pro-studio-upstream-'));
  const canvas = mkdtempSync(join(tmpdir(), 'pro-studio-canvas-'));
  const vendor = join(canvas, 'src', 'vendor', 'vozeb');
  try {
    mkdirSync(vendor, { recursive: true });
    writeFileSync(join(upstream, 'next-env.d.ts'), 'shared framework template');
    writeFileSync(join(canvas, 'next-env.d.ts'), 'shared framework template');
    writeFileSync(join(upstream, 'canvas.tsx'), 'authorized canvas bytes');
    writeFileSync(join(vendor, 'canvas.tsx'), 'authorized canvas bytes');

    assert.deepEqual(
      discoverExactCopyTargets(
        upstream,
        vendor,
        'apps/canvas/src/vendor/vozeb'
      ),
      ['apps/canvas/src/vendor/vozeb/canvas.tsx']
    );
  } finally {
    rmSync(upstream, { force: true, recursive: true });
    rmSync(canvas, { force: true, recursive: true });
  }
});

test('copy manifest cannot pass while the authorized canvas copy set is empty', () => {
  assert.deepEqual(
    validateCopyManifest(
      {
        upstream: {
          commit: 'a2c52c7aacf68d825563b7455efa9c34f3db0123',
          repository: 'https://github.com/csyqlz/vozeb',
        },
        copies: [],
      },
      () => true
    ),
    ['copies: at least one direct-copy entry is required']
  );
});

test('source scan rejects the unsafe local-agent and arbitrary-proxy surface', () => {
  const findings = findForbiddenSourceFindings([
    {
      path: 'apps/canvas/src/unsafe.ts',
      contents: "const agentToken = localStorage.getItem('agentToken');",
    },
    {
      path: 'apps/canvas/src/proxy.ts',
      contents:
        "export const proxy = { serverUrl: 'https://provider.test', requestTemplate: {} };",
    },
    {
      path: 'apps/canvas/src/server/agent.ts',
      contents: 'export class CanvasAgentApplicationService {}',
    },
  ]);

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ['agent-token', 'local-storage-token', 'arbitrary-provider-target']
  );
});

test('source scan does not self-report the local-agent guard module', () => {
  const guardUrl = new URL(
    '../../apps/canvas/src/kernel-host/agent-adapter.ts',
    import.meta.url
  );
  assert.deepEqual(
    findForbiddenSourceFindings([
      {
        contents: readFileSync(guardUrl, 'utf8'),
        path: 'apps/canvas/src/kernel-host/agent-adapter.ts',
      },
    ]),
    []
  );
});

test('build-artifact scan rejects forbidden secrets emitted by Next', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'canvas-next-artifacts-'));
  try {
    for (const directory of [
      'static/chunks',
      'server/app',
      'standalone/apps/canvas',
      'standalone/apps/canvas/node_modules/next',
    ]) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    writeFileSync(join(fixture, 'static/chunks/client.js'), 'export{}');
    writeFileSync(join(fixture, 'server/app/route.js'), 'export{}');
    writeFileSync(
      join(fixture, 'standalone/apps/canvas/server.js'),
      'export{}'
    );
    writeFileSync(
      join(fixture, 'standalone/apps/canvas/node_modules/next/server.js'),
      'require("node:child_process")'
    );
    writeFileSync(
      join(fixture, 'build-manifest.json'),
      JSON.stringify({ agentToken: 'fixture-build-secret' })
    );

    const files = collectCanvasBuildArtifactFiles(fixture);
    assert.deepEqual(files.map((file) => file.path).sort(), [
      'apps/canvas/.next/build-manifest.json',
      'apps/canvas/.next/server/app/route.js',
      'apps/canvas/.next/standalone/apps/canvas/server.js',
      'apps/canvas/.next/static/chunks/client.js',
    ]);
    assert.deepEqual(findForbiddenBuildArtifactFindings(files), [
      {
        path: 'apps/canvas/.next/build-manifest.json',
        rule: 'agent-token',
      },
    ]);
    assert.deepEqual(validateCanvasBuildArtifacts(fixture), [
      'apps/canvas/.next/build-manifest.json: forbidden agent-token',
    ]);
    assert.deepEqual(validateCanvasBuildArtifacts(join(fixture, 'missing')), [
      'apps/canvas/.next: Canvas build artifacts are missing',
    ]);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test('build-artifact scan ignores unreferenced Next externals but rejects app usage', () => {
  const frameworkExternal = '3802:a=>{a.exports=require("node:child_process")}';

  assert.deepEqual(
    findForbiddenBuildArtifactFindings([
      {
        path: 'apps/canvas/.next/server/framework.js',
        contents: frameworkExternal,
      },
    ]),
    []
  );
  assert.deepEqual(
    findForbiddenBuildArtifactFindings([
      {
        path: 'apps/canvas/.next/server/app.js',
        contents: `${frameworkExternal},9000:(a,b,c)=>{c(3802).spawn('tool')}`,
      },
    ]),
    [
      {
        path: 'apps/canvas/.next/server/app.js',
        rule: 'node-process-execution',
      },
    ]
  );
});

test('client fetch is allowed only in the Canvas BackendPort', () => {
  const violations = findFrontendFetchViolations([
    {
      path: 'apps/canvas/src/client/backend-client.ts',
      contents:
        "'use client';\nexport const call = () => fetch('/api/canvas/projects');",
    },
    {
      path: 'apps/canvas/src/components/project.tsx',
      contents:
        "'use client';\nexport const load = () => fetch('https://provider.test');",
    },
    {
      path: 'apps/canvas/src/app/api/canvas/route.ts',
      contents: "export const POST = () => fetch('http://core.internal');",
    },
  ]);

  assert.deepEqual(violations, [
    'apps/canvas/src/components/project.tsx: client fetch must use CanvasBackendPort',
  ]);
});

test('release evidence keeps external and runtime gates fail closed', () => {
  const issues = validateReleaseEvidence(
    {
      n2Recovery: null,
      providerSafeFetch: {
        status: 'passed',
        path: 'docs/evidence/pro-studio/safe-fetch.md',
      },
      providerReferenceProbe: {
        status: 'blocked',
        path: 'docs/evidence/pro-studio/provider-reference.md',
      },
      audioSpeechActivation: null,
      audioSfxActivation: null,
      securityMatrix: {
        status: 'passed',
        path: 'docs/evidence/pro-studio/security.md',
      },
      crossServiceSmoke: {
        status: 'passed',
        path: 'docs/evidence/pro-studio/smoke.md',
      },
      pricingApproval: null,
      upsellValidation: null,
    },
    (path) => path.endsWith('safe-fetch.md')
  );

  assert.deepEqual(issues, [
    'n2Recovery: evidence path is required',
    'providerReferenceProbe: status must be passed',
    'audioSpeechActivation: evidence path is required',
    'audioSfxActivation: evidence path is required',
    'securityMatrix: missing evidence docs/evidence/pro-studio/security.md',
    'crossServiceSmoke: missing evidence docs/evidence/pro-studio/smoke.md',
    'pricingApproval: evidence path is required',
    'upsellValidation: evidence path is required',
  ]);
});

test('release evidence cannot outrank the computed security manifest status', () => {
  const passed = {
    path: 'docs/evidence/pro-studio/evidence.md',
    status: 'passed',
  };
  const evidence = Object.fromEntries(
    [
      'n2Recovery',
      'providerSafeFetch',
      'providerReferenceProbe',
      'audioSpeechActivation',
      'audioSfxActivation',
      'securityMatrix',
      'crossServiceSmoke',
      'pricingApproval',
      'upsellValidation',
    ].map((key) => [key, passed])
  );

  assert.deepEqual(
    validateReleaseEvidence(
      evidence,
      () => true,
      {
        blockers: ['production security drill missing'],
        errors: [],
        status: 'partial',
      },
      () => true
    ),
    [
      'securityMatrix: release evidence status passed does not match computed partial',
    ]
  );
});

test('passed N2 release evidence still requires the recovery verifier', () => {
  const passed = (path) => ({ status: 'passed', path });
  const evidence = {
    n2Recovery: passed('docs/evidence/n2-recovery/manifest.json'),
    providerSafeFetch: passed('safe-fetch.md'),
    providerReferenceProbe: passed('provider-reference.md'),
    audioSpeechActivation: passed('audio-speech.md'),
    audioSfxActivation: passed('audio-sfx.md'),
    securityMatrix: passed('security.md'),
    crossServiceSmoke: passed('smoke.md'),
    pricingApproval: passed('pricing.md'),
    upsellValidation: passed('upsell.md'),
  };

  assert.deepEqual(
    validateReleaseEvidence(evidence, () => true, undefined),
    ['n2Recovery: production recovery manifest verifier is required']
  );
  assert.deepEqual(
    validateReleaseEvidence(
      evidence,
      () => true,
      undefined,
      () => false
    ),
    ['n2Recovery: production recovery manifest did not pass verifier']
  );
  assert.deepEqual(
    validateReleaseEvidence(
      evidence,
      () => true,
      undefined,
      () => true
    ),
    []
  );
});
