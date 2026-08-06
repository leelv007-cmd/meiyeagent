# Spec I｜Recipe 评测证据服务签发

> 来源：本轮对抗式复核对 Spec D 的裁决派生（非两份原始文档的直接待办）。Spec D 把评测/内测门的正向启用整体转交本票，因此本票是 D 的阻断前置。
>
> 状态：已批准并开票（2026-08-06）。实施票：#393 回执注册表 · #394 recipe-governance 套件 · #395 服务端签发 · #396 兑付与命令收窄 · #397 管理面证据状态。

## Problem Statement

Recipe 四门发布链的后两门当前接受客户端构造的证据。`recordEvaluation` 直接把浏览器提交的 `evalRun` 对象当权威输入，`recordInternalTest` 直接接受浏览器提交的 `runId` 与 `passed`（`apps/core/src/p1/creation-experience/recipe-studio.ts:539-609`）。Core 确实做了校验——EvalRun 必须符合 eval-run/v1 合同、`passed` 必须为真、每个 case 的 `promptRevision` 必须等于本次编译冻结的 Prompt 版本——但这些校验全部作用在调用方自己提供的对象上，构造一份自洽的通过对象不需要真的跑过评测。因为 `switchProduction` 硬要求 `phase === 'internal_tested'`（`apps/core/src/p1/creation-experience/recipe-studio.ts:616-619`），这条可伪造的链是生产切换的唯一入口，"已切生产"因此不代表质量达标。

缺的不是评测基建，而是"服务端确实观测到这次运行"的绑定。仓内已有六套评测（`apps/core/src/evals/{copywriting,fact-satisfaction,merchant-language,preference-memory,redlines,skills}`），已有 put-once 的不可变 EvalRun 注册表（内存实现 `apps/core/src/p1/skills/repository.ts:716-742`，Postgres 实现写 `p1_skill_eval_runs` 并以 `ON CONFLICT DO NOTHING` 加深度比对得出 `IDEMPOTENCY_CONFLICT`：`apps/core/src/p1/skills/postgres-repository.ts:1823-1857`），也已有把产出物落库的导入链（`pnpm eval:import <artifact.json>` → `apps/core/src/p1/harness/langfuse-evalrun-importer.ts:41-56`）。但该注册表只按 `runId` 存运行本身，不记录这次运行属于哪个 Recipe revision、对应哪个编译冻结的 Prompt、由谁签发、何时失效；而且它挂在 `SkillRepository` 下（`apps/core/src/p1/skills/repository.ts:24`），creation-experience 模块没有读路径。所以今天即使真跑了评测，Core 也无法把"跑过"与"这次要过门的 revision"对上。

Spec D 在交付前把这两门置为禁用。这意味着 D 落地后、本票落地前，走治理链的 Recipe 无法切换生产——本票不是可选后续，是 D 的解锁条件。

## Solution

在已有的 EvalRun 注册表之上加一层**证据回执**：一条不可变记录，把一次真实运行绑定到一个具体的 Recipe revision、该 revision 编译时冻结的 Prompt 版本、签发者身份和有效期。回执只能由服务端签发者写入，浏览器全程只见 `receiptId`。

Core 兑付回执时不信任回执里的结论，而是重新校验一遍：回执存在且未过期、`recipeId` 与 revision 匹配、Prompt 版本等于本次编译回执冻结的版本、注册表里的 EvalRun 重新通过 eval-run/v1 解析、`passed` 为真、每个 case 的 `promptRevision` 一致、签发者在允许名单内。任一不符返回明确 domain error，不接受客户端以 `EvalRun` 或 `passed` 替代。

签发有两条路径，都要求操作者身份，都不经浏览器：服务端直接运行 Recipe 评测套件；或通过既有的产出物导入 CLI 摄入一次已记录的运行。回执签发成功后，Spec D 中被置为禁用的两门恢复正向可用。

## User Stories

1. As a 平台负责人, I want "已切生产"确实代表评测通过, so that 发布状态不再是可以自证的声明。
2. As a 平台负责人, I want 评测证据由服务端签发而非浏览器提交, so that 前端被篡改也无法把未评测的 Recipe 推上生产。
3. As a 平台负责人, I want 每份回执绑定到具体 Recipe revision, so that 一次评测不能被复用到另一个改过的版本上。
4. As a 平台负责人, I want 回执绑定编译冻结的 Prompt 版本, so that 换了 Prompt 后旧评测自动失效。
5. As a 平台负责人, I want 回执有明确有效期, so that 陈旧评测不会无限期为新发布背书。
6. As a 运营, I want 在 Templates 页看到当前 revision 的评测证据状态, so that 我知道还差哪一门、为什么过不去。
7. As a 运营, I want 从管理面触发一次 Recipe 评测运行, so that 我不需要登录服务器或手工搬运 JSON。
8. As a 运营, I want 评测未通过时看到失败的具体 case 与原因, so that 我知道该改 Prompt 还是改配方。
9. As a 运营, I want 内测试跑同样走服务端签发, so that 内测记录与评测记录有一致的可信度。
10. As a 平台负责人, I want 回执不可变且重复签发同一 runId 稳定报冲突, so that 证据链可审计、不可静默改写。
11. As a 平台负责人, I want 评测运行的观测数据仍进 Langfuse, so that 现有可观测链路不因引入回执而断开。
12. As a 平台负责人, I want 回执签发与兑付都留审计, so that 事后能追溯谁在什么时候用哪份证据过了门。
13. As a 运营, I want Spec D 落地后治理链能真正走到生产切换, so that 单一入口改造不会把发布路径整体堵死。

