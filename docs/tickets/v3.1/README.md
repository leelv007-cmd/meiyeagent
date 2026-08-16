# V3.1 开发票索引（本地票面，2026-08-08）

> **票面真相**：GitHub 两账号封禁期间，本目录的票即任务书；Parent spec=`docs/specs/v3.1-agent-specs-2026-08-08/`（#1–#9 编号）。恢复后原编号补发 GitHub。
> 决策权威：V3.1（`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`）+ D-178 + ADR-0020。派发纪律见仓根 CLAUDE.md 与 `docs/ops/agent-dispatch-runbook-2026-07-29.md`。
> 当前集成、验证与 release 边界以 [`docs/ops/current-project-status.md`](../../ops/current-project-status.md) 为唯一入口；本页只维护票面索引与历史依赖图。

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

## 历史前沿（2026-08-08 开票时）

**V31-01**（当时唯一零阻塞前沿）。当前执行前沿不得从本段推导，见 CURRENT。

## 并发条件（硬纪律）

- 每 lane 独立 worktree；`typecheck/test/test:interaction/e2e` 重写共享 paraglide 产物，同 worktree 不与 dev 并跑。
- **语义锁**：06/07/08 同域（Session Harness）单 lane 串行；18/19 独立 Memory lane；04/05/10/15 的前端部分可归 frontend lane（自包含上下文包：DESIGN.md+ADR-0014+ADR-0020+D-130）。
- 13 为观测票不占开发 lane；26 开工前先逐条核退役前置门（票面列明）。
- 不 push、不关票，合入由主控亲验（关票纪律：消费者证明门/行为为证/反向复核）。

## 票面 Status 索引（机器校验）

