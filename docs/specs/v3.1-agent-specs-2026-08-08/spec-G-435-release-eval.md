# V3.1-G 发布与评估设施（开发侧）：Prompt Pack + HarnessRelease 三对象 + Quick Checks/三态 verdict + Observability

> **已发布**：https://github.com/leelv008/meiyeagent/issues/7（label: ready-for-agent）；本文为票面本地快照。原 leelv007-cmd/meiyeweb-agent#435 因账号封禁废弃。
> 决策权威：V3.1 §29、§31、§32；决策记录附录 B（U3/U10/U11/U12）；硬约束附录 A（A14 strict 供给、A7 红线门禁）。
> 依赖：**实现依赖 #1**（Agent 域 release 合同，`packages/contracts` 属主在 A）；**集成验收依赖 #2**（Session Harness 消费 release pin）、**#3**（执行链记录 releaseId）——release 合同/resolver 实现不等 B/C，集成验收才等。运营操作面单列在 V3.1-H。

## Problem Statement

Prompt 注册表 22 键全量冻结：纯文案任务被无关 viral prompt 的供给故障阻塞，运维 pin 成本随位点增长；Prompt/Skill/Tool/Schema/Model Policy 没有统一的版本组合对象，无法回答「这次运行到底用了哪一套」，也无法安全灰度与回滚；行为回归只有昂贵的 LLM 评审，没有零成本行为门。

## Solution

按任务选择 Prompt Pack 子集冻结（strict 校验挪到 release 发布时点）；HarnessRelease 拆为不可变 Artifact（全部 exact bindings + manifestHash + middlewareBindings）/ Lifecycle / Rollout 三对象；per-run 试跑只能选择完整 candidate releaseId；评估先建 L0 合同测试 + L0.5 Quick Checks 零 LLM 行为门 + L1 节点数据集 + gates/thresholds/verdict 三态；全链 Observability 落 trace。

## User Stories

1. As a 平台工程师, I want 每类任务只解析并冻结其 Prompt Pack 子集（copy 任务不依赖 viral key）, so that 无关 prompt 故障不阻塞当前任务。
2. As a 平台工程师, I want 22 个注册 key 全部被 pack 覆盖的构造性测试（含 briefImage/xhsNoteGen），未覆盖 key 使 release 发布失败、不回 builtin 假绿, so that strict 供给纪律不因 pack 化破口。
3. As a 平台工程师, I want strict 校验时点从 boot 挪到 release 发布（boot 只校验当前 production release 可解析），isFallback 降级信号仍经审计管道落库, so that 部署不被未使用位点卡死且降级永远留痕。
4. As a 平台工程师, I want HarnessRelease 是不可变 Artifact（prompt/schema/skill/tool/model/fact/rights/budget/eval bindings + planSchemaRevision + middlewareBindings + manifestHash），Lifecycle 与 Rollout 独立变更, so that releaseId 恒指唯一 manifest、trace 永远可还原。
5. As a 平台工程师, I want 任务/Plan/Trace 全部记录 releaseId，回滚=切回旧 release、在途任务保持冻结 release, so that 回滚不动任何任务内 prompt。
6. As a 平台工程师, I want 单商户/单 thread 试跑只能选择另一个完整 immutable candidate releaseId（禁字段级覆写，U10）, so that 灰度不破坏 identity。
7. As a 平台工程师, I want 首发灰度只有 workspace allowlist + candidate 试跑，percentage/industry 轴与自动回滚门绑定触发点（付费 workspace ≥ 50 且指标管道稳定一月）, so that 试点期不建空转机器。
8. As a 平台工程师, I want Quick Checks 零 LLM 行为门进 CI 与生产抽样（toolOrder 六原语序列、didNotCall 负向断言、maxToolCalls、noToolErrors、includes/excludes）, so that 行为回归有微秒级零成本防线。
9. As a 平台工程师, I want 忠实性/权利/红线类指标做成 gates（缺一即 failed）、品牌调性/可读性做成 thresholds（支持反向带），verdict 三态 passed/scored/failed 且 scored=可放行但记账、放量人工决定（U12）, so that 评估结果可直接驱动发布决策。
10. As a 平台工程师, I want L1 节点数据集以 fixtures 为主+脱敏历史抽样冷启动（冻结 dataset revision/来源/许可，U3）, so that 评估从第一天就有基线。
11. As a 平台工程师, I want AgentControlLimits 等闸门数值经回放校准后随 release 发布（U11）, so that 数值全是可审计事实。
12. As a 平台工程师, I want 全链 trace（thread→run→intent/retrieve/plan/compile/interrupt→make 各节点）带 releaseId/prompt exact version/skill refs/model route/token/cost/repair/fallback，绝不记录 API Key/未脱敏顾客资料/原始 CoT/上游美元成本, so that 可观测且不泄密（D-061）。
13. As a 平台工程师, I want 评估展示面（prompt 指标/trace 查询/dataset 实验）走 Langfuse（trace 带 releaseId tag），只建数据写入不建查看界面, so that 不重复造 Langfuse。
14. As a 平台工程师, I want L2 Journey Replay 与 L3 Shadow 声明为 trigger-bound backlog（历史任务数百级后建，建时必须带禁付费副作用只读闸）, so that 不提前建设也不留验收歧义。

## Implementation Decisions

- pack 归属：agentControl/copy/note(含 xhsNoteGen)/media(briefImage)/cover/viral/video，与注册表 22 键全覆盖（V3.1 §29.2）。
- D-165 三轴（skillRevision/promptVersion/catalogRevision）仍是扁平顶层键，pack 化不得引入嵌套（附录 A14）。
- middlewareBindings（policyId/revision/kind/order/allowedControlActions）随 release 冻结，resolver 输出 exact composition（供 #2 的策略挂点消费）。
- Artifact 增加 controlLimits 绑定（AgentControlLimits 全部标定值随 release 冻结）；任一 limit 未标定（unset）→ 发布失败（U11），resolver 保证返回非空 controlLimits——不复用语义不等价的 budgetPolicyRevision。
- Langfuse label 只用于候选选择和发布；运行时只读 release 冻结的 exact version。
- 表：p1_harness_release_artifacts / p1_harness_release_lifecycle / p1_harness_release_rollouts（V3.1 §33.1）。
- 发布绝对门对应项：任一运行能还原 exact release；rollback 不需要改任务内 Prompt；release diff 可读。

## Testing Decisions

- 主 seam：release 发布/解析/回滚在 P1 action 边界断言（immutability、manifestHash、per-run 选择、pack 覆盖失败拒发布）；Quick Checks 本身即测试资产。
- Quick Checks assertion API 与 Session 侧 checks 由 #2 落地（批次 2 进 CI）；本票只扩共享 registry、生产抽样、verdict 存储与 release 绑定，复用不重写。
- 现存合同测试模式承载 pack 覆盖构造性测试与 D-165 三轴扁平断言。
- Playwright journey：Harness Release（V3.1 §37.4-J：canary 命中候选/非 canary 用 production/rollback 后新任务回旧 release/在途任务保留冻结 release）。
- 退出门（V3.1 §35 批次 5）纳入验收；「自动回滚门可演练」改读「人工回滚演练通过」。

## Out of Scope

运营操作界面（release 装配/diff/审批 UI、tool policy 管理台、kill switch 面板）→ V3.1-H；L2/L3 通路与 percentage/自动回滚门（触发点后置）；@mastra/editor 类 CMS（不引入）。

## Further Notes

框架借鉴来源见 V3.1 附录 C 对照表（Mastra gates-verdicts/quick-checks、Editor 版本定向的 per-run 选择语义）。
