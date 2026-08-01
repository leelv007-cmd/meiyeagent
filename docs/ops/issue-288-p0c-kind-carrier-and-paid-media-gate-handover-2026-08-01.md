# #288 P0-C 交底 —— ContentPackage 载体三枚举合同起步 + 付费媒体确认门判定

- 分支：`lane/288-p0c-kind-contract`（worktree `lane-288`）；**未 push、未关票**，合入与批换锚由主控执行。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §3.1 / §3.2 / §3.4 / §8.1（P0-6、P0-7）/ §8.4 硬序。
- 缝定位：`references/analysis/xhswork-integration-2026-08-01/02-our-creation-surface-audit.md` §3。

---

## 一、迁移方案与理由（票面任务 1「实施时定」的裁决）

**裁决：分层映射起步 —— wire/storage kind 不动，三枚举落在派生的「载体口径」上。**

| 层 | 符号 | 取值 | 是否落库 |
| --- | --- | --- | --- |
| wire / storage | `contentPackageKindSchema` | `image_text` \| `video` | 是（**零变更**） |
| 产品载体口径 | `contentPackageCarriers` | `media` \| `copy` \| `note` | 否（读时派生） |

映射函数（总函数、无损）：

```ts
// packages/contracts/src/content-package.ts:184
contentPackageCarrierOf({ kind, orderedAssetCount }): ContentPackageCarrier
//   video                      → media
//   image_text, 无有序媒资      → copy
//   image_text, 有有序媒资      → note
```

### 为什么不是「扩枚举 + normalize 别名」

票面倾向别名映射，我采用的分层映射是同一取向的健全版本。原先分支上的实现是把
`contentPackageKindSchema` 扩成 `['media','copy','note','image_text','video']` 五值联合，
再提供 `normalizeContentPackageKind`（`image_text→note`、`video→media`）。复核发现两个硬伤：

1. **契约允许的值，下游处理不了。** ContentPackage 实体的 `kind` 就是这个 schema，
   而生产代码遍布 `kind === 'video' ? 视频路 : 图文路` 的二分派：
   `content-package-export-adapter.ts:231/329`、`operations/content-package.ts:296/305`、
   `application-service.ts:7961/9210/9232/9242/9275-9287`、`visual-adoption.ts:218/496`、
   `harness/postgres-store.ts:2949`。一个 canonical `media`（实为视频）会静默落进
   **图文导出分支**。P0 不写 canonical 值所以线上无 bug，但这是一次不健全的契约放宽。
2. **`video → media` 是有损映射。** `media` 按 §3.1 是「单媒资（图/视频等）」，不区分图与视频，
   而上述分支需要的正是这个区分。所以那些判别点**光靠 normalize 修不好**，必须引入
   媒体子类型来源 —— 那是 §8.2/§8.4 明确排在 P1 的「schema 全链」。

分层映射把三枚举放在派生层，`kind` 保持二值，于是：存量行、导出 manifest
（`deliveryManifestKindSchema` 仍是二值）、byte-identical 回放 fixture **全部零变更**，
下游任何分派都收不到它处理不了的值。§8.1 允许「或**等价映射落地**」，§3.1 把迁移方式留给实施，
本裁决走在允许范围内。

### `copy` 为何可达（映射为什么是无损的）

ContentPackage v1 用同一个 `image_text` kind 承载 Composer 纯文案与图文成品；纯文案版本
**就是没有有序媒资的那个版本** —— 这不是我的推断，是 `apps/core/src/p1/result-delivery/delivery-package.ts:429-436`
`buildCopyDeliveryPackage` 的既有注释与既有生产分派（`images.length === 0`）。
把这一位纳入映射输入后，三枚举全部可达，映射对 wire 域是总函数（合同测试 §四已钉）。

### 反向（载体 → wire）为什么没做

`copy` 与 `note` 都映射回 `image_text`，反向不是单射；P0 不写 canonical 值，反向无消费者。
P1 若要把载体提为落库主字段，那是带库表变更的迁移，按 §8.5「kind 写库后的迁移/回滚策略实施时定」另议。

