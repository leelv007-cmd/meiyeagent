# 美业内容2 全项目深度评审报告（Agent Team）— 2026-07-24

> **评审基线**：HEAD `f2b8c3aa`（main）+ 未提交 composer WIP（提交门 / route-resolver 重构，656 insertions/336 deletions）
> **方法**：8 维度评审 lane 并行深评（Opus）+ 对每条 P0/P1 发现做独立对抗验证；共 **16 个 agent、2.0M tokens、537 次工具调用、23 分钟**。
> **对标**：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（100 条决策 D-001~D-100）+ PRODUCT.md/DESIGN.md/CONTEXT.md + 当前 P0/P1 spec。
> **站在已知基线上**：本轮明确复用并只在其上找新问题/验证旧结论——implementation-gap-ledger-2026-07-19、gptpro项目深度代码审查报告0722、product-walkthrough-gap-review-2026-07-18、admin-supply / ui-journey 07-21 评审、Pro Studio K7 验收。
> **配套**：优化报告见 `docs/reviews/full-project-optimization-report-2026-07-24.md`；原始 8 lane 逐条证据在评审工作流 journal（scratchpad）。

---

## 0. 发现统计

| 维度 lane | findings | P1 | P2 | P3 |
|---|---|---|---|---|
| A1 主链实现 & 文档匹配度（D-001~046） | 4 | 0 | 2 | 2 |
| A2 后台平台 & 多渠道供给（D-047~071） | 5 | 0 | 2 | 3 |
| A3 用户旅程 & 工作区 & Pro Studio（D-072~100） | 3 | 1 | 2 | 0 |
| B 架构 | 11 | 2 | 8 | 1 |
| C 性能 | 7 | 1 | 3 | 3 |
| D 安全 | 5 | 0 | 1 | 4 |
| E 可维护性 | 11 | 3 | 5 | 3 |
| F 产品完整度 & UX | 5 | 1 | 3 | 1 |
| **合计** | **51** | **8** | **26** | **17** |

**8 条 P1 全部经对抗验证 CONFIRMED；0 条 P0；0 条被驳回/误报。** 其中 2 条经独立验证后修正严重度为 P2（B-02、E-02，理由见正文），故**实质站住 6 条 P1**。安全 lane（D）未发现任何 P0/P1 代码漏洞——印证 GPT Pro 07-22 的 21 项修复已把安全面夯实。

---

## 1. 总体结论

**这是一个高度成熟、工程纪律硬核的代码库。主链已真实全落地并可用代码逐条求证，安全面经二轮独立验证全部在位，类型纪律达到标杆水平。它不处在"能不能跑通"的阶段，而处在"如何为规模化与团队协作做优化"的阶段。**

- **无 P0、无欺骗性差距**：未发现任何"文档声称已做、代码未做"的项；主链（D-026~D-046 + 25 票）、五段 Harness 真跑 DBOS、三进三出 HTTP+SSE 合同、token 字级流式、Day-0 ≤2 击、默认供给/额度/兑换/自由追问口——全部代码求证成立。
- **生产发布门是仓库外证据，不是代码欠账**：GitHub required checks、Provider Live 三模态双渠道 live 证据、C-12 网络边界证据、生产迁移、Stripe 退役审计等——这些不是"补一段代码"能解决的，评审已明确排除，不计入代码债。
- **真实的债集中在四条主线**（详见 §3 横切主题）：①"最后一公里未接线"复发（后端建好带单测、前端/接线/体验未接）；②体量集中 / 上帝对象（根因是单工作区聚合的持久化模型）；③规模化性能悬崖（事件溯源投影全量重放，测试全绿但上线数月翻车）；④apps/core 治理缺口（179k 行零 lint/knip，与 web 侧形成明确对照）。
- **一处在途 WIP 引入了真实回归**：未提交的 composer 统一执行快照重构把"营销身份"设为硬性冻结字段，而 Day-0 不 seed 身份 → 新租户首次创作静默失败（F-01，D-029 回归）。这是当前最紧急的单项，必须在 WIP 合入前修掉。

### 成熟度评分（本轮评审口径）

| 维度 | 评级 | 一句话依据 |
|---|---|---|
| 功能实现 & 文档匹配度 | **A−** | 主链全落地且可逐条求证；扣分仅在 last-mile 接线（最近创作区、harness 激活口径） |
| 架构 | **B+** | 脊柱正确克制（DBOS 纯核接缝、mutate 事务信封、import type 无运行时环）；系统性扣分在单聚合 god 对象与 canvas 双服务边界 |
| 性能 | **B** | 基础扎实（104 索引/86 Promise.all/缓存/事件驱动流）；两处规模化悬崖潜伏（B-01 写放大、C-01 投影全量重放） |
| 安全 | **A** | GPT Pro 21 项修复全在位、多租户纵深防御、密钥保险箱 AAD 绑定、SQL 全参数化；残余仅 P3 加固 + by-design 的信任集中 |
| 可维护性 | **B−** | 类型纪律标杆（core 0 any/0 TODO/0 hardcoded skip）**但**被上帝文件与 core 零 lint 治理缺口拖累 |
| 产品完整度 & UX | **B / B−** | 骨架强、诚实纪律硬核；扣分在 last-mile 未接线 + WIP 的 Day-0 回归 + 2/4 一级导航未产品化 |
| **综合** | **B+** | 成熟、可信、无阻断；有清晰且可执行的下一阶段优化重心 |

---

## 2. 确实做得好的（必须记功）

评审的价值不只在挑错。以下是经代码求证、值得保护不被"优化"破坏的资产：

