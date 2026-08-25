# Master Handoff — 产品 Bug 清账批次（2026-08-25）

**基线**: main = `3b88fd265`（本文所有 `file:line` 锚均署此树；行号漂移时以符号名重定位）
**批次组成**: V31-45（验证收口）→ V31-107（主修）｜V31-108（独立并行）｜V31-92（**不派工**，见 §4）
**驱动**: 主控任 driver。执行 agent **禁止一切 GitHub 写操作**、不 push、不关票；合入由 driver 亲验后 ff 推 main。环境与关票纪律以 `docs/ops/agent-dispatch-runbook-2026-07-29.md` 为准，本文 §5 只列本批次特别注意项。

## §0 派发结构与语义锁

| Lane | 票 | 顺序 | 理由 |
|---|---|---|---|
| **Lane S**（steering／计费） | V31-45 → V31-107 | **串行，同一 worktree 同一 agent** | 两票同改 `apps/core/src/p1/agent-session/steering-service.ts` 且同属 steering 计费语义（`projectSteeringImpact` / quote 口径），并行必冲突 |
| **Lane P**（execution-spine） | V31-108 | 与 Lane S 并行 | 改 `p1/execution-spine/`（submission-coordinator + store），与 Lane S 无文件、无语义交集 |
| — | V31-92 | 不派工 | 票面明令 open-observing：无失败轮不准猜修 |

两 lane 各开独立 worktree（`agent-worktrees/` 下），互不进对方目录。

## §1 V31-45 — derived_revision 计费绕过（Lane S 第一棒）

### 现状核实（2026-08-25 对 main 重读，与票面「问题」节相比已大变）

票面锚的是 `codex/v31-fix-steering@2c1913a18` 旧树。**核心缺陷在当前 main 已被修掉**：

- `consumeDerivedRevision`（`steering-service.ts:891-911`）**只剩 quoted workflow 一条路径**：无 `derivedWorkflow` 消费者 → `QUEUE_NOT_READY` 503；无 `workId` → 409。票面骂的 `:1096` 不计费直写分支与 `steeringDerivedRevisionActionConsumer` 已不存在。
- `derivedRevisionAuthority` 在生产代码**零引用**（全仓 grep 仅测试可能残留）→ 票面「replay 带 authority 绕过 quote」的通路已消失。
- workflow 路径真实报价：`steering-derived-workflow.ts:321-322`（`billing.buildQuote` + `quoteAuthority.resolve`）。
- 商家文案侧未变：`projectSteeringImpact`（`steering-service.ts:375-430`）中 `derived_revision` 恒 `rebilled=true`，feeNote「按正常生成一样算积分」＋settledNote 原样在。

**结论**：文案承诺计费 ↔ 代码单路径计费，两侧现已一致。本票剩余价值＝**把这个状态钉死并收口**，不是重修。

### 要做的事

1. **裁决落盘**：`derived_revision` 计费口径按「应当计费」定案（与 D-061、现行文案、现行实现三方一致）。在票下补一段实施记录：引本文 §1 现状核实的锚点，写明「方向 2（删捷径统一走 workflow）已由 Task 8 血统实现于 main」，并把裁决一句写进 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 的决策附录（或 driver 指定的决策权威文档）。
2. **钉死测试**（防捷径回潮，对应票面 AC 二、三条）：
   - 负向：`consumeDerivedRevision` 在无 `derivedWorkflow` 消费者时抛 503、无 workId 时抛 409（**不得**静默 `'completed'`）。写法上先把断言写成旧行为（直写成功）确认必红，再断言现行为绿——这是「已修缺陷」的先红后绿等价物。
   - 正向：一条带库或内存装配测试证明 derived_revision 走 `launchDerivedRevision` 产生 ProductQuote＋usage reservation，金额口径与 `projectSteeringImpact` 的 feeNote 同源（禁止两处各算一次）。
   - 回归：grep 证明 `derivedRevisionAuthority` 生产零引用，用一条静态测试（或现有合同测试扩一断言）钉住「steering 消费者面不得再出现绕过 quote 的直写口」。
3. **D-061 复查**：确认该路径无上游成本／token／USD 泄漏字样进商家可见文案。
4. 票面 Status → 已修待关，Evidence SHA 填验证轮。

### 注意

- `projectSteeringImpact` 与 `steeringUnitLabel`（`:349`）**别在本棒动**——那是 V31-107 的地盘，同 lane 下一棒接手。
- 票面「语义锁」节仍有效：确认无其他 lane 在动 steering 消费者面（本批次内只有你自己）。

