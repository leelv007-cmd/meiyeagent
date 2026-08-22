# 丽客美页 Agent Workflow 全项目落地、架构与修复复核报告

> 日期：2026-08-19
> 审计基线：本地 `main@b45178ab8d500cbf9c194f4f4b1905d627323f13`
> 远端对照：`meiyeagent/main@0de2e305752f952091de75a9fa9cd0e10d36f975`
> 权威输入：主决策日志；D-170→`docs/specs/pro-studio-retirement-spec-2026-08-01.md`；D-171→`docs/specs/xhs-vertical-integration-spec-2026-08-01.md`；D-172→`docs/specs/credit-billing-spec-2026-08-01.md`；D-178→V3.1 主计划与 A–I 九张本地 spec。远程 issue 仅为历史元数据
> 方式：8 条只读 Agent 分线 + 当前内置浏览器现场 + 代码/路由/持久化/CI/退役扫描 + 聚焦测试
> 变更边界：本报告不修改产品代码、不安装依赖、不重启服务、不拼接不同 SHA 的证据

## 0. 最终裁决

**项目不是“全部未落地”，但也绝不是完整可交付状态。**

当前已经具备一条真实的产品骨架：

- 单 Dashboard 与五项商家主导航存在；
- 定制创作、自由创作、`copy | note | media` 三类产品 carrier（覆盖 copy/note/image/video 四条成品路径）、Thread/Run、ExecutionPlanSnapshot、DBOS Make、ContentPackage、Credits、Result/Works、素材、门店、Memory、Admin 等主要对象和路由均有生产代码；
- Web BFF 的登录态、workspace namespace、请求体限制和流取消接线合理；
- Credits 的 PostgreSQL 账本、FEFO、workspace lock、预占/结算/退款和 worker 周期任务有生产 caller/assembly 接线（L2）；当前 SHA 的完整 PG/DBOS 门仍未重跑；
- AgentKernel、AgentSessionStore、ContentPackageRevisionWritePort、PlanCompiler 的 authority ports 等模块值得保留。

但以下事实使“完整用户旅程已走通”与“可发布”两个结论均不成立：

1. 当前内置浏览器 `/dashboard` 直接 500；Vite 仍监听但 workerd 已退出，Core 仍健康，属于半死假活。
2. 自由创作在当前 Snapshot 消费主路径仍被强制改成 customized，并注入/展示门店事实。
3. Workstream 手机交接 QR 的 token 写入 Operations，落地页却只查 Result Delivery receipt，扫码必然 `not_found`。
4. Thread/账号切换没有清空 Workbench 消息和 Artifact，存在上一会话/上一账号内容残留风险。
5. `CompiledExecutionPlan` 声明的分组并行、重试、缓存语义没有被 executor 正确消费。
6. Waffo 订阅展示价和 checkout 价来自两套目录，生产 checkout 又被明确禁用。
7. 发布 DAG 自相矛盾，Core/Worker/DBOS 没有生产部署链，当前无法形成诚实的 release verdict。
8. Pro Studio UI 已删，但 Core 仍保留无人可达的 Canvas 生成/SSE/outbox/DDL 运行时；Admin 仍显示已退役三桶。
9. 图文、图片、视频、移动端、上传/身份/权利、余额不足、反馈 mutation、真实 Provider 与真实支付仍没有当前 SHA 的完整浏览器闭环证据。

**总判定：`NOT RELEASE-READY`。**
允许继续开发与修复；不允许把当前状态描述成“全功能完成”“完整旅程已走通”“Waffo 已生产上线”或“同 SHA 已具备发布证据”。

---

## 1. 审计证据合同

本报告统一使用以下等级，禁止互相替代：

术语必须分开：

- **HarnessRelease**：Prompt/Skill/Tool/Schema/Model Policy 的 immutable 运行时组合、生命周期、rollout与exact pin；
- **software deployment release**：Web/Core runtime artifact 的构建、staging/production部署、迁移与回滚。

HarnessRelease 合同或 exact pin 存在，不能证明软件已部署；software artifact上线也不能证明所选 HarnessRelease 通过评测/灰度。

| 等级 | 含义 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| L0 | 文件、类型、路由或 symbol 存在 | 有代码外形 | 生产有人调用、功能可用 |
| L1 | 聚焦 unit/contract/typecheck 通过 | 局部合同成立 | HTTP/数据库/浏览器/部署闭环 |
| L2 | 当前生产 caller/consumer 已接线 | 入口到实现可达 | 真 PostgreSQL/DBOS、真实商家体验 |
| L3 | 当前 SHA 的真实 PG/DBOS + 浏览器旅程 | 本地端到端行为 | 线上 Provider、支付、部署与回滚 |
| L4 | 同 SHA required、immutable artifact、staging/live 证据 | 候选发布闭环 | 超出证据范围的商业可用性 |

### 1.1 当前 HEAD 本轮实证

| 检查 | 结果 | 等级/备注 |
|---|---|---|
| Git | 本地 `main` 比远端 ahead 25；产品树基线干净 | 机器事实 |
| Contracts typecheck | PASS | L1 |
| Core typecheck | PASS | L1 |
| Web typecheck + locale compile | PASS | L1 |
| Cross-package journey typecheck | PASS | L1 |
| QA 聚焦回归 | Core 3 + Web 5，全部 PASS | L1；free test 是源码顺序测试，不覆盖 Snapshot |
| CI 合同 | suite owner、Harness version、104/104 ticket index、`scripts/ci/*.test.mjs` 123/123 PASS | L1；只证明被断言的局部文本/函数合同通过，不能证明工作流 DAG 可满足 |
| 当前 Core | `/health/assembly` 200 active | 运行现场 |
| 当前 Web | `/dashboard` 与 `/auth/login` 500 `fetch failed` | P0 运行现场 |
| 当前 workerd | Vite 父进程在，workerd 不在 | P0 运行现场 |
| 当前 PG/DBOS 全门 | 未重跑；opt-in evidence guard 已对 26 个 env-gated suite 报 stale | 当前 HEAD 已知会阻断 root-quality，不声明 L3 |
| 当前完整 Playwright | 被 Web 500 阻断 | 不声明 L3 |
| 当前 live Provider/Waffo/部署 | 未形成；本地 provider artifact 绑定旧 SHA `63a0be85…` 且已于 2026-07-23 过期 | 不声明 L4 |

### 1.2 浏览器证据边界

当前截图：

- `.gstack/review-workflow/evidence/current-web-500.png`

前一轮 exhaustive QA：

- `.gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md`
- 只访问 8 页；
- 在 exercised surfaces 上从 67 提升到 97；
- 自身结论仍是 `NOT READY`；
- 已完成：本地账号、五步门店录入、定制 copy 失败退款与成功、内容对象、copy 交付包/manual handoff、Memory 冷态、Assets、Credits 流水、Admin 异常首页；
- 未完成：note、image、video、移动端、上传/identity/rights、余额不足、结果编辑、反馈 mutation、live provider/payment。

因此，本报告把“上一轮 fixture 浏览器已见”写成历史证据，不冒充当前 HEAD 全旅程复验。

---

## 2. 当前权威与冲突裁决

### 2.1 现行决策

| 决策 | 当前强制口径 | 审计执行规则 |
|---|---|---|
| D-170 | Pro Studio 专属无限画布全量 RETIRE | 不保留入口、新售卖、新生成、新 adoption；专属表 STOP-WRITE、产品面 STOP-READ；本轮不 DROP，未来只有在 outbox/in-flight/reference 条件清楚后另票可选处理 |
| D-171 | XHS/note + Agent-native Workbench | `copy \| note \| media` 是产品 carrier/kind；底层 output/compiler 仍覆盖 copy/image/image_text_note/video 四条成品路径；付费媒体确认 |
| D-172 | Credits + Waffo | 三桶、`plan.allowances.*`、Creem、P0 production writer 退役 |
| D-173 | copy 首 token ≤3 操作 | 不再用旧 ≤2 断言误判 |
| D-174 | 行业来自门店档案优先 | 不复活不可达问题卡；未填走平台/星期兜底 |
| D-175 | free 仅保留权利/受监管资质硬门 | 不得隐式注入门店/项目事实；用户显式输入或模式转换明确携带的 `allowedFactRefs` 可用；必须测默认零引用与显式 allowlist、Snapshot 与派生第二轮 |
| D-176 | 试点前不建失败 composer 作品的用户侧原地 harness 重跑 | 无 Job 的失败作品主出口是返回工作台重新发起；不废 Operations Job retry、legacy durable replay或隔离评测 replay |
| D-177 | standalone tools 真删 | `standalone_tool`/`toolEntryRefs`/独立工具页与 Recipe Studio 路由清零 |
| D-178 | V3.1 是实施和架构权威 | Thread-root、双 Harness、plan-as-data、单 executor、批次 6 条件退役 |

### 2.2 不得误删的条件兼容

- 没有 Snapshot 的旧 durable task replay；
- U14 门未完成前的旧五阶段物理布局、旧 renderer fallback、只读 history islands；
- 历史 `advancedCanvas` ContentPackage sourceRef；
- Pro Studio/Stripe/CRM 历史行的只读、审计、fail-closed 兼容；
- 当前五步素材录入仍使用的 `canvas/assets/intake-*` 对象键；
- XHS note 封面；退役的是视频封面；
- Agent 原语 `Tool`；退役的是面向商家的 `standalone_tool`。

### 2.3 权威文档自身缺陷

1. D-178 与 V3.1 第 0.4 节错把 D-088 写成“旧 Thread 禁令”。真实 D-088 是视频重生的新任务/一次扣费合同；正确 supersede 目标是 D-046，Recent 投影应另引用 D-097。
2. 主设计文档顶部“当前产品合同”仍停在旧三桶、旧五阶段、旧自由创作容器，已被后置决策覆盖。
3. D-155 同日有“代码原地冻结”和后置“归档移出主干”两版，现行应取后者。
4. A–I spec 头部仍有废弃远程 issue 或“待发布”元数据；本地 spec 才是票面真相。
5. `docs/ops/current-project-status.md` 自称唯一当前入口，但基线比当前远端落后 104 commits；Capability Ledger 比当前远端落后 137 commits。
6. V3.1 第 86 行仍写 U1–U12，现行附录实际已经是 U1–U14。
7. V3.1 第 6/1975 行漏列 D-178 已登记的第四份 review：`v3.1-specs-codex-xcheck-2026-08-08.md`。

