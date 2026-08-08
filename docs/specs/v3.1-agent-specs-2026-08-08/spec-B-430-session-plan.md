# V3.1-B 会话与方案：Agent Session Harness + 分级 Progressive Plan + Living Plan + Plan Compiler（plan-as-data）

> **已发布**：https://github.com/leelv007-cmd/meiyeweb-agent/issues/430（label: ready-for-agent）；本文为票面本地快照。
> 决策权威：V3.1 §3、§5.2–5.3、§13、§16–§22.2、§7.3–7.4；决策记录附录 B（U1/U3/U4/U11）；硬约束附录 A（A6/A7/A8/A13/A18）。
> 依赖：#429（Thread/Run/事件地基）。

## Problem Statement

商家说一个模糊经营目标后，现链直接进入重型生产流程：没有先检索已有信息的理解层，没有可自然语言调整的方案层；简单任务被同样的仪式拖慢；模型输出没有统一的结构化合同与策略挂点，门禁散落各处。

## Solution

新增 Agent Session Harness（低延迟、只读优先的 Intent/Plan/Steering 控制循环）：先检索门店事实/素材/经验，形成可见假设，只对高影响歧义问一个问题；任务分级（Level 0 确定性轻修改 / Level 1 纯 copy 免确认 / Level 2 复杂创作 Living Plan / Level 3 Campaign）；LLM 输出 PlanProposal，由确定性 Plan Compiler 补齐事实/权利/能力/quote 编译为 MarketingPlanRevision 与 plan-as-data 的 CompiledExecutionPlan；策略执行统一为中间件挂点。

## User Stories

1. As a 美业商家, I want 说一句模糊目标后 Agent 先解释它的理解并自动检索我已有的项目/素材/身份/历史, so that 我不用填表单、不被重复询问已知信息。
2. As a 美业商家, I want Agent 每轮最多问我一个真正影响结果的问题（低风险处采用可逆默认并显示假设）, so that 我不被连环追问。
3. As a 美业商家, I want 「删掉最后一句」这类确定性轻修改立即执行、不进任何 LLM 循环（Level 0）, so that 小改动零摩擦。
4. As a 美业商家, I want 纯文案生成免确认直达结果（Level 1，永久口径 U1），但报价 chip 常显「本次约消耗 N 分＋失败退还双态」、余额不足阻断并给双出口, so that 快而不失知情。
5. As a 美业商家, I want 复杂创作在同一条 Workstream 里长出 Living Plan 活文档（目标/本次制作/表达策略/事实与素材/预计积分时长）, so that 我确认前能看懂要做什么。
6. As a 美业商家, I want 用自然语言调整方案（「只做小红书」「再自然一点」「减到 4 页」），每次调整产生新 revision 且旧版本不被静默覆盖, so that 方案演变可追溯。
7. As a 美业商家, I want 方案里的价格/权利/费用永远来自系统事实而非模型编造（模型不写 quote/余额/rights/model availability）, so that 我看到的数字可信。
8. As a 没有门店资料的新商家（Day-0）, I want 自由创作不被 confirmed_store/project 阻断、生成不带虚构门店事实的通用文案, so that 第一天就能用。
9. As a 美业商家, I want 设定 Agent 主动度（稳妥/平衡/主动）, so that 系统的假设强度符合我的偏好。
10. As a Core 服务, I want 模型输入是权限裁剪后的最小投影（禁 Provider secret/跨 workspace/物理键/成本/原始 CoT），按域配上下文预算，超预算按相关性与事实权威排序, so that 上下文安全且不膨胀。
11. As a Core 服务, I want 模型输出 AgentTurnDecision 结构化合同（终局动作 ask/propose_plan/patch_plan/steer/propose_experience/finish；检索在 turn 内走 tools）经 Zod strict parse → 策略链后才生效, so that 自然语言只解释、动作全可校验。
12. As a Core 服务, I want partial output 只更新临时 Activity 与非权威 preview、repair 后替换同一 stable ID, so that 草稿永不写 canonical 状态。
13. As a Core 服务, I want 策略执行统一为中间件挂点：before/after model 钩子、wrap 式钩子、wrap_tool_call per-call 确定性拦截（拒绝返回模型可见 reason+门 id）、控制动作受限枚举 continue|end_turn|ask_merchant、执行序 pin 进 release；付费门恒 blocking、只读轮可 parallel, so that 门禁有统一载体且顺序可审计。
14. As a Core 服务, I want System-only 动作（reserve/settle/commit_fact/grant_rights/publish/final_commit）在提案层拦截（forbidden intent → {blocked,gateId,reason,nextAction}），本体只由确定性 orchestrator 产生, so that 模型永远拿不到业务授权。
15. As a Core 服务, I want CompiledExecutionPlan 是数据（typed unit 列表+依赖分组+有界重试默认关+workspace 隔离缓存），控制流留在 durable 代码、无 grammar 解释器、条件位禁副作用, so that 执行确定性与门禁挂载点不被破坏。
16. As a Core 服务, I want MarketingPlanRevision append-only 无状态列，readiness（ready/stale/blocked/reprice_required）恒为 projection, so that 方案没有第二 writer。
17. As a 平台工程师, I want AgentKernel port 薄封装（只为测试隔离与 AI SDK 大版本升级，无 durable checkpoint）, so that 会话循环可测可换版。
18. As a 平台工程师, I want AgentControlLimits 数值经 recorded/fixture 回放校准后随 release 发布（U11；未标定项显式 unset 并拒进生产路径）, so that 闸门数值是可审计事实。
19. As a 平台工程师, I want 工具注册表带 sideEffect/riskClass/approval/allowedPhases/maxCalls/timeout，工具按高价值工作流合并（非端点化）、检索类带 response_format, so that 工具面可治理。
20. As a 美业商家, I want 长会话自动压缩（6 段结构化摘要+retainedTail，成本平台承担、失败保留上次摘要不阻断 U4）, so that 会话可以一直聊下去。

