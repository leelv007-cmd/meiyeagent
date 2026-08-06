# Spec D｜配方治理收敛（D3 recipe-studio 下线 + D5 Recipe→Surface 引用流程化）

> 来源：admin-config-audit-2026-08-06.md §2.6、§2.7、§4.3、§六 D3/D5。DRAFT。

## Problem Statement

配方目前有两个后台编辑入口：`/admin/recipe-studio` 是裸 JSON 文本框（`mkfast-template-main/src/p1/admin-recipe-studio-control.tsx:158-173`），且没有加载已有记录和历史；`/admin/templates` 内的创作体验控件则提交结构化 `RecipeBodyInput`（`mkfast-template-main/src/p1/admin-creation-experience-control.tsx:318-355`）。两者写的是同一类 Recipe revision，却不是同一输入模型，因此不能靠移动按钮完成迁移。现有 Studio 的 `compile` 会写入编译回执，`validate` 会执行生产同源校验和 Skill 冻结检查（`apps/core/src/p1/creation-experience/recipe-studio.ts:492-523`）；问题不是这些门不存在，而是评测/内测证据仍可由客户端构造。Core 会校验 `EvalRun` schema、`passed` 和 Prompt revision 一致性，但 `recordEvaluation` 仍接收客户端提供的 `EvalRun`，`recordInternalTest` 仍接收客户端提供的 runId/passed（`apps/core/src/p1/creation-experience/recipe-studio.ts:540-609`）。

D5 也缺少可落地接缝：一个 Surface 可引用多个 Recipe，而现有查询只有已知 `recipeId` 的 head/history（`apps/core/src/p1/creation-experience/foundation-module.ts:905-913`）；发布是 Templates 页内联 command，不存在“发布成功页”（`mkfast-template-main/src/routes/admin/templates.tsx:22-37`、`mkfast-template-main/src/p1/admin-creation-experience-control.tsx:358-367`）。当前 Surface 保存还把 `toolEntryRefs` 写死为空数组（`mkfast-template-main/src/p1/admin-creation-experience-control.tsx:781-804`），会触发 Spec B 所记录的真实数据丢失路径（`docs/reviews/admin-config-audit-2026-08-06.md:96-99`）。

## Solution

采用单一迁移方案：删除 `/admin/recipe-studio` 整页及其侧栏入口，保留 Core 已存在的四门命令语义，但由 Templates 页内的创作体验控件通过一个明确的 adapter 生成 Studio 编译输入；该控件成为 Recipe 唯一编辑入口。Recipe 与 Surface 继续使用固定 `recipeRevisionId` 引用，不自动把新 Recipe 推到前台。

Recipe 发布成功后不新增路由，改为 Templates 页内的成功面板。面板显示刚发布的 `recipeRevisionId`，要求填写或使用当前已加载的目标 `surfaceId`，然后切换同页 Surface 编辑并带入待更新 revision；更新只替换匹配 Recipe 的 revision 引用，仍需显式预览和发布。

评测能力本身转交独立的 `Spec I｜Recipe 评测证据服务签发`（`docs/specs/admin-backlog-2026-08-06/spec-i-recipe-evaluation-evidence.md`）。本票先建其服务端 seam 和禁用态：没有服务签发的证据回执时，`evaluated`/`internal_tested` 命令拒绝推进，UI 不显示可提交的通过按钮；本票不宣称“发布代表评测达标”。

**该禁用态有一个必须显式接受的连带后果**：`switchProduction` 硬要求 `phase === 'internal_tested'`（`apps/core/src/p1/creation-experience/recipe-studio.ts:616-619`），因此评测门禁用期间，走治理链的 Recipe 无法执行生产切换。D5 的发布路径不受影响（它走 `recipe_publish` + `surface_publish`，不经 `switchProduction`），但 Studio 四门链的原子生产切换在 Spec I 交付前不可达。本票必须与 Spec I 同批交付，或在交付说明中显式记录该阶段生产切换不可用及其预计时长——不得让下线改造在无人察觉的情况下堵死这条路径。

