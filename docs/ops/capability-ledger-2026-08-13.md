# V3.1 能力账本（Capability Ledger）

> **自 2026-08-13 起，本账本是唯一工作队列权威**（用户拍板，承接
> `docs/reviews/v31-batch-retrospective-2026-08-13.md` 的能力驱动改约）。
> `docs/tickets/v3.1/` 的票列表自此**不再是 backlog**——票只作为能力路径上的差距记账。
> 状态四态：**可用**（真浏览器走查绿）／**降级可用**（部分走通或仅 fixture 档验证）／
> **不可用**（走查确认死路或核心断裂）／**未走查**（只有 e2e/单测背书，从未被人走过——
> 诚实态，不得写成可用）。
> 更新纪律：每条能力 lane 收敛完成（旅程 spec 无掩码进门＋required CI 绿＋主控走查留痕）
> 后更新本表；不按票关闭更新。

## 0. 现状快照（2026-08-13，据现有证据的初判，待 §3 盘点确证）

锚树 `main@ebb68509`。17 条能力：可用 1、降级可用 3、不可用/疑不可用 4、未走查 9。
**「未走查」占一半以上——这就是「票面完成度」与「真实可用度」脱节的量化形态。**

## 1. 能力清单（商家视角）

| # | 能力（商家可以…） | 规格锚 | 旅程 spec | 状态（初判） | 差距票（open/partial/red） |
|---|---|---|---|---|---|
| C1 | 零素材首访拿到第一条成品（不撞死路、不被劝退） | §37.4-A＋retro R1 | `v31-zero-source-image-text-first-visit`（无 seed）＋`uiux-creation-loop`＋`dashboard-home-mount` | **修复中**（08-13 走查确认死路→V31-73/74/75 已合入；remix 红未清、门未升格） | V31-76、V31-77 |
| C2 | 免费自由创作（模糊输入→通用文案→发布交接） | §37.4-A | `v31-day0-free-creation-journey` | **降级可用**（fixture 档 e2e＋dev 走查绿；live 生成链未走） | —（余 required CI 核销） |
| C3 | Level 1 纯 copy 免确认直达（报价常显、余额不足双出口） | §37.4-B | `v31-level1-copy-journey` | **未走查** | — |
| C4 | 定制图文全链（检索→只问一个问题→Living Plan→确认→逐页生成→交付） | §37.4-C | `v31-living-plan-journey` | **疑不可用**（08-12 门诊断 V31-28 簇 4 红：ask-merchant 卡不出现；revise 卡死票在案） | V31-28（余 CI）、V31-56、V31-38、V31-40 |
| C5 | 视频付费执行（时长/积分透明、中断恢复、部分失败不吞钱） | §37.4-D | `v31-video-paid-execution-journey` | **疑不可用→候选修复**（V31-63 successor admission 恒死已修入候选，待 CI） | V31-63（余 CI）、V31-36、V31-37（收尾） |
| C6 | 计费可信（报价=扣分、失败退回、不重复扣、余额对得上账） | §37.4-B/E＋§43 硬门①③ | `v31-context-fence-journey`＋结算链单测 | **未知/疑有洞**（dev 库积分 100→0 疑预留泄漏未取证；prepare 死信/直写绕计费票在案） | V31-41（partial）、V31-45、V31-59、V31-55（partially-fixed）、V31-31、泄漏取证（清红队列④，未开票） |
| C7 | 素材授权与撤权（撤权后 fail closed、可换素材、不重复扣费） | §37.4-F | `v31-rights-revocation-journey` | **未走查**（V31-58 已定性为 spec 断错，产品面据信正确——但正因如此更需人走一遍） | — |
| C8 | 生成中途改要求（steering：改两页其余不动；加页进 replan+requote） | §37.4-G | `v31-mid-run-steering-journey` | **疑不可用**（Wave-4 浏览器实证证伪 AC1，红在前置步骤） | V31-27（降级裁决在案） |
| C9 | 中断/恢复（关标签页回来不丢、过期退分、重复恢复幂等） | §37.4-H＋§43 门③④ | `v31-interrupt-resume-journey` | **未走查**（fixture 推不动时钟=e2e 证据弱，V31-57） | — |
| C10 | Thread 连续创作（交付后继续同一会话产生新 Work、刷新不丢上下文） | §37.4-I | `v31-thread-root-workbench` | **未走查** | — |
| C11 | 记忆注入透明（看注入清单、追溯来源、撤销后不再注入） | §37.4-B2 | `v31-memory-injection-b2-journey` | **降级可用**（AC3 浏览器绿；AC4 vault 删源为证据债） | V31-18（AC4） |
| C12 | 发布交接与自报（交付→手机交接→次日追问→一键自报落 OutcomeEvidence） | §37.4-K | `v31-publish-handoff-selfreport` | **未走查**（V31-54 seed 掩码的发源地，e2e 绿证不可信） | — |
| C13 | 目标与主动建议（MarketingGoal＋evidence 门控的 proactive） | §37.4 goal/proactive | `v31-goal-proactive-idle` | **未走查** | — |
| C14 | 运营控制面（Release/canary/rollback/kill switch，商家侧无感） | §37.4-J | `v31-ops-console-release-journey` | **未走查**（closeout report 记有独立红） | — |
| C15 | Admin 后台治理（敏感词、角色、运维健康） | admin 整备波 9 spec | admin 系列 spec | **可用**（08-06/07 波 40 票全关＋换装复核整改；余 CI-only 告警一条） | V31-71、V31-44 |
| C16 | 成品原位生长（Artifact 流式落位、stable ID、无重复对象） | §37.4 artifact | `v31-artifact-growth-journey` | **降级可用**（V31-62 done 带同 SHA CI 绿证；未并入人走旅程） | — |
| C17 | 部分交付续跑（partial delivery 后 assisted 续跑不重扣） | V31-16 范围 | `v31-partial-resume-assisted-journey` | **未走查** | — |

