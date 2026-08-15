# Lane E — Capability Ledger Regrade

- HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（`git refs/heads/main`；tip 是文档归档，产品码等价于祖先 `d97c9b09`）
- Date: 2026-08-13
- Authority read: `docs/ops/capability-ledger-2026-08-13.md`、plan §37.4/§38/§43、`docs/ops/current-project-status.md`、`docs/tickets/v3.1/V31-76`…`V31-89`、`docs/reviews/capability-baseline-audit-2026-08-13.md` + r2、`docs/reviews/v31-77-gate-verdicts-2026-08-13.md`、`docs/reviews/v31-batch-retrospective-2026-08-13.md`
- Scope: 只读产品码；本文件是唯一写入。

## 1. Verdict

账本**半新鲜、半撒谎**。`§0` / `§6` 已回写到 `d97c9b09`（V31-77 门升格＋首次真跑），tip `0a693408` 只是把判决书搬进 `docs/reviews/`。`§1` 能力表**没有按同一夜的合入改写**：C1 仍写「修复中＋V31-77/78 差距」、C4/C9 仍把已 live-verify 的 V31-82 当不可用根因、C6 仍把 82 当钱无出口。CURRENT 更旧——Integration SHA 还停在 `39ca4b39`，完全不认识 08-13 深夜的 73–89 合入。

真实工作队列**不是**再开功能票。三根共因（档案 84/86、配方 slot 85/88、悬死 82）在代码里已经拔掉，但：

1. **没有任何能力在 `0a693408` 上有同 SHA 活体走查。** 最近的活体都署在 `97f534d0` / `7e6876ac` / `0ef197c2`；HEAD 之后没有产品 commit，也没有重走。
2. **「Day-0 门绿」被写成能力绿。** `v31-zero-source-image-text-first-visit` 只证明「不撞 400」，不证明 C1 字面「拿到第一条成品」。全门从未在 HEAD 上跑完：首次真跑 8 绿 / 5 红 / 28 未评，仪器死于 workerd；修完只复跑了 day-0＋84/86/87/88＝5 passed。V31-82 spec **故意留红**，必跑门按设计就是红。
3. **CURRENT §3a 冻结仍有效。** Day-0 单 spec 绿 ≠ 解冻。§3a 仍点名 V31-76、required CI、V31-29 AC6、V31-41 residual。解冻前只许仪器 / P0 死路 / 诚实性票。

所以队列权威应改成：先修仪器让门能跑完 → 把 C1 从「引导卡绿」改写成诚实态 → 清 C3/C16 展示泄漏与钱债 → 再按账本 §5 走 C4 全链。C8（V31-81）仍是真不可用，但排在 C4/C5/C7 之后，且属 `frozen-new-feature`。

四态计数（本 HEAD，Lane E）：**可用 1（C15）／降级 12／不可用 1（C8）／未走查 3（C12/C17＋C1 成品腿）**。相对账本 §1：C4/C9 从不可用上调为降级；C1 从「修复中」改为降级（引导腿）并单列「成品腿未走查」；其余大体同向，但差距票必须换新。

## 2. C1–C17 regrade table