**修复原则：** 稳定政策与可过期验证状态分文件；状态文件必须携带 machine-checked HEAD/remote SHA，过期即 fail closed，而不是继续自称 CURRENT。

---

## 3. 功能落地与用户旅程矩阵

状态定义：

- **通过**：当前代码 L2 成立，且已有可信浏览器/PG 证据；
- **部分**：主链存在，但关键分支/当前 SHA/真实依赖未闭环；
- **失败**：已确认生产路径断裂或违反现行产品合同；
- **被阻断**：当前运行环境使本轮无法重新验收；
- **条件延期**：权威明确不要求本期落地。

| 旅程 | 当前状态 | 证据与缺口 |
|---|---|---|
| P0-01 新账号首次出活 | 部分 / 当前被阻断 | 上轮 fixture 已验证账号与 copy；当前 Web 500；live Provider 未验 |
| P0-02 单 Dashboard 三段 | 部分 | 主路由与提议/创作/最近工作存在；Thread/legacy history 仍有多投影 |
| P0-03 定制 copy | 部分通过 | 上轮 fixture 成功+失败退款；当前 HEAD 未完整浏览器重跑 |
| P0-04 note / XHS | 部分 | NotePlan、Result 对象工作区存在；新 Agent Artifact 不渲染真实媒体；浏览器未完成 |
| P0-05 image 三入口 | 部分 | Result 旧链存在；新 Artifact 只显示状态；exact text/套图当前轮未验 |
| P0-06 native video | 部分 | 观看/结果代码存在；leave/return 与真实 provider 未验；不可增加视频编辑 |
| P0-07 自由创作 | **失败** | Snapshot path 硬编码 customized/store facts；交付文案仍称门店资料 |
| P0-08 Credits | 部分 | P1 production caller、账本 schema与既往 fixture证据存在；当前 SHA PG/DBOS全门及余额不足未重跑；Waffo production path当前未启用、未完成live验证 |
| U1/U8/U9 确认与预占 | 部分 | pure copy policy-exempt仍应冻结 Snapshot；付费媒体确认、拒绝零扣、request创建即reserve、hold到期退款代码存在，但当前 SHA完整浏览器+PG未重跑 |
| D-173 操作预算 | 未纳入本轮实证 | copy≤3，image_text/video各5；旧≤2断言不得继续，需浏览器计数门 |
| D-174 行业 whyNow | 部分 | 门店行业持久化修复已有聚焦/历史浏览器证据；“档案行业→whyNow”与空值/未映射兜底未在当前运行栈复验 |
| P0-09 就地调整/版本 | 部分 | lens undo/version 有证据；result edit/restore/OCC 完整浏览器未闭环 |
| P0-10 交付 | **部分失败** | copy/ZIP/manual 旧链已验；新 Workstream QR token 断链；三状态机重复 |
| P0-11 等待/恢复 | 部分 | Thread/reload 上轮已见；前端双状态与 cross-thread 残留风险 |
| P0-12 评价/chips | 部分 | 控件可见；mutation、撤回/去重、埋点失败未验 |
| A-01 五步录入 | 部分通过 | 上轮 Store 链已验；首次 GET 失败会永久骨架 |
| A-02 单件解析/手填 | 未闭环 | 代码存在；上传/PDF/超时/手填当前浏览器未完成 |
| A-03 批量素材 | 未闭环 | 静态存在；恢复/隔离/批量确认未验 |
| A-04 MarketingIdentity | 部分 | 页面/合同存在；授权字段真人回答链未完整验 |
| A-05 案例权利条件门 | 未闭环 | 权利模块存在；真实受限素材条件旅程未验 |
| A-06 关键事实门 | 部分 | 上轮事实边界有证据；价格过期/非核心缺失分支未完整验 |
| P1-01 Works/Result | 部分 | 两页都可达，但两套动作面职责重叠 |
| P1-02 Memory/经验 | **部分失败** | kind/authority/state 被投影丢失，分域/分页/error/retry 不完整 |
| P1-03 基于此再创作 | 未闭环 | 代码存在；旧价格/顾客/过期事实重注入未实测 |
| P1-04 手工结果信号 | 部分 | UI/服务存在；与新 handoff/次日 ask 的闭环不稳 |
| P1-05 多工作区 | 条件延期 | 价格页若未真售卖 2/3 工作区，不当作 P0 缺失 |
| P1-06 移动端 | 未验 | 320/390/横屏/200%/读屏未完成 |
| D-171 XHS/OpenCLI双轨 | 历史部分 / 当前未验 | 历史记录有真实 note+download；manual handoff保留；device bridge readiness、companion与当前 provider部署是独立 fail-closed 门 |
| Goal/Proactive | 条件延期 / 默认关 | 合同与部分控制面存在；U13阈值unset默认关，批次6前不建Goal CRUD，不是核心发布缺失 |
| HarnessRelease / G/H Ops | 部分 | contracts、Admin/ops代码与局部测试存在；exact release pin、PromptPack、allowlist、manual rollback、Artifact/Lifecycle/Rollout未形成当前SHA完整L3/L4证据 |
| ADM-01 管理员权限 | 部分通过 | 上轮管理员/商家隔离已见；recent-auth 敏感动作未全覆盖 |
| ADM-02 能力总览 | 部分 | 异常优先存在；三桶 panel 退役漂移且平台 credits 投影未接 |
| ADM-03 模型/渠道/凭据 | 部分 | 治理面丰富；typed P1 合同与 release 证据不足 |
| ADM-04 Template/Skill | 部分通过 | 独立 Recipe Studio 页已删；六个低层 command facade 无消费者 |
| ADM-05 Credits/商品/兑换码 | 部分 | admin revisions/兑换/账本存在；Waffo 单一价格与生产闭环缺失 |
| ADM-06 用户/审计 | 部分 | Better Auth/Admin/P1 audit 接线存在；legacy synthetic quota 可误报 |

### 3.1 当前可以诚实宣称的能力

- fixture 档的账户、门店录入、定制 copy、Credits 失败退款、ContentPackage/Works、copy 导出包和 manual handoff；
- Credits 的 P1 production caller、数据库模型与聚焦合同；完整当前 SHA PG/DBOS 仍待重跑；
- Snapshot admission 的 immutable/hash/live fence；
- Waffo webhook durable receive/settlement 代码形态；
- Templates 中的 Recipe compile/validate/eval；
- Pro Studio/standalone/CRM 主要商家入口已撤。

### 3.2 当前不能宣称的能力

- 自由创作“默认无隐式门店 grounding，只有显式 allowlist 可用”；
- Workstream 手机交接可用；
- note/image/video 全链与新 Artifact 完成；
- 完整移动端、权利、身份、反馈、余额不足；
- Waffo Production；
- 真实 Provider 商家旅程；
- Core/Worker/DBOS 已部署；
- same-SHA release-ready。

---

## 4. P0 发现：必须先修

### R-P0-01 本地开发栈半死假活

**现场**

- `scripts/dev/start-stack.mjs:63-77` 只等待 `pnpm dev:all` 整体退出；
- Vite-owned workerd 退出不使 Vite 父进程退出；
- `stack-state.json` 只证明文件存在/DB URL 有值，不验证 PID/HTTP readiness；
- ordinary dev 只设置 Node heap，未设置 workerd 独立 `MINIFLARE_WORKERD_V8_FLAGS`；
- Playwright 已有 patch、worker heap flag和 child/liveness reporter，但 ordinary dev 未复用。

**环境叠加**

- lock/package 要求 Cloudflare plugin 1.46.0、miniflare/workerd 20260721、wrangler 4.113；
- 当前安装实际为 1.40.2、20260611、4.100；
- launcher 不检查 virtual-store lock 与仓库 lock 的一致性。

**影响**

- 浏览器全部旅程 500；
- 端口、Vite PID、stack-state 仍看似绿色；
- QA 容易把 runtime 断裂误报成产品 bug；
- 同一问题会在长 HMR/soak 中重复，而 per-spec CI 重启会掩盖。

**修复**

1. 启动前 lock parity fail-fast，提示人工执行 frozen install，不自动安装；
2. shared runtime profile 默认传 workerd heap flag并验证 Miniflare patch支持；
3. 启动后等待 Web/Core ready，运行中持续健康检查；
4. Web 连续失败时收口整个进程组、清 state、非零退出；禁止无限自愈；
5. state 改 `starting/ready`，DB URL 用非秘密 fingerprint，文件 0600；
6. paired profile 纳入 DBOS URL 与 queue prefix；
7. pin/warn Node 22；
8. 加 30 分钟 clean Node22/frozen install soak。

**完成定义**

- 杀掉/模拟 embedded workerd 后 10–15 秒内 `pnpm dev` 非零退出且 3001 不残留；
- running-stack smoke 对 Web 500 必须立即 red；
- soak 全程 `/api/ping` 与 Core health 2xx，无 `fetch failed`；
- 任何错误输出不含密码/完整数据库 URI。

### R-P0-02 Thread/账号边界未清空 Workbench

**证据**

- `agent-event-store.ts:47-55` 是每 tab singleton；
- `agent-event-reducer.ts:309-320` 的 `set_session(null)`/Thread 变化只清 plan/interrupt；
- messages、activities、artifacts、deliveredKeys、cursor 保留；
- `agent-workbench.tsx:203-206` Idle 仍渲染同一 Workstream。

**影响**

- Thread A → B、账号 A → B、无效 Thread → Idle，可能展示上一上下文内容；
- 属于隐私/隔离和产品可信度 P0。

**修复**

- 保持一个 active store，并携带 `userId + workspaceId + threadId` identity tuple；不得按 tuple 缓存多份敏感旧状态；
- identity/thread tuple 变化时用 `createEmptyAgentWorkbenchState()` 整体 replace，再 replay 目标 Thread；
- 只允许 replay 把目标 Thread 的服务端事件重新水合。

**完成定义**

- interaction + browser 覆盖 A→B Thread、Thread→Idle、账号 A→B；
- messages/artifacts/cursor/delivery 全部为目标身份；
- 不以页面刷新作为清理前提。

### R-P0-03 手机交接 token 两套真相

**证据**

- Web 调 `operations.prepare_mobile_publish_handoff`；
- `operations/publish-handoff.ts:350-402` 只写 audit event；
- QR 指向 `/dashboard/handoff/$token`；
- 页面调用 `result-delivery.assisted_consume_handoff`；
- consumer 只查 `p1_assisted_receipts.handoff_token`；
- 全仓无 audit token → assisted receipt bridge。

