# 项目全局文档一致性复核（2026-07-18）

> **状态：历史快照。** 本报告固定于基线 `4d2a63c`，保留当时的发现、计数和处置证据；当前一致性入口是 [`doc-consistency-review-2026-07-22.md`](./doc-consistency-review-2026-07-22.md)，当前实现状态以最新代码、测试、实现总账和本报告为准。

- 触发：用户指令「启用 Agent Team 做项目全局文档一致性复核，偏移/冲突以最新的提交为准，明显过期的文档可退役」
- 方法：8 路域审计 agent（只读）+ 对抗核验（retire/escalate 级逐条）→ 主会话单点执笔应用；ADR 域因输出超限拆 3 段在 Opus 重跑（见 §6）
- 基线 commit：`4d2a63c`（D-034~D-038 落盘）；本报告的全部修正在其后应用
- 权威链（用户 2026-07-18 确认）：合并权威版（D-001~D-038）→ CONTEXT.md → Wave 1 执行合同（仓库外，只核引用）→ ADR 0001-0012 → PRODUCT/DESIGN/.impeccable → 其余
- 退役双档制（用户确认）：正式退役 = 移 archive + 横幅 + 修引用；轻退役 = 原地横幅；删除只报不执行
- 范围（用户确认）：活文档全扫；mkfast 只扫 markdown 层；.scratch、docs/_private 排除；docs/evidence 只查链接；references/analysis 正文永不改、只加横幅

## 1. 总量

首轮 8 域（audit:adr 段失败另跑）共 44 条 findings：mechanical 24 / retire-light 18 / retire-formal 1 / escalate 1。重级 20 条全部过对抗核验：confirmed 11、adjusted 9、refuted 0（adjusted 按核验员修正版应用）。处置：**42 条已应用，1 条合并（F36≡F15），1 条 escalate 报用户**。

## 2. 正式退役（1 份）

**`合集-v1.5-P0决策定稿.md`** —— 在 2026-07-11 旧横幅后追加五点式正式退役横幅（保8缓4坐标废止、场景卡/L0-L4/3选1 取代关系、修订13 D3/D4 唯一原始记录地位、08 章 Mastra 快照过期、09 合规章临时口径）。**执行偏离说明：按双档制本应移入 docs/archive/，实际原地退役**——ADR-0008 明示「不复述、以本文修订 13 为唯一原始记录」，且多份不可修改的历史调研文档引用本文；迁移会永久打断不可修改文件中的引用，双层横幅已足以消除权威信号。独有内容去向：修订13 D3/D4 与修订9 四项否决 = 原地保留作追溯档案；07 章场景包/模板/敏感词表 = WOZ 期按 D-033 ②段行业资产池需要迁移；09 合规章 = escalate（§5）。

## 3. 轻退役横幅（18 处，原地不动正文）

| 文件 | 要点 |
|---|---|
| references/benchmark/notes/our-p0-dimensions.md | 07-08 批注坐标已废，指向五类入口合同 |
| references/benchmark/reports/p0-benchmark-matrix.md | 同上 + 首页形态改指 D-029/D-031 |
| references/product/reports/p0-product-ia-workflow-blueprint.md | 保8坐标废止 + 09 章 AIGC 红线口径修正 |
| references/prototypes/p0-product-blueprint/README.md | 过滤基准切合并权威版 |
| references/analysis/hitl-research-2026-07-17/README.md | pg-boss/Langfuse/单波口径被 D-034/D-036/D-026 取代 |
| references/analysis/hitl-research-2026-07-17/02-component-fit-matrix.md | 三项处置结论被 D-034/D-036/D-023 取代 |
| references/analysis/plan-review-2026-07-07/06-…addendum-2026-07-17.md | §1/§5 被 D-034~D-038 部分取代 |
| references/analysis/beauty-marketing-validation-2026-07-17/VALIDATION-PLAYBOOK.md | 决策延伸提示（非退役）：D-027/028/032/033 直接影响执行 |
| docs/specs/beauty-content-agent-p0-spec.md | 保8缓4/3选1/线索台账三处口径补注 |
| docs/specs/beauty-content-agent-p1-spec.md | 前台结构被权威版接管，白名单四约束继续有效 |
| docs/specs/contentpackage-productization-spec.md | 3选1→D-023，聚合/发布闸机制不变 |
| docs/reviews/uiux-productization-gap-report-2026-07-13.md | 横幅重写：权威指针 + 3选1/表单化/generateObject 三项阅读提示 |
| docs/reviews/stage-diagnosis-2026-07-14/06-backlog-admin-control-plane.md | §2.4 现状断言过期（admin-config 已存在），范围按 D-037 重裁 |
| mkfast-template-main/tests/e2e/TEST-CATALOG.md | 3选1 作为产品验收口径已废，存量 spec 保留为回归保护 |
| mkfast-template-main/docs/db.md | D1/SQLite 模板原文 → 实际 Postgres/Hyperdrive（ADR-0006） |
| mkfast-template-main/docs/auth.md | provider:'sqlite'/env.DB → provider:'pg'/HYPERDRIVE |
| mkfast-template-main/docs/ai.md | /ai playground 已退役（404），AI 在 Core 侧 |
| references/analysis/ 00/01/05/06、02×2/03/07/10/13、09/11、15 共 13 份 | 链接审计批注：旧工作区基建/repos 镜像/prototypes 产物/templates 未迁入，正文结论不受影响 |

