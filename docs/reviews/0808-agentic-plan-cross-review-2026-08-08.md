# 0808 规划（V2/V3）交叉复核报告

**日期**：2026-08-08
**对象**：`docs/design/0808规划/meiye-agentic-workbench-v2-complete-plan.md`（V2）、`docs/design/0808规划/完成.md`（V3）
**复核立场**：以功能与产品最优为导向，不受既有规划决策约束；既有决策仅作为「真实约束 vs 可推翻选择」的证据输入。反驳立场复核，双向核查（文档→仓库现状、文档→拍板历史、V2↔V3 互查）。
**事实核查**：两个独立 opus 复核 agent 分别核实了文档对仓库的 13 项断言与对 7 组既有决策的冲突面，结论均带 file:line 证据。

---

## 0. 总判断

两份文档的大方向正确且值得作为下一阶段开发权威：Thread≠Work、双 Harness 拆分、冻结 Plan 快照、Memory 作为护城河、AG-UI 三层事件、发布绝对门清单，这些都经得起反驳。

但有 **16 项结论需要修改**，集中在五个病灶：

1. **V2 与 V3 自相矛盾未裁决**（Plan 生命周期、Release 对象、确认门范围、实施顺序）——两份文档不能同时为权威；
2. **Memory 自动生效**推翻了五条一致拍板且拆掉了一个已定义的上线放行门，属于用产品信任换省一次确认，不划算；
3. **Typed Plan Grammar** 是在既有编译链（RecipeCompiler→CompiledExecutionPlan→DBOS）之上重新发明一个 workflow 解释器，违反「成熟组件优先、自写 framework 须 ADA」纪律，且真实用户旅程没有任何一个需要任意拓扑；
4. **对仓库现状的三处误判**造成方案里「新建」的东西其实已存在（preference 三表+经验前台、逐 token 事件流、HeroUI Pro vendored），会制造双真相；
5. **学习闭环的燃料问题**（outcome evidence 冷启动≈0）被当作数据建模问题处理，实际是产品旅程设计问题。

---

## 1. 必须修改的结论（按严重度排序）

### R1. V3 §10「L1 Soft Preference 自动生效」→ 撤回，改双通道

**原文**：V3 §10「取消『所有 Memory 都必须确认』的统一规则……L1 Soft Preference 自动生效、低权重、可衰减」。

**修改建议**：L1 收窄为「**本 Thread 内即时生效 + Thread 结束/交付时一键提议转正**」；跨 Thread 持久化仍走 候选→确认。

**理由**：
- 与 D-010/D-011/D-017/D-032/D-163② 五条一致决策对撞（「重复行为只生成候选，确认后生效」「检索不能自动强化偏好」「被动沉淀一律 propose_*，不直接入库」），且 D-032 的 `false_persistence_rate===0` 是 Stage 2 偏好学习的**上线放行门**——自动生效直接把这个门拆了。
- 这五条不是官僚约束而是产品信任机制：美业商家一旦感知「它学歪了还改不掉」，对 Agent 的长期信任崩塌成本远高于省掉的那一次轻量确认。
- decay、correction 一等建模、记忆一级导航这三点是延续，保留。

**取舍**：自动生效省的是确认摩擦——但确认可以做成 chip 级轻交互；错误偏好自动固化的调试与信任成本不可逆。Thread 内生效已拿到「即时响应纠偏」的全部体验收益。

### R2. V3 §12「Level 1 简单生成免 Plan 免确认」→ 补硬边界

**原文**：V3 §12 Level 1「写一条朋友圈护理介绍……前台无需强制展示完整 Living Plan」（未排除付费媒体）。

**修改建议**：免确认边界 = **纯 copy（零付费媒体调用）**。含出图/出视频的「简单生成」一律过执行确认（流内 interrupt 形态即可，不必是完整 Living Plan）。

**理由**：确认门的权威是 XHS spec §3.2 + D-164③/D-171③：「按是否含付费媒体执行判定，纯 copy 免确认」，验收门 P1-6 是「拒绝则零扣费」。这个门本质是计费+权利门而非流程仪式。计费规格本身对纯 copy 无确认要求（预扣/退还机制已兜底），所以 Level 0/1 免确认对纯 copy 成立、对付费媒体不成立。V3 原文留白会被实现层解释成「简单=都免确认」。