| C# | Ledger state | This-HEAD state | Delta | Evidence | Remaining tickets | Gate spec honesty |
|---|---|---|---|---|---|---|
| C1 | 修复中（V31-76/77/78） | **degraded**（引导/双出口在；「第一条成品」未证） | §1 过期：77/78 已 implementation-complete；能力字面未兑现 | 门 spec `v31-zero-source-image-text-first-visit.spec.ts` 只断言引导卡＋0 次 `submissions` POST＋无「确认并开始」。`d97c9b09` 单跑 1 passed（49.3s）。活体 Day-0 到 **submit 202**（`97f534d0`），不是 delivered。V31-76 remix 仍 open | V31-76 open；V31-78 残项＝注册故障注入 e2e；V31-73 RVP；**NEW-E-003** 成品腿诚实化 | 门内首位，**无种子**，契约 `e2e-day0-seed-discipline.test.ts` 在。**过声称**：把「不撞死路」当成「拿到成品」 |
| C2 | 降级可用（fixture＋dev；live 未走） | **degraded** | 无实质变化 | `v31-day0-free-creation-journey.spec.ts` 在门内、禁种子、断言 202＋通用结果＋无虚构店名。全门未在 HEAD 重跑。live 生成链仍未走 | 余 required CI；不新开功能票 | 诚实（允许 D-043「确认并开始」事实封口，不是 execution confirm） |
| C3 | 降级可用（通到交付；出确认卡＝免确认违约＋V31-80） | **degraded** | 84/86/89 解开档案链；展示债仍在 | `v31-level1-copy-journey.spec.ts` 钉 `execution-confirmation-interaction-card` count 0、`makeReady=true`。盘点 R1 见到的「确认卡」更像 `确认本次创作` 事实门，与 §37.4-B「免确认直达」仍冲突。`make-snapshot-consume.ts:216` 仍把 `ExecutionPlanSnapshot` 写进 brief | V31-80 open；**NEW-E-004** 免确认裁决；V31-18 AC4 旁支 | 门内诚实测 execution confirm；**不测**商家是否仍先过事实卡 |
| C4 | 不可用（82 悬死＋钱无出口） | **degraded** | 上调。82 产品修复＋活体退款在 `97f534d0`；全链 §37.4-C 仍未同 SHA 绿 | sweeper `apps/core/src/p1/execution-spine/stalled-work-sweeper.ts` 默认 15min＋`WORK_EXECUTION_STALLED`。活体：0 job 停滞 → 超时 failed → 退款 100。Living Plan spec 用合法 `seedComposerInlineAuthorize`；V31-56 曾卡 `/revise` `/start`，票面 evidence-debt。浏览器 82 spec **KNOWN RED** | V31-82 保持 implementation-complete，**不要关**；**NEW-E-001** 仪器；V31-56/28/38/40/63 余 CI 或 open | 旅程 spec 在门内、种子合法。82 spec 在门内且故意红＝**门级假合同** |
| C5 | 降级可用（85 诚实引导；带素材未走） | **degraded** | 表已部分更新；带素材/部分失败仍未走 | `v31-85-*.spec.ts` 钉 `data-can-switch=false`、无假出口、0 POST。`findSlotFreeFallbackRecipe` 对 video 返回 null——代码与票一致。付费视频 spec 在门内但依赖 seed，从未在 HEAD 真跑 | V31-85 残＝带素材活体；V31-36/37 仍 open（AC 已勾、e2e 未跑）；V31-63 RVP | 85 spec 诚实。付费 spec 过长、seed 合法，**无 HEAD 绿证** |
| C6 | 降级可用（泄漏撤案；82 无出口＋credits 空表） | **degraded** | 82 钱出口已 live；其余钱债仍开 | 82 活体 usage=refunded。`context-fence` 首次门跑被 workerd 打断。V31-41 partial、V31-45/59/31 open、V31-55 partially-fixed。credits 空表无兜底未见修复 commit | 上列全部＋V31-82 仪器 | context-fence 在门内；**未完成评价**。82 退款无浏览器绿 |
| C7 | 降级可用（84/87/88 上传授权挂源已修；撤权未走） | **degraded** | 表对；撤权仍未走 | 88 活体到 202（`97f534d0`）。87 仅 unit/PG，活体重传未复走。`v31-rights-revocation-journey.spec.ts` 在门内、用 seed，HEAD 未跑 | 撤权走查；V31-58 evidence-debt；V31-87 活体补证 | 撤权 spec 在门、种子合法、**无 HEAD 走查**。88 spec 在门且 r5 绿（`d97c9b09` 轮） |
| C8 | 不可用（81 英文裸错） | **unavailable** | 无变化 | `apps/core/src/assembly/core-assembly.ts:860-863` 仍抛 `No admitted execution plan exists for task ${taskId}`。V31-81 Status=open、not-started。V31-27 AC1 仍 evidence-debt | V31-81；V31-27 勿关 | 门内 spec 用 seed；前置常红，**测不到** steering 本体 |
| C9 | 悬死分支不可用（82）；健康路径未走 | **degraded** | 上调。悬死有界终态＋composer 解锁已 live | `reconcileRestoredSessionPhase` 在 82 收口；健康 interrupt spec 在门内未走。fixture 档无法造悬死（82 票/77 判决书） | NEW-E-001；健康路径走查（V31-57 时钟债） | interrupt spec 在门。82 spec **故意红** |
| C10 | 降级可用（83 换号零残留；余 82 绑架） | **degraded** | 82 绑架已解；83 spec 比活体弱 | 83 活体换号（`0ef197c2`）。e2e **plant** sessionStorage，不是真跑 A 的 work；`signOutViaProduct` 有手工清 storage 兜底，能掩产品登出漏洞 | V31-83 勾 AC / 去掉 plant 兜底；thread spec 未在 HEAD 跑 | 83 两条在首次门跑绿。**plant ≠ 旅程** |
| C11 | 降级可用（空态在；注入/撤销未走；AC4） | **degraded** | 无变化 | `v31-memory-injection-b2-journey.spec.ts` 在门内；V31-18 AC4 仍空。R2 只看到经验页空态 | V31-18 AC4；V31-34 evidence-debt | 在门；风格约束断言已删（诚实）。**HEAD 未跑** |
| C12 | 未走查 | **unwalked** | 无变化 | 入口 UI 在（R1）。`v31-publish-handoff-selfreport.spec.ts` 在门内、用 seed、完整次日追问未活体 | 走查本身；不新开功能 | 在门；条件空转史已改，**无 HEAD 绿证** |
| C13 | 降级可用（无独立面；evidence 建议被 84 挡） | **degraded** | 84 已通，evidence 建议仍未走 | spec 断言 `/dashboard/goals` 非 200。R2 idle 空态正确 | 走查 evidence 门控建议 | 在门；设计诚实（无独立面） |
| C14 | 降级可用（台在；未动生产动作） | **degraded** | 无变化 | `/admin/ops-console` R2 渲染。spec 在门内未在 HEAD 执行生产动作 | 余 CI；不要在冻结期演生产 canary | 在门；有 `isVisible` 软分支 |
| C15 | 可用 | **available** | 维持 | R2 全导航。V31-71 未复现不猜修；V31-44 仍 open（3001 角色） | V31-71 等 CI；V31-44 hygiene | admin 系列不在 v31 字母门；CI-only 告警一条 |
| C16 | 降级可用（工作区可编；标题=内部指令→80） | **degraded** | 无变化 | artifact spec 首次门跑 AC1–4 全绿（仪器死前）。泄漏源仍在 `make-snapshot-consume.ts:216` | V31-80 | 在门、无 skip；**fixture 回声会把内部指令做成标题**——spec 未挡 |
| C17 | 未走查 | **unwalked** | 无变化 | `v31-partial-resume-assisted-journey.spec.ts` 在门内、用 seed。被 C4/C5 深度挡住 | 先有一次部分失败交付，再走 | 在门；**零走查** |

