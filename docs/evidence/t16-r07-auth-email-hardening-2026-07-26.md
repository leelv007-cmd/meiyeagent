# T16 R-07 auth and email hardening evidence

Date: 2026-07-26
Branch: `legacy-origin-a/t16-auth-email-hardening`

## Typecheck evidence discrepancy

The earlier reported green command was:

```text
pnpm --filter @meiye/web typecheck
```

It ran in `/Users/bin/orca/workspaces/美业内容2/t16-auth-email-hardening` on the
uncommitted tree that was subsequently committed as `19fed944`. The package
script runs `pnpm locale:compile && tsc --noEmit`; that run exited 0.

At `19fed944`, this remediation turn initially reran both:

```text
pnpm --filter @meiye/web exec tsc --noEmit
pnpm --filter @meiye/web exec tsc --noEmit --incremental false
```

Both exited 0 with no diagnostics. The Web `tsconfig.json` does not enable
incremental compilation and no Web `.tsbuildinfo` was present, so cache is not
a supported explanation. The review environment reproduced three diagnostics;
the exact environment difference remains unproven.

Adding an explicit but optional-property result union then reproduced the same
three diagnostics locally:

```text
src/lib/core-client.test.ts(64,16): error TS18048: 'result.response' is possibly 'undefined'.
src/lib/core-client.test.ts(65,26): error TS18048: 'result.response' is possibly 'undefined'.
src/middlewares/admin-middleware.ts(66,3): error TS2345: ... Promise<... | undefined> ...
```

This confirmed the code defect: property-presence narrowing was not a stable
discriminator for this result. The final contract uses `ok: true | false` and
explicit return types on both authorization helpers.

Final cold command:

```text
$ pnpm --filter @meiye/web exec tsc --noEmit && printf 'TSC_EXIT=0\n'
TSC_EXIT=0
```

## N-2 response contract

The chosen fix is a shared response-factory contract. Normal and recent admin
middleware now use the same factories and preserve:

```json
{"success":false,"error":"Unauthorized"}
{"success":false,"error":"Forbidden"}
```

## N-3 Node 24 dynamic import

`recent-admin-session.test.ts` installs Node module hooks for the
`cloudflare:workers` binding and unrelated peripheral config/mail/URL
dependencies, then calls `requireRecentAdminSession(request)` without injecting
a session getter. It does not stub the auth module, default getter, Better Auth,
or session API: the test executes the default dynamic import, `createAuth()`,
and `getSession()` path under Node 24.

Focused result:

```text
tests 23
pass 23
fail 0
```

Command:

```text
pnpm --filter @meiye/web locale:compile -- --dev
pnpm --filter @meiye/web exec tsx --test \
  src/auth/auth-plugins.test.ts \
  src/auth/recent-admin-session.test.ts \
  src/auth/recent-authentication.test.ts \
  src/lib/core-client.test.ts \
  src/mail/provider/safe-log.test.ts
```

Biome and `git diff --check` passed. Per the targeted-review instruction, auth
Playwright was not rerun; the previously governed run remains `7 passed (1.7m)`.
