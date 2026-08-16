# V31-104 — `p2-browser-acceptance` 里两条 spec 五次恒红，且在零代码 diff 上照样红：已定性，分属两处

**Parent**: 门可靠性（V31-70 的邻票，但不是同一件事）
**批次**: 定性优先（先判是什么，勿猜修）
**Blocked by**: 无
**Related**: V31-70（同门的 workerd 仪器故障——**是另一回事，别混**）、V31-96（被该门截断的受害者）

**Status**: 已定性（2026-08-16）— 五次观测五红、失败的恒为同两条 spec；**两轮发生在纯文档 PR 上，第五次是同一 commit 的 attempt 2 重跑**，故与被合入的内容无关。**定性完成且两条分属不同性质**：①`p2-browser-closure:270` ＝断言型产品缺陷，与 V31-28 已记的「问答卡不出现」同签名（同两个 testid／同「两种图文方向」／同"服务活着卡不出现"），**归 V31-28 不另开票**，并说明该票的 `implementation-complete` 在这条路径上未兑现；②`v31-ops-console` ＝fixture／环境型，唯一真失败是 `openConsole` 吃默认 5s 超时（另有一次 `finally` 收尾级联），且控制台在反复 vite 重连，与 V31-70 同源。**本票价值已兑现在"把两条分开、各自找到归属"，不作为整体去修**

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

> **⚠️ 后续更正（2026-08-16，定性做完后回填）：这条线索指错了方向，别照它修。**
> 它猜的是「产品漂移 ⇒ 该改测试」。实测证据指向的是**相反**的结论：
> `p2-browser-closure:270` 等的那张问答卡，与 V31-28 已独立记录的
> 「服务全程存活但问答卡不出现」是同一签名——**是产品面真缺陷，不是测试过时**。
> 照这条线索去「把测试对齐到预期产品」，等于把一个真缺陷改成绿灯。
> 线索仍然有价值（它把注意力引到了正确的文件上），但它的**结论部分作废**。
> 兄弟文件 `composer-quote-precondition.static.test.ts` 那一条同理，未经核实不得据此改测试。

## ✅ 定性结果（2026-08-16，从 job `95153522135` 的失败上下文读出）

票面要求「两条分别判，不要合并结论」。判下来**两条根本不是一类东西**，
合并处理会同时冤枉一条、放过一条。

### ① `p2-browser-closure.spec.ts:270` ＝ **断言型，且已有归属**

死在 `submitImageTextAllowingTerminalFailure`（`:270`，调用点 `:841`）：

```
expect(locator).toBeVisible() failed
Locator: getByTestId('ask-merchant-group-card').filter({hasText:'/两种图文方向/u'})
     .or(getByTestId('composer-question-card').filter({hasText:'/两种图文方向/u'}))
     .or(getByTestId('composer-stage-line').filter({hasText:'已按你选的方向继续准备整套图文'}))…
Timeout: 180000ms — element(s) not found
```

**180s 等不到，不是时序问题**，是那张问答卡真的没出现。

**它不是新缺陷——V31-28 已经写过这个症状**（该票 `:131`）：

> CI run 31554310069 中 4 个 case 在**服务全程存活**时独立复现「问答卡不出现」：
> `composer-card-family.spec.ts:243/:372/:449`（`ask-merchant-group-card` 240s 超时）
> ＋ `m04-browser-hard-gate.spec.ts:364`（`ui-journey.ts:341` 同时等
> `ask-merchant-group-card` 与 `composer-question-card`，300s 双双不出现）

**同样的两个 testid、同样的「两种图文方向」、同样的"服务活着但卡不出现"形态。**
V31-28 连机制假说都已写好（`:136`）：run 先进 `delivered`、问答轮询随即关闭——
`use-composer-interactions.ts:142/145/148` 的 `refetchInterval`/`enabled` 都带
`phase !== 'delivered'`，`ask-merchant-interaction-slot.tsx:51-57` 同理。

