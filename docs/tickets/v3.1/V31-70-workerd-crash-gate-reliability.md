# V31-70 — 浏览器门 workerd 猝死：三门同根的 Broken pipe 崩溃与仪器子进程盲区

**Parent**: V31-64（门仪器）之后的门可靠性收口
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-64（服务退出仪器）、V31-63（前一轮门死亡定性）

**Status**: implementation-complete / release-verification-pending（2026-08-13；2026-08-16 补第六数据点）— Cloudflare runtime 已 pin、Vite watcher 已排除 Playwright output、内嵌 workerd 首帧与 candidate runtime 断连均 fail closed；连续 required CI 轮待补。**08-16：仪器那一半已实证生效（p2 三轮都明确宣告 `GATE INSTRUMENT FAILURE` 并给出「NOT evaluated」清单，验收第 2 条可判达成），但崩溃本身未消，验收第 3 条未达成；纯文档 PR 上同样复现 ⇒ 该门的红属环境性，且三轮失败的是同两条 spec（先于本轮工作存在）**

**Implementation state**: done
**Verification state**: local instrument/runtime contracts verified; required same-SHA CI pending
**Release state**: pending PR + `Core quality / required`
**Evidence SHA**: 39ca4b399361a9226848c71009d3d6500612ce2c
Evidence 注：integration candidate；required CI pending
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

CI run 31573910031（main=f79eb489）三个浏览器门在**互不相同的时刻**死于**同一个进程**：wrangler dev 里的 workerd 子进程。三门 35 条红里 28 条是它的级联，只有 7 条真红。这是当前门可靠性的头号杀手——workerd 一崩，该门此后所有 spec 全部沦为 auth 500 / vite 错误页假红或「did not run」。

## 证据（run 31573910031）

| 门 | 崩溃时刻 | 形态 | 证据 |
|---|---|---|---|
| production | 07:47:57 | production-candidate（wrangler dev 一等托管服务）exit 1，仪器**命中**，11 specs 记 NOT evaluated | `service-exits/production-candidate-7665.json` tail：`kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(...): Broken pipe`，栈=workerd-linux-64@1.20260424.1 |
| v31 | 07:38:09 | web dev server 内 workerd **子进程**消失，仪器**盲**（只记 core/p1-worker/web 三个父进程）；`terminated`＋`fetch failed` 同秒出现，74 秒风暴 22 条级联红 | playwright log :311/:331，栈经 miniflare dispatchFetch → @cloudflare/vite-plugin |
| p2 | 08:02:08 | 同 v31 形态；:449 retry2 起全部级联，10 specs did not run | playwright log :675 |

关键更正：此前把 v31/p2 的风暴误判为「Core 挂起」——两门的 Core 直到 teardown SIGTERM 都健康（v31 的 Core tail 还有 `Waiting for pending workflows to finish.` 优雅收尾行）。死的是 vite cloudflare 插件里的 workerd。

判别注记：本地 54329 多 lane 并跑时另有一种假红形态——`PostgresError: sorry, too many clients already`（53300，max_connections=100），表现为旅程中段任意 P1 命令 5xx（如 `APPROVAL_CONTEXT_UNAVAILABLE`）；与 workerd 猝死无关，先查 `pg_stat_activity` 再定性（2026-08-12 F5 验证二轮实证）。

## 触发器模式（run 31581702243 第二数据点后收敛）

两轮 run（31573910031 / 31581702243）v31 门 workerd 都死在**同一位置**：12 分钟跑的最后 74 秒，恰=fence:174（3×120s 超时重试）收尾时刻；p2 门死在 card-family :449 retry2（3×240s 等 ask-merchant 卡）；production 门死在 m04 image_text 重试（3×240s 等 stage line）。**三门死亡全部尾随「长超时红 spec 的重试拆场」**：这类 spec 每轮重试都留下大量在途 SSE/轮询请求，重试拆场把浏览器连带全部 socket 猛关，workerd 对已关 socket 的写命中 `kj Broken pipe` 且按 FATAL 处理。推论：(1) 修净长超时真红（m04 已修、fence 编舞重排在途、card-family lane 在途）会顺带摘掉当前全部已知触发器；(2) 根修仍需 workerd/miniflare 侧容忍 EPIPE（版本调查），因为任何未来红 spec 都可能再造同型触发。