**附加缺陷**

- handoff preparation 与 self-report 共用不含 phase 的 dedupe key；
- running 阶段可提前写 key，delivered 后直接 return，永不 prepare；
- 页面继承 Dashboard auth，与“外部责任人”用一次性链接语义不一致。

**修复**

- 以 Result Delivery AssistedReceipt 为唯一 token/TTL/consume/audit owner；
- Workstream prepare 事务化创建 canonical receipt并返回原 token；
- preparation 与 self-report 拆 effect/幂等 key，key 绑定 exact package revision + delivered；
- canonical receipt收敛不替产品做 auth 决策；“仅商家登录态”与“外部责任人 scope-limited 一次性 token”必须另经产品+安全拍板后只实现一种；
- Operations 旧 audit-only token 仅做明确历史兼容或删除。

**完成定义**

- Workstream 生成的原 QR token → 手机新会话 → ready 页面；
- 取消/过期/重复消费/不同 workspace 全部 fail closed；
- running→delivered 不刷新也能完成 prepare；
- handoff success 不被记录为 published。

### R-P0-04 自由创作 Snapshot grounding 泄漏

**证据链**

- `workflow-core.ts:1322-1357` 的 Snapshot 路径绕过 `resolveIntentRoute`；
- `make-snapshot-consume.ts:104-140` 无条件产出 `route=customized`、store categories；
- `make-snapshot-consume.ts:172-230` 不接 `allowedFactRefs`，直接复制全部 frozen fact refs，并写“本店事实”指令；
- `composer-plan-session.ts:1448-1451` 把 identity/brief authority refs 当 fact intentions；
- `plan-semantic-event.ts:202-206` 只按数组长度显示“已绑定 2 项事实”；
- copy/media delivery summary 继续硬写“已确认门店资料”；
- 当前回归测试只读取源码并检查 free guard 在 no-question 前，未执行 Snapshot。

**修复**

1. `materializeIntentFromSnapshot` 按 `request.creationMode` 生成 free declaration；
2. Snapshot brief 显式接 `allowedFactRefs` 并取许可交集；
3. free brief 默认不引用经营事实；只有用户显式输入/转换携带并进入 `allowedFactRefs` 的引用可以使用，其他事实不得注入或伪造；
4. identity/brief 从 fact usage 统计拆为 authority refs；
5. delivery summary 按 route 选择中性策略文案；
6. 首轮与 `result_adjust` 派生第二轮都测。

**完成定义**

- 两组 `creationMode=free + ExecutionPlanSnapshot.factRevisionRefs` workflow integration tests：默认无 allowlist，以及显式用户 allowlist：
  - route=free；
  - fact resolver 不调用或结果为空；
  - 默认组 brief/assembly fact refs 为空；显式组只保留 allowlist 交集；
  - 默认组所有进度与交付文案无“本店/门店资料/已绑定事实”；显式组准确说明只使用用户指定资料；
  - rights/qualification 门仍保留；
- 当前浏览器复现用例转绿。

### R-P0-05 执行计划接口承诺未被执行

**证据**

- V3.1 定义 dependency group 内并行、组间顺序；
- `compiled-carrier-executor.ts:248-302` 先 flatMap，再逐 unit 串行 await；
- recipe 同组里存在 select→check、brief→ask、pages→check→revise 等因果依赖；
- compiler 写 `boundedRetry/cachePolicies/unitCacheKeys`，executor/store 不消费。

**影响**

- plan-as-data 有“看起来已落地、实际上无行为”的假接口；
- 性能、重试、缓存和 replay 语义不能靠 schema 存在背书；
- 直接 Promise.all 会破坏现有因果关系。

**P0 是接口诚实，不是强制本批实现全部并发/缓存/重试。** 当前安全串行可保留，但不能继续发布未消费的承诺：

1. PLAN-01A：给当前 plan version 明示 `serial` capability；compiler停止产出或 consumer拒绝非空 parallel/retry/cache语义；schema/version与发布门 fail closed；
2. PLAN-01B：后续先写组内独立并发/组间顺序行为红测，重排因果 recipe，验证 DBOS并发/replay后，再选择性实现逐 group、cache与bounded retry；
3. 任一语义只有 executor与持久化真消费后才能在 published plan中开启。

### R-P0-06 Waffo 两套价格真相与 Production 未落地

**证据**

- 价格页读 Core `plan.credits.*`；
- checkout 读 Web 本地 `WAFFO_SUBSCRIPTION_PRODUCTS`；
- checkout 前不验证 Core payment mapping 与 Provider 真实金额/币种/状态；
- mapping 只在 webhook 入账时严格检查；
- Test checkout authority 明确禁止 production；
- 所有 workflow 都未启用真实正向 Waffo acceptance；
- 现有 Playwright 闭环 route-mock webhook并手填成功对象。

**风险**

- Admin 改价后页面显示新价，Provider 仍收旧价；
- 用户付款后 mapping 漂移导致积分不到账；
- 加油包/续费 CTA 在 payment disabled 时仍是死入口。

**修复**

- 新建 server-side `CommerceReadiness`：
  - published plan revision；
  - payment mapping 完整性；
  - Provider product price/currency/status；
  - environment/secrets；
  - checkout mode；
- 所有 plan/add-on/portal CTA 共用该投影；
- Provider 调用前 fail closed，调用次数应为 0；
- 生产启用需独立运营授权与真实 Test sandbox 证据。

### R-P0-07 发布 DAG 不可满足，Core/DBOS 无生产部署

**结构矛盾**

- release manifest 只在 dispatch/release-candidate PR 运行；
- ordinary main push deploy 却从同一 Core quality run 下载 manifest；
- deploy 依赖整个 workflow success，advisory 红也会阻止 deploy；
- RC 在 build/E2E 前要求 provider-live JSON，但 provider artifact来自另一 workflow且从未下载；
- provider-live 的自动触发还是 `release.published`，发生在发布之后，时间顺序上也不可能充当前置 release gate；
- RC E2E 不依赖 merge-required aggregate；
- manifest 在 staging部署/真实验收前生成，`result=pass` 与 evidence refs只做非空检查；
- deploy 只迁移/构建/发布 Web；
- Harness SOP 明示 Core/Worker/DBOS 发布未实现；
- deploy 允许在 migration 后被新 push cancel。

**完成目标**

```text
PR / main merge-required
  -> merge only; no production deploy

explicit RC selection for one exact SHA
  -> immutable Web artifact + one Core runtime artifact
     (API and Worker are two roles of the same digest/version)
  -> staging expand migration
  -> Core API/Worker deploy + DBOS version pin/readiness
  -> Web deploy
  -> staging browser + DBOS restart/recovery
     + Waffo sandbox + provider-live + network probes
  -> manifest from this run's artifact metadata
  -> release-required
  -> human approval
  -> promote the exact same artifacts to production
  -> production drain/migrate/Core API+Worker/Web/post-smoke
```

Advisory telemetry 应拆到独立 workflow；deploy 只监听 `release-required`。迁移/部署临界段不可被普通 cancel 打断，并遵循 expand/contract。

---

## 5. P1 发现：主链闭环与架构风险

| ID | 发现 | 核心影响 | 最小目标 |
|---|---|---|---|
| R-P1-01 | BFF 非 SSE 总超时固定 10s，submit 在返回 202 前同步跑 Agent plan | 前台失败、后台可能已创建；重试/409/旧 task 不确定 | 先 durable accept 快速 202；规划异步；idempotency 恢复同 Task |
| R-P1-02 | quote 声明 12s 仍被 BFF 10s 截断 | timeout owner 分裂 | operation timeout registry + typed timeout |
| R-P1-03 | 三套交付状态机 | token、ApprovalReceipt、事件证据强度和 UI 状态分叉 | 一个 DeliveryApplication，三 UI adapter |
| R-P1-04 | running→delivered handoff dedupe | 无刷新时交接不准备 | phase/revision 幂等键拆分 |
| R-P1-05 | Store 初次 GET error 在 Skeleton 后 | 永久骨架，无重试 | loading/error/ready 三态 |
| R-P1-06 | Memory projection 丢 kind/authority/state/revision | 所有条目误归门店偏好，Correction/分页/error 失效 | contract-first 分域/分页/retry |
| R-P1-07 | Recent 只带 threadId，replay recentTaskId 被丢 | “本次引用经验”偶然不可达 | Thread current/recent Work/task 权威投影 |
| R-P1-08 | Works 与 Result 都写 export/handoff/edit | 两套前端状态/文案/编舞 | Works 只读档案；写动作 deep-link exact Result |
| R-P1-09 | legacy deep link 参数被静默丢弃 | 打开错误对象/默认 Composer | 单一 deep-link mapping，无法映射就诚实历史态 |
| R-P1-10 | 兑换只刷新 entitlement projection | credit detail/流水陈旧 | 同时更新/invalidate canonical keys |
| R-P1-11 | Agent Artifact 不渲染图片/note/video媒体 | Workstream 媒体 carrier 仅 L0 | Shared Artifact 真消费 media refs |
| R-P1-12 | Agent SSE route存在但生产传 undefined | polling/SSE 双维护，无唯一实时链 | canonical SSE + polling fallback，或删除无人消费 route |
| R-P1-13 | Web→Core P1 是 string+unknown+generic cast | 181 调用点失去编译期契约 | typed operation registry |
| R-P1-14 | ComposerHome 同时写 Agent store 与 ComposerSession | 同 Thread 两套前端真相 | AgentEventStore 唯一投影，legacy 只读 adapter |
| R-P1-15 | Operations 7,416 行 + whole-workspace aggregate | 全表 load/save、全局锁、历史越多越慢 | 按 ContentPackage/Work/Task/Archive/Search owner 拆 |
| R-P1-16 | attach/bind temporal interfaces | 装配顺序知识运行时才失败 | constructor-required；单一 LateBound seal |
| R-P1-17 | Agent Session 11态中多态无 producer | 假 durable 状态机 | 诚实改名 TurnPhase，或 CAS 持久化 |
| R-P1-18 | API 持有 recovery poller，worker只管部分 job，Web request 还 drain outbox | API death停恢复、扩容重复轮询 | 单一 background ownership，迁到 worker |
| R-P1-19 | Core graph 104 deps，worker只用25；migrator重复 | 启动/HMR慢、DDL锁、无关故障拖死 worker | role-specific assembly + one migrator registry |
| R-P1-20 | 缺 `p1_write_ownership` 同时表示 legacy read 与 P1 write | dual-read 长期存在，缺失语义相反 | 新 workspace 显式 p1，盘点/backfill后 missing fail closed |
| R-P1-21 | Admin 三桶 panel + synthetic quota | 空面、正常 Credits 可能被误报 mismatch | credits aggregate 或诚实未接线 |
| R-P1-22 | 启动自动把非 HKD revision 改默认 HKD/价格 | 重启可覆盖运营发布值 | 显式 preview + expectedRevision 迁移 |
| R-P1-23 | 当前状态/能力账本 SHA 过期 | Agent 依据旧事实执行 | policy/status 分离 + stale baseline gate |
| R-P1-24 | Web 6 个 PG suites 在 root 无 DB时 14 skipped 仍 exit 0 | 支付/auth/workspace 持久化假绿 | same-SHA Web PG required，unexpected skip=0 |
| R-P1-25 | HarnessRelease 与 software deployment release 证据混用 | exact Prompt/Skill/Tool/Schema/Model Policy组合没有当前SHA完整pin/rollout/rollback证据 | HREL-01 独立审计并建立运行时release证据 |

