# 文档一致性全面复核 — 2026-07-15

> **SUPERSEDED for live product status (2026-07-22)**
> 当前一致性入口：[`doc-consistency-review-2026-07-22.md`](./doc-consistency-review-2026-07-22.md)。本文及其 2026-07-17 接棒报告均为历史快照。
> **北极星计数 / D01 测量**以 `docs/evidence/contentpackage/README.md` 与 `CONTEXT.md` Language 为准（**count = 1**，`real-run-0001`）。  
> 下文矩阵与结论中的「链路数仍为 0 / ContentPackage 未落地 / 生产代码 0 命中」是 **2026-07-15 冻结快照**，正文不改写原始证据，但**不得再当活现状**。  
> 历史基线补充：ContentPackage 代码已落地；Pro Studio 两线口径以 ADR-0012 + rev2 为准。

> 复核方式：`grill-with-docs`（以 `/grilling` + `/domain-modeling` 的事实核验、权威顺序与领域语言规则执行）。
>
> 复核基线：当时 `HEAD` `233327e`（其前置文档落地提交为 `81243c2` / `812c61a`）。本轮覆盖 ContentPackage 规格、22 张执行票、两套决策票据清单、当时代码/测试，以及旧 P0/P1/UIUX 快照。

## 一、权威顺序（2026-07-15 当日快照；入口已迁走）

1. 当时 `HEAD` 与当时代码/测试事实。
2. [`CONTEXT.md`](../../CONTEXT.md)：产品术语、完成定义、一级导航与当前权威规则（**活计数以 Language + evidence 为准**）。
3. [`07-decision-log.md`](./stage-diagnosis-2026-07-14/07-decision-log.md)：2026-07-14 用户已批准的 D01–D18 决策覆盖层。
4. [`ADR-0011`](../adr/0011-contentpackage-sole-content-aggregate.md) 与 [`ADR-0010`](../adr/0010-uiux-upgrade-path-b-and-streaming-verdict.md)：ContentPackage 成品事实源与 UIUX Path B 的架构约束。
5. [`ContentPackage 实施规格`](../specs/contentpackage-productization-spec.md)：成品聚合工程落地口径。
6. [`ContentPackage 实施地图与机器清单`](../../.scratch/contentpackage-productization/MAP.md)：票图与关票流程（**计数现值见 evidence register**）。
7. [`UIUX 票据收口记录`](../../.scratch/uiux-upgrade-b/MAP.md)：旧 Path B 执行集的关闭/取代结果。

旧诊断、对账、规划和截图报告均是证据快照，不得覆盖以上当前口径；它们保留原始证据，但必须以历史快照边界阅读。

## 二、决策与实现状态矩阵（as-of 2026-07-15；计数已过期）

| 决策 | 决策口径 | 2026-07-15 实现/证据状态（冻结） |
| --- | --- | --- |
| D01 | P1 完成必须包含一条真实 provider 端到端商家链路并留证 | **as-of 07-15**：未完成；链路数 0。**现值**：count=1（见 evidence register）；P1 功能完成仍未宣称 |
| D02 | UIUX 评分冻结 6.50，不再以追分代替产品化 | 已生效；评分不是能力完成证明 |
| D03 | 北极星为真实跑通链路数 | 指标决策有效；**拍板时值=0；现值=1**（evidence register） |
| D04 | 评审两轮熔断 | 已写入决策日志与票据护栏 |
| D05–D07 | ContentPackage 唯一成品事实源；旧三套只迁移只读；Work/Job/Asset 退出商家一级导航 | 已批准并固化为 ADR-0011；生产代码尚未完成结构性迁移 |
| D08 | 第一条真实链路、真实素材进媒体；LLM 三模板先行落地 | 三模板已落地；真实媒体/真实商家链路仍未形成完成证据 |
| D09 | 事实收敛，桌面与手机使用同一产品对象与状态机 | 依赖 ContentPackage，尚未完成 |
| D10 | 抖音只诚实标注未接入；BYOK 接真实 | 当前生产装配仍是 `RecordedDouyinAdapter` 与 `RecordedByokExecutionAdapter`，因此实现未完成 |
| D11–D12 | 管理员可视化配置中心与标准 SaaS 管理后台，含配置持久层前置 | 已批准/待开发；现有后台部分页面仍为只读或骨架，持久配置层未完成 |
| D13–D17 | 亮色偏暖、三类状态、简单费用提示、示例独立入口、移动轻编辑/结果决策 | 已作为设计口径记录；不等于生产能力已完成 |
| D18 | 遗留小项最低优先级，随手/攒批 | 已批准，不能反向占用产品主战场 |
| ContentPackage 22 票 | 票 01 为合同 gate；当前 01–22 全部 open | 规格与执行映射已落盘；open 不等于已实现，需逐票留证 |