## §2 V31-107 — make-steering 主修：进度表 schema＋分类器读真进度＋按页计费（Lane S 第二棒）

B 止血已在 main（`357687474`、`112fb3a04`），blocker 清空。计费口径**用户已终裁**（2026-08-23）：**已生成页重做按页计费、未生成页免费改向**——不再需要裁决，直接实现。

### 范围（按票面四条，锚点校准到 main）

1. **schema**：`p1_make_steering_task_progress` 加 `label`、`page_index`（migration；写点 `workflow-core.ts:2548`、`dbos-workflow.ts:1830` 一并写入——行号取自票面，以符号重定位）。
2. **Core**：`steeringUnitLabel`（`steering-service.ts:349`）与 `inferAffectedFromInstruction` 读真进度行；「封面不要写最后两个名额」须命中封面页。B 版「整篇处理」降级保留为兜底。
3. **计费**：已生成页重做＝按页 quote/settle（复用 V31-45 验证过的 workflow 报价缝）；未生成页＝0。`projectSteeringImpact` 回读文案明示「这一页会重做，预计 N 分」——注意现文案刻意不报数字（`:405-408` 注释），改为报数字前确认 quote 时点上数字已可得，禁止拿旧余额猜。
4. **合同**：§5.6 spec 文本与 `packages/contracts` steering authority 字段同步。

### 验收（照票面）

- 带库单测：进度行带 label/page_index；封面指令命中封面页；已生成页 authority 回读含重做计费、未生成页回读 0。先红后绿＋反向对照（去接线必红）。
- e2e `v31-mid-run-steering-journey` 两轮绿＋新增「页已生成后改封面」一腿。
- V31-105 §1 标「A 已修」，V31-107 票面收口。

### 注意

- migration 动 `apps/core` 持久化：**必然**触发 opt-in 证据债（§5.3），并要求对应 `*.postgres.test.ts` 新增/更新。
- 与 V31-45 的钉死测试同文件——本棒 rebase 在第一棒之上，不回头改第一棒的断言语义。

## §3 V31-108 — prepare 终态拒绝静默悬挂（Lane P，独立并行）

Blocker（V31-105 ①A `orchestration_lost`）**已在 main**：`postgres-creation-submission-store.ts:2529`（`terminateRunningWork`）、`:2612/:2703`（`orchestration_lost` 分支）。可直接开工。

### 缺陷链（锚点校准到 main，文件在 `apps/core/src/p1/execution-spine/`）

`PREPARE_TERMINAL_REJECTION`（`submission-coordinator.ts:692` 定义、`:2171` 处理）只做预留退款对账＋把 `creation_submissions.harness_state` 写 `failed`，**不动 `p1_creative_works`** → work 永久 running、商家无申报卡无重开入口；`listStalledWorks`（store `:2447`）要求 work=running **且** harness_state≠failed，回收器永远不捡。

### 修法（票面已给，与 ①A 同构）

prepare 终态拒绝时调用 `terminateRunningWork`：
- work→failed；预留 usage＋credits 退回，幂等键复用 `stalledWorkRefundOperationId(taskId)`（store `:2627` 现行用法），与既有 prepare 退款对账**去重**（恰退一次）；
- 在 task id 与 prepared-attempt run id 两个 workflow_id 下写 `workflow_failed` 审计，SSE 抬申报卡＋「改一下要求」入口；
- 新增 `StalledWorkTerminalReason='prepare_rejected'`（类型在 store `:54` 引入处），商家原话按拒绝原因给一句人话，**不得写「超时」**；
- 前端零改动。

### 验收（照票面）

1. 带库单测先红后绿：拒绝→work failed、恰退一次、审计含拒绝原因；二次触发 `already_terminal`。
2. 反向对照：去接线必红；V31-82／①A 既有用例不受影响。
3. e2e：prepare 被拒旅程重开标签页见失败卡＋重开入口；`xhs-image-text-main-journey` 一轮绿。
4. V31-105 §13 与本票标「已修」。

## §4 V31-92 — 不派工（open-observing），只留取证 SOP

票面明令：**拿到失败瞬间状态才准改**；该红自 08-15 未复发，取证仪器已在 main（`2171413bf`）。任何 agent **不得**给清理加重试或放松 `run-service.test.ts` 673 行断言。

**复发时的动作**（谁看到谁做，五分钟内）：从红轮 `root-required-quality-evidence` artifact 取 `root-test.log`，按票面判据表读三样（wrapper stderr 有无 `failed to remove superseded fallback evidence`；evidence dir 清单 fallback 计数≥2 否；两者皆无＝孤儿赋值序），把结论带 file:line 写回票面，再按票面 AC 走修复。

