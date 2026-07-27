# Langfuse outbox operations

The Harness Langfuse outbox retries transient delivery failures only up to
`LANGFUSE_OUTBOX_MAX_ATTEMPTS` (default `8`). A final failure is retained as
`dead_letter`; it is excluded from readiness backlog and is never claimed again
automatically. `discarded` is a terminal operator decision.

Run these commands from the repository root with `DATABASE_URL` set. They do
not print credentials or payloads:

```sh
DATABASE_URL="$DATABASE_URL" pnpm --filter @meiye/core langfuse:outbox:ops -- replay <audit-id>
DATABASE_URL="$DATABASE_URL" pnpm --filter @meiye/core langfuse:outbox:ops -- discard <audit-id>
```

Replay resets the automatic attempt counter and queues the exact stored audit
event for delivery. Discard keeps the row and marks it terminal. Confirm the
dead-letter reason before replaying a poison message.
