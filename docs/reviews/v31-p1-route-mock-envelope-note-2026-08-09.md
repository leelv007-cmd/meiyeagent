# P1 route mock 信封形状：`{ data }` 缺 `meta` 会呈现为「产品 bug」

- 出处：`docs/reviews/v31-spec-assertion-audit-2026-08-09.md` §1.4 拆出独立成篇（主控要求：**与 fixture 诚实性票不同类别，不埋在票里**）
- 结论范围：**静态判定**。本轮没有跑 Playwright，没有起 dev server（L-CI 无浏览器／PG 额度）
- 归属：**尚未开票**。V31-29 明确把本文档排除在其范围外；是否单独开票由主控决定

## 机制（已逐环确认，非推测）

1. `packages/contracts/src/api-envelope.ts:84-86` — `apiMetaSchema` 要求 `correlationId` 为
   `z.string().trim().min(1)`，即**必填非空**。
2. 同文件 `:101-103` — `apiSuccessSchema` 是 `z.object({ data, meta }).strict()`；
   `:105-107` 的 `apiEnvelopeSchema` 是 success／failure 的 union，两支都带 `meta`。
3. `mkfast-template-main/src/p1/client.ts:90-98` — `readP1Envelope` 用
   `apiEnvelopeSchema(dataSchema).safeParse(body)`，parse 失败即抛
   `P1RequestError('… Response envelope was invalid.')`。

因此 `route.fulfill({ json: { data: … } })` 这种形状**不会「返回数据」**：调用面拿到的是
异常，渲染出空态（taskId 恒 null、计数恒 0、列表恒空）。读起来像产品缺陷，实际是 mock
形状不合信封合同。runbook 记载的三次「给人读的细节写进了给机器判的字段」是同一类事故的
不同变体——这里是「给人看的 mock 省了机器要校验的字段」。

正确形状（success 与 failure 都要带）：

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

## V31 spec 面：干净

9 个 `v31-*.spec.ts` 内 **route interception 数量为 0**（`grep -n "route\.\|page.route\|fulfill\|unroute"`
无命中）。主旅程不 mock 这一条目前成立。**`{ data }` 形状列为 do-not-introduce**：Wave 3 新建
5 个 spec 时若从邻近 spec 复制 mock 模式，会直接踩中。

## 已确认命中（走 `/api/core/p1/query`｜`/commands`，确定经 `readP1Envelope`）

| 位置 | 说明 |
|---|---|
| `specs/composer-conversation-deletion.spec.ts:54,58,62-64,68` | success 分支缺 `meta` |
| `specs/composer-conversation-deletion.spec.ts:81-89` | **failure 分支也缺 `meta`** —— 见下 |
| `specs/admin-dashboard-shell.spec.ts:141-160,178,223,301` | success 分支缺 `meta` |
| `specs/uiux-creation-loop.spec.ts:255-267` | success 分支缺 `meta` |
| `specs/w02-five-step-intake.spec.ts:293` | success 分支缺 `meta` |

**`composer-conversation-deletion.spec.ts:81-89` 是这批里最值得单独点出的一处**：它 mock 的是
403 + `CAPABILITY_DENIED` 的失败分支，但同样漏了 `meta`。于是 `apiFailureSchema` 也 parse 不过，
`CAPABILITY_DENIED` **永远到不了 UI**——调用面只会拿到「envelope was invalid」。
这条 test 想验的是「无权限时商家看到拒绝」，实际验的是「信封坏了时页面不炸」。
**一个真实的覆盖缺口，伪装成通过的测试。**

## 未确认（保留区分，不当 finding）

以下 11 处命中走的是 harness／workflows 端点，**是否经 `readP1Envelope` 我没有逐条确认**，
因此不作为 finding，只作为施工须知：

- `specs/composer-card-family.spec.ts:501,521`
- `specs/marketing-composer-harness.spec.ts:139,153,215,368,387,401,470,484,588`

（其中 `marketing-composer-harness.spec.ts` 的若干处 `meta` 计数与 `data` 计数接近相等，
说明该文件多数 mock 已带 `meta`；逐条判定需要读每个端点的 reader，属下一步工作。）

## 若要开票，建议的范围与验收

1. 范围＝上表「已确认命中」5 个文件的 P1 mock 信封补齐（success 与 failure 两支都补）。
2. 验收＝行为为证：`composer-conversation-deletion` 的 403 用例必须断到
   `CAPABILITY_DENIED` 真的到达 UI（修复前断不到），而不是只断页面没崩。
3. 顺带加一条机器可判的门：e2e 目录内任何针对 `/api/core/p1/*` 的 `route.fulfill`
   若含 `data` 或 `error` 而不含 `meta.correlationId`，静态检查即红。
   （形状与 `scripts/ci/root-script-contract.test.mjs` 同类：静态、装机无关、失败信息指名。）
4. 未确认的 11 处先做归类调查，再决定是否纳入同票。
