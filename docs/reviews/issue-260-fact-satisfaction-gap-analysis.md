# Issue #260 充分性判定现状与补差清单

> 只读快照：`main@cc04918ddb11f5cd5013ee085a369047538e218c`。
> 本票只交付分析，不实施补差。

## 已接通

`assessRecipeFactSatisfaction` 已由生产 `ProductionHarnessStagePorts.assessFacts`
调用，并在 Harness 第 2 段通过 durable step 执行。它先排除非
`current_fact`、过期、撤销和无权事实，再调用结构化判断位；合法输出分为：

- `satisfied → execute`；
- `partial + critical → QuestionCard / ask_user`；
- `partial + optional → execute_with_notice`；
- 无事实、伪造 ref、schema 违约或模型失败 → `conservative_guidance`。

当前 9 条固定 golden 覆盖满足、关键缺失、可选缺失、过期、撤销、无权、
伪造 ref、非法 satisfied 和模型失败。它们使用 `QueueRunner` 固定输出，是
fixture 行为回归，不是 #242 要求的 promptfoo/真实模型 golden。

## 补差

| 优先级 | 缺口 | 当前证据 | 建议属主 |
| --- | --- | --- | --- |
| P1 | 商家回答关键事实后，本轮未重新运行充分性判定；代码 fence 新 ContextBundle 后仍返回回答前的 `assessment.factRefs`，新确认事实不能进入当前 brief | `workflow-core.ts:2041-2088` | 后续 Harness 修复票；#260 不改 |
| P1 | skill-creator 需要一次性抽取“工具、步骤、纠正、输入输出格式”，当前输入仅支持 `StoreFactKind[]`，不能表达四项缺口 | `fact-satisfaction.ts:58-68` | #256 `read_context/ask_merchant` + skill-creator 配方 |
| P1 | 当前 QuestionCard 是一条拼接问题、`options: []`、自由文本；没有逐项 answer schema、整组跳过、每项“暂未确定”与 `answer/deferred/skipped` 三态 | `fact-satisfaction.ts:145-168` | #250 ask_merchant 契约 |
| P1 | 固定 9 例由测试直接喂模型输出，未证明真实判断位能在正/负控下稳定得出同样结果 | `fact-satisfaction.test.ts:238-493` | #242-L1 |
| P2 | trace 只记 status/action/refs/missing kinds，不含 prompt/catalog/skill 三轴，无法把判定质量归因到实际装配版本 | `workflow-core.ts:1993-2008` | #248 事件合同 + #262 三轴 |
| P2 | `ledgerIntake` 声明了 `asset_intake.confirm_fact`，但当前 workflow 只消费 QuestionCard decision；没有在此 seam 证明 proposal/confirm 持久化与当前任务重评闭环 | `fact-satisfaction.ts:165-168`、`workflow-core.ts:2046-2088` | #251 沉淀管道 + 后续联调 |

## #260 使用结论

1. 不新建第二个“充分性模块”，保留现有 `assessRecipeFactSatisfaction`；
2. `beauty-copywriting` 只消费已确认、已授权的当前事实；缺失时复用
   #250 完成后的 `ask_merchant`；
3. 美业版 skill-creator 的四项 Capture Intent 由配方通过 `read_context`
   提取，不塞进 `StoreFactKind`；
4. 在 P1“回答后未重评”补差前，#260 真实旅程不得宣称商家刚补的事实已进入
   同一轮生成；验收必须查 materialized instruction、允许 fact refs 和最终输出；
5. #242-L1 的正负控与真实 golden、#248/#262 的三轴事件，是最终关票证据，
   现有 fixture green 不能替代。