**取舍**：若未来图像成本降到可忽略，可放宽——但那应表达为「免确认成本上限」显式参数（见 §4 缺失决策），不是文字留白。

### R3. V3 §19-21「Typed Plan Grammar + 解释执行」→ 降格为 plan-as-data

**原文**：V3 §20 `AgentPlanNode = ... | ParallelNode | ConditionalNode`，允许 sequence/parallel/if-else/bounded retry 的 grammar，由 executor 解释执行；§45 Step 4 删除 workflow-core 三套 runner，只留 `CompiledExecutionPlan → DBOS executor`。

**修改建议**：
1. **不建 grammar 解释器**。CompiledExecutionPlan 定义为**数据**：typed execution unit 列表 + 依赖分组（可并行组）+ 有界重试参数。控制流留在 DBOS TypeScript workflow 代码里（代码本来就有 sequence/parallel/conditional，且 durable 语义已验证）。
2. 三 runner 收敛方向保留，但顺序倒过来：**先迁走挂在 workflow-core 上的确认门（`workflow-core.ts:2972-2983` confirmPaidGenerationExecution）与 note 页级执行帧（`:1667-2011`），再收敛 runner**——否则 XHS §3.2 确认门与 GAP 修复成果整体失锚。
3. ConditionalNode 作为模型可产出的构造删除；条件判断只能是编译期展开或代码内确定性分支（D-167⑤：条件位禁副作用，否则 durable 重放崩塌）。

**理由**：
- D-101 已内置这条链的正确形态：「RecipeCompiler 解析依赖→生成 CompiledExecutionPlan→**DBOS 只执行已映射到代码注册表的已发布计划，不在运行时解释任意流程图**」。V3 的 grammar 是把「不解释流程图」改成「解释一种自家 DSL」——第二 workflow 运行时换了个名字，撞 D-101 明令，也撞「自写 framework 须 ADR 证明成熟方案不可用」的工作纪律。
- 三条已拍板硬约束在自由 grammar 里难以保持：D-166③ 红线门禁需要可挂载的语义位点（D-163① 已论证原语面退化为通用工具面时门禁无处挂）；D-163① 领域枚举不得进原语签名（grammar 节点极易把 kind 写进枚举）；D-167① 有界字段全为可审计事实禁隐式默认。
- **产品最优视角：没有任何已知用户旅程需要任意拓扑。** Campaign（Level 3）= 一个 Plan 派生 N 个 Work，不需要 grammar；单 Work 内拓扑是有限集（copy/note/media），参数化即可覆盖「6 页 vs 4 页、带不带封面」这类变化。

**取舍**：损失「未来未知拓扑」的表达自由——用「新增 execution unit 类型 = 代码注册表加一项」的扩展路径替代，扩展成本仍低。换来 durable 语义、门禁挂载点、审计确定性三项不可让渡的资产。

### R4. V2 §10.4 PlanApprovalReceipt → 拆散，不新造 Receipt 家族对象

**原文**：V2 §10.4 `PlanApprovalReceipt { quoteId, creditCost, idempotencyKey, expiresAt, snapshotHash ... }`；§19.4/Wave 4「旧 confirmation 与 PlanApprovalReceipt 过渡期双写」。

**修改建议**：
- 确认动作复用 **D-164③ 执行确认卡**语义（内部可重来的生成确认，非发布批准）；
- 冻结一致性用 **snapshotHash + 既有 quote revision（D-109 UserDebitPreview 冻结）+ 既有 reservation 幂等键**三个现成属主拼合，确认记录只是一张关联行，不是新的 Receipt 聚合；
- 删除「过渡期双写」——直接切换，legacy 走 fail-closed 分支；
- `expiresAt` 语义必须落到 D-153：hold 到期 = **取消任务 + 退分 + 白话告知**，不允许静默失效。

**理由**：核查确认 PlanApprovalReceipt 的三个核心字段各有属主（ApprovalReceipt=外部发布授权语义；quote revision=计费报价；reservation=幂等预扣），合并成新对象 = 同一语义多 writer，违反 V3 自己的 §3.1。且 D-164③ 显式拒绝过把生成确认并入 ApprovalReceipt 家族（「套用发布批准的重量级面板会使每次生成都成为一次发布决定」）。双写方案另撞计费规格「明确范围外：双轨兼容期」的反双轨口径。