## 3. Ticket truth table (V31-76..89 + still-blocking older)

| Ticket | Ticket Status | Code support | Test/walk support | Keep / close / reopen | Why |
|---|---|---|---|---|---|
| V31-76 | open / not-started | remix 写 `sessionStorage`（`writeCreationDraftIntent` 会覆盖）；composer 二次 remix 是否重读未修 | 红 1 两轮同签名（`2bfa196e`）；红 2 continue-item 组件有 `data-testid`，更像编舞/空架 | **keep** | CURRENT §3a 解冻项。不是功能扩张 |
| V31-77 | implementation-complete | fail-fast 独立先跑＋判决书＋种子静态契约均在 `run-v31-browser-acceptance.sh` / `e2e-day0-seed-discipline.test.ts` / `quality-gates.test.mjs` | day-0 1/1＋变异反证在 `d97c9b09`。**全门从未绿** | **keep**（仪器完成，release 未核销） | 不要把单 spec 绿写成 release-ready |
| V31-78 | implementation-complete / RVP | 终态化、降级转发（trial completed 即放行）、退避 20 次、banner 在 | 活库自愈在 `737d4603`。注册故障注入 e2e **未做** | **keep** | AC 第 3 条空。e2e 栈带平台默认模型，回归不可见 |
| V31-79 | implementation-complete / RVP | boot 门、platform default seed、端口/profile 断言、`dev:smoke` | smoke 两跑绿。**plist 未删**；workerd 孤儿未进探测面 | **keep** | host 残项能让假 Core 复活 |
| V31-80 | open / not-started | 泄漏源仍在：`make-snapshot-consume.ts:216` 把 `ExecutionPlanSnapshot` 写进 brief | 盘点四号取证；无修复测 | **keep** | 诚实性，不是新功能 |
| V31-81 | open / not-started | 英文裸错字符串仍在 `core-assembly.ts:862` | 盘点四号实测；无修 | **keep**；派工＝`frozen-new-feature` | 依赖 C4 有健康 running work |
| V31-82 | implementation-complete / live-verified @ `97f534d0` | sweeper＋退款＋失败投影＋session 和解在 HEAD | 活体有。浏览器 spec **KNOWN RED**（fixture 会跑完，加重试＝假绿） | **keep**；**不要关** | 缺仪器票。关票＝用旧 SHA 活体冒充门绿 |
| V31-83 | implementation-complete / live-verified @ `0ef197c2` | 键含 workspaceId；foreign_owner 弃读 | 活体换号。e2e 是 plant＋登出兜底清键。**票面 4 条 AC 全未勾** | **keep**；补勾/补真跑 | 代码在，合同未收口 |
| V31-84 | implementation-complete / live-verified | 正则提取＋finalize toast；后续被 86 档案卡取代 | 全确认路径活体；e2e 已改真实上传/挑选，无 seed | **keep**（RVP） | 链式死锁已解 |
| V31-85 | implementation-complete | video 无 slot-free 配方；引导卡 `canSwitch=false` | unit/interaction＋e2e r5 相关绿。**视频付费活体未走** | **keep** | 「假出口」修了；C5 能力未完成 |
| V31-86 | implementation-complete / live-verified @ `97f534d0` | 门 2 有界豁免＋档案卡一击；`d97c9b09` 另修 store facts `at` 钉死 | 活体在 86 合入树；`at` 钉死修在更晚 SHA，**活体早于该修** | **keep** | Phase 2 另立 89，勿重开 86 |
| V31-87 | implementation-complete | 键＝内容 hash＋事实指纹；同 objectKey 走元数据；撤权传播补进 add_asset | unit/PG/web。**活体重传未复走**（88 替代了常规路径） | **keep** | 宣称 complete 但无同路径活体 |
| V31-88 | implementation-complete / live-verified @ `97f534d0` | `composer-image-pick-from-library` 在 | 活体 202；e2e 在 r5 绿 | **keep**（RVP） | 最接近「有走查」的素材腿 |
| V31-89 | implementation-complete / live-verified @ `7e6876ac` | `extract_store_sentence`＋canned；只填空 | fixture 口语活体。**production 模型质量未测** | **keep** | 智能一半只在 fixture 档成立 |
| V31-27 | merged-with-evidence-debt | 前台面板在 | AC1 浏览器未走到被测行为 | **keep**；勿当 done | 与 81 同景 |
| V31-28 | implementation-complete / RVP | 七腿进候选 | required CI 未在 HEAD | **keep** | CURRENT 仍指 `39ca4b39` |
| V31-29 | in-progress | 静态契约在 | **AC6 两 required job 从未实跑** | **keep** | §3a 解冻项 |
| V31-36 | open（AC 已勾） | 场景级通路声称已落 | e2e 真跑「归合并轮」＝没跑 | **keep** | 勾 AC 不等于走查 |
| V31-37 | open（决策已落） | 面板缺席是正确行为 | 旅程断言未在 HEAD 跑 | **keep** 或收成决策关闭＋残留跟踪 | 不要再做字幕功能 |
| V31-38 | open | 未做 | — | **frozen-new-feature** | 编译器端口，非 P0 |
| V31-40 | open | 未做 | — | **frozen-new-feature** | 计划事件原子性 |
| V31-41 | partial | 终态/退款部分在 | D-150 消费者证明仍开 | **keep** | §3a 项 4 |
| V31-45 | open | `derived_revision` 直写仍可不计费 | 无产品证 | **keep** | 钱门 §38①③ |
| V31-49 | open | **三条「缺失 spec」现在都在门清单里** | 票面过期 | **close or rewrite** | 再按「缺 spec」派工会空转 |
| V31-50 | open | 仅有 `withPostgresRequestBoundary` 包 query reject | **postgres.js socket `'error'` 仍无监听** | **keep** | 账本把它当平台；它能杀掉所有走查 |
| V31-55 | partially-fixed | 臂已收窄 | 文案/变异/全绿未勾 | **keep** | 映射债 |
| V31-56 | evidence-debt | 声称 done | `/revise` `/start` 卡死史；无 HEAD 复跑 | **keep** | C4 免费调整腿 |
| V31-59 | open | ordinary settlement 仍可能用 workflowId | 无产品证 | **keep** | 钱身份 |
| V31-63 | implementation-complete / RVP | successor 事务重建在候选 | 绿证署 `2f2960e6`，非 HEAD | **keep** | 勿拼 SHA |
| V31-64/70 | implementation-complete / RVP | 仪器 fail-closed 在 | 08-13 门仍被 workerd 打死 28 条 | **keep**＋**NEW-E-002** | 检测≠复活 |
| V31-71 | open | 不猜修 | 本地 5/5 无告警 | **keep** | 等 CI |
| V31-73 | implementation-complete / RVP | 引导卡在 | 零素材 e2e 1/1；不证明成品 | **keep** | 与 C1 过声称绑定 |
| V31-74/75 | implementation-complete / RVP | 第一波展示在 | 75 的 dev 复核跑过假 Core；80 是二波 | **keep** | 不要重开 75，走 80 |

