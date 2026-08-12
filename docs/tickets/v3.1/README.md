# V3.1 开发票索引（本地票面，2026-08-08）

> **票面真相**：GitHub 两账号封禁期间，本目录的票即任务书；Parent spec=`docs/specs/v3.1-agent-specs-2026-08-08/`（#1–#9 编号）。恢复后原编号补发 GitHub。
> 决策权威：V3.1（`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`）+ D-178 + ADR-0020。派发纪律见仓根 CLAUDE.md 与 `docs/ops/agent-dispatch-runbook-2026-07-29.md`。

## 依赖图（票号→Blocked by）

```
批次1: 01(∅) → 02(01) → 03(01,02) → 04(01,03) → 05(02,04)
批次2: 06(01,02) → 07(06) → 08(06,07) ; 09(07) → 10(04,09)
批次3: 11(09) → 12(11) → 14(12) → 13(14,观测票)
批次4: 15(03,04) → 16(14,15) ; 17(15; 自报落库子交付另等19)
E lane: 18(01; working切片内部等06) ; 19(01)   ←与批次2-4并行，不阻塞主线
批次5: 20(01) → 21(01,20; 集成验收等06/14) → 22(21) ; 23(08,21)
批次6: 24(17,18,19) ; 25(13,14,16,21) → 26(22,24,25+退役前置门)
```

## 前沿（可立即开工）

**V31-01**（唯一零阻塞前沿）。01 合入后前沿扩为 02/18(部分)/19/20。

## 并发条件（硬纪律）

- 每 lane 独立 worktree；`typecheck/test/test:interaction/e2e` 重写共享 paraglide 产物，同 worktree 不与 dev 并跑。
- **语义锁**：06/07/08 同域（Session Harness）单 lane 串行；18/19 独立 Memory lane；04/05/10/15 的前端部分可归 frontend lane（自包含上下文包：DESIGN.md+ADR-0014+ADR-0020+D-130）。
- 13 为观测票不占开发 lane；26 开工前先逐条核退役前置门（票面列明）。
- 不 push、不关票，合入由主控亲验（关票纪律：消费者证明门/行为为证/反向复核）。

## 票面 Status 索引（机器校验）

> **治理规则（FIX-P0-00）**：个票 `Status` 是唯一来源；本表 Status 列必须与票面原文逐字一致。CI：`node scripts/ci/assert-v31-ticket-index.mjs`（漂移 fail closed）。支持票面 `**Status**:` 与列表式 `- Status:`（V31-43/V31-44）。重新生成：`node scripts/ci/assert-v31-ticket-index.mjs --generate`。
>
> 上面的依赖图是开票时（2026-08-08）批次 1–26 的排期；V31-27 起为后续复核／整改／浏览器验收票，**没有统一批次号**，依赖以各自票面的 `Blocked by` 为准。下表覆盖目录内全部 **59** 张 V31 票（标题＋Status 原文由票面抽取）。