**取舍**：省一张表+一套双写迁移；代价是 V2 §10.4/Wave 4 合同重写——Wave 4 未开工，零沉没成本。

### R5. V2 主流程「所有任务经 Living Plan 确认一次」→ 采纳 V3 分级并补计费 UX

**原文**：V2 §0 单一权威结论把「用户确认一次」写进每个任务的必经链。

**修改建议**：V2 正文按 V3 §12 分级改写（Level 0 确定性轻修改 / Level 1 纯 copy / Level 2 复杂创作 / Level 3 Campaign）。同时补两文档都缺的 **Level 1 计费 UX 规则**：报价 chip 常显（计费规格 §184 本就要求「本次约消耗 N 分」+退还开关双态文案）、余额不足阻断+双出口、失败退还状态可见。

**理由**：Plan 全员必经会把 D-043 已免确认的纯 copy 旅程拖慢一档，违背 HITL 总纲「介入位=修正点非审批墙」。分级后确认规则可压平成一条：**计费展示恒在，确认门只按付费媒体触发**。

### R6. V2 §10.2 MarketingPlanRevision 的 status 生命周期 → 采纳 V3 的 projection 模型

**原文**：V2 把 `stale/blocked/confirmed` 写进 status 枚举；V3 §13 明确「stale/blocked/reprice_required 是 projection 而非 lifecycle 状态」。

**修改建议**：两文档矛盾，V3 对，V2 §10.2 改写。revision append-only；stale 等派生态由 readiness projection 计算。

**理由**：stale 是外部事实变化的派生结论。写进 lifecycle 意味着事实域变化要反向写 Plan 行——第二 writer，且与 V2 §18.2 自己的「Plan revision append-only」自相矛盾。

### R7. HarnessRelease（V2 §14.3）与 AgentReleaseManifest（V3 §25）→ 合并为一个对象

**修改建议**：保留 HarnessRelease 为唯一 release registry（它已含 rollout/canary/审批），吸收 AgentReleaseManifest 的 memoryPolicyRef/planGrammarRevision（降格后为 planSchemaRevision）/supervisorPolicyRef 字段组。

**理由**：两套 release 对象覆盖同一语义（「一次可回滚的 agent 行为版本」）= one-writer 原则的直接违反；运行时解析、trace 关联、回滚操作都会出现「以哪个为准」的分叉。

### R8. V2 §11.2 双跑一致性 → 只对账确定性字段，抽样+时间盒

**原文**：「旧 Harness 仍重新运行；对比 intent hash、brief hash、fact refs、deliverables、quote」。

**修改建议**：LLM 生成物（intent 文本、brief 措辞）不做 hash 对账；只对账确定性字段（deliverable 数量/carrier、fact refs、rights refs、quote、bounds）。双跑限抽样比例（如 10%）并设时间盒，而非全量长期。

**理由**：LLM 输出非确定，intent/brief hash 恒 mismatch，对账信号全是噪音；全量双跑 = 过渡期内每任务双倍 LLM 成本。shadow 的真正价值在「冻结 Plan 是否遗漏了旧链会补的确定性字段」，这用结构对账就够。

### R9. V2 §15 Harness Control Plane 管理台 → 砍半，指标/trace/eval 面用 Langfuse

**修改建议**：自建面只保留 Langfuse 覆盖不了的：release 装配/diff/rollout/rollback、tool policy 管理、kill switch。§15.2 Prompt 指标、§15.5 Trace & Replay、§15.6 Evals 的**展示层**用 Langfuse 现成 UI（trace 带 releaseId tag 即可按 release 聚合），只建数据写入不建查看界面。

**理由**：D-037「Langfuse 先行、零新增件」的判断依据未变；自建全套管理台是 V2 全部 21 张 PR 里最没有商家可感知价值的部分，却占 V2-18/19/20 三张高风险票。等真实运营痛点出现（如「Langfuse 按 release 聚合不了」被实际撞到）再补自建面。

**取舍**：Langfuse UI 不完全贴合运营心智——接受 80% 贴合，把省下的工程量投给 R11 的 outcome 旅程（商家可感知）。

### R10. V3 §43 Memory 新表 → 与既有 preference 体系收编裁决，范围收缩

**原文**：V3 §43 新增 `p1_agent_memory_entries`；§8-9 五层 Memory 平台；§40-41 pattern mining 与 industry skill learning。

