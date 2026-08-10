# V31-18 — Memory 扩列 + 双通道 + observation pipeline + 注入透明

**Parent**: spec-E（#5）`docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md`；权威 V3.1 §12、U4/U5
**Lane**: Memory 并行 lane（不阻塞批次 2-4 主线）｜ **语义锁**: 与 V31-19 同 lane 串行或双 worktree
**Blocked by**: V31-01（**working 切片内部另等 V31-06 的 checkpoint 单 writer**；preference/correction 切片可先行）
**Status**: merged-with-evidence-debt (merged f190a7cf) — Wave-4 evidence audit 收官（2026-08-10）：AC1／AC2／AC5 三条**已勾**（主控 2026-08-10 于 `0abdc36f` 亲手复现三组变异后授权，见「主控亲验记录」）；AC3（被 V31-55 阻断）与 AC4（`production-main-journey` 待首跑）的 Playwright 格仍为证据债。降级依据＝主控裁决 1 的既定条件「Wave-4 收口时仍未填满的 AC ⇒ 降级，不得保持裸 done」

## What to build

现有 preference 三表扩列（kind/authority/scope/decay/state）；五层认知分类；authority 双通道（Thread 内即时生效／跨 Thread 候选→商家确认，Extractor 经 onExtracted 落候选绝不直接生效）；working memory 抽取/投影策略经 V31-06 单 writer 落盘；检索只在合法 scope 最窄组合内排序（向量相似度永不决定 workspace/rights/fact/authority）；MemoryInjectionReceipt 注入清单可见可撤销；分离删除（A11 四类实体各自策略）；历史迁移只产 proposed。

## Acceptance criteria