## 4. Findings

### FIND-E-001 — Severity: P0

- Capability: 账本本身 / 全局队列
- Ledger lie or gap: `§1` 表与 `§0`/`§6` 互相矛盾。表仍把 V31-77/78/82 当 open 差距，叙事已称三根共因拔除、Day-0 全链 202。CURRENT 还停在 `39ca4b39`。
- Evidence: 账本 §1 行 C1/C4/C6/C9 vs §0 段「三 lane 共因根收官」；`.git/logs/refs/heads/main` 显示 `39ca4b39` 之后还有 73–89–77 一整串；HEAD=`0a693408`。
- Merchant impact: 派工会打已修的根，或把「202」当成「成品」。
- Fix contract: 用本文 §5 替换账本 §1；CURRENT 重钉 Integration SHA＝`0a693408`，并写明 verification ≠ release。
- Files: `docs/ops/capability-ledger-2026-08-13.md`；`docs/ops/current-project-status.md`
- Tests: 无。文档权威。
- Freeze class: freeze-allowed
- Depends on: 主控回写，非开发 lane

### FIND-E-002 — Severity: P0

- Capability: C1
- Ledger lie or gap: C1 定义＝「零素材首访拿到第一条成品」。门绿只证明引导卡。
- Evidence: `v31-zero-source-image-text-first-visit.spec.ts:67-69` `submissionStatuses` 必须 `[]`；`:64-66` 无「确认并开始」。V31-73 AC 也是「走不到 400」。活体最远是 88 路径 submit **202**，且那条已经不是零素材。
- Merchant impact: 新商家选默认图文仍拿不到成品；只是不再被「再发一次」骗。换写法出口存在但从未被门走到交付。
- Fix contract: 要么加一条无种子旅程：引导 → 换无槽配方/自由创作 → **delivered**；要么改 C1 字面为「首访不撞死路」，成品归 C2。禁止再用 day-0 1/1 宣称 C1 可用。
- Files: `mkfast-template-main/tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts`；`scripts/ci/run-v31-browser-acceptance.sh`
- Tests: 新断言必须看到可发布成品或明确失败投影；0 次 submissions 只能留在「引导」子用例。
- Freeze class: freeze-allowed（诚实性 / Day-0 门牙）
- Depends on: V31-77 已落；不依赖 81

