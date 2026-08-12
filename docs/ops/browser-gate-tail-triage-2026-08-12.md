> 来源：browser-tail-triage lane（Opus，只读定性，2026-08-12）。主控收编入仓；判别规则与逐条证据以本文为准。

# 三条浏览器必跑门 —— 主簇之外的尾部定性

**数据源**：CI run `31554310069`（PR #1 `ci-probe-pre-arch-wave`，仓 leelv009/meiyeagent），三个 job：
`v31-browser-acceptance`(93983444973) / `p2-browser-acceptance`(93983445068) / `production-main-journey`(93983444955)。
main 的 run `31559638579` 在本轮定性完成时 p2 与 prod 仍在跑，`gh` 拒绝出日志（"run is still in progress"），故按任务书回退到 PR #1 run。
**只读**：未改仓内任何文件，未跑 e2e/playwright/dev server。

---

## 0. 本轮最重要的结论（先说结果）

**三门 42 条红里只有 7 条是真的。** 其余 35 条是同一件事的级联：三个 job 各有一个长驻服务进程在跑测中途静默消失，之后每条 spec 都死在登录/清理 fixture 里，根本没碰到产品界面。

| 门 | 死掉的进程 | 最后存活证据 | 死后签名 |
|---|---|---|---|
| v31-browser-acceptance | **Core**（:4100） | 最后一行 Core 日志 `01:51:04` | `01:51:55` 起 `[Web] [vite] Internal server error: fetch failed` / `terminated` 持续刷屏 |
| p2-browser-acceptance | **Core**（:4100） | 最后一行 Core 日志 `02:15:40`（例行 5 分钟心跳） | `02:16:31` 起同上 |
| production-main-journey | **production-candidate**（wrangler dev/workerd :3010） | `02:00:32` 连发 `read ECONNRESET` 后消失；**Core 与 vite 均存活**（Core `02:00:43` 仍在写日志） | 后续 10 条 spec 全部 `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3010/auth/login` |

三处都**没有** OOM 信息、没有 crash stack、没有 Playwright 的 `Process from config.webServer exited early`。
已排除 PG 连接耗尽：三份日志 `too many clients` 命中 0，`53300` 唯一一次命中是时间戳 `01:52:14.5533005Z` 的子串误匹配。

**判别规则**（本报告全篇据此，不靠墙上时钟猜）：看 GitHub reporter 为每条失败 test 发的那一条 `::error file=` 注解指向哪里——
指向 spec 自己的断言行或 `ui-journey.ts` 的旅程断言 ⇒ 这条 test 走到了产品界面，是真红；
指向 `fixtures/auth.ts:34`（`cleanupE2EUsers`，收到 500）/ `:66`（`registerE2EUser`，收到 vite 的 `fetch failed` 500 HTML）/ `:108`（`loginByForm`，`ERR_CONNECTION_REFUSED`）⇒ 这条 test 连登录都没过，是级联。

---

## 1. 三分类总表

计数：**A=2，B=5，C=35**（共 42 条判红的 test）。另有 prod 的 2 条 flaky（最终通过，不计红）与三门共 18 条 `did not run`（本次根本没执行）。

### 1.1 v31-browser-acceptance（20 failed / 8 passed / 4 did not run）

