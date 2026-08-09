# V31-18 — Memory 扩列 + 双通道 + observation pipeline + 注入透明

**Parent**: spec-E（#5）`docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md`；权威 V3.1 §12、U4/U5
**Lane**: Memory 并行 lane（不阻塞批次 2-4 主线）｜ **语义锁**: 与 V31-19 同 lane 串行或双 worktree
**Blocked by**: V31-01（**working 切片内部另等 V31-06 的 checkpoint 单 writer**；preference/correction 切片可先行）
**Status**: done (merged f190a7cf) — Wave-4 evidence audit: 5 AC 全数未验收，backfill 在途

## What to build

现有 preference 三表扩列（kind/authority/scope/decay/state）；五层认知分类；authority 双通道（Thread 内即时生效／跨 Thread 候选→商家确认，Extractor 经 onExtracted 落候选绝不直接生效）；working memory 抽取/投影策略经 V31-06 单 writer 落盘；检索只在合法 scope 最窄组合内排序（向量相似度永不决定 workspace/rights/fact/authority）；MemoryInjectionReceipt 注入清单可见可撤销；分离删除（A11 四类实体各自策略）；历史迁移只产 proposed。

## Acceptance criteria

- [ ] 跨店泄漏=0；Business Fact 被 Memory 覆盖=0（放行门）
- [ ] correction recurrence=0；false persistence=0
- [ ] 注入清单可见且撤销后不再注入（Playwright §37.4-B2）
- [ ] 删源对话→条目标「来源已删除」；删 memory→ApprovalReceipt 保留
- [ ] retrieval precision 有离线评测

## 裁决 — 风格约束落地为 soft candidate preference（2026-08-09，主控 Ruling 1）

**背景**：反驳复核判 B2「风格约束生效」是 fixture 同义反复——fixture 自读 prompt 正则 `正文不超过 32 字`（`apps/core/src/p1/model-supply/ai-sdk-runner.ts:1657`）后返回硬编码合规文案，而 `maxBodyChars`/`maxSentenceChars`/`forbiddenPhrases` 在全仓**没有任何地方对真实输出做过比较**。L-T4 补了真实执行原语但**刻意未接线**，理由是候选校验器唯一的拒绝词汇是 `HarnessGateId`，而该枚举是封闭契约（新增成员会打破 `apps/core/src/evals/redlines/parity.test.ts` 的红线对齐与 `action-registry` 的不可变指纹）。

**裁决**：按 D-117/D-122（生成自由+发布收口，硬门只留忠实性+红线）——商家风格偏好既非忠实性也非红线，**禁止**成为 `HarnessGateId` 成员。落地形态＝**soft candidate preference**：
- 选择阶段优先取合规候选；
- 违规只作 advisory annotation，**永不拒绝**（不得 brick 已扣费的提交）；
- 另加一处 delivery-time advisory。

**时点**：与 V31-18 P1-8 的绑定时刻相同——即 `merchant_confirmed` 真正拿到 ExecutionPlanSnapshot 之时（`apps/core/src/p1/harness/task-admission.ts:567` 只放行 `policy_exempt_copy`，所以 note/media 走 legacy，两者都还没生效面）。**故现在不接线**，由 integration 波按本节作为已定规格消费，避免变成孤儿。

> **重锚（Wave 4，2026-08-10）**：上句原写 `task-admission.ts:427`，那是 T4 树的行号；集成树 `98949870a` 上 `:427` 已是 `private async admit(input, dispatch)`，`policy_exempt_copy` 实际在 `:567`。这是树漂移不是错号，已按集成树改写。**这个「绑定时刻＝`merchant_confirmed`」的结论是下面那条恢复路径裁决的依据之一**，见「裁决 — 恢复路径 P0-1 的满足机制」。

**原语位置（integration 直接取用）**：
- `assessMemoryStyleCompliance(candidate, style)` — `apps/core/src/p1/harness/make-snapshot-consume.ts:283`，纯函数、CJK 感知，返回 `{passed, violations}`，`MemoryStyleViolation` 覆盖 max_title_chars / max_body_chars / max_sentence_chars / forbidden_phrase。
- `describeMemoryStyleViolations(violations)` — 同文件，商家可读文案（advisory annotation 直接用）。
- 单测 `V31-18 P1-5: real output is measured against the confirmed style, not the prompt` — 对违规与合规真实输出双向断言，含「无注入记忆不得凭空造约束」。