**第四数据点（run 31585117323 production 门）推翻「重试拆场是必要条件」**：16 passed（9.9m）零 flaky 零重试，production-candidate 仍在 w12 进行中 exit 1（同 kj Broken pipe），w12 记 interrupted、xhs 第三次未评估。健康跑照死→重试风暴只是放大器不是根因，**版本级调查升为主路**（workerd-linux-64@1.20260424.1 / miniflare@4.20260212.0 / @cloudflare/vite-plugin@1.25.0 / wrangler dev）。本轮 production 门若无此崩溃即为全绿——V31-70 已是该门唯一阻塞。

## 两路工作

1. **缓解（治本）**：workerd Broken pipe 崩溃调查——@cloudflare/workerd-linux-64@1.20260424.1 / miniflare@4.20260212.0 / @cloudflare/vite-plugin@1.25.0 版本组合的已知问题排查与升级评估；不可升级则评估 dev server 崩溃自愈（重启 web 服务并让 playwright 重试当前 spec）或把三门 web 侧换成 production 门同款一等托管 wrangler dev（至少让死亡可见可判）。
2. **检测（V31-64 补口）**：仪器把「vite `Internal server error: fetch failed/terminated` 首帧」识别为 GATE INSTRUMENT FAILURE 信号，与 production 门的进程退出同权——workerd 子进程死亡从此不再伪装成成片 spec 假红。落在 `mkfast-template-main/scripts/e2e/` 仪器族。

**第五数据点（run 31587057598，f171b41d=首轮带 supervisor 重启预算）——production 门治愈实证成功**：production-candidate 10:29 起连环 kj Broken pipe、10:36:30 exit 1，run-service 原地复活（`restarting production-candidate after unexpected exit code 1 (1/2)`），gate-liveness 只发治愈警告未中断；门跑满 32.9m，**18 specs 四轮来首次全部得到判决**（14 passed＋2 flaky 重试自愈＋2 真败）。撞在治愈窗口的 thread-root :276（10:36:48 `Network unavailable`）按设计只牺牲一次、retry 自愈。两条真败均为首见数据点、与 workerd 无关：xhs :63（`streamFaultApplied` 5s poll 不为真——agent-threads SSE 断流注入未被 Core 确认，注：与 V31-28 六腿改的 workflow-events 是不同端点族）、w12 :104（360s test timeout，上轮同门曾绿）。各记一笔观察，复发再立案。

**同一数据点确认预算对 v31/p2 无效**：v31 门 10:36:34 起 `fetch failed` 风暴 507 行、fence/day0/goal-proactive 等级联，全程 **0 条 `gate-liveness`/`GATE INSTRUMENT` 输出**——workerd 是 vite 插件在 web 进程**内部**拉起的孙进程，web 父进程从未退出，run-service 的重启预算与 V31-64 仪器都看不见它。重启预算只对 production 门（wrangler dev＝一等托管服务）有效；v31/p2 的治愈只能走上面第 2 路（vite 错误首帧检测）或换托管形态。

**第六数据点（2026-08-16，三轮连发）——仪器那一半成了，崩溃那一半没有**：
`p2-browser-acceptance` 连续三轮（run `31933812189` / `31935196137` / `31936621559`）
都以同一句收尾：

```
GATE INSTRUMENT FAILURE: web (pid …) emitted Vite workerd disconnect signature
"Internal server error: fetch failed" — remaining specs NOT evaluated
```

**验收第 2 条可以判达成**：上面第 2 路的「vite 错误首帧检测」显然已经落地并生效——
门不再是一片级联红，而是明确宣告「这是仪器故障」并给出「剩余未评估」清单。
三轮计数：`3 failed / 4 did not run / 17 passed`、`2 failed / 4 / 17`、
`2 failed / 5 did not run / 17 passed`。