### FIND-E-003 — Severity: P0

- Capability: C4 / C6 / C9 仪器
- Ledger lie or gap: 把 V31-82 标 complete，同时把它的浏览器 spec 放进 required 门并故意留红。门永远不能绿，除非有人用 `alreadyTerminal` 造假绿。
- Evidence: spec 注释 L88–98；`docs/reviews/v31-77-gate-verdicts-2026-08-13.md` r4 快照：run 正常交付 r1＋zip，积分停 85。
- Merchant impact: 产品容错可能真的在；release 证据链被一条不可绿的 required spec 锁死。
- Fix contract: 新仪器票 NEW-E-001——答方向**前**从服务端取 `workId`，并把 run 钉在「running + 0 generation job」。在那之前 82 spec 应移出门或标 `not_evaluated`，不得当产品红。
- Files: `mkfast-template-main/tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts`；`apps/core/src/server.ts` e2e-stalled-work-expiry-fixture
- Tests: 先红（无停滞时 expiry 必须失败）再绿（人为无 job 后才退款解锁）
- Freeze class: freeze-allowed
- Depends on: V31-82 产品码（已在）

### FIND-E-004 — Severity: P0

- Capability: 全部走查 / 仪器
- Ledger lie or gap: 账本 §6 记下 workerd 一次死 28 条，未升格为排队项。V31-64/70 只做「检测到就停」，fixture 门没有自动拉起新 workerd。
- Evidence: 判决书 12:23:13 `vite-workerd-disconnected`；三服务此前健康。V31-79 R2：ppid=1 孤儿 workerd。V31-50 仍 open：无 postgres.js `socket.on('error')`。
- Merchant impact: 走查环境随机整死；假红成本继续吃掉功能时间（retro 根因 3）。
- Fix contract: NEW-E-002＝fixture 门 workerd 断连后有界重启或标 not_evaluated 并续跑；V31-79 把 workerd 纳入 `pnpm dev` 卫生探测；V31-50 按票面给 socket `'error'` 挂请求级失败。
- Files: `scripts/ci/run-v31-browser-acceptance.sh`；`mkfast-template-main/scripts/e2e/*liveness*`；`mkfast-template-main/src/db/postgres-connection-safety.ts`；`scripts/dev/start-stack.mjs`
- Tests: 人为杀 workerd → 门不得把未跑写成产品红；socket error 子进程测不得让 process exit。
- Freeze class: freeze-allowed
- Depends on: V31-64/70 形制

### FIND-E-005 — Severity: P0

- Capability: C8
- Ledger lie or gap: 无。表写不可用是对的。
- Evidence: `core-assembly.ts:862` 原文仍在。V31-81 not-started。composer 提交链 task 键 vs admission `getByWorkflowId(taskId)` 未定性。
- Merchant impact: 运行中改要求＝英文裸错＋内部 task id。§37.4-G / §43.6 不可达。
- Fix contract: 先答键空间 vs 未 admission；商家面中文、无内部 id；再做改一页其余不动。
- Files: `apps/core/src/assembly/core-assembly.ts`；steering-composer-panel
- Tests: 票面已写 e2e＋失败文案 interaction
- Freeze class: **frozen-new-feature**（冻结期只许把裸错收成中文，根因修复等 C4 健康 running）
- Depends on: C4 能稳定 running（82 仪器有助于复现）

### FIND-E-006 — Severity: P1

- Capability: C3 / C16
- Ledger lie or gap: 80 仍 open，正确。危险是有人把 75 complete 当成展示层已清。
- Evidence: `apps/core/src/p1/harness/make-snapshot-consume.ts:213-229` 仍拼接 `不得偏离 ExecutionPlanSnapshot` 与 `snapshotHash=`。fixture echo 会把它送进标题/时间线。
- Merchant impact: 商家看见内部术语；§43.13（不显示原始 CoT/内部指令）违约。
- Fix contract: V31-80 七项逐项。叙述/标题改走商家字段，不是改 fixture 藏脏。
- Files: `make-snapshot-consume.ts`；composer 时间线/工作区标题
- Tests: 静态扫描＋多 Work 叙述唯一
- Freeze class: freeze-allowed
- Depends on: 无

### FIND-E-007 — Severity: P1

- Capability: C1
- Ledger lie or gap: V31-76 仍是真差距。账本却把 77/78 并列成 C1 阻塞，稀释焦点。
- Evidence: `uiux-creation-loop.spec.ts:205` 期望二次 remix 变成生发草稿；产品侧 `prefill`→`writeCreationDraftIntent` 会 `setItem`，更像 **composer 已挂载后不重读 key**，或 `sampleStores[2]` 不是生发。continue-item 在 `dashboard-continue-section.tsx:208` 存在。
- Merchant impact: 切行业复用仍可能拿到旧草稿（若红 1 是产品）。红 2 更像测试合同。
- Fix contract: 按票面先判 spec 假设再修；`uiux-creation-loop` 整档绿。
- Files: `example-store-preview.tsx`；`creation-entry-model.ts`；composer draft restore
- Tests: 已有 e2e；先红后绿
- Freeze class: freeze-allowed（§3a 明文）
- Depends on: 无

