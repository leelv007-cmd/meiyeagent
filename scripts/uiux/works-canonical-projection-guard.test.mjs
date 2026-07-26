import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  findWorksProjectionViolations,
  findWorksRouteViolations,
} from './works-canonical-projection-guard.mjs';

test('a legacy_projection_ reference on the new 作品 surface is a violation', () => {
  const findings = findWorksProjectionViolations([
    {
      path: 'src/product/works/works-list-page.tsx',
      text: [
        'import { canonical_history_recent_title } from "@/locale";',
        'import { legacy_projection_kind_work } from "@/locale";',
      ].join('\n'),
    },
  ]);
  assert.deepEqual(findings, [
    {
      line: 2,
      path: 'src/product/works/works-list-page.tsx',
      reason: 'legacy_projection_* reference',
    },
  ]);
});

test('binding a delete-after-reshell module is a violation', () => {
  const findings = findWorksProjectionViolations([
    {
      path: 'src/product/works/works-detail-page.tsx',
      text: [
        "import { CanonicalMediaGallery } from '@/product/canonical-media-gallery';",
        "import { WorksMediaGallery } from './works-media-gallery';",
      ].join('\n'),
    },
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.reason),
    ['binds delete-after-reshell module "canonical-media-gallery"']
  );
});

/**
 * The forms a line-anchored `^\s*import` test walks straight past. Each one
 * binds the retiring module exactly as hard as the single-line import does, so
 * each has to be a finding. This is the hole the adversarial review found; it
 * stays closed because these cases fail if the matcher ever goes back to
 * reading one line at a time.
 */
const MULTILINE_MUTATIONS = [
  {
    name: 'a multi-line named import',
    text: [
      'import {',
      '  CanvasWorkPage,',
      '  type CanvasWorkPageProps,',
      "} from '@/product/canvas-work-page';",
    ].join('\n'),
  },
  {
    name: 'a dynamic import()',
    text: "const page = await import('@/product/creative-object-page');",
  },
  {
    name: 'a dynamic import() split across lines',
    text: [
      'const page = await import(',
      "  '@/product/canonical-object-route-page'",
      ');',
    ].join('\n'),
  },
  {
    name: 'a bare side-effect import',
    text: "import '@/product/canonical-asset-actions';",
  },
  {
    name: 'a multi-line re-export',
    text: [
      'export {',
      '  legacyContentPackageProjection,',
      "} from '@/product/legacy-content-package-projection';",
    ].join('\n'),
  },
  {
    name: 'a lazy require()',
    text: "const card = require('@/product/content-package-card');",
  },
  {
    name: 'an import with the specifier on its own line',
    text: ['import { CanonicalHistoryPage }', "  from", "  '@/product/canonical-history-page';"].join(
      '\n'
    ),
  },
];

for (const mutation of MULTILINE_MUTATIONS) {
  test(`${mutation.name} still binds a delete-after-reshell module`, () => {
    const findings = findWorksProjectionViolations([
      { path: 'src/product/works/works-detail-page.tsx', text: mutation.text },
    ]);
    assert.equal(
      findings.length,
      1,
      `expected exactly one finding, got ${JSON.stringify(findings)}`
    );
    assert.match(findings[0].reason, /binds delete-after-reshell module/u);
  });
}

test('an off-allowlist operationsQuery action is a violation', () => {
  const findings = findWorksProjectionViolations([
    {
      path: 'src/product/works/works-queries.ts',
      text: [
        "operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),",
        "operationsQuery<Legacy[]>('legacy_works_aggregate', {}, signal),",
      ].join('\n'),
    },
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.reason),
    ['non-canonical operationsQuery action "legacy_works_aggregate"']
  );
});

test('the canonical projection model and the new surface are allowed', () => {
  assert.deepEqual(
    findWorksProjectionViolations([
      {
        path: 'src/product/works/works-projection.ts',
        text: [
          "import type { RawCanvasWorkSummary } from '@/product/canonical-history-model';",
          "import { contentPackageStatusLabel } from '@meiye/contracts';",
        ].join('\n'),
      },
    ]),
    []
  );
});

test('a works route that renders the old aggregate fails the route assertion', () => {
  const findings = findWorksRouteViolations(
    [
      {
        path: 'src/routes/dashboard/works.tsx',
        text: "import { CanonicalHistoryPage } from '@/product/canonical-history-page';",
      },
    ],
    "'/dashboard/works' '/dashboard/works_/$workId'"
  );
  assert.deepEqual(
    findings.map((finding) => finding.reason),
    ['works route must render the new 作品 surface (@/product/works)']
  );
});

test('a works path dropping out of the route tree fails', () => {
  const findings = findWorksRouteViolations(
    [
      {
        path: 'src/routes/dashboard/works.tsx',
        text: "import { WorksListPage } from '@/product/works';",
      },
    ],
    "'/dashboard/works'"
  );
  assert.deepEqual(
    findings.map((finding) => finding.reason),
    ['route tree lost /dashboard/works_/$workId']
  );
});

test('the repository itself passes the guard', () => {
  const output = execFileSync(
    process.execPath,
    ['scripts/uiux/works-canonical-projection-guard.mjs'],
    { encoding: 'utf8' }
  );
  const report = JSON.parse(output);
  assert.deepEqual(report.findings, []);
  assert.ok(report.filesScanned > 0);
});