## User Stories

1. As a 运营, I want 只有一个 Recipe 编辑入口, so that 我不会在两个界面改同一个对象而互相覆盖。
2. As a 运营, I want 通过结构化表单编辑并加载已有 Recipe 与历史, so that 我不需要手写 JSON 且能接手半成品。
3. As a 平台负责人, I want compile/validate 的真实顺序门继续执行, so that 下线 Studio 不会削弱生产同源校验或 Skill 冻结检查。
4. As a 平台负责人, I want 没有服务签发证据时评测/内测门保持禁用, so that “已发布”不会被误读为质量达标。
5. As a 运营, I want Recipe 发布成功后在同页获得更新目标 Surface 的引导, so that 我不会发布完却前台无感。
6. As a 运营, I want 从每个 Surface Recipe 卡的已发布候选下拉选择版本, so that 我不用手抄版本号也不会贴错。
7. As a 运营, I want 更新引用时既有工具区编排保持不变, so that 修改 Recipe 引用不会造成 P0 数据丢失。
8. As a 运营, I want 发布仍然是固定版本引用且需要显式 Surface 发布, so that 未确认内容不会自动直达商家。
9. As a 前台商家, I want 运营发布并挂接后的固定 Recipe revision 出现在创作入口, so that 后台发布的可见性可验证。

## Implementation Decisions