- [x] 跨店泄漏=0；Business Fact 被 Memory 覆盖=0（放行门）
- [x] correction recurrence=0；false persistence=0
- [ ] 注入清单可见且撤销后不再注入（Playwright §37.4-B2）
- [ ] 删源对话→条目标「来源已删除」；删 memory→ApprovalReceipt 保留
- [x] retrieval precision 有离线评测

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
> **三个结果列的数字现已全部出自集成树**（唯二例外是 AC3／AC4 的 Playwright 格，理由见说明 ⑥／③）：
> 主控在 `a94520ee1` 上以一次性库 `meiye_v31_mc_ac_20260810_143143`(+`_dbos`)@54329 随建随清跑完
> 「补证命令」的命令 1–3，AC1／AC2 的 PG 轴由合并验收实跑覆盖（说明 ⑤）。
> **两树状态已收敛**：Wave-4 中途一度是「锚指集成树、数字来自 T4 树 `8d74ad642`」，那批 T4 数字
> 现已被本树实测替换，且**已证实过时**（用例数增量见 ⑤）。仅「per-file 对账基准」一节仍保留 T4 域
> 数字——它的用途是给 W4-A 做对账下界，不是本票的验收证据，两者不可互换。

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | `apps/core/src/p1/operations/agent-memory-platform.ts:547`（Business Fact 落 fact ledger，Memory 不得覆盖，抛错）；`:272-273`（store×IP×scene×platform 最窄 scope 过滤） | `apps/core/src/p1/agent-session/context-retrieval.ts:733` → `apps/core/src/assembly/core-assembly.ts:751` | `agent-memory-platform.test.ts:281`（cross-store isolation）/ `:348`（scope filter）；`intent-retrieval.test.ts:710`（并发 workspace 注入绑定隔离）。`:547` 守卫测试**已落地** ⇒ `agent-memory-platform.test.ts:113`（`onExtracted rejects a Business Fact key: the fact ledger owns it, not Memory`），commit **`0fa745c62`** merged **`7e66995eec`**；跨店 PG 断言 ⇒ `postgres-reuse-memory-repository.test.ts:293`（`Postgres cross-store isolation: workspace B never retrieves workspace A confirmed preferences`），commit **`d8e50fd8b`** merged **`7ed30ac5b`** | `14/14 pass`（agent-memory-platform）＋ `20/20 pass, skip 0`（intent-retrieval）——**集成树 `a94520ee1`** 实测（说明 ⑤） | `3/3 pass, skip 0`（合 `7ed30ac5b` 时实跑；该文件在 `a94520ee1` 上逐字未变，见说明 ⑤） | `n/a`（见表下说明 ④） | `core`（单测）＋ `core-persistence`（跨店 PG 断言） |
| AC2 | `apps/core/src/p1/operations/record-proposal-port.ts:72`（只落 proposed 候选，无路径写 preference head） | `apps/core/src/evals/preference-memory/runner.ts:92`（`false_persistence_rate` 出闸值） | `beauty-preference-memory.test.ts:13`（`false_persistence_rate===0`）/ `:14`（`superseded_old_value_reappeared===false`，即 correction recurrence 面）；`agent-memory-platform.test.ts:190`（correction 优先级恒高于 soft preference＋soft 衰减）；**PG 轴断言已落地** ⇒ `postgres-reuse-memory-repository.test.ts:247`（`Postgres false persistence gate: one correction signal lands zero rows in p1_preference_heads`），commit **`d8e50fd8b`** merged **`7ed30ac5b`** | `4/4 pass, skip 0`（beauty-preference-memory）＋ `14/14 pass`（agent-memory-platform）——**集成树 `a94520ee1`** 实测（说明 ⑤） | `3/3 pass, skip 0`（合 `7ed30ac5b` 时实跑；该文件在 `a94520ee1` 上逐字未变，见说明 ⑤） | `n/a`（见表下说明 ②） | `core`（eval 轴）＋ `core-persistence`（PG 轴） |
| AC3 | `apps/core/src/p1/operations/postgres-memory-injection-receipt.ts:72`（`save`，put-once＋payload 同一性校验） | `mkfast-template-main/src/product/memory-injection-receipt.tsx:65`（清单面板）/ `:43`（`action: 'revoke_memory'` 撤销） | `postgres-memory-injection-receipt.postgres.test.ts:28`（put-once＋重启可读）；`agent-memory-platform.test.ts:445`（撤销后不再注入） | `14/14 pass`（agent-memory-platform）——**集成树 `a94520ee1`** 实测（说明 ⑤） | `1/1 pass, skip 0`——**集成树 `a94520ee1`** 一次性库（说明 ⑤） | **本轮红**（W4-D round3 实跑，1 FAIL；红因**不在本 AC**——被 admission 变体② 阻断，见 V31-55，日志 `round3-per-spec/v31-memory-injection-b2-journey.log:243`） | `core-persistence`（PG 面）＋ `v31-browser-acceptance`（门脚本 `:39`）＋ `production-main-journey`（`run-pr-production-journey.sh:18`）——**两条 required 门都跑 B2 spec** |
| AC4 | `apps/core/src/p1/operations/postgres-reuse-memory-repository.ts:1332`（`source_deleted_at` → `status: 'deleted'` 投影）；`:1254`（列） | `mkfast-template-main/src/product/memory-vault-page.tsx:204`（`status === 'deleted'` → `memory_entry_source_deleted()`，zh 文案「来源对话已删除」） | `memory-sedimentation-pipeline.postgres.test.ts:248-251`（PG 断言 `source.status === 'deleted'`）；`agent-memory-platform.test.ts:652`（A11 分离删除）；浏览器面 `memory-vault-governance.spec.ts:234-235`（断言 `memory-entry-provenance` 含「来源对话已删除」，与文案逐字一致） | `14/14 pass`（agent-memory-platform）——**集成树 `a94520ee1`** 实测（说明 ⑤） | `1/1 pass, skip 0`——**集成树 `a94520ee1`** 一次性库（说明 ⑤） | `未跑`（`production-main-journey` 首次实跑后回填） | `production-main-journey`（`0fb784658` 起，见表下说明 ③） |
| AC5 | `apps/core/src/evals/preference-memory/retrieval-eval.ts` ＋ `retrieval-baseline.json` / `retrieval-dataset.json`（版本化数据集＋基线） | `apps/core/src/evals/preference-memory/beauty-preference-memory.test.ts:49`（版本化数据集对**真实平台**跑检索） | `beauty-preference-memory.test.ts:20`（注入一次自动晋升后**必须变红**，即该评测有鉴别力而非恒绿）；`agent-memory-platform.test.ts:766`（离线 precision scorer ＋ kill switch） | `4/4 pass, skip 0`（beauty-preference-memory）＋ `14/14 pass`（agent-memory-platform）——**集成树 `a94520ee1`** 实测（说明 ⑤） | `n/a`（见表下说明 ②） | `n/a`（见表下说明 ②） | `core` |

### 表下说明（`n/a` 与 `—` 的逐条理由，新填表规则要求）

