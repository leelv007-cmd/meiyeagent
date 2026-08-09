# V31-30 — P1 route mock 信封诚实性（`{ data }` 缺 `meta` 让覆盖缺口伪装成通过）

**Parent**: `docs/reviews/v31-p1-route-mock-envelope-note-2026-08-09.md`（由 `docs/reviews/v31-spec-assertion-audit-2026-08-09.md` §1.4 拆出）；合同判据 `packages/contracts/src/api-envelope.ts`；纪律 D-150③ 假绿三禁（`docs/ops/agent-dispatch-runbook-2026-07-29.md:39`）
**批次**: Wave 3（与 V31-29 同类纪律、**不同类别**：V31-29 改共享 fixture 的断言，本票改各 spec 的 route mock 形状）
**Blocked by**: None — 纯测试侧改动，不依赖任何合并后 runtime。**AC4 需要一次产品决策**（见该条）
**Status**: open — 2026-08-09 由 L-CI 开票，未开工

## What to build

`page.route(...).fulfill({ json: { data: … } })` 这种形状**不满足 P1 信封合同**，调用面拿到的不是数据而是异常。
于是 mock 想验的东西根本没被验，测试却是绿的。headline 是
`mkfast-template-main/tests/e2e/specs/composer-conversation-deletion.spec.ts:81`：
它 mock 403 + `CAPABILITY_DENIED` 的失败分支却漏了 `meta`，
**`CAPABILITY_DENIED` 因此永远到不了 UI**——这条 test 想验「无权限时商家看到拒绝」，
实际验的是「信封坏了时页面不炸」。**一个真实的覆盖缺口，伪装成通过的测试。**

### 机制（逐环实测，非推测）

1. `packages/contracts/src/api-envelope.ts:84-86` — `apiMetaSchema` 要求 `correlationId` 为
   `z.string().trim().min(1)`，**必填非空**。
2. 同文件 `:101-103` — `apiSuccessSchema` = `z.object({ data, meta }).strict()`；
   `:88-99` 的 `apiFailureSchema` 同样 `.strict()` 且 `meta` 必填；`:105-107` 的
   `apiEnvelopeSchema` 是两者 union——**success 与 failure 两支都要 `meta`**。
3. `mkfast-template-main/src/p1/client.ts:90-97` — `readP1Envelope` 用
   `apiEnvelopeSchema(dataSchema).safeParse(body)`，parse 失败即抛
   `P1RequestError('… Response envelope was invalid.')`，**在读到 `error.code` 之前就抛**。

所以缺 `meta` 的 mock 渲染出的是空态（taskId 恒 null、计数恒 0、列表恒空）或通用错误，
读起来像产品缺陷，实际是 mock 形状不合合同。

正确形状（两支都要带）：

```ts
await route.fulfill({
  json: { data: payload, meta: { correlationId: 'e2e-<something>' } },
});
await route.fulfill({
  status: 403,
  json: {
    error: { code: 'CAPABILITY_DENIED', message: '…' },
    meta: { correlationId: 'e2e-<something>' },
  },
});
```

### 已确认命中（2026-08-09 L-CI 静态实测：端点的 reader 已逐个确认经 `readP1Envelope`）

| 位置 | fulfill 数 / 带 `meta` 数 | 说明 |
|---|---|---|
| `specs/composer-conversation-deletion.spec.ts:54,58,62,68,92` | 6 / 0 | success 分支全缺 `meta` |
| `specs/composer-conversation-deletion.spec.ts:81` | （同上计数内） | **failure 分支也缺 `meta`——headline** |
| `specs/admin-dashboard-shell.spec.ts:141,149,178,223,257,301` | 6 / 0 | success 分支全缺 `meta` |
| `specs/uiux-creation-loop.spec.ts:256,266` | 2 / 0 | `harness/recommendation` 与 `p1/query` 各一 |
| `specs/w02-five-step-intake.spec.ts:297` | 1 / 0 | `p1/commands` |
| `specs/composer-card-family.spec.ts:508,553` | 2 / 0 | **本轮新确认**（原 note 列为「未确认」） |

