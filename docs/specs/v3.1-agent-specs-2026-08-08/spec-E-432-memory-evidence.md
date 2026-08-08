# V3.1-E Memory 平台与 Outcome Evidence：双通道经验、生命周期分置存储、注入透明化、结果证据统一

> **已发布**：https://github.com/leelv007-cmd/meiyeweb-agent/issues/432（label: ready-for-agent）；本文为票面本地快照。
> 决策权威：V3.1 §12（全部）、§26.1；决策记录附录 B（U4/U5）；硬约束附录 A（A11 分离删除）。
> 依赖：#429（Thread/事件地基）；working 切片另依赖 #430（Thread checkpoint 单 writer）。preference/correction/outcome 切片与 #430/#431/#433 并行 lane，不阻塞主线。

## Problem Statement

Agent 不会越用越懂这家店：纠正过的错误（「小林不是老板娘」）下次还犯；商家偏好没有安全的沉淀通道；发布后的经营结果（有人问/预约）消失在系统外，学习闭环没有燃料；同时商家无法知道 AI 这次「为什么这么写」——注入了哪些记忆不可见。

## Solution

在现有 preference 体系上升级 Memory 平台：五层认知分类（working/preference/episodic/procedural/correction），authority 双通道（Thread 内即时生效，跨 Thread 候选→商家确认）；存储按生命周期分置（U5=C）；每次生成的记忆注入清单对商家可见可反查；OutcomeEvidence 统一三层结果证据（merchant_reported 为主燃料）并指定唯一 canonical writer。

## User Stories

1. As a 美业商家, I want 我纠正过的事实类错误（correction）被一等记住且优先级恒高于软偏好, so that 同类错误不再复发（correction recurrence=0）。
2. As a 美业商家, I want 我说「以后都这样」时偏好立即生成候选并在确认后长期生效；只是本次说的调整只在本 Thread 内生效、结束时一键提议转正, so that 学习不越权。
3. As a 美业商家, I want 在「经验」页查看/纠正/撤销全部长期记忆（含来源与适用范围）, so that 记忆永远受我控制。
4. As a 美业商家, I want 任务详情能看到本次生成注入了哪些经验（注入清单），撤销某条后后续任务不再注入, so that 我能回答「它为什么这么写」。
5. As a 美业商家, I want 删除源对话不级联删除记忆条目（维护面标注「来源已删除」）, so that 删聊天不等于失忆。
6. As a 美业商家, I want 发布交接后次日被一句话追问结果并可一键点选信号 chips（有人问/加微/预约/买券/到店/没动静），同一 Work 只问一次、连续两次不理自动降频, so that 补记零负担不被打扰。
7. As a Core 服务, I want working memory 的抽取与投影策略由本 spec 定义、经 #430 的 compaction 单 writer 落盘（规模有界、不卡对话），不走确认流, so that 长会话上下文有界且新鲜、且 Thread checkpoint 只有一个 writer。
8. As a Core 服务, I want preference/correction 由统一 Extractor（schema 化抽取）经 onExtracted 钩子落候选表，绝不直接生效, so that false persistence=0 放行门成立。
9. As a Core 服务, I want 存储按生命周期分置：preference/correction 续用现有三表扩列（kind/authority/scope/decay/state），working 放 Thread checkpoint，procedural 保留 confirmed projection, so that 全量重写与晋升账本不混表。
10. As a Core 服务, I want 记忆检索只在合法 scope（门店×IP×场景×平台最窄组合）内排序，向量相似度永远不决定 workspace/rights/fact/authority, so that 跨店泄漏=0。
11. As a Core 服务, I want OutcomeEvidence 三层（verified/merchant_reported/inferred，inferred 只表达时间相关性禁因果）有唯一 canonical write contract（现有 manual outcome contract 扩展；result ledger 与 observability 只投影），幂等键=contentPackageRef+signal+observedAt/sourceRef, so that 结果证据无第二 writer。
12. As a 美业商家, I want 补记的结果可修正/撤回且绑定 exact ContentPackage revision, so that 记错了能改。
13. As a Core 服务, I want 历史数据首轮迁移只产 proposed memory、不批量自动激活, so that 迁移不污染。
14. As a 运维, I want agent_memory_read_v1 / agent_memory_candidate_write_v1 flag 与 disable_memory_write / disable_memory_read kill switch, so that 记忆读写可独立降级。

## Implementation Decisions

- Authority 分层 L0–L5（V3.1 §12.3）：L4 业务事实、L5 不可逆授权永不属于 Memory 权威；D-010/011/017/032/163② 全部继续有效。
- Memory 条目投影合同（kind/scope/authority/state/confidence/decay/evidenceRefs/revision）见 V3.1 §12.5；软偏好随时间衰减，事实不按行为衰减。
- 注入透明化载体 = MemoryInjectionReceipt（或等价 trace projection），绑定 exact task/run/release + memory revision refs（V3.1 §12.7）。
- 分离删除（D-168②/附录 A11）：记忆条目/DecisionEvent/ApprovalReceipt/provenance 四类实体各自删除策略。
- pattern mining、industry skill learning 明确移出本期；单店私有经验永不自动分享给其它店。
- 自报旅程的 UI 入口在 #433（V3.1-D）；本 spec 提供 evidence 合同与写路径、频控参数（U2=A）。
- OutcomeEvidence.signal 增 `no_activity` 承载「没动静」chip，禁借 `feedback` 模糊塞值；记为对 V3.1 §26.1 信号枚举的显式扩列。
- compaction 合同（U4=A：成本平台承担、失败保留上次摘要不阻断）属 #430；本 spec 只提供 working memory 抽取/投影策略并消费其 checkpoint 产物，不自建第二条写路径。

## Testing Decisions

- 主 seam：P1 action + 事件流边界——候选生成/确认/撤销/衰减、跨店隔离、correction 优先级、evidence 幂等与修正撤回；离线评测 memory retrieval precision。分离删除断言（A11）：删源对话后条目标注「来源已删除」、删 memory 后 ApprovalReceipt 保留。
- Playwright journey：记忆注入透明（任务详情→注入清单→经验来源→撤销→后续不再注入，V3.1 §37.4-B2）。
- 退出门（V3.1 §35 并行 lane）：跨店泄漏=0；Business Fact 被 Memory 覆盖=0；correction recurrence=0；false persistence=0；注入清单可见且撤销后不再注入。

## Out of Scope

自报追问的前台旅程与发布交接（#433）；Proactive 对 evidence 的消费（V3.1-F）；episodic 独立写路径（= 现有 DecisionEvent/trace 读取投影）；**Thread checkpoint / compaction 写路径（属 #430，Session Harness 是唯一 writer；本 spec 经其单 writer 落盘 working 投影）**；向量检索层（compaction 相关，触发点后置）。

## Further Notes

现有 preference 三表、memory approval receipts、经验前台是本 spec 的基座而非重建对象；任何新表提案须先对照 V3.1 §12.5 的分置裁决（U5=C）。
