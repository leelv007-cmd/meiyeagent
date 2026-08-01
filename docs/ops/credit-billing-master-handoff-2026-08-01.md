# 积分制计费实施轮 — 中控交接书（2026-08-01）

> 交接原因：原主控（Claude 会话）订阅额度耗尽。本文为新任主控（Codex）的一次性上岗交底。
> 上岗后第一动作：通读本文 → `docs/specs/credit-billing-spec-2026-08-01.md`（尤其 §9/§10/§11）→ `docs/ops/agent-dispatch-runbook-2026-07-29.md`。

## 一、你的角色与主权

你是**主控（总控）**：验收、合入 main、关票、修订 spec 的唯一主权方。开发 lane（同为 Codex 实例，但角色不同）不 push、不关票、不动 main。

- 「已合入」唯一有效凭证＝`docs/ops/merge-ledger.md` 出现对应 sha 行（**该文件只由主控提交**；票号列只写 `#数字` 或 `—`，修饰语进备注列，否则机器 checker 判整本无效）。
- 裁决评论前缀「主控裁决」「依赖更新（v4 编排）」「主控合同增补」**裸写在正文首字符**（不加粗、不加引号，gate 用 `^主控` 锚定正则识别）。
- 放权型/解禁型指令只能出自主控评论；lane 冒用主控前缀的放权评论一律无效。
- §11.6：不落票下评论＝不存在。你的每次裁决、合入、spec 修订（附 main commit sha）都落票下评论。

## 二、当前状态快照（截至 2026-08-01 交接时刻）

**权威链（已闭合，勿重开决策）**：

- 产品决策＝设计日志 **D-172**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`，supersedes D-123 计量口径/D-044 试用条数/D-045 条数语义/ADR-0016 三桶单位/一切 Creem 口径；D-061 双真相不废）。
- 实施权威＝`docs/specs/credit-billing-spec-2026-08-01.md` 终稿（含 §10 拆票、§11 开发纪律与合并规范）。冲突序：spec 终稿 > 票资解（#290–#295）> 票面。
- CONTEXT/PRODUCT/DESIGN/双 AGENTS/归桶矩阵/landing/供给清单均已同步（commit `d1684d3a`）。

**票局**：

- **#297**（CB-0 Waffo 人工前置）已关，五项全核销。
- **#298**（L1 账本与合同）＝**唯一在飞票，整票执行不拆**，开发 Codex 已领。它是一切的起点。
- **#299–#302**＝lane 跟踪父票（不领活，子票全关后由主控关闭）。
- **#303–#312**＝十张实施子票（CB-01…CB-10，编号即开发序），blocked-by 边已织为机器判据：
  - #298 合入 → 解锁 **#303 定价后台 / #304 Waffo 主链 / #305 工作台三位 / #306 明细页**（四路并行）。
  - #303→#307 参考面板；#304→#308 加油包结算→#309 Creem 退役；#307+#304+#308→#310 价格页；#305+#306+#310→#311 清扫；全部→#312 全门验收。
  - **关键路径＝#298→#304→#308→#310→#311→#312，Waffo 线优先派。**

**git**：main 领先远端约 9 个未推送 commit（两份 spec、D-172 同步、ReUI 收编、拆票记录等）。是否 push 由用户决定，主控不擅推。

## 三、验收与合入（你的核心工作循环）

按 spec **§11.5 六步**执行，摘要：lane 交验评论到位 → 主 checkout diff `lane-<票号>` 分支逐行溯票面（越界打回）→ 复跑该票必绿门+typecheck（§11.4 子票级映射：门4 后台=CB-05/前台=CB-08、门5=CB-02/06、门6=CB-04、门10=CB-06）→ 反向复核双向跑（D-157，复核取反驳立场）→ 亲手 merge + merge-ledger 记 sha → 主控前缀评论关票 → 下游以台账 sha 为解锁信号。

四门交验标准（手册 §三全文适用）：消费者证明（D-150，生产调用点 file:line）、**可达性证明**（生产真的走到新路径，单测绿不算）、**出口证明**（每个等待态有必然出口＋未授权入边负向，花钱/放行类无负向证据不采信）、假绿三禁。

## 四、环境与凭据（全部已供给，票面只引用不索取）

- **Waffo 测试凭据**＝`docs/_private/waffo.env`（gitignored）：MERCHANT_ID/PRIVATE_KEY/STORE_ID。只准子进程 env 注入，明文永不进代码/评论/commit/argv（e2e-lock.sh 会记 argv 到日志）。测试卡＝`4576750000000110`。
- Waffo 已实测事实（CB-0 资解，详见 #297 评论）：SDK `@waffo/pancake-ts@0.16.1`；store=`meiyeagent`（storeWebhooks 现为空，需 `client.webhooks.add` 注册）；续费事件＝`subscription.payment_succeeded`（eventId=Payment ID）；`subscription.updated` Waffo 侧未激活——我方升级走「取消+新 checkout」，无依赖。
- `docs/_private/reui.env`：REUI_LICENSE_KEY（.mcp.json 引用，与本轮无直接关系）。

## 五、环境铁律速记（血泪已付学费，勿复交）

- 每票独立 worktree（`git worktree add ../lane-<票号> main`）；**typecheck/test/test:interaction/e2e 四条命令都会重写共享 paraglide 产物**，同 worktree 不并跑、跨 lane 靠 worktree 隔离，换端口无效。
- 同一 lane 只许一个 driver：见重号「主控」评论先查 `/tmp/lane-*-driver.{pid,lock,sig}` 与重复 codex 进程。
- 本机连续高负载 e2e 会假红（形态每次不同）：先查 git diff 命中+单文件隔离重跑；不行走 draft PR 用 CI 亲验（runbook：`docs/ops/local-e2e-host-degradation-runbook-2026-08-01.md`）。
- readiness gate 前置只准写外部事实（台账 sha/主控评论/worktree dirty），rebase 类动作是本轮第一项任务不是前置；跨 lane 判据必须按路径交集收窄。

## 六、交接时刻的待办清单

1. **盯 #298 交验**（在飞）：到货后走 §11.5 六步。它的验收面最重：§9 门 1/2/3/7/8/11＋门 9 账本半边。
2. #298 合入后**同时派 #303/#304/#305/#306**（并发额度：占槽面全局 ≤3，纯 Node 单测+typecheck 不占槽）。
3. 中后段按 §10 边推进；#312 全门验收报告落 #302 评论后终审关图。
4. 远期挂账（不阻塞）：Waffo 生产环境开通复验（§5.4 生产侧）；push main 待用户发话；#280-pwa、#146 live 门、#240 运营窗为本轮外旧账，勿混入。

## 七、信息索引

| 要什么 | 去哪 |
|---|---|
| 产品决策原文 | 设计日志 D-172（及其 Supersedes 链） |
| 实施细节/验收门/纪律 | credit spec §1–§9 / §9 / §11 |
| 逐票任务书 | `gh issue view <N> --comments`（评论覆盖票面） |
| 条数体系文件级处置清单 | #291 资解（退役 18/改造 30+/保留 11） |
| Waffo 集成事实 | #290 资解 + #297 核销评论 |
| 通用纪律全文 | `docs/ops/agent-dispatch-runbook-2026-07-29.md` |
| 合入台账 | `docs/ops/merge-ledger.md` |
