# Retired AI playground

The TanStarter `/ai` playground is retired in this fork. The route and its
server functions, cards, model catalog, navigation entries, and provider
configuration were removed together. Browser acceptance keeps `/ai` at 404;
see `tests/e2e/TEST-CATALOG.md` §1.3.

This document is a retirement record, not an integration guide. Do not restore
template provider variables or copy the deleted playground examples into the
Web shell.

Product model execution belongs to the Core service and its governed model
supply:

- Repository ADR: `../docs/adr/0006-p0-runtime-topology.md`
- Product boundary: `../docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
- Provisioning authority: `../docs/ops/provisioning-manifest.md`

New model providers must enter through that Core-side catalog, activation, and
evidence path. The Web shell does not own a parallel image-generation provider
configuration.
