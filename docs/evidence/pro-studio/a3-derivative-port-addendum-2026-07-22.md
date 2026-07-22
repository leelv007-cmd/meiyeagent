# A3 — K1 derivative-port addendum

- **Recorded:** 2026-07-22 (Asia/Shanghai)
- **Companion A2 record:** `a2-derivative-port-addendum-2026-07-22.md`
- **Reviewer:** `product_owner`

## Third-party disposition

The upstream source uses Zustand. The derivative target does **not** copy
Zustand bytes or any upstream package artifact; it replaces the store runtime
with host-local React state. `@meiye/canvas/package.json` declares Zustand
`5.0.12` for separately approved future exact UI mounts, subject to its package
license. No font, icon, image, media, prompt corpus, shadcn/Radix component, or
AGPL-unknown snippet is introduced by this derivative target.

If a future port needs a third-party asset or an upstream prompt source, it
fails closed until that item is named in a fresh A3 addendum and its license
notes are recorded in its `ports[]` row. This record does not clear the five
shared controls; K1 rebuilds those controls against product-owned catalog and
prompt seams instead of copying them.