## 三、本轮发现并已修正的冲突

- `CONTEXT.md` 现明确 ContentPackage 规格和 `.scratch/contentpackage-productization/decision-ticket-map.json` 的执行权威边界；open 票据不再被误读为实现证明。
- 复核报告基线从旧的 `000f8c8` 更新到当前 `233327e`，纳入 `81243c2` / `812c61a` 新增的规格、22 张票和双清单 guard。
- P0 数据模型合同、P0 页面蓝图、P1 recorded 实施地图和 P1 证据包补充历史快照边界；原始证据不改写，后续 ContentPackage 结构性迁移由当前地图承接。
- 模型供应地图中 OpenRouter/fal.ai 的早期比较建议标为研究快照，并明确已被后续 Direct-first 锁定票覆盖，避免候选口径复活成当前主通道。
- ADR-0011、ContentPackage 规格、实施地图和票 01 统一为“十条状态契约、12 个状态字面量”；供应商 URL 过期是规则而非第 13 个状态。
- 阶段决策日志将落盘待办的旧“六工作流 E1–E6”改为 E1–E7 建设面中的 E1–E6 依赖，和 ADR-0011 / spec 对齐。
- ADR-0011 与最新票据地图补充区分“开发并行”和“发布顺序”：E7/票 22 可按依赖并行取证，E7 → E6 仅是一次面世前的闸序。

## 四、仍然未完成的产品化事实

- 生产代码中尚无 `ContentPackage` 实现；全仓生产代码搜索仍为 0 命中。
- `apps/core/src/main.ts` 仍装配 `RecordedByokExecutionAdapter` 与 `RecordedDouyinAdapter`；不能把“配置项存在”写成“真实供应商已接入”。
- 模型目录与配置仍有进程内 `Map`/环境变量驱动，管理员配置持久层和运行时生效机制尚未完成。
- ContentPackage 22 张票当前全部 open，票 01 是关闭 gate；规格、票据和 guard 的落盘不代表结构性迁移已完成。
- `pnpm check`、fixture/recorded 测试、UIUX 6.50 EXIT 或票据关闭，都不能把 D01 的真实跑通链路数从 0 改为 1。

## 五、历史文档阅读边界

- `docs/reviews/stage-diagnosis-2026-07-14/` 的四路诊断与融合报告固定在旧提交 `22a9d4e`，用于保留当时证据；当前决策以 `07-decision-log.md` 与本报告为准。
- `docs/reviews/historical-review-implementation-reconciliation-2026-07-14.md`、`references-docs-uiux-unfinished-upgrade-reconciliation-2026-07-14.md`、`p1-document-consistency-review-2026-07-11.md` 与 `p1-revision-plan-2026-07-11.md` 是历史对账/计划快照。
- `docs/evidence/p1-implementation-evidence-2026-07-11.md` 的 “implemented-recorded” 仅表示 recorded 实现留证；D01 仍要求真实 provider。
- `references/product/reports/p0-data-model-api-contract.md`、`references/product/reports/p0-product-ia-workflow-blueprint.md` 是 P0 历史合同/蓝图，不能覆盖 ContentPackage 成品事实源和四项商家一级导航。
- `.scratch/p1-implementation/MAP.md` 的“无 frontier”只描述 2026-07-11 recorded 基线；`.scratch/model-supply-wayfinding/map.md` 的早期聚合建议只作比较证据，当前 LLM 口径以 Direct-first 锁定票为准。
- `docs/evidence/uiux-upgrade-b/screen-benchmark-2026-07-14/exit-report.md` 只证明 R2 视觉 EXIT 6.50，不证明产品化或 P1 完成。
- `.scratch/creatok-uiux-wayfinding/map.md` 已标记 superseded；其中六项导航是 2026-07-11 的历史决策输入，不得覆盖 D07。

## 六、验证结果

- `git diff --check`：通过。
- 本轮改动文档的本地 Markdown 链接检查：通过，无 broken link。
- `node scripts/uiux/decision-ticket-guard.mjs`：通过（旧 UIUX 清单 + ContentPackage 清单）。
- `node --test scripts/uiux/decision-ticket-guard.test.mjs`：通过（10 tests）。
- `pnpm check`：通过（contracts TypeScript、web Biome、core TypeScript、secret scan、decision guard）。

结论：当前“文档权威顺序、术语、D05–D07 架构决策、ContentPackage 规格/票据映射、D11–D12 状态、历史快照边界”已统一；产品实现仍诚实停留在“真实跑通链路数 0、ContentPackage 未落地、BYOK/抖音仍为 recorded、管理员配置中心待开发、22 张产品化票据均待实现/留证”。