> **治理规则（FIX-P0-00）**：个票 `Status` 是唯一来源；本表 Status 列必须与票面原文逐字一致。CI：`node scripts/ci/assert-v31-ticket-index.mjs`（漂移 fail closed）。支持票面 `**Status**:` 与列表式 `- Status:`（V31-43/V31-44）。重新生成：`node scripts/ci/assert-v31-ticket-index.mjs --generate`。
>
> 上面的依赖图是开票时（2026-08-08）批次 1–26 的排期；V31-27 起为后续复核／整改／浏览器验收票，**没有统一批次号**，依赖以各自票面的 `Blocked by` 为准。下表覆盖目录内全部 **85** 张 V31 票（标题＋Status 原文由票面抽取）。

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
| V31-28 | [Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）](V31-28-composer-plan-surface-integration.md) | implementation-complete / release-verification-pending（2026-08-13）— 七腿及生产传输/恢复链已进入候选代码；旧 lane/worktree 已清理，余项为最终 Integration SHA 的 required CI 与证据归档 |
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
| V31-62 | [V31-15 AC2/3/4 定向浏览器绿证补齐（原位生长核心合同只有单测背书）](V31-62-artifact-protocol-ac234-evidence.md) | done（2026-08-12）— AC1–AC4 本地 4/4 与同 SHA CI 4/4 均有 artifact provenance |
| V31-63 | [浏览器必跑门收口：S0 successor 半成品死锁 + rights 冻结/校验基线不同源（付费运行 admission 恒死）](V31-63-browser-gate-s0-successor-closeout.md) | implementation-complete / release-verification-pending（2026-08-13）— successor 事务重建、session/run 继承、identity/rights/context pin、账务锁序与 fence 编舞均已进入候选代码；不再被 V31-28 阻塞 |
| V31-64 | [浏览器必跑门中途丢服务进程：Core／候选 Worker 静默退出无留痕，门无存活断言，35/42 红为级联假红](V31-64-gate-service-death-no-trace-no-liveness.md) | implementation-complete / release-verification-pending（2026-08-13）— service exit、fallback evidence、resolved verdict 与 NOT evaluated 已实现并经本地故障探针验证；等最终 Integration SHA required CI 的无级联判据 |
| V31-65 | [admin 敏感词「分类」控件换 shadcn Select 后 e2e 仍按原生 `<select>` 断言](V31-65-admin-sensitive-words-select-contract.md) | done（2026-08-12）— 整案本地绿＋同 SHA CI 1/1 绿，artifact provenance 已归档 |
| V31-66 | [admin-set-role.postgres.test.ts 的 cleanup 在干净库触发 last-admin 守卫（测试隔离缺陷）](V31-66-admin-set-role-cleanup-last-admin-trigger.md) | open（2026-08-12）— reproduced twice on fresh databases; fix not started |
| V31-67 | [issue-255-safe-provision 套件依赖仓外已删路径，默认又静默 skip（仪器缺陷）](V31-67-issue-255-safe-provision-suite-host-path.md) | open（2026-08-12）— suite depends on a deleted host path and silently skips by default; fix not started |
| V31-68 | [admin 页运维健康挂件对 job-runtime/observability 恒 403，打破 admin 旅程零 console 错误合同](V31-68-admin-ops-health-widget-403.md) | done（2026-08-12）— 修复、本地行为验证与同 SHA CI 绿证均已归档 |
| V31-69 | [首屏入口 chunk 减重：paraglide 按 locale 拆分＋contracts schema 迁出入口路径](V31-69-entry-bundle-reduction.md) | implementation-complete / release-verification-pending（2026-08-13）— contracts 精确 subpath 已切断入口 schema 聚合，gzip 恢复到 350k 预算内；未扩张 i18n 管线，最终 required CI 待补 |
| V31-70 | [浏览器门 workerd 猝死：三门同根的 Broken pipe 崩溃与仪器子进程盲区](V31-70-workerd-crash-gate-reliability.md) | implementation-complete / release-verification-pending（2026-08-13）— Cloudflare runtime 已 pin、Vite watcher 已排除 Playwright output、内嵌 workerd 首帧与 candidate runtime 断连均 fail closed；连续 required CI 轮待补 |
| V31-71 | [admin 旅程潜在竞态：「未挂载组件 setState」React 告警在 CI 负载下打破 console 纯净合同](V31-71-admin-setstate-before-mount-console-purity.md) | open（2026-08-13）— CPU 12x、retries=0、真实 Chromium repeat-each=5 为 5/5 通过且告警 0/5；未复现即不猜修，等待 CI 再现时挂临时 createTask/CDP 探针 |
| V31-72 | [production 门仅存两条 CI 真红：w12 360s 超时＋xhs SSE 断流注入未确认（本地恒绿，CI 2/2 复现）](V31-72-production-gate-w12-xhs-ci-only-reds.md) | implementation-complete / release-verification-pending（2026-08-13）— W12 已定性并在 production-candidate 通过；XHS 的 Service Worker、session resync 与 terminal receipt/recovery 修复已进入候选代码，余最终 Chromium 与 required CI |
| V31-73 | [新用户 image_text 首访旅程确定性死路：默认配方 `case_image` 硬前置无引导、400 落兜底文案劝重试](V31-73-composer-default-recipe-case-image-dead-end.md) | implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控五轴亲验（单测/interaction/变异/tsc+biome/零素材 e2e 本地 1/1 绿＋dev 真浏览器行为复核），余 required CI 与全量必跑门回归 |
| V31-74 | [Composer 发送键与 hint 文案仍承诺「流内问店」：08-12 分权裁决后的文案债（承诺与行为脱节）](V31-74-composer-send-copy-post-ruling-debt.md) | implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（静态 33/33、interaction 17/17、变异反证、tsc/biome、dev 真浏览器复核），余 required CI；`:212` e2e 断言首执行被 V31-76 红 1 挡住（residual） |
| V31-75 | [Dashboard 创作面展示层收尾包：失败态投影、枚举/术语泄漏、叠压与空态九项](V31-75-composer-surface-state-and-display-cleanup.md) | implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（静态 73/73、interaction 85/85、tsc/biome、映射变异反证、e2e：v31-day0-free-creation-journey 绿＋uiux-creation-loop 仅余 V31-76 已知红、dev 真浏览器九项走查），余 required CI |
| V31-76 | [day-0 spec 死线解封后的两条既有红：示例店 remix 重定向失效（疑真缺陷）＋ continue-item 缺失](V31-76-day0-spec-unblock-discovered-reds.md) | open（2026-08-13）— 主控复跑取证，未派工 |
| V31-77 | [Day-0 零素材首访旅程升格为 release gate：门内 fail-fast 首位 ＋ 种子掩码纪律可执行化](V31-77-day0-journey-release-gate.md) | implementation-complete（2026-08-13）— 门内 fail-fast 首位＋not_evaluated 判决书＋种子掩码静态契约三项落地，均经变异反证；同轮用真跑的门清掉 4 条 spec 侧假红并修出 1 条真产品缺陷（门店页事实 `at` 钉死） |
| V31-78 | [P0：model-default provisioning 失败一次即砖死整个 workspace（全请求 500 热循环，无终态无呈现）](V31-78-provisioning-model-default-livelock-bricks-workspace.md) | implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（postgres 终态测试 1/1 含变异反证、Core 35/35、web 27/27、tsc/biome/locale 净、两砖号活库自愈实证），余 required CI 与注册故障注入 e2e |
| V31-79 | [dev 环境单一真相：launchd 假 Core 清除、dev 档可启动、平台默认模型供给、worker 配对](V31-79-dev-environment-single-truth.md) | implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（scripts 30/30、seed+harness 4/4、core tsc、biome、dev:smoke 两跑全绿零漏库），余 plist 处置（等用户确认）与 required CI |
| V31-80 | [展示层二波：内部指令/裸 ID 直出、方案卡执行后不冻结、双叙述与用量双行复发](V31-80-composer-internal-text-leakage-second-wave.md) | open（2026-08-13）— 盘点取证，未派工 |
| V31-81 | [C8 steering 断裂：composer 任务运行中提交调整报「No admitted execution plan exists」英文裸错](V31-81-steering-no-admitted-plan-for-composer-task.md) | open（2026-08-13）— 盘点取证，未派工 |
| V31-82 | [C4 图文单悬死 `running`：20 分入 USAGE 无出口、无失败投影、worker 到位也不恢复](V31-82-image-work-stalls-running-credits-hang.md) | implementation-complete（2026-08-13）— 有界超时终态＋同事务退款＋失败投影＋解锁全落地；主控活体端到端证毕（含一处 lane 未覆盖的恢复态死锁，主控直修） |
| V31-83 | [P0：composer 会话状态跨账号泄漏（sessionStorage 键无作用域、登出不清）](V31-83-composer-session-cross-account-leak.md) | implementation-complete（2026-08-13）— grok lane 交付＋主控收口合入；活体复核换号零残留 |
| V31-84 | [P0 链式死锁：五步录入「说一句」提取空＋「逐条点头」确认按钮零请求 ⇒ 档案→素材→配方全链锁死](V31-84-store-onboarding-capture-confirm-broken.md) | implementation-complete（2026-08-13）— grok lane 交付＋主控收口；两断点修复已活体走查证毕（全确认路径）；跳过兜底路径的合同矛盾拆出 V31-86 |
| V31-85 | [视频线「换不需要案例图的写法」假出口：切自由创作后确认仍被 case_image 前置打回](V31-85-video-fallback-recipe-dead-end.md) | implementation-complete（2026-08-13）— 定性=目录里**根本没有视频 slot-free fallback 配方**，假出口改为诚实引导 |
| V31-86 | [Day-0「跳过用兜底」与 Core 双门合同矛盾：部分确认 finalize 必 409](V31-86-day0-partial-confirm-finalize-contract-contradiction.md) | implementation-complete（2026-08-13）— 二轮拍板（LLM 化流畅路径）已落地并活体走查证毕；Phase 2（LLM 提取接线）判不可接，另立 V31-89 |
| V31-87 | [同内容图片跨面重传恒 409 IDEMPOTENCY_CONFLICT：composer 内联上传永久失败循环](V31-87-same-content-reupload-idempotency-brick.md) | implementation-complete（2026-08-13）— 幂等键改为「内容 hash＋事实指纹」，两入口统一，失败呈现分层；主控追加撤权传播修复 |
| V31-88 | [素材库已授权资产无法挂入 composer 配方槽：只有「上传新图」没有「从素材库挑选」](V31-88-asset-library-composer-source-attach-gap.md) | implementation-complete（2026-08-13）— 挑选器落地并活体走查证毕（全链首次跑通到 202） |
| V31-89 | [「说一句」LLM 提取接线：Day-0 档案由模型整理，而不是前端正则](V31-89-spoken-sentence-llm-extract.md) | implementation-complete（2026-08-13）— 新 command 落地并活体证毕：纯口语句（正则抓不到）整理进档案卡，一击保存写库 |
| V31-90 | [Mid-run steering 解析权威：预备任务 id / Workbench 线程取不到 sync run，但不得拆线程隔离](V31-90-steering-authority-thread-scope-vs-prepared-task-id.md) | open（2026-08-15）— 诊断有效，上一版修法（删线程作用域）已回滚；**初稿「致跨 Work 串绑」的因果指控已撤回**（同一 409 在干净树复现，拆出 V31-91），回滚依据只剩设计面；接线契约已钉 |
| V31-91 | [显式 start 间歇性 409 `COMPOSER_PLAN_START_FAILED`：确认落库与 /start 之间存在竞态](V31-91-composer-plan-start-409-race.md) | in progress（2026-08-16）— ①可区分**已合入 main**（`d95aef263`，经 PR #14）：十五处裸抛改为十五个码，下次红即可读出是哪一支；②定位竞态方、③不加重试 未动 |
| V31-92 | [run-service 恢复写入成功后，fallback 证据没有被清理（间歇）](V31-92-run-service-recovery-retry-wallclock-race.md) | open（2026-08-15）— 间歇已确证（CI 1 红 / 本地 7 绿）；**根因未定位**，可疑面已收窄到 fallback 清理路径；初稿的「墙钟排序」机制已撤回 |
| V31-93 | [Composer 胶囊 remount 中途甩掉交互；重试掩盖已到极限，是门抖动主源](V31-93-composer-lens-remount-detaches-interaction.md) | **部分修复，不得关票**（2026-08-15）— 「面板开了随后被销毁」那一支已解（状态提到 `ComposerHome`），但**残余路径仍在**：点击在到达 handler 之前就丢失，提升状态救不了它。唯一的解是让重挂不发生＝**V31-96**（据此由「可选清理」升为**必需**）。验收要求的连续 ≥3 轮绿**未达成** |
| V31-94 | [发布证据引用被接成仓库级静态变量，fail-closed 因此形同虚设](V31-94-release-evidence-refs-must-be-per-run.md) | open（2026-08-15）— 接线缺陷已定位（读源码得出）；两个修法方向待拍板，实施前须在票下定稿 |
| V31-95 | [w12 在 `goto` 前注册 `waitForResponse`，导航丢弃响应体导致间歇红](V31-95-w12-response-body-evicted-by-navigation.md) | 已合入待观察（2026-08-16，`d95aef263` 经 PR #14）— 谓词歧义已消除（改为直接问 Core，不再读拦截到的响应体）；**但回收机制始终没有定位，是被绕过而非查明**；`required` 绿 1/3 轮 |
| V31-96 | [`WorkbenchCreateLayout` 换根元素类型，`session.phase` 每次跨界就重挂整个 Composer](V31-96-workbench-create-layout-reparents-composer.md) | 已合入待验（2026-08-16，`0c54507be` 经 PR #10）— `required` 同 SHA 绿；`assertThreeModalDiscovery` 已 4 轮 `--retries=0` 绿；**~1000px 与 ~390px 真机观感仍欠**，**未关票** |
| V31-97 | [三处把 phase 写回 idle 类状态，外壳宽度从 1240 塌到 800（其一是竞态）](V31-97-first-keystroke-after-delivery-narrows-the-shell.md) | open（2026-08-16）— 三个塌宽点位机制链均已逐段引证核实（含一条竞态）；视觉损害程度未核（须真机），修法未定 |
| V31-98 | [unified-media-stage-ports 把真实耗时钉死在 25ms，负载下必红](V31-98-wallclock-exact-assertion-flakes-under-load.md) | 已修复待验（2026-08-16）— 机制读源码得出，负载下 6/8 复现，改后同负载 8/8 绿，变异证非恒真；`required` 同 SHA 绿未跑 |
| V31-99 | [双栏拖拽地板写成了 40px/24px 而非 40%/24%，形同虚设](V31-99-resizable-numeric-sizes-are-pixels-not-percent.md) | 已修复待验（2026-08-16）— 四处改为显式 `%`；两个待答问题都已查实（数字无规格出处；**从未部署过，不存在已习惯窄栏的商家**），故抬地板不构成对现有用户的行为回退；真机拖拽极限仍欠 |
| V31-100 | [root-quality 的 interaction 套件有并行争用型抖动：三轮三条不同的红，全部单跑绿](V31-100-interaction-suite-parallel-contention-flakes.md) | open（2026-08-16）— 已用 main 对照实证：不是任何一条 spec 的问题，是全量并行下的争用；单条修法一律无效，未定修法 |
| V31-101 | [选区改写测试用「固定一次 flush」等一个真异步 Web Crypto，负载下必红](V31-101-selection-rewrite-fixed-flush-vs-web-crypto.md) | 已合入待观察（2026-08-16，`d95aef263` 经 PR #14）— `required` 同 SHA 绿且 `root-quality` 专项绿；CI 史实证该条是近 18 轮 `root-quality` 三次红的成因；后续观察 1/3 轮 |
| V31-102 | [`run-service` 的 fail-closed 断言把 5s 当作上界，负载下会红](V31-102-run-service-fail-closed-waitfor-too-tight.md) | open（2026-08-16）— 已在 main 上实证一次（`f735731aa`，required 因此红）；机制读源码得出，**未修** |