**①（AC2 的 PG 轴，已裁 ⇒ 双轨，不许 `n/a`）**：`false_persistence` 字面承诺的就是「**不落库**」，而 `runner.ts:92` 的 `false_persistence_rate` 只在内存中对数据集度量，**证不了存储边界**。主控裁决（2026-08-10）：**eval 轴为主证照填实测，PG 轴另立**——已给 **W4-B 任务 5 扩一条**：最小 PG 断言「假持久化尝试后 store 无行」；若既有 PG 测试已覆盖则引用现成的填格。故该格为 `未跑（W4-B 任务 5 在途）`，**不得改成 `n/a`**。

**②（AC2 / AC5 的 `n/a`）**：AC2 的浏览器面为 `n/a`，因为 correction 复发与 false persistence 都不经商家可见界面表达，浏览器上无可断言之物。AC5 的 PG 与浏览器双 `n/a`，因为 **AC 原文就是「retrieval precision 有离线评测」**——它的证据轴按定义即离线评测，要求 PG 或浏览器证据属于给 AC 加码。

**③（AC4 的浏览器面：断言一直在，门是刚接上的）**：AC4 的浏览器断言**早就存在且精确**——`mkfast-template-main/tests/e2e/specs/memory-vault-governance.spec.ts:234-235` 断言 `memory-entry-provenance` 含「来源对话已删除」，与 `project.inlang/messages/zh.json:3372` 的 `memory_entry_source_deleted` 文案**逐字一致**。本轮报出两件事，其中第二件主控已当场修掉：

1. **它不能由 W4-D 的 b2 spec 回填**（仍然成立）。b2 spec（`v31-memory-injection-b2-journey.spec.ts`）的断言面只有 `memory-injection-receipt-{panel,statement,revoke-*,entry-*}` 与 `agent-workbench-host`，**从不进入 memory vault 页面**。AC4 的界面在另一个页面、另一条 spec 上。
2. **「无门可跑」已解除** ⇒ 主控以 `0fb784658`（`ci(gates): run memory-vault-governance in the required production journey`）把该 spec 纳入 `run-pr-production-journey.sh` 的必跑集（显式条目风格保持，变量 `memory_vault_governance_spec`），并在**同一 commit** 同步 `quality-gates.test.mjs` 的钉字串（14/14 绿）。该 commit 的注释自己写明了病历：「no required gate ran it until this entry」。所以 AC4 的 `required CI job` 现填 `production-main-journey（0fb784658 起）`，浏览器结果格等**该门首次实跑**后回填。

**遗留的大面（已按主控批复并入 V31-49 作为 audit 项）**：门是显式列举的，三条门脚本（v31 / p2 / production-journey）在 `0fb784658` 上合计列举 **28 条**（其中 3 条文件还不存在，即 V31-49 的三缺），实际覆盖 **25** 条；而 `tests/e2e/specs/` 下共 **87** 个 `.spec.ts` ⇒ **62 个 spec 不在任何必跑门内**。AC4 只是这 62 个里被 V31-18 撞上的一例。全量归类归 V31-49。

**④（AC1 的两个轴，已裁 ⇒ PG 要求、Playwright `n/a`）**：主控裁决（2026-08-10）——

- **PG 轴＝要求**。「跨店泄漏=0」的**承重层在服务端检索的 workspace 域定**，与 V31-39「decide 四层防线」的**第 ④ 层同构**（都是「租户收窄必须发生在 SQL 谓词里，不能只靠上层过滤」）。AC1 现有两处单测（`agent-memory-platform.test.ts:281`/`:348`）压不到 SQL 谓词层，所以不能算证完。已挂 **W4-B 任务 5 第三件**：最小 PG 断言「**workspace B 的记忆检索拿不到 A 的行**」；若既有 PG 测试已覆盖则引用现成的填格。故该格 `未跑（W4-B 任务 5 在途）`。
- **Playwright 轴＝`n/a`**。跨店泄漏的浏览器面需要**双 workspace 会话编排**，成本高，而执行点在服务端检索层——单测 ＋ PG 谓词层证据已压住承重层，浏览器再走一遍只是重复覆盖低价值路径。**若未来出现双店旅程，此格升级为要求**（这是 `n/a` 的正确用法：声明当下无要求并写明何时会变）。

**顺带记一句方法论**：AC1 的 PG 轴与 V31-39 第 ④ 层同构这件事，说明「租户收窄压在哪一层」是本仓的**一类反复出现的承重点**，不是某张票的个别问题。V31-39 那两条断言的变异背书（改 store 的 WHERE 就能让断言单独翻红）正是这类断言该有的形状——**AC1 的 PG 断言落地时应照同一形状写，即变异 SQL 谓词必须让它翻红**，而不是只断言返回结果为空（空也可能因为库里本来就没数据）。

