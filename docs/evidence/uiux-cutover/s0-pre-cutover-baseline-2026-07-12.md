# UI/UX S0 Pre-Cutover Baseline

Status: local-verified

This record freezes the last stable build before the one-time UI/UX cutover. It
contains no production deployment claim, live-provider claim, secret, customer
copy, or customer media. No real target-user testing was performed.

## Frozen versions

| Item | Value |
|---|---|
| Pre-cutover application commit | `0cba2604f448e1c74549a3c0205cf037e2b88560` |
| Web test-discovery commit | `b074cb0400538f5c1e501d2231c2bcf131718f2f` |
| Repeatable evidence tooling commit | `33137b2` |
| Node | `v24.9.0` |
| pnpm | `10.30.3` |
| Web | `@meiye/web`, private workspace package |
| Core and worker | `@meiye/core@0.0.0`; worker uses the same source revision |
| Local PostgreSQL | `postgres:16-alpine`, healthy on the isolated development port |
| Schema revision | `fcd1a72c19fdf8b6226f88588b1f1a7e606556f840c96b9f65a7b60c2a13f711` |

Run `pnpm uiux:baseline` to reproduce the commit, schema-file, route-tree, and
non-secret runtime-mode manifest. Runtime variables that are not explicitly set
are reported as `not-set`; their values are never inferred from UI copy.

## Repeatable gates

| Command/evidence | Result |
|---|---|
| `pnpm check` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass: Web 49/49; Core 312 pass + 18 explicit skips out of 330; UI/UX evidence tools 4/4 |
| `pnpm e2e` | pass: 29/29 in 2.3 minutes, Chromium, one worker |
| detached `0cba260` `pnpm install --offline --frozen-lockfile && pnpm build` | pass; exact frozen commit is buildable |
| `pnpm uiux:bundle-check` | pass: initial JS 307,688 gzip bytes; initial CSS 33,099 gzip bytes; Polotno remains a separate 598,375-byte gzip lazy chunk |
| `pnpm uiux:secret-scan` | pass: 1,073 text files scanned; zero findings |
| local PostgreSQL cutover tests | pass: 3/3 across repeatable cutover/rollback and relational Product projection |
| `pnpm uiux:cutover --help` | pass; plan/inspect/dry-run/backup/restore/freeze/backfill/activate/rollback are explicit actions |

The ordinary Core run skips database- and paid-provider-dependent tests when
their opt-in environment is absent. The separately executed PostgreSQL cutover
tests used the local development database. The live Ark test stayed skipped
because this baseline must not spend provider quota.

## Browser quality envelope

The `uiux-precutover-baseline.spec.ts` test stores only aggregate evidence.

| Metric | Frozen value |
|---|---:|
| Serious/critical axe rules | `color-contrast`: 2 nodes |
| Product Core requests during one dashboard reload | 24 |
| Dashboard DOM nodes | 534 |
| Horizontal overflow at 1280px/200% effective width | 0 px |
| First Tab target has an accessible name | yes |

These are non-regression ceilings, not a declaration that the current UI meets
the final S5 standard. S1 must remove the two contrast findings and S1-S3 must
reduce unconditional queries without exceeding the envelope in between.

## Known pre-cutover defects

- The current page can expose the `weekly_review ... data is undefined` error.
- The current week strip shows seven days instead of the locked five-point
  projection.
- Dashboard local tabs and the legacy workbench still form a second navigation
  contract.
- Some filters expose raw values such as `all`.
- Mobile coverage is one 390x844 project; the final viewport and landscape
  matrix is not yet present.
- Two serious color-contrast nodes remain in the baseline.

These defects are classified as owning work for S1-S4. They were not introduced
or hidden by S0.

## Acceptance mapping

- A01: fixed and verified. Root tests now discover Web node tests, and all four
  fixed commands have a passing local baseline.
- A02/A03/A06: executable skeleton verified. The exact frozen build is
  buildable; local PostgreSQL tests prove repeatable migration, reconciliation,
  rollback-future-entry, and immutable legacy data behavior. The same-candidate
  rehearsal remains an S5 gate.
- A04/A05: existing cutover tests preserve canonical relations and explicit
  in-flight ownership without regeneration; candidate-build evidence remains an
  S2/S5 gate.
- Product IA: unchanged in S0.

S0 is closed as development evidence only. Production remains frozen at the
recorded pre-cutover application commit until S5 is separately authorized.