- **D3 唯一入口与 adapter**：删除 `/admin/recipe-studio` 路由、侧栏项、`Routes.AdminRecipeStudio` 及 Studio 专用前端控件；不得手改生成的 `mkfast-template-main/src/routeTree.gen.ts`，删除文件后运行现有 TanStack 路由生成流程重新生成。Templates 页保留 `AdminCreationExperienceControl`（该页当前已挂载它：`mkfast-template-main/src/routes/admin/templates.tsx:29-37`）。
- **唯一的表单输入合同**：创建 `RecipeGovernanceFormInput`（由 Templates 控件提交）和服务端 `RecipeStudioCompileInputAdapter`。表单必须显式提供 `recipeId`、`industryKey`、展示字段、`modelPolicy`、`promptRevisionRef`、`skillRevisionRefs`、`workflowRevisionRef`、`outputContractRef`、`quotePolicyRevisionRef`、事实类型、来源要求、意图类型、故事段、输出合同、候选策略和平台分发字段；加载已有 Recipe 时从 head 回填这些字段，新建 Recipe 时由结构化控件提供确定性默认值，不能从 lens 猜测，也不能退回 raw JSON。adapter 按以下固定映射生成现有 `RecipeStudioCompileInput`：依赖字段一一映射；事实/意图/故事/输出/候选/平台字段分别生成现有六类受控 blocks；`contextPatches`、`settingsPatches` 和 `familyId` 原样透传；`industryKey` 不从 lens 推断。该 adapter 是唯一允许把 Templates 表单模型转换为 Studio 编译模型的接缝，不能由前端拼接 `studioRelease`。
- **revision 与四门证据**：每次 governed 保存都调用 `recipe_studio_compile`，adapter 产出新 draft revision 并附着服务端 `studioRelease.phase=compiled` 与 `compilationReceipt`；随后按既有 CAS 顺序调用 `recipe_studio_validate`，再调用评测/内测命令。四门回执只由 Core 写入同一 revision 链，浏览器提交的 `studioRelease`、`passed` 或隐藏 Prompt 一律丢弃；普通 `recipe_draft` 仍不得成为 governed Recipe 的保存通道。`RecipeStudioCompileInput` 的字段依据 `apps/core/src/p1/creation-experience/recipe-studio.ts:104-125`，浏览器 command 对 server-only evidence 的过滤依据 `apps/core/src/p1/creation-experience/foundation-module.ts:426-441`。
- **编译/校验事实修正**：不要把整条发布链描述为只证明点按钮。实现必须保留并测试 `compile` 的编译回执、`validate` 的 Skill 冻结检查和生产同源 `validateRecipe`（`apps/core/src/p1/creation-experience/recipe-studio.ts:505-537`）。本票只把“客户端可伪造评测/内测证据”列为缺口。
- **评测证据 seam 与转交**：本票创建 `RecipeEvaluationEvidencePort` 和 `RecipeInternalTestEvidencePort` 两个服务端接口、default-deny adapter 及 Core wiring；Spec I 负责具体签发器、不可变注册表和正向启用。Core 命令输入只接受不可伪造的 `evidenceReceiptId`；Core 从注册表读取不可变回执，再重复校验 Recipe revision、EvalRun v1 schema、`passed=true`、编译冻结的 Prompt revision、签发时间和 issuer。回执缺失、过期、revision/Prompt 不一致返回明确 domain error，不能由客户端带 `EvalRun` 或 `passed` 替代。Spec I 交付前，本票把两个门置为禁用并保留 `compiled → validated` 的可用状态；不以 UI 传 `passed:true` 作为验收。
- **Spec B 前置依赖与硬约束**：Spec B（`docs/specs/admin-backlog-2026-08-06/spec-b-silent-data-loss.md`）必须先完成 Surface `toolEntryRefs` 透传和其回归测试；D5 只能在该验收通过后联测。无论工具编排编辑器是否出界，D5 保存 Surface 时都必须读取当前 Surface head 的 `toolEntryRefs` 并原样写回，不能发送空数组、缺省覆盖或重排。
- **已发布版本候选查询**：现有 `recipe_history` 只支持单个已知 Recipe ID，因此新增 typed Core query `recipe_published_revisions`，这是本票必须先建的接缝而不是临场发明。输入固定为 `{ surfaceId, recipeIds }`：Core 先按 `surfaceId` 读取当前 Surface，再将其 `recipeRefs` 的 Recipe ID 与调用方去重后的 `recipeIds` 合并；输出为 `groups`（每个 `recipeId` 的 `revisionId`、`revision`、`title`、`lensId`、`publishedAt`，只含 `status=published`）和 `availableRecipeHeads`（可新增卡使用的每个已发布 Recipe 的最新 revision）。服务端按 `recipeId` 升序、同一 Recipe 的 revision 降序排序；不存在或没有 published 候选的 Recipe 保留空分组。前端每张既有卡只显示自身分组的下拉，新增卡先从 `availableRecipeHeads` 选择 Recipe 再选择其 revision；空态为“暂无已发布版本”，禁止自由文本 fallback；查询失败或候选为空时禁止保存该卡。
- **D5 页内成功面板与参数传递**：Recipe publish command 返回 `status=published` 且 `revisionId` 后，Templates 页显示唯一成功面板。面板有目标 `surfaceId` 输入，若 Surface 编辑器已加载则预填该值；点击“更新 Surface 引用”只触发同页 Surface 编辑器的 `surfaceId`、待更新 `recipeRevisionId` 和加载动作，不新增成功路由。Surface 编辑器加载后，若该 Surface 有同一 `recipeId` 的多个引用，全部匹配项更新为新 revisionId；每项的 `lensId/order/featured/visible` 与 `toolEntryRefs` 保持原值；若无匹配项显示明确“该 Surface 未引用此 Recipe”，不自动新增。更新后仍由运营分别点击 Surface preview/publish。
- **固定引用与前台语义**：不做 Recipe 发布自动联动、不改底层 Recipe/Surface CAS、不改 session freeze 和前台 browser projection；只有 Surface 新 revision 显式发布后，新的固定引用才对后续前台会话可见。

## Testing Decisions