**同一次变更内必须一起做**：删除 `ai-sdk-runner.ts:1657` 的 fixture 自读 prompt 作弊，改为让 fixture 产出**真正合规**的输出（而非被正则触发的硬编码）。否则接线后门会因为错误的理由变绿。

**附带记录（P2-9，契约即天花板）**：`planMemoryContextSchema`（`packages/contracts/src/agent-domain.ts:480-509`）是 `.strict()`，`tones` 是封闭二值枚举上限 2，`entries` 只带 `{memoryId, revision}`，唯一能承载自由文本的字段是 `forbiddenPhrases`（20×100 字符）且被硬编码 `['绝对','保证','必然']` 占满。两条正则对 join 后的 statements 取值，无论确认了 1 条还是 8 条偏好都只有 4 个可达状态；**未命中任何正则的条目仍会进 `entries`**，于是 receipt 声称已注入、下游零影响——与 P1-8 同类的透明度谎报。承载任意偏好需改上述 schema + `make-snapshot-consume.ts` 的读取端，**与本节接线同一时点执行**。

## 裁决 — 恢复路径 P0-1 的满足机制变了（2026-08-10，主控裁决；W4-A 发现）

**发现路径**：W4-A 在合并树上跑出 `composer-http.test.ts` **三红**。红的成因不是回归，是 P0-1 的**满足机制已经换了**，而测试还钉在旧机制上。

**先说一件坐标事实**：P0-1 在本票**票面上从来没有过段落**——它是 T4 修复轮的 lane 内编号。它真正的落点在**代码注释**里：`apps/core/src/p1/execution-spine/submission-coordinator.ts:1215-1219`（集成树 `98949870a`）写着「V31-18 P0-1: recovery must re-enter plan preparation, not go around it」。本节即为该编号在票面上建立正式落点。

**双臂语义（裁决终态）**：

| 臂 | 行的形态 | 恢复时发生什么 | 为什么这样是对的 |
|---|---|---|---|
| **持久臂**（新行，主流） | 有 `agentBinding` ＋ 有 `executionPlanFreeze` | `prepareAgentPlan` **短路返回**（`:777` @ `98949870a`／`:785` @ 合入后 `bb6fe34be`），prepare 不跑，检索不重做 | 原子序（prepare 先于 claim，T7 `5965ee9b1` `fix(harness): close paid confirmation crash windows`）下，新行的**检索产物在 claim 时已随 freeze 持久化**。恢复读持久化 freeze 即可；**重推导会让确认后的计划漂移，违反 V31-39 的付费确认语义** |
| **可达臂**（pre-durable 遗留行） | 缺 `agentBinding` 或缺 `executionPlanFreeze` | 短路不成立 ⇒ `prepare()` **真跑**，检索与 receipt 真发生 | 这些行的检索产物当年没被持久化，不重跑就真的丢 receipt。P0-1 的原始诉求在这一臂上仍然成立 |

**实施红线**：那段短路（`if (submission.agentBinding && submission.executionPlanFreeze) return submission.agentBinding;`）是**防确认后计划漂移的守卫，不是优化**。任何 lane 不得以「P0-1 要求恢复必须重入 prepare」为理由回退或弱化它——那句要求只对可达臂成立。同一约束已互引进 V31-33 与 V31-41（两票同摸 `recoverPendingStarts`）。

> **锚点两署（合入后必读）**：该短路在本票基座 `98949870a` 上是 `submission-coordinator.ts:777`，在 W4-B 合入后的 `bb6fe34be` 上是 **`:785`**（漂 8 行）。**实施 lane 认合入树 ⇒ 认 `:785`**；两个行号都对，差的只是署树。W4-B 落地的新注释自己写的是「~:785-787」，与合入树一致。

