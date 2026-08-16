# V31-104 — `p2-browser-acceptance` 里两条 spec 五次恒红，且在零代码 diff 上照样红：无人认领，待定性

**Parent**: 门可靠性（V31-70 的邻票，但不是同一件事）
**批次**: 定性优先（先判是什么，勿猜修）
**Blocked by**: 无
**Related**: V31-70（同门的 workerd 仪器故障——**是另一回事，别混**）、V31-96（被该门截断的受害者）

**Status**: open（2026-08-16）— 五次观测五红、失败的恒为同两条 spec；**两轮发生在纯文档 PR 上，第五次是同一 commit 的 attempt 2 重跑**，故与被合入的内容无关；是产品缺陷还是风暴级联**未定性**，本票就是去定这个性

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**: 31933812189 / 31935196137 / 31936621559 / 31938096567 / 31939952353(attempt 2)

## 事实（五次观测，2026-08-16）

| run | 触发它的 PR | 计数 |
| --- | --- | --- |
| `31933812189` | #17（含产品代码） | `3 failed / 4 did not run / 17 passed` |
| `31935196137` | #17 rebase 后 | `2 failed / 4 did not run / 17 passed` |
| `31936621559` | **#18，纯文档** | `2 failed / 5 did not run / 17 passed` |
| `31938096567` | **#19，纯文档** | `3 failed / 4 did not run / 17 passed` |
| `31939952353` **attempt 2** | **#20，纯文档**（同 run 重跑） | 同两条 spec（第五次观测，开票后补记；job `95153522135`） |

**五次观测里失败的 spec 文件恒为同两条**（`failed` 计数在 2~3 之间浮动，是文件内的用例数不同，不是文件不同）：

> 第五次那条尤其硬：它是 run `31939952353` 的 **attempt 2**，
> 即**同一个 commit、同一份代码重跑一遍**，两条照样红。
> 前四次靠「纯文档 diff」排除内容因素，这一次连 diff 都是同一个——
> 所以「与合入内容无关」这一点不再依赖任何推理。

```
p2-browser-closure.spec.ts:731:3
  › P2 direct Chromium closure (#320-#325)
  › viral chip uses honest paste fallback and authorized image through task experience morph to note Result

v31-ops-console-release-journey.spec.ts:249:3
  › V31 Ops Console real release journey
  › UI publish → canary routing → trial → promote → in-flight rollback
```

## 为什么单独立票

**1. 它们与被合入的内容无关，这一点已经被证到了。**
第三、四轮分别跑在 PR #18 和 #19 上，两个都是**纯文档 PR、零产品代码**，照样红。
所以不能按「谁合进去的谁负责」处理——没有人是它的作者。

**2. 也正因为如此，它一直没人认领。**
`p2-browser-acceptance` 是 advisory（不在 `required` 八条内，见 CI 门收缩决定），
所以它红了不挡合入，于是每一轮都被合理地跳过，五次下来没有任何人停下来看它。
**advisory 不等于可以永远不看**——本票就是把它从「背景噪音」里捞出来。

**3. 它与 V31-70 是两件事，别混。**
V31-70 是 workerd 仪器故障（`GATE INSTRUMENT FAILURE` + 「remaining specs NOT evaluated」），
那条已经在按它自己的验收推进。
本票是**得到了判决、并且判成红**的那两条——它们不在「did not run」里，是真的跑了、真的失败了。

## 已有线索（来自一份未提交的会话草稿，摘录后原件已删）

2026-08-15 那次 PR #4 收口会话在仓根留过一个未提交的 `findings.md`，其中一条与本票直接相关：

> `p2-browser-closure-gate.static.test.ts` —— `p2-browser-closure.spec.ts` 的源码钉（source-pin）
> 疑似 `84d3d091` 一族的产品漂移；**测试应对齐到预期产品**

两个文件今天都还在：
- `mkfast-template-main/tests/e2e/specs/p2-browser-closure.spec.ts`
- `mkfast-template-main/src/product/composer/p2-browser-closure-gate.static.test.ts`

**同一条假说在原文里还盖着一个兄弟文件**（一并摘出，免得随原件丢掉）：
`composer-quote-precondition.static.test.ts`——`composer-home.tsx` 的源码钉。
它今天**没有红**，所以不是本票的入口；但若查下来「产品漂移」成立，
这一条大概率是同一次漂移的另一处受害者，应一并核。

**这只是一条假说，不是结论**（原作者自己写的是「likely」）。
但它给了本票一个明确的起点：先查 `p2-browser-closure.spec.ts` 断言的产品形态
与今天的实际产品是否已经漂开——如果是，那么该改的是测试（对齐到预期产品），
而不是把产品改回去迁就旧断言。

## What to build（定性优先）

1. **先判性质**，两条 spec 分别判，不要合并结论：
   - 拉一次该 spec 的失败上下文（`error-context.md` / trace），看它死在断言还是 fixture；
   - 若死在 fixture（注册/seed/网络），归入风暴级联或环境，与 V31-70 合流；
   - 若死在断言，才进入下一步。
2. **断言型的，先查产品漂移**（对 `p2-browser-closure` 用上面那条线索），
   判「测试过时」还是「产品缺陷」。这两者的修法方向相反，判错会把正在工作的产品改坏。
3. **`v31-ops-console-release-journey`** 走的是 UI 发布→灰度→试运行→晋级→回滚整条链，
   链长、涉及发布面，**不要先动它**——先把短的那条判明白，再决定要不要投入。

## Acceptance criteria

- [ ] 两条 spec 各自的失败点已定性（断言 vs fixture），结论写入本票并附证据行号
- [ ] 断言型的那些，已判明是「测试过时」还是「产品缺陷」，并说明依据
- [ ] 若判为测试过时：测试已对齐到预期产品，且**说明预期产品的出处**（规格/决策原文，不能是「看起来应该这样」）
- [ ] 若判为产品缺陷：另立修复票，本票只负责定性
- [ ] `p2-browser-acceptance` 连续两轮不再出现这两条 spec 的红
      （**注意**：只要 V31-70 的仪器故障还在，该门整体仍会 fail，这一条只看这两条 spec）

## 禁区

- **不要为了让门变绿而删/skip 这两条 spec。** 它们五次稳定复现（含一次同 commit 重跑），是信号不是噪音。
- **不要在没定性之前改产品代码。** 见上面第 2 条：方向反了会改坏正在工作的东西。