**主链与匹配度（A1/A3）**
- **三进三出在 HTTP+SSE 边界真实成立**：三进=composer 提交 + 结构化决定 + 信号补记；三出=进度事件 + 成品版本 + token 帧（`workflow-events.ts` encodeWorkflowSseFrame 三类帧）。对话流是投影、真相在 ContentPackage。
- **五段 Harness 真接 DBOS 非 PoC**：`dbos-workflow.ts` 全用真 DBOS 原语（runStep/writeStream/recv/setEvent/closeStream），`workflow-core.ts` 零 DBOS import（D-038"step 纯函数内核"落地），五段与 D-033 逐条对应；awaitDecision 的确认卡等待由 admin-config 配置（默认 30 秒），超时以可审计的 ignored/policy 语义继续。
- **ADR-0007 token 字级流式端到端接通且逻辑正确**：token 与 progress 共享单调 sequence 计数器无碰撞，web 侧按 title/body/cta 三通道增量累积、cursor 单调去重不丢帧。
- **D-043 Day-0 ≤2 击有极严格真链 e2e 硬门**：走真实 Web→Core→Harness/DBOS HTTP+SSE 链，用 isTrusted 顶层点击计数断言纯文案路径精确=2 击、0 前置表单、0 阻塞卡。

**架构脊柱（B）**
- DBOS 外壳 vs 纯核接缝干净；`creation-execution-snapshot.ts` 是设计良好的服务器自持不可变执行根（deepFreeze + 拒绝二进制/provider 响应进入执行根 + superRefine）。
- `mutate<T>` 事务信封统一提供 authorize + workspace 锁 + 幂等 receipt + ContentPackage OCC 冲突审计——正确性基础设施扎实且集中。
- 跨域耦合以 `import type` 为主（编译期、无运行时环），无 p1 子系统间运行时循环依赖；main.ts 是单一 composition root。

**安全（D）**
- GPT Pro A-01~A-21 修复在当前 HEAD **全部真实在位、未回归**：SSRF 逐跳私网/mapped-IPv6 拒绝 + DNS-pinning、逐跳 authorization-HTTPS-only、Stripe 商业硬退役、payment webhook 原子 outbox + claim fencing、avatar 魔数校验、强密钥断言、C-12 SHA 全等。
- **多租户隔离是真正的纵深防御**：workspaceId 永远由 `resolveActiveWorkspace(session.user.id)` 服务端解析（客户端无法注入）、Core 侧 URL-vs-header 断言相等、per-query workspace 作用域、workflow events 显式 owns() DB 归属校验、secret store AAD 绑定 workspace。
- 凭据保险箱 AES-256-GCM + setAAD + 0o600；SQL 全参数化；无硬编码密钥；step-up 用不可变 session.createdAt 判 15min 窗。

**可维护性纪律（E）**
- **类型纪律标杆**：apps/core 产品码 0 个 `: any`、0 个 `as any`、0 个 `@ts-ignore`；strict + noUncheckedIndexedAccess 全开；仅 36 处 `as unknown as` 且集中在合理边界。
- **零自认债务**：全仓 0 个 TODO/FIXME/XXX/HACK；0 个硬编码 test.skip（~58 skip 全是 env-gated 持久层探针）；契约测试严守"不 import durable 载体"的 D 规则（全 core 仅 1 个测试 import @dbos）。

**性能基础（C）**
- 104 处 CREATE INDEX、86 处 Promise.all、能力清单代际缓存、harness token 流走 DBOS readStream 事件驱动（非轮询）、Web SSE 游标去重 + 自动重连、前端强制 gzip 预算门（canvas 450KB / web 350KB）。

**诚实纪律（贯穿全局）**
- 生产发布被外部门阻断时**诚实登记不伪造**（Pro Studio 发布门 BLOCKED 归外部环境、/pricing 不可用态是真诚实态非假 key）；D-024 三态诚实呈现（可直接交付/需确认后交付/暂时无法交付）落地。

---

## 3. 七大横切主题（本轮综合）

单条发现之上，8 lane 的结果聚成七个系统性模式。**这才是评审的核心结论**——它们解释了 51 条发现的根因，也定义了优化的重心。

### 主题一：「最后一公里未接线」复发 —— 项目反复警惕的头号根因
> 关联：A3-01(P1)、F-01(P1)、A1-01(P2)、F-04(P2)

后端能力建好、带单测、可求证，但**前端消费面 / 接线 / 体验的最后一环缺失或被门控**，导致"验收绿≠体验通"。
- **A3-01**：D-097「创作首页最近创作」的 core 投影（`recent-projection.ts` projectRecent/桌面6移动4/状态驱动下一动作）已建且带单测，但 web 全库 grep `recent_list` **零命中**——创作首页四层之后既无最近创作也无示例区。
- **F-01**：Day-0 身份门（WIP 引入，见主题七）。
- **A1-01**：整条五段 Harness 主链被标为"Optional"的环境变量（`HARNESS_DBOS_SYSTEM_DATABASE_URL`）门控，未设时所有 composer 路由静默落 404，`.env.example` 措辞误导、web 无能力探测/降级文案。
- **F-04**：四个一级导航里「内容」「素材」两个仍投影工程/英文对象词，未按 #130 产品化（2/4 目的地非商家就绪）。

**这是最该建立机制防复发的主题**（优化报告给出"后端投影→前端消费"的验收对账门建议）。

### 主题二：体量集中 / 上帝对象 —— 根因是持久化模型
> 关联：B-01(P1)、E-01(P1)、E-02(P2)、B-02(P2)、E-05(P2)、E-06(P2)、A2-03(P3)、B-08(P2)