**依据链**：绑定时刻＝`merchant_confirmed`（见上节「时点」）是本裁决的依据之一。代码侧还有第二处独立印证：`recoverPendingStarts` 的过滤谓词 `:1196-1209` 正是按 `executionPlanFreeze?.approvalBasis !== "merchant_confirmed"` 分流的——`merchant_confirmed` 的行只由显式 start 命令启动，恢复不得替商家按下确认，唯一例外是 `confirmationDispatch?.state === "dispatched"`（已跨出外部启动边界、授权 ID 没回来的行）。即「`merchant_confirmed` 是分界」这件事在产品代码里已经是硬编码的，不只是文档结论。

**附带项 — 已修，并按要求与测试重钉同批（2026-08-10 回填）**：原注释（`:1215-1219` @ `98949870a`）声称 prepare「performs the confirmed-memory retrieval whose receipt would otherwise be silently skipped on recovery」，但持久臂在短路处就返回了，那次检索**不会发生**——按字面读是错的，且诱导下一个读者把短路当 bug 修掉。

W4-B 的 `111022d1d` 已把它改成双臂如实描述，与测试重钉在**同一个 commit** 内（该 commit 同时改 `composer-http.test.ts` 与 `submission-coordinator.ts`，主控亲验后经 merge `bb6fe34be` 入集成树）。新注释逐字要点：durable claim 来自原子序（prepare 先于 claim，`~:703-708`）已带 `agentBinding` ＋ freeze，**短路「intentionally no-ops here」**，冻结计划是 merchant-confirmed 权威（V31-39）**must not be silently re-derived**；只有 legacy claim（无 binding、无 freeze）才真正重入 `prepare()` 并重跑那次检索。**即注释现在与本节的双臂语义一致，不再有「短路是 bug」的读法空间。**

**测试重钉归属**：代码与测试由 **W4-B** 落地（RED→GREEN），已完成 ⇒ **`111022d1d`（merged `bb6fe34be`）**，commit 标题 `test(execution-spine): re-pin crash-recovery invariants for the atomic prepare-before-claim order`。W4-A 报的 `composer-http.test.ts` 三红即由此 commit 重钉（该文件 +213 行改动量）。本节的裁决落点自此闭合。

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
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

