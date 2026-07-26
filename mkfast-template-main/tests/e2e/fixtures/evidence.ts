import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Where a browser test writes a screenshot (T37 / M-04, #231).
 *
 * Specs used to write straight into the repository's tracked `docs/evidence/`
 * tree, so any ordinary local run silently rewrote committed evidence — a full
 * baseline sweep rewrote five Pro Studio PNGs before anyone touched a feature.
 * Evidence that changes as a side effect of running tests is not evidence.
 *
 * Screenshots now land under an untracked directory (`output/` is gitignored at
 * the repository root). Publishing a screenshot into `docs/evidence/` becomes a
 * deliberate copy during an acceptance ceremony, which is the only time a
 * tracked file should move.
 *
 * `E2E_EVIDENCE_DIR` overrides the destination, so a CI job that wants these
 * screenshots in its upload can point the same call sites at its artifact
 * directory without editing any spec.
 */
const DEFAULT_EVIDENCE_ROOT = resolve(
  process.cwd(),
  '..',
  'output/e2e-evidence'
);

function evidenceRoot() {
  const configured = process.env.E2E_EVIDENCE_DIR;
  if (!configured) return DEFAULT_EVIDENCE_ROOT;
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

/**
 * Resolve `relativePath` (the path a screenshot used to carry below
 * `docs/evidence/`) under the evidence root, creating its directory so
 * `page.screenshot({ path })` cannot fail on a missing parent.
 */
export function evidencePath(relativePath: string): string {
  const full = resolve(evidenceRoot(), relativePath);
  mkdirSync(dirname(full), { recursive: true });
  return full;
}