**⑤（三个结果列的数字来源，以及逐文件交叉校验）**：全部由**主控亲跑**（本 lane 是纯文档树、无 `node_modules`，跑不了）。命令 1–3 在**集成树 `a94520ee1`** 上一次跑完，一次性库 `meiye_v31_mc_ac_20260810_143143`(+`_dbos`)@54329 随建随清；AC1／AC2 的 PG 轴由 W4-B 任务 5 合并验收时的实跑覆盖（`0fa745c62` merged `7e66995eec`、`d8e50fd8b` merged `7ed30ac5b`）：

| 文件 | 结果 | 填哪些格 | 运行条件 |
|---|---|---|---|
| `beauty-preference-memory.test.ts` | **4/4 pass, skip 0** | AC2／AC5 的 unit/eval | 命令 1 @ `a94520ee1` |
| `agent-memory-platform.test.ts` | **14/14 pass** | AC1–AC5 全部 unit/eval | 命令 2 @ `a94520ee1`，node 单测无需 DB |
| `intent-retrieval.test.ts` | **20/20 pass, skip 0** | AC1 的 unit/eval | 命令 2 @ `a94520ee1` |
| `postgres-memory-injection-receipt.postgres.test.ts` | **1/1 pass, skip 0** | AC3 的 PG | 命令 3 @ `a94520ee1`，上述一次性库 |
| `memory-sedimentation-pipeline.postgres.test.ts` | **1/1 pass, skip 0** | AC4 的 PG | 命令 3 @ `a94520ee1`，同库 |
| `postgres-reuse-memory-repository.test.ts` | **3/3 pass, skip 0** | AC1／AC2 的 PG | 合 `7ed30ac5b` 时，一次性库 `meiye_v31_mc_t5v_20260810_05xxxx`@54329（后四位主控消息中省略，未代填） |

**交叉校验（review-memory 复核，六个数字逐一对齐后采信）**：在 `a94520ee1` 上数各文件的 `test(` 声明数，与上表结果数**一一相等**——`4 / 14 / 20 / 1 / 1 / 3`。三处相对 T4 树的增量**都有出处**，不是不明增量：

| 文件 | T4 `8d74ad642` → `a94520ee1` | 增量归属 |
|---|---|---|
| `agent-memory-platform.test.ts` | 13 → **14** | `0fa745c62` 的那一条 Business Fact 守卫单测（`:113`） |
| `intent-retrieval.test.ts` | 18 → **20** | `b7dd90cd9`（`a release that pins no Intent/retrieval middleware is rejected, not repaired`）与 `11b87eef8`（`platform requirements use the server-bound turn platform when model args omit it`）各一条——**两条都不是记忆面**，只是恰在同一文件；符合「只许 ≥」的读法硬规则 |
| `postgres-reuse-memory-repository.test.ts` | 1 → **3** | `d8e50fd8b` 的 `:247`（假持久化零行）＋ `:293`（跨店隔离） |

**AC1／AC2 的 PG 数字不是在 tip 上取的，补强方式如下**：`git diff 7ed30ac5b a94520ee1` 对 `postgres-reuse-memory-repository.test.ts`**与被测生产文件** `postgres-reuse-memory-repository.ts`／`agent-memory-platform.ts` **三者均为空**，即测试与被测代码在此区间逐字未变，故该数字对 `a94520ee1` 仍然成立。**这是「数字未在 tip 取」唯一可接受的补强形状**：证明被测文件本身未变，而不是「时间上离得近所以应该没变」。仍需注意它**不证明依赖链未变**——若日后要更严，直接在 tip 上按命令 4 复跑一次即可。

**⑥（AC3 的 Playwright 格为什么记「本轮红」而不是 `未跑`）**：W4-D round3 **确实跑了** b2 spec（`round3-per-spec/SUMMARY.txt`：`exit=1 fail=[1 failed]`），所以它不是「没跑」。但那条红**不是 AC3 的行为不成立**——它死在 admission 变体②（`context head drifted after freeze` → 客户端 `IDEMPOTENCY_CONFLICT`，日志 `:226-227` → `:243`），即**在触达注入清单/撤销断言之前**。所以 AC3 的浏览器面结论是「**跑了、被别的缺陷挡住、本 AC 的行为仍未被证实**」，解除依赖 **V31-55**。这一格不得因为「跑过了」就当作已验收，也不得因为「红了」就记成 AC3 失败。

### 勾选裁定（按**新**填表规则逐条判）

新规则＝四列非空 **且** 三个结果格全为真实结果或 `n/a`。命令 1–3 回填后，判定从「5 条全不可勾」变为**3 满足 / 2 阻塞**：

