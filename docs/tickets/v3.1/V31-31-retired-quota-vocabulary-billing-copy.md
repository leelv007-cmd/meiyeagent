# V31-31 — 退役额度词汇的计费侧收口：billingNotice 无消费者孤儿 ＋ legacy video 退款标签

**Parent**: 无（V3.1 全量修复主控轮 L-S0 lane 副产，2026-08-09）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: open

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## 决策锚

- **D-172**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3534`）：三桶（文案／图片／视频）额度停止作为商家计费单位，计费改积分制。商家可见文案一律以「分／积分」计量。
- **D-150**（同文件 `:2426`，消费者证明关票门）：「后端建满、无人消费」是须治理的失效模式。本票头号项正是这一形态——一条**计费口径声明**被生产出来却无人读。

## 本票由来

`mkfast-template-main/src/product/merchant-language-audit.test.ts` 的审计根原先只覆盖 Core 的 `p1/harness`，真盲区是 `p1/agent-session`（9 个非测试文件带出站 CJK 文案）。2026-08-09 换机制＋扩根后，新增的「全量 `apps/core/src` 退役单位台账」扫出两处存量 `额度` 文案。二者**已在 `CORE_RETIRED_UNIT_DEBT` 中显式登记为债务**（不是豁免：该常量被断言为 Core 全域 offender 的**精确**集合，新增一处即红）。本票是把债务还掉。

## 任务

### 项 1（头号）：`billingNotice` — 退役词汇 ＋ 无消费者

`apps/core/src/p1/integrations/application-service.ts:1241-1242`（BYOK integrations 投影）生产：

```
billingNotice: '本次调用消耗产品文案额度；模型供应商费用由工作区 Key 对应账户另行结算。'
```

两重问题：

1. 以退役的 `额度` 计量，违反 D-172。
2. **无任何产品消费者**——`mkfast-template-main/src` 全域 grep `billingNotice` 只命中审计测试自身的注释，没有渲染方。这是 D-150 形态的孤儿字段，且它承载的是一条**计费口径声明**（告诉商家这次调用花了什么、供应商费用怎么结算），孤儿化的代价不是少一行字，是 BYOK 商家在界面上得不到费用归属的交代。

   **精确口径（实施前必读，勿把「孤儿」读成「无人引用」）**：该字段确有两处非渲染引用，删除路径必须一并处理——
   - `apps/core/src/p1/integrations/foundation-byok-ledger.test.ts:179`：`assert.match(options.billingNotice, /供应商/)`。这是**测试断言，不是 D-150 意义上的消费者**（测试不是商家看得到的面），但删字段会红这条，须同步删断言。
   - `getStrictByokOptions` 查询把它连同 profiles/usage 一起回传（见 `docs/ledgers/contentpackage-productization/tickets/03-byok-real-execution.md:47`），即它**在投影上出得去**，只是 Web 不读。所以「保留」路径不需要新建传输接缝，只需要接渲染方。

**本票要做的决策**：给它一个真消费者并把文案改成积分制正确口径，或者删除该字段。二者都可接受，但**必须择一并给出理由**——继续「生产但无人读」不是选项。若选保留，须按 D-150 给出消费者证明三段（core 命令／处理分支／写入或产出的渲染位）。

### 项 2（低优先）：legacy video 退款标签

`apps/core/src/product/product-service.ts:2949`（`job.step` 映射的 `failed` 分支）与 `:3231`：

```
failed: '技术处理失败，额度已退还'
job.step = '任务已取消，视频额度已退还'
```

可达性判定（L-S0 已亲验，逐条留痕）：

- `productCommandSchema` **确实**仍admit `cancel_video`（`packages/contracts/src/product-schema.ts:287`），命令过得了 wire。
- 但生产装配把 `legacyVideoPath` 钉死为 `'disabled'`（`apps/core/src/assembly/core-assembly.ts`，main 上 `:1363`）。
- 该档位在 `apps/core/src/product/product-service.ts:1160-1178` 以 `LEGACY_VIDEO_PATH_RETIRED` 整组拒掉 legacy video 命令集（含 `cancel_video`），**在任何标签写入之前**。

结论：**在已发布装配下这两条是不可达文案，不是活的对商家说谎**。因此低优先。登记在票内而非删除，是因为 `legacyVideoPath` 是一个档位而不是一次删除——档位一旦被翻开，文案就活了。

## 边界（明确不做）

- **禁止把 `额度` 直接换成 `积分`／`分` 了事。** `refund()`（`apps/core/src/product/product-service.ts:552-559`）转调 `releaseReservation(state, context, resource, reservationId)`，`resource: 'content' | 'image' | 'video' | 'package'`——它释放的是**桶预留**，不是积分。把文案写成「积分已退还」会让文案断言一次代码并未执行的退款。**这是计费域决策，不是文案编辑**；退款语义要不要迁到积分账本、迁法如何，属本票要拍的板，不能在文案层绕过。
- 禁止改弱或删除 `merchant-language-audit.test.ts` 的台账断言来换绿。债务还掉后从 `CORE_RETIRED_UNIT_DEBT` 移除对应条目即可——该文件另有一条测试断言「台账每条都仍真的带退役 token」，所以留着已还清的条目也会红。
- 本票不扩到 `p1/foundation` 的 `usage.copy/image/video/audio` 物理字段退役（xcheck Rev 2 §Out of Scope 的既有缓期项）；审计以「商家面不得读该投影」为边界，本票沿用。

## Acceptance criteria（行为为证）

- [ ] 项 1 已择一落地：**要么**该 `billingNotice` 有真渲染消费者且文案为积分制正确口径，并在票下给出 D-150 消费者证明三段 `file:line`；**要么**字段已删除且 `git grep billingNotice` 在 `apps/core/src` 与 `mkfast-template-main/src` 均无生产/消费残留（含 `foundation-byok-ledger.test.ts:179` 的断言同步删除）。
- [ ] 项 1 的口径正确性由行为断言背书，而非 grep：投影测试（或渲染测试）断言该文案不含 `额度／条数／三桶`，且其数字与实际计费单位一致（若保留数字）。
- [ ] 项 2 已择一落地：改写为与实际退款语义一致的口径，**或**随 legacy video 路径一并退役并从 `git ls-files` 证明删除。
- [ ] 若项 2 选择改写：改写后的文案所断言的退款行为与 `refund()` 实际释放的资源类型一致（桶 vs 积分），并有断言背书。
- [ ] `CORE_RETIRED_UNIT_DEBT`（`mkfast-template-main/src/product/merchant-language-audit.test.ts`）中已还清的条目已移除，该文件全量绿。
- [ ] Web 全量绿：`pnpm test`（node）＋ `pnpm test:interaction`（vitest）；Core 侧受影响套件绿。

## 验收证据

> 空表待实施 lane 填写。只填**已实证**的行，不预填预期值。表形制若与 V31-29/V31-30 落地后的约定不一致，以后者为准。

| 项 | 命令 | 结果 | 证据（file:line / commit） |
|---|---|---|---|
| 项 1 落地（消费者或删除） | | | |
| 项 1 口径行为断言 | | | |
| 项 2 落地 | | | |
| 台账条目移除后审计全绿 | | | |
| Web node 全量 | | | |
| Web interaction 全量 | | | |
| Core 受影响套件 | | | |

## 留痕

- 发现链：L-S0 lane（`codex/v31-s0-live`）2026-08-09。审计换机制＋扩根的提交见该分支；本票两处 offender 的可达性判定与 `refund()` 返桶结论由 L-S0 亲验，主控复核后裁决「开票、escalate 不 reword」。
- 行号锚点为 2026-08-09 状态；`legacyVideoPath: 'disabled'` 在 main 为 `core-assembly.ts:1363`、在 `codex/v31-s0-live` 为 `:1378`（S0 分支有前置改动）。实施时以符号定位为准，勿信行号。