**首访旅程实测轮（2026-08-13）新开三张**：V31-73–V31-75 出自主控当日 dashboard 首访旅程浏览器亲验（全新注册零素材账号＋全量 API 抓包，锚树 `main@39ca4b39`，本地 dev 栈 web:3000 / core:4100 / meiye@54329）。V31-73 是 V31-54 边界节点明留产品决策（`case_image` 是否该挡新用户）的落地面——该缺口在 e2e 全绿下不可见，正因 V31-54 用 `seedComposerInlineAuthorize` 种子绕过了提交门；V31-74 的行为权威是 V31-28「08-12 深夜免费 copy 腿裁决」（分权定性），只动文案不动行为；V31-75 打包九项展示层/状态投影收尾。

**能力盘点第二轮（2026-08-13 晚）新开三张**：V31-83（P0 跨账号 sessionStorage 泄漏）、V31-84（P0 五步录入双断点→档案/素材/配方链式死锁）、V31-85（视频 fallback 假出口）；报告=`docs/reviews/capability-baseline-audit-r2-2026-08-13.md`；V31-82 半径补记（悬死锁死 composer）。

**能力盘点第一轮（2026-08-13）新开五张**：V31-78–V31-82 出自能力基线盘点（`docs/reviews/capability-baseline-audit-2026-08-13.md`，账本=`docs/ops/capability-ledger-2026-08-13.md`）：V31-78=P0 注册 provisioning 砖号（module command 悬死→全请求 500 热循环）；V31-79=dev 环境单一真相（launchd 假 Core 占 4100 指向 54330 库多日、dev 档 Core 起不来、平台默认模型缺供给）；V31-80=展示层内部指令/裸 ID 泄漏二波；V31-81=composer steering「No admitted execution plan」断裂；V31-82=图文单悬死 running＋20 分无出口。同轮撤案：「积分 100→0 泄漏」＝假 Core 读错库（V31-73 票面已更正）。

