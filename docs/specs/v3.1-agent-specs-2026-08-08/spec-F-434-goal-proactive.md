# V3.1-F 目标与主动性：MarketingGoal（提议式创建）+ Proactive Opportunity（evidence 门控）+ 学习闭环

> **已发布**：https://github.com/leelv007-cmd/meiyeweb-agent/issues/434（label: ready-for-agent）；本文为票面本地快照。
> 决策权威：V3.1 §11、§25、§26.2、§3 Level 3；决策记录附录 B（U2 阈值、U7）；硬约束附录 A。
> 依赖：#432（Memory/Evidence）、#433（交付与自报旅程，Campaign 派生 Work 的确认粒度合同在 #431）。

## Problem Statement

商家真正说的是「最近新客少」「想把老板 IP 做起来」——这些上位目标横跨多次创作，但系统里没有承载它的对象；Agent 也不会主动提出「今天值得做什么」，商家必须每次自己想选题；发布结果与下一次判断之间没有闭环。

## Solution

MarketingGoal 成为一等对象但**不建 CRUD 管理面**：只在对话中由 Agent 提议创建、或提议把最近内容归组到目标（用户确认才关联）；Proactive 管道（Signals→确定性过滤→Agent 排序→OpportunityCandidate→商家提案）以 evidence 覆盖率为准入门；OutcomeEvidence→Memory→下一次提案的学习闭环走显式确认路径。

## User Stories

1. As a 美业商家, I want 我说「8 月想多推头皮护理」时 Agent 提议建立一个目标并把后续创作挂上去, so that 多次宣发有连续性而我不用管理任何「目标列表」。
2. As a 美业商家, I want Agent 提议「是否把最近几次内容归到夏季新客目标？」且只有我确认才关联, so that 归组不自作主张。
3. As a 美业商家, I want 目标有方向（曝光/咨询/预约/团购/IP/复购）、时间窗与优先级，进度以已交付 Work 与 evidence 呈现, so that 我知道目标推进到哪了。
4. As a 美业商家, I want Idle 首屏看到当前最重要目标与 Agent 主动建议（每条建议都带「为什么现在」的依据）, so that 打开工作台就知道今天值得做什么。
5. As a 美业商家, I want 主动建议只在我的经营证据足够时出现（evidence 覆盖率达标才开启）, so that 建议不是拍脑袋打扰。
6. As a 美业商家, I want 建议可接受/忽略/过期，接受后进入正常 Thread→Plan→Work 流程且绝不自动产生付费副作用, so that 主动性永远止步于提案。
7. As a 美业商家, I want Campaign 目标（Level 3）分解为按周排期的多个 Work，每个含付费媒体的 Work 单独确认（U7）, so that 长期计划不等于长期扣费授权。
8. As a Core 服务, I want Signal 来源限于真实拥有的数据（未发布时长/活动临近/素材积累/项目新增/Goal 未推进/历史表现/商家提供热点），不假设拥有的外部数据不得使用, so that 建议可解释可审计。
9. As a Core 服务, I want OpportunityCandidate 是可过期 derived record（proposed/accepted/dismissed/expired）而非核心聚合, so that 主动性子系统轻量可退。
10. As a Core 服务, I want 检测管道先走廉价确定性过滤再进 Agent 相关性排序（无后台无限 LLM loop）, so that 主动性成本有界。
11. As a Core 服务, I want 学习闭环 Outcome→Episodic（投影）→Procedural 提案走显式确认（本期无自动 pattern mining）, so that 「越用越懂」不以越权学习为代价。
12. As a 运维, I want marketing_goal_v1 / proactive_opportunity_v1 flag 与 disable_proactive_agent kill switch, so that 主动性可独立关停。

## Implementation Decisions

- Goal 合同（objective/statement/horizon/priority/status/evidenceRefs/revision）见 V3.1 §11；Goal 不直接拥有执行拓扑；不从历史数据自动猜 Goal。
- Goal status 迁移（active→paused/completed/abandoned）同样只走提议→确认路径（无管理页）：由 Agent 在对话中提议、商家确认后落新 revision；并发按 revision OCC，冲突返回当前 revision。**注**：此条为对 V3.1 §11 状态迁移空白的补充裁决（票面留痕，非票面私货），如后续权威修订冲突以权威为准。
- Goal 产品面只有两条创建路径（对话提议/归组确认），无独立管理页；Thread.activeGoalIds 挂载。
- Proactive 准入门阈值待样本形成后定（U2 遗留参数），门本身先实现为可配置；阈值 unset 时该门默认关闭（不出建议），coverage 只作观测；基线形成前运营可用既有 `proactive_opportunity_v1` flag 按 workspace allowlist 临时开启（试点/演示，U13，不新增机制）；分母、观察窗与最小样本随 U2 基线形成后另拍。dismiss 率与 stale opportunity rate 进观测指标。
- candidate 本体=derived projection（不建聚合表，遵 V3.1 §33.1）；商家 accept/dismiss 落一张最小 append-only 决定记录（candidateId + resourceId + actorId + decision + decidedAt），accept 幂等键=candidateId（接受一次只创建一个 Thread turn）；projection=detector 输出叠加最新决定；expiry 由 detector 的 expiresAt 计算、不落状态。此为对 §33.1「不建 OpportunityCandidate 表」的窄化解读（禁的是候选聚合表，不含决定日志），非 supersede。
- 评价事件携带版本上下文（contentPackage/work/goal/skill/capability/recipe/release/scene，V3.1 §26.2）。
- Goal 进度呈现消费 #432 evidence 与 #433 交付事实，不新建统计真相。

## Testing Decisions

- 主 seam：P1 action + 事件流边界——Goal 提议/确认/归组、candidate 生命周期、evidence 门控开关、接受后进入正常流程且零付费副作用。
- Playwright journey：Idle 建议行（evidence 达标商家可见、未达标不可见）、接受建议→Thread turn→Plan、Campaign 派生第二个付费 Work 单独确认。
- 退出门（V3.1 §35 批次 6 前半）：每条主动建议都有 evidence；建议不自动产生付费副作用；accept 后进入正常 Thread/Plan/Work。

## Out of Scope

pattern mining / industry skill learning（移出本期）；percentage 放量（V3.1-G 触发点）；旧 UI 退役（V3.1-I）。

## Further Notes

Goal 与 Mastra Goals 的 budget 同构参照（触顶=paused 可续）见 V3.1 附录 C 对照表；预算耗尽=paused 可续语义沿 §21.2/A6 执行。
