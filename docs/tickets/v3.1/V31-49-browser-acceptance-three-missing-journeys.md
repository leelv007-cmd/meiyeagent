# V31-49 — V3.1 浏览器验收门三缺口：spec 任务书 ＋ B2 重叠度裁决

**Parent**: V3.1 §37.4 Playwright 主旅程（`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md:1763-1776`）；门契约由 ci-gates `9ab20aff5` 钉定
**批次**: 浏览器验收（三条 spec 互不共享文件，可分派三个 lane 并行；但**任一条都不得改门脚本的条目集**）
**Blocked by**: None —— 门已 fail-closed 红着，本票是把门后的 spec 补上
**Related**: V31-29（`V31-29-e2e-fixture-truthfulness.md`）/ V31-30（`V31-30-p1-route-mock-envelope-truthfulness.md`）—— 同属「测试是否真在证明产品」这一族。本票的 B2 裁决直接用到 V31-29 的判据：一条断言若在产品整层坏掉时也照样通过，它不算覆盖
**Status**: open

## 事实底座（只读亲验，锚署集成树 `codex/v31-integration` @ `98949870a`）

门脚本 `scripts/ci/run-v31-browser-acceptance.sh` 由 ci-gates `9ab20aff5`（`test(ci): split rights revocation into its own acceptance journey`，2026-08-09，同时改了 `TEST-CATALOG.md` 与 `quality-gates.test.mjs`）钉了 **16 条 spec，显式列举而非 glob**。实测 **13 在、3 缺**，门因此恒红——**这个红是对的，不是噪声**。

fail-closed 逐句：`:44-48` 遍历 `-f` 检查，`:50-58` 有缺即把清单 `tee` 到 `missing-specs.log` 并 `exit 1`（错误文案：`Every §37.4 journey must exist as a real spec; the gate fails closed.`）。缺口检查在 `:60` 的 production-network-boundary-gate 与 `:64` 的 playwright 之**前**，所以缺 spec 时连测试都不会起跑。

三条缺失（归属取门脚本自己的注释，`:26`/`:27`/`:37`）：

| 缺失 spec | 门脚本注释 | 权威定义 | 现状判定 |
|---|---|---|---|
| `tests/e2e/specs/v31-level1-copy-journey.spec.ts` | §37.4-B Level 1 纯 copy | `plan:1766` | **Journey B 零自动化覆盖**——16 条里没有第二个文件声明 B |
| `tests/e2e/specs/v31-memory-injection-journey.spec.ts` | §37.4-B2 记忆注入透明 | `plan:1767` | B2 **已有另一条落地 spec**（`v31-memory-injection-b2-journey.spec.ts`），故本条走下面的重叠度裁决，不盲目新建 |
| `tests/e2e/specs/v31-artifact-growth-journey.spec.ts` | Artifact semantic stream | `plan` §5.5「Make：Artifact 原位生长」`:294-296`；布局前提 §4.2 `:241-247`；出闸指标 §38「Artifact 重复对象率 = 0」`:1803` | 非 §37.4 字母项（T5 域），零覆盖 |

**顺带核清一个容易误读的地方**：16 ＝ §37.4 的 **12 个字母各一条**（A / B / B2 / C / D / E / F / G / H / I / J / K）＋ **4 条非字母项**（`artifact-growth`、`goal-proactive-idle`、`memory-injection-b2`、`partial-resume-assisted`）。门脚本注释 `:20` 写「One file per V3.1 §37.4 journey letter」，那句只覆盖前 12 条；后 4 条是产品票专属合同（分别对应 T5 域、goal surface、V31-18、V31-16），**不要按字母去找它们的归属，也不要因为找不到字母就以为它们是冗余项**。

---

## 一、§37.4-B Level 1 纯 copy — 旅程任务书

§37.4-B 原文（`plan:1766`）四件，缺一不可：

1. **免确认直达结果** —— Level 1 纯 copy 不进 Living Plan 确认环，提交后直达结果面。
2. **报价 chip 常显** —— 报价在整条旅程中始终可见，不是只在某一步闪现。
3. **余额不足阻断双出口** —— 阻断时必须给出**两个**出口（充值 / 降级或改小需求），不是一个死胡同。「双」是原文里的硬要求，只做一个出口不算过。
4. **exact plan/quote/release 仍冻结** —— 免确认**不等于**免冻结：`approvalBasis=policy_exempt_copy` 的 admission 仍要冻结 exact plan、quote 与 release，且**重放与扣费幂等**（BLOCK-01）。