---

## 6. 架构合理性评估

### 6.1 值得保留的深模块

| Module | 为什么合理 |
|---|---|
| `AgentKernel.runTurn` | 真 external seam；AI SDK/fixture adapter；明确不拥有 durable checkpoint |
| `AgentSessionStore` | Thread revision bump + Run create 必须同事务，Memory/Postgres adapters真实 |
| `AgentEventStore` | 仅 getState/dispatch/subscribe，复杂 replay/dedupe/project藏在内部；应成为唯一客户端投影 |
| `ContentPackageRevisionWritePort` | 小 interface，深实现；OCC/idempotency/rights/transaction 已封装 |
| PlanCompiler authority ports | quote/rights/model/recipeSkills 按 canonical owner 切分合理 |
| `ProviderExecutionPort` | true external，已有多真实 Provider/recorded adapter |

### 6.2 需要 deepen，而不是继续加 wrapper

| 当前模块 | 问题 | 目标 |
|---|---|---|
| `ComposerHome` 5,189 行 | 45 state/28 effect/28 ref；hook options 55字段 | Draft/Submission/SourceAsset controllers，host只拿 VM+commands |
| `OperationsApplicationService` 7,416 行 | 57 methods，20+ collections，全 workspace load/save | 按 canonical owner 定向 repositories |
| `ModelSupplyControlPlaneRepository` | 约37 methods，callers依赖 concrete class | Generation/Catalog/Preference/Queue/Quality窄 ports |
| `server.ts` 3,292 行 | 每 request重建RouteTable；auth双写 | startup immutable route definitions + 5–8 deep registrars |
| `agent-domain.ts` 2,718 行 | 十多个领域物理混放 | 机械拆文件，保留 contracts barrel |
| source-regex tests | 测 symbol/字符串位置，不测行为 | module behavior + AST/import boundary gates |

### 6.3 依赖类别裁决

- **in-process**：Composer/Agent reducers、Turn phase、Plan executor。优先 merge/deepen，不要再造 adapter。
- **local-substitutable**：Postgres/Memory stores、DBOS effect、object storage。保留真实双 adapter，但把 interface 收窄。
- **remote-owned**：Web→Core HTTP。保留 BFF/proxy，但 operation contract 必须类型化。
- **true external**：LLM/image/video/payment/provider。保留 port + fixture/recorded，业务真相不得放进 adapter。

---

## 7. 冗余、死代码与明确退役残留

### 7.1 Wave 4 delete/shrink 候选（未过硬门不得删除）

下列 LOC 只是静态审计的**粗略上界，不是目标或 KPI**。每张票必须在 consumer proof、production data/in-flight proof 与回滚设计完成后重新估算；静态零引用只允许开调查票，不授权删除。

| 排名 | 范围 | 当前证据 | 预计收益 | 风险/护栏 |
|---:|---|---|---:|---|
| 1 | Pro Studio / `model_canvas_*` generation/text SSE/outbox runtime | Web producer=0；生产未注入 service；约950行测试 skip | -3,800～4,500 LOC | 保留 D-170 KEEP 与历史 lineage/table；本票不 DROP；可留极小 retired rejection |
| 2 | `canvas_export_asset` closure | Web/internal caller=0；历史 ContentPackage读取不依赖 | -1,150～1,300 LOC（含测试） | 保留当前 asset intake 对象键/PUT |
| 3 | Admin 三桶 + synthetic quota bridge | Credits plans无 allowance，panel恒空；support可误报 | -800～1,050 LOC | support先改读 credit detail/ProductUsage |
| 4 | 旧 `plan.addons` | 读出后唯一consumer丢弃；仍与新addons同屏 | -150～250 LOC | 历史 DB row 留存不读 |
| 5 | P0 writable `LegacyBillingLedger` | 生产构造均read-only；12 call sites no-op | -400～500 LOC | 保留 legacy read/cutover/replay |
| 6 | Recipe Studio 低层 facades | service/Template入口活；6 commands无前端producer | -100～250 LOC | 先定义一个 governance command |
| 7 | Pro Studio 零消费者 locale/script/screenshots | 56 keys零生产consumer；旧CI脚本无caller | -125～250 LOC + 357KB | 不删现役 Light/Artifact Canvas |
| 8 | dead commands/deep-link producers/catalog tool pending action | 兼容路由仍在但不应主动生产 | 约 -350 LOC | 先停止新链接，U14前保留必要壳 |
| 9 | `OperationsCommandIntentRegistry` | 单实现、零production consumer | 小 | mutation controller内部拥有幂等 |

粗略净删上界：**6,300～7,400 LOC，0 个新依赖**；逐票数据/消费者证明优先于行数收益。

### 7.2 D-155 已有裁决：归档 active automatic publisher

**Generic automatic publisher**

- 五项能力事实恒 false；
- publisher 唯一实现恒抛错；
- UI automatic count 恒 0；
- 历史 automatic publish event 仍有 reader；
- 当前逻辑横跨约 17 个文件。

D-155 后置修订已经决定冻结并归档移出主干，不需要再让执行 Agent 二选一：

- 删除 active publisher port/writer/CTA/evaluator；
- 主链只保留 `unavailable` capability 投影；
- 保留历史 automatic publish event reader；
- 若未来要恢复，必须由新的 accepted 决策/spec 重新引入独立 deferred module，不能凭现有休眠分支自行复活。

粗略收益上界：约 600～1,000 LOC。

### 7.3 当前明确不能删

- U14 前的 legacy replay、old renderer、只读 jobs/history；
- `advancedCanvas` historical sourceRef；
- Pro Studio/Stripe/CRM 历史表/审计/fail-closed；
- 五步素材 intake 的 canvas 命名对象键；
- Recipe Studio service；
- Agent Artifact Canvas、LightComposerCanvas、canvas-name/library；
- Stripe historical webhook，直到 obligation/refund/dispute 归零证据完成。

### 7.4 Knip 结论

- 配置的 `knip:production --include files` 没发现整文件 unreachable；
- full Knip 的 397 exports/691 types含大量 public/barrel/vendor false positives；
- `@meiye/contracts` 被误报 unused，但生产大量引用；
- 不得按 raw Knip 数字批量删依赖/exports；
- `@better-fetch/fetch`、`@heroui/styles` 可做 peer/直接依赖核验，但不是本轮已证删除项。

---

## 8. 测试、CI 与发布证据复核

### 8.1 浏览器覆盖分布

| 分类 | Files | Tests | 结论 |
|---|---:|---:|---|
| required blocking | 10 | 19 | fixture/provider-free，覆盖有限 |
| advisory-only | 26 | 57 | 失败不挡 merge，却会意外挡当前 deploy workflow |
| full RC/local only | 62 | 191 | RC 当前不可达，无正常 CI consumer |
| 总计 | 98 | 267 | “文件存在”不等于“被可靠执行” |

未进入 ordinary required 的代表面：

- auth public/protected；
- W01/W02 五步录入；
- P0 golden；
- P1 三模态完整闭环；
- Works reshell；
- 三模态移动端；
- Waffo。

独立 persistence 缺口：Web 另有 6 个 PostgreSQL test files / 14 tests；root 无数据库时结果为 14 skipped、0 pass、exit 0，payment/auth/workspace 持久化因此没有当前 SHA 的 required 证据。

### 8.2 当前门的假绿/假红风险

- free route regression 只检查源码顺序；
- Web 6 个 PG files / 14 tests 在 root 无数据库时 14 skipped、0 pass、exit 0；
- Waffo 正向用例缺省被 skip；手动启用时仍 route-mock webhook并手填成功对象；
- production network boundary 无 evidence时只是 contract-valid；
- manifest evidence refs只 non-empty，不解引用/验 SHA；
- full RC 包含明确 KNOWN RED `v31-82`；
- CI per-file重启掩盖 long-lived workerd崩溃；
- required green 只说明该 SHA 的门通过，不说明 Provider/支付/部署。

### 8.3 推荐的机器可读测试所有权

每个 Playwright/PG/DBOS suite 必须声明：

- owner：domain/team；
- tier：required/advisory/RC-only/instrument/retired；
- environment：fixture/recorded/live；
- databases/providers；
- allowed skip 原因；
- superseded decision；
- 当前产品 journey ID；
- artifact/evidence输出；
- 最大时限与重试策略。

缺 owner、未知 skip、退役 spec仍进入 RC、current decision不匹配时 fail closed。

---

## 9. Agent 执行修复路线图

后续 Agent 必须按依赖顺序执行。每张票只做一个纵切，不允许先开大重构。

### 9.0 Hard-gate DAG

Wave编号用于分组，不代表所有票机械串行；以下是全局硬门：

1. **Evidence/runtime barrier**：DEV-01/02 与 CI-01A/CI-02 先建立可信运行和红门；在此之前不得新增“浏览器已验/数据库已验”宣称。
2. **Trust barrier**：FE-01、DEL-01、FREE-01、PLAN-01A、BILL-01 的相关行为必须先锁住，才允许触碰其下游架构拆分或发布链。
3. **Architecture rule**：Wave 2 与 Wave 3 可按显式依赖并行；没有直接依赖的模块不必等待整波，但每个 finding必须先有行为测试和 canonical owner。
4. **Destructive RET hard gate**：任何 Wave 4 删除必须同时满足 CI-01B same-SHA PG/DBOS已激活、相关浏览器门可评价、production data/consumer proof、在途 lease/TTL/DBOS replay清零、审计导出和回滚包；静态零引用不够。
5. **Release barrier**：REL-01 之后的 staging/production工作只有在当前 required journey catalog全绿且无 P0 release blocker时启动。

