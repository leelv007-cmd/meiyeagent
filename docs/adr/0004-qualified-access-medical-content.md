# Qualified Access for Medical Aesthetic Content (Light Mode)

Status: accepted (2026-07-07, refines ADR-0003)

> **2026-07-11 一致性修订**：本 ADR 的“轻量”边界继续扩大为创作开放：图文、模板、图片生成/编辑和草稿不因医疗/合规提示被阻塞。线上 Preflight、责任确认与平台规则只在发布或公开交付阶段使用；专门法务团队在功能完整后终审生产规则与开关默认值。行为红线仍只针对明显不安全、欺骗、未授权或绕过平台的请求。

The review panel initially recommended withdrawing medical/aesthetic merchants from the P0 launch scope. The user overruled: medical aesthetics is a legitimately operating industry with normal marketing needs; platforms already run merchant accreditation, AI patrol, and community governance (e.g. Xiaohongshu certified professional accounts may publish category content); this product is a tool and should apply structured screening rather than category abandonment.

P0 therefore serves medical/aesthetic merchants under a qualification-gated, light-touch model:

1. **Offline access gate**: business development collects and verifies the medical institution practice license and platform certification status (plus the medical-ad review certificate for merchants with paid-ad needs) into a workspace qualification profile. Unqualified merchants are not onboarded. The gate lives in the sales process, not in per-content product checks.
2. **Online preflight stays reminder-only**: ADR-0003's create-freely-then-preflight flow is preserved. When the qualification profile is incomplete the preflight shows a strong warning, but there is no per-item confirmation gating. The system logs that reminders were displayed (zero-interaction evidence).
3. **Behavioral hard stops unchanged**: fabricated qualifications, unauthorized customer cases, falsifying or bypassing mandatory provider/platform provenance or publication labels, platform-review bypass, guaranteed outcomes/efficacy, prescription drugs and unapproved devices. Turning off an optional product-side label switch is not itself a hard stop.
4. **Before/after material**: no prebuilt marketing template; usable only when the asset carries a customer-consent flag set at upload time (faces + medical context are doubly sensitive personal information).
5. **Onboarding-assist boundary**: assist staff coach tool usage but do not write or rewrite medical claims, keeping the product on the tool side of the "commissioned production" line.

**Consequences**

The pilot re-includes 1-2 platform-certified medical merchants as probes (reversing the non-medical-only sampling in 12-merchant-validation-plan). Week-0 must live-test category publishing permissions with a real certified merchant account instead of trusting secondhand reports of platform bans. Compliance effort shifts from in-product gating machinery to a sales-stage SOP plus a qualification profile object.