**已核证的产品锚（给实施 lane 省一次查找）**：`policy_exempt_copy` 的放行判断在 `apps/core/src/p1/harness/task-admission.ts:567`（集成树；T4 树旧锚 `:427` 已失效，勿沿用）。

**断言纪律（本票的硬要求，不是建议）**：
- 第 4 件必须**在浏览器旅程里**被证明，而不是只在单测里。理由：`policy_exempt_copy` 是 Level 1 的**唯一**放行基础，一旦它退化成「免确认＝不冻结」，单测覆盖的是 admission 函数，浏览器侧看不出来，而商家的钱在浏览器侧。
- 幂等要用**真重放**证明（同一提交重放一次，断言扣费不翻倍），不得用「调用了一次幂等函数」这种结构断言代替。
- 第 3 件的「双出口」要断言**两个出口各自可点且指向不同去处**，不得只断言「出现了阻断文案」。

**testid 由实施 lane 按 `tests/e2e/fixtures/ui-journey.ts` 的现有命名派生**——本票**不预设未经核证的 testid**，避免把一个不存在的选择器写成任务书。

---

## 二、§37.4-B2 记忆注入透明 — 重叠度裁决（review-memory 署名，2026-08-10）

§37.4-B2 原文（`plan:1767`）是**五跳**：`任务详情 → 注入清单 → 经验来源 → 撤销 → 后续任务不再注入`（MAJOR-12）。§39 给了它的目的（`plan:1817`）：「任务详情提供本次注入的经验清单入口，**商家能回答「它为什么这么写」**」。

已落地的 `mkfast-template-main/tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts`（298 行，`describe` 在 `:146`，**只有一个 test** 在 `:150`）逐跳对照：

| 跳 | §37.4-B2 要求 | 落地 spec 的实际断言 | 判定 |
|---|---|---|---|
| ① 任务详情 | 从任务详情进入 | `openTaskDetail(page, injectedTaskId)` `:209`、`openTaskDetail(page, laterTaskId)` `:281` | **覆盖** |
| ② 注入清单 | 看到本次注入了哪些经验 | panel `:224` / `:282-283` 可见；`receiptedMemoryIdsByStatement` `:210` 读 statement；**两条记忆都必须被 receipt 的正基线** `:213-221`，且断言两个 id 不相等 `:221` | **覆盖，且强于要求**——正基线的存在使后面的负断言无法空洞通过（这正是 V31-29 那条判据的正确用法，spec 头注 `:18-24` 自己讲了为什么必须两条而不是一条） |
| ③ **经验来源** | 追到这条经验**从哪来** | **零断言**。`memory-injection-receipt-source` 这个 testid 在该 spec 中命中数 **0**（实测 `grep -c`） | **真缺口**，且不止是测试缺口，见下 |
| ④ 撤销 | 撤销其中一条 | `:225-227` 点撤销；`:238-240` 被撤销按钮 disabled ＋ `:243-245` **存活者仍 enabled**（防「一刀切禁用」也能过）；`:248-261` 绕过面板直查服务器 `entries_page`，断言存活者 `confirmed`、被撤销者非 `confirmed` | **覆盖，且诚实**——头注 `:229-237` 明写面板的 `revokedIds` 来自 `useState(new Set())`（`memory-injection-receipt.tsx:26`）、刷新即忘，所以那两条只断言「点击产生了本地反馈」，持久证明交给服务器查询与下一个任务。**这段自我限定不要在后续改动中被"顺手加强"成 reload 后仍断言**，那会把产品当前不提供的保证写进测试 |
| ⑤ 后续任务不再注入 | 之后的任务不再注入被撤销的那条 | `:266-279` 新提交一个任务；`:284-288` 存活者 entry `toHaveCount(1)`；`:289-293` 被撤销者 `toHaveCount(0)`；`:294-296` statement 不含被撤销文案 | **覆盖** |

**裁决：5 跳中 4 跳已被既有 spec 覆盖（其中 ②④ 强于原文要求），仅第 ③ 跳「经验来源」是真缺口。**

所以门脚本里 `v31-memory-injection-journey.spec.ts` 这一条 **不新建整条旅程**，而是：