CI-01 分两步：CI-01A 在 Wave 0 先建立 runner/fresh DB/unexpected-skip 红门，可先以 advisory证明仪器本身；CI-01B 在 Wave 1 入口把已校准的门升为 required，后续产品 PR 必须在真实红门下转绿。

### Wave 0：先让权威、环境与证据可信

#### WF-00 Authority summary correction

- **依赖**：无。
- **范围**：
  - `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`；
  - V3.1 `0.4`；
  - A–I spec 头部元数据。
- **动作**：
  1. 不静默改写历史 accepted D 正文；在决策日志追加可审计 erratum/新 accepted correction并交叉引用：D-178 错引 D-088，正确目标为 D-046，Recent另引用D-097；V3.1顶部加醒目 correction banner；
  2. 保留 D-088 视频新任务/一次扣费语义；
  3. 顶部 Current Contract 生成 D-170～178 后的摘要或加醒目 superseded banner；
  4. 用交叉引用明确 D-155 后置修订优先，保留原文审计轨迹；
  5. 远程 issue metadata 标为历史，不再被 Agent 当 truth；
  6. 修正 V3.1 U1–U12→U1–U14 摘要，并补列第四份 review。
- **验收**：
  - 新增 authority consistency test，验证所有 supersede ID 指向真实标题；
  - 不改变产品代码；
  - 人工复核“视频重生”“Thread”“Recent”“发布冻结”四组语义。

#### WF-01 Current status machine truth

- **依赖**：WF-00。
- **范围**：
  - `docs/ops/current-project-status.md`；
  - `docs/ops/capability-ledger-2026-08-13.md`；
  - status generation/check script。
- **动作**：
  - 把长期政策与 SHA-scoped validation 分开；
  - 状态头由脚本写入 HEAD、remote、dirty、required run、browser run、PG/DBOS evidence；
  - baseline 非 ancestor/过期时明确 `STALE`，禁止继续标 CURRENT。
- **验收**：
  - 在 temp repo 变更 HEAD 后，stale checker deterministic red；
  - 不允许手工把 ancestor CI 绿复制到当前 SHA。

#### DEV-01 Stale install + workerd heap preflight

- **依赖**：无。
- **范围**：
  - `scripts/dev/start-stack.mjs`；
  - `scripts/dev/runtime-profile.mjs`；
  - lock parity helper/tests。
- **动作**：
  - DB provision/spawn 前比较 root lock 与 virtual-store lock；
  - missing/drift 时 fail fast，仅提示 frozen install；
  - ordinary dev 默认设置并尊重显式 `MINIFLARE_WORKERD_V8_FLAGS`；
  - preflight 确认当前 Miniflare支持 env→v8Flags。
- **验收**：
  - matching/missing/drift 三 fixture；
  - stale 当前形态必红；
  - failure 发生在任何数据库或 child process mutation 前；
  - 输出不包含 env secret/DB URI。

#### DEV-02 Truthful supervisor and stack state

- **依赖**：DEV-01。
- **范围**：
  - `scripts/dev/start-stack.mjs`；
  - `scripts/dev/stack-state.mjs`；
  - health/liveness helper。
- **动作**：
  - `starting → ready`；
  - Web/Core ready 后才写 ready；
  - 运行中连续 N 次 Web 非 2xx/断连即收口 process group；
  - 清 state并非零退出；
  - paired fingerprint 加 DBOS/queue；
  - state 0600、URI脱敏。
- **验收**：
  - fake Web 200→500且父进程不退的集成测试；
  - 10–15 秒内 supervisor退出；
  - Core/worker/Vite全部收口；
  - 30 分钟 Node22/frozen install soak。

#### DEV-03 Running smoke and isolated smoke split

- **依赖**：DEV-02。
- **动作**：
  - 现有脚本命名为 `dev:smoke:isolated`；
  - 新增 `dev:status/dev:smoke:running`，读取 ready state并验正在运行的 Web/Core/worker；
  - nightly/opt-in soak产出连续 health samples与首次失败证据。
- **验收**：
  - 当前 Web 500 时 running smoke 必红；
  - isolated smoke仍安全清临时数据库；
  - artifact不含凭证。

#### CI-01A/B / CI-02 仪器前置

- **实施阶段**：属于 Wave 0，必须在 Wave 1 产品修复合入前生效；其完整定义放在 Wave 5 以便连续阅读发布链。
- **并行关系**：same-SHA persistence gate 与 suite ownership catalog 可并行，不互相依赖。
- **目的**：后续 Waves 1～4 不得继续在“数据库套件静默 skip / suite 无 owner”的假绿门下推进。

### Wave 1：先收口信任边界和 canonical truth

#### FE-01 Workbench identity/thread isolation

- **依赖**：DEV-02 便于浏览器验收。
- **文件**：
  - `agent-event-store.ts`；
  - `agent-event-reducer.ts`；
  - `agent-workbench.tsx`；
  - auth boundary helper。
- **动作**：
  - 单 active store携带 account/workspace/thread identity tuple，不缓存多份旧 store；
  - `set_session(null)`/identity change 全量 reset；
  - replay 只恢复目标 Thread。
- **测试**：
  - reducer unit；
  - React interaction；
  - fixture browser：Thread A→B、Idle、logout/login B。
- **禁止**：只在 logout 组件里加一次清理；身份边界必须由 store owner 强制。

#### DEL-01 Canonical assisted handoff

- **依赖**：FE-01。
- **文件**：
  - Workbench `use-publish-handoff.ts`；
  - Operations `publish-handoff.ts`；
  - Result Delivery assisted receipt service/repository；
  - `routes/dashboard/handoff/$token.tsx`。
- **动作**：
  - 一个 receipt/token/TTL/consume/audit owner；
  - Workbench、Pending Inbox、Result Center 调同一 `prepareCanonicalHandoff`；
  - prepare/self-report 独立 idempotency；
  - canonical receipt本票不自行选择外部责任人 auth模型。
- **测试**：
  - 原 token跨入口 contract；
  - running→delivered；
  - expiry/replay/cancel/wrong workspace；
  - 按 DEL-SEC-01 拍板的唯一 auth模式做手机真实浏览器；不得同时保留两套含糊入口。
- **完成**：删除 Operations audit-only token writer，或明确历史 read-only adapter及删除条件。

#### DEL-SEC-01 Handoff recipient authentication decision

- **依赖**：DEL-01 canonical receipt可先落，但外部开放前必须完成本票。
- **拍板二选一**：仅登录商家本人跨设备；或外部责任人使用 scope-limited、一次性、可撤销/过期 token。
- **要求**：产品与安全共同记录权限、PII暴露、TTL、撤销、重复消费和审计；执行 Agent不得自行猜选。

#### DEL-02 One DeliveryApplication state machine

- **依赖**：DEL-01。
- **Addresses**：R-P1-03。
- **动作**：把 Pending Inbox、Workbench、Result Center 收成一个深 `DeliveryApplication`（prepare package / canonical handoff / record outcome / project state）；三个页面只是 UI adapters，不再各写状态与同名不同强度事件。
- **验收**：同一 ApprovalReceipt只能按合同消费一次；三入口读取同一 state/identity/TTL/audit；45个现有分模块测试之外新增三入口纵向集成测试。

#### FREE-01 Snapshot free grounding

- **依赖**：无，可与 FE-01 并行。
- **文件**：
  - `make-snapshot-consume.ts`；
  - `workflow-core.ts`；
  - plan fact/authority projection；
  - delivery summary projector。
- **动作/验收**：严格按 R-P0-04；必须先写执行 Snapshot 的红测，再改实现。
- **禁止**：
  - 再加源码字符串/顺序测试；
  - 通过清空 UI 文案掩盖仍传入的事实；
  - 放宽 rights/qualification。

#### PLAN-01A Execution plan contract honesty（P0）

- **依赖**：无。
- **文件**：
  - `compiled-carrier-executor.ts`；
  - `carrier-unit-recipes.ts`；
  - `plan-compiler.ts`；
  - plan store/contracts。
- **动作**：
  - 红测定义当前 executor只支持安全串行；
  - plan version/capability明确 `serial`；
  - compiler不再产出、或 consumer拒绝所有未消费的 parallel/retry/cache字段；
  - published plan含未支持语义时 fail closed。
- **完成**：
  - 当前串行顺序与 replay保持稳定；
  - replay不重复副作用；
  - 未实现语义不能进入 snapshot或被描述为可用。

#### PLAN-01B Group/retry/cache implementation（Wave 3，可选能力）

- **依赖**：PLAN-01A；不阻塞 SUBMIT-01A。
- **动作**：先修 recipe因果分组并验证 DBOS replay，再分别实现 group并发、cache、bounded retry；三者可拆独立子票。
- **完成**：只对实际实现的语义要求独立 unit重叠、下一组等待、cache绑定 snapshot/release、retry不重复副作用。

#### BILL-01 Commerce readiness and price single truth

- **依赖**：WF-00。
- **文件**：
  - Core plan/payment mapping；
  - Web payment API/provider/catalog；
  - pricing/add-on/BillingCard。
- **动作**：
  - server-side readiness聚合 published revision、mapping、provider facts、env/secrets；
  - checkout价格只来自/验证同一 revision；
  - 全 CTA共享 readiness；
  - disabled时展示同一诚实出口。
- **测试**：
  - admin改价后 display/provider amount一致；
  - missing mapping/amount drift/secret absent → provider调用0次；
  - no subscription不显示portal；
  - sandbox正向另归 Release Wave。

#### ADM-01 Remove three-bucket active projection

- **依赖**：Credits detail projection可用。
- **文件**：
  - Admin Home usage panel/model/messages；
  - `legacyCreditUsageProjection`；
  - merchant support diagnostic。
- **动作**：
  - support先切 canonical Credits/ProductUsage；
  - 删除三桶 panel/synthetic bridge/i18n/tests；
  - credits aggregate未实现前显示“未接线”，不造0值绿。
