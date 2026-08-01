# #328 OpenCLI live gate handover (2026-08-02)

## Scope and verdict

- Scope: the OpenCLI note-read and media-download capabilities, using the
  operator's own logged-in browser profile.
- Live verdict: **verified once** at `2026-08-01T20:53:37Z`.
- Product verdict: the logged-in link track may be the default only when both
  this evidence gate and the current device bridge readiness are true. Paste
  remains available at all times.
- This evidence does not authorize publishing, commenting, liking, following,
  anonymous scraping, reverse-signature work, or pooled accounts.

The live run was supplied by the coordinating operator. This lane did not
repeat it and made no additional Xiaohongshu request.

## Redacted live evidence

| Check | Redacted result |
| --- | --- |
| OpenCLI version | `v1.8.6` |
| Logged-in identity check | PASS; identity intentionally omitted |
| Real note read | PASS; exactly 1 read |
| Real media download | PASS; exactly 1 download |
| Public note id digest | `sha256:fd663ff3f3eda44b7ea8b3dc065cd53e505cd66614758e37be6cde4692a3e685` |
| Note result digest | `sha256:d1ff935522ee0483e9ca87a567874b2d25dc5d3a28fd628271ea192c6c2a75f0` |
| Download result digest | `sha256:97d55dbd9c35ba22717c45bed8ef2edde40e467b66a762c908a984735455db1d` |
| Downloaded media | 9 images; 951,488 bytes total |
| Media aggregate digest | `sha256:ae4130d24e44a01dca5f79b7bdf3d85af40c9bc73562d9ac6f168247025c2834` |
| Cleanup | Temporary download moved to Trash |
| Write actions | 0 publish; 0 comment; 0 like; 0 follow |

This record intentionally omits the username, cookies, tokens, complete note
URL, note id, raw note content, images, raw JSON, browser profile paths, and any
command containing protected input.

## Production topology and trust boundary

The supported topology is:

```text
Product host companion / user extension
  -> local OpenCLI CLI
  -> loopback OpenCLI daemon
  -> WebSocket browser bridge
  -> the user's own Chrome profile and logged-in page
```

OpenCLI's daemon is loopback-only and deliberately does not grant ordinary web
origins CORS access. The product web application must therefore never call
`127.0.0.1:19825`, invoke a shell command from Core, or claim that an ordinary
page can access the daemon directly.

The Web contract is a narrow host-owned injected bridge:

- input: one complete user-pasted Xiaohongshu note URL;
- output: `noteText` plus `{id, revision}` asset refs already imported and
  rights-authorized by the host; Web binds those refs as untrusted Composer
  sources and derives carrier ids from them;
- forbidden output: cookies, protected link parameters, complete URL, local
  file paths, raw OpenCLI envelopes, or identity details;
- failure: generic local error, then one-click fallback to paste;
- persistence: the complete URL is cleared after success and must not enter a
  task, textarea, log, evidence artifact, or product memory.

The live gate and device readiness are independent. A verified live run does
not make a disconnected extension usable. A ready extension does not override
a closed evidence gate. Both checks fail closed.

## Fixture and browser acceptance boundary

Repository tests inject a fixture bridge. They prove UI selection, complete-URL
containment, generic failures, gate-closed behavior, and paste fallback without
making a Xiaohongshu request. The fixture bridge is **not** the live product
bridge and does **not** replace the live evidence above.

The merchant-visible Composer intent contains only a safe high-level request.
Raw note text and authorized asset ids enter the signed submission as the
structured `viralAdaptSource` field. Core validates the exact viral recipe and
that every authorized asset id belongs to the same submitted source set, then
freezes the field in the execution snapshot. Runtime consumers read only that
snapshot field, never merchant text. If this signed carrier is absent, stale,
or references an asset without a submitted revision, quote/submission fails
closed.

## Operations and rollback

1. Install the OpenCLI CLI and its supported browser bridge extension on the
   user's own machine and browser profile.
2. Keep the daemon bound to loopback; do not add a permissive CORS proxy.
3. Let the product host inject the versioned bridge only after the local
   companion is connected.
4. If the companion or extension is absent, stale, or returns an invalid
   result, show the honest local status and keep paste usable.
5. Roll back by closing the explicit evidence flag. This disables link
   selection without removing the paste journey.

No production credential, browser identity, remote deployment, GitHub state,
or external account state was changed by this lane.