> **锚署树（Wave 4 回填时立）**：writer / consumer / test 三列行号出自**集成树** `codex/v31-integration` @ `98949870a`。
> PG result 与 failure-recovery test 括号内的通过数出自 **T4 树** `codex/v31-fix-memory-outcome` @ `8d74ad642`
> 在 `provision-test-db.sh` 一次性新库上 `--test-concurrency=1` 的实测（原始 per-file 见下节「per-file 对账基准」）。
> **两套树不同**是刻意的：数字只能来自真跑过的树，锚必须指向合入去向的树；不得把任一方冒充另一方。

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | `apps/core/src/p1/operations/agent-memory-platform.ts:547`（Business Fact 落 fact ledger，Memory 不得覆盖，抛错）；`:272-273`（store×IP×scene×platform 最窄 scope 过滤） | `apps/core/src/p1/agent-session/context-retrieval.ts:733` → `apps/core/src/assembly/core-assembly.ts:751` | `agent-memory-platform.test.ts:281`（cross-store isolation）/ `:348`（scope filter）；`intent-retrieval.test.ts:710`（并发 workspace 注入绑定隔离）。**`:547` 守卫零测试**——补测试已派 W4-B 任务 5，落地后引 commit：**待补录** | `13/13 pass`（agent-memory-platform）＋ `18/18 pass`（intent-retrieval）——**T4 树 `8d74ad642`**，非集成树 | — | — | `core` |
| AC2 | `apps/core/src/p1/operations/record-proposal-port.ts:72`（只落 proposed 候选，无路径写 preference head） | `apps/core/src/evals/preference-memory/runner.ts:92`（`false_persistence_rate` 出闸值） | `beauty-preference-memory.test.ts:13`（`false_persistence_rate===0`）/ `:14`（`superseded_old_value_reappeared===false`，即 correction recurrence 面）；`agent-memory-platform.test.ts:190`（correction 优先级恒高于 soft preference＋soft 衰减） | `4/4 pass`（beauty-preference-memory）＋ `13/13 pass`（agent-memory-platform）——**T4 树 `8d74ad642`** | —（见表下说明 ①） | `n/a`（见表下说明 ②） | `core` |
| AC3 | `apps/core/src/p1/operations/postgres-memory-injection-receipt.ts:72`（`save`，put-once＋payload 同一性校验） | `mkfast-template-main/src/product/memory-injection-receipt.tsx:65`（清单面板）/ `:43`（`action: 'revoke_memory'` 撤销） | `postgres-memory-injection-receipt.postgres.test.ts:28`（put-once＋重启可读）；`agent-memory-platform.test.ts:445`（撤销后不再注入） | `13/13 pass`（agent-memory-platform）——**T4 树 `8d74ad642`** | `1/1 pass`——**T4 树 `8d74ad642`** 一次性库 | `未跑`（B2 spec 已落地，W4-D 本轮实跑后回填） | `core-persistence`（PG 面）＋ `v31-browser-acceptance`（门脚本 `:39`）＋ `production-main-journey`（`run-pr-production-journey.sh:18`）——**两条 required 门都跑 B2 spec** |
| AC4 | `apps/core/src/p1/operations/postgres-reuse-memory-repository.ts:1332`（`source_deleted_at` → `status: 'deleted'` 投影）；`:1254`（列） | `mkfast-template-main/src/product/memory-vault-page.tsx:204`（`status === 'deleted'` → `memory_entry_source_deleted()`，zh 文案「来源对话已删除」） | `memory-sedimentation-pipeline.postgres.test.ts:248-251`（PG 断言 `source.status === 'deleted'`）；`agent-memory-platform.test.ts:652`（A11 分离删除）；浏览器面 `memory-vault-governance.spec.ts:234-235`（断言 `memory-entry-provenance` 含「来源对话已删除」，与文案逐字一致） | `13/13 pass`（agent-memory-platform）——**T4 树 `8d74ad642`** | `1/1 pass`——**T4 树 `8d74ad642`** 一次性库 | `未跑`——**且不能由 W4-D 的 b2 spec 回填**，见表下说明 ③ | —（**无 required job 跑 `memory-vault-governance.spec.ts`**，见表下说明 ③） |
| AC5 | `apps/core/src/evals/preference-memory/retrieval-eval.ts` ＋ `retrieval-baseline.json` / `retrieval-dataset.json`（版本化数据集＋基线） | `apps/core/src/evals/preference-memory/beauty-preference-memory.test.ts:49`（版本化数据集对**真实平台**跑检索） | `beauty-preference-memory.test.ts:20`（注入一次自动晋升后**必须变红**，即该评测有鉴别力而非恒绿）；`agent-memory-platform.test.ts:766`（离线 precision scorer ＋ kill switch） | `4/4 pass`（beauty-preference-memory）＋ `13/13 pass`（agent-memory-platform）——**T4 树 `8d74ad642`** | `n/a`（见表下说明 ②） | `n/a`（见表下说明 ②） | `core` |

### 表下说明（`n/a` 与 `—` 的逐条理由，新填表规则要求）

**①（AC2 的 PG 格为 `—` 而非 `n/a`）**：`false_persistence` 字面上就是**持久化**问题，而 `runner.ts:92` 的 `false_persistence_rate` 只在内存中对数据集度量，从没碰过 Postgres。所以不能声明「该轴无要求」。到底要不要一条 PG 测试证明「没有任何路径写 preference head」——**待主控裁**，裁定前保持 `—`。

**②（AC2 / AC5 的 `n/a`）**：AC2 的浏览器面为 `n/a`，因为 correction 复发与 false persistence 都不经商家可见界面表达，浏览器上无可断言之物。AC5 的 PG 与浏览器双 `n/a`，因为 **AC 原文就是「retrieval precision 有离线评测」**——它的证据轴按定义即离线评测，要求 PG 或浏览器证据属于给 AC 加码。

**③（AC4 的浏览器面，一处必须纠正的派件假设）**：AC4 的浏览器断言**已经存在且精确**——`mkfast-template-main/tests/e2e/specs/memory-vault-governance.spec.ts:234-235` 断言 `memory-entry-provenance` 含「来源对话已删除」，与 `project.inlang/messages/zh.json:3372` 的 `memory_entry_source_deleted` 文案**逐字一致**。但有两件事要一起知道：