**批次 retro 改约轮（2026-08-13）新开一张**：V31-77 出自 `docs/reviews/v31-batch-retrospective-2026-08-13.md`（用户拍板 R1–R4）：Day-0 零素材首访旅程升格 release gate＋种子掩码纪律可执行化。R3 冻结令与清红队列见 CURRENT §3a——**Day-0 旅程门绿之前冻结新功能票的开票与派工**。同轮把 89 张票的 `Evidence SHA` 字段修回治理合同（裸 40 位全 SHA，注释移旁注行），此前索引门在 HEAD 上即红（仪器失修活例，正是 retro 根因 3）。

**Status 形式（FIX-P0-00）**：`V31-43` / `V31-44` 仍为列表式 `- Status:`，其余为粗体式 `**Status**:`。校验脚本两种都认；索引 Status 列只写票面原文（不再附加「列表式」旁注）。两票头部整体是另一套风格（`- Owner:` / `- Blocked-by:`），是否统一属票面属主决定。

**Wave-4（2026-08-10）新开六张**：V31-50–V31-55 全部出自 W4-D journeys lane 的三轮浏览器验收，证据与锚点署树 `2da11d5ab`（W4-D round3 的运行树）。其中 V31-55 是**症状票**（根因归 W4-B 4D），V31-49 含 62 个「不在任何必跑门内」spec 的 audit 项。

**视频域纠偏轮（2026-08-11）新开三张**：V31-60/V31-61/V31-62 出自当日两项用户拍板（V31-37 A 路：字幕/封面无效不交付；V31-35 废止：分镜不进 Plan、与计费无关）后的主控复核——契约死字段、model-supply 字幕残链（含 `index.ts:5764` 时长推导隐性依赖，删前必须先斩）、V31-15 AC2/3/4 零浏览器证据。锚点统一署树 `main@0af4beb7`。

**Wave-4 终审 v2（2026-08-10）追加三张**：V31-56 是 W4-B 已开的 Living Plan 独立卡死票；V31-57 承接 interrupt expiry fixture 无法推进时钟；V31-58 起于素材撤权旅程对 `composer-terminal-outcome` 的表象红，后经 `e183a97dc`（merge `67ea5e5e7`）证实为 spec 断错 UI 类型：生产已正确渲染 failure report，故按 test-contract mismatch 收口并回归 V31-14 evidence debt，不立 terminal 生产缺陷。