- **验收**：
  - 全商家/Admin可达文案无三桶；
  - 正常 credits低余额不被报 legacy mismatch；
  - grant/reserve/settle/refund/expire可追溯。

#### ADM-02 Stop boot-time price mutation

- **依赖**：BILL-01。
- **文件**：
  - `core-assembly.ts`；
  - `credit-plan-catalog-source.ts`；
  - admin migration command。
- **动作**：
  - 删除启动自动迁移；
  - 建显式 dry-run preview + expectedRevision + audit + rollback；
  - 非 HKD/历史 revision默认 fail closed等运营决定。
- **验收**：
  - 重启前后所有已发布 revision byte-equivalent；
  - CAS冲突不覆盖；
  - 明确迁移才产生新 revision。

### Wave 2：补完整商家闭环

#### SUBMIT-01A Durable accept before slow Agent planning

- **依赖**：PLAN-01A。
- **文件**：
  - Web core request timeout registry；
  - composer submission route/client；
  - submission coordinator；
  - queue/outbox与现有 replay status。
- **动作**：
  - 先持久化 idempotency + accepted Task/Run并快速 202；
  - planning进入 durable async：持久化 Task/Run + queue/outbox 后，失败时按幂等边界整 turn重跑；AgentKernel仍无 checkpoint，不引入第二 durable Agent runtime；
  - 过渡期 Web可先通过现有 replay polling拿状态；
  - timeout分类为 accepted/pending/timeout/unavailable。
- **验收**：
  - 模拟 plan >10s，浏览器不报假 unavailable；
  - BFF断开后 Core完成，原 idempotency key恢复同 Task；
  - 重试不产生第二 Task/扣费。

#### SUBMIT-01B Canonical accepted/pending event consumption

- **依赖**：SUBMIT-01A、FE-01；与 ARCH-02 合并实施。
- **动作**：用唯一 AgentEventStore 消费 accepted/planning/ready/failure，SSE为 canonical、polling仅 fallback；避免新增第三套提交状态。
- **验收**：连接中断/reconnect cursor幂等，UI与服务端同一 Task/Run phase。

#### TIMEOUT-01 Operation-level timeout ownership

- **依赖**：SUBMIT-01A 可并行。
- **Addresses**：R-P1-02。
- **动作**：建立一个 Web/Core operation timeout registry；quote/structured commands/submission分别声明budget；`CORE_TIMEOUT` 与 `CORE_UNAVAILABLE`分开；已提交/可能提交的动作只能返回accepted/pending recovery identity。
- **验收**：12s quote不再被通用10s暗截；timeout前后server commit两种情况可判别；retry恢复同一idempotency/Task。

#### STORE-01 Store loading/error/ready

- **依赖**：无。
- **文件**：`product/client.ts`、`routes/dashboard/store.tsx`。
- **验收**：
  - initial GET 500/timeout显示商家语言错误和重试；
  - retry成功进入同一 state；
  - 不永久 Skeleton；
  - 不泄漏 Core stack。

#### MEM-01 V3.1 Memory projection

- **依赖**：typed contract可先局部做。
- **文件**：
  - `packages/contracts/src/reuse-memory.ts`；
  - Core memory query；
  - `memory-vault-page.tsx`。
- **动作**：
  - 投影 kind/authority/state/statement/revision/source；
  - Preference/Correction/Procedure/Episodic按现行产品域呈现；
  - Correction优先；
  - loading/error/mutation error/retry/load-more；
  - cursor分页。
- **验收**：
  - 51+ 条记录可加载；
  - 来源删除标注不级联；
  - 商家无全量导出端点；
  - confirm/rewrite/delete后UI确定刷新。

#### MEM-02 Thread restore carries task/work authority

- **依赖**：FE-01、MEM-01。
- **动作**：
  - Thread projection带 current/recent Work/task；
  - replay transport/reducer消费 `recentTaskId`；
  - Artifact/Work提供“本次引用经验”稳定入口。
- **验收**：
  - 仅 `?threadId=` 打开 delivered Thread也能看到正确 receipt；
  - 无 task时显示诚实空态，不猜最近任务。

#### WORK-01 Works / Result responsibility cut

- **依赖**：DEL-01。
- **动作**：
  - Works只保档案、版本、来源、证据、本地复制；
  - adopt/AI adjust/server export/handoff deep-link exact Result revision/panel；
  - 一个深 `ResultAction` module；Works只生成类型化 `ResultTarget`，由 ResultAction 消费，不在 Works 内代理写动作；
  - 修复 ContentPackage + canvas work重复展示。
- **验收**：
  - 同一 revision从三个入口得到同一 action/result；
  - Works不再写第二套 delivery状态；
  - 返回/滚动/focus恢复。

#### LINK-01 Canonical deep-link mapping

- **依赖**：WORK-01。
- **范围**：
  - `contentId/handoffId/packageId/taskId/stage/entry`；
  - notification/Feishu/device relay/global command。
- **动作**：
  - 一张类型化 mapping表；
  - 每个 producer必须有 destination consumer；
  - 无法映射的历史对象显示 explicit unavailable。
- **验收**：
  - 静态 gate 枚举 producer/consumer；
  - 浏览器打开每类链接不丢对象/阶段；
  - 不回默认 Composer假装成功。

#### ART-01 Shared Artifact media completion

- **依赖**：FE-01、PLAN-01A。
- **动作**：
  - image/note/video Artifact真消费 imageRef/keyframe/media metadata；
  - stable ID、partial→ready 原位生长；
  - 不建第二套 ContentPackage；
  - video保留模型原生生成、分镜/关键帧过程进度与交付镜头清单；不提供字幕、视频封面或产品化编辑器；分镜不进入Plan，也不参与积分定价。
- **验收**：
  - `copy | note | media` 三 carrier 覆盖 copy/note/image/video 四条成品路径；
  - note双预览；
  - partial reconnect；
  - mobile 320/390；
  - Result/Works lineage一致。

#### UX-EPIC Merchant vocabulary + honest actions

- **依赖**：主行为可并行。
- **子票**：
  - UX-01A：Agent Thread、raw statuses、`rN`、delivery/outcome enums、Memory keys → merchant vocabulary projector；
  - UX-01B：Result“按1次创作计费”和 TIMEOUT假重试 → exact Credits/refund + 无 Job回工作台；
  - UX-01C：Clipboard false success → promise结果驱动状态与manual fallback；
  - UX-01D：Catalog fake search → 实现过滤或隐藏控件。
- **验收**：
  - static merchant-language gate；
  - failure/retry/credit/clipboard interaction tests；
  - raw enum fallback必须失败。

#### CREDIT-01A Redemption projection coherence

- **依赖**：无。
- **动作**：
  - redemption返回 canonical credit detail delta或同时 invalidate projection/detail。
- **验收**：
  - 兑换成功无需刷新即显示批次+流水+余额；
  - 重复 redemption幂等。

#### CREDIT-01B Commerce CTA coherence

- **依赖**：BILL-01。
- **动作**：plan/add-on/renewal/portal统一使用 CommerceReadiness；无active subscription只显示升级。
- **验收**：
  - disabled payment无死 CTA。

#### JOURNEY-01 Current product-contract browser matrix

- **依赖**：DEV-02、CI-02；各场景按对应产品票转绿。
- **范围**：
  - U1/U8/U9：pure copy免人工确认但冻结、付费媒体确认、拒绝零扣、request创建reserve、hold到期退款；
  - D-173：copy≤3、image_text/video各5操作；
  - D-174：档案行业→whyNow、空值/未映射兜底；
  - D-171：XHS对象工作区、OpenCLI/manual双轨、device bridge独立状态；
  - U13：Goal/Proactive阈值unset默认关。
- **验收**：每条绑定当前 decision、无seed/route mock掩码、逐文件 verdict；未实现/条件延期显示诚实状态而非假绿。

### Wave 3：把过渡架构收成深模块

#### ARCH-01 Typed P1 operation registry

- **依赖**：FREE-01、DEL-01 等 P0 先锁行为。
- **动作**：
  - operation key → query/command/input/output/auth/idempotency/handler；
  - 先覆盖 Store/Composer/Delivery/Credits/Memory；
  - 保留 HTTP URL；
  - 逐步删除 caller泛型 `as T` 和 `z.unknown()` fallback；
  - Foundation switch迁到 registry。
- **验收**：
  - unknown action编译/运行均 fail；
  - contract生成 Web client；
  - authorization只声明一次；
  - 主旅程无 caller-supplied result type。

#### ARCH-02 One client projection

- **依赖**：FE-01、SUBMIT-01A；本票同时承接 SUBMIT-01B 的 canonical event consumption，避免循环依赖。
- **动作**：
  - AgentEventStore作为唯一 current Thread projection；
  - legacy Composer UI只读 adapter；
  - 先迁 interrupt/phase，再 task/delivery；
  - 决定 SSE canonical，polling只fallback；
  - 删除旧双写/SSE glue。
- **验收**：
  - 单 event在两 UI面只产生一次状态迁移；
  - reconnect cursor幂等；
  - 无 effect把新 store回写旧 session。

#### ARCH-03 Operations hot-path repositories

- **依赖**：DEL-01、WORK-01。
- **动作顺序**：
  1. 先盘点 ContentPackage/rights/usage/audit 的跨 collection原子不变量，并为每组事务指定 canonical transaction owner；
  2. 复用 `ContentPackageRevisionWritePort` 接 OCC writer；
  3. exact ContentPackage read；
  4. CreativeWork；
  5. TaskInbox；
  6. SearchProjection；
  7. LegacyCanvasArchiveReader。
- **验收**：
  - 热路径 SQL 只访问必要表；
  - 不 load/save whole workspace；
  - workspace global lock缩小；
  - Postgres/Memory contract同语义；
  - 历史兼容仍可读。

#### ARCH-03B Narrow Model Supply ports

- **依赖**：ARCH-01 typed operation边界可并行。
- **动作**：先把 concrete control-plane callers改成 `GenerationRuntimePort`、`ModelCatalogAdminPort`、`ModelPreferencePort`、`CanvasTextQueuePort`、`QualityEvaluationPort` 等窄类型；一个 Postgres adapter可实现多个 port，不制造多余 class。
- **验收**：API/worker graph只依赖各自所需 port；后续 ARCH-04 不再把 concrete god interface seal进生产图。

#### ARCH-SESSION-01 Honest Agent phase model