| spec:case | 首错锚点 | 判 | 一句话 |
|---|---|---|---|
| `v31-context-fence-journey.spec.ts:174` | spec:192 等 `execution-confirmation-interaction-card` 120s | **A** | Core 侧同轮打出 V31-63 缺陷 B 的原话报错，签名完全吻合 |
| `v31-interrupt-resume-journey.spec.ts:150` | spec:78 等 `execution-confirmation-interaction-card` 120s | **A** | 同上；Core 报错时刻 +120s 精确等于本条收尾时刻（见 §2.0） |
| `v31-interrupt-resume-journey.spec.ts:250` | `auth.ts:34` | C | 级联 |
| `v31-level1-copy-journey.spec.ts:267` | `auth.ts:66` | C | 级联 |
| `v31-level1-copy-journey.spec.ts:524` | `auth.ts:66` | C | 级联 |
| `v31-living-plan-journey.spec.ts:250` | `auth.ts:34` | C | 级联（**注意**：本条历史红另有 V31-56 在案，本次跑无法复核） |
| `v31-memory-injection-b2-journey.spec.ts:160` | `auth.ts:34` | C | 级联 |
| `v31-mid-run-steering-journey.spec.ts:78` | `auth.ts:34` | C | 级联 |
| `v31-ops-console-release-journey.spec.ts:232` | `auth.ts:66` | C | 级联（两门都只在级联窗内失败，见 §4） |
| `v31-partial-resume-assisted-journey.spec.ts:101` | `auth.ts:34` | C | 级联 |
| `v31-publish-handoff-selfreport.spec.ts:236` | `auth.ts:66` | C | 级联（历史 V31-54 在案，本次跑无法复核） |
| `v31-publish-handoff-selfreport.spec.ts:318` | `auth.ts:66` | C | 级联 |
| `v31-publish-handoff-selfreport.spec.ts:341` | `auth.ts:66` | C | 级联 |
| `v31-rights-revocation-journey.spec.ts:156` | `auth.ts:34` | C | 级联（历史 V31-58 在案，本次跑无法复核） |
| `v31-thread-root-workbench.spec.ts:101` | `auth.ts:66` | C | 级联 |
| `v31-thread-root-workbench.spec.ts:143` | `auth.ts:66` | C | 级联 |
| `v31-thread-root-workbench.spec.ts:183` | `auth.ts:66` | C | 级联 |
| `v31-thread-root-workbench.spec.ts:228` | `auth.ts:66` | C | 级联 |
| `v31-thread-root-workbench.spec.ts:276` | `auth.ts:66` | C | 级联 |
| `v31-video-paid-execution-journey.spec.ts:147` | `auth.ts:34` | C | 级联 |

> **对任务书失败清单的更正**：`v31-thread-root-workbench` 的 5 败被列为「主簇之外最大簇」，但它 5 条全部死在 `registerE2EUser`（`auth.ts:66`，拿到 vite 的 `fetch failed` 500 HTML），即 Core 已死后的第一行代码。**这一簇本次没有任何产品面证据，不构成一个缺陷簇。**

### 1.2 p2-browser-acceptance（11 failed / 1 passed / 10 did not run）

| spec:case | 首错锚点 | 判 | 一句话 |
|---|---|---|---|
| `admin-sensitive-words.spec.ts:18` | spec:39 `selectOption` | **B-2** | 分类控件已换成 shadcn Select，spec 仍按原生 `<select>` 断言 |
| `composer-card-family.spec.ts:243` | spec:272 等 `ask-merchant-group-card` 240s | **B-1** | 进度卡已通过、问答卡不出现；Core 全程存活 |
| `composer-card-family.spec.ts:372` | spec:388 同上 | **B-1** | 同上，独立复现 |
| `composer-card-family.spec.ts:449` | spec:462 同上 | **B-1** | run1/retry1 同签名（Core 存活），retry2 落进级联窗 |
| `composer-card-family.spec.ts:490` | `auth.ts:34` | C | 级联 |
| `image-text-note-compiler.spec.ts:731` | `auth.ts:34` | C | 级联 |
| `p2-browser-closure.spec.ts:315` | `auth.ts:34` | C | 级联 |
| `v31-ops-console-release-journey.spec.ts:232` | `auth.ts:66` | C | 级联 |
| `viral-adapt-opencli-gate.spec.ts:13` | `auth.ts:66` | C | 级联 |
| `viral-adapt-opencli-gate.spec.ts:98` | `auth.ts:66` | C | 级联 |
| `viral-adapt-opencli-gate.spec.ts:132` | `auth.ts:66` | C | 级联 |

### 1.3 production-main-journey（11 failed / 1 passed / 2 flaky / 4 did not run）

