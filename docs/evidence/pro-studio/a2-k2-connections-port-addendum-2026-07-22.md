# A2 — K2 connections derivative-port addendum

- **Recorded:** 2026-07-22 (Asia/Shanghai)
- **Basis:** `a2-authorization-2026-07-19.md` §3 authorizes derivatives inside
  美业内容2.
- **Reviewer:** `product_owner`
- **Status:** authorized under the recorded written instrument.

| Field | Value |
| --- | --- |
| Upstream | `web/src/app/(user)/canvas/components/canvas-connections.tsx` |
| Pinned commit | `a2c52c7aacf68d825563b7455efa9c34f3db0123` |
| Source SHA-256 | `9d6dd28cacef0a7efc9611b04d421300f8d463052c38a655693bf1fde2eda30a` |
| Host target | `apps/canvas/src/kernel-host/ported/canvas-connections.tsx` |
| Product use | K2 node-connection rendering and selection |

The derivative preserves the approved SVG connection geometry and public
selection/context-menu callbacks. It adds the explicit React runtime required
by the Canvas host and redirects persistence to the kernel graph `onChange`
path, which continues through server draft/OCC via BackendPort.

No upstream project store, provider call, local Agent bridge, credential,
generation task, or account behavior is admitted by this authorization.