**处置**：这一条**归 V31-28，不在本票另起炉灶查**。
值得注意的是 V31-28 当前状态是 `implementation-complete / release-verification-pending`
——本条红说明那个 `implementation-complete` 在这条路径上**没有兑现**，
该票的 release 验证不应就此放行。

### ② `v31-ops-console-release-journey` ＝ **fixture／环境型，不是产品缺陷**

同一 job 里它的失败点看着有三个，实际只有一个半：

| 位置 | 次数 | 是什么 |
|---|---|---|
| `:41:55` | 4 | `openConsole` 内的断言 |
| `:294:7` | 4 | **就是 `openConsole(page)` 的调用点**——与上一行同一事件 |
| `:376:7` | 1 | `finally` 里的 `runnerContext.close()`，**收尾级联** |

即：唯一的真失败是 `openConsole` 找不到 `admin-ops-console`。

判为环境型的三条依据：

1. **超时是默认的 5s**。`openConsole`（`:39-42`）在 `page.goto('/admin/ops-console')`
   之后直接 `toBeVisible()`、不传 timeout，吃 Playwright 默认 5000ms——
   而整条 test 自己有 `test.setTimeout(360_000)`。给一次导航＋admin 页渲染只留 5s，
   在负载下本来就悬。
2. **权限不是原因**。该 test 显式 `registerE2EUser(request, { role: 'admin' })` 并登录，
   不存在"没权限所以 testid 不存在"。
3. **浏览器控制台在反复重连**：日志里 `[vite] connecting… / [vite] connected.`
   十余次交替出现，夹着
   `Can't perform a React state update on a component that hasn't mounted yet`。
   页面在不停重载——这与 V31-70 记的 vite/workerd 不稳同源。

**处置**：修法方向是给 `openConsole` 一个显式的、与其它 journey 一致的宽超时
（本仓多处用 60s），**不是改产品**。这与 V31-98／101／102／103 是同一族毛病：
**拿一个固定/默认的毫秒数替代「等它真的渲染出来」**。
本票不擅自改——它属于「测试对齐」，但要与 V31-70 的环境治理一起看，
免得把仍在重载的页面用更长的超时掩盖过去。

### 由此修正本票的一个前提

开票时我写的是「是产品缺陷还是风暴级联未定性」。现在答案是**两者都有，且分属两条**：
①是产品面真缺陷（已有归属票），②是测试/环境。
所以本票**不该作为一个整体去修**，它的价值已经兑现在"把两条分开、各自找到归属"上。

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

- [x] 两条 spec 各自的失败点已定性（断言 vs fixture），结论写入本票并附证据行号
      —— 见「定性结果」：①断言型（产品面）、②fixture／环境型
- [x] 断言型的那些，已判明是「测试过时」还是「产品缺陷」，并说明依据
      —— ①＝**产品缺陷**，依据是 180s 等不到问答卡且服务全程存活；
      ②不是断言型，不适用本条
- [ ] 若判为测试过时：测试已对齐到预期产品，且**说明预期产品的出处**（规格/决策原文，不能是「看起来应该这样」）
      —— 只对②适用：`openConsole` 该给显式宽超时（对齐本仓其它 journey 的 60s），
      **但先与 V31-70 的环境治理一起看**，别用更长的超时掩盖仍在重载的页面
- [x] 若判为产品缺陷：另立修复票，本票只负责定性
      —— **不另立**：①与 V31-28 已记的「问答卡不出现」同签名（同两个 testid、同「两种图文方向」、
      同"服务活着卡不出现"形态），该票连机制假说都已写好，**归它，不重复开票**
- [ ] `p2-browser-acceptance` 连续两轮不再出现这两条 spec 的红
      （**注意**：只要 V31-70 的仪器故障还在，该门整体仍会 fail，这一条只看这两条 spec）

## 禁区

- **不要为了让门变绿而删/skip 这两条 spec。** 它们五次稳定复现（含一次同 commit 重跑），是信号不是噪音。
- **不要在没定性之前改产品代码。** 见上面第 2 条：方向反了会改坏正在工作的东西。
