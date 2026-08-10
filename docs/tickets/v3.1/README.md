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

## 后续票（V31-27 起，按开票时间顺延，**不在上面的依赖图内**）

> 上面的依赖图与批次表是**开票时（2026-08-08）26 张票的排期**，后续票是各波复核／整改／浏览器验收陆续开出的，**没有统一批次号**，依赖以各自票面的 `Blocked by` 为准。下表由票面自动抽取（标题＋Status 原文），共 **29** 张（V31-27–V31-55）。

| 票 | 标题 | Status（票面原文） |
|---|---|---|
| V31-27 | [Mid-run Steering 前台旅程（§37.4-G 缺口整改）](V31-27-steering-frontend-journey.md) | done (merged aaad2a0f1, 2026-08-09) |
| V31-28 | [Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）](V31-28-composer-plan-surface-integration.md) | done (merged 6bf659915, 2026-08-09) |
| V31-29 | [E2E 共享 fixture 诚实性（`ui-journey.ts` 三处假绿）](V31-29-e2e-fixture-truthfulness.md) | in-progress — 2026-08-09 由 L-CI 开票并实施；三处改动已落 `6f6379565`，assertion 级先红后绿实测完成（hermetic A/B `10/10`）。**AC6 未完成**：两个 required job 本机跑不起来（load average 74，Web webServer 连续两轮 120s 超时），需在健康宿主或 CI 上补。**不由 L-CI 关票。** |
| V31-30 | [P1 route mock 信封诚实性（`{ data }` 缺 `meta` 让覆盖缺口伪装成通过）](V31-30-p1-route-mock-envelope-truthfulness.md) | open — 2026-08-09 由 L-CI 开票，未开工 |
| V31-31 | [退役额度词汇的计费侧收口：billingNotice 无消费者孤儿 ＋ legacy video 退款标签](V31-31-retired-quota-vocabulary-billing-copy.md) | open |
| V31-32 | [Prompt-pin 静默替换类全量扫除（余 11 处）](V31-32-prompt-pin-silent-substitution-sweep.md) | open |
| V31-33 | [Harness start 恢复扫描无 tenant 作用域](V31-33-recovery-sweep-tenant-scoping.md) | open |
| V31-34 | [注入 receipt 面板的撤销态无服务端来源（刷新即忘）](V31-34-receipt-panel-server-revocation.md) | open |
| V31-35 | [Plan 里可读的分镜（§37.4-D 缺口，contracts→compiler→投影三段接缝）](V31-35-plan-storyboard-deliverable-seam.md) | open |
| V31-36 | [视频场景级部分失败通路（§37.4-D 缺口，Core 产品能力缺失）](V31-36-video-partial-failure-pathway.md) | open |
| V31-37 | [字幕/封面 assisted fallback：§37.4 承认 #264 退役，或等 V31-15 落 producer（决策票）](V31-37-video-subtitle-cover-fallback-decision.md) | open |
| V31-38 | [PlanCompiler 的 recipe / source / catalog / skill 端口换成真权威](V31-38-recipe-skill-authority-port.md) | open |
| V31-39 | [Composer 意图轮的剩余「无出口等待」族：decision 缺失与 systemOnlyBlock](V31-39-fixture-kernel-composer-decision.md) | open |
| V31-40 | [计划 revision 与 plan.created/plan.revised 语义事件的原子性（outbox / 修复缝）](V31-40-plan-revision-event-atomicity.md) | open |
| V31-41 | [prepare 失败无计数、无死信、钱无出口：规划侧终态与预留释放](V31-41-prepare-failure-dead-letter.md) | open |
| V31-42 | [shadow reader 的 threadId 槽位落 workspace id（经实测＝不可达分支，非隐患）](V31-42-shadow-reader-thread-id-slot.md) | open — 建议裁为「记录在案，随 V31-03 晋升决策一并处理」，不建议单独派工 |
| V31-43 | [issue 255 live collector 启动锁竞态（required 套件内的已知 flaky）](V31-43-issue255-collector-startup-lock-race.md) | —（票内无 Status 行） |
| V31-44 | [DBOS admin server 的角色策略（API 角色未关 3001）](V31-44-dbos-admin-server-role-policy.md) | —（票内无 Status 行） |
| V31-45 | [derived_revision 直写路径不报价不计费，与商家文案承诺矛盾](V31-45-derived-revision-billing-bypass.md) | open |
| V31-46 | [跨边界重投的裸 `Error` 会被 artifact emitter 当瞬时失败吞掉（＋发散重试卡死形态无测试）](V31-46-semantic-event-boundary-error-typing.md) | open |
| V31-47 | [跨载体交付真接线（一 Make 一载体），并拆除 freeze 处的 fail-closed 门](V31-47-cross-carrier-execution-wiring.md) | ready-for-agent |
| V31-48 | [dbos-registration.smoke 手写 fixture 毒化 operations migrate，级联假红](V31-48-smoke-fixture-poisons-operations-migrate.md) | open |
| V31-49 | [V3.1 浏览器验收门三缺口：spec 任务书 ＋ B2 重叠度裁决](V31-49-browser-acceptance-three-missing-journeys.md) | open |
| V31-50 | [Web SSR 拿不到 PG 连接时未接管的 socket error 杀掉整个进程](V31-50-ssr-unhandled-socket-error-kills-process.md) | open |
| V31-51 | [day0 旅程「商家确实没有门店」的缺席编码漂移（`null` vs `undefined`）](V31-51-day0-initial-store-absent-encoding.md) | open |
| V31-52 | [一键授权后「已保存到素材库」确认文案 60s 不出现（共享 fixture 上游断言）](V31-52-inline-authorize-saved-copy-never-appears.md) | open |
| V31-53 | [goal-proactive 旅程用浏览器注入 gate config，服务端 `.strict()` 拒绝](V31-53-goal-proactive-client-injected-gate-config.md) | open |
| V31-54 | [K 自报旅程被 `case_image` source slot 挡在门口，`5ed00f453` 的浏览器验证腿至今未跑过](V31-54-k-journey-case-image-slot-fixture-gap.md) | open |
| V31-55 | [admission 变体②：context 围栏拒绝之后，商家收到的是「幂等冲突」](V31-55-admission-variant2-context-fence-then-idempotency-conflict.md) | open（症状票，等 4D 根因结论回填） |

**两处票面卫生问题（本轮发现，只报不改）**：`V31-43` 与 `V31-44` **票内没有 `**Status**` 行**，上表对它们只能标「票内无 Status 行」。其余票均有。补 Status 属票面属主，未擅自代填。

**Wave-4（2026-08-10）新开六张**：V31-50–V31-55 全部出自 W4-D journeys lane 的三轮浏览器验收，证据与锚点署树 `2da11d5ab`（W4-D round3 的运行树）。其中 V31-55 是**症状票**（根因归 W4-B 4D），V31-49 含 62 个「不在任何必跑门内」spec 的 audit 项。