| AC | 规则判定 | 状态 | 待办 |
|---|---|---|---|
| AC1 | **满足**（unit/eval `14/14`＋`20/20`；PG `3/3`；Playwright 合法 `n/a`） | **已勾** | 主控 `0abdc36f` 变异 1＋2 亲验后授权（`:113`／`:293` 两条断言各恰红一条） |
| AC2 | **满足**（unit/eval `4/4`＋`14/14`；PG `3/3`；Playwright 合法 `n/a`） | **已勾** | 主控授权；**但 `:247` 未做变异**，见「主控亲验记录」的残留项 |
| AC3 | **不满足**：Playwright **本轮红**，且红因不在本 AC | 阻塞 | V31-55（admission 变体②）解除后复跑 b2 spec（说明 ⑥） |
| AC4 | **不满足**：Playwright `未跑` | 待首跑 | `production-main-journey` 首跑后回填浏览器格（说明 ③） |
| AC5 | **满足**（unit/eval `4/4`；PG／Playwright 均为合法 `n/a`） | **已勾** | 主控授权；其鉴别力本就由 `beauty-preference-memory.test.ts:20` 自带（该断言的语义就是「必须变红」） |

**本轮仍未勾任何 checkbox。** 勾选是验收裁决而非事实登记，按本 lane 纪律须主控明示授权——Wave-4 中我曾无授权勾过 V31-39 两处并自行还原，这里不重犯。

**勾选前的一条保留意见（已由主控处置，处置结果见下节；原文保留以备回溯）**：那三条**新落地的断言只证明了「绿」，没证明「有鉴别力」**——`agent-memory-platform.test.ts:113`（Business Fact 守卫）、`postgres-reuse-memory-repository.test.ts:293`（跨店 PG 隔离）、`:247`（假持久化零行），**都没做过变异背书**。这恰好是说明 ④ 下方那条方法论明文要求的形状：**变异 SQL 谓词必须让断言翻红**，而不是只断言结果为空——空也可能因为库里本来没数据；同理把 `agent-memory-platform.ts:547` 的抛错改成 warn，`:113` 是否翻红也未验。对比先例：V31-39 的两条断言是做过双向变异（baseline `17/17` → A `16/17` → B `16/17` → 双还原 `17/17`）才勾的，**AC1／AC2 现在的证据强度低于那个先例**。两个处置选项——**(a)** 照 V31-39 先例补三次变异（改 `:547` 抛错为 warn、改 `:293`／`:247` 的 workspace 谓词）再勾；**(b)** 认「绿即可勾」，并在本票留下这条证据强度差的记录。**我不代裁**：这是验收标准问题，不是事实问题。

### 主控亲验记录（2026-08-10，集成树 `0abdc36f`）

主控选了上面的选项 **(a)**——补变异再勾。三组变异在一次性库 `meiye_v31_mc_mut_20260810_144449`（已销毁）上亲手复现，**每组均「恰红一条＝目标断言」**，与 V31-39 先例同标准；树已 porcelain 清净。

| 变异 | 改动点 | 结果 | 翻红的断言 | 还原 |
|---|---|---|---|---|
| 1 | `agent-memory-platform.ts:547` 守卫改 `if (false && ...)` | `agent-memory-platform.test.ts` 13 过 1 红 | `onExtracted rejects a Business Fact key: the fact ledger owns it, not Memory`（＝`:113`） | `14/14` 绿 |
| 2 | `postgres-reuse-memory-repository.ts:947` 的 `WHERE heads.workspace_id = $1` → `WHERE (TRUE OR ...)`（**仅 `:947` 一处**，`:559`／`:638` 未动） | `postgres-reuse-memory-repository.test.ts` 2 过 1 红 0 跳 | `Postgres cross-store isolation: workspace B never retrieves workspace A confirmed preferences`（＝`:293`） | `3/3` 绿 0 跳 |
| 3 | `reuse-memory-service.ts:1205` `byTask.size < 3`→`< 1` ＋ `:1260`／`:1261` `taskIds.size`／`decisionIds.size < 3`→`< 1`（双重削弱） | `reuse-memory-service.test.ts` 11 过 1 红 | `three independent modification signals create one deterministic pending candidate`（＝`:288` 的 `candidate === null`） | `12/12` 绿 |