少数文件承载了不成比例的复杂度：`operations/application-service.ts` **10,078 行单类**、`model-supply/foundation-module.ts` 6,371、`index.ts` 5,647、`integrations/application-service.ts` 4,200、`product-service.ts` 单个 apply() 方法 **1,557 行**。
**关键洞察（B-01 揭示的根因）**：Operations god 对象之所以拆不动，是因为持久化把整个工作区当成**一个聚合** `OperationsWorkspaceState`——每次写都 `pg_advisory_xact_lock(工作区)` 串行化 + 全量 load 22 表 + 全量 save。所以这既是可维护性问题，**也是性能悬崖**（见主题三），且是 `contract-spine-freeze` 文档实证的合并咽喉。**拆分必须先拆持久化写边界，否则只是搬代码。**

### 主题三：规模化性能悬崖 —— 测试全绿，上线数月翻车
> 关联：B-01(P1)、C-01(P1)、C-02(P2)、C-03(P2)、C-04(P2)

两处**事件溯源投影全量重放**是最大潜伏悬崖，在新数据/1928 用例全绿下完全不显形：
- **B-01**：Operations 每次写 O(工作区历史) 读写放大 + 单锁串行（每建一个任务都重载并重写全部审计历史）。
- **C-01**：额度/用量投影在**最热读路径**（几乎每个前端交互都触发的配额检查）上，全量重放账号全生命周期用量事件 + 4 次串行查询，无窗口/无快照。重度商家一年累积数万 usage 行 → 每次配额检查线性劣化。
- 另有三处确定性 N+1 / JSONB 无索引排序 / 1s 固定轮询（C-02/C-03/C-04）。

### 主题四：apps/core 治理缺口 —— 一个配置门就是共同根因
> 关联：E-03(P1)、E-08(P3)、E-09(P3)、A1-04(P3)

**全仓最大的手写子系统 apps/core（179k 行）与 packages/contracts 完全没有 Biome lint/format、没有 knip 死代码检测、noUnusedLocals 未开**，唯一静态门是 tsc；而 apps/canvas 和 web 两者俱全。这个不对称是下游多个发现的**共同根因**：混用 tab/2-space 缩进（E-08，7 个最大文件命中）、死代码静默滞留（E-09，ArkDirectVideoProvider/ensurePersonalWorkspace）、WIP 新文件继续引入 tab 漂移（A1-04）。**这是全报告最高 ROI 的单项——配置改动而非代码重构。**

### 主题五：安全成熟，残余是加固层（非漏洞）
> 关联：D-01(P2)、D-02~D-05(P3)

GPT Pro 21 项修复全在位、多租户纵深防御成立。新发现均为**加固/纵深**，无 P0/P1：
- **D-01（最可操作）**：两个邮件 provider 在缺字段告警路径 `console.warn` 打印收件人邮箱 + 完整 HTML 正文（含一次性认证 token URL）——GPT Pro A-11 脱敏未覆盖 mail provider 层，`EMAIL_FROM` 未配即触发凭据泄露。
- **D-05（by-design 但集中度高）**：整个多租户+提权边界在 service-token 门后坍缩为对 `x-workspace-id`/`x-core-actor`/`x-workspace-role` 头的信任，单一 `CORE_SERVICE_TOKEN` 泄露即可冒充任意租户 + 声明 admin/worker/payment（由 C-12 网络边界外部兜底）。
- D-02（CSRF 仅靠 SameSite=Lax 无纵深）、D-03（IPv6 私网归一化不全）、D-04（BYOK live endpoint 无 HTTPS 守卫）均为低可利用性加固项。

### 主题六：过渡态双路径长期挂账 —— 无退役触发点
> 关联：B-09(P2)、E-02(P2)、A2-04(P3)、E-11(P3)

多处"新旧并存"缺明确退役判据，会无限期累积复杂度与测试面：
- **B-09/E-02**：Cutover 让 legacy ProductService（含 1,557 行 apply）与 relational/p1 版按工作区归属二选一路由，每工作区双控制面初始化，代码中看不到 legacy 退役触发点。
- **A2-04**：`MODEL_EXECUTION_MODE=gateway` 是可选生产模式却装配 recorded 假响应（foot-gun）；**E-11**：三套并行错误分类法（P1DomainError 898 / OperationsError 345 / product DomainError 158）。

### 主题七：未提交 WIP 风险 —— 大额、未过 CI、且引入回归
> 关联：F-01(P1)、E-10(P2)、A1-03(P3)、A1-04(P3)

composer 提交路径重构（20 文件改 + 6 新文件，656 insertions）**结构上已接线完整**（ComposerRouteResolverPort 抽出并实例化、各新文件带测试），但：
- **引入真实回归 F-01**（Day-0 身份门，见主题一）——**这是当前最紧急的单项**。
- **E-10**：一大坨未提交、未过 required CI、未经评审的核心提交路径改动，有丢失风险 + 评审债累积；且新 core 文件用 tab 缩进加剧主题四。
- **A1-03**：留下无 web 消费方的冗余 composer 投影端点（与统一 workflows/events 重复）。

**处置口径**：本报告对 WIP 内发现均已加"未提交/若如此落地"caveat；建议 WIP 尽快在特性分支提交、修掉 F-01、跑全量门后再评审合入。

---

## 4. 按维度详细发现

> 每条含：严重度 · 验证裁决 · 是否新发现 · 位置 · 问题 · 影响 · 建议。P1 与关键 P2 展开，其余见 §5 汇总表。

### 4.1 功能实现 & 文档匹配度（A1/A2/A3）