---

## 二、确认门判定改造（票面任务 2）

`confirmPaidGenerationExecution` 的触发条件从「仅 media 工作流路径」改为**操作是否触发付费媒体执行**：

```ts
// apps/core/src/p1/harness/workflow-core.ts:2995
triggersPaidMediaExecution(request): request is SnapshotBackedHarnessWorkflowInput
//   无 quote 或无 usageReservation           → false（免费路径，行为不变）
//   预留单位含 image | video                 → true （必过卡）
//   预留单位仅 copy                          → false（D-043 纯 copy 免确认，不动）
//   预留存在但无单位明细                      → true （fail closed，见下）
```

### fail-closed 方向的改动

分支原实现在「无单位明细」时按 lens 猜（`image|video|image_text_note → true`）。核实生产：
`submission-coordinator.ts:219/340` 对每个 lens 都会预留单位
（`productUsageUnits` 覆盖 copy/image/video，note 走 `composer-submission-gate.noteUsageUnits`），
`postgres-creation-submission-store.ts:892` 的 `storedUsageUnits` 对空明细直接抛错。
**生产 units 恒非空，那段 lens 猜测不可达**；而它一旦被走到，方向是 fail-open —— 猜不中就不拦钱。
改为：拿不到明细即判定「会花钱」，宁可多问一次。行为在生产上等价，失败方向由开变关。

### 消费者证明（D-150）

新判定的生产调用点：

| # | file:line | 路径 | 生产判定结果 |
| --- | --- | --- | --- |
| 1 | `apps/core/src/p1/harness/workflow-core.ts:1306` | `runHarnessWorkflow`（copy/free 主体） | copy lens 预留 `[copy]` → false，无 hold（D-043） |
| 2 | `apps/core/src/p1/harness/workflow-core.ts:2121` | `runMediaHarnessWorkflow` | image/video lens 预留 `[image]`/`[video]` → true，有 hold |

调用点 1 是本票新增：判定从此是**操作维度**而非路径维度，copy 主体也要经过它。
**如实交代**：调用点 1 在今天的生产里恒为 false —— copy lens 的预留只含 `copy` 单位。
它现在的价值是把判定归位（路径不再是判据），P1 让 copy 路径挂上付费媒体时无需再改门。

### 可达性证明（无更早的门拦截）

`workflow-core.ts:929-943`（`runHarnessWorkflow` 头部）先按 lens 分派：`image_text_note` → note 子流程，
`image`/`video` → media 子流程，其余走主体。两个调用点分别在这两条真实路径上：

- 调用点 2 位于 media 子流程 `execution_selection` 之前，媒体执行必经；
- 调用点 1 位于主体 `brief_compilation` 成功之后、`executeSelectionToCompletion` 之前，
  在此之前只有 `resolveFactSatisfaction`（事实门，非付费门）与 brief 编译，无更早的花钱出口。

### 出口证明（入边 / 出边 / 未授权入边被拒）

| 边 | 行为 | 回归 |
| --- | --- | --- |
| 入边 | 含付费媒体单位 → 挂起 `execution_confirmation` 等待态 | `workflow-core.test.ts:2020`（media 路径）、`:2125`（copy 路径带 image 单位） |
| 出边·通过 | 确认 → 恢复并进入选择执行 | 同上两条，断言 `confirmation` 先于 `selection` |
| 出边·拒绝 | 「暂不执行」→ 语义重提，**执行未发生**，须再次确认才放行 | `workflow-core.test.ts:2166`（拒绝那一刻断言 `order.length === 0`） |
| 出边·取消 | 额度释放/挂起过期 → `HarnessWorkflowCancellation`，**零执行** | `workflow-core.test.ts:2221`（`selectionCalls === 0`） |
| 未授权入边被拒 | 未确认前执行不得发生 —— 取证就是上面的「出边·拒绝」一行 | `workflow-core.test.ts:2166` |
| fail-closed 方向 | 无明细的预留 → 整条旅程真的挂起确认卡（跑 `runHarnessWorkflow` 断言，非只问谓词）；明细字段损坏同判 | `workflow-core.test.ts:2261` / `:2300` |

---

## 三、note 过卡为何仍不落（边界如实交代）

判定已就位：note 的真实预留（copy 1 + image `notePageBound`）令
`triggersPaidMediaExecution === true`。**只差 `runNoteHarnessWorkflow` 里的调用点**，
按 §8.2 与 §8.4 硬序，note 付费媒体过卡与流内 AG-UI interrupt 呈现、e2e fixture 同步
一体落在 P1，本票边界写明「不做 note 旅程端到端闭环」。

P0 现状用 `workflow-core.test.ts:2314` 正面钉住：note 旅程此刻**不**产生
`execution_confirmation`。P1 激活调用点时，这条断言反转为正向即可。

---

## 四、改动面与验证

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/content-package.ts` | kind 收回二值；新增 `contentPackageCarriers` / `ContentPackageCarrier` / `contentPackageCarrierOf`（不含 zod schema：无生产解析点，D-150） |
| `packages/contracts/src/content-package-kind.test.ts` | 分层合同 5 条：wire 二值、载体三枚举、video→media、image_text 按有序媒资分 copy/note、映射对 wire 域是总函数 |
| `apps/core/src/p1/operations/content-package-export-adapter.ts` | 导出三分派改由 `contentPackageCarrierOf` 表达（**行为等价**：`carrier==='media' ⟺ kind==='video'`；`carrier==='copy' ⟺ images.length===0，因 images 逐条来自 `orderedAssetIds` 无过滤） |
| `apps/core/src/p1/harness/workflow-core.ts` | 判定改操作维度 + fail closed；新增 copy 路径调用点；文档注释重写 |
| `apps/core/src/p1/harness/workflow-core.test.ts` | 正负向成对 + 拒绝/取消出边 + fail-closed 分支 + P0 note 无门钉子 |

载体三枚举的**行为回归**复用既有导出用例（无需新增重复用例）：
`content-package-export-adapter.test.ts:155`（copy）、`:110` 与 `:1602`（note）、
`:711` 与 `:1457`（media）。

### 验证结果（本机 worktree 隔离）

| 门 | 命令 | 结果 |
| --- | --- | --- |
| P0-7 typecheck | `pnpm typecheck`（根，含 web） | 绿 |
| P0-6 契约 | `packages/contracts` 全量 | 146/146 绿 |
| P0-6 core 回归（无 PG env） | `apps/core` 全量 `src/**/*.test.ts` | 2878 例：2677 pass / 0 fail / **201 skipped** |
| P0-7 **PG-backed 门（实跑，占 1 并发槽）** | 同上 + `TEST_DATABASE_URL=…/meiye_288_gate`、`TEST_DBOS_SYSTEM_DATABASE_URL=…/meiye_288_gate_dbos` | 2993 例：**2972 pass / 0 fail / 21 skipped** |

**为什么必须带 env 再跑一遍**：merge-ledger 开篇「opt-in 测试等于不存在（2026-07-30）」——env 门控测试在不带 env 的证据面里是 skip，**混在「0 fail」里读起来和通过一模一样**（#248 假绿在 main 滞留一天的成因）。上面第三行的 201 skipped 单独摆出来，正是为了不让它冒充绿。

剩余 21 个 skip 已逐条点名，与本票零交集：10 条 advanced-canvas 契约/流式用例 + 1 条 live Volcengine TTS（需真实凭据）。

**本机跑 PG 门时踩到的两个环境坑**（非产品缺陷，记给下一个跑这条门的人）：

1. 本机 `meiye` 角色权限低于 CI 同名角色，`postgres-content-package-write-adapter.postgres.test.ts` 需要 CREATEROLE + SET ROLE 才能验「PUBLIC 写入被撤销」。逐级报 `permission denied to create role` → `permission denied to set role`；临时 `ALTER ROLE meiye SUPERUSER` 对齐 CI 跑完后已 `NOSUPERUSER NOCREATEROLE` 撤回。
2. `issue-255-live-collector.postgres.test.ts` 在**上一轮半失败 run 的库残留**之上会红（`actual: [0,0] / expected: [0,1]`）。A/B 对照（同一份依赖，源文件在 main 与本分支间来回切）证明与 diff 无关；库状态干净后的完整 run 为 0 fail。

---

## 五、遗留与移交

1. **note 路径调用点**（P1，§8.2）：`runNoteHarnessWorkflow` 挂 `confirmPaidGenerationExecution`，
   连同流内 interrupt 呈现与 e2e fixture 同步一起做；届时把 `workflow-core.test.ts:2314` 反转为正向。
2. **前端挂载条件**（#281-4 之 3，P1）：`execution-confirm-card*.tsx` /
   `composer-home.tsx` 的 `execution-confirm-slot` 改流内 interrupt 呈现，挂载条件对齐付费媒体判定。
3. **kind schema 全链**（P1，§3.1）：若要把载体提为落库主字段，需处理上文列出的
   二分派判别点与媒体子类型来源，并按 §8.5 写明迁移/回滚策略。
4. **copy 路径调用点今日恒 false**：不是缺陷，是判定归位的代价；P1 若给 copy 旅程接上付费媒体
   （如封面配图），门无需再改。
5. **越出票面语义锁一处，请主控裁**：锁面写的是 `packages/contracts/content-package` 与
   `workflow-core.ts` 确认门段（§3.4 定位 L2972–2983）。本票另外改了
   `apps/core/src/p1/operations/content-package-export-adapter.ts`（三分派改走载体口径）
   与 `workflow-core.ts:1306`（门段外新增 copy 路径调用点）。理由：D-150 消费者证明要求
   载体口径有生产调用点，导出分派是唯一现成的真消费面；不接就是「契约已建无消费面＝未完成」。
   行为等价已核（见 §四表）。冲突面核过：lane-286/287 改动全在 `mkfast-template-main/`，
   与本票零文件交集。

---

## 六、review 结论处置（双轴复核后）

Standards / Spec 两轴各出一份，成立项已修入本分支：

| findings | 判定 | 处置 |
| --- | --- | --- |
| `contentPackageCarrierSchema` 零生产消费者（runbook D-150） | 成立 | **删**，只留 `contentPackageCarriers` 数组 + 类型 + 映射函数（均被真实消费） |
| 测试名 `…fails closed into confirmation` 与断言不符（假绿三禁 D-150③） | 成立 | 改为真跑 `runHarnessWorkflow` 断言挂起；损坏明细拆成独立谓词用例并按实改名 |
| `new Set(['image','video'])` 推成 `Set<string>`，资源枚举改名时扣费门静默失效 | 成立 | 用 `ReservedUsageResource` 绑住编译期链路 |
| 导出适配器注释称 media、方法名仍 video，同 hunk 词汇分叉 | 成立 | 注释写明「media 载体今天唯一的 wire kind 是 video」 |
| `request.executionSnapshot!` 非空断言（本票新引入） | 成立 | `triggersPaidMediaExecution` 改类型谓词，断言消除 |
| P0-7 只报 skip 数、未实跑 PG 门 | 成立且要害 | 见 §四第三、四行 |
| 出口证明「未授权入边被拒」记错取证行 | 成立 | 改指 `:2166` |
| 「`!quote` 时返回 false 是 fail-open」 | **不成立** | `creationExecutionSnapshotSchema` 的 `quote` 是必填（`creation-execution-snapshot.ts:190/292`），且 `task-admission.ts:820` 对每个 snapshot 做 schema.parse——「有 reservation 但 snapshot 无 quote」不可表示。它不是 fail-open，是死判断；顺带证明了上一行的非空断言确需消除 |
| 「核心读写路径只名义承认载体口径」「note 过卡未落」 | 部分成立，按分期 | lens↔carrier 映射与 schema 全链属 §8.2/§8.4 的 P1；现无消费者，提前做即投机抽象。已列入 §五遗留 1/3 |