**修改建议**：
1. **仓库已有 preference 三表**（`p1_preference_candidates/promotions/heads`）+ `p1_memory_approval_receipts` + memory-vault 前台（/dashboard/memory「经验」）。V3 当它们不存在。必须二选一并显式写进方案：(a) `p1_agent_memory_entries` 作为超集新表并**迁移吸收**现有三表；(b) 现有体系扩列（加 kind/authority/scope/decay）。建议 (b)——语义连续、迁移面小。
2. 首批实现 = working + correction + preference 三类；episodic = 现有 DecisionEvent/trace 的**读取投影**，不新建写路径；procedural 仅显式确认（与 R1 一致）。
3. §40 pattern mining、§41 industry skill learning **明确移出本期**：其燃料（outcome evidence 体量）冷启动为零，建了也是空转。
4. 承接 D-168② 分离删除语义（删源对话不级联删记忆，四类实体不同删除策略）——V3 记忆平台对删除只字未提。

**理由**：五层认知模型作为文档分类学保留；实现按数据现状裁剪，避免双真相。

### R11. V3 §38-40 Outcome/学习闭环 → 重心倒转为「商家自报旅程」

**原文**：V3 §38 三层 Outcome（verified/reported/inferred）以 verified 打头。

**修改建议**：
1. 首发现实是 **automatic_verified 平台数 = 0**（D-086 明确），闭环唯一真实燃料是 merchant_reported。产品设计重心倒转：把「商家自报」做成近零摩擦旅程——发布交接完成次日一句话追问（「昨天的笔记有人来问吗？」）+ 一键信号 chips（有人问/加微/预约/没动静），而不是留一个 `POST /outcomes` 表单。
2. Release F（Proactive）加准入门：**evidence 覆盖率 ≥ 阈值才对该商家开启主动建议**。
3. inferred 层「只表达时间相关性、禁止表达因果」保留，正确。

**理由**：没有 evidence 的 proactive 建议 = 拍脑袋打扰，dismiss 率会杀死功能信任；而 evidence 覆盖率取决于自报摩擦，这是旅程设计问题不是 schema 问题。两份文档给了 evidence 完整的数据建模却零旅程设计——方向盘装反了。

### R12. AgentThread 采纳，但须显式 supersede D-016/D-088

**修改建议**：Thread 一等对象保留（这是 V3 最有价值的产品判断），但方案须显式登记 supersede D-016（不引入第二套 Agent/记忆运行时——Thread 持久化属其射程）与 D-088（不新增 message/thread 实体），并回答 Thread 与现有 `/dashboard/recent` 会话恢复链的收编关系（吸收 or 并存）。

**理由**：不是反对结论，是反对静默推翻——这两条不登记，后续 lane 开发会拿旧决策当依据反向撕掉 Thread。

### R13. V2 §7.1 AgentTurnDecision 的 `retrieve` action → 删除

**修改建议**：检索在 turn 内走 tools（V2 §9.4 伪代码本就是 streamText + tools 循环）；AgentTurnDecision 只留终局动作（ask/propose_plan/patch_plan/steer/propose_experience/finish）。

**理由**：`retrieve` 作为终局 action 与 turn 内 tool 检索功能重复，且会把一次理解拆成多轮往返，白付延迟。V2 自己的 SLO（首次可见理解 p75<1.5s）容不下这种往返。

### R14. V2 §14.2 Prompt Pack → 保留，但 strict boot 合同同批改

**修改建议**：pack 化保留（22 键全量冻结确已过重）。但必须同批修改：(1) strict boot 校验从「全注册表 pin 齐」改为「已发布 release 引用的全部 pack pin 齐」，校验时点从 boot 挪到 release 发布；(2) 保留「缺失不得静默降级」（D-166④ isFallback 审计管道不动）；(3) D-165 三轴（skillRevision/promptVersion/catalogRevision）仍是扁平顶层键，pack 化不得引入嵌套。

**理由**：核查确认现状确实全量解析 22 键、缺一键 boot 失败——V2 对痛点的诊断属实，方向正确；但不改 boot 合同直接上 pack 会出现「boot 校验与 release 校验两套真相」。

### R15. 实施顺序 → V2 Waves 与 V3 Releases 合并为一条线

**修改建议**（合并后的批次）：