### FIND-E-008 — Severity: P1

- Capability: C6
- Ledger lie or gap: 「82 钱无出口」过期；「credits 空表／41／45／59」仍真。
- Evidence: 82 活体 refunded。V31-45 `derived_revision` 直写优先于计费消费者。V31-59 ordinary settlement 在缺 `sourceTaskId` 时用 `workflowId`。V31-41 D-150 仍开。
- Merchant impact: 健康路径 pill 对；旁路/失败/派生 revision 仍可能账不对。
- Fix contract: 钱债按 §38 硬门①③排，不做新套餐功能。
- Files: `steering-service.ts` derived_revision；`harnessBillingSettlementInput`；credits 页空态
- Tests: 账本＋UI 双钉
- Freeze class: freeze-allowed
- Depends on: 82 已落

### FIND-E-009 — Severity: P1

- Capability: C10 / 隐私
- Ledger lie or gap: 83 complete 与未勾 AC、plant spec 并存。
- Evidence: `v31-83-composer-session-cross-account.spec.ts` `plantComposerHandle`；`signOutViaProduct` L128–146 手工删键。票面 AC 全是 `[ ]`。
- Merchant impact: 活体可能真的干净；回归网能被兜底清键喂绿。
- Fix contract: 去掉测试里的手工清键；真创建 A 的 running handle；勾 AC。
- Files: 该 spec；`composer-session.ts` key 函数
- Tests: 同文件改诚实
- Freeze class: freeze-allowed
- Depends on: 无

### FIND-E-010 — Severity: P1

- Capability: C2/C3 规格诚实
- Ledger lie or gap: 「出了确认卡＝免确认违约」未裁决。Level-1 spec 允许 `确认并开始` 作为 D-043 事实封口，同时禁 execution confirm。
- Evidence: `v31-level1-copy-journey.spec.ts:237+` / `:364-369`；`v31-day0-free-creation-journey.spec.ts` `settleFreeSubmission`。
- Merchant impact: 简单任务仍可能多一击。§38 硬门⑤ / §43.5。
- Fix contract: NEW-E-004 主控裁 A（事实卡不算执行确认，改规格）或 B（纯 copy 连事实卡都禁）。禁止各票各说。
- Files: plan §37.4-B；两条 copy spec
- Tests: 按裁决改断言
- Freeze class: freeze-allowed
- Depends on: 主控裁决

### FIND-E-011 — Severity: P2

- Capability: C15 / 平台 parked
- Ledger lie or gap: parked 清单把 V31-50 当「无商家路径」。错。
- Evidence: V31-50 票面：未监听的 socket error 杀 SSR。代码只有 query boundary。V31-44 API 角色仍开 3001。V31-35/42 parked 正确。
- Merchant impact: 连接抖动＝整站死，所有能力一起不可走。
- Fix contract: V31-50 从「顺手收」改列为仪器 P0。32/33/46 维持 parked。
- Files: postgres.js 装配
- Tests: 已有 child-process 测，补真正 `'error'` emit
- Freeze class: freeze-allowed
- Depends on: 无

### FIND-E-012 — Severity: P2

- Capability: 票面卫生
- Ledger lie or gap: V31-49 仍说三条 spec 缺失；门清单 24 条里它们都在。V31-36 AC 全勾但 Status=open。
- Evidence: `run-v31-browser-acceptance.sh:28-53`；V31-49 票面还写 16 条/3 缺。
- Merchant impact: 无直接；会空耗 lane。
- Fix contract: 49 改写或关；36 在 e2e 真跑前保持 open。
- Files: 票面
- Tests: 无
- Freeze class: freeze-allowed
- Depends on: 无

## 5. Proposed ledger rewrite (text only)

> 以下只替换账本 §1 表。不要在本评审里改账本文件。