| spec:case | 首错锚点 | 判 | 一句话 |
|---|---|---|---|
| `m04-browser-hard-gate.spec.ts:364`（image_text → xiaohongshu） | `ui-journey.ts:341` 等 `ask-merchant-group-card`∨`composer-question-card`（含「两种图文方向」）300s | **B-1** | 与 p2 的问答卡是同一族；run1、retry1 两次同签名，服务全程存活 |
| `marketing-identity-flow.spec.ts:32` | `auth.ts:108` | C | 级联 |
| `memory-vault-governance.spec.ts:107` | `auth.ts:108` | C | 级联 |
| `v31-memory-injection-b2-journey.spec.ts:160` | `auth.ts:108` | C | 级联 |
| `v31-thread-root-workbench.spec.ts:101/143/183/228/276` | `auth.ts:108` | C ×5 | 级联 |
| `w12-identity-draft-assistant.spec.ts:104` | `auth.ts:108` | C | 级联 |
| `xhs-image-text-main-journey.spec.ts:63` | `auth.ts:108` | C | 级联 |

**2 条 flaky（最终通过，不计门红，任务书清单里被当成失败列了）**：
- `campaign-paid-work-confirmation.spec.ts:20` —— 首跑在 spec:46 等 `composer-quote-line` 60s 不可见，重试后通过。**不开票，但值得留意**：这是本轮唯一一条「首跑就摸到付费报价面并失败」的记录。
- `m04-browser-hard-gate.spec.ts:364`（copy → wechat_moments）—— 其 retry #2 记录为 `ERR_CONNECTION_REFUSED`，属级联噪声。

---

## 2. B / C 逐项详情

### 2.0 先把两条 A 的证据钉死（因为任务书要求 A 必须有签名证据）

Core 在 v31 门里打出过三次 V31-63 缺陷 B 的原话报错：

```
[Core] Price-drift successor requires one not-started primary predecessor attempt.
[Core]  Error: Price-drift successor requires one not-started primary predecessor attempt.
    at PostgresCreationSubmissionStore.createRepricedPaidExecutionSuccessor (apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:1…)
    at async admitConfirmedExecutionPlan (apps/core/src/p1/harness/paid-generation-confirmation.ts:410:22)
    at async confirmPaidGenerationExecution (apps/core/src/p1/harness/paid-generation-confirmation.ts:280:27)
```

时间点 `01:44:46`、`01:47:40`、`01:51:04`（间隔约 3 分钟＝重试节奏）。
- `v31-context-fence-journey:174` 收尾于 `01:49:44` —— 前两次落在它的三次尝试窗内。
- `v31-interrupt-resume-journey:150` 收尾于 `01:53:06`，而 `01:51:04 + 120s（该断言的 timeout）= 01:53:04`。**对得上到秒级**，这条是主簇无疑。

p2 与 prod 两份日志里 `Price-drift successor` 命中 **0 次** —— 主簇死亡链在那两门根本没触发，这也反过来支持「那两门的红另有成因」。

---

### 2.1 【B-1】ask-merchant 问答卡在真实浏览器旅程里从不出现 —— 4 case / 2 门

**症状（断言原文）**

`composer-card-family.spec.ts:272 / :388 / :462`：
```
Error: expect(locator).toBeVisible() failed
Locator: getByTestId('ask-merchant-group-card')
Expected: visible
Timeout: 240000ms
Error: element(s) not found
```
`ui-journey.ts:341`（m04 image_text 旅程）：
```
Error: the run must ask its one 图文方向 question and wait for the merchant
Locator: getByTestId('ask-merchant-group-card').filter({ hasText: '/两种图文方向/u' })
     .or(getByTestId('composer-question-card').filter({ hasText: '/两种图文方向/u' })).first()
Timeout: 300000ms
```

**为什么不是主簇**：`composer-card-family:243` 在失败前**已经通过** spec:262 的 `composer-progress-card` 断言（run 确实起来了、在流式推进），且这三条是**免费 copy 路线**（`startRun(page, '写一条周末到店的团购活动文案')`），走不到付费 admission。m04 那条则死在 `submitComposerJourney` 的问答环节，也在付费确认之前。主簇的 `Price-drift` 报错在这两门 0 命中。

**初步根因假设（按可能性排序）**

