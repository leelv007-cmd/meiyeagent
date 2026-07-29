# Issue #247 重试与纯谓词盘点（2026-07-29）

## 权威与范围

- 决策：D-167③（重试预算单一口径）、D-167⑤（谓词位无副作用）。
- 实现票：Issue #247。
- 本文是实现盘点与 code-review 清单，不新增通用 Workflow DSL、StageTypeRegistry 或第二运行时。

## 重试单一口径

| 层 | 当前生产入口 | 口径 | Issue #247 处置 |
| --- | --- | --- | --- |
| 模型 SDK | `OpenAiCompatibleAiSdkRunner` | 所有 AI SDK 调用显式 `maxRetries: 0` | provider 5xx 与未知异常均只调用一次 |
| 结构修复 | `OpenAiCompatibleAiSdkRunner.repairStructured` | 首次结构无效时最多一次修复 | 每次真实 provider effect 消耗同一个 execution attempt budget |
| 模型路由 | `ModelSupplyApplicationService.executeSubmission` | 仅 `rejected_before_accept` 可尝试下一候选；未知结果不重试 | 下一候选调用前消耗同一个 execution attempt budget |
| 自纠环 | `executeCopySelection` | canonical policy 失败后最多一次修正 | 与 SDK、结构修复和路由共用冻结 `maxIterations`；不另乘重试次数 |
| 权限硬门 | `subject_asset_rights` / `external_action_approval` | 不可自动修正 | 直接进入 held `ask_merchant`，不消耗自纠调用 |
| 工具层 | 当前 Harness Copy 生产链无独立工具重试器 | 默认关闭 | 后续工具必须消费同一冻结预算，不得声明第二套隐式 retry |

共享预算的计数真值是 provider effect 前的 callback，而不是某一层返回的
`attempts` 估算。source fence 先验证来源仍有效，验证成功后才消耗物理尝试；
预算异常必须穿透 Model Supply 内外两层错误归一化，才能转成可续挂起态。

## D-101 受控积木谓词合同

代码合同：`apps/core/src/p1/harness/pure-predicate.ts`。`evaluatePurePredicate`
只把结构化、深冻结的事实副本交给同步 predicate，并拒绝 thenable、非 boolean
返回值和非普通数据对象。

任何新增的分支 predicate 或循环 condition 必须同时满足：

1. 输入仅为本次判断所需的不可变事实值；不传 repository、runtime、event
   writer、suspension handle、clock、random 或网络客户端。
2. 输出仅为同步布尔值或已注册的声明式判定值；不得返回命令或副作用计划。
3. 判断期间禁止写状态、发事件、扣费、调用模型/工具、挂起或恢复 workflow。
4. 相同冻结输入必须得到相同输出；durable replay 不得因时间、随机数或外部状态
   改变分支。
5. 副作用只能发生在 predicate 返回之后的拥有者 step 中，并由该 step 负责
   幂等键、审计与失败姿态。
6. 未注册 condition kind、未知字段或缺少事实必须由 compiler 拒绝；不得把任意
   JavaScript、JSON expression 或脚本交给运行时解释。

## 现有积木盘点

权威实现：`apps/core/src/p1/creation-experience/recipe-studio.ts`。

| 受控积木 | 阶段 | predicate / condition | 副作用违例 |
| --- | --- | --- | --- |
| `intent_type` | `intent_naming` | 无；声明式枚举配置 | 0 |
| `fact_slots` | `context_injection` | 无；声明式事实类型与来源要求 | 0 |
| `story_structure` | `brief_compilation` | 无；声明式段落顺序 | 0 |
| `output_contract` | `brief_compilation` | 无；声明式输出约束 | 0 |
| `candidate_strategy` | `execution_selection` | 无；声明式候选策略 | 0 |
| `platform_adapter` | `assembly_delivery` | 无；声明式平台映射 | 0 |

当前六种 `RecipeStudioBlock` 都是数据对象，没有函数、runtime handle 或
condition 插槽；`compileBody` 的校验只读取输入并构造编译结果。因此当前 D-101
受控积木表面没有需要迁移的副作用谓词。Harness 内代码定义的策略分支不是
运营可编辑 predicate，不能据此开放任意表达式。

## 当前生产判断位

| 判断位 | 观察生产者 | 纯 predicate | 副作用 owner | 状态 |
| --- | --- | --- | --- | --- |
| 四上限触顶 | 已冻结 snapshot + 已观察 consumption | `executionLimitReached` 经 `evaluatePurePredicate` | `workflow-core` 的挂起、trace、HITL、resume 循环体 | 已符合 |
| bounded continuation loop | 上一步 selection outcome | `isBoundedExecutionSuspension` | `workflow-core` 循环体 | 已符合 |
| 图片 exact-text | `ImageExactTextVerifier.observe` 的幂等模型观察 | `assessImageExactText` 经 `evaluatePurePredicate` | `executeImageSelection` 决定 retry / hard block | 本票已拆分修复 |
| NotePlan 一致性 | 可选模型 `evaluate` effect | 对 observation 的同步字段判断 | compiler 在判断后累计 audit / 触发修正 | 已符合 |
| 事实满足度 | 幂等模型观察 + 权利只读查询 | 对 `assessment.action` 的同步分支 | workflow transition 负责 progress / HITL | 已符合 |
| canonical policy | 同步 validator 返回局部结果 | 对 `passed` / gate ID 的同步分支 | selection transition 负责修正或硬拦 | 已符合 |
| Skill 输出校验 | `SkillOutputValidator.validate` | 类型只暴露同步数据输入与数据结果 | `SkillService` 后续 invocation transition | 无已发现生产副作用；需静态架构门 |

已修复的混合边界：原 `ImageExactTextVerifier.verify()` 同时提交计费/持久化模型
观察并返回 `passed`，让 effect 与 retry predicate 混在一个 callback。现拆为
`observe()`（effect）和 `assessImageExactText()`（纯判断）。

仍需后续 registry 落地时封闭的可执行约束：predicate Skill 必须同时满足
`sideEffectClass === 'none'`、`allowedTools=[]`、`maxChildEffects=0`。当前没有
operator-editable predicate Skill，也未发现已检入的 effectful predicate 实例；
在 condition registry 出现前不得把普通 prompt-materialized Skill 冒充判断位。

DBOS event polling 与 note media admission polling 属于 transport/effect loop，
不是 D-101 可编辑 condition，不能用“纯谓词”名义重写其 effect body。

## Code-review 必查项

- [ ] 新增 condition 是否来自代码注册表，并限制在声明的 stage。
- [ ] predicate 参数类型是否只包含 readonly facts，且没有任何副作用 capability。
- [ ] predicate 是否同步、确定性，并有同输入重放一致测试。
- [ ] predicate 内是否出现 repository 写入、event/trace emit、模型/工具调用、
      billing、`awaitDecision`、suspend/resume、clock 或 random。
- [ ] 副作用是否移到 predicate 之后的 owner step，并具有稳定幂等键。
- [ ] 未知 condition、字段或事实缺失是否在 compile/admission 阶段 fail-closed。
- [ ] review 是否同时检查“承诺到实现”和“实现到生产调用点”，不以
      production-wiring 正则测试代替行为证据。

发现违例时先在本表登记 `file / predicate / side effect / durable replay risk /
owner ticket`，再做迁移；不得边盘点边顺手改写无关流程。