**review-memory 只读核证（三组坐标全部对上）**：`:947` 确为 `listPreferenceHeads` 取数 SQL 的 `WHERE heads.workspace_id = $1`；`:559`／`:638` 确实是同文件另两处 `heads.workspace_id = $1` 谓词（该文件共 **49** 处 `workspace_id = $1` 谓词，主控点名的是最同形的两处），「仅动一处」这个说法可核；`reuse-memory-service.ts:1205`／`:1260-1261` 的阈值代码逐字相符；`reuse-memory-service.test.ts` 在 `0abdc36f` 上共 **12** 条 `test(`，与「11 过 1 红 → 还原 12/12」自洽。

**两条如实归属（勾框不受影响，但台账不能写成「三条断言全被变异背书」）**：

1. **`postgres-reuse-memory-repository.test.ts:247`（AC2 的假持久化零行）没有被变异覆盖。** 变异 2 只动 `listPreferenceHeads` 的读侧谓词，翻红的是 `:293`；`:247` 断言的是「写侧零行」，读侧谓词放宽不影响它，所以它在变异 2 下**本就应该保持绿**。即我那条保留意见点的三条断言里，`:113` 与 `:293` 已背书，**`:247` 仍未背书**。要补的话对应变异是「让 correction 信号真的落一行 preference head」（写侧），不是改 WHERE。
2. **变异 3 背书的是 `reuse-memory-service.test.ts:288`，而该文件在本票中引用数为 0。** AC5 的证据行引的是 `beauty-preference-memory.test.ts:20`（注入一次自动晋升后必须变红）与 `agent-memory-platform.test.ts:766`（离线 precision scorer ＋ kill switch），并不包含 `reuse-memory-service.test.ts`；而 `:1205`／`:1260` 那组阈值在语义上属于**候选晋升门**（更靠 AC2 的 false-persistence 家族），不是 AC5 的「离线评测存在且有鉴别力」。所以变异 3 是一条**有效但落在别处**的鉴别力证据——它证明了晋升门有测试兜住，**不能记成 AC5 断言的变异背书**。AC5 的勾选依据仍是：三格为 `4/4` ＋ 两个合法 `n/a`，且 `beauty-preference-memory.test.ts:20` 这条断言的语义本身就是「必须变红」（自带鉴别力，不需要外部变异）。

**主控另附一条判断，采纳并记下**：变异 3 下 propose 侧的 rejects 测试仍绿，是因为第二层 persisted-evidence 交叉核对未被削弱兜住了——**这层纵深本身是有效防线，不算断言失鉴别力**。这条口径对后续做变异背书有普适价值：单点变异不翻红时，先分清是「断言没鉴别力」还是「另一层防线先拦住了」，两者的处置完全不同。

### 补证命令（**命令 1–3 主控已于 `a94520ee1` 执行完毕、全部达标**；命令 4 由 W4-B 合并验收覆盖。整节保留以备回归复跑）

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

期望输出形状：`exit=0`，且 `ℹ tests 4 / ℹ pass 4 / ℹ fail 0 / ℹ skipped 0`。**若 tests < 4 即为回归信号**（T4 树下界＝4，见「per-file 对账基准」的读法硬规则）。

**实测（`a94520ee1`）：`4/4 pass, skip 0`，exit=0——恰在下界上，无增量。** 已填进 AC2／AC5 的 `unit/eval result`。

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

**实测（`a94520ee1`）：`agent-memory-platform` `14/14`、`intent-retrieval` `20/20 pass, skip 0`，两个 exit=0。** 都在下界之上且**增量已逐条归因**（说明 ⑤ 的增量表），不是不明多出。

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

**实测（`a94520ee1`，一次性库 `meiye_v31_mc_ac_20260810_143143`）：两个都 `1/1 pass, skip 0`，exit=0。** 已填进 AC3／AC4 的 `PG result`。

**命令 4 — AC1 / AC2 的 PG 轴（W4-B 已落地的两条断言，一次跑完）**：

```bash
cd <集成树>/apps/core
./node_modules/.bin/tsx --test --test-concurrency=1 \
  src/p1/operations/postgres-reuse-memory-repository.test.ts > /tmp/ac12pg.log 2>&1; echo "exit=$?"
grep -E '^ℹ (tests|pass|fail|skipped)' /tmp/ac12pg.log
```

