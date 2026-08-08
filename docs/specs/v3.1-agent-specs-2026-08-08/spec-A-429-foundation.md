# V3.1-A 地基：Agent 域合同 + AgentThread/AgentRun + 三层语义事件 + Workstream 外壳（Thread-root）

> **已发布**：https://github.com/legacy-origin-b/meiyeagent/issues/1（label: ready-for-agent）；本文为票面本地快照。原 legacy-origin-a/legacy-web-repo#429 因账号封禁废弃。
> 决策权威：`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`（下称 V3.1）§7–§10、§27、§4–§5.1、§33、§39；决策记录附录 B（U6）；硬约束附录 A。票面与 V3.1 冲突以 V3.1 为准。
> 依赖：无（本 spec 是 V3.1 全系依赖链的根）。

## Problem Statement

商家每次创作都从零开始：一次 Work 结束后系统不记得「我们最近一直在处理什么问题」；前台是卡片堆叠而非连续过程，刷新/换设备后过程丢失；服务端也没有可回放的会话事件真相，任何新前台形态都无地基可建。

## Solution

建立长期会话地基：AgentThread（跨 Work 长期会话）与 AgentRun（运行记录）成为一等对象；三层事件模型（canonical / semantic / ephemeral）基于现有 workflow.progress/token/state 三帧扩展出 Semantic Event Projector，支持 snapshot+replay 恢复；前台改为 Thread-root 的连续 Workstream 文档时间线外壳（本 spec 只做外壳与投影，不改任何业务写路径）。

## User Stories

1. As a 美业商家, I want 我的创作过程组织在一条长期会话（Thread）里, so that 一次交付后我可以继续聊、派生新的 Work 而不从零开始。
2. As a 美业商家, I want 刷新页面或换设备后回到同一条 Thread 且过程不丢, so that 我不用担心中途离开。
3. As a 美业商家, I want 工作台首屏（问候→分段器→Composer→建议行→Activity Shelf，承接 GAP R-1 顺序）显式 threadId 优先恢复、无显式目标时由 WorkbenchSessionProjection 决定展示 Idle 或续接活跃 Thread, so that 我不需要理解「会话」这个概念也能继续工作。
4. As a 美业商家, I want 历史 Work 第一次打开时自动出现在一条（懒创建的）legacy Thread 里, so that 旧内容不需要迁移也能进入新形态。
5. As a 美业商家, I want 「最近」页就是我的 Thread 列表, so that 会话入口只有一个、不出现两套历史。
6. As a 美业商家, I want 手机和电脑同时打开同一 Thread 时，后提交的一端得到明确的「已有进行中的对话，请刷新」提示（U6：单活跃写 turn + 409 + sessionRevision OCC）, so that 我的两端意图不会被混在一起。
7. As a 美业商家, I want Agent 的叙述以文档行（非聊天气泡）呈现、工具过程折叠为 Activity 行, so that 过程可读而不吵。
8. As a 前端, I want 一个 event reducer 从 semantic 事件流重建 Thread 状态（乱序/重复事件安全、patch 失败回退 snapshot）, so that 断线重连、回放恢复有唯一实现。
9. As a Core 服务, I want 各领域经 outbox 产出 semantic 事件、由统一 Projector 赋 per-thread 单调 streamOffset, so that UI 恢复正确性不依赖任何 ephemeral 帧。
10. As a Core 服务, I want ephemeral 帧（token delta 等）在发射侧标 transient、绝不落库, so that 不逐 token 写 PostgreSQL。
11. As a Core 服务, I want 每条 semantic 事件带 contextRole: included|excluded|summarized, so that 事件持久化与 LLM 上下文构建彻底解耦。
12. As a 平台工程师, I want Agent 域新合同（thread/run/goal/plan/memory/event/execution-plan/release/steering/outcome）用 branded IDs + canonical ownership matrix（one writer per semantic fact）, so that 后续所有 spec 在同一合同地基上开发。
13. As a 平台工程师, I want AgentRun 带 durability: exit|sync（创建后不可变；只读会话轮=exit，付费执行=sync 子 run，经 parentRunId+workflowId+snapshotHash 关联）, so that 持久化开销与恢复语义显式可审计。
14. As a 平台工程师, I want AG-UI 映射只作输出 adapter（内部 domain event 不用 AG-UI enum）, so that 协议可换而真相链不动。
15. As a 平台工程师, I want 现有创作行为在本 spec 合入后零变化（影子事件不改 Task/账单/UI）, so that 地基落地无回归风险。
16. As a 运维, I want agent_thread_v1 / agent_run_v1 / agent_semantic_event_adapter_v1 三个 feature flag（各自声明 canonical writer / legacy fallback / migration rule / delete condition）, so that 可按 workspace 灰度与回退。

