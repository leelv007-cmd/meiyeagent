# Ticket 06–08 browser evidence

Run the reusable harness from the Web workspace:

```bash
cd mkfast-template-main
node scripts/evidence/contentpackage-ticket-06-08.mjs
```

The harness creates a new merchant account and one continuous Chromium recording. It exercises the Ticket 06/07 adoption and library journey, then attempts the Ticket 08 user-visible video journey without changing administrator runtime configuration.

`observed-run-20260717/manifest.json` is the curated structured result from the last session that reached the current video selector. Ticket 06/07 passed. Ticket 08 remained blocked because the shared catalog exposed no live-verified video model. The manifest intentionally does not claim completed video playback or mobile parity.