1. **它不能由 W4-D 的 b2 spec 回填。** b2 spec（`v31-memory-injection-b2-journey.spec.ts`）的断言面只有 `memory-injection-receipt-{panel,statement,revoke-*,entry-*}` 与 `agent-workbench-host`，**从不进入 memory vault 页面**。AC4 的界面在另一个页面、另一条 spec 上。
2. **没有任何 required job 跑那条 spec。** 三条门脚本（`run-v31-browser-acceptance.sh` / `run-p2-browser-acceptance.sh` / `run-pr-production-journey.sh`）都是**显式列举**，三者合计显式列举 **27** 条 spec，而 `tests/e2e/specs/` 下共有 **87** 个 `.spec.ts`——`memory-vault-governance.spec.ts` 不在这 27 条里的任何一条。也就是说 **AC4 的浏览器证据是一条「无门可跑」的断言**：它写好了，但没有任何必跑门会因它变红。

这是产品级缺口而非填表问题：AC4 要么把该 spec 纳入某条 required 门（推荐 `production-main-journey`，它已经在跑 b2 spec），要么明确声明 AC4 不要浏览器面。**本轮不擅自改门脚本**（改门条目集属 V31-49 的裁决范围，且那张票已立「条目不得删/不得改回 glob」的防拆门条款）。

**顺带一个可能更大的面**：87 减 27 ≈ 60 个 spec 文件不在任何必跑门内。本票只负责报出 AC4 这一例，不做全量归类——若要查全集，建议并入 V31-49（它已经在管门的条目集是否名副其实）。

### 勾选裁定（按**新**填表规则逐条判）

新规则＝四列非空 **且** 三个结果格全为真实结果或 `n/a`。**5 条 AC 仍全部不得勾选**，但阻塞项已经比旧规则下精确得多，理由各不相同，不要合并处理：

| AC | 阻塞在哪 | 性质 | 解除路径 |
|---|---|---|---|
| AC1 | unit/eval 有数但出自 **T4 树**；PG / Playwright 皆 `—`；且 writer `:547` 零测试 | **既没跑也没有** | W4-B 任务 5 补 `:547` 守卫测试（引 commit）＋ 在集成树上复跑（命令见下节） |
| AC2 | PG 格 `—` 待裁（说明 ①）；unit/eval 出自 T4 树 | **口径未定 ＋ 未在本树跑** | 主控裁 PG 轴要不要 ＋ 集成树复跑（命令见下节） |
| AC3 | Playwright `未跑` | **有 spec、有门，纯未执行** | W4-D 本轮 b2 spec 实跑结果回填 |
| AC4 | Playwright `未跑` ＋ required job `—` | **断言存在但无门可跑**（说明 ③） | 先裁「纳入哪条 required 门 / 或声明不要浏览器面」，再回填 |
| AC5 | 三格里两格已是合法 `n/a`，unit/eval 出自 **T4 树** | **只差在树** | 集成树复跑（命令见下节）即可勾选 |

即：**本票 Status 此前是裸 `done (merged f190a7cf)` 而 5 条 AC 一条未勾**。这不是本轮回填造成的，回填只是把它显式化了。按主控裁决 1，Status 已改为 `done (merged f190a7cf) — Wave-4 evidence audit: 5 AC 全数未验收，backfill 在途`；**Wave-4 收口时仍未填满的 AC ⇒ Status 正式降级为 `merged-with-evidence-debt`，不得保持裸 done**。本轮仍未勾任何 checkbox。

### 补证命令（主控执行用；AC2 / AC5 由主控安排，AC1 待 W4-B，AC3 待 W4-D）

**前置（三条命令共用）**：在**集成树**上跑，先建一次性库——长活 lane 库会因残留业务行制造假红（V31-33 已实证）：

```bash
cd <集成树>              # 例：/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-integration
bash scripts/ci/provision-test-db.sh   # 期望：exit 0
export TEST_DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/<新库名>'
export TEST_DBOS_SYSTEM_DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/<新库名>_dbos'
```

**命令 1 — AC5（并顺带覆盖 AC2 的 unit/eval 一半）**：

```bash
cd <集成树>/apps/core
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/evals/preference-memory/beauty-preference-memory.test.ts > /tmp/ac5.log 2>&1; echo "exit=$?"
grep -E '^ℹ (tests|pass|fail|skipped)' /tmp/ac5.log
```