**总判**：主链与设计文档匹配度好，无欺骗性差距；后台/供给子系统成熟、无系统性过度工程；旅程主链连通。缺口集中在 last-mile 接线与运维口径。

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| **A3-01** | **P1** | CONFIRMED | 创作首页四层后缺「最近创作」+「示例」区：core recent_list 投影已建带单测，web 零消费 |
| A1-01 | P2 | — | 五段 Harness 主链被标"Optional"环境变量门控且无优雅降级，默认配置下主创作动作硬 404 |
| A1-02 | P2 | — | 在途 Harness 结构化问题卡在 result 视图无内联落点也无收件箱入口 |
| A2-01 | P2 | — | RouteSnapshot 未收敛为单一权威类型：五形态 + 885 行双向归一化器（S2b 承诺未兑现） |
| A2-02 | P2 | — | 生产 capability hot assembly head 无条件硬编码 RECORDED_CATALOG_REVISION_ID，effective revision 恒显假标签 |
| A3-02 | P2 | — | 唯一最近创作页 /dashboard/recent 孤立且用错投影（无导航入口 + 通用「打开」文案 + 链到内容页） |
| A3-03 | P2 | — | 约 2200 行 pre-rebuild 死码幸存 Z1 退旧（含 D-076 示例组件 example-store-preview） |
| A1-03 | P3 | — | Composer 专属投影端点无 web 消费方，与统一 workflows/events 冗余（WIP 在途） |
| A1-04 | P3 | — | 未提交 composer WIP 三文件用 tab 缩进、与周边 2-space 漂移，core 无 format 门拦截 |
| A2-03 | P3 | — | 两个供应 god-object（foundation-module 6371 / index 5647）维护面过载 |
| A2-04 | P3 | — | gateway 生产执行模式实为 recorded stub，可选生产模式返回假响应（foot-gun） |
| A2-05 | P3 | — | supportsDeployment 无 capability head 时 fail-open（返回 true），生产恒 seed 缓解 |

**A3-01（P1 · CONFIRMED · 新）** — `dashboard/index.tsx:98` 仅渲染 `<ComposerHome>`，其 JSX 收束于 ComposerToolsStrip（第四层），四层之后既无最近创作区也无示例冷态；而 core `result-delivery/recent-projection.ts` 的 projectRecent/recentLimitForViewport（桌面6/移动4）/nextActionLabelForRecent 已建且带单测，foundation-module `case 'recent_list'` 就绪。web 全库 grep `recent_list` 零命中。**影响**：门店主离开运行任务返回首页后主轴上无法"一眼接续"最近作品，破坏 D-032 Day-0=Day-N 连续性与 D-097。验证确认 WIP 与 HEAD 版本一致（非 WIP 删除，而是从未接线）。**建议**：dashboard 首页四层之后新增 RecentCreations strip 消费 `recent_list` + 复用现存 example-store-preview 冷态。

**A1-01（P2 · 新角度）** — `main.ts:287` 用 `HARNESS_DBOS_SYSTEM_DATABASE_URL` 三元门控整条 harness；未设时 composer 路由全被跳过、落 `server.ts:2368` 的 404；`.env.example:38` 却标注"Optional production five-stage Harness"且留空，web 无 404 探测/降级。**影响**：按文档 fresh clone + `pnpm dev` 后点"生成"得静默 404 + 通用失败 toast，对一个明确拒绝 MVP 式残缺的产品是运维诚实度缺口。**建议**：措辞改为"主创作链路载体，未配则 composer 不可用" + web 加能力探测降级文案 + DEV-START 默认拉起 system DB。

**A2-01（P2）** — spec S2b 承诺"四形收敛为单一权威类型"，实际仍并存 5 个 RouteSnapshot 形态（含两个同名 `RouteSnapshot` 字段集不同）靠 885 行/19 转换函数双向桥接。是 model-supply 最集中的过度工程症状，也造成 07-20 审计与 07-21 评审对 #108 完成口径分叉。**建议**：收敛为单一 SSOT + 单向 adapter，或撤回 S2b"单一权威类型"措辞并文档化多形态为终态。

### 4.2 架构（B）

**总判**：架构主干成熟克制、脊柱正确（DBOS 仅外壳、mutate 事务信封、contracts barrel、跨域 import type 无运行时环）。真缺陷集中在两处系统性模式——单聚合 god 对象、同型 god 文件——以及 canvas 双服务边界、harness 越界直读 operations 内脏表。**多为可维护性/演进速度风险而非正确性 bug（1928 测试全绿佐证）**，但随工作区历史增长与并行车道扩张会逐步咬人。

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| **B-01** | **P1** | CONFIRMED | Operations god 对象根因=单工作区聚合+单 advisory 锁，每次写全量 load/save 22 表历史 |
| B-02 | ~~P1~~→**P2** | CONFIRMED→降级 | model-supply/index.ts 与 foundation-module.ts 是混杂多子系统的 god 文件 |
| B-03 | P2 | — | Pro Studio 维护整套并行生成生命周期状态机 + 独立 usage/cost 孤岛（非重复扣费） |
| B-04 | P2 | — | 实际拓扑=两个直连同一 PG 的 Node 服务 + 混合边界，偏离 D-032"单 Node 服务" |
| B-05 | P2 | — | Harness 绕过 OperationsApplicationService，直读 operations 内脏表与领域构造器 |
| B-06 | P2 | — | contracts 非 Composer 执行快照的唯一事实源：本地重声明 schema + lens 双词汇（image_text vs image） |
| B-07 | P2 | — | Composition root 用惰性 thunk 打破 god 对象循环依赖，init 顺序脆弱 |
| B-08 | P2 | — | 同型 god 对象：IntegrationApplicationService(~4200) 与 legacy ProductService(3601) |
| B-09 | P2 | — | Cutover 双路径长期并存且无显式退役触发点，每工作区双控制面初始化 |
| B-11 | P2 | — | 补偿/失效 worker 绑定 HTTP 进程 setInterval，多副本安全性需逐一验证 |
| B-10 | P3 | — | server.ts 是 2373 行手写 regex 路由（raw http.createServer，无路由框架） |

