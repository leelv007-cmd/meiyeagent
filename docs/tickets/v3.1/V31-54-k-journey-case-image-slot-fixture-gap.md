# V31-54 — K 自报旅程被 `case_image` source slot 挡在门口，`5ed00f453` 的浏览器验证腿至今未跑过

**Parent**: V3.1 §37.4-K 自报旅程（`plan:1776`）；产品面 V31-17（publish handoff + self-report）
**批次**: 收尾（**优先级高于普通 fixture 活**——理由见「为什么它不是一件普通 fixture 活」）
**Blocked by**: None
**Related**: V31-19（OutcomeEvidence）为下游承接面；V31-29（fixture 真实性）为修法纪律
**Status**: 已关票（2026-08-16 晚）— evidence-debt 已结清：**`5ed00f453` 的浏览器验证腿是绿**（`v31-publish-handoff-selfreport.spec.ts` 三条用例全跑全过，串行单文件进程 `--retries=0`，连续 3 轮），provenance 已补齐；票面预判的「门后断言可能露新红」未兑现，无新红要归类

**Implementation state**: done
**Verification state**: verified — 3/3 用例绿，连续 3 轮（31943455809 / 31945068170 / 31946656644）
**Evidence SHA**: 557c007eb500dede6f39b786b47d317c8e5522c1
**Workflow Run**: 31946656644（job 95163626375 `v31-browser-report`）
**Artifact Digest**: artifact 9264167296 `v31-browser-report-evidence` → `output/ci/v31-browser-report/playwright-v31-publish-handoff-selfreport.log`（`3 passed (2.9m)`）

## 缺口（一句话）

K 旅程的两条用例在**提交阶段**就被拒：`INVALID_STATE — Required source slot case_image is not satisfied by the current workspace sources.`，旅程从未走到自报环节。

> **锚署树**：`2da11d5ab`（W4-D round3 证据树）。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | 拒绝原文（两条用例各一次） | `round3-per-spec/v31-publish-handoff-selfreport.log:131` 与 `:159`：`composer submission must be accepted with 202; body={"error":{"code":"INVALID_STATE","message":"Required source slot case_image is not satisfied by the current workspace sources."}}` |
| 2 | 两条失败用例 | 同日志 `:124`（`spec.ts:226` — `Delivered handoff anchors: copy blocks, ZIP name, QR merchant-self, no direct publish`）、`:126`（`spec.ts:331` — `self-report journey: next-day chips, once-per-work, two-ignore backoff`） |
| 3 | 唯一通过的一条**不经提交** | 同日志 `:125`：`spec.ts:308` — `A19 attempt_publish_from_handoff rejects driven intents via P1`（`✓`）。它证明 P1 拒绝面是好的，**不代表交付/自报链路被验证过** |
| 4 | 拒绝的抛出点 | `apps/core/src/p1/execution-spine/composer-submission-gate.ts:836` |
| 5 | slot 需求的声明处 | `apps/core/src/p1/creation-experience/launch-seeds.ts:126` `slot: 'case_image'` |

## 为什么它不是一件普通 fixture 活

`5ed00f453`（`fix(operations): repair two merge collisions in publish-handoff evidence flow`）改的正是 publish-handoff 的证据流：`content-package-delivery.ts`（+34/−… ）、`publish-handoff.ts`、`publish-handoff.test.ts`。**它有单测背书，但它的浏览器验证腿从来没跑过**——因为跑到那条腿之前，旅程就在提交门被 `case_image` 挡住了。

也就是说：**这不是「一条旅程红了」，是「一次交付流程的合并冲突修复至今没有端到端证据」。** 修 fixture 是手段，真正解锁的是 `5ed00f453` 的验证。这就是它优先级不同于普通 fixture 活的原因，也是本票必须复跑 K 而不是只把 fixture 改绿的原因。

## What to build

1. 让 K 旅程的 workspace **真的满足 `case_image` slot**——按 `launch-seeds.ts:126` 声明的需求，用**真实的素材写入路径**播种（与 §37.4 其他旅程播种素材的方式一致），不要绕过 `composer-submission-gate.ts:836` 的检查。
2. fixture 改好后**复跑整条 K**，把 `spec.ts:226` 与 `:331` 跑到真实结论——**注意这两条很可能露出新的红**（它们此前从未越过提交门，门后的断言一次都没被执行过）。新露出的红**是发现不是回归**，逐条判：属 `5ed00f453` 域的记进该修复的验证结论，属别的域的另开票。
3. 在票下明确回答一句：**`5ed00f453` 的浏览器验证腿是绿还是红。** 这是本票存在的理由，不许只写「fixture 已修、K 已绿」而不指名这一点。

## 边界与禁止修法

- **禁止**放宽或绕过 `composer-submission-gate.ts:836` 的 slot 检查（改成 warn、给测试开后门、或在 spec 里把 `INVALID_STATE` 当预期）。那个门是产品合同。
- **禁止**只把两条用例改成 skip/fixme 了事——那会把「`5ed00f453` 无端到端证据」这件事继续埋起来。
- 不改 `launch-seeds.ts` 的 slot 需求本身；若认为 `case_image` 对该旅程不该是必需，那是产品决策，**停手报主控**。