| 票 | 标题 | Status（票面原文） |
|---|---|---|
| V31-01 | [Agent 域 contracts + branded IDs + ownership matrix（含 release 合同）](V31-01-agent-contracts.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-02 | [AgentThread/AgentRun persistence + lazy legacy thread + sessionRevision OCC](V31-02-thread-run-persistence.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-03 | [Semantic Event Projector（三帧扩展）+ snapshot/replay](V31-03-semantic-event-projector.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-04 | [Client reducer + Narrative/Activity Workstream + Controlled Surface Registry](V31-04-reducer-workstream-surface-registry.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-05 | [Thread-root Workbench + recent 收编 + 基线采集 + A15/A16 验收](V31-05-thread-root-workbench.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-06 | [Session repository/service + turn runner + policy 中间件挂点 + AgentKernel port](V31-06-session-harness-core.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-07 | [Intent interpreter + ambiguity policy + 检索 tools](V31-07-intent-retrieval.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-08 | [Progressive Level 0–3 判定 + 计费 UX 三规则 + Quick Checks CI](V31-08-progressive-levels-billing-ux.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-09 | [PlanProposal → Plan Compiler → MarketingPlanRevision + CompiledExecutionPlan](V31-09-plan-compiler.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-10 | [Living Plan UI + diff + Compact Plan + commit strip](V31-10-living-plan-ui.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-11 | [确认卡扩容 + ExecutionConfirmationRequest/PlanConfirmationDecision（确认前 reserve）](V31-11-confirmation-objects.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-12 | [ExecutionPlanSnapshot + admission 绑定 + DBOS 复验 + stale/expiry](V31-12-snapshot-admission.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-13 | [shadow 对账（确定性字段、抽样 10%、时间盒）](V31-13-shadow-reconciliation.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-14 | [Make Harness 消费 snapshot + validator 降级 + Interrupt 类型化协议](V31-14-make-consumes-snapshot.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-15 | [Artifact protocol（snapshot/delta）+ 原位生长 + registry 注册](V31-15-artifact-protocol.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-16 | [Steering service + classifier 四态 + 双队列 + partial delivery](V31-16-steering.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-17 | [Publish Handoff + 商家自报旅程 UI](V31-17-publish-handoff-selfreport.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-18 | [Memory 扩列 + 双通道 + observation pipeline + 注入透明](V31-18-memory-platform.md) | merged-with-evidence-debt (merged f190a7cf) — Wave-4 evidence audit：AC1／AC2／AC5 已勾；**AC3 Playwright 于 2026-08-11 tip `1955a278e` 转绿并勾选**（revoke 投影 `f217c2c92` + B2 1/1）；AC4（`production-main-journey` / vault 删源）仍为证据债，故保持 debt 态而非裸 done |
| V31-19 | [OutcomeEvidence 统一（含 no_activity）+ D-168② 删除语义](V31-19-outcome-evidence.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-20 | [Prompt packs + strict 校验迁移到 release 发布点](V31-20-prompt-packs.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-21 | [HarnessRelease 三对象 + controlLimits 绑定 + canary + rollback](V31-21-harness-release.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-22 | [运营控制面：Release 台 + Tool Policy + Kill Switch + 审计](V31-22-ops-console.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-23 | [Eval：L0/L0.5/L1 + gates/verdict 三态 + L4 canary + 回滚演练](V31-23-eval-layers.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-24 | [MarketingGoal 产品面 + Proactive 管道（evidence 门控）](V31-24-goal-proactive.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-25 | [三 runner 收敛（§22.4 顺序：六原语化 → 单 executor）](V31-25-runner-convergence.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-26 | [Legacy 退役清单 + replay 归档条件门（U14）](V31-26-legacy-retirement.md) | 26a done (merged a4ddf1609, 2026-08-09)；**26b 五段 runner 部分已执行（2026-08-12，用户拍板「直接清理」，见下）**；26b 余项＝R1/R2/R6/R7（仍有消费者）＋U14 归档 fail-closed 执行（部署后按条件门）＋全量 journey 收官 |
| V31-27 | [Mid-run Steering 前台旅程（§37.4-G 缺口整改）](V31-27-steering-frontend-journey.md) | merged-with-evidence-debt (merged aaad2a0f1, 2026-08-09) — Wave-4 浏览器实证证伪 AC1（`v31-mid-run-steering-journey` 2 FAIL，红在前置步骤，本票被测行为未被走到）；降级为主控 2026-08-10 裁决，口径同 V31-18 |
| V31-28 | [Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）](V31-28-composer-plan-surface-integration.md) | merged-with-evidence-debt (merged 6bf659915, 2026-08-09) — Wave-4 浏览器实证：主题 testid 四个全灭（`plan-commit-strip`/`artifact-panel`/`agent-activity-line`/`composer-question-turn`，120s 超时）；降级为主控 2026-08-10 裁决，口径同 V31-18 |
| V31-29 | [E2E 共享 fixture 诚实性（`ui-journey.ts` 三处假绿）](V31-29-e2e-fixture-truthfulness.md) | in-progress — 2026-08-09 L-CI：三处改动已落 `2a0d1f73`（票面曾记 `6f6379565` 为脚手架/关联提交；诚实性 diff 主体是 `2a0d1f73`），hermetic A/B `10/10`。**2026-08-11 residual**：复核三处仍 fail-closed（无回归）；新增常驻静态契约 `src/lib/e2e-ui-journey-truthfulness.test.ts`（`4/4` ＋既有 hard-gate/settlement 共 `14/14`）。**AC6 仍未完成**：两个 required job 本轮仍未实跑——不能用静态绿冒充 CI 绿；需健康宿主或 CI 补真实计数后才能关票。 |
| V31-30 | [P1 route mock 信封诚实性（`{ data }` 缺 `meta` 让覆盖缺口伪装成通过）](V31-30-p1-route-mock-envelope-truthfulness.md) | open — 2026-08-09 由 L-CI 开票，未开工 |
| V31-31 | [退役额度词汇的计费侧收口：billingNotice 无消费者孤儿 ＋ legacy video 退款标签](V31-31-retired-quota-vocabulary-billing-copy.md) | open |
| V31-32 | [Prompt-pin 静默替换类全量扫除（余 11 处）](V31-32-prompt-pin-silent-substitution-sweep.md) | open |
| V31-33 | [Harness start 恢复扫描无 tenant 作用域](V31-33-recovery-sweep-tenant-scoping.md) | partial（AC1–AC3 已落；AC4 附带项静默空三处未动） |
| V31-34 | [注入 receipt 面板的撤销态无服务端来源（刷新即忘）](V31-34-receipt-panel-server-revocation.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-35 | [Plan 里可读的分镜（§37.4-D 缺口，contracts→compiler→投影三段接缝）](V31-35-plan-storyboard-deliverable-seam.md) | **废止（2026-08-11 用户拍板，不实施）** |
| V31-36 | [视频场景级部分失败通路（§37.4-D 缺口，Core 产品能力缺失）](V31-36-video-partial-failure-pathway.md) | open（Core 通路 + unit 验收已落；e2e 真跑归合并轮） |
| V31-37 | [字幕/封面 assisted fallback：§37.4 承认 #264 退役，或等 V31-15 落 producer（决策票）](V31-37-video-subtitle-cover-fallback-decision.md) | open（决策已落盘，实施收尾中） |
| V31-38 | [PlanCompiler 的 recipe / source / catalog / skill 端口换成真权威](V31-38-recipe-skill-authority-port.md) | open |
| V31-39 | [Composer 意图轮的剩余「无出口等待」族：decision 缺失与 systemOnlyBlock](V31-39-fixture-kernel-composer-decision.md) | open |
| V31-40 | [计划 revision 与 plan.created/plan.revised 语义事件的原子性（outbox / 修复缝）](V31-40-plan-revision-event-atomicity.md) | open |
| V31-41 | [prepare 失败无计数、无死信、钱无出口：规划侧终态与预留释放](V31-41-prepare-failure-dead-letter.md) | partial（终态/计数/退款/运营信号已落；D-150 submit 消费者证明与变异背书仍开） |
| V31-42 | [shadow reader 的 threadId 槽位落 workspace id（经实测＝不可达分支，非隐患）](V31-42-shadow-reader-thread-id-slot.md) | open — 建议裁为「记录在案，随 V31-03 晋升决策一并处理」，不建议单独派工 |
| V31-43 | [issue 255 live collector 启动锁竞态（required 套件内的已知 flaky）](V31-43-issue255-collector-startup-lock-race.md) | open |
| V31-44 | [DBOS admin server 的角色策略（API 角色未关 3001）](V31-44-dbos-admin-server-role-policy.md) | open |
| V31-45 | [derived_revision 直写路径不报价不计费，与商家文案承诺矛盾](V31-45-derived-revision-billing-bypass.md) | open |
| V31-46 | [跨边界重投的裸 `Error` 会被 artifact emitter 当瞬时失败吞掉（＋发散重试卡死形态无测试）](V31-46-semantic-event-boundary-error-typing.md) | open |
| V31-47 | [跨载体交付真接线（一 Make 一载体），并拆除 freeze 处的 fail-closed 门](V31-47-cross-carrier-execution-wiring.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-48 | [dbos-registration.smoke 手写 fixture 毒化 operations migrate，级联假红](V31-48-smoke-fixture-poisons-operations-migrate.md) | open |
| V31-49 | [V3.1 浏览器验收门三缺口：spec 任务书 ＋ B2 重叠度裁决](V31-49-browser-acceptance-three-missing-journeys.md) | open |
| V31-50 | [Web SSR 拿不到 PG 连接时未接管的 socket error 杀掉整个进程](V31-50-ssr-unhandled-socket-error-kills-process.md) | open |
| V31-51 | [day0 旅程「商家确实没有门店」的缺席编码漂移（`null` vs `undefined`）](V31-51-day0-initial-store-absent-encoding.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-52 | [一键授权后「已保存到素材库」确认文案 60s 不出现（共享 fixture 上游断言）](V31-52-inline-authorize-saved-copy-never-appears.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-53 | [goal-proactive 旅程用浏览器注入 gate config，服务端 `.strict()` 拒绝](V31-53-goal-proactive-client-injected-gate-config.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-54 | [K 自报旅程被 `case_image` source slot 挡在门口，`5ed00f453` 的浏览器验证腿至今未跑过](V31-54-k-journey-case-image-slot-fixture-gap.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-55 | [admission 变体②：context 围栏拒绝之后，商家收到的是「幂等冲突」](V31-55-admission-variant2-context-fence-then-idempotency-conflict.md) | partially-fixed（2026-08-11 resume 续证）——臂1/臂2/变体③ platform 收窄与后续 rights-revision 第二臂（`1d24ab24d`）已在 INT。2026-08-11 终验：B2 **不再以** `IDEMPOTENCY_CONFLICT` / `CONTEXT_FENCE_MISMATCH` / `SNAPSHOT_STALE(rightsRevisionRefs)` 为失败签名；B2 现红在 **revoke 后 memory 仍 `confirmed`**（归 V31-18 AC3 产品面）。ops-console / rights / context-fence 等旅程仍有独立红（见 closeout report）。文案/映射两债＋浏览器变异反证＋两条旅程全绿 **仍未勾** |
| V31-56 | [Living Plan 免费调整阶段：`/revise` 与 `/start` 两个请求各自以不同方式卡死](V31-56-living-plan-revise-stall.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-57 | [Interrupt expiry E2E fixture 无法推进时钟](V31-57-interrupt-expiry-fixture-clock-advance.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-58 | [素材撤权旅程断错 UI 类型（test-contract mismatch）](V31-58-rights-revocation-test-contract-mismatch.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-59 | [Ordinary settlement billing identity when sourceTaskId absent](V31-59-ordinary-settlement-billing-identity.md) | open（2026-08-11）— residual risk documented; not claimed fixed without product evidence |
| V31-60 | [契约收窄：videoSceneState 删除 subtitle/coverStatus/coverRef 死字段（V31-37 拍板遗留）](V31-60-video-scene-contract-narrowing.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-61 | [字幕/封面残链清理：先斩 model-supply 时长推导依赖，再核 handoff/content-package 残余](V31-61-subtitle-residual-chain-audit-cleanup.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |
| V31-62 | [V31-15 AC2/3/4 定向浏览器绿证补齐（原位生长核心合同只有单测背书）](V31-62-artifact-protocol-ac234-evidence.md) | evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending |

**Status 形式（FIX-P0-00）**：`V31-43` / `V31-44` 仍为列表式 `- Status:`，其余为粗体式 `**Status**:`。校验脚本两种都认；索引 Status 列只写票面原文（不再附加「列表式」旁注）。两票头部整体是另一套风格（`- Owner:` / `- Blocked-by:`），是否统一属票面属主决定。

**Wave-4（2026-08-10）新开六张**：V31-50–V31-55 全部出自 W4-D journeys lane 的三轮浏览器验收，证据与锚点署树 `2da11d5ab`（W4-D round3 的运行树）。其中 V31-55 是**症状票**（根因归 W4-B 4D），V31-49 含 62 个「不在任何必跑门内」spec 的 audit 项。

**视频域纠偏轮（2026-08-11）新开三张**：V31-60/V31-61/V31-62 出自当日两项用户拍板（V31-37 A 路：字幕/封面无效不交付；V31-35 废止：分镜不进 Plan、与计费无关）后的主控复核——契约死字段、model-supply 字幕残链（含 `index.ts:5764` 时长推导隐性依赖，删前必须先斩）、V31-15 AC2/3/4 零浏览器证据。锚点统一署树 `main@0af4beb7`。

**Wave-4 终审 v2（2026-08-10）追加三张**：V31-56 是 W4-B 已开的 Living Plan 独立卡死票；V31-57 承接 interrupt expiry fixture 无法推进时钟；V31-58 起于素材撤权旅程对 `composer-terminal-outcome` 的表象红，后经 `e183a97dc`（merge `67ea5e5e7`）证实为 spec 断错 UI 类型：生产已正确渲染 failure report，故按 test-contract mismatch 收口并回归 V31-14 evidence debt，不立 terminal 生产缺陷。
