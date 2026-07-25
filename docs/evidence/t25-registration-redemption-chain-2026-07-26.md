# T25 registration and redemption chain evidence

## Scope

This evidence records the local, credential-free acceptance boundary for T25.
It does not claim `live_verified` email delivery or other external-provider
proof, which remains owned by T05.

## Review remediation

- F1: every Better Auth `/admin/` request strips
  `provisionedByUserId` from `body.data` before endpoint handling.
  `/admin/create-user` then applies the authenticated admin actor after the
  recent-authentication check. The journey test attempts an
  `/admin/update-user` forgery and verifies the natural account remains
  unattributed.
- F4: assisted-account email verification is declared by the explicitly named
  `ADMIN_ASSISTED_ACCOUNT_POLICY`. Per D-128, the operator owns the supplied
  contact address during account handoff, while the assisted account still
  enters the same verified-user assembly path as a naturally registered
  account. The existing production-like email-verification policy test remains
  the guard that natural registration is not auto-verified in production.
- F9: assisted creation does not yet emit a platform admin-audit entry.
  Attribution is persisted on the user row and is protected from admin update
  mutation by F1, but an immutable audit event remains absent. Candidate
  follow-up: include assisted-account creation in the future admin audit
  surface closure ticket; T25 does not add a second authentication command or
  audit table.
- F10: Drizzle metadata is formatted by
  `pnpm exec biome check --write drizzle/meta` and remains covered by the
  package `pnpm check` aggregate.

## Registered non-blocking findings

- F2: the create-user forged-attribution unit test uses a constructed Better
  Auth hook context. The journey proves real endpoint attribution, but does not
  send a forged creator field to the create-user endpoint itself.
- F3: the natural-registration journey uses `provisionedByUserId ?? null`, so
  an absent response key and an explicit null are treated alike.
- F5: `provisionedByUserId` is not configured with `returned: false`; a user
  session may therefore expose the operator's internal user id.
- F6: the web redemption card creates a new command idempotency key for each
  submission. Replay safety is provided by the canonical redemption lifecycle
  CAS rather than a stable client key.
- F7: the journey voids a code but does not attempt to redeem that voided code;
  void rejection and duplicate recording remain covered at the domain-test
  level. The admin UI also uses a generic recording failure message.
- F8: the fixture journey auto-verifies natural registration. Production uses
  the same assembly function after email verification, but that distinct
  trigger is outside this fixture journey.
- F11: `tests/e2e/TEST-CATALOG.md` does not yet list this journey; the catalog is
  not an automated gate.
- F12: the admin table and detail view display the raw Better Auth actor id
  instead of resolving an operator name or email. The Chinese assisted-account
  description also uses the internal phrase “装配链”.

## Acceptance boundary

The local journey covers manual code recording, querying, voiding, one-time
redemption, natural email registration, attributable assisted creation, admin
update forgery resistance, equal workspace/trial/default-model assembly, and
workbench entry. Live email-provider verification is intentionally excluded.