`composer-card-family.spec.ts` 两处打的是 `/api/core/p1/harness/tasks/*/interaction`，
经 `harness-client.ts:163-173`（`readPendingHarnessInteraction`）→ 同文件 `:324-330` 的
`readEnvelope` → `readP1Envelope`，**确定走严格信封**，因此从「未确认」升为 finding。

### 已排除（原 note 的 11 处「未确认」实测归零）

`specs/marketing-composer-harness.spec.ts` **不是命中**：该文件 18 处 `route.fulfill` 中
17 处带 `meta.correlationId`；唯二不带的 `:230` 与 `:600` 打的是
`/api/core/p1/workflows/*/events`，用的是 `contentType: 'text/event-stream'` ＋ `body:` 的
SSE 帧，**根本不是信封 JSON**，形状正确。该文件 `:18` 的文件头注释本就写明它按整个信封
（含 `meta.correlationId`）来构造。**原 note 列的 11 处未确认位置，本轮实测全部不是缺陷。**

### 只补 mock 不足以让 headline 成立（本票最重要的发现）

原 note 建议的验收是「403 用例必须断到 `CAPABILITY_DENIED` 真的到达 UI」。
**实测：即使把信封补对，这条也做不到**——错误码在 UI 层结构性不可观测：

- `mkfast-template-main/src/product/canonical-history-page.tsx:317` — `deleteError` 是
  `useState(false)`，**一个布尔**，装不下错误码。
- 同文件 `:337` — `catch {}` **裸接并丢弃整个错误对象**。
- 同文件 `:509-512` — 只渲染一条与错误码无关的固定文案
  `canonical_history_conversation_delete_error`＝「没能删掉这次对话。请确认当前账号有权限并检查网络后重试。」
  （`project.inlang/messages/zh.json:1737`）。该文案把「无权限」和「网络问题」写在同一句里。

也就是说 `CAPABILITY_DENIED` 是**双重不可达**：①mock 信封无效，reader 在解析出 code 前就抛；
②即使信封正确，页面也丢弃 code 并渲染同一句话。**修 mock 只解决 ①。**
断言层面的后果是：无论怎么补 mock，e2e 都无法凭 alert 文案区分「无权限被拒」与「信封坏了」——
这正是这条 test 今天为什么能假绿。**所以本票不能承诺「断到 CAPABILITY_DENIED 到达 UI」**，
必须先有一次产品决策，见 AC4。

## Acceptance criteria