## Implementation Decisions

- Thread 合同：title/status/activeGoalIds/summaryRevision，不保存 ContentPackage 正文、Provider 状态、账本、权利、完整 message dump（V3.1 §9）。
- sessionRevision（U6）落 p1_agent_threads 独立列（与 summaryRevision 分离，摘要更新不参与并发仲裁）；写 turn 开始按 CAS 递增，冲突方收 409 且 payload 携带 current sessionRevision。
- sync child run 在创建时记录 workflowId + snapshotHash（创建后不可变，parent 唯一），作为 Session run → DBOS execution 的唯一关联（V3.1 §10）；不建独立关联表。
- `/dashboard/recent` 收编为 Thread 列表投影，显式 supersede D-088；D-016 部分 supersede 已在 V3.1 §0.4 登记。
- Semantic Event 合同含 contextRole 与 streamOffset（domain 层 bigint；wire 层 decimal string，游标按数值序）；wire 与 domain schema 分开定义；ephemeral 帧 wire schema 带 transient:true（V3.1 §27，MAJOR-02 修订形态）。
- 重连顺序：session projection → 最新 StateSnapshot → 从 lastEventId 回放 → patch 失败重取 snapshot → pending interrupt 优先 → 不用「最近任务」覆盖显式 taskId（V3.1 §27.6）。
- Workstream 外壳复用现有双栏 shell 与移动 Bottom Sheet；宽度合同（对话 800 / 媒体 1240）承接 D-171①；本 spec 不实现 Living Plan/Interrupt/Artifact 内容体（后续 spec）。
- 前端不新增全局状态库；reducer + external store 小封装（V3.1 §28.2）。
- 前置核查：ai 与 @ai-sdk/react 大版本错位须在本 spec 内对齐。
- 事件表结构从 V3.1 §33.1 清单取 p1_agent_threads / p1_agent_runs / p1_agent_semantic_events 三张；写入纪律见 §33.1。
- 建立 Controlled Surface Registry 基础合同（V3.1 §28.4）与负向门：未注册组件/任意 HTML/className/component/action 一律拒绝（§0.5 红线）；B/C/D/E/F 各自只注册本票组件。
- 采集当前漏斗与性能基线（V3.1 §35 批次 1 末项交付物，口径按 §38），落 docs/ops 基线文件，供 §43.11/12 的「不劣化」比较用。

## Testing Decisions

- 好测试 = 只断言外部行为：P1 action + SSE 事件流边界（主 seam，现存缝）断言 Thread 创建、投影、snapshot+replay 等价、乱序/重复/跨 thread 隔离、并发 turn 409；不测 reducer 内部实现。
- Playwright journey（现存缝）：Thread-root 首屏、刷新重连不丢、legacy Work lazy 打开、双端并发提示。
- 合同测试挂 packages/contracts 现有模式（三帧 envelope 测试为先例）。
- 退出门（V3.1 §35 批次 1）：一个 Thread 可产生多个 Work；业务写路径完全不变；不显示空 Activity 或重复交付。
- 合同测试：arbitrary UI/component 拒绝（V3.1 §37.1，配合 Controlled Surface Registry 负向门）。
- A15/A16 验收具体化：required CI job 聚合门（GAP 计划 L4-3）、五 spec journey 门（L4-4）、R-8 三态截图基线重拍（GAP A-5）；逐条对照 V3.1 附录 A。

## Out of Scope

Living Plan/Interrupt/Artifact 内容体（V3.1-B/C/D）；Memory 读写（V3.1-E）；Goal（V3.1-F）；HarnessRelease（V3.1-G）；运营面（V3.1-H）；任何旧 UI 退役（V3.1-I）。

## Further Notes

V3.1 §35 有建议实施顺序供参考，但本 spec 交付物为完整功能（饱和交付，不做残缺 MVP）。A15/A16 验收项已列入上方 Testing Decisions。