1. **run 先进入 `delivered`，问答轮询随即关闭 → 卡永不出现。**
   `mkfast-template-main/src/product/composer/use-composer-interactions.ts:142` 与 `:148` 两个 `useQuery` 都写着
   `refetchInterval: options.session.phase === 'delivered' ? false : 2_000`，且 `:145` 的 `enabled` 同样带 `phase !== 'delivered'`；
   `src/product/composer/ask-merchant-interaction-slot.tsx:51-57` 的快照轮询同理（`delivered` 后只在 `status==='pending'` 时才继续）。
   spec 自己的注释已自陈这条路线的历史：「Since T44, a cold tenant's *industry* gap no longer asks — Day-0 delivers first on the policy route」（`composer-card-family.spec.ts:253-256`）。若 promotion gap 也变成了 deliver-first，表现正是本症状。
2. **Core 侧压根没升起 gap。** 生产端锚点：`apps/core/src/p1/harness/structured-nodes.ts:943`（`fallbackGuidanceGap`，`团购|优惠|套餐|活动` 分支返回 `promotion_details` 问题）→ `:369-378`（`const { blockingGap, ...declaration } = result.output` → `blockingQuestion`）；`:901` 该 gap 的 `unattended: 'continue'`。图文方向问法文案在 `apps/core/src/p1/harness/merchant-delivery-language.ts:77` / `:86`。

**结构性观察（对定票有用）**：`use-composer-interactions.ts:151-157` 里 `pendingAskRequest` 与 `pendingExecutionConfirmation` **同出一个 `transports.readInteraction(taskId)`，只按 `kind` 分流**。也就是说「问答卡」和主簇的「执行确认卡」共用同一条单槽交互通道与同一套轮询开关。渲染点在 `src/product/composer/composer-home.tsx:3839`（生产槽 `AskMerchantInteractionSlot`）与 `:3855`（legacy `ComposerQuestionCard` fallback，需 `pendingQuestion`）——m04 那条断言把两个 testid 都等了，**两个都没出**，说明缺的是上游数据而不是某一个渲染器。

**建议票粒度**：一票，覆盖 4 个 case（p2 的 3 条 + prod 的 1 条）。
**⚠️ 查重（重要）**：`docs/tickets/v3.1/V31-28-composer-plan-surface-integration.md:41` 已白纸黑字记过同一现象——「`agent-living-plan` / `agent-commit-strip` / `agent-plan-diff` / `ask-merchant-group-card` 在 composer 旅程 DOM 快照中从未出现（方向问答由另一渲染器出面）」，票状态 `merged-with-evidence-debt`。**建议并入 V31-28 重开，不要新开号**。唯一的新增事实是：V31-28 当时记录「方向问答由另一渲染器出面」，而本轮 m04 把 `composer-question-card` 这条 fallback 也一起等了，同样没出——即那条退路现在也断了，属 V31-28 之后的退化，需在票里补记。

---

### 2.2 【B-2】admin 敏感词「分类」控件已换 shadcn Select，spec 仍按原生 `<select>` 断言

**症状（断言原文）**
```
Error: locator.selectOption: Error: Element is not a <select> element
Call log:
  - waiting for getByTestId('admin-sensitive-words').getByLabel('分类')
    - locator resolved to <button tabindex="0" type="button" role="combobox" id="sw-category"
      data-size="default" aria-expanded="false" aria-haspopup="listbox" data-slot="sel…
> 39 |     await panel.getByLabel('分类').selectOption('medical');
```
三次尝试同签名；发生在 `01:42:23`，全门最早，服务完全健康。

