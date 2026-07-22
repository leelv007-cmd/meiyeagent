# A3 — K2 connections derivative-port addendum

- **Recorded:** 2026-07-22 (Asia/Shanghai)
- **Companion A2 record:**
  `a2-k2-connections-port-addendum-2026-07-22.md`
- **Reviewer:** `product_owner`

The derivative copies no third-party package bytes. React and Zustand remain
ordinary npm dependencies declared by the Canvas application. Icons, fonts,
media, prompt corpora, provider SDKs, and upstream service code are not part of
this port.

The host theme selector reads only the bootstrap-controlled Canvas appearance;
the target does not create a second durable theme, graph, project, or session
store.