## Implementation Decisions

- 状态机 idle→interpreting→retrieving→hypothesis_ready→(awaiting_clarification)→plan_compiling→plan_ready→(awaiting_approval 仅付费媒体)→handing_off→steering→completed；Level 0 不进状态机，Level 1 从 interpreting 直达 handing_off（V3.1 §21.1）。
- 免确认硬边界=纯 copy（零付费媒体），永久口径（U1），放宽须显式 supersede；判定权威 XHS §3.2/D-171③（附录 A13）。
- 模糊适配 L0–L3 由「影响类别×可逆性×权威来源」决定，不用单一置信度阈值；问题预算 Intent/Plan 各 1。
- Supervisor 单 Agent + per-invocation specialist（无长期记忆/账本/权限），eval 证明才加专家；delegation 受 maxDelegations。
- 六原语 read_context/generate/revise/record/check/ask_merchant；领域枚举不进原语签名（A8）；ask_merchant 超时=语义层默认回答（A12）。
- unit 重试默认关（A6/D-167③）：开启须幂等+provider 未受理+错误码在已发布 predicate 闭集；predicate 排除 validation/contract/rights/billing/accepted/acceptance_unknown；缓存 key 含 releaseId、workspace 隔离、敏感 unit 默认不可缓存。
- AgentControlLimits 一律从 release 冻结的 controlLimits 绑定读取（G 合同：artifact 内全量标定值）；消费侧读到未标定项即拒绝进入生产路径，不得以默认数值或 0/Infinity 代跳（U11）。
- Plan 编译链与新增 unit type 注册边界：新增 carrier/recipe 不改六原语与 executor 核心；新增 unit type 仍需注册/schema/policy/测试（V3.1 §22.2）。
- Recipe/Skill 沿用既有 StageTypeRegistry/RecipeCompiler（D-101 链扩容，非新架构，V3.1 §22.1）；本 spec 只做 registry 归并与 skill invocation receipt 记录，不新建注册表。
- 计费 UX 三规则（报价 chip 常显/余额阻断双出口/退还双态文案）在免确认路径为验收项（附录 A5）。

## Testing Decisions

- 主 seam：P1 action + SSE 事件流边界——断言分级判定、问题预算、假设可见、Plan revision append-only、readiness projection、策略拦截返回形态、Day-0 可达；不测 prompt 内容。
- Quick Checks 零 LLM 行为门进 CI（toolOrder 六原语序列、didNotCall('record') 只读负向断言、maxToolCalls）。
- Playwright journey（现存缝）：Day-0 自由创作（V3.1 §37.4-A）、Level 1 纯 copy（§37.4-B 的会话侧部分）、定制图文的检索/一问/Living Plan/调整（§37.4-C 前半）。
- 退出门（V3.1 §35 批次 2）：已有信息不重复询问；每轮最多一个问题；权利与事实高风险不被 LLM 默认；简单任务不因新链变慢。

## Out of Scope

执行确认与冻结快照消费（V3.1-C）；Artifact/Steering 执行侧（V3.1-D）；Memory 平台本体（V3.1-E，本 spec 只经 read_confirmed_experience 消费现有确认经验）；HarnessRelease 装配（V3.1-G，本 spec 按其合同引用 releaseId）。

## Further Notes

Prompt Pack 的 pack 划分与覆盖测试在 V3.1-G；本 spec 的 promptPack.resolveExact 按 G 的合同消费。压缩（B3/U4）在本 spec 落地，因 Session Harness 是其唯一消费者。