**全局性核销**：大量票状态为 evidence-debt / release-verification-pending（V31-01…25 底座与近期修复），
统一由清红队列①（候选 PR＋同 SHA `Core quality / required` 绿）核销，不逐条列入差距票。

## 2. 仪器与平台（enabler，不是能力但排队优先于能力）

- **仪器（门与测试可信度）**：V31-77（门升格，兼 C1）、V31-29（AC6 required 实跑）、V31-64／V31-70／V31-72（门存活与 CI-only 红，余 CI）、V31-30、V31-39、V31-43、V31-48、V31-49（62 spec 不在门内的治理）、V31-66、V31-67。
- **平台稳定性**：V31-50（SSR 无 PG 时杀进程——影响一切能力的走查环境，盘点前建议先修）、V31-69（bundle，余 CI）、V31-46、V31-33（AC4 残项）、V31-32。

## 3. Parked（不在任何能力路径上，不进工作队列）

- V31-35：已废止（2026-08-11 拍板）。
- V31-42：不可达分支，随 V31-03 晋升决策一并处理（票面自建议）。
- V31-32／V31-46／V31-33 残项：平台卫生，无商家可感知路径；某条能力 lane 触及其文件时顺手收，否则不动。

## 4. 盘点计划（第二步，只定性不修）

每条「未走查/疑不可用」能力一次真实走查：fixture 档真浏览器走全程；C5／C6 加
`dev:all` 真链路抽查（计费与生成是两处 fixture 掩码重灾区）。产出=每条能力的
四态定性＋死点截图/网络证据，回写本表 §1。预估一天。**盘点期间冻结令（CURRENT §3a）
继续有效，途中发现的问题只记账不修。**

## 5. 收敛顺序（第三步，按商家价值，一条到门绿再下一条）

C1（在途）→ C2/C3（免费线）→ C6（钱）→ C4（付费图文）→ C5（视频）→ C7 → C9/C10 →
C12 → C8 → C11 → C13 → C14 → C17（C15/C16 已达标线，只随 CI 核销）。
每条 lane 的完成判据：旅程 spec 无掩码进必跑门＋required CI 绿＋主控真浏览器走查留痕回写本表。