期望输出形状：`exit=0`，且 `ℹ tests 4 / ℹ pass 4 / ℹ fail 0 / ℹ skipped 0`。**若 tests < 4 即为回归信号**（T4 树下界＝4，见「per-file 对账基准」的读法硬规则）。填 AC5 的 `unit/eval result`＝`4/4 pass`（署集成树 SHA）。

**命令 2 — AC2 的另一半 ＋ AC1 / AC3 / AC4 的 unit/eval**：

```bash
cd <集成树>/apps/core
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/p1/operations/agent-memory-platform.test.ts > /tmp/amp.log 2>&1; echo "exit=$?"
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/p1/agent-session/intent-retrieval.test.ts > /tmp/ir.log 2>&1; echo "exit=$?"
grep -E '^ℹ (tests|pass|fail)' /tmp/amp.log /tmp/ir.log
```

期望：两个 `exit=0`；`agent-memory-platform` **≥ 13/13**、`intent-retrieval` **≥ 18/18**，`fail 0`。**注意 exit code 必须用重定向后 `echo $?` 取，不能 `| tail` 或 `| grep`**——管道会把退出码换成末段命令的。

**命令 3 — AC3 / AC4 的 PG 面**：

```bash
cd <集成树>/apps/core
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/p1/operations/postgres-memory-injection-receipt.postgres.test.ts > /tmp/pg1.log 2>&1; echo "exit=$?"
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/p1/operations/memory-sedimentation-pipeline.postgres.test.ts > /tmp/pg2.log 2>&1; echo "exit=$?"
grep -E '^ℹ (tests|pass|fail|skipped)' /tmp/pg1.log /tmp/pg2.log
```

期望：两个 `exit=0`，各 `1/1 pass`、`skipped 0`。**`skipped` 必须是 0**——PG 套件在缺 `TEST_DATABASE_URL` 时会自跳，`1 skipped` 会被误读成通过。

**跑之前必读的两个陷阱**：① 这些命令**绕开** `pnpm test`，因为 `pnpm --filter @meiye/core test` 会先跑 `locale:compile`、重写共享 paraglide 产物，掀翻同树在跑的 dev 或别的 lane；② 若在集成树上跑，先确认没有其他 lane 正在同树跑 `typecheck/test/test:interaction/e2e`。

### 回填暴露的两个缺口

**① `agent-memory-platform.ts:547` 的 Business Fact 守卫零测试（产品缺口）**

`agent-memory-platform.ts:547-550` 对 `/^(?:business_fact|store_fact)\./u` 的 semanticKey 抛错，错误文案 `Business Fact ${item.semanticKey} belongs to the fact ledger and cannot be overridden by Memory.`——这是 AC1 后半句「Business Fact 被 Memory 覆盖=0」在生产侧的**唯一**执行点。

实测：`grep -rn "belongs to the fact ledger\|business_fact\." --include='*.test.ts' apps/core/src packages mkfast-template-main/src` 命中数 **0**（集成树 `98949870a`）。即该守卫被删掉或被改成 warn，全仓没有任何红灯会亮。AC1 前半句（跨店泄漏=0）有两处测试钉住，后半句一处也没有——**同一条 AC 的两半覆盖度不对等**，勾选时不能被前半句带过。

**② Evidence 列集与本票 AC 的证据轴不匹配（票面/脚手架缺口）**

列集只有 `PG result` 与 `Playwright result` 两个结果列，但本票 5 条 AC 里有 3 条（AC1/AC2/AC5）的证据轴是**单测与离线评测**，既非 PG 也非浏览器。按现行填表规则这三条永远填不满、于是永远不得勾选——**规则会把「本来就不该有 PG 证据的 AC」判成未验收**。

本轮的处理：结果列严格只填对应轴的真实结果，单测/评测的通过数写进 `failure-recovery test` 单元格的括号内（保持两个结果列对机器判读干净）。**建议主控给脚手架补一列 `unit/eval result`**，否则每张票都要重复这段绕行说明。未擅自改列集——改列会影响 L-CI 的机器判读，属主控决定。

## per-file 对账基准（T4 域，任务 2 的一半）

