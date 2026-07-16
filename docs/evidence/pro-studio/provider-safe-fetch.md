# Pro Studio provider safe-fetch evidence

- Date: 2026-07-16
- Verification: `pnpm --filter @meiye/core exec tsx --test src/pro-studio-runtime/provider-safe-fetch.test.ts`
- Result: 6 passed, 0 failed

The verified contract rejects private or metadata-scoped DNS answers, pins the
connection to validated addresses, revalidates redirects, limits declared and
streamed byte counts, checks both MIME and magic bytes, and fails closed when
the concurrency limit is exhausted.
