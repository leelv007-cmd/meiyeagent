# Ticket 01 closure evidence

This bundle closes the ContentPackage aggregate-contract gate against a real
local runtime: browser BFF on port 3000, Core on port 4100, and PostgreSQL on
port 54329.

- `continuous-seam-journey.webm` is one uncut browser session.
- `seam-evidence.json` records the BFF/Core correlation timeline and proves
  immediate list visibility, stable ordered three-asset references,
  idempotent replay without a second package, visible rights revocation, and a
  rejected repeated cancellation.
- `01-merchant-dashboard-before.png` and `02-content-library-after.png` retain
  the merchant-visible before/after surface.
- `manifest.json` fixes artifact byte sizes and SHA-256 digests.

The historical regression baseline remains frozen in
`docs/evidence/contentpackage/real-run-0003/journey/before-after-comparison.md`.
The corrective real-provider journey in that same bundle proves the existing
merchant creation flow still reaches a usable ContentPackage with owned media
and three platform variants. This Ticket 01 run intentionally targets the
contract seam and does not claim to replace Tickets 06, 07, or 22.