期望：`exit=0`、`fail 0`、**`skipped 0`**，且用例数 **≥ 3**（原有 1 条 ＋ `d8e50fd8b` 新增 2 条：`:247` 假持久化零行、`:293` 跨店隔离）。跑绿后 AC1 与 AC2 的 PG 格各填该文件的实测结果并署集成树 SHA。**若 `skipped` 非 0，说明 `TEST_DATABASE_URL` 没生效，那不是绿。**

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
- **终盘对账收官（2026-08-10，主控补料回填）**：AC1／AC2 的 PG 格由 `未跑` 换成**主控合并验收实跑**的数字——`postgres-reuse-memory-repository.test.ts` **3/3 pass skip 0**（一次性库 `meiye_v31_mc_t5v_20260810_05xxxx`@54329 随建随清，后四位主控原文省略、未代填）、`agent-memory-platform.test.ts` **14/14**。review-memory 做了一次**交叉校验**并采信：前者在 `7ed30ac5b` 上恰好 3 条 `test(`、后者从 T4 树的 13 条增为 14 条（＝`0fa745c62` 新增的那一条守卫单测），**两个数字都是用例数与结果数逐一对齐而非勉强吻合**。AC1／AC2 现在只差 unit/eval 未在本树取数（命令 1＋2），PG 轴已闭。
- **终盘对账（2026-08-10，review-memory）**：W4-B 任务 5 三件全部落地并合入，已按已合入证据回填——AC1 的 `:547` 守卫测试 ⇒ `agent-memory-platform.test.ts:113`（`0fa745c62` merged `7e66995eec`）；AC1 跨店 PG 断言 ⇒ `postgres-reuse-memory-repository.test.ts:293`、AC2 假持久化 PG 断言 ⇒ 同文件 `:247`（均 `d8e50fd8b` merged `7ed30ac5b`）；两处 `required CI job` 补上 `core-persistence`。**两个 PG 格仍记 `未跑` 而非数字**（新增说明 ⑤）：测试存在 ≠ 测试跑过并绿，本 lane 无 node_modules 也无 W4-B 的运行日志，按三态规则不得因 commit 已合入就填 pass；新增「命令 4」供一次跑完两条断言。**AC3 的浏览器格记「本轮红」并注明红因不在本 AC**（新增说明 ⑥）：W4-D round3 确实跑了 b2 spec，但死在 admission 变体②（`:226-227` → `:243`）、未触达注入清单与撤销断言，解除依赖 V31-55。勾选裁定表三行同步重判。**本票 `待补录` 至此清零。**
- Wave 4 追加（同日，最后一对轴已裁）：**AC1 的 PG 轴＝要求、Playwright 轴＝`n/a`**（主控裁决）。PG 轴的理由是承重层在服务端检索的 workspace 域定、**与 V31-39「decide 四层」第 ④ 层同构**，现有两处单测压不到 SQL 谓词层 ⇒ 挂 W4-B 任务 5 第三件「workspace B 检索拿不到 A 的行」；Playwright 轴 `n/a` 的理由已按三态规则写明（需双 workspace 会话编排、成本高、执行点在服务端，**若未来出现双店旅程则升级为要求**）。同时把 AC1 的 `待补录` 扩注为任务 5 的**三件**，并记下一条方法论：跨店 PG 断言应照 V31-39 变异背书的形状写——**变异 SQL 谓词必须让它翻红**，而不是只断言结果为空（空也可能因为库里本来没数据）。**至此本票 Evidence 表所有轴声明完毕，无未定格。**
- Wave 4 追加（同日，主控三件批复回填）：**AC4 的「无门可跑」已由主控 `0fb784658` 解除**（`memory-vault-governance.spec.ts` 进 `run-pr-production-journey.sh` 必跑集，`quality-gates.test.mjs` 同 commit 同步、14/14 绿），`required CI job` 填 `production-main-journey（0fb784658 起）`、浏览器结果格等该门首跑；**AC2 的 PG 轴按裁决改为双轨**（eval 为主证、PG 另立最小断言「假持久化尝试后 store 无行」，已扩进 W4-B 任务 5），该格填 `未跑（W4-B 任务 5 在途）`且**明令不得改 `n/a`**；说明 ①③ 与勾选裁定表同步重写。**顺带把「不在任何必跑门」的数字算准**：`0fb784658` 上三门合计列举 28 条（含 3 条文件不存在）、实际覆盖 25 条，仓内 87 个 spec ⇒ **62 个无门可跑**，全量归类已按批复并入 V31-49。
- Wave 4 追加（同日）：落主控对 T4/T7 崩溃恢复语义碰撞的裁决（W4-A 发现，`composer-http.test.ts` 三红）——新建「裁决 — 恢复路径 P0-1 的满足机制变了」节，记双臂语义、`:777` 实施红线、`merchant_confirmed` 依据链（含 `recoverPendingStarts :1196-1209` 的代码级第二印证），并报出 `:1215-1219` 注释过宽须与测试重钉同批修正；W4-B 的 commit SHA 位留空待主控回填。**坐标更正两处**：P0-1 在本票票面此前**无落点**（是 T4 lane 内编号，真落点在代码注释），本节即为其正式落点；「时点」段的 `task-admission.ts:427` 是 T4 树行号，集成树上 `policy_exempt_copy` 实在 `:567`，已重锚。互引已同步至 V31-33 与 V31-41 的「关联」节。
- **Wave 4 终局回填（2026-08-10，主控实跑命令 1–3 后）**：三个结果列的数字**全部换成集成树 `a94520ee1` 实测**，两树状态收敛——`beauty-preference-memory` `4/4 pass skip 0`、`agent-memory-platform` `14/14`、`intent-retrieval` `20/20 pass skip 0`、`postgres-memory-injection-receipt` `1/1 pass skip 0`、`memory-sedimentation-pipeline` `1/1 pass skip 0`（一次性库 `meiye_v31_mc_ac_20260810_143143`，随建随清），AC1／AC2 的 PG `3/3 pass skip 0` 沿用 `7ed30ac5b` 实跑但**已补强署到 tip**（测试文件与被测生产文件 `postgres-reuse-memory-repository.ts`／`agent-memory-platform.ts` 三者 diff 皆空，故数字在 `a94520ee1` 仍成立）。review-memory 做了**六文件逐一交叉校验**（`test(` 声明数＝结果数：4/14/20/1/1/3），并把三处相对 T4 的增量逐条归因：`+1`＝`0fa745c62` 守卫单测；`+2`＝`b7dd90cd9` 与 `11b87eef8` 各一条（**两条都不是记忆面**，只是同文件，符合「只许 ≥」规则）；`+2`＝`d8e50fd8b` 的 `:247`／`:293`。勾选裁定由「5 条全不可勾」重判为 **AC1／AC2／AC5 已满足规则待授权、AC3（V31-55 阻断）／AC4（门待首跑）仍不满足**；**本轮仍未勾任何 checkbox**（勾选须主控明示授权）。同时留下**一条保留意见**：`:113`／`:293`／`:247` 三条新断言只证了绿、**未做变异背书**，证据强度低于 V31-39 先例（那两条是双向变异 `17/17→16/17→16/17→17/17` 才勾的），给出补变异 / 认绿即勾两个处置选项，**不代裁**。Status 按主控裁决 1 的既定条件正式降级为 `merged-with-evidence-debt`，理由收窄为 AC3／AC4 两个 Playwright 格，不再是「5 AC 全数未验收」（那句现已为假）。
- **Wave 4 勾框（2026-08-10，主控三组变异亲验后授权）**：**AC1／AC2／AC5 三框已勾**（AC3／AC4 保持未勾，仍是那两个 Playwright 格的证据债）。授权前主控选了我给的选项 (a)——补变异再勾，在集成树 `0abdc36f` 一次性库 `meiye_v31_mc_mut_20260810_144449`（已销毁）上亲手复现三组变异，**每组恰红一条＝目标断言**，与 V31-39 先例同标准，明细见「主控亲验记录」节。review-memory 只读核证三组坐标全部对上（`:947` 确为 `listPreferenceHeads` 读侧谓词、该文件共 49 处 workspace 谓词故「仅动一处」可核；`reuse-memory-service.test.ts` 在 `0abdc36f` 上 12 条 `test(`，与「11 过 1 红 → 还原 12/12」自洽），并如实记下**两条归属残留**，不把台账写成「三条断言全被变异背书」：① **`:247`（AC2 假持久化零行）仍未背书**——变异 2 只放宽读侧谓词，`:247` 断的是写侧零行，本就应保持绿，要补需另做「让 correction 真落一行 head」的写侧变异；② **变异 3 背书的 `reuse-memory-service.test.ts:288` 在本票引用数为 0**，且 `:1205`／`:1260` 那组阈值语义属候选晋升门（更靠 AC2 的 false-persistence 家族），**不是** AC5 的离线评测轴，故记为「有效但落在别处」的鉴别力证据；AC5 的勾选依据仍是三格 `4/4`＋两个合法 `n/a`，且 `beauty-preference-memory.test.ts:20` 的语义本身就是「必须变红」（自带鉴别力）。另采纳主控一条普适口径：**单点变异不翻红时先分清是「断言没鉴别力」还是「另一层防线先拦住了」**（本例是 persisted-evidence 交叉核对这层纵深兜住 propose 侧 rejects 测试），两者处置完全不同。
