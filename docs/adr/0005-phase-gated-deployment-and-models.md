# Phase-Gated Deployment and Model Strategy

Status: accepted (2026-07-07)

The review panel initially recommended immediate China deployment (domestic cloud + ICP) and domestic-only registered models, with regulatory filings as a project-start gate. The user overruled: Cloudflare was chosen for its strong agent-development support enabling fast build/ship/validate; mixed foreign+domestic models maximize output quality; compliance hardening before a product prototype exists contradicts the AI-native development paradigm. Constraints are therefore bound to their actual effective moment ("public paid launch"), not to project start.

**Validation phase (now → landing trigger)**

- Cloudflare-first: mkfast-template Workers shell, fastest iteration path; pilot runs as a closed, invite-only, contract-based program (standard pre-filing practice).
- Mixed model routing by quality (foreign + domestic) through a provider registry; CF AI Gateway optional for routing/caching/cost observability.
- Three light guardrails (cheap, and serving migration/signal quality rather than ceremony):
  1. *Portability discipline*: domain logic stays portable Node/Postgres; CF-specific services (D1/R2/DO/Workers AI) sit behind adapters.
  2. *Pilot data hygiene*: customer PII/face material never goes to overseas model APIs (domestic models or redaction for those tasks); AIGC labels preserved; consent clause in the pilot agreement.
  3. *Merchant network precheck*: Day-0 reachability test per pilot merchant, recorded, so "cannot open" is separated from "does not want".
- Domestic models enter the eval benchmark immediately as migration-parity targets (avoids a quality cliff on migration day).

**Landing phase (trigger: not preset — decided by business pacing)**

No trigger date is preset (user decision). The known lead times are recorded as facts: algorithm filing + LLM registration ≈ 1-3 months, ICP ≈ 2-4 weeks; whoever schedules the public paid launch must start these that far in advance. Landing actions: move the Node service and Postgres to a domestic cloud, object storage to OSS/COS via the adapter, default model routing flips to registered domestic models (benchmark parity already known), foreign models retained for internal R&D only, WeChat/Alipay payment integration.

**Consequences**

Validation speed is not taxed by landing-stage compliance. The cost is accepted consciously: mainland reachability of CF-hosted pages is a recorded variable during the pilot (mitigated by prechecks), and the landing migration is kept cheap only if the portability discipline holds — adapter violations are review-blocking.