**B-01（P1 · CONFIRMED · 新）** — `OperationsApplicationService`（10,078 行、~130 方法、12 职责簇）之所以拆不动，根因是持久化把整个工作区当成一个 `OperationsWorkspaceState` 聚合：每次 mutate 都 `pg_advisory_xact_lock(hashtext(workspaceId))` 串行化该工作区所有写 → `loadWorkspace` 全量读入 22 collection（含无界增长的 auditEvents/taskEvents/creationEvents）→ `saveWorkspace` 对全部 22 collection 逐行 upsert。验证逐条核实（71 处 mutate 全走此路径，audit 几乎每 mutate 必增）。**影响**：单写 O(历史)、生命周期累计近 O(历史²) 的写放大 + 单锁串行化；验证期少商户无感，但一个试点商户数月运营即可累积上千 audit 行，届时每次写都在串行锁下发上千条 no-op INSERT。也是 `contract-spine-freeze` 文档明令"不得给此类加方法"的合并咽喉。**建议**：按子聚合切写边界（ContentPackage/CreativeJob/Task/Template 各独立 service 共享轻量 WorkspaceMutationContext），行级锁/OCC 替代整工作区 advisory 锁，auditEvents 等 append-only 集合剥离仅追加不回读。**这是主题二（god 文件）+ 主题三（性能悬崖）的共同根因，最高结构性 ROI。**

**B-04（P2 · 新）** — apps/canvas 是独立 Next.js Node 服务（端口 4200），自开 `new Pool` 直连同一 PG 又持 CORE_SERVICE_URL 回调 core，边界混合（直写自有 canvas/计费校验表 + HTTP 委托 provider 执行/采纳给 core）。偏离 D-032"单 Node 服务"。**风险**：两进程各开连接池、两个迁移属主、"哪些 canvas 直写 DB 哪些委托 core"边界分散。**建议**：要么 canvas 收敛为纯 BFF（全状态变更走 core），要么正式记为独立有界上下文、明确其独占表集并写进 ADR + 更新 D-032 拓扑描述。

**B-05（P2）** — `harness/postgres-store.ts` 直接 import operations 内部 `buildContentPackage`、`PostgresStoreFactLedger`，并 `join p1_content_packages`。即 harness durable store 用 operations 私有领域构造器物化 ContentPackage、直读 operations 独占聚合表，而非经持有锁+OCC 的 OperationsApplicationService 端口。**建议**：为 harness 提供只读 ContentPackage 端口（返回 contracts 投影类型），或写路径统一经 adoptHarnessCandidate 走锁+OCC。

### 4.3 性能（C）

**总判**：性能工程整体成熟（104 索引、86 Promise.all、能力缓存、事件驱动 token 流、bundle 预算门）。真正的债集中在两类：事件溯源投影缺快照（C-01，最大潜伏悬崖）+ 若干 N+1 / JSONB 排序全扫。**在新数据下完全不显形（1928 全绿），是典型"测试绿但规模化翻车"。**

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| **C-01** | **P1** | CONFIRMED | 额度/用量投影在最热读路径全量重放账号全生命周期事件，无窗口/快照 + 4 次串行查询 |
| C-02 | P2 | — | 模型生成任务控制台：JSONB 表达式排序无索引全排序 + 分面每请求全 workspace 扫描 + OFFSET 分页 |
| C-03 | P2 | — | listAutomaticSeriesSuggestions 的 N+1：逐 series 资产查全量 lifecycle 只为取最后一条 |
| C-04 | P2 | — | 视频工作流 SSE 固定 1s 轮询：每 tick 双查 + 全快照 structuredClone；owns 走 JSONB 无索引扫描 |
| C-05 | P3 | — | 常驻 outbox 轮询器间隔激进（canvas 文本 250ms）且无空闲退避，稳态持续 DB claim 负载 |
| C-06 | P3 | — | 前端全库零列表虚拟化，内容库/成品历史长列表整表渲染进 DOM |
| C-07 | P3 | — | 创作提交解析源资产 data class 时逐个顺序 await（可并行的小 N+1） |

**C-01（P1 · CONFIRMED · 新）** — `entitlement-service.ts:705` 的 `projectionFromStore` 每次调用都：(a) 读该 workspace 全部计划事件（无界），(b) 在 `for(resource of RESOURCES)` 循环里**顺序** await 4 次 `listUsageEvents`（每次读该资源全历史，无 LIMIT/无 created_at 下界），内存累加。而它有 10+ 热调用点（额度表渲染、composer 加载、submit 预检等每次配额检查）。生产装配的 grant-lot 子类还额外叠加 synchronize+rebuild。**影响**：读延迟随账号生命周期 O(N事件) 线性增长，重度商家一年累积数万 usage 行则每次前端交互触发的配额检查都拉取并累加全历史；新库/测试完全不显形，上线数月后成读路径悬崖。**建议**：①立即把 4 次顺序改 Promise.all（零语义变更省 3 RTT）；②SQL 加 `created_at >= 周期起点` 只读当期；③引入按月 rollup/snapshot，投影只重放 snapshot 后增量。

### 4.4 安全（D）

