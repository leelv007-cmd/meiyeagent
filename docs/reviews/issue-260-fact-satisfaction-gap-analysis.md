# Issue #260 充分性判定现状与补差清单

> 只读复核基线：`main@c06236881420fe2a2f8aaa90fc2ac3c2b17cc065`。
> 本票只交付分析，不实施补差。

## 已接通

`assessRecipeFactSatisfaction` 已由生产 `ProductionHarnessStagePorts.assessFacts`
调用，并在 Harness 第 2 段通过 durable step 执行。它先排除非
`current_fact`、过期、撤销和无权事实，再调用结构化判断位；合法输出分为：

- `satisfied → execute`；
- `partial + critical → QuestionCard / ask_user`；
- `partial + optional → execute_with_notice`；
- 无事实、伪造 ref、schema 违约或模型失败 → `conservative_guidance`。

当前仍有 9 条 `QueueRunner` post-processing fixtures；此外，#242-L1 已合入
11 条 frozen recorded production-seam cases、exact scorer、Promptfoo 正门及
必败 assertion control，并接入 CI。`pnpm eval:fact-satisfaction` 在当前 main
为 19/0/0；两组均是 fixture/recorded 接缝证据，不冒充 live 模型验证。

satisfaction 与 criticality 的 runner、schema parse 失败均会发出封闭映射、
去敏的结构化诊断，并保持 `conservative_guidance` 不变；本地
QuestionCard 构造失败固定归 criticality runner 阶段。默认诊断 sink 仍是
`console.warn`，所以这项只证明安全诊断已接通，不等于诊断事件自身已进入
durable 三轴 trace。

## 补差

| 优先级 | 缺口 | 当前证据 | 建议属主 |
| --- | --- | --- | --- |
| P1 | 商家回答关键事实后，本轮未重新运行充分性判定；代码 fence 新 ContextBundle 后仍返回回答前的 `assessment.factRefs`，新确认事实不能进入当前 brief | `workflow-core.ts:2572-2622` | 后续 Harness 修复票；#260 不改 |
| P1 | 当前 QuestionCard 是一条拼接问题、`options: []`、自由文本；没有逐项 answer schema、整组跳过、每项“暂未确定”与 `answer/deferred/skipped` 三态 | `fact-satisfaction.ts:248-288`、`packages/contracts/src/harness.ts:206-234` | #250 ask_merchant 深化契约 |
| P2 | `ledgerIntake` 声明了 `asset_intake.confirm_fact`，但当前 workflow 只消费 QuestionCard decision；没有在此 seam 证明 proposal/confirm 持久化与当前任务重评闭环 | `fact-satisfaction.ts:278-288`、`workflow-core.ts:2577-2622` | #251 沉淀管道 + 后续联调 |

## 已闭合的历史缺口

| 原缺口 | 当前证据 | 边界 |
| --- | --- | --- |
| #242-L1 正负控与 frozen golden | 11 条 frozen cases＋recorded provider 逐例评分＋必败 assertion control；`eval:fact-satisfaction` 19/0/0 | 不冒充 live 模型证据，也不替代 #260 copywriting A/B |
| 四项 Capture Intent 的承载决策 | `read_context` / `ask_merchant` 已注册并接通生产装配 | 四项由 #260 skill-creator 配方表达，不塞进 `StoreFactKind`；#260 配方实现仍依赖上表 #250/#251/回答后重评缺口的明确边界 |
| 任务级 prompt/catalog/skill 三轴 | fact-satisfaction/criticality structured-node lifecycle 以精确 effect key 发 execution-child 事件，并带 skill/prompt/catalog 轴；#262 真 PG+DBOS 装配覆盖 root/child 三轴 | `factSatisfaction` 摘要仍只记业务结果字段；项目 live Langfuse 取证必须另报 |
| criticality 失败不可区分 | `harness_fact_criticality_v1` 对 runner/schema parse/本地 QuestionCard 构造失败发安全诊断，稳定 effect key 且失败仍走 conservative guidance | 默认 sink 为 console；诊断不能当作生成、注入或 durable trace 成功证据 |

## #260 使用结论

1. 不新建第二个“充分性模块”，保留现有 `assessRecipeFactSatisfaction`；
2. `beauty-copywriting` 只消费已确认、已授权的当前事实；缺失时复用
   #250 完成后的 `ask_merchant`；
3. 美业版 skill-creator 的四项 Capture Intent 由配方通过 `read_context`
   / `ask_merchant` 完成，不塞进 `StoreFactKind`；primitive plumbing 已闭合，
   但 #250 逐项回答、#251 proposal/confirm 持久化与回答后重评仍未闭合，
   #260 只在这些边界上实现自己的配方与旅程；
4. 在 P1“回答后未重评”补差前，#260 真实旅程不得宣称商家刚补的事实已进入
   同一轮生成；验收必须查 materialized instruction、允许 fact refs 和最终输出；
5. #242-L1 的 recorded 正负控与 frozen golden、#248/#262 的任务级三轴事件
   已在上游满足；#260 必须消费并在自身旅程中核对，但不能用这些上游绿替代
   copywriting 注入、A/B 输出和商家可见入口证据；live provider/Langfuse
   结论也必须另列 live 取证。
