# Ticket 02 closure evidence

This bundle closes the Custom LLM fourth-mode ticket against the real local
browser BFF, Core, worker, PostgreSQL, and configured remote provider.

- `continuous-custom-provider-journey.webm` is one uncut 133.88-second browser
  session covering platform-admin activation, the required cold restart,
  catalog draft/enable/publish, merchant setup, fixed Custom selection, and
  three real copy candidates.
- `evidence.json` records eight passed activation probes: the three Custom
  operations before restart, the same three operations after restart, and both
  operations declared by the concurrently live Seedream deployment. It also
  records the published catalog revision and the merchant Job's frozen
  `actualCatalogModelId=llm-custom` provenance.
- `01-custom-live-verified-admin.png` and
  `02-custom-catalog-published.png` retain the administrator-visible Custom
  deployment and catalog lifecycle.
- `03-custom-fixed-before-submit.png` and
  `04-custom-real-three-candidates.png` prove fixed model selection and the
  merchant-visible three-candidate result.
- `probe-restart-checkpoint.json` and the empty resume marker delimit the real
  cold-restart checkpoint used by the evidence harness.
- `manifest.json` fixes every artifact byte size and SHA-256 digest.

The run exposed and fixed a same-revision evidence refresh defect: global
activation evidence could retain a probe reference owned by an older admin
workspace, causing a fully probed new workspace to fail catalog publication.
The focused Core regression now proves a repeated complete probe refreshes the
current evidence reference without changing the configuration revision.