## Acceptance criteria

- [x] K 旅程经**真实素材写入路径**满足 `case_image`：`deliverViaComposer` 在 submit 前调用 `seedComposerInlineAuthorize`（与 living-plan / mid-run-steering 等同形）；`composer-submission-gate.ts:836` **未**放宽
- [x] `v31-publish-handoff-selfreport.spec.ts:226` 与 `:331` 浏览器真跑结论 — **已跑，绿**，见「浏览器验证腿的结论」
- [x] A19 `:308` 不经提交，保持独立（无改动）
- [x] **`5ed00f453` 浏览器验证腿**：**绿**（3/3 用例，连续 3 轮）— 见下

## 浏览器验证腿的结论（2026-08-16 晚）：**绿**

票面第 41 行要求「明确回答一句：`5ed00f453` 的浏览器验证腿是绿还是红」。**答：绿。**

该腿一直在 CI 上跑着，只是没人回来记——**跑它的是 `v31-browser-report`**
（`.github/workflows/core-quality.yml:536`，`V31_GATE_SCOPE: remaining`），
形态恰好就是票面要求的**串行**：`run-v31-browser-acceptance.sh:165-172`
对 remaining 目录**每个 spec 起一个独立 Playwright 进程**，且 `--retries=0`。

| run | head | 该 spec 在哪张单 |
|---|---|---|
| 31943455809 | `cf33894c3` | `passed:` |
| 31945068170 | `a0b546f20` | `passed:` |
| 31946656644 | `394ba1f96` | `passed:` |

分文件证据（run 31946656644，artifact `v31-browser-report-evidence`
→ `output/ci/v31-browser-report/playwright-v31-publish-handoff-selfreport.log`）收尾为：

```
::notice title=🎭 Playwright Run Summary::  3 passed (2.9m)
```

**三条用例全跑全过。** 与票面点名的三处对应（行号已随后续改动漂移，按内容对齐）：

| 票面 | 现行 | 用例 |
|---|---|---|
| `:226` | `:227` | Delivered handoff anchors: copy blocks, ZIP name, QR merchant-self, no direct publish |
| `:308` | `:310` | A19 attempt_publish_from_handoff rejects driven intents via P1 |
| `:331` | `:333` | self-report journey: next-day chips, once-per-work, two-ignore backoff |

**票面第 40 行的预判没有兑现**——它写「这两条很可能露出新的红（门后的断言一次都没被执行过）」。
实际是**门后断言执行了并且全绿**，没有新红要归类。

### 两点诚实说明

1. **`5ed00f453` 本身在当前本地历史里解析不出来**（`git log` 报 `Not a valid object name`）——
   远端 main 是净化后的无父提交，该 SHA 属净化前历史。所以**无法**再去 diff 它。
   能断言的是票面真正关心的那件事：**它改的 publish-handoff 证据流所在的 K 旅程，
   门后断言现在跑得到、且是绿的**。
2. **`v31-browser-report` 是 advisory，不在 `required` 内**。
   所以这条腿的绿**不构成合并门背书**；它是「这条旅程端到端跑通过」的证据，
   这正是本票要的。三轮里该 job 整体判 failure，红的是别的 spec
   （`v31-mid-run-steering-journey` 等），与本票无关。
- [x] 门后新红归类规则已写：发现≠回归；属 handoff 域记 5ed00f453 验证，属他域另开票
- [x] 变异路径：去掉 `seedComposerInlineAuthorize` 行 ⇒ 提交必回 `INVALID_STATE`（产品门未动）

## 实现

| 落点 | 改动 |
|---|---|
| `v31-publish-handoff-selfreport.spec.ts` | `deliverViaComposer` 内 `seedComposerInlineAuthorize({ fileName: v31-k-handoff-*.png })` |

## 留痕

- 开票：W4-D 三轮浏览器验收判为 fixture 缺口且**阻断在触达 `5ed00f453` 验证点之前**，主控 2026-08-10 派 review-memory 落票并要求票面写明这条阻塞关系。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：逐条只读核证拒绝原文（两次）、抛出点（`composer-submission-gate.ts:836`）、slot 声明处（`launch-seeds.ts:126`）、以及 `5ed00f453` 的改动面（三个文件，含 `publish-handoff.test.ts` 故**有单测背书、无浏览器背书**）。据此把票面重心从「补 fixture」移到「解锁一次至今无端到端证据的交付修复」，并把「门后新露出的红是发现不是回归」写成验收要求，避免复跑时被误判成回归而回退 `5ed00f453`。另记：唯一通过的 `:308` 不经提交，不能当作交付链已验证的旁证。本 commit 零代码改动。
- 2026-08-11 repair：fixture 播种落地；浏览器 `5ed00f453` 腿仍 residual。