- **改指向既有 spec**（把门脚本 `:27` 那一行的路径改成 `v31-memory-injection-b2-journey.spec.ts`）—— **但必须先把第 ③ 跳的断言补进那条 spec，否则等于把一个真缺口注销掉**。补断言与改指向必须同一次变更落地，不得分两批。
- **不要**为了凑门而新建一个薄壳 spec：五跳里四跳会与既有 spec 逐字重复，重复的浏览器旅程每条要跑十几分钟，且两份断言漂移后没人知道该信哪份。

### 第 ③ 跳的缺口是**两层**——产品那层已裁（2026-08-10，主控裁决）

**缺口现状（只读亲验）**：产品侧「经验来源」这行是有的：`mkfast-template-main/src/product/memory-injection-receipt.tsx:88-93`，`data-testid="memory-injection-receipt-source"`，渲染 `memory_injection_receipt_source({ memoryId: entry.memoryId })`。而那条文案的原文是——

- `project.inlang/messages/zh.json:3386`：`"memory_injection_receipt_source": "来源记忆 {memoryId}"`
- `project.inlang/messages/en.json:3386`：`"Source memory {memoryId}"`

**即「经验来源」当前只显示一个不透明 id。** 对照 §39 的目的（`plan:1817`「商家能回答『它为什么这么写』」），一串 UUID 回答不了这个问题。而**人类可读的来源确实存在**，只是在另一个页面：`mkfast-template-main/src/product/memory-vault-page.tsx:196-206` 的 `formatEntrySource` 渲染 `source.preview` ＋ `source.observedAt`，并在源对话被删时渲染「来源已删除」（`:204-205`，对应 V31-18 AC4）。**收据面板与那个页面之间没有跳转**。

### 裁决 — 收据行**内联 preview**，不走跳转（主控，2026-08-10）

**定形**：收据行渲染来源记忆的 `source.preview`（截断）＋ `observedAt`，语义与 memory-vault 的 `formatEntrySource`（`memory-vault-page.tsx:196-206`）**同源**——含「来源已删除」回落（对应 V31-18 AC4）。`memoryId` **降为次要展示**（tooltip／详情），不再作主文案。

**依据**：非技术商家的第一眼要能回答「它为什么这么写」，**内联一句话就是答案，跳转是第二跳成本**。这与既有产品审美裁决一致（拟人化一句话 > 卡片跳转）。vault 页保留为**深层视图**，两处此后**共享同一格式化语义**以防再漂移——即不要在收据面板另写一份格式化逻辑。

**实施红线（三条，缺一不可）**：

1. **契约必须动，这不是可选项。** 实测：`packages/contracts/src/agent-domain.ts:642-661` 的 `memoryInjectionReceiptSchema` 是 `.strict()`，其 `entries` 元素也是 `.strict()`，字段恰好只有 `{memoryId, statement, revision}`（`:652-654`）——**既不带 `preview` 也不带 `observedAt`**。所以「receipt payload 现不携带 preview」是**已核实的事实**，接线补齐属本次实施范围。**禁止以「省接线」为由降级回裸 `memoryId`**。
2. **schema 版本与历史行要一起想。** 该 schema 带版本字面量 `MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION`（`:644`，当前 `'memory-injection-receipt/v1'`），且 receipt 是 **put-once 持久化**的（`apps/core/src/p1/operations/postgres-memory-injection-receipt.ts:72`，写入后不可改）。因此**已存在的历史 receipt 行永远不会有新字段**——新字段要么在 v1 上设为 optional 并让 UI 对历史行回落，要么升 v2 并明确历史行的展示形态。**不得让历史 receipt 打开就空白或崩**。选哪条由实施 lane 定，但必须在票下写明选了哪条及历史行的实际表现。
3. **`entries` 上限 100、`statement` 上限 4000（`:653`、`:658`）**——preview 的截断长度要自己定并写进契约，不要把一整条源对话塞进 receipt 让单条 receipt 膨胀。

**断言纪律（裁形态后才写，正负配对）**：

- **不要**写「断言 `memory-injection-receipt-source` 可见且含 memoryId」这类测试。那是自证——测的是「我们渲染了我们渲染的东西」，与 V31-18 裁决判为 fixture 同义反复的 `正文不超过 32 字` 正则同一种错误（b2 spec 头注 `:26-33` 正是为此删掉了旧风格断言）。
- **正**：注入了某条确认记忆后，收据行显示的 preview **确实是那条源对话的内容**（用旅程里商家真说过的话作判据，与 b2 spec 现有的 `REVOKED_PREFERENCE` / `SURVIVING_PREFERENCE` 手法一致）。
- **负**：源对话被删后，同一行回落为「来源已删除」语义，**且不再显示 preview**。这一条与 V31-18 AC4 同一个产品行为，两处断言应共享判据文案（`memory_entry_source_deleted` 与收据行的回落文案要么同一条 message，要么在票下说明为何必须是两条）。
- **配对的必要性**：只有正断言时，一个恒显示 preview 的实现也能过；只有负断言时，一个从不显示 preview 的实现也能过。