- [ ] AC1 信封补齐：上表 5 个 spec 文件共 17 处 `route.fulfill` 全部补 `meta.correlationId`（success 与 failure 两支都补），`marketing-composer-harness.spec.ts` **不在范围内**（已实测排除，不得顺手改）
- [ ] AC2 行为为证：对每个被修的 spec 文件，给出「修复前的通过是假绿」的证据——即在补 `meta` 之前，把该 mock 应当喂给页面的数据换成一个**明显错的值**（例如列表塞入不存在的条目名），spec 仍绿；补 `meta` 之后同样的错值让 spec 变红。这证明的是「mock 的内容此前从未到达页面」，比只跑健康路径强
- [ ] AC3 headline 覆盖缺口收口：`composer-conversation-deletion.spec.ts` 的 403 用例必须验到「失败的原因是权限被拒」而非「页面没崩」。至少要断到：命令确实被发出、且**没有**发生 envelope-invalid（后者可由「补 `meta` 前后行为不同」证明）
- [ ] AC4 **产品决策（本票需先取得裁决，勿自行拍板）**：`CAPABILITY_DENIED` 是否应在删除失败时给商家不同的说法。三条路走哪条——(a) 让 `deleteError` 承载错误码并为拒绝给单独文案（改产品，`canonical-history-page.tsx` 归属属主）；(b) 保持一条通用文案，本票只收口 mock 形状并**在 spec 里显式写明「此处不区分错误码，因为产品不区分」**；(c) 判定当前通用文案已足够而 test 名过度承诺，改 test 名。**默认建议 (b)**：本票是测试诚实性票，把产品改动挟带进来会让爆炸半径失控；但 (b) 必须把「不区分」写成显式注释，否则下一个人会再把它读成覆盖
- [ ] AC5 机器可判的门（形状对齐 `scripts/ci/root-script-contract.test.mjs`：静态、装机无关、失败信息指名）：新增 `scripts/ci/e2e-p1-envelope-contract.test.mjs`，扫 `mkfast-template-main/tests/e2e/**/*.ts` 内所有 `route.fulfill`，若同一 fulfill 的 `json` 含 `data` 或 `error` 而不含 `meta`，即红并打印 `file:line`。**必须显式豁免 `contentType: 'text/event-stream'` 的 `body:` 型 fulfill**（否则会把 `marketing-composer-harness.spec.ts:230,600` 这两处正确的 SSE 判成违规——一个会误报的门早晚被删）
- [ ] AC6 该门自带先红后绿：一条负向 fixture（缺 `meta` 的 `{ data }`）必须红，一条正向 fixture（带 `meta`）与一条 SSE fixture 必须绿；并把新门登记进 `SCRIPT_GATE_FAMILIES`（它已是 `scripts/ci/*.test.mjs` 家族成员，无需改 root `test`）
- [ ] AC7 假绿三禁（D-150③）：改完的 test 名／断言消息与实际断言内容一致；不得留「页面没崩」这类可涵盖失败的措辞

## Blocked by

- None（测试侧改动）。但 **AC4 需主控／属主先裁决**，AC3 的终态措辞取决于该裁决结果。

## 边界与协调

- 本票拥有上表 5 个 spec 文件的 **route mock 形状**，以及新增的 `scripts/ci/e2e-p1-envelope-contract.test.mjs`。
- **不拥有** `mkfast-template-main/src/product/canonical-history-page.tsx`——AC4 若走 (a)，该改动另开票给属主，不在本票内动手。
- **不拥有** `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts`——那是 V31-29 的范围。两票可并行：本票只碰 `*.spec.ts` 的 mock，V31-29 只碰 fixture，无文件重叠。
- `{ data }` 形状对 Wave 3 新建的 5 个 §37.4 spec 是 **do-not-introduce**：从邻近 spec 复制 mock 模式会直接踩中。AC5 的门落地后即可机器拦住。
- 9 个 `v31-*.spec.ts` 内 route interception 数量为 **0**（实测），V31 spec 面在这一项上干净，本票不涉及它们。

## 背景记录

- 2026-08-09 L-CI 静态审计产出，本轮**未跑 Playwright、未起 dev server**；上文全部结论为静态判定＋逐环读源码确认，行为为证归本票实施阶段。
- **对 parent note 的三处更正（L-CI 自陈，恢复班次实测）**：
  1. `composer-card-family.spec.ts` 从「未确认」升为 finding，行号由 note 的 `:501,521` 更正为实测 `:508,553`。
  2. `marketing-composer-harness.spec.ts` 的 11 处「未确认」**全部排除**（16 处信封 mock 均已带 `meta`，唯二不带的是 SSE 帧）。note 当时的措辞是「若干处 meta 计数与 data 计数接近相等」，实测结论比这更干净。
  3. `admin-dashboard-shell.spec.ts` 实测为 **6** 处 fulfill（note 漏列 `:257`）。
- **对 parent note 建议验收的更正**：note 的第 2 条建议（断 `CAPABILITY_DENIED` 到达 UI）在只改测试的前提下不可达，理由见上文「只补 mock 不足以让 headline 成立」。本票据此把它拆成 AC3＋AC4。

## Evidence

> 空表由 L-CI 开票时落盘，**实施 lane 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |
| AC6 | — | — | — | — | — | — | — |
| AC7 | — | — | — | — | — | — | — |