- **依赖**：SUBMIT-01A。
- **Addresses**：R-P1-17。
- **裁决**：若phase仅作单turn观测，改名 `AgentTurnPhase`并删除无producer状态；若跨请求决定行为，则由AgentRun/SessionStore CAS持久化。
- **验收**：声明的每个状态都有producer/consumer/transition test；不再把每turn从idle新建的runner描述为durable session状态机。

#### HREL-01 HarnessRelease Artifact/Lifecycle/Rollout

- **依赖**：ARCH-04 graph sealing；可与 software REL-01 设计并行，但两类证据不可互相替代。
- **Addresses**：R-P1-25。
- **动作**：盘点并补齐 immutable PromptPack/Skill/Tool/Schema/Model Policy组合、candidate lifecycle、workspace allowlist、per-run exact release pin、manual rollback与Admin G/H投影。
- **验收**：给定run可还原exact HarnessRelease与每个revision/digest；rollback不字段级拼装；unset/unknown release fail closed；Artifact/Lifecycle/Rollout有当前SHA合同+持久化+Admin证据。

#### ARCH-04 Production graph sealing

- **依赖**：ARCH-03B；ARCH-03 可局部并行。
- **动作**：
  - production required ports constructor-owned；
  - 真循环统一 `LateBound<T>`，listen前 `seal()`；
  - split shared persistence/API/worker assembly；
  - worker只接实际依赖；
  - production migrator由 deploy migration job按 release只执行一次；API/worker boot只验证 schema；仅本地 supervisor可在 advisory lock下自动迁移。
- **验收**：
  - 缺必需 port在启动前失败；
  - worker不构造 Session/Web-only graph；
  - production API/worker replica不执行 DDL，schema mismatch在listen前失败；
  - API/worker DBOS/queue fingerprint一致。

#### ARCH-05 Background ownership

- **依赖**：ARCH-04。
- **动作**：
  - 列出每个 outbox/recovery/expiry/reconcile owner；
  - durable poller迁 worker/pg-boss recurring；
  - Web ordinary request不 drain，preview/dev fallback节流；
  - API健康与 worker健康分别投影。
- **验收**：
  - API关闭、worker在时 recovery继续；
  - 多 API replica不复制 poller；
  - payment outbox只由一个 lease owner处理。

#### ARCH-06 Write ownership explicit

- **依赖**：ARCH-04。
- **动作**：
  - 分开处理两个不同语义：`p1_write_ownership='p1'` 管 Product/P1 side effects；`content_package_write_ownership='contentpackage'` 管 ContentPackage canonical writer；不得把后者写成 `p1`；
  - bootstrap按各自合同在同事务写明确 ownership；
  - 对两张 ownership分别只读盘点历史 missing；
  - backfill有审计/rollback；
  - missing最终 fail closed，legacy必须显式行。
- **验收**：
  - 新账号无需 dual-read ambiguity；
  - 每个 semantic owner的 reader/gate对同一缺失值不再相反；
  - 数据迁移前后计数可核对。

#### ARCH-07 EPIC Physical locality cleanup

- **依赖**：ARCH-01～06 的 seam稳定后。
- **子票**：
  - ARCH-07A：ComposerHost 三 controllers；
  - ARCH-07B：`agent-domain.ts` 按领域机械拆并保留barrel；
  - ARCH-07C：server route definitions一次构建；
  - ARCH-07D：source regex tests替换为行为/AST边界；
  - ARCH-07E：删除 `OperationsCommandIntentRegistry`。
- **验收**：
  - 不以行数作为唯一完成指标；
  - deletion test：删 wrapper不会把复杂度原样退回 caller；
  - 无新 package/框架/runtime。

### Wave 4：退役与清理

#### RET-01 Pro Studio / `model_canvas_*` runtime deletion candidate

- **依赖/硬门**：WF-00、CI-01B、相关 same-SHA PG/DBOS与浏览器门；production DB证明 zero pending/leased/running、最长TTL/lease窗已过、无 pinned DBOS/legacy replay引用、审计导出与回滚包完成。
- **动作**：
  - 删除 generation quote/submit/retry/cancel/catalog/jobs；
  - 删除 canvas text stream/SSE/outbox/provider effect；
  - 禁止编辑任何已应用历史 migration；停止启动期创建退役 runtime schema，并为未来 fresh schema另定策略；
  - 保留历史 schema/lineage/read-only table，本票不 DROP；
  - 明确保留 D-170 KEEP：`DEFAULT_CANVAS_WORK_*`、`CANVAS_GENERATION_*`、`audio-contracts`/audio pipeline、generic canvas-name/library/Light/Artifact Canvas、OwnedAsset/Object Storage、`canvas/assets/intake-*`；删除 audio所在旧树前必须先证明已迁出；
  - 可留一个 retired-command rejection。
- **验收**：
  - symbol absence gate；
  - Web/Core typecheck与历史 ContentPackage读取；
  - 本票不 DROP历史表；
  - `apps/canvas`/Pro Studio入口仍为0。

#### RET-02 Canvas export asset closure

- **依赖**：RET-01 的同一数据/消费者硬门；可同批但独立提交与回滚。
- **动作**：删除 query/action/permission/assembly/storage verification。
- **验收**：五步素材上传、授权、采用仍通过；历史 adopted package仍可读。

#### RET-03 Billing legacy shrink

- **依赖**：ADM-01、ADM-02。
- **动作**：
  - 删除旧 `plan.addons`；
  - 删除 writable LegacyBillingLedger/no-op calls；
  - Admin普通页面移除旧 addons；保留 D-128 仍有效的动态 `plan.trial.enabled` 开关；
  - Stripe只保留有 obligation证据的 historical slice。
- **验收**：
  - P1唯一 production writer静态门；
  - legacy read/cutover/replay绿；
  - no new Stripe checkout；
  - Creem生产引用=0。

#### RET-04 EPIC Dead entry and facade cleanup

- **依赖**：LINK-01、ARCH-01。
- **子票**：
  - RET-04A：command palette停止 task/session/job死链接，删除 orphan search/workspace主动入口；
  - RET-04B：仅删除 merchant catalog 的 retired `standalone_tool`/direct-tool producer；不碰 Agent Tool registry与 integration pending actions；
  - RET-04C：收窄 Recipe Studio低层 commands；
  - RET-04D：清零消费者 locale/script/assets。
- **验收**：
  - 每个 active link都有目标消费者；
  - compatibility shell只被历史链接触发；
  - standalone executable code保持0。

#### RET-05 Archive active automatic publisher

- **依赖**：WF-00 的 D-155 erratum/交叉引用完成。
- **动作**：按 D-155 后置修订删除 active publisher port/writer/CTA/evaluator，主链只投影 unavailable，保留 history reader。
- **未来边界**：只有新的 accepted 决策/spec 才能重新引入 deferred publisher module；本票不预留休眠活代码。
- **验收**：
  - 任何当前 merchant route均无 `publish:*` 承诺；
  - assisted/export/manual/self-report不受影响；
  - 不删除 Feishu/BYOK/secret-store integrations。

#### RET-06 U14 legacy retirement

- **依赖**：最后执行。
- **门**：
  - zero active/pending legacy；
  - longest hold 30d；
  - audit export；
  - rollback演练；
  - ops safety buffer；
  - 新主旅程不劣于旧流程。
- **禁止**：按文件名含 legacy直接删除；不得提前动只读历史岛。

### Wave 5：建立可满足的发布证据

> 注意：CI-01A/B 与 CI-02 是 **Wave 0 / Wave 1 entry 的门禁前置**，这里只因发布链阅读顺序列出详细规格；不得等到产品修复与架构重构完成后才实施。

#### CI-01A Same-SHA persistence instrument（Wave 0）

- **依赖**：无；与 CI-02 并行，先以 advisory 运行证明 runner、数据库和计数本身可信。
- **动作**：
  - Core 90 个 required persistence files（87 个命名 PG + 2 个 DBOS + 1 个 canonical opt-in 非命名文件），Web 6 个 PG test files / 14 tests；
  - 使用当前 SHA 的 fresh isolated business DB + DBOS system DB pair；
  - unexpected skip=0；
  - evidence记录每文件 pass/fail/skip count。
- **验收**：任何文件贡献0 test或数据库缺失均 fail；仪器控制样本能稳定抓到 missing DB、silent skip与错误DBOS pair。

#### CI-01B Promote calibrated persistence to required（Wave 1 entry）

- **依赖**：CI-01A 的仪器控制样本全部通过。
- **动作**：在接收 Wave 1 产品修复 PR 前，把 Core/Web PG/DBOS gate与 Web auth/workspace/admin/payment/Waffo binding纳入 required。
- **验收**：blocking suite不允许 `known_red`；已知红必须修复，或显式降级为有 owner/ticket 的 advisory/instrument，且不得参与 release verdict。

#### CI-02 Journey ownership catalog

- **依赖**：无；与 CI-01A 并行。
- **动作**：98 个 Playwright files 以及全部 96 个 PG/DBOS opt-in files 登记 owner/tier/env/current decision/allowed skip/artifact。
- **验收**：
  - fixture/provider-free身份必须显式；禁止 skip、route mock 或 fixture shortcut 把未执行路径报绿；live证明归 REL-02；
  - `v31-82` 明确 instrument，不进入 full RC产品判决；
  - superseded/retired spec不再污染 release。

#### CI-03 Merge vs advisory separation

- **依赖**：CI-02。
- **动作**：
  - `merge-required` 只聚合 blocking；
  - advisory telemetry独立 workflow/run；
  - same-SHA fixture production-candidate主旅程进入 merge required。
- **验收**：advisory red不挡 deploy；blocking任一非success必挡。

#### REL-01 Immutable artifacts and staging deploy

- **依赖**：CI-03、DEV-03、ARCH-04、ARCH-05 background ownership；若production允许创建新workspace，另依赖ARCH-06 ownership明确化。
- **动作**：
  - 构建 Web artifact + 单一 Core runtime artifact，API/Worker共享 digest/version；
  - staging business DB 与 DBOS system DB compatibility/preflight + expand migration；
  - deploy Core API/Worker并 pin `HARNESS_DBOS_APPLICATION_VERSION`；
  - readiness；
  - deploy Web；
  - 不在 migration后被普通 cancel。
- **验收**：
  - digest来自 deploy artifact，不是 `apps/core/src`；
  - worker/API同一 Core runtime artifact/release；
  - crash/restart恢复同 DBOS run；
  - rollback只回退 immutable application version；不得回滚 DBOS/business schema、删除 in-flight run或伪造恢复。

