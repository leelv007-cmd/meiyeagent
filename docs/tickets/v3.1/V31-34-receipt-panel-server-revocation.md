# V31-34 — 注入 receipt 面板的撤销态无服务端来源（刷新即忘）

**Parent**: spec-E（#5）；权威 V3.1 §12.7、§37.4-B2
**Lane**: Web / agent-workbench 面板域
**Blocked by**: —
**Status**: open

## What to build

`MemoryInjectionReceiptPanel`（`mkfast-template-main/src/product/memory-injection-receipt.tsx:26`）的撤销态来自本地 `useState`：

```ts
const [revokedIds, setRevokedIds] = useState<ReadonlySet<string>>(new Set());
```

`setRevokedIds` 只在 `revoke.mutate` 的 `onSuccess` 里追加（`:53`），**从不从服务端派生**。渲染时 `const revoked = revokedIds.has(entry.memoryId)`（`:78`）决定按钮 `disabled` 与「已撤销」文案（`:96-105`）。因此：商家点「撤销」→ 看到禁用+已撤销 → 刷新页面 → 按钮**回到可点、文案回到「撤销」**，尽管服务端该 memory 确实已不再是 confirmed。撤销在视觉上消失了。

要做的是让面板的撤销态有服务端来源：receipt 本身是不可变 trace（正确，不该改），所以撤销态要从 memory 侧读（`entries_page` 的 status，或为 receipt 面板补一个按 memoryId 批量查当前 authority 的 query），并让 `disabled`/已撤销 由它派生而非由本地 mutation 结果派生。

## 与 B2 spec 的关系（**spec 的沉默是故意的**）

L-T4 在重写 `tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts`（V31-18 P1-6）时发现此缺陷，并**刻意不写刷新后断言**。原话录入如下，供浏览器波知道该沉默是设计而非遗漏：

> The disabled button and the 已撤销 label are local optimistic state:
> `MemoryInjectionReceiptPanel` seeds `revokedIds` from `useState(new Set())` and
> never derives it from the server (`src/product/memory-injection-receipt.tsx:26`),
> so the panel forgets the revocation on reload. These two assertions are
> therefore scoped to what they can honestly prove — that the click produced
> local feedback — and the durable proof is the server query and the next task's
> receipt below. Asserting them again after a reload would encode a guarantee the
> product does not currently make.

即：spec 当前只就地断言「被撤销条 disabled、幸存条仍 enabled」，持久证据走 `entries_page` 服务端断言 + 下一个任务的 receipt（正向含幸存条、被撤条 0 条）。**本票修完后**，spec 可以升级为「刷新后被撤销条仍 disabled + 仍显示已撤销」，那一行断言就是本票的验收面。

## Acceptance criteria

- [ ] 面板撤销态从服务端派生，刷新后保持（不再依赖 mutation 结果的本地 Set）
- [ ] 幸存记忆仍可撤销（禁止整体 disable 蒙过断言）
- [ ] receipt 作为 trace 保持不可变，撤销不改写 receipt 行
- [ ] B2 spec 加上「刷新后仍 disabled + 仍显示已撤销」断言，并移除上面那段解释性注释

## Evidence

| # | 证据 | 落点 | 结论 |
|---|---|---|---|
| | | | |