- **Core 四门顺序**：保留现有 compile/validate 生产同源校验与 Skill 冻结回归；新增 seam 测试断言客户端提供合法 EvalRun、`passed=true`、runId 或内部测试 `passed=true`，但没有服务签发 evidence receipt 时，Core 不得推进 `evaluated` 或 `internal_tested`。在 Spec I 未交付期间，测试期望为明确的 evidence-unavailable domain error 和 UI 禁用态；Spec I 交付后再以服务注册表回执驱动正向通过。现有客户端构造 passing EvalRun 的测试（`apps/core/src/p1/creation-experience/recipe-studio.test.ts:248-309`）必须改为回执 seam，而不能继续把客户端对象当权威证据。
- **adapter/schema**：为 `RecipeGovernanceFormInput` 写正向映射测试，断言六类 blocks、industryKey、dependencies 和 `studioRelease` 的 server-only 归属；缺字段、无效 revision、重复 block、普通表单试图携带 `studioRelease` 均失败。测试必须通过现有 `creation-experience` command seam，不直接调用组件私有函数。
- **路由删除与生成文件**：更新 `mkfast-template-main/src/routes/admin/-recipe-skills.route.test.tsx`，移除 Recipe Studio 路由和控件的存在断言，新增生成 route tree 不含 `/admin/recipe-studio`、导航不可达且访问该路径落到应用 404 的测试；更新 `mkfast-template-main/src/lib/routes.admin-wiring.test.ts` 与 `mkfast-template-main/src/lib/uiux/navigation.test.ts`，断言旧 Routes 常量和侧栏项不存在、Templates 仍可达。删除 `mkfast-template-main/src/routes/admin/recipe-studio.tsx` 后只通过现有路由生成流程更新 `mkfast-template-main/src/routeTree.gen.ts`，禁止手改生成文件。
- **D5 候选与成功面板**：交互测试先复现现状自由文本版本输入，再改为断言 `recipe_published_revisions` 的候选来源、每卡按 revision 降序、草稿/preview/retired 不出现、空态不可保存；Recipe publish 成功后断言同页成功面板出现、目标 Surface 参数被带入 Surface 编辑器、无新路由导航；点击更新后断言 `surface_draft` 只替换匹配 Recipe revision。
- **工具引用保真**：改写 `mkfast-template-main/src/p1/admin-creation-experience-control.interaction.test.tsx:166-217` 的红测，不再把 `toolEntryRefs: []` 固化为预期。测试 fixture 先给 Surface 一个非空工具引用，保存/更新 Recipe 引用后断言 command payload 和服务端返回仍含完全相同的工具引用；同时断言版本下拉选项来自已发布候选而不是自由文本。该测试依赖 Spec B 先通过，失败时标记为依赖未就绪，不得把数据丢失当成正常行为。
- **固定版本前台验收**：Core catalog/runtime 测试断言 Surface 仍只消费已发布 `recipeRevisionId`；Recipe 发布但未更新并发布 Surface 时前台仍为旧 revision，Surface 新 revision 发布后后续 browser projection 才显示新 revision。不得以“Recipe publish command 成功”替代 Surface publish 证据。

## Out of Scope

- 完整评测能力（评测 provider、套件内容、评分标准、服务签发注册表的具体实现和运行编排）转交 `docs/specs/admin-backlog-2026-08-06/spec-i-recipe-evaluation-evidence.md`；本票只建调用 seam、禁用态和反伪造测试，不宣称发布达标。
- 工具区编排编辑器建设出界；但 Surface 保存/Recipe→Surface 更新时既有 `toolEntryRefs` 引用保真是本票硬约束，依赖 Spec B 的字段透传修复。
- Recipe/Surface 的底层 CAS、session freeze、前台消费投影、多语言和多平台扩展不改。
- 不新增 Recipe 成功路由、不做自动联动、不把 Recipe 版本改为浮动引用。

## Further Notes

D3 下线后，审计报告 §2.6 与 §六 D3 关于 recipe-studio 的路由遗留消除；现有 Core 的 compile/validate 门控不删除，只改变其 Web 唯一入口和输入 adapter。Spec B 是 D5 的明确前置：若 `toolEntryRefs` 透传未通过，D5 不得标记完成。

本票遵守三条全局更正：p1 配置读路径不存在商家 fail-open，shell 缺独立管理员门属于 P2 加固；Skill 白名单静默发生在运行时筛选而非 bind 拒绝；`presentationPolicy` 已在绑定期消费，本票不重复实现 Skill 治理或商家 Skill 选择旅程。
