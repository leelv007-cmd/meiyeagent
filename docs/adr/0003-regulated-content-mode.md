> ⚠️ **2026-07-07 批注**：被 ADR-0004 细化（资质准入制·轻量版）——总思路"允许创作+发布前核验提醒"保留；新增线下准入筛选前置、线上纯提醒（不逐条门控）、b/a 素材授权标记、陪跑不代写医疗声明内容。

> **2026-07-11 一致性修订**：开放图文工作台的创作、编辑、草稿和模板操作不受本 ADR 的发布核验影响。Preflight 与硬停止只在发布/外部公开交付或明确要求绕过安全红线时生效；本 ADR 不构成开发准入或普通创作阶段门禁。

> **2026-07-17 修订（D-025）**：医疗美容机构不计入默认首发范围，只作为独立研究探针，不混入首发频次/采用率/放行结论；未来仅在资质、受监管内容策略、素材权利、平台账号与发布审查门全部通过后按商家条件启用。本 ADR 的受监管内容 MODE（话题识别、发布前提醒、硬停止）对生美/皮肤管理触及的受监管话题仍有效；正文「P0 expands … to … regulated medical-content merchants」「The product can serve real medical beauty and medical-content operators」按 D-025 收窄，不再作为「医美机构已是首发客群」的现行口径。

# Regulated Content Mode

Status: accepted

P0 expands from non-medical beauty only to beauty, aesthetic, and regulated medical-content merchants by allowing regulated content creation under ADR-0004's qualification-gated light mode. Publish Compliance Preflight is a reminder-and-log step at publication-package handoff, L1 official submission, or another explicit public-delivery action; ordinary Work saves, exports, downloads, drafts, and template operations do not trigger publication review. The product still rejects requests that would facilitate clearly unsafe or deceptive behavior such as fake qualifications, unauthorized customer cases, falsifying or bypassing mandatory provider/platform provenance, platform bypass, prescription or unapproved-device promotion, or guaranteed medical outcomes.

**Consequences**

The product can serve real medical beauty and medical-content operators, but the domain model must distinguish creation from publication. Compliance no longer means “block every medical term”; it means regulated-topic detection, evidence prompts, qualification reminders, platform-specific warnings, reminder logs, and hard stops only for deceptive, unauthorized, prescription/unapproved-device, guaranteed-outcome, or bypass behavior.