#### REL-02 EPIC External live evidence

- **依赖**：REL-01、BILL-01。
- **子票**：
  - PROVIDER-01：provider-live reusable/exact-run artifact；copy/note/media 三 carrier的四条成品路径按批准范围执行；
  - PAY-01A（RC-ready）：Waffo Test sandbox不route-mock，真checkout→RSA/签名webhook→settlement→credit batch，满足 Credit spec §9；
  - PAY-01B（production-live）：生产产品、密钥、公钥、webhook、exact mapping、金额/币种、renewal/cancel/refund/人工补单与幂等重放、post-smoke及运营授权；
  - NET-01：external network probes携带可验证 evidence。
- **共同验收**：evidence绑定 commit/release/environment/expiry，secret不进artifact，live失败不被fixture补绿。若只完成PAY-01A，则只能标pilot/payment-disabled launch并隐藏/禁用全部Production付费入口；只有PAY-01B完成才可作Production商业声明。

#### REL-03 Manifest after evidence + release-required

- **依赖**：REL-01、PROVIDER-01、PAY-01A、NET-01、当前 required journey catalog全绿且无 P0 release blocker；若production启用支付，另依赖PAY-01B。
- **动作**：
  - manifest最后铸造；
  - refs来自本 run artifact metadata并逐个解引用验 SHA/digest；
  - `release-required` 聚合 staging browser/DBOS recovery/Waffo/provider/network；
  - production deploy只监听该聚合 + 人工批准；staging deploy是 `release-required` 的前置。
- **验收**：
  - PR/main 图只到 `merge-required`；explicit RC 图完成 staging、证据和 `release-required`；production 图按 exact RC run/artifact promotion；
  - missing/expired/other-SHA evidence fail closed；
  - manifest `pass` 不再硬编码。

### 9.6 Finding → owner ticket traceability

| Finding | Owner ticket(s) |
|---|---|
| R-P0-01 | DEV-01、DEV-02、DEV-03 |
| R-P0-02 | FE-01 |
| R-P0-03 | DEL-01、DEL-SEC-01 |
| R-P0-04 | FREE-01 |
| R-P0-05 | PLAN-01A；PLAN-01B仅在选择实现能力时 |
| R-P0-06 | BILL-01、PAY-01A/B、CREDIT-01B |
| R-P0-07 | CI-03、REL-01、PROVIDER-01、PAY-01A/B、NET-01、REL-03 |
| R-P1-01 | SUBMIT-01A |
| R-P1-02 | TIMEOUT-01 |
| R-P1-03 | DEL-02 |
| R-P1-04 | DEL-01 |
| R-P1-05 | STORE-01 |
| R-P1-06 | MEM-01 |
| R-P1-07 | MEM-02 |
| R-P1-08 | WORK-01 |
| R-P1-09 | LINK-01 |
| R-P1-10 | CREDIT-01A |
| R-P1-11 | ART-01 |
| R-P1-12 | SUBMIT-01B、ARCH-02 |
| R-P1-13 | ARCH-01 |
| R-P1-14 | ARCH-02 |
| R-P1-15 | ARCH-03 |
| R-P1-16 | ARCH-04 |
| R-P1-17 | ARCH-SESSION-01 |
| R-P1-18 | ARCH-05 |
| R-P1-19 | ARCH-04 |
| R-P1-20 | ARCH-06 |
| R-P1-21 | ADM-01 |
| R-P1-22 | ADM-02 |
| R-P1-23 | WF-01 |
| R-P1-24 | CI-01A/B |
| R-P1-25 | HREL-01 |

CI 增加反向机器检查：每个 active finding 至少有一个 owner ticket；ticket完成时必须更新 finding状态/证据，禁止孤儿 finding或“完成票无对应缺口”。

---

## 10. 推荐第一批 Agent 队列

遵守单波 ≤12 项、旅程票先行。第一批建议只开以下 10 项：

1. WF-00 authority correction/erratum；
2. DEV-01 stale install + workerd heap；
3. DEV-02 truthful supervisor；
4. CI-01A same-SHA persistence instrument设计与红测；
5. FE-01 Thread/账号隔离；
6. DEL-01 canonical handoff；
7. FREE-01 Snapshot free grounding；
8. PLAN-01A execution contract honesty；
9. BILL-01 CommerceReadiness；
10. ADM-01 三桶移除。

其中：

- 旅程 owner：DEL-01 + FREE-01；
- 环境/仪器优先：DEV-01/02、CI-01A；
- 行为修复完成前，不启动 ComposerHome/Operations 大拆分；
- 每张票由一组原子小提交组成；每个提交只包含一个已验证的语义变化，禁止混入全仓格式化。DEL/BILL/PLAN 等跨层纵切不强迫挤成单提交。

---

## 11. Agent 工作包模板

每个执行 Agent 的任务描述必须包含：

```text
Authority:
- exact decision/spec/line

Current failure:
- reproducible UI/API/database evidence
- evidence tier

Canonical owner:
- semantic owner
- current duplicate writers/readers

Scope:
- files allowed
- files explicitly out of scope

Red test first:
- behavior, not source-string presence

Implementation:
- smallest vertical slice

Verification:
- unit/contract
- current PostgreSQL/DBOS when relevant
- real browser path
- no unexpected skips

Done:
- observable user signal
- old path removed or documented compatibility/delete condition

Evidence:
- commit SHA
- commands and exact counts
- screenshots/artifact paths
```

执行中要求：

- 发现同一语义第二 writer，先停下裁决 owner；
- 发现 compatibility path，标 `active / read-only history / trigger-bound / delete`；
- 失败测试必须能在修复前稳定复现；
- fixture、recorded、live 三类输出分开记；
- 任何支付、发布、凭据、历史 DROP、外部动作必须保持 fail closed。

---

## 12. 全项目完成定义

只有以下全部成立，才允许把项目状态升级为“完整主旅程可用”：

### 产品

- Day-0 零素材首次出活；
- customized copy/note/image/video；
- free 首轮与派生第二轮默认无隐式门店 grounding，显式 allowlist 精确生效；
- pure copy `policy_exempt_copy` 免人工确认但仍冻结 exact Snapshot；任一付费媒体执行确认、拒绝零扣、request创建即reserve、hold到期退款；
- D-173操作预算：copy≤3，image_text/video各5；
- D-174档案行业驱动whyNow，空值/未映射走确定性兜底；
- D-171 XHS对象工作区与 OpenCLI/manual 双轨；device bridge作为独立fail-closed门；
- waiting/refresh/cross-device恢复；
- deterministic edit与生成改版；
- copy/download/ZIP/system share/canonical handoff；
- feedback/chips；
- Store/Assets/Identity/Rights/Memory；
- Credits报价/预占/结算/退款/余额不足/流水；
- Admin治理；
- mobile/accessibility。

### 信任

- Thread/账号/workspace无串状态；
- handoff token唯一；
- exact revision/authority/rights/facts/quote冻结；
- no fake retry/publish/copy success；
- no raw engineering enum；
- no three-bucket/Creem/Pro Studio/standalone active promise。

### 工程

- published plan中的dependency/retry/cache语义被真实消费；尚未实现的语义被version/reject，不能假声明；
- one client projection；
- P1 operation typed；
- background owner明确；
- Core/worker装配分离；
- hot path不再 whole-workspace aggregate；
- explicit write ownership；
- retired runtime/commands无消费者。

### 验证与发布

- same-SHA Web+Core PG/DBOS，unexpected skip=0；
- required browser覆盖当前主旅程；
- staging→production 复用 exact same immutable Web/Core artifacts；
- Core/Worker/DBOS/Web同 release；
- restart/recovery/rollback；
- Waffo Production 生命周期全验；若仍是 pilot-only，则所有 production付费入口明确关闭；
- protected provider-live；
- external network evidence；
- manifest最后生成且逐项绑定本 run；
- HarnessRelease Artifact/Lifecycle/Rollout、PromptPack、allowlist与exact release pin可还原，并与software artifact证据分开；
- release-required green + 人工批准；
- production drain、不可取消的迁移/部署临界段与 post-deploy smoke。

以上是“核心主旅程可用”的完成定义。若要声称“V3.1 全部完成”，还必须额外闭合 Goal/Proactive 的 F/G/H/I、evidence门控、HarnessRelease rollout/manual rollback，以及 U14 legacy退役全部条件；Goal/Proactive在U13/批次6门前默认关闭，不是当前核心发布阻塞。

---

## 13. 明确禁止的“修复”

- 不要只执行 `pnpm install` 后把 Web能打开当根因已修；
- 不要只看端口/PID判断栈健康；
- 不要用无限重启掩盖 workerd crash；
- 不要加第三套 handoff token或第四套 delivery状态机；
- 不要只改 free UI文案而继续把事实传给模型；
- 不要 Promise.all 当前 dependency groups；
- 不要用 source-regex测试替代行为测试；
- 不要把 fixture/provider-free green写成 live；
- 不要把 ancestor CI/浏览器/PG证据拼到当前 HEAD；
- 不要在 Provider checkout后才检查 payment mapping；
- 不要让启动流程静默改运营价格 revision；
- 不要因“legacy/canvas/stripe”名字批量删历史兼容；
- 不要整删 `p1/integrations`，其中 Feishu/BYOK/secret-store仍有活消费者；
- 不要在 U14 门前删 durable replay和只读 history islands；
- 不要引入第二 durable runtime、LangGraph/Mastra grammar executor或新状态存储来掩盖现有 seam。

---

## 14. 结语

本项目的主要问题已经不是“缺少更多类、更多表或更多测试文件”，而是：

1. 一些关键接口声明和真实执行不一致；
2. 同一业务语义有多套前端状态、token、delivery或价格真相；
3. 已退役能力的 UI消失了，但后台运行时/DDL/诊断仍在；
4. 测试和发布编排无法把当前代码、真实数据库、真实浏览器、Provider、支付和部署绑到同一 SHA。

下一阶段应先修**信任边界、canonical owner、运行栈与证据图**，再做物理拆文件和大规模清理。按本报告 §9.0 的 hard-gate DAG 推进（Wave用于分组，显式依赖决定并行），可以在不引入新框架、不做大爆炸重构的前提下，把现有过渡架构收敛成真正可验证、可恢复、可发布的 Agent-native 产品。