## Implementation Decisions

- **证据回执合同**：新增不可变回执记录，字段为 `receiptId`、`evidenceKind`（`recipe_evaluation` | `recipe_internal_test`）、`runId`、`recipeId`、`recipeRevision`、`promptRevisionRef`、`suiteId`、`suiteRevision`、`mode`、`passed`、`issuerId`、`issuedAt`、`expiresAt`。回执与 EvalRun 分离存储：EvalRun 仍是运行事实，回执是"这次运行对这个 revision 有效"的绑定断言。`passed` 落在回执上只为查询便利，兑付时一律以注册表中的 EvalRun 重新判定，不以回执上的副本为准。
- **注册表提升为共享服务**：把 `EvalRunRegistryPort` 从 Skill 作用域提升为 harness 拥有的共享读写服务，creation-experience 通过该服务读取。既有 `p1_skill_eval_runs` 表与 Skill 侧写入路径保持不变、不迁移数据；回执落新表，按 `receiptId` 主键，并对 `(evidenceKind, recipeId, recipeRevision)` 建索引以支持"当前 revision 有哪些证据"查询。回执写入沿用已验证的 put-once 纪律：冲突时以深度比对判定，事实相同视为幂等成功，事实不同抛 `IDEMPOTENCY_CONFLICT`。
- **签发者与两条签发路径**：签发者是服务端组件，持有 `issuerId`，浏览器无法扮演。路径一为服务端运行：Core 侧 runner 按 Recipe revision 组装用例、执行、产出 eval-run/v1 运行、写入注册表、再签发回执。路径二为产出物摄入：扩展既有 `pnpm eval:import`，在 `putImmutable` 之后按显式传入的 `--recipe`、`--revision`、`--kind` 附加签发回执；不带这些参数时行为与今天完全一致，只入库不签发。两条路径共用同一签发函数与同一校验，禁止各自实现。
- **兑付时重新校验（不信任回执结论）**：实现 Spec D 建立的 `RecipeEvaluationEvidencePort` 与 `RecipeInternalTestEvidencePort`，用注册表支撑的适配器替换 D 的 default-deny 实现，沿用仓内既有的端口注入形态（参照 `RecipeSkillRevisionValidationPort` 的注入方式：`apps/core/src/p1/creation-experience/recipe-studio.ts:160`、`apps/core/src/p1/creation-experience/foundation-module.ts:392`）。兑付顺序固定：按 `receiptId` 取回执 → 校验 `evidenceKind` 与调用的门一致 → 校验未过期 → 校验 `recipeId`/`recipeRevision` 等于当前 head → 校验 `promptRevisionRef` 等于 `studioRelease.compilationReceipt.promptRevisionRef` → 从注册表取 EvalRun 并重新以 eval-run/v1 解析 → 校验 `passed` 为真 → 校验每个 case 的 `promptRevision` 一致 → 校验 `issuerId` 在允许名单内。每一步失败返回可区分的 domain error，消息面向运营可读。
- **命令输入收窄**：`recipe_studio_record_eval` 与 `recipe_studio_internal_test` 的浏览器可提交字段收窄为 `evidenceReceiptId` 加既有的 CAS/审计字段。客户端提交的 `evalRun`、`runId`、`passed`、`label` 一律丢弃，沿用既有的浏览器 command server-only 字段过滤形态（`apps/core/src/p1/creation-experience/foundation-module.ts:426-441`）。Core 写入 `studioRelease.evaluation` / `.internalTest` 时，`runId`、`suiteId`、`suiteRevision` 全部取自注册表中的 EvalRun，不取自输入。
- **Recipe 评测套件内容**：新增 `recipe-governance` 套件，形态对齐既有六套（`mode` 取 `recorded_fixture` 或 `live_red_team`、产出 eval-run/v1 产出物、附带可提交的基线产出物）。用例来源于被评 Recipe 自身的事实类型、意图类型与输出合同；评分复用既有 redlines 与 fact-satisfaction 的评分器，不新造评分标准。套件版本以 `suiteRevision` 显式记录，套件内容变更必须提升该版本。
- **内测试跑证据**：内测走同一回执形态，`evidenceKind='recipe_internal_test'`。服务端内测 runner 在非生产租户下按该 Recipe revision 执行一次真实创作，产出同样符合 eval-run/v1 的运行记录后签发回执。既有对 `label='internal-test'` 的语义保留为回执侧的约束，不再由客户端传入。
- **管理面呈现**：Templates 页按当前 Recipe revision 展示两门的证据状态（无证据 / 证据已过期 / 证据与当前 Prompt 不符 / 已具备），并提供触发一次评测运行的操作。UI 只显示状态与 `receiptId`，不提供任何可编辑的通过态输入；评测失败时展示失败 case 的 `caseId` 与 `reason`。
- **Langfuse 定位不变**：Langfuse 仍是观测汇聚点，不是证据权威。既有导入链继续把 dataset item 推送到 Langfuse，回执与兑付判定完全基于 Core 自己的注册表；Langfuse 不可达不得阻塞签发，也不得成为过门依据。
- **排期约束**：本票是 Spec D 生产切换路径的解锁条件。D 单独落地会使治理链停在 `validated`，`switchProduction` 不可达。二者必须同批交付，或在 D 交付说明中明确记录该阶段生产切换不可用及其时长。

