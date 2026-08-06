# Spec B｜静默数据丢失三处（toolEntryRefs / Recipe 草稿丢字段 / Skill 治理白名单）

> 来源：admin-config-audit-2026-08-06.md §2.5、§2.7、§五 P0，以及本轮对抗式复核裁决。
>
> 状态：已批准并开票（2026-08-06）。实施票：#359 三态合并＋Surface 工具引用 · #360 已发布工作流目录端口 · #361 Recipe 草稿字段 · #362 Skill 绑定边界。
>
> **2026-08-06 决策更新（wayfinder #398 终局）**：工具链整条剔除（#418→#419），本 spec 第 1 处（Surface `toolEntryRefs`）作废——字段将不复存在，无可透传。三态合并语义保留，消费者改为第 2 处的 Recipe `factTypes`/`skillRevisionRefs`（真·活体 P0，launch seed 有非空 `factTypes` 种子）。#359 已落依赖更新评论收窄范围。

## Problem Statement

运营在后台完成了正确的局部编辑，界面回报成功，但提交路径可能把未编辑字段写成空值，或让 Skill 绑定在运行时被静默筛掉。三处问题边界如下：

1. 当前 Web Surface 编辑器每次提交都发送 `toolEntryRefs: []`；Core 的 Surface 规范化会将该数组作为新 revision 的完整值，因此只改标题也会清空已有工具区编排。浏览器模型虽有 `toolEntryRefs`，hydrate 没有把服务端值回填到编辑状态，现有交互测试还把空数组写成断言（`mkfast-template-main/src/p1/admin-creation-experience-control.tsx:43-67`、`:702-706`、`:796-804`；`mkfast-template-main/src/p1/admin-creation-experience-control.interaction.test.tsx:208-216`）。
2. 当前 Web Recipe 编辑器的 `RecipeRecord` 类型、hydrate 和 `recipe_draft` payload 都没有 `factTypes`/`skillRevisionRefs`，所以浏览器 payload 缺字段；Core 的 `?? []` 是规范化默认，不是独立覆盖器，但在写入新 revision 时确实把缺字段落成空数组（`mkfast-template-main/src/p1/admin-creation-experience-control.tsx:43-67`、`:221-232`、`:318-354`；`apps/core/src/p1/creation-experience/catalog-service.ts:80-165`）。
3. `skill_bind` 不会因“非文案工作流”被白名单拒绝：命令层只校验绑定模式、Harness stage 和必填文本，随后接受任意非空 `workflowRevisionRef`（`apps/core/src/p1/skills/foundation-module.ts:612-646`；`apps/core/src/p1/skills/service.ts:1097-1138`）。静默发生在运行时 `selectStageRevisions` 按 Skill revision 的 `governance.workflowRevisionRefs` 筛选，不命中就 `continue` 且不注入（`apps/core/src/p1/skills/service.ts:1340-1354`）。当前平台定义路径把治理引用固定为 `workflow.copy@1`（`apps/core/src/p1/skills/platform-provisioning.ts:21-24`、`:59-65`），因此绑定到图文/视频可能保存成功但运行时为空。另一个相邻事实是 `presentationPolicy` 已在绑定期消费：`user_selected` 绑定后台专用 Skill 会立即失败（`apps/core/src/p1/skills/service.ts:1113-1118`）；本 spec 只处理商家侧展示/可选消费缺口的前置事实，不重复实现其旅程。

## Solution

三处均采用“缺字段不覆盖、显式空数组才清空、无法生效就稳定报错”的合同：

- Surface 编辑器加载并持有服务端 `toolEntryRefs`，提交时回传；Core 在读取 head 后合并缺字段，再规范化和写入。
- Recipe 编辑器的类型、加载投影和提交 payload 纳入 `factTypes`、`skillRevisionRefs`；Core 对这两个数组执行同一三态合并。
- Skill 定义/接受不再隐式把治理元数据写成单一 `workflow.copy@1`；定义 revision 必须携带经过目录校验的治理工作流集合。绑定命令从 Core 的已发布 Recipe 工作流查询合同取合法集合，并要求目标同时存在于该集合和目标 Skill revision 的治理引用中；不满足时以 `P1DomainError.code=INVALID_STATE` 和稳定消息拒绝。运行时仍按治理引用筛选，拒绝后的输入不会再出现“绑定成功但不注入”的静默状态。

## User Stories

1. As a 运营, I want 编辑 Surface 标题时不丢失已配置的工具区编排, so that 前台入口工具不会无故消失。
2. As a 运营, I want Surface 草稿提交时回传未改动字段, so that 局部编辑不等于整体重置。
3. As a 运营, I want 修改 Recipe 标题时保留已绑定的技能, so that 文案微调不会清空创作入口能力。
4. As a 运营, I want Recipe 草稿携带事实类型与技能绑定, so that 草稿是完整快照而非残片。
5. As a 运营, I want 新建 Skill 绑定到已发布的图文、视频或改写工作流时真正生效, so that 配置会进入对应生成链。
6. As a 运营, I want 绑定到不存在、未发布或未获该 Skill 治理授权的工作流时收到明确错误, so that 不会误以为已生效。
7. As a 运营, I want 工作流选择从当前已发布 Recipe 目录取值, so that 白名单不会与真实配方脱节。
8. As a 平台负责人, I want 每处修复都有先复现再通过的回归测试, so that 静默丢失不会回潮。
9. As a 前台商家, I want 运营配置的工具区与 Skill 真实体现在创作界面, so that 后台与前台一致可信。

## Implementation Decisions

