# ADR-0020: Agent-native 双 Harness 架构与 plan-as-data 执行合同

Status: accepted (2026-08-08)

> 本 ADR 凝结自 **V3.1 权威规划**（`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`，决策日志 D-178；14 项拍板 U1–U14 见其附录 B），是实施投影不是第二真相源；任何冲突以 V3.1 与决策日志为准。实施票＝legacy-origin-b/meiyeagent #1–#9（本地票面快照 `docs/specs/v3.1-agent-specs-2026-08-08/`）。

## Context

现链的病根：Make 阶段重新理解 Intent/Brief（商家确认的方案与执行方案可能漂移）；会话无长期载体（每次创作从零开始，前台卡片堆叠不可恢复）；三套并列 runner（copy/note/media）逻辑重复；prompt/skill/tool/model 无统一版本组合对象，无法回答「这次运行用了哪一套」。V3.1 经三轮评审（交叉复核→框架对标→codex 复核）与九 spec 复核轮收口。

## Decision

**双 Harness，各司其职**：

- **Agent Session Harness**（新增，V3.1 §21）：AI SDK `streamText` 工具环，低延迟、只读优先，承载 Intent 理解/检索/Progressive Plan/Steering 会话层。AgentKernel port 薄封装（只为测试隔离与 AI SDK 大版本升级，无 durable checkpoint）。状态机 idle→…→handing_off；Level 0 不进状态机，Level 1（纯 copy，永久免确认口径 U1）直达 handing_off。
- **Production Make Harness**（既有 DBOS 演进，V3.1 §23）：durable workflow 承载全部付费副作用；新任务只消费冻结计划，不再重新调用 intent/brief LLM（旧节点降为 validator，mismatch fail closed）。

**唯一交接物＝冻结 `ExecutionPlanSnapshot`**（V3.1 §14）：`approvalBasis: merchant_confirmed | policy_exempt_copy`；两路径都冻结 exact plan/quote/rights/fact/prompt/skill/bounds/releaseId + snapshotHash（hash 只覆盖冻结执行内容，快照行在 task-admission 一次性落库）。确认拆「待决请求（创建事务内先 reserve+FEFO 同事务，U8）＋不可变决定」；hold 到期＝取消＋退分（D-153）。

**plan-as-data**（V3.1 §22）：`CompiledExecutionPlan`＝typed unit 列表＋依赖分组＋有界重试默认关（D-167③）＋workspace 隔离缓存（key 含 releaseId）。控制流永远留在 DBOS TS 代码——**无 grammar 解释器、无任意 DAG、条件位禁副作用**（附录 A18）。LLM 输出 PlanProposal，确定性 Plan Compiler 编译；六原语 read_context/generate/revise/record/check/ask_merchant，领域枚举不进原语签名（A8）。

**一等对象与事件**（V3.1 §9–§10、§27）：AgentThread（跨 Work 长期会话，sessionRevision OCC 单活跃写 turn，U6）/AgentRun（durability: exit|sync，sync 子 run 经 parentRunId+workflowId+snapshotHash 关联）；三层语义事件 canonical/semantic/ephemeral（ephemeral 发射侧标 transient 绝不落库），AG-UI 只作输出 adapter。前台＝Thread-root Workstream 文档时间线。

**Memory 平台**（V3.1 §12，U5）：五层认知分类（working/preference/episodic/procedural/correction）；authority 双通道（Thread 内即时生效／跨 Thread 候选→商家确认）；存储按生命周期分置——preference/correction 续用现有三表扩列，working 进 Thread checkpoint（唯一 writer＝Session Harness compaction），procedural 保留 confirmed projection；注入透明化（MemoryInjectionReceipt）。

**HarnessRelease 三对象**（V3.1 §29，U10/U11）：immutable Artifact（全部 exact bindings+manifestHash+middlewareBindings+controlLimits）/Lifecycle/Rollout；per-run 试跑只能选完整 candidate releaseId；strict prompt 校验挪到 release 发布时点；控制闸门数值回放校准后随 release 发布，unset 拒进生产。

**Eval 分层**（V3.1 §31，U3/U12）：L0 合同测试→L0.5 Quick Checks 零 LLM 行为门→L1 fixtures+脱敏历史数据集；gates/thresholds/verdict 三态，scored 只记账、放量人工决定；L2/L3 trigger-bound backlog。

**收敛路线**（V3.1 §22.4）：三 runner 内部逻辑先替换为六原语→收敛为单 `CompiledExecutionPlan → DBOS executor`；五阶段只保留为 trace taxonomy（与 D-036 一致）。退役门＝V3.1 §35 批次 6（前置全满足才开工；legacy replay 归档＝条件门+安全缓冲，U14）。

## 实施红线

- 禁第二 durable runtime／任意 DAG 引擎／grammar 解释器；控制流只在 DBOS TS 代码。
- System-only 动作（reserve/settle/commit_fact/grant_rights/publish/final_commit）提案层拦截，本体只由确定性 orchestrator 产生；模型永远拿不到业务授权。
- 模型不写 quote/余额/rights/model availability；前端组件走 Controlled Surface Registry，任意 HTML/component/action 一律拒绝（§28.4/§0.5）。
- D-038 五条（纯函数 step 内核/at-least-once 幂等/大产物对象存储/回装 OCC/发布排空与版本粘滞）全程有效；D-061 双真相不变。
- 框架借鉴（Mastra/pi.dev/LangChain）只取实践、零 runtime 引入，引用逐条登记 V3.1 附录 C。

## 对既有 ADR 的修订

- **ADR-0007**（AI SDK first）：继续有效并增补——Session Harness 是 AI SDK 直用的第二个（会话层）消费者；Mastra 仍不引入。
- **ADR-0013**（五段 Harness）：五段状态机的长期执行拓扑地位被本 ADR 收敛路线接管（五阶段→trace taxonomy）；DBOS 载体边界、D-038、pg-boss 分工、④段等待语义在过渡期继续有效，退役按 §35 批次 6。
- **ADR-0014**（双主线交互）：定制创作主容器升级为 Thread-root Workstream 文档时间线（AgentThread 一等容器、四态工作台承接 D-171）；双主线、组件供给基准（D-130）与「对话流是结构化卡片流」红线不变。