**总判**：安全成熟度高。GPT Pro A-01~A-21 修复在当前 HEAD 全部真实在位、未回归；多租户隔离纵深防御经代码证实；SQL 全参数化、无硬编码密钥、密钥保险箱 AAD 绑定。**新发现均为加固层，无 P0/P1 代码漏洞。** 最大残余风险不是缺陷而是信任集中度（by-design，C-12 外部兜底）。

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| D-01 | P2 | — | 邮件 provider 缺字段告警路径 log 收件人邮箱 + 完整 HTML 正文（含一次性认证 token URL） |
| D-05 | P3 | — | 多租户+提权边界集中于单一 CORE_SERVICE_TOKEN + 头信任模型 |
| D-02 | P3 | — | 自定义 Core 代理变更路由的 CSRF 防御仅依赖 SameSite=Lax，无 Origin/CSRF-token 纵深 |
| D-03 | P3 | — | isPublicIpv6 默认放行，未归一化/拦截 IPv4-compatible IPv6 与 NAT64 形式 |
| D-04 | P3 | — | BYOK live 适配器 fetch endpoint 无 HTTPS/私网守卫 |

**D-01（P2 · 最可操作 · 新）** — `mail/provider/resend.ts:52` 与 `cloudflare.ts:60` 的 sendRawEmail 在 `if(!from||!to||!subject||!html)` 分支 `console.warn(..., {from,to,subject,html})`——含收件人邮箱与完整 HTML 正文，而密码重置/邮箱验证邮件的 html 内嵌一次性 token URL。GPT Pro A-11 脱敏未覆盖 mail provider 层。**影响**：`EMAIL_FROM` 未配是单点误配，会使每封重置/验证邮件把含 token 的 html 写日志，有日志访问者可用 token 接管账号。**建议**：该分支只记录缺失字段名，禁止打印 to/html/subject 原文，与 A-11 口径对齐。

**D-05（P3 · by-design）** — Core 在全局 service-token 门后完全信任 `x-workspace-id`/`x-core-actor`/`x-workspace-role` 头，单一 CORE_SERVICE_TOKEN 泄露即可冒充任意租户 + 声明 admin/worker/payment 提权。缓解=C-12 网络边界（Core 仅 service binding）+ 强密钥断言，但代码层无第二因子。**建议**：考虑 per-actor token 或调用方身份签名，使 payment/worker/admin 提权不共用同一代理 token；至少把 CORE_SERVICE_TOKEN 轮换/最小暴露列入发布 SOP。

### 4.5 可维护性（E）

**总判**：类型纪律标杆（core 0 any/0 TODO/0 hardcoded skip、契约测试隔离达标）。主要债集中在"体量集中"（上帝文件，域接缝其实已清晰、可低风险拆分）+ 最大系统性风险=治理缺口（core 零 lint/knip）。

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| **E-01** | **P1** | CONFIRMED | operations/application-service.ts 单个 10,078 行上帝类 + 107-case 分派镜像 |
| **E-03** | **P1** | CONFIRMED | apps/core（179k 行）与 contracts 无 Biome lint/format、无 knip、noUnusedLocals 未开——治理根缺口 |
| E-02 | ~~P1~~→**P2** | CONFIRMED→降级 | product-service.ts 单个 apply() 方法 1,557 行 / 40-case switch / 85 if 分支，仍在生产装配 |
| E-04 | P2 | — | Postgres 事务样板（BEGIN/COMMIT/ROLLBACK/release）在 39 个文件 copy-paste，无共享 helper |
| E-05 | P2 | — | model-supply/index.ts 是被误用为实现文件的 barrel（5647 行含 3132 行上帝类 + 10 类） |
| E-06 | P2 | — | integrations/application-service.ts 单个 4200 行上帝类混装抖音+飞书+连接生命周期 |
| E-07 | P2 | — | operations dispatch 内三种输入校验纪律并存，create_task 等用 `as unknown as` 裸转绕过校验 |
| E-10 | P2 | — | 未提交 composer WIP 656 行已接线但未过评审/CI，且引入 tab 缩进加剧风格漂移 |
| E-08 | P3 | — | 7 个最大 core 文件同文件混用 tab 与 2-space 缩进 |
| E-09 | P3 | — | 死代码：ArkDirectVideoProvider 生产零使用仍从包根 barrel 导出；GL-27 ensurePersonalWorkspace 0 调用者 |
| E-11 | P3 | — | 三套并行错误分类法（P1DomainError 898 / OperationsError 345 / product DomainError 158） |

**E-01（P1 · CONFIRMED · 新）** — 全库最大产品文件是单个 `OperationsApplicationService`（10,078 行、~130 方法、横跨 10 领域簇），被 `operations/foundation-module.ts` 的 107-case 分派表 1:1 镜像耦合（101/107 直接转发 this.operations.<method>）。最长方法 prepareCreativeJob 477 行。**影响**：每次修改要在近万行 + 107 分支两处同步导航，是合并冲突最大热点；功能可用（真机 0 fail）故为债务非缺陷。**建议**：沿已清晰的域簇拆 ~10 个子服务，god 类降级为组合门面；可增量（一次抽一域簇），靠现有 2527 行 application-service.test.ts 回归护航。**注意 B-01 揭示：拆分须先拆持久化写边界。**