### 顺带更正两处对该 spec 的**过度声称**（都不改代码，只记账）

| 出处 | 声称 | 实测 | 差在哪 |
|---|---|---|---|
| 门脚本 `:39` 注释 | `V31-18 B2 生产合同（receipt/**风格**/不泄漏/撤销）` | 该 spec 全文无风格断言（`grep -niE "style\|风格\|maxBody\|forbidden"` 只命中头注里**说明为何删除**的文字） | 风格断言已被**刻意删除**（fixture 同义反复），且 V31-18 裁决明写风格约束「现在不接线」。门脚本注释停留在删除之前，读它的人会以为风格有覆盖 |
| spec 头注 `:33` | `this journey proves **source visibility**, revocation and non-recurrence only` | 它证明的是 statement 可见（`-statement`），从未碰 `-source` | 「statement 可见」与 §37.4-B2 的「经验来源」是**两个不同的面**。头注这句话把第 ③ 跳说成已覆盖 |

这两处是**注释与代码不一致**，不是产品缺陷；但它们正是这个缺口至今没被发现的原因——三份描述（门脚本注释、spec 头注、实际断言）互相矛盾，而只有第三份是真的。修正归实施 lane，与补 ③ 跳同批。

---

## 三、Artifact semantic stream — 旅程任务书

权威在 §5.5「Make：Artifact 原位生长」（`plan:294-296`）：

> 左侧 Workstream：当前阶段、已完成内容、需要用户处理的唯一事项、可否离开、失败和退还状态。右侧同一个 Artifact 持续更新（文案逐块 / 图文逐页 / 视频逐场景 / 发布准备逐项）。**不重复追加「候选卡+结果卡+交付卡」；同一对象只更新一个稳定 ID。**

布局前提 §4.2（`:241-247`）：左 62% 连续 Agent Workstream ／ 右 38% Shared Artifact。出闸指标 §38（`:1803`）：**Artifact 重复对象率 = 0**。

四件要断言的：

1. **单一稳定 ID**：一次 Make 全程，右侧 Artifact 的对象 id **不变**；断言方式是取首次出现时的 id，在后续每个阶段复查同一个 id 仍是同一个节点，**而不是**只断言「页面上只有一个 Artifact」（后者在「旧的删了新的加」的实现下也会过）。
2. **原位生长而非追加**：阶段推进后，Artifact 节点**数量不增**、内容变化。这条要正负配对：内容确实变了（正）＋ 节点计数未增（负），否则一个静止不动的 Artifact 也能让负断言通过。
3. **左右分工**：左侧出现阶段/唯一待办/可否离开/失败与退还状态，右侧只承载 Artifact。
4. **重复对象率 = 0 的浏览器侧对应物**：整条旅程结束时不存在「候选卡 + 结果卡 + 交付卡」三卡并列——这是 §5.5 明确点名要避免的形态。

**归属**：T5 域（Artifact / semantic stream）。与另两条 spec 无共享文件。

---

## 防拆门裁决（写进票面防后人拆门）

门脚本 `:15-18` 的注释已经把设计意图写清楚了，本票把它升为**票面裁决**：

- **显式列举不得改回 glob。** 理由（原文）：glob 会让「新增一条 V3.1 spec」**静默变成必跑门**，绕过 catalog 与 CI 契约的有意更新。
- **条目不得删。** 理由（原文）：一条旅程的 spec 文件尚未落地时，门**保持红**，而不是少跑几条静默通过。
- 因此**「门红了就把缺失条目注释掉」是被明令禁止的修法**。允许的修法只有两种：把 spec 写出来；或者像上面 B2 那样，**在补齐真缺口之后**把条目改指向一条确实覆盖该旅程的既有 spec。
- 改条目集的任何变更都必须同批更新 `mkfast-template-main/tests/e2e/TEST-CATALOG.md` 与 `scripts/ci/quality-gates.test.mjs`——`9ab20aff5` 三个文件一起改就是这个先例。

