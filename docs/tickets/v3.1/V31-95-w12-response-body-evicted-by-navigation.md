# V31-95 — w12 在 `goto` 前注册 `waitForResponse`，导航丢弃响应体导致间歇红

**Parent**: W12 identity journey
**批次**: 门稳定性（P1，直接影响 required 可用性）
**Blocked by**: 无
**Related**: V31-91、V31-92、V31-93（required 内其余间歇红）

**Status**: open（2026-08-15）— 间歇已确证（同一 shard 组成，1 绿 1 红）；机制为**假设**未实证，判别器已给出；顺带记录 shard 串行导致的「未评价」放大效应

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31895336236（`3532c45df`，绿）、31897952510（`0c80ee0e2`，红）

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

两轮 shard 组成相同。`0c80ee0e2` 的产品改动是 V31-93 的 Composer 胶囊受控化
（`composer-conversation.tsx` / `composer-home.tsx`），与本 spec 断言的
`/api/core/p1/query` 响应体读取**无因果面**——但**仅一个红样本，尚不能完全排除**，
须再取样（见「下一步」）。

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

谓词只匹配「POST + 路径 + postData 含 `store_facts_active`」，**不区分它属于哪一次导航**。
若导航**之前**的页面已有一个同形状查询在飞，它会先匹配上；`goto` 一提交，
旧页面的网络资源被丢弃，`getResponseBody` 便找不到该 body——**报错正是这一句**。

注意红的不是 `waitForResponse` 超时（那会是 timeout 报错），而是 body 读取失败，
说明**响应确实匹配到了、只是体已被回收**。这与上述假设一致，但不构成证明。

**判别器（成本极低）**：在 `.json()` 之前打印 `activeFactsSettled.request().frame().url()`
与 `page.url()`。两者不一致即坐实「匹配到了导航前的那一发」。

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

- [ ] 判别器结论写入本票（匹配到的是哪一次导航的请求），不是「疑似」
- [ ] 修法对应结论，且不使用 try/catch 重试掩盖
- [ ] `w12-identity-draft-assistant` 连续 ≥3 轮 required 绿
- [ ] 若最终判定与 V31-93 的改动有关（目前无因果面），须在本票与 V31-93 双向记录