**E-03（P1 · CONFIRMED · 新 · 最高 ROI）** — apps/core 与 packages/contracts 的 `check` 脚本都只是 `tsc --noEmit`，无 Biome、无 knip、无 pre-commit 钩子、CI 无 lint；tsconfig 未开 noUnusedLocals（连未用 import 都不报）。而 canvas/web 两者俱全（web 还有 knip + noUnusedLocals）。验证确认：即使 root-quality job 跑 `pnpm check`，因 core 的 per-package check 是纯 tsc，biome 也到不了 apps/core（"core 全程零 lint"核心论点精确成立）。**影响**：179k 行长期无 lint/format/死代码门，是 E-08/E-09/A1-04 的共同根因，团队规模扩大后维护成本最大杠杆点。**建议**：给 core+contracts 的 check 加 `biome check` 并入 CI required 门 + tsconfig 开 noUnusedLocals/noUnusedParameters + core 增配 knip；首次开启需一次 format + 清理批。

### 4.6 产品完整度 & UX（F）

**总判**：产品骨架强、诚实纪律硬核，但主创作旅程正处 P0 #129 统一执行主干的未提交 WIP 重构中期。历史走查 P0 绝大多数已真实闭环（视频可达、token 流式、兑换码内联、投影矛盾消解、配额单口径、trial 媒体供给到位）。最大新风险=WIP 的 Day-0 身份回归。团队自身"当前不可宣称可试点/可面世/宣发闭环≥1"的结论成立。

| id | sev | 裁决 | 标题 |
|---|---|---|---|
| **F-01** | **P1** | CONFIRMED | Day-0 新租户首次创作被硬性营销身份要求阻断，静默失败（WIP 引入的 D-029 回归） |
| F-02 | P2 | — | 提交失败反馈被单一"选择创作类型"提示覆盖三种不同失败原因，误导商家 |
| F-03 | P2 | — | 所选创作类型的模型/报价不可用时，提交按钮永久禁用且仅静音微文案，无恢复路径 |
| F-04 | P2 | — | 四个一级导航中「内容」「素材」两个仍未产品化，泄漏工程/英文对象词（2/4 目的地非商家就绪） |
| F-05 | P3 | — | grounding「缺授权素材」阻塞态缺可操作入口（与「缺门店」态不对称） |

**F-01（P1 · CONFIRMED · 新 · 最紧急）** — 未提交的统一执行快照（P0 #129）把营销身份设为强制冻结字段：客户端 `composer-submission-client.ts` 的 identity 是非可选 schema，服务端 `composer-submission-gate.ts:228` 在身份缺失/未激活/revision 不符时直接抛错，composer 的 runCreate/attemptSubmit 在 `!identitiesQuery.data?.[0]` 时提前 return。但 Day-0 `provisionTrial` 只激活额度+设模型默认，**不 seed 任何营销身份**，新租户身份列表为空。验证确认三点证伪均不成立（`git show HEAD` 无 identitiesQuery=WIP 新增；无其他 seed 路径；后端 harness 本设计支持无身份中性回退——`langfuse-prompts.ts:12` "use a neutral official brand voice and return an empty identityRefs array"、`policy-gates.ts:198` "改用门店中性表达"）。**影响**：每个新租户 Day-0 选好类型、输入意图、点提交后无法创作任何内容，必须先自行导航素材页手动登记身份——重新引入 D-029/D-043 明确禁止的前置建档门，且失败反馈误导（叠加 F-02）。**建议**：二选一——(a) Day-0 provisionTrial 或首个 store 登记时 seed 一个"门店中性/官方口吻"默认身份；(b) 让 CreationExecutionSnapshot 的 identity 可选、缺失时冻结为 neutral、服务端 gate 放行空身份、前端走中性表达。**切勿把身份登记变成创作前置表单。**

---

## 5. 全 51 条发现汇总表

> 按严重度→lane 排序。sev 括注为经验证修正后的严重度。verdict 仅对 P0/P1 做了对抗验证。