```text
批次 1（= V2 Wave 0-1 + V3 Release A）
  合同 + AgentThread/AgentRun + Semantic Event Projector（基于现有三帧扩展，
  不从零）+ Workstream 外壳 + Thread-root Workbench
批次 2（= V2 Wave 2-3，V3 Release C 的 C2/C3 合入）
  Agent Session Harness + 分级 Progressive Plan + Living Plan（Level 2+）
批次 3（= V2 Wave 4-5，按 R4 改造后）
  执行确认卡扩容 + ApprovedPlanSnapshot + Make Harness 消费冻结 Plan
批次 4（= V2 Wave 6-7）
  Artifact stable ID + Steering + Publish Handoff + 商家自报旅程（R11 前置到这里）
并行 lane（不阻塞主线）：Memory 扩列升级（R10，= Release B 收缩版）
批次 5（= V2 Wave 8-9 砍半后）
  Prompt Pack + HarnessRelease（合并 R7）+ Langfuse 挂接
批次 6（= Release F 收缩版 + Wave 10）
  Proactive（evidence 门控）+ 退役旧 UI
```

关键改动：**MarketingGoal 移出首切片**——Goal 不建 CRUD 管理面，由 Agent 从 Thread 对话中提议、用户确认才创建（V3 §44 迁移策略本来就是这个口径，但 §66 首切片又把 Goal 排进去了，自相矛盾）；Memory 与主线并行而非串行阻塞（V3 Release B 挡在 C 前会让最大的 UX 提升晚两个月）。

**理由**：商家可感知价值的先后 = Workstream 体验 > Plan/执行一致 > 交接/自报 > Memory 长期红利 > 平台设施。V3 的 B→C 串行把内部平台排在了用户体验前面。

### R16. 措辞与事实修正（小项集）

1. **「8 进 1 出」引用错误**：那是 D-171④ 功能采纳裁决（8 adopt/adapt + 1 reject，reject 的是扫码发布），不是 UI 决策，V2 引用处更正。
2. **「手机二维码继续」补语义限定**：= 交接页搬到手机由**商家自己**发（MobilePublishHandoff，延续）；不得含扫码后我方驱动发布（撞 D-171④ reject + D-155 冻结面）。
3. **逐 token 事件已存在**（`workflow.token` 三通道），V2 Wave 0 的 shadow projector 应基于现有 progress/token/state 三帧扩展，文档「现状只有卡片流」的暗示不准确。
4. **assistant-ui/AG-UI/CopilotKit 均无依赖**（XHS spec 定位=只抄模式/只抄协议，禁 runtime）。V2 §13.5 Controlled Surface Registry 与此一致，保留，但 §13.1 技术栈清单不得暗示引入这些 runtime。
5. **前端 `ai@7.0.19` 与 `@ai-sdk/react@4.0.23` 版本错位**，V2 §9.4 依赖 AI SDK 7 语义（partialOutputStream/prepareStep），批次 1 前置核查对齐。
6. **quote 不在现有 admission 冻结面**（核查确认 task-admission 零 quote 引用，quote 在 product-billing 域）——V2 §19.1 表格「task-admission.ts = ApprovedPlan、route、prompt/skill、bounds 冻结」把 quote 混进去的读法要改：quote 绑定发生在计费域，snapshot 只持引用。
7. SLO 采 V3 §58 的 simple/complex 拆分，V2 §23.2「普通 Intent→Plan p75<8s」行对应改写。
8. Waiting 态文案四问（V3 §32）与 D-116/D-169① 统一超时语义合并：超时=语义层默认回答（系统代答，仅限无外部副作用），不做载体层挂起过期。

---

## 2. 反向复核确认保留的关键结论

按反驳立场逐一攻击后仍然成立、不要动的：

