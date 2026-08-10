# V31-54 — K 自报旅程被 `case_image` source slot 挡在门口，`5ed00f453` 的浏览器验证腿至今未跑过

**Parent**: V3.1 §37.4-K 自报旅程（`plan:1776`）；产品面 V31-17（publish handoff + self-report）
**批次**: 收尾（**优先级高于普通 fixture 活**——理由见「为什么它不是一件普通 fixture 活」）
**Blocked by**: None
**Related**: V31-19（OutcomeEvidence）为下游承接面；V31-29（fixture 真实性）为修法纪律
**Status**: open

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

- [ ] K 旅程 workspace 经**真实素材写入路径**满足 `case_image` slot，`composer-submission-gate.ts:836` 未被放宽
- [ ] `v31-publish-handoff-selfreport.spec.ts:226` 与 `:331` 跑到真实结论并转绿；`:308`（A19）保持绿
- [ ] 票下**指名回答** `5ed00f453` 的浏览器验证腿结论（绿／红＋红在哪），这是关票的必要条件
- [ ] 门后新露出的红逐条归类（属 `5ed00f453` 域／属他域另开票），不得笼统记作「已修」
- [ ] **变异反证**：把播种去掉 ⇒ 两条用例必须回到 `INVALID_STATE` 红。改后立即还原，终态 `git status --porcelain` 空

## 留痕

- 开票：W4-D 三轮浏览器验收判为 fixture 缺口且**阻断在触达 `5ed00f453` 验证点之前**，主控 2026-08-10 派 review-memory 落票并要求票面写明这条阻塞关系。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：逐条只读核证拒绝原文（两次）、抛出点（`composer-submission-gate.ts:836`）、slot 声明处（`launch-seeds.ts:126`）、以及 `5ed00f453` 的改动面（三个文件，含 `publish-handoff.test.ts` 故**有单测背书、无浏览器背书**）。据此把票面重心从「补 fixture」移到「解锁一次至今无端到端证据的交付修复」，并把「门后新露出的红是发现不是回归」写成验收要求，避免复跑时被误判成回归而回退 `5ed00f453`。另记：唯一通过的 `:308` 不经提交，不能当作交付链已验证的旁证。本 commit 零代码改动。
