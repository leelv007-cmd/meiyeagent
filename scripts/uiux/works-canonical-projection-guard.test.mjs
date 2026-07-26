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
    ['imports delete-after-reshell module "canonical-media-gallery"']
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
