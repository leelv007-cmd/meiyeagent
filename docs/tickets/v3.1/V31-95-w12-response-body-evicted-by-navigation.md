# V31-95 — w12 在 `goto` 前注册 `waitForResponse`，导航丢弃响应体导致间歇红

**Parent**: W12 identity journey
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-91、V31-92、V31-93（required 内其余间歇红）

**Status**: open（2026-08-15）— 间歇已确证（1 红 2 绿）；**已确证缺陷＝谓词有歧义**（`/dashboard` 上两个生产者都命中，测试拿的是先到的那一发）；回收机制的第一版假设**已自我推翻**，剩三个候选待判别器收敛；顺带记录 shard 串行导致的「未评价」放大效应

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31895336236（`3532c45df`，绿）、31897952510（`0c80ee0e2`，红）、31899526724（`6505e70a1`，绿——产品代码同 `0c80ee0e2`）

## 现象

`production-main-journey` 的 composer shard 红：

```
[chromium] w12-identity-draft-assistant.spec.ts:116
  › one line and a reference become a draft the merchant still has to校对
Error: response.json: Protocol error (Network.getResponseBody):
       No resource with given identifier found
  at w12-identity-draft-assistant.spec.ts:180:59
```

## 判为间歇

| Run | SHA | composer shard（w12 ＋ xhs-image-text ＋ v31-memory-injection-b2） |
|---|---|---|
| 31895336236 | `3532c45df` | 3 passed |
| 31897952510 | `0c80ee0e2` | **1 failed / 2 passed**（红的是 w12） |
| 31899526724 | `6505e70a1` | 3 passed |

三轮 shard 组成相同。`0c80ee0e2` 的产品改动是 V31-93 的 Composer 胶囊受控化
（`composer-conversation.tsx` / `composer-home.tsx`），与本 spec 断言的
`/api/core/p1/query` 响应体读取无因果面。

**已排除该改动**：`6505e70a1` 的产品代码与 `0c80ee0e2` **完全相同**（差异仅文档），
w12 在该轮通过。故判为间歇，与 V31-93 修复无关。

## 已确证的缺陷：谓词本身有歧义（与回收机制无关，独立成立）

`/api/core/p1/query` ＋ `store_facts_active` 这个形状在仓里**有四个生产者**：

| 生产者 | 所在页面 |
|---|---|
| `composer-home.tsx:602` | `/dashboard` |
| `today-recommendation-card.tsx:416` | `/dashboard` |
| `store-intake-wizard.tsx:278` | 门店录入向导 |
| `workspace-assets-page.tsx:62` | 素材页 |

谓词只看「POST ＋ 路径 ＋ postData 含 `store_facts_active`」，**光 `/dashboard` 上就有
两个生产者能命中**。也就是说这条断言拿到的是「先到的那一发」，**测试作者无法指定
它想断言哪一个**。这一条无需任何运行证据即成立，且不论回收机制是什么都该修。

## 机制（假设，未实证）

```ts
const activeFactsResponse = page.waitForResponse(       // 171：先注册
  (r) => r.request().method() === 'POST' &&
         r.url().includes('/api/core/p1/query') &&
         r.request().postData()?.includes('store_facts_active') === true,
  { timeout: 60_000 }
);
await page.goto('/dashboard');                          // 178：后导航
const activeFactsSettled = await activeFactsResponse;   // 179
const activeFactsEnvelope = await activeFactsSettled.json();  // 180 ← 红在这里
```

注意红的不是 `waitForResponse` 超时（那会是 timeout 报错），而是 body 读取失败，
说明**响应确实匹配到了、只是体已被回收**。

### 已被推翻的第一版假设（2026-08-15 自我更正，勿重走）

初稿写的是「导航**之前**的向导页那一发先匹配上，`goto` 一提交旧页面资源被丢弃」。
**该假设不成立**：

- 向导保存后确实会自己重取 `store_facts_active`（`store-intake-wizard.tsx:418`
  的 `storeFacts.refetch()`，在 `mutationFn` 的 `await Promise.all([...])` 里）；
- 但 `saved` 是 `onSuccess: () => setSaved(true)`（`:430`）置的，而 `onSuccess`
  在 `mutationFn` **resolve 之后**才跑——也就是说测试等到
  `store-intake-saved` 可见时（w12:167-169），**向导那一发早已完成**，
  不可能在 :171 注册之后再匹配。

### 尚存的候选（均未验证，不要挑一个当结论）

1. **匹配到的请求被中止**：两处 dashboard 查询都传了 `signal`
   （`composer-home.tsx:610` / `today-recommendation-card.tsx`），react-query 在
   卸载或 queryKey 变化时会 abort。`composer-home.tsx:602` 的 key 含 `workspaceId`，
   而它从 `''` 变为真值——若一发已在飞时 key 变化被 abort，**响应到了但体被丢弃**，
   与观察到的报错一致；
2. `goto('/dashboard')` 之后页面又发生了一次导航／重载，旧文档的资源被回收；
3. 命中的是 `today-recommendation-card` 那一发，而它随后被卸载。

**判别器（成本极低，一次跑就能收敛）**：在 `.json()` 之前打印
`activeFactsSettled.url()`、`activeFactsSettled.request().frame().url()`、
`page.url()`，以及 `activeFactsSettled.request().failure()`。
frame 与 page 不一致 ⇒ 候选 2；`failure()` 非空 ⇒ 候选 1。

## What to build（先取证，勿猜修）

1. 先加判别器跑一轮，确认匹配到的是哪一次请求；
2. 据结论择一：
   - 若确为导航前的旧请求 → 谓词加 frame/导航归属条件，或把注册挪到
     `goto(..., { waitUntil: 'commit' })` **之后**；
   - 若是导航后的正确请求但体仍被回收 → 改为**即时读体**（拿到 response 立刻 `json()`，
     不要在其间再做会触发导航的动作）。
3. **不要**给 `.json()` 加 try/catch 重试——那会把「读到了错误的那一发」也一并吞掉，
   断言就不再钉住任何东西。

## 顺带记录：shard 串行放大「未评价」

`production-main-journey` 的各 shard 是串行链，前一个失败即
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`，**后续 shard 根本不执行**。

本轮实例：composer shard 因 w12 红 → **governance shard（含
`memory-vault-governance`）从未运行**，其状态是 `not_evaluated` 而非绿，
按 `docs/ops/current-project-status.md` §5 不得记为产品结论。

**含义**：任意一条抖动都会吃掉它后面所有 spec 的评价，这既放大了门的不可用感，
也让「修复是否生效」难以在一轮内证完。是否值得让 shard 之间互不阻塞（各自记账、
最后汇总），建议单独评估——本票只记录事实，不在此处拍板。

## Acceptance criteria

- [ ] **谓词不再有歧义**：断言指向的必须是某一个确定的生产者（这条与回收机制无关，可先做）
- [ ] 判别器结论写入本票（匹配到的是哪一次请求、是否被 abort），不是「疑似」
- [ ] 修法对应结论，且不使用 try/catch 重试掩盖
- [ ] `w12-identity-draft-assistant` 连续 ≥3 轮 required 绿
- [ ] 若最终判定与 V31-93 的改动有关（目前无因果面），须在本票与 V31-93 双向记录
