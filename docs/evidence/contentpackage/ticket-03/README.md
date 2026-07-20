# Ticket 03 closure evidence

This bundle closes the real BYOK execution ticket against the real local
browser BFF, Core, worker, PostgreSQL, and configured remote provider.

- `continuous-byok-live-journey.webm` is one uncut 63.96-second browser
  session covering the admin switch from recorded to live, the required cold
  restart, a merchant-owned write-only credential, real Chinese output, and an
  invalid-key failure with a visible quota refund.
- `evidence.json` records configuration revision 8 as recorded, revision 9 as
  stored-live/effective-recorded before restart, and revision 9 as
  stored-live/effective-live after restart. It also fixes the merchant
  connection states, quota transitions, redacted route metadata, and the
  `byok.completed`/`byok.failed` audit projections.
- The first merchant-visible live execution commits one copy unit. A separate
  replay check then executes once with a new idempotency key and replays that
  exact key once; the harness asserts identical output, usage, and route
  snapshot for the pair. Only two completed audit events exist in total: one
  for the visible execution and one for the replay check's first execution.
- `01-admin-byok-live-restart-pending.png` and
  `02-admin-byok-live-effective.png` retain the administrator-visible cold
  restart boundary.
- `03-merchant-write-only-live-connection.png`,
  `04-merchant-live-byok-before-submit.png`, and
  `05-merchant-real-chinese-output.png` prove workspace ownership, fixed live
  routing, and a non-recorded Chinese result.
- `06-invalid-key-refunded-needs-attention.png` proves the rejected credential
  becomes unavailable and the reserved quota is released.
- `restart-checkpoint.json` and the empty resume marker delimit the real
  cold-restart checkpoint used by the evidence harness.
- `manifest.json` fixes every artifact byte size and SHA-256 digest.

Credentials, cookies, raw output, workspace identifiers, connection
identifiers, and provider request references are deliberately omitted from
structured evidence. The browser media retains only masked inputs and the
merchant-visible result.