- **双 Harness 拆分 + ApprovedPlanSnapshot 连接**（V2 §2.3）——「确认方案≠执行方案」是现链真实缺陷（现状 Make 链重新跑 intent/brief），冻结快照是正解；
- **一个 AgentKernel、禁双 durable runtime**（V3 §3.3/§23/§65）——与 D-016 同向，port 抽象薄、成本低，保留;
- **Activity 不回灌 LLM**（V2 §12.4）；
- **问题预算每轮≤1**（V2 §5.5）；
- **System-only actions 清单**（V3 §18）——reserve/settle/commit_fact/grant_rights/publish 不作 Agent tool，正确且与 D-112 四硬底线同构；
- **三层事件模型 + ephemeral 不落库**（V3 §27）——与现状 workflow.token 不落库一致；
- **kill switch 颗粒化拒绝单一总开关**（V3 §63）；
- **发布绝对门 14 条 / V3 发布门六组**（V2 §27、V3 §64）——逐条核过，无一多余；
- **明确不做清单**（V2 §0.3、V3 §65）——特别是「不为实时把 SSE 迁 WebSocket」「不建商家侧 DAG」「每次简单改字不生成 Living Plan」；
- **Memory 迁移只生成 proposed、不批量激活**（V3 §44）；
- **Supervisor 单 Agent + 受控专业节点、专家 per-invocation 无长期记忆**（V2 §5.1、V3 §24）。

---

## 3. 两份文档均未提及、但必须承接的已拍板硬约束

新方案实施时逐条进验收，不承接会直接炸在生产：

| # | 约束 | 来源 | 新方案的落点 |
|---|---|---|---|
| 1 | 积分/上游成本双真相铁律：任何面永不暴露 token/美元 | D-061 | PlanQuote/receipt 字段设计 |
| 2 | hold 到期 = 取消任务+退分+白话告知，无静默失效 | D-153 | R4 expiresAt 语义 |
| 3 | 余额检查+reservation+FEFO 扣减同事务+workspace 级锁 | 计费 §4.2 | Plan→Make 两阶段后 reserve 仍须在 Make 启动事务内，snapshot 只持 quote 引用不复制金额 |
| 4 | refund 回原批次、过期批次份额作废且流水可见 | 计费 §4.1 | 部分失败退还 UI |
| 5 | 模型级失败退还开关投影到报价双态文案 | 计费 §100/§184 | commit strip / 报价 chip |
| 6 | 有界执行：闸门数值进快照禁隐式默认；触顶=可续挂起非失败；权限类失败不进自纠环 | D-167①②③ | AgentControlLimits + bounded execution |
| 7 | 七门红线恒 block、采样率恒 1.0、软提示留痕 | D-166③ | plan-as-data 的门禁挂载点（R3） |
| 8 | 领域枚举不进原语签名，新增输出类型零代码改动 | D-163① | execution unit 类型注册表设计 |
| 9 | kind 三枚举 + 兼容别名不破坏性迁移 | D-171②/XHS §196 | PlanDeliverable.carrier 字段 |
| 10 | D-038 五条：纯函数 step、at-least-once 幂等、大产物对象存储、OCC 条件写、发布排空/版本粘滞 | D-038 | Make Harness 改造与 runner 收敛 |
| 11 | 记忆分离删除：删源对话不级联删记忆，四类实体各自删除策略 | D-168② | Memory 平台（R10） |
| 12 | GAP R-8 视觉基线与 journey 门清单会因形态改版整体作废，须排重拍 | GAP:35/§70-73 | 批次 1-2 验收 |

---

## 4. 需要新开的决策（两份文档都留白）

1. **免确认成本上限参数**（R2 取舍的显式化）：未来放宽免确认边界时按积分阈值而非文字判断；
2. **商家自报旅程**的具体形态（R11）：追问时机、chips 集合、打扰频控——需要一次产品设计，不是 schema；
3. **eval 数据集冷启动**：L1 节点数据集从哪来——建议从现有任务历史 + fixtures 播种，方案未提；
4. **Thread compaction 策略**：何时压缩、谁付 token 成本、压缩失败的降级；
5. **现有 preference 三表 vs 新 memory 表**的收编路径裁决（R10 建议 (b)，需拍板）；
6. **多设备并发 turn**：手机+桌面同 thread 同时输入的仲裁（事件模型能表达，产品行为未定义）。

---

## 5. 结论

V3 的四个上层假设中：**Thread≠Work 采纳（R12 登记 supersede）、Goal 一等对象采纳但移出首切片（R15）、Memory 平台化方向采纳但自动生效撤回+范围收缩（R1/R10）、五阶段降级采纳但 Grammar 降格为 plan-as-data（R3）**。V2 作为详规继续有效，但 §0 主流程、§10.2、§10.4、§11.2、§14.2、§15 按 R4-R9/R14 改写，与 V3 冲突处以本报告裁决为准。

两份文档合并修订后应产出单一权威版本（建议 V3.1），并把 §3 的 12 条硬约束表附为验收附录。

