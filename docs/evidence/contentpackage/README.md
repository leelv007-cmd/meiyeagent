# ContentPackage real-run evidence register

Current counted end-to-end runs: **0**

The provider probes under `real-run-0001/provider-probe/` prove that the direct
LLM adapter and the Tuzi media adapter have each completed real provider work.
They do **not** count as an end-to-end merchant run: they are isolated probes,
not one continuous merchant journey.

## Pending run 0001

Status: blocked on 2026-07-15.

- Direct LLM: verified independently.
- Real media generation and download: verified independently.
- Reference-image editing: the undersized request defect was fixed and covered
  by an adapter regression test; the provider currently returns no available
  image-edit channel for the configured Seedream model.
- Merchant sample: no real merchant facts and authorized real merchant photo
  were supplied. The local project-owned synthetic image used for diagnostics
  is not eligible for the north-star count.
- Durable product facts and redacted continuous evidence: not claimed until a
  fresh uninterrupted run satisfies every requirement above.

Do not change the count to 1 from fixture, recorded, isolated-provider, or
synthetic-sample evidence.
