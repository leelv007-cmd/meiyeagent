# UI/UX Stage Record Template

## Identity

- Stage:
- Candidate commit:
- Previous-stage commit:
- Schema revision:
- Web/Core/worker versions:
- Evidence level: local fixture / local PostgreSQL / acceptance environment /
  live activation
- Owner:
- Started/closed at:

## Scope and ownership

- Required checklist items completed:
- Owning production files changed:
- Explicitly out of scope:
- Previous-stage contract reopened, if any:

## Migration and compatibility

- Additive schema changes:
- Backfill run ID and mode:
- Reconciliation totals:
- In-flight job owners:
- Pre-cutover compatibility result:
- Rollback result:

## Verification

| Gate | Command | Result | Evidence reference |
|---|---|---|---|
| Check | `pnpm check` | | |
| Typecheck | `pnpm typecheck` | | |
| Tests | `pnpm test` | | |
| Related E2E | | | |
| Full E2E | `pnpm e2e` | | |
| Build/bundle | `pnpm build && pnpm uiux:bundle-check` | | |
| Secret scan | `pnpm uiux:secret-scan` | | |
| Accessibility/keyboard/viewport | | | |

## Defects and decisions

- Open Sev0/Sev1: none / list
- P2/P3 defects:
- P1 Owner acceptance reference, if permitted:
- Workaround, owner, expiry, and follow-up:

## Evidence truth

- No real target-user testing was performed unless a separately linked record
  proves otherwise.
- Recorded providers, fixtures, local PostgreSQL, and static prototypes are
  labeled and never presented as production or live-provider evidence.
- Reports contain no credentials, tokens, prompts, customer copy, or media.

## Exit decision

- Required gates all pass:
- Next stage may start:
- Production remains frozen:
- Approver and timestamp:
