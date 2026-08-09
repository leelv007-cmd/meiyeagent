# V31-18 — Memory 扩列 + 双通道 + observation pipeline + 注入透明

**Parent**: spec-E（#5）`docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md`；权威 V3.1 §12、U4/U5
**Lane**: Memory 并行 lane（不阻塞批次 2-4 主线）｜ **语义锁**: 与 V31-19 同 lane 串行或双 worktree
**Blocked by**: V31-01（**working 切片内部另等 V31-06 的 checkpoint 单 writer**；preference/correction 切片可先行）
**Status**: done (merged f190a7cf, 2026-08-08)

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

**时点**：与 V31-18 P1-8 的绑定时刻相同——即 `merchant_confirmed` 真正拿到 ExecutionPlanSnapshot 之时（当前 `apps/core/src/p1/harness/task-admission.ts:427` 只放行 `policy_exempt_copy`，所以 note/media 走 legacy，两者都还没生效面）。**故现在不接线**，由 integration 波按本节作为已定规格消费，避免变成孤儿。

**原语位置（integration 直接取用）**：
- `assessMemoryStyleCompliance(candidate, style)` — `apps/core/src/p1/harness/make-snapshot-consume.ts:283`，纯函数、CJK 感知，返回 `{passed, violations}`，`MemoryStyleViolation` 覆盖 max_title_chars / max_body_chars / max_sentence_chars / forbidden_phrase。
- `describeMemoryStyleViolations(violations)` — 同文件，商家可读文案（advisory annotation 直接用）。
- 单测 `V31-18 P1-5: real output is measured against the confirmed style, not the prompt` — 对违规与合规真实输出双向断言，含「无注入记忆不得凭空造约束」。

**同一次变更内必须一起做**：删除 `ai-sdk-runner.ts:1657` 的 fixture 自读 prompt 作弊，改为让 fixture 产出**真正合规**的输出（而非被正则触发的硬编码）。否则接线后门会因为错误的理由变绿。

**附带记录（P2-9，契约即天花板）**：`planMemoryContextSchema`（`packages/contracts/src/agent-domain.ts:480-509`）是 `.strict()`，`tones` 是封闭二值枚举上限 2，`entries` 只带 `{memoryId, revision}`，唯一能承载自由文本的字段是 `forbiddenPhrases`（20×100 字符）且被硬编码 `['绝对','保证','必然']` 占满。两条正则对 join 后的 statements 取值，无论确认了 1 条还是 8 条偏好都只有 4 个可达状态；**未命中任何正则的条目仍会进 `entries`**，于是 receipt 声称已注入、下游零影响——与 P1-8 同类的透明度谎报。承载任意偏好需改上述 schema + `make-snapshot-consume.ts` 的读取端，**与本节接线同一时点执行**。

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

> **锚署树（Wave 4 回填时立）**：writer / consumer / test 三列行号出自**集成树** `codex/v31-integration` @ `98949870a`。
> PG result 与 failure-recovery test 括号内的通过数出自 **T4 树** `codex/v31-fix-memory-outcome` @ `8d74ad642`
> 在 `provision-test-db.sh` 一次性新库上 `--test-concurrency=1` 的实测（原始 per-file 见下节「per-file 对账基准」）。
> **两套树不同**是刻意的：数字只能来自真跑过的树，锚必须指向合入去向的树；不得把任一方冒充另一方。

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | `apps/core/src/p1/operations/agent-memory-platform.ts:547`（Business Fact 落 fact ledger，Memory 不得覆盖，抛错）；`:272-273`（store×IP×scene×platform 最窄 scope 过滤） | `apps/core/src/p1/agent-session/context-retrieval.ts:733` → `apps/core/src/assembly/core-assembly.ts:751` | `apps/core/src/p1/operations/agent-memory-platform.test.ts:281`（cross-store isolation）/ `:348`（scope filter）（13/13 pass）；`apps/core/src/p1/agent-session/intent-retrieval.test.ts:710`（并发 workspace 注入绑定隔离，18/18 pass）。**`:547` 守卫零测试**——见下节「回填暴露的两个缺口」① | — | — | `core` |
| AC2 | `apps/core/src/p1/operations/record-proposal-port.ts:72`（只落 proposed 候选，无路径写 preference head） | `apps/core/src/evals/preference-memory/runner.ts:92`（`false_persistence_rate` 出闸值） | `apps/core/src/evals/preference-memory/beauty-preference-memory.test.ts:13`（`false_persistence_rate===0`）/ `:14`（`superseded_old_value_reappeared===false`，即 correction recurrence 面）（4/4 pass）；`agent-memory-platform.test.ts:190`（correction 优先级恒高于 soft preference＋soft 衰减，13/13 pass） | — | — | `core` |
| AC3 | `apps/core/src/p1/operations/postgres-memory-injection-receipt.ts:72`（`save`，put-once＋payload 同一性校验） | `mkfast-template-main/src/product/memory-injection-receipt.tsx:65`（`data-testid="memory-injection-receipt-panel"` 清单面板）/ `:43`（`action: 'revoke_memory'` 撤销） | `apps/core/src/p1/operations/postgres-memory-injection-receipt.postgres.test.ts:28`（put-once＋重启可读）；`apps/core/src/p1/operations/agent-memory-platform.test.ts:445`（撤销后不再注入，13/13 pass） | `1/1 pass` | — | `core-persistence`（PG 面）＋ `v31-browser-acceptance`（B2 面） |
| AC4 | `apps/core/src/p1/operations/postgres-reuse-memory-repository.ts:1332`（`source_deleted_at` → `status: 'deleted'` 投影）；`:1254`（列） | `mkfast-template-main/src/product/memory-vault-page.tsx:204`（`status === 'deleted'` → `memory_entry_source_deleted()` 文案） | `apps/core/src/p1/operations/memory-sedimentation-pipeline.postgres.test.ts:248-251`（PG 上断言 `source.status === 'deleted'`）；`apps/core/src/p1/operations/agent-memory-platform.test.ts:652`（A11 分离删除：删 memory 保留 ApprovalReceipt，13/13 pass） | `1/1 pass` | — | `core-persistence` |
| AC5 | `apps/core/src/evals/preference-memory/retrieval-eval.ts` ＋ `retrieval-baseline.json` / `retrieval-dataset.json`（版本化数据集＋基线） | `apps/core/src/evals/preference-memory/beauty-preference-memory.test.ts:49`（版本化数据集对**真实平台**跑检索） | `apps/core/src/evals/preference-memory/beauty-preference-memory.test.ts:20`（注入一次自动晋升后**必须变红**，即该评测有鉴别力而非恒绿）；`agent-memory-platform.test.ts:766`（离线 precision scorer ＋ kill switch）（4/4 ＋ 13/13 pass） | — | — | `core` |

### 勾选裁定（按「一行未填满，对应 AC 不得勾选」逐条判）

**5 条 AC 全部不得勾选**，理由各不相同，不要合并处理：

| AC | 缺哪一格 | 是「没跑」还是「没有」 |
|---|---|---|
| AC1 | PG result / Playwright result 皆 `—`；且 writer `:547` 无对应测试 | **既没跑也没有**——`:547` 守卫的测试全仓不存在（缺口①） |
| AC2 | PG result / Playwright result 皆 `—` | **没跑**（该 AC 的证据轴是离线评测，非 PG/浏览器；属列集不匹配，见缺口②） |
| AC3 | Playwright result `—` | **没跑**——B2 spec 文件存在（`mkfast-template-main/tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts`，已在 `scripts/ci/run-v31-browser-acceptance.sh:39` 的清单内），本轮未执行 |
| AC4 | Playwright result `—` | **没跑**（AC4 无浏览器验收要求，同属列集不匹配） |
| AC5 | PG result / Playwright result 皆 `—` | **没跑**（同 AC2） |

即：**本票 Status 已是 `done (merged f190a7cf)`，而 5 条 AC 的验收框一条未勾**。这不是本轮回填造成的，回填只是把它显式化了——请主控在合入时一并裁决「done 但 AC 全空」的口径（是补跑补勾，还是把 Status 降级）。本轮**未改动 Status 与任何 checkbox**。

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
