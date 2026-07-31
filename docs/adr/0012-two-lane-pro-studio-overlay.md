# ADR-0012: Composer 与 Pro Studio 两线产品边界

Status: **superseded** (2026-08-01 by **D-170** + `docs/specs/pro-studio-retirement-spec-2026-08-01.md`)

> **SUPERSEDED（D-170）**：Pro Studio 全量退役（RETIRE）。本文不再是产品权威；定制创作 + 自由创作薄路径双主线与 ContentPackage 唯一写口继续有效。历史正文保留追溯。
>
> 2026-07-24 修订（per D-103/D-110）：两条产品主线现为**定制创作＋自由创作**（D-103）；Pro Studio 降为自由创作下属的高级画布/交互面，不构成独立/第三条产品主线，并按 D-110 ③「移出首发投入焦点」——代码与 entitlement 付费墙保留不删，验证后按 D-103 收编。本文「Pro Studio 工程可以并行开发」及独立 Release boundary 口径不再作为首发投入依据，实施以 D-103/D-110 为准。
>
> D-127 补充（2026-07-24）：**Pro Studio 全部功能冻结，只保留入口**——（该 FREEZE 口径已由 D-170 RETIRE 取代）。

## Decision

P1 主线保留 Composer 日常轻编辑：官方/工作区模板、文字与图片基础调整、裁切/顺序、预览、保存版本、导出和 AI 图片动作。无限画布、高阶精修、TTS+音效和在线画布 Agent 进入独立的 Pro Studio workspace add-on。Pro Studio 工程可以并行开发，但不得成为默认一级导航，也不得通过第二套内容事实绕开 ContentPackage；`AdvancedCanvasProject + revision` 是独立的服务器规范图结构，只有显式 adoption 才回写 ContentPackage。两线共享 Product Core 合同、Postgres、wiring 或主 Web 时必须声明文件 owner、合并顺序和冲突处理，不把“客群/DoD/发布面分离”误读成“资源零碰撞”。

## Release boundary

Pro Studio 的工程并行不等于公开销售。外部交付至少需要：N2 恢复能力与 safe-fetch 依赖就绪、workspace/project bootstrap 与真实 host/origin 合同冻结、adoption 幂等/顺序契约通过、TTS/SFX 与 Agent 七动词的合约测试通过，以及至少三次面向授权工作区教练或中高阶商户的真实走通并证明可交付/可收费。P1 的真实跑通 Gate 仍按 ContentPackage 规格执行；Polotno 的冻结→Composer 吸收→五门槛退役是主线闸，不是 Pro Studio 销售闸。

## Consequences

旧文档中“P1 自由画布”“Pro Studio 仅 evidence-triggered”“Vozeb runtime 直接复制=0”“20 端点薄适配”“audio.generate”等表述均需按本 ADR 与 2026-07-16 rev2 规格解释：Vozeb 后端/业务 runtime 仍不得直接复制，授权的 canvas/render/retouch core 可在 A2/A3 清单下复用；Audio 使用 `audio.speech` 与 `audio.sfx`；Agent 首发固定七个动词。未冻结的真实 host、SSO audience、seed 内容/来源、N2 和商业权益动作级 carve-out 是实施前门禁，不得由代理临场推断。
