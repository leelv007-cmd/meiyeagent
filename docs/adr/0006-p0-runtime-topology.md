# P0 Runtime Topology: Workers Shell + Single Node Service

Status: accepted (2026-07-07, supersedes ADR-0002)

2026-07-08 update (amended by ADR-0008 on 2026-07-11): finished video generation is in P0. The single Node service still stands, but `renderer/jobs` now includes a P0 video compose worker for ffmpeg concat, subtitles/BGM, switch-controlled product labels, provenance metadata recording, and storage handoff. Graphic rendering remains deferred in P0; video compose is the first split-signal watch item.

（2026-07-17，per D-034）新五段式工作流的 durable 载体为 DBOS Transact；下文「pipeline step-runner on durable_jobs」记录的是决定时机制，pg-boss 收窄为存量队列。单 Node 服务 + 单 Postgres 拓扑不变。

ADR-0002 mandated four independently deployed services (App Shell / Core API / Agent Service / Worker Pool) plus a dual database (D1 shell-local + Postgres facts). Its motive — the App Shell must never invisibly own product facts — remains fully endorsed. Its implementation conflated "boundary" with "deployment unit": for a 1-3 person pre-PMF team the four-way split buys identity propagation, cross-service consistency, quadruple environments and joint debugging, with no scale that needs it. ADR-0002's own considered options never evaluated deployment weight or geography.

**Decision**

- **Workers shell** (mkfast-template): marketing site, auth/session UI, dashboard shell, thin typed BFF, upload signing. Owns no product facts. The copilot chat endpoint may run here (AI SDK is Workers-compatible; tools call the Node service over an internal API).
- **Single Node service**: Core API domain logic (stores/assets/content/video/compliance/leads/usage), pipeline step-runner on durable_jobs, video compose worker, publishing/export jobs, and the AI runner behind the Runtime Port — one repo, one deploy unit (CF Containers/Railway/Fly all acceptable). Graphic renderer remains a Go 后 / P1 module.
- **Single managed Postgres** as the only source of truth, including Better Auth tables (reached from Workers via Hyperdrive). D1 carries no business data.
- **R2 for binaries behind a storage adapter** (swapped to OSS/COS at landing, per ADR-0005).

Boundary rules carried over from ADR-0002 as module-level rules: the shell owns no facts; the agent runner mutates nothing except through Core API modules; the renderer decides no authorization, billing, or compliance.

**Evolution target and split triggers**

The four-service diagram is retained as the evolution target. Split only on real signals: (1) video compose or later rendering blocks the event loop under batch load → extract worker; (2) agent release cadence/scaling diverges from the main app → extract agent service; (3) measured database bottleneck → scale/split storage.

**Consequences**

One network hop (Workers → Node) needs a shared types package and service-token identity passing; SSE streaming pass-through must be validated in Week-1 (fallback: front-end connects to the Node service directly). Peer evidence: CreatOK ships a comparable commercial product as a single Vercel deployment (see references/creatok/reports/creatok-architecture-estimate.md).