## Acceptance criteria

- [ ] `tests/e2e/specs/v31-level1-copy-journey.spec.ts` 落地，§37.4-B 四件各有断言；第 4 件（`policy_exempt_copy` 下 plan/quote/release 仍冻结 ＋ 重放扣费幂等）**在浏览器旅程内**被证明，且幂等用真重放而非结构断言
- [ ] `tests/e2e/specs/v31-artifact-growth-journey.spec.ts` 落地，§5.5 四件各有断言；「单一稳定 ID」与「原位生长」两条均为**正负配对**断言
- [ ] §37.4-B2 第 ③ 跳「经验来源」按**已裁定形态**落地：收据行内联 `source.preview`（截断）＋ `observedAt`，与 `formatEntrySource` 共享格式化语义、含「来源已删除」回落，`memoryId` 降为次要展示。契约补字段属本次范围（`memoryInjectionReceiptSchema` 现为 `.strict()` 且不带 preview），并在票下写明 v1-optional 还是升 v2、以及历史 put-once receipt 行的实际表现
- [ ] 上条的断言**正负配对**：正＝preview 确为该条源对话内容（用旅程里商家真说过的话作判据）；负＝源对话删除后回落为「来源已删除」且**不再显示 preview**。**不接受**「断言 source 行显示了 memoryId」这类自证
- [ ] 上条落地后，门脚本 `:27` 改指向 `v31-memory-injection-b2-journey.spec.ts`，**且与补断言同一次变更**；同批更新 `TEST-CATALOG.md` 与 `quality-gates.test.mjs`
- [ ] 门脚本 `:39` 注释里的「风格」删除（该 spec 无风格断言，V31-18 裁决亦明写风格约束现在不接线）；spec 头注 `:33` 的「source visibility」按补断言后的真实覆盖改写
- [ ] `bash scripts/ci/run-v31-browser-acceptance.sh` 走完 `:44-58` 的缺口检查（不再 `exit 1`），并真的跑到 `:64` 的 playwright
- [ ] **变异反证**：从条目集里删掉任意一条已落地 spec 的文件 ⇒ 门必须 `exit 1` 且 `missing-specs.log` 列出它。改后立即还原，终态 `git status --porcelain` 空
- [ ] **audit 项（主控 2026-08-10 批准并入本票）**：对「不在任何必跑门内的 spec」做**全量归类**。实测底数（署合入树 `0fb784658`）：三条门脚本合计显式列举 **28** 条，其中 **3** 条文件尚不存在（即本票的三缺），实际覆盖 **25** 条；`mkfast-template-main/tests/e2e/specs/` 下共 **87** 个 `.spec.ts` ⇒ **62 个 spec 不在任何必跑门内**。归类要求见下节「audit 项的做法」

## audit 项的做法（62 个无门 spec 的全量归类）

**这不是「把 62 条全塞进门」**——那会让必跑门从 25 条涨到 87 条，浏览器旅程每条数分钟，门会直接不可用。要的是**归类与决策留痕**，每条 spec 落进下面四类之一，并在票下列出类别与理由：

| 类别 | 含义 | 处置 |
|---|---|---|
| A. 应进门 | 它是某条产品合同的唯一浏览器证据（AC4 那种） | 纳入某条 required 门，按 `0fb784658` 的先例：显式条目 ＋ 同 commit 同步 `quality-gates.test.mjs` |
| B. 已被覆盖 | 它断言的行为已由门内某条 spec 覆盖 | 声明「由 `<spec>` 覆盖」，留在门外 |
| C. 本地专用 | 只在本地开发/调试时跑（如 admin 后台批量 spec） | 显式声明「本地专用，不进门」，写明理由 |
| D. 应删 | 已失效／被替代／断言无意义 | 走删除流程（`git ls-files` 证明删净） |

**发现 A 类的判据（最要紧的一条）**：一条 spec 若断言了某张票 AC 的**唯一**浏览器证据，它就是 A 类——`memory-vault-governance.spec.ts` 就是这么被 V31-18 AC4 撞出来的：断言写好了、文案逐字对得上，却没有任何必跑门会因它变红。**这类 spec 的危险不是它会红，而是它永远不会红。**

**入手顺序建议**：先按票面反查（每张 v3.1 票的 Evidence 表 `Playwright result` 列非 `n/a` 的行，其证据 spec 是否在门内），能最快捞出 A 类；剩下的再按目录前缀（`admin-*` 大概率 C 类）粗分。