## 4. 机械修正（已应用，摘要）

- **CONTEXT.md ×4**：北极星双命名口径注记（链路数≠宣发闭环数）；新增 MarketingPackage 术语条目（命名别名非第二聚合）；人工线索补 D-030 chips+三级来源口径；内容任务收件箱=异步收件箱同面注记。
- **DESIGN.md**：场景 chips「预填」→「场景上下文切换」（D-029/D-031）。
- **权威文档自身 ×7**：D-016/D-032/Implementation Boundary 三处补 D-034 交叉引用；D-027 影响栏与 D-032 ③补「与 DBOS PoC 并列同批」；已拍板转正段「10 路对抗验证」修正为「9 路（r08 三次容量失败）」。
- **.wayfinder/map-creatok-product-research.md**：Primary planning doc 指针与 ADR 范围更新。
- **mkfast AGENTS.md / CLAUDE.md（逐字同步）**：D1→托管 Postgres via Hyperdrive、迁移命令注释、content/ 行、Bindings 段 DB→HYPERDRIVE；docs/env.md 绑定示例、docs/payment.md「D1 workflow」×2。
- **链接修正**：uiux gap report 的 creatok 审计路径改指 .scratch 实际位置；harness xcheck/ 新增 README（镜像不入库说明 + r06 路径笔误勘误）；references/analysis/README.md 补 harness-research 索引条目；validation README 决策权威范围改 D-001~D-038。

## 5. Escalate：09 合规章权威真空（待用户拍板）

合集 09 章的 17 条我方法定义务清单（法规依据+三档生效时点）、滥用拦截 3/5 细则、Gate 0 时点表、分层验收指标表，退役后无现行活文档等价承载（p0-spec 已挂历史横幅；Wave 1 执行合同与 VALIDATION-PLAYBOOK 零处承载）。核验员实证：Gate 0 三件套/数据卫生/医美 SOP/AIGC 口径已有活载体；真空集中在清单整体+滥用细则+投诉举报+DPA 六项+未成年人+PIA+用户协议标识条款+分层验收指标。三选一：**A** 并入 Week 0 预登记文档；**B** 新建 `docs/compliance/obligations-register.md` 为现行权威（迁入须三处校正：AIGC 口径按 ADR-0008 07-11 修订节、Preflight 触发点收窄到发布/公开交付、医美挂 D-025 且「P0 落点」列标历史坐标）；**C** CONTEXT.md 声明 09 章为例外权威。核验员与主会话一致建议 **B（A 并行）**。拍板前临时口径 = 合集 line 7 的 2026-07-11 横幅。

**拍板（2026-07-18）：用户采纳 A** —— 09 章义务清单并入 Wave 1 Week 0 预登记文档（三处校正随迁执行），转正为权威文档 **D-039**；不新建 docs/compliance/ 独立权威。

## 6. ADR 域（补录）

首轮 audit:adr 输出超 16k token 上限失败；拆 0001-0004 / 0005-0008 / 0009-0012 三段在 Opus 重跑（子 agent 降级为用户 2026-07-18 拍板的模型分配：主控=会话模型，复核类子 agent=Opus；本段 7 agents 共 386k token，对比首轮 8 域 2.18M）。共 6 条 findings，处置如下：

| ADR | 级别 | 核验 | 处置 |
|---|---|---|---|
| 0003 | retire-light | confirmed | 已加 D-025 修订横幅：医美不再是首发客群现行口径，受监管内容 MODE 机制仍有效 |
| 0004 | retire-light | confirmed | 已加 D-025/D-026 修订横幅：医美探针与首发指标分账，两波进场均非医疗（核验员微修：4–7 家 → 扩至 8–12 家） |
| 0006 | mechanical | - | 已加 D-034 小注：durable_jobs 为决定时机制，DBOS 承载新五段工作流，拓扑不变 |
| 0007 | retire-light | confirmed | 已加 2026-07-17 update：自建 step-runner→DBOS、generateObject deprecated、Mastra 再入收窄到 Editor 场景；AI SDK-first 与 Runtime Port 继续有效 |
| 0010 | mechanical | - | 已在第 2 条末补注：generateObject deprecated，改 ai@7 现行 API，流式钦定不变 |
| 0012 | escalate | **refuted** | 核验员驳回：权威对 Pro Studio 是沉默而非推翻，adoption 回写与 ADR-0011（权威显式保留）一致，不构成待裁定态。**不动文档、不上报** |

0001/0002/0005/0008/0009/0011 六份未报问题（0002 已有 superseded 标注、0008/0011 昨晚修订自洽、其余与权威无冲突）。

## 7. 其他说明

- Open Questions（权威文档第一部分 7 条）与待验证 1-15 完全重合，按用户确认不动原文。
- r08（Dify）交叉验证三次容量失败的事实已在 08 号报告横幅、00 号清单状态行、权威文档已拍板转正段三处统一为「9 路交付」。
- 本轮评审全部改动待用户指令后 commit（基线 `4d2a63c` 之上）。
