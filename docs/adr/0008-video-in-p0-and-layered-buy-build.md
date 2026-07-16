# ADR-0008: Video Generation in P0 and Layered Buy/Build Boundary

- Status: Accepted (2026-07-08; amended 2026-07-11)
- Decision owners: User (product), assistant (analysis)
- Related: ADR-0005 (phase-gated deployment), ADR-0006 (runtime topology), ADR-0007 (AI SDK first)
- Evidence base: `references/benchmark/ai-native-journey-study-2026-07-08/` — KickArt logged-in probe + official docs, Volcengine AgentKit console probe, `bytedance/agentkit-samples` `ad_video_gen` source deconstruction (3 variants), synthesis reports 02/03.

## 2026-07-11 amendment: dynamic video supply and authoring switches

The model-supply decision now supersedes the fixed Seedance/Jimeng/Kling default: P1 publishes Seedance 2.0, Kling 3.0 latest, Grok latest video, and Veo 3.1 latest through a dynamic catalog, generic provider profiles, and provider-specific async adapters. Video tasks resolve an explicit current/user/workflow/workspace model choice; the product does not recommend a provider brand or silently switch video families. The original buy-model-capability, thin orchestration, durable job, owned asset, and ffmpeg composition boundaries remain accepted.

Later user decisions also supersede D5's non-removable visible AIGC burn-in. Product-brand watermark and product-visible AIGC label remain authoring switches; provider-enforced provenance is recorded as fact, and publishing-platform labels or gates are handled during publishing. This amendment does not add an authoring or development compliance gate.

> **Current catalog clarification (2026-07-12)**: The provider names in the original D1/D2 examples below are decision-time research references, not the current P1 catalog. The current video catalog is Seedance 2.0, Kling latest, Grok latest video, and Veo latest; the current image catalog is GPT Image 2, Nano Banana 2, Nano Banana Pro, and Seedream 5.0 Pro, as locked by the model-supply map and P1 specification.

## Context

The user rejected the first P0 wireframe as "previous-generation SaaS, not AI-native" and raised the question of how to absorb mature scaffolding from ByteDance/Volcengine content-generation products, offering two candidate routes: (1) use their architecture as a reference to improve our own build; (2) dual-track — own framework as base + subscribe to KickArt and white-label it + own vertical content on top. The user then corrected scope: **finished video generation (成片) is a P0 flagship feature**, merging previously deferred video items into P0.

Key evidence:
- KickArt is enterprise-priced (Basic ¥16,800/mo with 600 credits; API access only at Flagship ¥328k/yr; per-video marginal ¥5-14). Its SaaS/API cannot be economically wrapped at our ¥199-599/mo price band (≈46 Growth-tier merchants just to cover the flagship license).
- Our publication and provenance obligations require recording provider/platform signals and owning the optional product-brand watermark and product-visible AIGC-label controls; a black-box vendor output cannot guarantee what was actually applied. This is a delivery/publication concern, not an authoring or development gate.
- KickArt is itself the agent-native successor of ByteDance's multi-page "智能创作云" SaaS — first-party proof of the "multi-page SaaS → agent workbench" evolution we are adopting (see revision #13, D3).
- `ad_video_gen` (3 official variants) provides a complete, locally archived reference implementation of the video pipeline: market brief → AIDA 4-shot storyboard → batch first-frames → eval pick-best → clips → moviepy compose + TOS upload; with `session.state` blackboard, `partial=True` streaming, and CallBackAgent human-language progress hooks.

## Decision

### D1 — Five-layer buy/build boundary

| Layer | Buy/Build | Posture |
|---|---|---|
| 1. Model capability (text/image/video) | **Buy (API)** | Doubao/DeepSeek/Seedream/Seedance or Jimeng/Kling via benchmarked, switchable providers |
| 2. Orchestration (step-runner) | **Build (thin)** | Per ADR-0007; adopt `ad_video_gen` patterns (state blackboard, human-language progress hook, eval pick-best) — patterns only, not the Python/VeADK stack |
| 3. Experience (agent workbench, brief card, candidates, preflight UI) | **Build** | This is the product and the first-glance value anchor; outsourcing it forfeits the product |
| 4. Vertical knowledge (scenario cards, hook script library, beauty-industry compliance rules, store profile, brand voice) | **Build** | The only true moat; no vendor sells it |
| 5. Video composition | **Buy model-side + build thin shell (P0)** | Seedream first-frame + provider clips + own ffmpeg compose worker with switch-controlled product labels and provenance recording |

### D2 — KickArt positioning

Paradigm reference (completed) + **third candidate** in the video technical route (after ① Seedance direct + open-source-derived compose chain, ② Jimeng/Kling API). **No subscription/white-labeling now**: license magnitude (¥328k/yr API ≈ 46 full-price Growth merchants) and compliance control points are decisive; the earlier "capability mismatch" argument was retracted when video entered P0. Reconsider only at ≥50 merchants AND if the self-built chain is falsified.

### D5 — Video-in-P0 engineering package

- Pipeline: AIDA storyboard (in-stream confirmable) → first frames → clips → thin compose shell (ffmpeg concat + BGM/subtitles + optional product-brand watermark/AIGC label switches + provider/platform provenance recording) → TOS/R2 → album/publish package. Publication-platform labels and gates are applied or checked at publication time.
- Pulled into P0: durable async jobs (was deferred; 15s video measured ~18 min end-to-end → submit-and-leave + task center + notification bridge are survival requirements), storage/transcode/label chain, video quota priced per-clip in the "output-quantity" wording.
- Week-1 spike +1 (now six): direct provider call + ffmpeg compose + switch/provenance POC; acceptance = per-clip cost / end-to-end latency / usable-quality rate / switch behavior and provenance-recording feasibility.
- Quality: N→1 candidate eval scored on aesthetics / image quality / compliance (the sample's "consistency" dimension replaced by medical-aesthetics banned-terms screening).
- Scope Lock changes: 保 7/缓 6 → **保 8/缓 4**; video script and durable jobs leave the deferred list. Graphic rendering pipeline stays deferred (not video-related).

### Related UI decisions (recorded in v1.5 revision #13, not re-stated here)

D3 skeleton switch (single agent workbench + 3 light asset pages; conversational shell, structured core; L0-L4 re-containered) and D4 workbench details (scenario chips + expandable shelf; per-medium candidate strategy: copy 3-pick-1 + reroll, video single-shot + free retry).

## Consequences

- Architecture A / Framework B / validation-phase CF + mixed models unchanged. The video compose worker is the primary watch item for the "three split signals" (ADR-0006); the video pipeline is the first heavy pipeline through the step-runner and will be the first real test of ADR-0007's Mastra trigger conditions.
- Unit economics gain a hard new input: per-clip video cost. Quota tiers must wait for spike measurements; refund layering (auto-refund technical failures / free retry ≤2 for dissatisfaction) applies unchanged.
- Volcengine ecosystem (Ark/AgentKit/TOS) is recorded as a China-landing-phase cloud candidate (trigger point still not pre-set, per ADR-0005).
- Not adopted (explicitly): e-commerce genes (product-URL scraping — already a separate research item, batch 100-clip fission, per-shot pro editing as default UI), Python/VeADK runtime, enterprise pricing/packaging.