> 用途：给 gates lane W4-A 在集成树上机械推导出的全集做**对账基准**。
> **署树**：全部出自 **T4 树** `codex/v31-fix-memory-outcome` @ `8d74ad642`，`scripts/ci/provision-test-db.sh` 一次性新库，`tsx --test --test-concurrency=1`，逐文件单跑（绕 `locale:compile` 共享产物冲突）。
> **读法（硬规则）**：集成树的同名文件数字**只允许 ≥ 本表**（Wave 3 合入只加测试不减）。若集成树某文件数字 **<** 本表，即为回归信号，先只读核证再判，不得当作「基准过时」抹掉。
> **反例已实证**：`postgres-creation-submission-store.postgres.test.ts` 在 T4 树是 **13**，在 T7 树（`codex/v31-fix-session-plan`）是 **14**——同一文件跨树相差一个用例。故本表**不是集成树基准**，只是对账用的下界。

### 单测（9 文件，合计 127）

| 文件（`apps/core/src/` 起） | tests | pass | fail | skip |
|---|---|---|---|---|
| `p1/agent-session/composer-plan-session.test.ts` | 12 | 12 | 0 | 0 |
| `p1/harness/make-snapshot-consume.test.ts` | 12 | 12 | 0 | 0 |
| `p1/execution-spine/composer-http.test.ts` | 27 | 27 | 0 | 0 |
| `p1/operations/agent-memory-platform.test.ts` | 13 | 13 | 0 | 0 |
| `p1/agent-session/intent-retrieval.test.ts` | 18 | 18 | 0 | 0 |
| `p1/operations/content-package-facts.test.ts` | 8 | 8 | 0 | 0 |
| `p1/operations/content-package-delivery.test.ts` | 28 | 28 | 0 | 0 |
| `p1/operations/content-package-revision-port.test.ts` | 5 | 5 | 0 | 0 |
| `evals/preference-memory/beauty-preference-memory.test.ts` | 4 | 4 | 0 | 0 |

### PG（10 文件，合计 42）

| 文件（`apps/core/src/` 起） | tests | pass | fail | skip |
|---|---|---|---|---|
| `p1/operations/postgres-memory-injection-receipt.postgres.test.ts` | 1 | 1 | 0 | 0 |
| `p1/operations/memory-sedimentation-pipeline.postgres.test.ts` | 1 | 1 | 0 | 0 |
| `p1/execution-spine/postgres-creation-submission-store.postgres.test.ts` | 13 | 13 | 0 | 0 |
| `p1/agent-session/postgres-agent-session-store.postgres.test.ts` | 14 | 14 | 0 | 0 |
| `p1/agent-session/postgres-plan-store.postgres.test.ts` | 2 | 2 | 0 | 0 |
| `p1/goal-proactive/postgres-goal-proactive.postgres.test.ts` | 1 | 1 | 0 | 0 |
| `p1/operations/result-signal-revision-migration.postgres.test.ts` | 1 | 1 | 0 | 0 |
| `p1/operations/note-page-regeneration.postgres.test.ts` | 3 | 3 | 0 | 0 |
| `p1/operations/postgres-result-adjust-snapshot.postgres.test.ts` | 2 | 2 | 0 | 0 |
| `p1/operations/postgres-semantic-event-store.postgres.test.ts` | 4 | 4 | 0 | 0 |

### 本表数字的取得条件（以及一条**不得**当作并发证据的观测）

上两张表的每个数字都是：一次性新库（`scripts/ci/provision-test-db.sh`）＋`--test-concurrency=1`＋**逐文件单跑**。逐文件是为了绕开 `locale:compile` 重写共享 paraglide 产物的冲突，不是为了规避并发问题。

**本域没有受控的并发 A/B，别去票面里找。** 我手上唯一一对聚合观测（`tests 32 / pass 31 / fail 1` 对 `tests 32 / pass 32 / fail 0`，相隔 88 秒）**不能**读成并发档位证据，三条理由：