**边界**：本 audit **只归类与开票，不在本票内改门脚本**。任何纳门动作按防拆门裁决办：显式条目、不删条目、同批更新 `TEST-CATALOG.md` 与 `quality-gates.test.mjs`。

## 关联

- **V31-29 / V31-30**（ci-gates 域，e2e fixture 与 route mock 的真实性）：本票的 B2 裁决和第 ③ 跳的红线**直接建立在它们的判据上**——一条在产品整层坏掉时也照样通过的断言不算覆盖。三票的共同底座是「门的红绿必须与产品状态挂钩」；V31-29/30 管**断言是否在测真东西**，本票管**门的条目集是否名副其实**。
- **V31-18**（memory platform）：B2 的产品合同来源。本票第 ③ 跳的产品缺口（来源只显示 UUID、与 memory vault 无跳转）与 V31-18 Evidence 表 AC3 的 Playwright 列留 `—` 是**同一件事的两面**——AC3 那一格要等本票的 spec 跑绿才填得上。
- **V31-16**（部分交付续跑）与 goal surface 票：门脚本另两条非字母项的属主，本票不动它们，只在「事实底座」里把归属讲清楚以免被当成冗余项删掉。

## 留痕

- 开票：主控派发（2026-08-10），事实底座由主控给出（门脚本 16 条钉于 ci-gates `9ab20aff5`、现 13 有 3 缺、缺口从未派过 lane）。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`，基座 `98949870a`）：门脚本 16 条**逐条只读核证存在性**（13 在 3 缺，与派件一致）；核清 16 ＝ 12 字母 ＋ 4 非字母项，并写明门注释 `:20` 只覆盖前 12 条；三条缺失 spec 各按 §37.4 / §5.5 原文落成任务书（`plan` 行号逐条署出）；**B2 重叠度分析署 review-memory 名**——逐跳量到 4/5 已覆盖、仅「经验来源」为真缺口，并进一步定出该缺口是**两层**（测试零断言 ＋ 产品只显示 UUID，人类可读来源在 `memory-vault-page.tsx:196-206` 且无跳转），据此裁「改指向既有 spec 但必须先补 ③ 跳」而非新建薄壳；顺带更正两处对该 spec 的过度声称（门脚本 `:39` 的「风格」、spec 头注 `:33` 的「source visibility」）；防拆门裁决写入票面。
- Wave 4 追加（同日，主控裁决）：③ 跳的**产品形态已裁定＝收据行内联 preview，不走跳转**（依据：非技术商家第一眼要能回答「它为什么这么写」，内联一句话即答案、跳转是第二跳成本；vault 页降为深层视图，两处共享同一格式化语义防再漂移）。落票时把实施红线钉到契约级：**已核实** `packages/contracts/src/agent-domain.ts:642-661` 的 receipt schema 是 `.strict()`、entry 字段恰为 `{memoryId, statement, revision}`（`:652-654`），**确实不带 preview／observedAt**，故「接线补齐属实施范围」不是假设而是事实；另加两条本轮新查出的约束——schema 带版本字面量（`:644`）且 receipt 是 put-once 持久化（`postgres-memory-injection-receipt.ts:72`），**历史行永远不会有新字段**，必须选 v1-optional 或升 v2 并说明历史行表现，不得打开空白或崩；`entries` 上限 100 / `statement` 上限 4000（`:653`、`:658`）要求 preview 自定截断长度。断言纪律按正负配对写入 AC。
- 本 commit 对 `apps/core`、`mkfast-template-main`、`packages`、`scripts`、`.github` 零改动——**包括没有改门脚本**：门现在红着是正确状态，改它属实施 lane 且须按本票 AC 的顺序来。
- Wave 4 追加（2026-08-10，主控批复回填）：主控已以 `0fb784658` 把 `memory-vault-governance.spec.ts` 纳入 `run-pr-production-journey.sh` 必跑集（V31-18 AC4 的「无门可跑」由此解除），本票据此新增 **audit 项**：62 个 spec 不在任何必跑门内的全量归类（底数逐条实测：三门列举 28 条、含 3 条文件不存在、实际覆盖 25 条、仓内 87 个 spec），并给出 A/B/C/D 四类处置与「唯一浏览器证据 ⇒ A 类」的判据。**归类不等于全塞进门**——25 涨到 87 会让门不可用，要的是决策留痕。