| lane | id | sev | verdict | dim | new | 标题 |
|---|---|---|---|---|---|---|
| A3 | A3-01 | P1 | CONFIRMED | feature-gap | Y | 创作首页缺最近创作+示例区，core recent_list 投影 web 零消费 |
| B | B-01 | P1 | CONFIRMED | performance | Y | Operations god 对象根因=单聚合+单锁，每写全量 load/save 22 表 |
| C | C-01 | P1 | CONFIRMED | performance | Y | 额度投影最热读路径全量重放全生命周期事件+4 次串行查询 |
| E | E-01 | P1 | CONFIRMED | maintainability | Y | operations/application-service.ts 10,078 行上帝类+107-case 分派 |
| E | E-03 | P1 | CONFIRMED | maintainability | Y | apps/core+contracts 无 biome/knip/noUnusedLocals，治理根缺口 |
| F | F-01 | P1 | CONFIRMED | feature-gap | Y | Day-0 新租户创作被 WIP 身份门阻断，静默失败（D-029 回归） |
| B | B-02 | P2(←P1) | CONFIRMED | maintainability | Y | model-supply index.ts/foundation-module.ts 混杂多子系统 god 文件 |
| E | E-02 | P2(←P1) | CONFIRMED | maintainability | Y | product-service.ts 单个 apply() 1,557 行仍在生产 cutover 装配 |
| A1 | A1-01 | P2 | — | spec-mismatch | N | 五段 Harness 被标 Optional 环境变量门控无降级，默认硬 404 |
| A1 | A1-02 | P2 | — | product-ux | Y | 在途 Harness 问题卡在 result 视图无内联落点/无收件箱入口 |
| A2 | A2-01 | P2 | — | architecture | N | RouteSnapshot 五形态+885 行归一化器，S2b 单一权威类型未兑现 |
| A2 | A2-02 | P2 | — | maintainability | N | 生产 capability head 硬编码 recorded 标签，effective revision 失真 |
| A3 | A3-02 | P2 | — | spec-mismatch | Y | /dashboard/recent 孤立且用错投影，无导航入口+通用文案+链内容页 |
| A3 | A3-03 | P2 | — | maintainability | Y | ~2200 行 pre-rebuild 死码幸存 Z1 退旧（含示例组件） |
| B | B-03 | P2 | — | architecture | Y | Pro Studio 并行生成生命周期状态机+独立 usage/cost 孤岛 |
| B | B-04 | P2 | — | spec-mismatch | Y | 两个直连同一 PG 的 Node 服务+混合边界，偏离 D-032 单服务 |
| B | B-05 | P2 | — | architecture | N | Harness 绕过 OperationsApplicationService 直读内脏表与构造器 |
| B | B-06 | P2 | — | maintainability | Y | 执行快照本地重声明 schema+lens 双词汇（image_text vs image） |
| B | B-07 | P2 | — | architecture | Y | Composition root 惰性 thunk 打破 god 对象循环依赖，init 脆弱 |
| B | B-08 | P2 | — | maintainability | N | 同型 god 对象：Integration(~4200)+legacy Product(3601) |
| B | B-09 | P2 | — | architecture | Y | Cutover 双路径长期并存无退役触发点，每工作区双控制面初始化 |
| B | B-11 | P2 | — | architecture | N | 补偿/失效 worker 绑 HTTP 进程 setInterval，多副本安全性需验证 |
| C | C-02 | P2 | — | performance | Y | 任务控制台 JSONB 排序无索引全排序+分面全 workspace 扫描+OFFSET |
| C | C-03 | P2 | — | performance | Y | listAutomaticSeriesSuggestions N+1，逐 series 查全量 lifecycle |
| C | C-04 | P2 | — | performance | Y | 视频 SSE 固定 1s 轮询+全快照 structuredClone+owns JSONB 无索引 |
| D | D-01 | P2 | — | security | Y | 邮件 provider 告警路径 log 收件人邮箱+完整 HTML（含认证 token） |
| E | E-04 | P2 | — | maintainability | Y | Postgres 事务样板在 39 文件 copy-paste，无共享 helper |
| E | E-05 | P2 | — | maintainability | Y | model-supply/index.ts barrel 被误用为实现文件（5647 行 10 类） |
| E | E-06 | P2 | — | maintainability | Y | integrations 4200 行上帝类混装抖音+飞书+连接生命周期 |
| E | E-07 | P2 | — | maintainability | Y | operations dispatch 三种校验纪律并存，create_task 裸转绕过校验 |
| E | E-10 | P2 | — | maintainability | Y | 未提交 composer WIP 656 行已接线但未过评审/CI+引入 tab 漂移 |
| F | F-02 | P2 | — | product-ux | Y | 提交失败单一"选择创作类型"提示覆盖三种失败原因，误导商家 |
| F | F-03 | P2 | — | product-ux | Y | 模型/报价不可用时提交按钮永久禁用+仅静音微文案，无恢复路径 |
| F | F-04 | P2 | — | feature-gap | N | 「内容」「素材」两个一级导航未产品化，泄漏工程/英文对象词 |
| A1 | A1-03 | P3 | — | maintainability | Y | Composer 专属投影端点无 web 消费方，与统一 workflows/events 冗余 |
| A1 | A1-04 | P3 | — | maintainability | Y | 未提交 composer WIP 三文件 tab 缩进漂移，core 无 format 门 |
| A2 | A2-03 | P3 | — | maintainability | Y | 两个供应 god-object（core 第二/三大文件）维护面过载 |
| A2 | A2-04 | P3 | — | architecture | Y | gateway 生产执行模式实为 recorded stub，返回假响应 |
| A2 | A2-05 | P3 | — | security | N | supportsDeployment 无 capability head 时 fail-open，生产恒 seed 缓解 |
| B | B-10 | P3 | — | maintainability | Y | server.ts 2373 行手写 regex 路由（raw http.createServer） |
| C | C-05 | P3 | — | performance | Y | 常驻 outbox 轮询器间隔激进（250ms）无空闲退避 |
| C | C-06 | P3 | — | performance | Y | 前端全库零列表虚拟化，长列表整表渲染进 DOM |
| C | C-07 | P3 | — | performance | Y | 创作提交解析源资产逐个顺序 await（可并行小 N+1） |
| D | D-02 | P3 | — | security | Y | Core 代理变更路由 CSRF 仅靠 SameSite=Lax，无 Origin 纵深 |
| D | D-03 | P3 | — | security | Y | isPublicIpv6 默认放行，未拦 IPv4-compatible/NAT64 |
| D | D-04 | P3 | — | security | Y | BYOK live 适配器 endpoint 无 HTTPS/私网守卫 |
| D | D-05 | P3 | — | security | Y | 多租户+提权边界集中于单一 CORE_SERVICE_TOKEN+头信任 |
| E | E-08 | P3 | — | maintainability | Y | 7 个最大 core 文件混用 tab 与 2-space 缩进 |
| E | E-09 | P3 | — | maintainability | Y | 死代码 ArkDirectVideoProvider 仍 barrel 导出+ensurePersonalWorkspace 0 调用 |
| E | E-11 | P3 | — | maintainability | Y | 三套并行错误分类法（P1DomainError/OperationsError/product DomainError） |
| F | F-05 | P3 | — | product-ux | Y | grounding 缺授权素材阻塞态缺可操作入口（与缺门店态不对称） |

---

*本报告为固定基线快照（HEAD `f2b8c3aa`，2026-07-24）。可执行优化项、ROI 排序与路线图见配套优化报告。*

