# V31-51 — day0 旅程「商家确实没有门店」的缺席编码漂移（`null` vs `undefined`）

**Parent**: V3.1 §37.4-A Day-0 自由创作（`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md:1765`）
**批次**: 收尾（独立缺陷，不共享文件）
**Blocked by**: None
**Related**: V31-29（e2e fixture 真实性）——本票的判据直接用它那条纪律：**不许靠放松断言把红改绿**
**Status**: fixed (product projection emits `store: null`; Chromium precondition green 2026-08-11)

## 缺口（一句话）

day0 旅程的**诚实前置条件**「商家真的没有门店」断言 `toBeNull()`，实收 `undefined`。三轮稳定复现，与 admission 家族无关。

> **锚署树**：`2da11d5ab`（W4-D round3 证据树）。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | 断言与实收值 | `scratchpad/w4d/round3-per-spec/v31-day0-free-creation-journey.log:171-177`：`expect(received).toBeNull()` / `Received: undefined` / `> 109 \| expect(initial.store).toBeNull();` |
| 2 | 断言所在（含它自己的注释，说明这是**前置条件**不是被测行为） | `mkfast-template-main/tests/e2e/specs/v31-day0-free-creation-journey.spec.ts:107-109`：`// Honest precondition: the merchant really has no store.` ＋ `const initial = await productState(page);` ＋ `expect(initial.store).toBeNull();` |
| 3 | 取值来源 | `mkfast-template-main/tests/e2e/fixtures/product.ts:45` `export async function productState(page)` |
| 4 | 三轮稳定 | W4-D 终表第二节 A 行「三轮稳定复现，与 admission 无关」；round3 `SUMMARY.txt` 该 spec `exit=1 fail=[1 failed]` |

## 这不是「把 toBeNull 改成 toBeFalsy」就完事的题

**先说清它为什么值得一张票**：`null` 与 `undefined` 在这里不是风格差异，而是**两种不同的语义**——

- `store: null` ＝ 投影**明确表示**「查过了，没有门店」；
- `store` 缺席（`undefined`）＝ 投影**根本没提这件事**。

day0 旅程的整个前提是「商家确实没有门店，且系统知道这件事、不因此阻断创作」。如果投影只是**没提**门店，那么「系统知道商家没门店」这个前提**从未被证明**——它可能是没查、可能是字段名改了、也可能是投影在某个分支上早退。把断言放松成 `toBeFalsy()` 会让这三种情况一起变绿，而其中两种是真缺陷。这正是 V31-29 那条纪律要挡的形状：**一条在产品坏掉时也照样通过的断言不算覆盖**。

## What to build

**先定契约，再改代码**。要裁的是一个问题：**「没有门店」在 product state 投影里的合法编码是哪一种？**

- 若定 `null`：产品侧（投影/`productState` 所消费的那个 query）必须**显式产出** `store: null`，而不是省略键。
- 若定「缺席」：spec 的断言改成断言**缺席本身**（例如 `expect('store' in initial).toBe(false)`），并且**必须同时断言一个正向事实**证明投影确实跑过（例如同一投影里另一个必然存在的字段有值），否则「缺席」与「投影没跑」无法区分。

**禁止**的修法：把 `toBeNull()` 换成 `toBeFalsy()` / `toBeUndefined()` 而不定契约——前者放宽到能容纳缺陷，后者只是把断言挪到另一侧同样没定契约。

## Acceptance criteria

- [x] 「没有门店」的编码在**契约层**被定下：选 **`store: null`**（显式查过且无门店）。理由：缺席无法证明投影跑过；`null` 是「系统知道没有门店」。落点：`ProductState.store?: StoreProfile | null` 注释 + `initialState`/`normalizeState`/`rebuildProductStateFromRelationFacts` 恒写 `store: null`。
- [x] `v31-day0-free-creation-journey.spec.ts` 断言 `Object.hasOwn(store)` + `toBeNull()` + `workspaceId` 正向事实 — 2026-08-11 前置条件段绿
- [x] 该断言区分「明确没有」与「投影没跑」：同时断言 `workspaceId` 与 `Object.hasOwn(initial, 'store')`
- [ ] **变异反证**：让投影在门店查询前早退（或把字段改名）⇒ 该断言必须转红。改后立即还原，终态 `git status --porcelain` 空（主控可选终验）
- [ ] day0 **整条**绿：store 前置已过；后续 free 提交卡在「确认本次创作 / 确认并开始」与 `composer/submissions` waitForResponse 120s — **独立于 V31-51 编码**，另记为 free-mode 确认/提交路径债

## 边界

- 只碰「没有门店」这一个字段的缺席编码。**不要**顺手把 product state 投影里其他字段的 `null`/缺席一起规范化——那是独立的一次性改动，若发现同族问题**记录不动手**，报给主控另开。

## 留痕

- 开票：W4-D 三轮浏览器验收判为独立缺陷（与 admission 家族无关），主控 2026-08-10 派 review-memory 落票。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：锚点逐条只读核证（断言在 `:109`，其上 `:107` 的注释自陈是「Honest precondition」，取值经 `fixtures/product.ts:45` 的 `productState`）；把票面从「断言值不符」升格为**缺席编码的契约问题**，并写明禁止放松断言的理由（`null`＝已知没有／缺席＝没提，后者无法证明前提成立）。本 commit 零代码改动。