## Testing Decisions

- 好测试断言外部可观测事实：过门成功与否、写入的 `studioRelease` 内容、返回的 domain error 码，而不是签发者内部结构。所有安全类断言必须先构造攻击输入证明现状可通过，再证明修复后被拒。
- **反伪造红测**：以今天的形态构造一份自洽的通过 EvalRun 直接提交，断言现状可推进到 `evaluated`；修复后断言同一输入被拒绝，且只有服务端签发的 `evidenceReceiptId` 能过门。既有客户端构造 passing EvalRun 的测试（`apps/core/src/p1/creation-experience/recipe-studio.test.ts:248-309`）随本票改写为回执形态。
- **兑付负例矩阵**：逐条覆盖回执不存在、已过期、`evidenceKind` 与门不匹配、`recipeId` 或 `recipeRevision` 不等于当前 head、`promptRevisionRef` 与编译回执不符、注册表中 EvalRun 解析失败、`passed` 为假、某个 case 的 `promptRevision` 不一致、`issuerId` 不在允许名单。每条断言唯一且可区分的 error，不接受笼统失败。
- **注册表 put-once**：对齐既有 Skill EvalRun 注册表的测试形态，断言同 `runId` 同事实幂等成功、同 `runId` 不同事实抛 `IDEMPOTENCY_CONFLICT`；回执同理。内存与 Postgres 两套实现都要覆盖，Postgres 用例沿用仓内 `*.postgres.test.ts` 约定。
- **签发路径一致性**：断言服务端运行与产出物摄入两条路径签发出的回执在相同输入下完全一致；断言 `eval:import` 不带 recipe 参数时行为与今天逐字节一致（只入库、不签发）。
- **四门贯通**：一条端到端测试走完 compile → validate → 签发评测回执 → record_eval → 签发内测回执 → internal_test → switchProduction，断言最终生产切换成功且 `studioRelease` 中的 `runId`/`suiteId`/`suiteRevision` 全部来自注册表而非输入。
- **Langfuse 可用性隔离**：断言 Langfuse 推送失败时签发与过门仍可完成，且失败被记录而不是静默吞掉。
- **管理面交互**：交互测试断言四种证据状态各自的呈现，断言界面不存在任何可提交通过态的输入控件，断言评测失败时失败 case 可见。

## Out of Scope

- 既有六套评测的内容、评分器与运行编排不改；本票只新增 `recipe-governance` 套件并复用既有评分器。
- 不把 Langfuse 或任何外部平台的评分结果作为过门权威。
- 不做自动签发：回执始终需要显式的服务端运行或显式的操作者摄入，不存在"发布时顺便自动评测通过"。
- 不迁移 `p1_skill_eval_runs` 的既有数据，不改 Skill 侧的 EvalRun 写入路径。
- 不改 Recipe/Surface 的 CAS、审计、发布状态机与前台消费投影。
- Spec D 负责的单一编辑入口、adapter、`recipe_published_revisions` 查询与页内成功面板不属于本票。

## Further Notes

本票由 Spec D 的复核裁决派生：D 建立 `RecipeEvaluationEvidencePort` / `RecipeInternalTestEvidencePort` 两个接口、default-deny 适配器与禁用态，本票交付真实签发器、不可变回执注册表与正向启用。两票的接口形态必须一致，D 先行时不得改动接口签名以免本票返工。

排期上把本票视作 D 的同批依赖而非后续增强：D 的 `switchProduction` 路径在本票交付前不可达，这一点必须在 D 的交付说明里显式写明，不能让"治理链单一入口"改造在无人察觉的情况下堵死生产发布。

本票遵守三条全局更正：p1 配置读路径不存在商家 fail-open；Skill 白名单静默发生在运行时筛选而非 bind 拒绝；`presentationPolicy` 已在绑定期消费。三条与本票均无直接实现交集，仅作为不得复述旧错误说法的约束。