## §5 环境与纪律（本批次特别注意项；全集见 dispatch runbook）

1. **worktree 隔离**：每 lane 独立 worktree；`typecheck/test/test:interaction/e2e` 都会重写共享 paraglide 产物（`locale:compile`），同 worktree 内不与 dev 并跑。
2. **数据库**：带库单测用主实例 5432，`TEST_DATABASE_URL`＋`TEST_DBOS_SYSTEM_DATABASE_URL` 走 `scripts/ci/provision-test-db.sh` 空库建＋migrate；**禁 `TEMPLATE meiye`、禁碰 54330（证据库）**；54329 是 lane e2e 库且有串行锁纪律。跑完删库。
3. **opt-in 证据债**：两 lane 都动 `apps/core` 含 `*.postgres.test.ts` 的目录（`agent-session/`、`execution-spine/`），合并前**必然**要还债——driver 统一跑官方管线：`PERSISTENCE_POSTGRES_ADMIN_URL=… RELEASE_COMMIT_SHA=$(git rev-parse HEAD) bash scripts/ci/run-persistence-evidence-instrument.sh`，再 `record-opt-in-persistence-evidence.mjs` 签收据。已知坑：`/tmp/meiye-e2e.lock` 残锁会让 runner 假成功（判成败看日志尾行不看退出码；锁内 pid 死了才准删）；本机 `createrole_self_grant` 已于 08-24 修正，无需再动。
4. **测试纪律**：每条修复先红后绿＋反向对照（去接线必红）；判红必须拿失败瞬间状态；review 双向跑（正向找漏、复核取反驳立场）。
5. **本地静态门**（推前必跑，driver 亲跑）：`node scripts/ci/assert-v31-ticket-index.mjs`、`node scripts/uiux/opt-in-test-evidence-guard.mjs`、`node --test scripts/ci/*.test.mjs scripts/ops/*.test.mjs`（08-24 教训：漏 scripts/ops 会被 root-quality 抓）。
6. **journey/e2e 本地跑**：必须 CI 全量 env（#298 教训：dev 档 runtime-profile 会硬覆盖 .env 恒 fixture）。
7. **提交与合入**：执行 agent 只在自己 worktree 落本地 commit（英文 message）；driver 每轮先查 `git log` 防谎报；合入走 PR＋全轮 CI，required 全绿后 ff 推 main（`git push meiyeagent <sha>:main`）。

## §6 完工定义与汇报格式

- **每票 DoD**：票面 AC 全勾＋Evidence SHA 填实跑轮＋相关 V31-105 分节标记同步＋本文对应节由 driver 划账。
- **汇报模板**（每棒交付时）：改动文件清单（`file:line` 署树）；测试计数（新增红→绿各几条、全套件计数）；反向对照证据；未尽事项如实列（不许静默缩范围）。
- **批次终态**：Lane S 两棒＋Lane P 合入 main 且 required 三轮内无新增间歇红；V31-45/107/108 关票；V31-92 维持 open-observing 原状。

## §7 Driver 划账（2026-08-25）

| 节 | 票 | 产品 SHA | 台账 | 状态 |
|---|---|---|---|---|
| §1 | V31-45 | `7d5901bf7` | `4560ef8db`／`#40` | 已修待关（已合入 main） |
| §2 | V31-107 | `3b5ce927a` | 同上 | 已修待关（已合入 main）；V31-105 §1 标 A 已修 |
| §3 | V31-108 | `28df64b21` | 同上 | 已修待关（已合入 main）；V31-105 §13 标 V31-108 已修 |
| §4 | V31-92 | 未改 | — | open-observing，本批次未派工 |

- **main**：`3b88fd265` → 产品 `4560ef8db`（12 commits ff，PR #40 MERGED）→ 台账 follow-up `4a51d697a`
- **required CI**：Core quality `32763462431` 绿（含 `required` 聚合门）。Advisory `p2-browser-acceptance` 红，不挡合入。
- **关票纪律**：GitHub 票未关；票面维持「已修待关」。
- **未尽（批次合入后）**：`prepare_rejected` / mid-run-steering 全栈浏览器未在本 driver 轮实跑。根上残留 `LANE-P-REPORT.md`（Lane P 交底，已随栈进 main）。
- **2026-08-25 续**：Lane S 补 V31-107 pin（preview quote + billed-unit launch）；Lane P 补 V31-108 e2e-only fixture + cataloged spec。Driver 合入 local main `12d8c3849`，blocking persistence 11 文件 / 103 tests 绿并签收据。未 push、未关 GitHub 票。V31-92 仍 open-observing。