1. 它出自 **fix-03 树**（`美业内容2-v31-fix-03`）跑 4 个文件（`postgres-interrupt-store` / `postgres-execution-confirmation` / `postgres-plan-store` / `postgres-creation-submission-store`），**不是**本表的 T4 树 10 文件集；
2. 那条红的签名是 `actual {attempted: 4, failed: 0, started: 4}` vs `expected {attempted: 1, failed: 0, started: 1}`（`postgres-creation-submission-store.postgres.test.ts:977` @ fix-03 树）——这是**库内残留可恢复行**的签名，即 V31-33 Evidence 第 3 行已记录的那个成因，与并发无关；
3. 第一次跑本身会把那 4 行**恢复掉**，第二次跑自然只看见自己的 1 行。所以第二次的绿至少有两个竞争解释（库态已被上一次消费 / 档位变化），本轮**没有做能区分二者的实验**，不得择一断言。

**结论**：本仓当前唯一有实测支撑的假红分类只有一条——V31-33 的「红的数字随库内行数缩放而非随断言缩放」。本会话**未观测到任何 `40P01`**（`grep -rl 40P01` 只命中仓内既有文档，无本轮日志）。谁要在票面上立「并发致红」这一类，得自己先做受控 A/B。

## 留痕

- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`，基座 `98949870a`）：把 L-CI 落的空 Evidence scaffold 按真实证据填实——writer/consumer/test 三列锚署集成树，结果数字署 T4 树 `8d74ad642` 一次性新库实测；给出 5 条 AC 的逐条勾选裁定（**全部不得勾选**，理由各异）；报出两个缺口（`agent-memory-platform.ts:547` 的 Business Fact 守卫零测试；Evidence 列集与本票 3 条非 PG/非浏览器轴的 AC 不匹配）；落 T4 域 per-file 对账基准（单测 9 文件＝127、PG 10 文件＝42）供 W4-A 对账。
- 同轮自我更正：初稿把一对聚合观测写成了「并发档位致红」，核证后发现该红出自 fix-03 树、签名是库内残留行（`attempted: 4`），且本会话零 `40P01` 实测——已改写为明确的「不得当作并发证据」并列出三条理由。**归因错误若不更正，会给后续 lane 一个不存在的假红分类去套。**
- 本 commit 对 `apps/core`、`mkfast-template-main`、`packages`、`scripts`、`.github` 零改动，未改 Status 与任何 checkbox。
- Wave 4 追加（同日，主控裁决 1＋2＋3）：Status 由裸 `done` 改为 `done (merged f190a7cf) — Wave-4 evidence audit: 5 AC 全数未验收，backfill 在途`（收口仍未填满则降级 `merged-with-evidence-debt`）；Evidence 表按新列集重填（新增 `unit/eval result` 一列，实测数字从 `failure-recovery test` 的括号里移进本轴，PG/Playwright 只留本轴结果）；`n/a` 与 `—` 逐条给出理由（表下说明 ①②③）；勾选裁定改按新规则重判（5 条仍全不可勾，但阻塞项精确到「差在树」「口径未定」「无门可跑」三类）；新增「补证命令」节，AC2/AC5 的精确命令＋期望输出形状＋三个陷阱（一次性库、exit code 取法、`skipped` 必须为 0）已写全供主控执行；AC1 预留 W4-B 任务 5 的 commit 引用位。**一处派件假设已纠正**：AC4 的浏览器证据**不能**由 b2 spec 回填——它在 `memory-vault-governance.spec.ts:234-235`（断言「来源对话已删除」，与 `zh.json:3372` 文案逐字一致），而 b2 spec 从不进 memory vault 页面；更要紧的是**没有任何 required job 跑那条 spec**（三条门脚本合计显式列举 27 条，仓内共 87 个 spec）。
- Wave 4 追加（同日）：落主控对 T4/T7 崩溃恢复语义碰撞的裁决（W4-A 发现，`composer-http.test.ts` 三红）——新建「裁决 — 恢复路径 P0-1 的满足机制变了」节，记双臂语义、`:777` 实施红线、`merchant_confirmed` 依据链（含 `recoverPendingStarts :1196-1209` 的代码级第二印证），并报出 `:1215-1219` 注释过宽须与测试重钉同批修正；W4-B 的 commit SHA 位留空待主控回填。**坐标更正两处**：P0-1 在本票票面此前**无落点**（是 T4 lane 内编号，真落点在代码注释），本节即为其正式落点；「时点」段的 `task-admission.ts:427` 是 T4 树行号，集成树上 `policy_exempt_copy` 实在 `:567`，已重锚。互引已同步至 V31-33 与 V31-41 的「关联」节。