**根因（已读码确认，非假设）**
`mkfast-template-main/src/p1/admin-sensitive-words-control.tsx:286-311` 渲染的是 shadcn `Select` / `SelectTrigger`（Radix combobox），`SelectTrigger` 上带 `id="sw-category"` 与 `data-testid="admin-sensitive-words-category"`。原生 `selectOption` 对它不适用。
该文件近三次改动全部来自 admin 换装波：`58953be3`(#428) / `a073be43`(#426) / `55b876b3`(#425)——即 2026-08-07 那批 admin 整备票改了控件而 e2e spec 没跟。

**建议修法**：只改测试合同，不动产品——点开 `admin-sensitive-words-category` trigger 后按 option 文案/值选取。与 V31-58 同属 test-contract mismatch 家族。
**建议票粒度**：一票。可与后续暴露的同类 admin 断言合并。
**⚠️ 施工提醒**：该 spec 第 39 行之后还用 `panel.getByRole('row')` 做行断言（`:45-59`）。换装波同时改过表格形态，修完第 39 行很可能立刻暴露行语义的下一处红，票面须要求**把这条 case 跑到底**再关。

---

### 2.3 【C-核心】三门各死一个长驻服务进程，且门没有任何存活断言

**症状**：见 §0 表。补充逐条证据：

- v31：`01:51:04` 之后 Core 一行日志都没有（此前每 5 分钟必有 `Harness observability drift detected` 心跳）；`01:51:55` 起 Web 侧持续
  `[vite] Internal server error: fetch failed`（栈：`undici` → `miniflare dispatchFetch` → `@cloudflare/vite-plugin`）
  以及一条 `Internal server error: terminated`（栈：`Fetch.onAborted` ← `Socket.onHttpSocketClose`）——**在途请求被对端关闭**，是进程消失而非阻塞的签名。
  此后 19 条 spec 在 `01:53:06`–`01:53:58` 内以约 3 秒一条的节奏倒下（每条 3 次尝试各约 1 秒，全部死在 fixture）。
- p2：Core 心跳 `01:50:40 / 01:55:40 / 02:00:40 / 02:05:40 / 02:10:40 / 02:15:40` 规律出现，**`02:20:40` 没有**；`02:16:31` 起 Web 同款 `fetch failed`。
- prod：`[WebServer]`（=production-candidate 那个 `pnpm build && wrangler dev` 块）在 `02:00:32` 连打 5 条 `Error: read ECONNRESET` 后消失；Core 在 `02:00:43` 仍在正常写日志，说明**死的是候选 Worker 不是 Core**。

**为什么这条必须开票（而不是记成运维条目）**
1. 进程消失**不留任何痕迹**——没有退出码、没有信号、没有 crash stack，日志里唯一线索是对端断开。定位一次要靠交叉比对三份日志的心跳缺口。
2. 门**没有存活断言**。Playwright 的 `webServer` 只在启动期把关（`mkfast-template-main/playwright.config.ts:66-170`，Core 块 `url: ${coreURL}/health` + `timeout: 120_000`），启动之后进程死掉不会让门说实话，而是把 35 条 spec 判成产品红。这正是本轮把「~25 spec 全红」误读成产品全面崩塌的直接原因。
3. 包装脚本 `mkfast-template-main/scripts/e2e/run-service.mjs` 只做信号转发（`child.once('exit')` 把子进程的退出码/信号原样传出），**没有把异常退出写进证据目录**，CI evidence 里查不到。

**与 V31-50 的关系（查重结论）**：`docs/tickets/v3.1/V31-50-ssr-unhandled-socket-error-kills-process.md` 讲的是 **Web SSR** 进程在 PG `53300 too many clients` 时因未监听 socket `'error'` 而整体死亡。本轮：
- prod 的候选 Worker 死亡**可能同族**，可并入 V31-50；
- **v31/p2 死的是 Core，且三份日志 `53300` / `too many clients` 命中为 0** ⇒ 不是 V31-50 的根因，需另立。

**建议票粒度**：一票，两件交付物——(1) Core 与候选 Worker 异常退出必须留痕（退出码/信号/最后 N 行写入 `CI_EVIDENCE_DIR`）；(2) 三条门脚本加服务存活断言，进程消失时把门判成「仪器失效」并停跑，而不是继续产出几十条假产品红。

---

### 2.4 【C-其余】纯级联，本轮无产品结论

下列 31 条本轮全部死在 `auth.ts:34/66/108`，**不能据本次跑对它们的产品状态下任何结论**（既不能判红也不能判绿）：

v31（18）：`v31-interrupt-resume-journey:250`、`v31-level1-copy-journey:267/524`、`v31-living-plan-journey:250`、`v31-memory-injection-b2-journey:160`、`v31-mid-run-steering-journey:78`、`v31-ops-console-release-journey:232`、`v31-partial-resume-assisted-journey:101`、`v31-publish-handoff-selfreport:236/318/341`、`v31-rights-revocation-journey:156`、`v31-thread-root-workbench:101/143/183/228/276`、`v31-video-paid-execution-journey:147`
p2（7）：`composer-card-family:490`、`image-text-note-compiler:731`、`p2-browser-closure:315`、`v31-ops-console-release-journey:232`、`viral-adapt-opencli-gate:13/98/132`
prod（10）：`marketing-identity-flow:32`、`memory-vault-governance:107`、`v31-memory-injection-b2-journey:160`、`v31-thread-root-workbench:101/143/183/228/276`、`w12-identity-draft-assistant:104`、`xhs-image-text-main-journey:63`

其中已有旧票在案、本轮无法复核的：`v31-living-plan-journey`→V31-56、`v31-publish-handoff-selfreport`→V31-54、`v31-rights-revocation-journey`→V31-58、`v31-interrupt-resume-journey:250`(expiry fixture)→V31-57。**这些旧票的状态不受本轮影响，别拿本轮的级联红去改它们的结论。**

---

## 3. 建议开票清单

| 号 | 标题 | 覆盖 | 备注 |
|---|---|---|---|
| **V31-64** | 浏览器必跑门中途丢服务进程：Core / 候选 Worker 静默退出无留痕，且门无存活断言，致 35/42 红为级联假红 | §2.3 | 与 V31-50 分立（无 `53300`，且死的是 Core）；prod 候选 Worker 那半可并入 V31-50 |
| **V31-65**（建议改为**重开 V31-28**） | ask-merchant 问答卡在真实浏览器旅程从不出现；`composer-question-card` 退路同样失效 | §2.1，4 case | V31-28:41 已记同一现象，状态 merged-with-evidence-debt；新增事实＝fallback 渲染器也不出面 |
| **V31-66** | admin 敏感词分类控件换 shadcn Select 后 e2e 仍按原生 `<select>` 断言 | §2.2，1 case | test-contract mismatch，同 V31-58 家族；须把该 case 跑到底防第 39 行之后连环红 |

**不建议开票**：`v31-thread-root-workbench` 的 5 败（任务书列为最大簇）——它 10 次失败（两门各 5）全部落在 fixture，无任何产品面证据。

**开票顺序建议**：V31-64 先做。它不修好，另外两票的验收跑仍会被级联污染，而且 V31-63 主簇修完后重跑三门，仍会因为进程死亡拿不到干净的绿。

---

## 4. 自查：哪些定不了性

1. **`v31-ops-console-release-journey:232`** —— 在 v31 与 p2 **两门都只在级联窗内失败**（`auth.ts:66`）。两次都没有产品面证据，本轮**无法定性**。需要一次进程存活到底的跑。
2. **`viral-adapt-opencli-gate:13/98/132`、`image-text-note-compiler:731`、`p2-browser-closure:315`、`composer-card-family:490`** 以及 §2.4 列出的全部 31 条 —— 同上，只有级联证据。
3. **三门共 18 条 test「did not run」**（v31 4 / p2 10 / prod 4）—— GitHub reporter 不枚举这批的名字，日志里查不到是哪几条。它们**本次根本没执行**，因此「没红」不等于「是绿的」；p2 门 22 条里有 10 条没跑，本轮对 p2 的覆盖只有一半多一点。
4. **进程为什么死** —— 三份日志都没有 OOM/信号/退出码线索。已排除 PG 连接耗尽；已排除主簇的 `Price-drift` 报错（该报错在 v31 里先无害地触发过两次，且 p2/prod 0 命中）。**根因未定**，V31-64 的第一步交付物就是让它下次死得留痕。
5. **`composer-card-family:449`** 判 B 带一点保留：它的 retry2 落在级联窗内（首错为 `auth.ts:34`），只有 run1 与 retry1 是干净的 `ask-merchant-group-card` 超时。但同文件的 `:243`/`:372` 在服务完全健康时以同一签名各失败三次，故并入 B-1 是安全的。
6. **main run `31559638579` 未纳入** —— 定性完成时 p2 与 prod 仍在跑，`gh` 对整个 run 拒绝出日志。其 `v31-browser-acceptance` 已失败（14m46s，与 PR #1 的 14m47s 几乎一致，形态大概率相同），但**未取证**，不作为本报告依据。建议 run 跑完后复核一次「Core 是否又在同一时段死亡」——这是 V31-64 是否可复现的关键第二数据点。
