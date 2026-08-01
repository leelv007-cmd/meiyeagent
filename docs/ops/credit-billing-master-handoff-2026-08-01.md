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

**完整 journey 门禁每张实施票只在合并前运行一次。** 触发条件是主控已完成 §11.5 前三步、双轴复核与聚焦/数据库门禁均无 P0/P1、lane 已对齐 current main 且下一动作就是合并；开发自测、被打回后的修复轮和仍有阻断项的验收轮不重复运行完整 journey，只跑定位问题所需的最小聚焦门禁。完整 journey 通过后若 HEAD、base 或相关运行时事实发生变化，该证据立即失效，仍须在新的可合入 HEAD 上重跑一次；完整 journey 失败则禁止合并，修复后等再次达到可合入状态再运行。单票交验评论与主控关票评论必须记录该次唯一合并前 journey 的 HEAD、命令及真实 pass/fail/skip。

四门交验标准（手册 §三全文适用）：消费者证明（D-150，生产调用点 file:line）、**可达性证明**（生产真的走到新路径，单测绿不算）、**出口证明**（每个等待态有必然出口＋未授权入边负向，花钱/放行类无负向证据不采信）、假绿三禁。

## 四、环境与凭据（全部已供给，票面只引用不索取）

- **Waffo 测试凭据**＝`docs/_private/waffo.env`（gitignored）：MERCHANT_ID/PRIVATE_KEY/STORE_ID。只准子进程 env 注入，明文永不进代码/评论/commit/argv（e2e-lock.sh 会记 argv 到日志）。测试卡＝`4576750000000110`。
- Waffo 已实测事实（CB-0 资解，详见 #297 评论）：SDK `@waffo/pancake-ts@0.16.1`；store=`meiyeagent`（storeWebhooks 现为空，需 `client.webhooks.add` 注册）；续费事件＝`subscription.payment_succeeded`（eventId=Payment ID）；`subscription.updated` Waffo 侧未激活——我方升级走「取消+新 checkout」，无依赖。
- `docs/_private/reui.env`：REUI_LICENSE_KEY（.mcp.json 引用，与本轮无直接关系）。

## 五、多路并发：资源占用规则与故障排查（血泪已付学费，勿复交）

本轮 #298 合入后将有最多四路 lane 同时开发，以下是撞车高发区与排查顺序。

### 5.1 资源占用规则（派活前先算槽）

- **并发额度：全局同时 ≤3 个「占槽面」**。占槽＝PG-backed 测试（带 `TEST_DATABASE_URL`）、dev server、playwright/e2e 浏览器面。**不占槽**＝纯 Node 单测+typecheck（无 DB、无 dev、无浏览器）、设计/schema/文档/只读分析。四路并行时至少一路应处于不占槽阶段，主控调度时错峰。
- 每票独立 worktree（`git worktree add ../lane-<票号> main`）；主 checkout 只留主控复核合入，**不跑长驻 dev**。

### 5.2 locale:compile 冲突（本项目第一大假红源）

- **typecheck / test / test:interaction / e2e 四条命令都以 `locale:compile` 开头**，会重写共享 paraglide 产物（`src/locale/paraglide/`），任何一条都能掀掉正在跑的 dev 与并行测试，**换端口无效，只有 worktree 隔离有效**。
- 症状：正在跑的 dev 突然模块解析错乱、测试中途莫名崩溃、`matchCache` 相关报错。**`matchCache` 报错＝残留产物非产品缺陷**，清理重跑即可。
- 纪律：同一 worktree 内上述命令与 dev 串行；跨 lane 靠 worktree 天然隔离，无须全局静默。

### 5.3 e2e 锁与秘密纪律

- e2e 走 `e2e-lock.sh` 全局锁（同类面互斥）；**该脚本会把命令 argv 记录到 `/tmp/meiye-e2e.log`**——一切 DB URL/provider secret（含 Waffo 凭据）只准以子进程 env 受控注入，禁止写进锁脚本或任何包装脚本的 argv；证据文件与命令输出不得含连接串。
- lane 报「等锁不动」：先看 `/tmp/meiye-e2e.log` 尾部确认持锁方，再判断是真在跑还是死锁残留。

### 5.4 lane-driver 生命周期（重复实例＝冒名评论根源）

- `lane-driver.sh` 是事件循环，**关终端不会停它**。彻底清理三步：`pkill` driver → 杀其 codex 子进程 → 删 `/tmp/lane-<N>-driver.{pid,lock,sig}`。
- 同一票下出现多条重复「主控」前缀评论：**先查有无重号 driver**（两个 driver 写同一 worktree/同一票），不要先怀疑人为冒名。
- codex 续跑注意：DB/网络类任务 resume 不继承 sandbox 旗标，必须 `codex exec --dangerously-bypass-approvals-and-sandbox resume <id>`，否则 Postgres 报 `Operation not permitted`。

### 5.5 高负载假红判别（判红标准流程，按序执行）

多路并发 + 连续 e2e 会把宿主拖进退化态，失败形态**每次都不同**（超时/端口/渲染各异），不要按报错字面追产品缺陷。判红顺序：

1. **先查 git diff 是否命中报错文件**——没命中的报错优先怀疑环境。
2. **单文件隔离重跑**该失败用例；隔离绿＝并发撞车。
3. 查全局负载：`ps aux | sort -nrk3 | head`——若 `fseventsd`/`appstoreagent` 等系统进程高 CPU 且杀不动＝**宿主维护积压退化态，无孤儿可清，唯一解＝重启 Mac**。
4. 重启后仍疑难：**fallback＝开 draft PR 走 CI 亲验**（先例：PR #283 本机三败 CI 一把绿）。CI 是最终裁判，本机三连败不等于代码有错。
5. 详版 runbook：`docs/ops/local-e2e-host-degradation-runbook-2026-08-01.md`。
- 已知本地绿≠CI 绿的反例：CI 缺 CJK 字体问题已修（core-quality.yml 装 fonts-wqy-zenhei），若新增烧录/渲染类测试报字体缺失，按此先例查 CI 字体安装。

### 5.6 readiness gate 写法红线

- gate 前置只准写**外部事实**（台账 sha / 主控评论 / worktree 是否 dirty）；rebase/对齐/清理是本轮第一项任务，**不是前置**（曾自锁 10 小时）。
- 跨 lane 判据必须按**路径交集**收窄（`overlap_pattern` 推广到所有 lane），禁止「任何生产路径有改动就拦」——十路并行时该条件恒不成立。
- lane 长时间无进展，主控第一件事＝把它的 gate 脚本拿出来实跑并逐条算判据，不要等 lane 自己报。

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