**验收第 3 条明确未达成，且这轮拿到了对照**：第三轮发生在
**PR #18 这个纯文档 PR** 上——零产品代码改动，仪器签名一字不差。
更有用的是：**三轮里失败的是同两条 spec**——
`p2-browser-closure.spec.ts`（第三轮死在 `:731 viral chip uses…`）与
`v31-ops-console-release-journey.spec.ts`。
既然它们在一个零代码 diff 上照样红，**这两条红与被合入的内容无关**，
是先于本轮工作存在的（是产品缺陷还是风暴级联，本票不下结论——需要单独定性）。
**操作口径**：以后有人拿 p2 的红阻塞合入，先问「拿一个空 diff 复现不复现」。

> ⚠️ 更正留痕：本条初稿写的是第三轮「真红 0」，**错**。
> 当时 grep 的 `tail -5` 把 `2 failed` 那行截掉了，我据此下了结论。
> 实际是 `2 failed`。修正后结论反而更强（同两条 spec 三轮稳定复现），但错就是错，记在这里。

**新暴露的治理后果（本票之外、但由本票的故障造成）**：批次是顺序跑的，
风暴一命中，排在后面的 spec 全落进「did not run」——于是
**新登记进批次的 spec 可以「登记了、命令行里有它、却一次都没执行过」**。
本轮实例＝`workbench-narrow-viewport-shell.spec.ts`（V31-96），两轮皆如此。
判别法：全日志 grep 该 spec 名，只出现在 pnpm 命令行、没有任何测试结果行 ⇒ 它没跑。

**第七数据点（2026-08-16 晚，run 31937870991 / `eceb32fb6`）——这次打在 `required` 里，不再只是 advisory**：

前六个数据点都落在 `p2-browser-acceptance` / 三浏览器门（**advisory**，不阻塞合并）。
这一次崩在 **`production-main-journey`**——**`required` 的八个成员之一**，直接把合并门判红。

| 时刻 | 事件 |
|---|---|
| 09:05:27 | `kj/async-io-unix.c++:186: disconnected: ::write(fd, …)` |
| 09:05:30 | `[run-service] production-candidate emitted Network connection lost` |
| 09:06:03 | 第二次 `Uncaught Error: Network connection lost.` |
| **09:06:38** | 测试才失败：`m04-browser-hard-gate.spec.ts:502` 找不到 `composer-capsule-lens-panel` |
| 09:06:55 | 四个进程 SIGTERM 收尾，`1 failed / 6 passed` |

**服务端先死 68 秒，测试才红**——所以这条红是**环境连累**，不是那条 spec 的产品缺陷。
（已在 V31-93 记一笔，防止有人看到 `composer-capsule-lens-panel` 就以为 V31-96 白修了。）

`eceb32fb6` 是**纯文档 PR #18**，diff 碰不到产品代码——
与前六点同一口径：**零代码 diff 上照样复现**。

**治理后果又发生了一次，且这次代价更大**：
`run-pr-production-journey.sh` 把 spec 分 mainline／composer／governance **三批顺序跑**，
`set -euo pipefail` ＋ `run_browser_batch` 末尾 `return "${batch_status}"`
⇒ **首批失败即中止整个脚本**。mainline 一倒，**composer 与 governance 两批一条都没跑**。
本轮因此完全没有判决的包括 `w12-identity-draft-assistant`（V31-95 正在还观察债的那条）。
日志里只会看到**一个批**的收尾计数——**这就是判别「没跑」而非「跑了没红」的方法**。

## 验收

- 复现或定位 Broken pipe 触发条件（或版本升级后连续 N 轮 CI 无 workerd 死亡）；
- 仪器在 workerd 子进程死亡时给出 GATE INSTRUMENT FAILURE 判决与「NOT evaluated」清单，级联红归零；
- 三浏览器门连续两轮 CI 无「风暴级联」形态红。