| # | 能力（商家可以…） | 规格锚 | 旅程 spec | 状态（HEAD `0a693408`） | 差距票（open/partial/red） |
|---|---|---|---|---|---|
| C1 | 零素材首访拿到第一条成品 | §37.4-A＋retro R1 | `v31-zero-source-image-text-first-visit`（引导腿）＋成品腿**缺失**；`uiux-creation-loop`；`dashboard-home-mount` | **降级可用**：引导/双出口/不扣分承诺在；默认图文仍不能交付；remix 红仍开。**不是可用** | V31-76；V31-78 残 e2e；NEW-E-003；V31-73 RVP |
| C2 | 免费自由创作 | §37.4-A | `v31-day0-free-creation-journey` | **降级可用**：fixture 合同完整；live 生成未走；全门未在 HEAD 跑完 | required CI |
| C3 | Level 1 纯 copy 免确认直达 | §37.4-B＋§43.5 | `v31-level1-copy-journey` | **降级可用**：execution confirm 合同在；事实卡是否违约未裁；V31-80 泄漏 | V31-80；NEW-E-004 |
| C4 | 定制图文全链 | §37.4-C | `v31-living-plan-journey`；82 spec（仪器红） | **降级可用**：admission 202＋悬死容错 live @ `97f534d0`（非 HEAD）；Living Plan 调整/逐页/交付未同 SHA 绿 | NEW-E-001；V31-56；V31-28/63 RVP；V31-38/40（冻结后） |
| C5 | 视频付费执行 | §37.4-D | `v31-video-paid-execution-journey`；`v31-85-*` | **降级可用**：零素材诚实引导；带素材/部分失败/中断未活体 | V31-85 残走查；V31-36/37 |
| C6 | 计费可信 | §37.4-B/E＋§38①③ | `v31-context-fence-journey`＋结算单测 | **降级可用**：健康 grant/usage 对；82 退款 live；旁路/空表/派生 revision 仍开 | V31-41；V31-45；V31-59；V31-55；V31-31 |
| C7 | 素材授权与撤权 | §37.4-F | `v31-rights-revocation-journey`；`v31-88-*` | **降级可用**：上传→授权→挂源 live；撤权未走；87 活体未复 | 撤权走查；V31-87 补证；V31-58 |
| C8 | 中途 steering | §37.4-G | `v31-mid-run-steering-journey` | **不可用** | V31-81；V31-27 |
| C9 | 中断/恢复 | §37.4-H＋§43.3/4 | `v31-interrupt-resume-journey` | **降级可用**：悬死有界终态 live；健康 interrupt 未走 | NEW-E-001；V31-57 |
| C10 | Thread 连续 | §37.4-I | `v31-thread-root-workbench`；`v31-83-*` | **降级可用**：换号活体在；spec 偏 plant；全链未 HEAD 跑 | V31-83 收口 |
| C11 | 记忆注入透明 | §37.4-B2 | `v31-memory-injection-b2-journey` | **降级可用** | V31-18 AC4；V31-34 |
| C12 | 发布交接与自报 | §37.4-K | `v31-publish-handoff-selfreport` | **未走查** | 走查（冻结期只记账） |
| C13 | 目标与主动建议 | §37.4 goal | `v31-goal-proactive-idle` | **降级可用** | evidence 建议走查 |
| C14 | 运营控制面 | §37.4-J | `v31-ops-console-release-journey` | **降级可用** | 勿在冻结期做生产动作 |
| C15 | Admin 后台 | admin 波 | admin 系列 | **可用** | V31-71；V31-44 |
| C16 | 成品原位生长 | §37.4 artifact | `v31-artifact-growth-journey` | **降级可用**（门跑过 4/4 @ `d97c9b09` 前半轮；标题泄漏） | V31-80 |
| C17 | 部分交付续跑 | V31-16 | `v31-partial-resume-assisted-journey` | **未走查** | 等 C4/C5 能造 partial |

**§2 仪器（重写排队，先于一切能力）**

1. NEW-E-002 workerd 有界复活 / 孤儿探测（V31-79 残）
2. V31-50 socket `'error'` 请求级失败
3. NEW-E-001 V31-82 浏览器可复现性
4. V31-77 已落；**全门同 SHA 绿尚未发生**
5. V31-29 AC6 两 required job 实跑
6. V31-64/70 连续 required CI
7. V31-30 mock 信封（仪器诚实）
8. 主控：plist 处置（V31-79 AC）

**§3 Parked（更新）**

- 维持：V31-35 废止；V31-42 不可达；V31-32/46/33 无商家路径。
- **移出 parked、升仪器**：V31-50。
- 不要让 parked 挡住商家：HARNESS_DBOS 未配时媒体任务在 dev 档走不完（82 票面）——这是环境合同，不是 parked 卫生。

**§4 盘点**：R1+R2 已完成。第三轮只在仪器稳之后补 C5 带素材、C7 撤权、C9 健康、C12、C17。冻结令继续。

**§5 收敛顺序（不变，加 P0 现实前缀）**

仪器 Wave → C1 诚实化（76＋成品腿）→ C2/C3（80＋免确认裁决）→ C6 钱债 → C4 全链 → C5 → C7 撤权 → C9/C10 → C12 → C8 → C11 → C13 → C14 → C17。C15/C16 只随 CI / 80。

## 6. Fix-agent execution queue

冻结提醒：CURRENT §3a 仍生效。`frozen-new-feature` 只许列，不许派，直到 Day-0 **全门**可评价且 V31-76 清、required CI 同 SHA 绿。

### Wave 0 — 仪器（全部 freeze-allowed）

1. **NEW-E-002** workerd 自动复活或 fail-closed 续跑。DoD：人为断 workerd 后剩余 spec＝`not_evaluated` 或复活后续跑；不得把 28 条写成产品红。Coupling：门脚本 + liveness，低。
2. **V31-50** socket `'error'`。DoD：子进程测 emit error → 进程存活、请求 5xx。Coupling：SSR/postgres.js，中。
3. **V31-79 残** plist 处置＋workerd 进 `pnpm dev` 探测。DoD：4100/3000/workerd 被外人占时明错；plist 去 KeepAlive。Coupling：host，低，需用户确认。
4. **NEW-E-001** 82 浏览器仪器。DoD：能造 running+0 job；expiry 后退款解锁；成功跑完不得绿。Coupling：e2e fixture + Core e2e 路由，中。
5. **V31-29 AC6** 两 required job 实跑。DoD：计数进票面，禁止静态绿冒充。Coupling：CI，低。
6. **主控 ops**：同 SHA `Core quality / required`＋完整 v31 门一轮（42+）。不是开发票。