- **三态字段合并（唯一语义）**：`draftRecipe`/`draftSurface` 必须先读取对应 head，再校验 `expectedRevision`，然后按输入对象是否自有字段合并。head 不存在时，缺字段取现有规范化默认（数组为 `[]`）；head 存在时，缺字段继承 head 原值；显式 `[]` 表示清空，必须保留为空数组。合并完成后才调用 normalize 和 hash，避免当前“先 normalize、后读 head”的顺序阻断继承（`apps/core/src/p1/creation-experience/catalog-service.ts:291-302`、`:435-446`）。该规则只扩展 `toolEntryRefs`、`factTypes`、`skillRevisionRefs` 的缺字段行为，不改变必填字段、CAS、审计或追加写入。
- **Surface Web 接缝**：补齐服务端 Surface API fixture/加载投影中的非空 `toolEntryRefs`，hydrate 回填该值，提交 payload 使用当前状态；交互测试必须通过该 fixture 先加载既有值，再只改标题。
- **Recipe Web 接缝**：扩展 `RecipeRecord` 与 hydrate 以承载 `factTypes`、`skillRevisionRefs`，payload 明确发送两字段；既有字段从 API fixture/加载投影进入状态，不能在测试中凭空“预设”组件内部不存在的字段。
- **已发布 Recipe 工作流查询合同（需先建立）**：在 `CreationExperienceCatalogRepository` 增加全目录查询方法，由 Core Catalog service 暴露“已发布 Recipe workflow revision refs”只读端口；Postgres 实现查询 `status='published'` 的记录，Memory 实现遍历其记录。返回值只含非空、规范化后的 revision ref，并按字符串去重、稳定排序。
- **launch-seeds 与数据库合并/失效**：查询端以 `recipeId` 合并两源；同一 `recipeId` 存在数据库已发布记录时，以数据库记录的 workflow ref 集合覆盖 launch-seed；没有数据库已发布记录时，才使用仍列在 `LAUNCH_RECIPE_SPECS` 且带 workflow ref 的 seed。数据库记录失去 `published` 状态即从集合移除；seed 从常量列表移除或 workflow ref 为空即失效。最终跨 recipe 按 workflow revision ref 去重后返回。这是绑定下拉和服务端校验的唯一权威集合。
- **Skill 治理元数据与绑定边界**：`skill_define`/接受 revision 不得默认补写 `workflow.copy@1`；调用方必须提供治理 refs，且每个 ref 必须来自上述已发布目录。`skill_bind` 先校验目标在当前目录，再校验目标属于该 revision 的治理 refs；任一失败均抛 `P1DomainError('INVALID_STATE', 'Skill 绑定的工作流未发布或未获该 Skill 治理授权。')`，Web 将该稳定消息映射为绑定表单错误并保留输入。绑定仍不负责验证运行阶段注入；运行时 `selectStageRevisions` 的治理筛选是第二道防线。
- 三处均不改变写入通道、追加历史、CAS、发布状态或审计记录。独立 BFF 管理员门不是本票安全漏洞，转交 `docs/specs/admin-backlog-2026-08-06/spec-a-admin-access-hardening.md`，按 P2 纵深加固处理。

## Testing Decisions

- 好测试断言保存后的外部事实，而非组件内部 state；所有红测必须先证明现状失败，再证明修复通过。
- **Core 三态模块测试**：创建态缺三个目标字段得到 `[]`；更新态缺字段继承 head；更新态显式 `[]` 清空；同时断言读取 head 发生在 normalize/merge 之前。Surface 与 Recipe 各至少一组。
- **Surface 交互测试**：API fixture 返回带既有 `toolEntryRefs` 的 head，加载后只改标题并保存；断言 `surface_draft` payload 带回该 refs，并以 Core 语义 mock/模块测试断言新 revision 仍保留。不得再以 `toolEntryRefs: []` 作为断言。
- **Recipe 交互测试**：API fixture 返回带既有 `factTypes`、`skillRevisionRefs` 的 head，加载后只改标题并保存；断言 payload 和保存后的外部 revision 都保留两字段。该测试覆盖当前 Web 缺字段事实，不把 `?? []` 描述成独立覆盖器。
- **Skill 绑定/运行时红测**：构造治理元数据明确为 `workflow.copy@1` 的 accepted-frozen Skill，绑定目标使用真实 launch-seed `workflow.image_text@1`；先断言修复前 bind 可保存但 `resolveStage` allowlist 为空，再断言修复后绑定被稳定 `INVALID_STATE` 拒绝。另用治理 refs 含 `workflow.image_text@1` 的 Skill，绑定同一真实工作流并在 `intent_naming` stage 断言 `resolveStage` allowlist 含该 revision，且复用现有消费者注入/阶段判断形态（`apps/core/src/p1/skills/skill-service.test.ts:698-747`、`:865-900`）。
- **目录合同测试**：launch-seed 与已发布数据库记录覆盖、同 recipe 数据库优先、取消发布失效、重复 workflow ref 去重和稳定排序；绑定下拉与服务端校验共用该端口，不另造 Web 白名单。

## Out of Scope

- 工具区编排的完整可视化编辑器；本 spec 只保证透传不丢，编辑器另立。
- `user_selected` Skill 的商家侧展示、投影和选择旅程（见 Spec E）；本票只修定义/绑定/运行时 allowlist 接缝。
- Recipe→Surface 引用联动（见 Spec D）。
- BFF 独立管理员门与平台配置访问纵深防御（见 Spec A，P2）；Core `config.publish` 能力边界保持不变。

## Further Notes

本票的数据正确性修复保持 P0；Skill 子项的优先级拆为：运行时静默导致的有效绑定丢注入为 P0，目录查询合同与定义/绑定错误边界为 P1。复核 findings 全部采纳，没有把任何“接缝不存在”假定为已存在；需新增的 Repository/Service 只读端口和 Web fixture 已在本票锁定形态。