### Wave 1 — C1（freeze-allowed）

7. **V31-76** remix＋continue-item。DoD：`uiux-creation-loop` 整档绿；`dashboard-home-mount` 整档绿；`:212` 回写 74。Coupling：dashboard draft，中。
8. **NEW-E-003** C1 成品腿或改字面。DoD：要么无种子走到 delivered，要么账本 C1 改成「不撞死路」并把成品并进 C2。Coupling：门合同，高（改能力定义需主控）。
9. **V31-78 残** 注册 provisioning 单步失败 e2e。DoD：失败不整站 500、command 终态、可见 banner。Coupling：auth/provision，中。

### Wave 2 — C2/C3（freeze-allowed）

10. **V31-80** 七项展示泄漏。DoD：时间线/标题/右栏无内部术语与裸 `work-`；方案卡三态按钮；多 Work 叙述唯一。Coupling：composer 展示，中。
11. **NEW-E-004** 免确认裁决落地。DoD：规格与两条 copy spec 同一句话。Coupling：规格，低。

### Wave 3 — C6 钱（freeze-allowed）

12. **V31-41** residual 消费者证明。DoD：submit 读到 prepare 死信；钱有出口。
13. **V31-45** derived_revision 必须走报价。DoD：无 quote 不得 completed。
14. **V31-59** ordinary settlement billing identity。DoD：缺 sourceTaskId 不得落到错误 usage 键。
15. **V31-31 / V31-55 残** 退役额度词＋围栏文案。DoD：商家面无「额度」；围栏失败不再显示幂等冲突。
16. credits 页空表兜底（可并 78/80，勿新功能）。

### Wave 4 — C4（多数仍冻结）

17. **V31-56 复跑**（freeze-allowed＝核销/复证，不猜修）。DoD：HEAD 上 living-plan 两 case 有判决。红再立项。
18. **V31-28/63 required CI**（freeze-allowed 核销）。
19. **V31-38 / V31-40**＝`frozen-new-feature`。

### Wave 5 — C5 / C7（走查优先）

20. C5 带素材付费视频活体＋V31-36 e2e 真跑。`frozen-new-feature` 除非只跑不改。
21. C7 撤权全链走查。修才开票。

### Wave 6 — C9/C10/C12 然后 C8

22. 健康 interrupt 走查。
23. V31-83 spec 去 plant。
24. C12 次日自报走查。
25. **V31-81**＝`frozen-new-feature`（允许先做中文错误映射作为诚实性小补丁）。

### 明确不要派

- 新功能：视频字幕/封面、Goal 管理面、生产 canary 实操、production LLM 调优（89 残）。
- 重开已 complete 且代码在的 84/86/88 根因。
- 用 `39ca4b39` 的绿证拼接 HEAD。

## 7. Open questions / unproven

1. **同 SHA 走查**：HEAD `0a693408` 是文档 tip。所有「活体证毕」都是祖先树。没有人在本 SHA 重走注册→成品。
2. **C1 成品是否其实能走通**：换无槽图文配方后，fixture 档会不会直接 delivered？零测试覆盖。
3. **remix 红 1**：产品缺陷 vs `sampleStores[2]` 过期假设，票面未判，本 lane 未跑浏览器。
4. **C3 确认卡**：盘点看到的是 execution confirm 还是 D-043 事实卡？spec 认为前者 count 0。需要一次带截图的复走。
5. **dev 档媒体**：`HARNESS_DBOS_SYSTEM_DATABASE_URL` 未配时 worker 打印 DBOS signaling disabled——82 说 dev 媒体本就走不完。单一真相栈用 e2e+fixture 掩盖了这件事。live/direct 档 C4/C5 仍可能假死。
6. **全门真实颜色**：未知。已知：day-0 绿；84/86/87/88 在 `d97c9b09` 轮绿；82 故意红；其余 28 未评。
7. **V31-50 是否已被 query boundary 消解**：没有 socket 监听，理论进程仍可被杀。本 HEAD 未复现 crash。
8. **V31-83 服务端跨号读**：票面要 4xx 定性；AC 未勾。未复读。
9. **V31-87 撤权后重传**：主控补了传播，活体没走。
10. **V31-89 production 提取**：fixture 对「日式接睫毛／两百六」认不出。真模型未测。
11. **§38 第六条自报率**：仍是观测不是硬门。C12 未走不影响放行门，但也不许写成可用。
12. **冻结边界**：Day-0 单 spec 绿之后，是否仍冻 V31-81 的「中文错误」小补丁？建议冻根因、放诚实映射。

— Lane E，只读重评，不改账本。
