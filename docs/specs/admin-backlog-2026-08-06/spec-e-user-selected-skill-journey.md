# Spec E｜商家侧「选用技能」旅程（D4 `user_selected` 模式落地）

> 来源：admin-config-audit-2026-08-06 §2.5、§六 D4；D-108、D-139、D-159③、D-160②、D-165。本文是实施规格，不再把关键选择留给后续设计。

## Problem Statement

Skill 绑定模式有 `required / user_selected / disabled` 三态。现状并非 `presentationPolicy` 只落库：绑定期已经拒绝把非 `user_selectable` Skill 绑定为 `user_selected`（`apps/core/src/p1/skills/service.ts:1097-1138`，其中校验为 `apps/core/src/p1/skills/service.ts:1113-1118`）；运行时也在 `selectStageRevisions` 按 `userSelectedSkillRefs` 过滤（`apps/core/src/p1/skills/service.ts:1310-1354`）。已有 service 单测传入选中引用并断言 `user_selected` 进入 allowlist（`apps/core/src/p1/skills/skill-service.test.ts:845-863`）。真实缺口是商家展示/可选消费，以及生产提交没有把商家的选择带入 admission：Composer 提交当前只发送签名的 recipe 等字段（`mkfast-template-main/src/product/composer/use-composer-run.ts:321-363`），Composer body 与 creation command 合同也没有选择字段（`mkfast-template-main/src/product/composer/composer-submission-client.ts:16-69`、`apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:210-290`），Harness 合同为 strict 且没有 `userSelectedSkillRefs`（`packages/contracts/src/harness.ts:46-56`），生产 admission 的 `select` 也未传选择给 resolver（`apps/core/src/assembly/api-runtime.ts:1215-1233`；`apps/core/src/p1/harness/task-admission.ts:401-417`）。因此当前商家选择即使有 UI，也不会进入新任务的 manifest 冻结链。

本票的成功标准是完整且可追踪的 `defined → accepted_frozen → bound → exposed → invoked → persisted/traced`：平台审核后的 Skill 只能通过服务端 merchant projection 出现在输出类型轴下的配方卡/能力包目录；商家通过确认式 pill 选择或取消本次 draft 的能力增强；提交请求携带选择引用；Core admission 校验租户和绑定资格后生成 execution snapshot、五阶段 manifest snapshot 与三轴版本审计；运行时只消费冻结快照，选择确实改变对应阶段注入。

## Solution

采用单一决策：**选择粒度为单次 Composer 创作 draft，提交时冻结；不提供 workspace 默认选择，也不把 Skill 做成独立技能市场。** 配方卡目录是前台唯一挂载点，浏览、预览、套用只修改 Composer draft；商家明确开始创作后才进入提交/admission 冻结。该形态遵守 D-139 输出类型轴、D-160② 少量审核能力包、D-159③ 确认式交互和 D-108 前台能力包合同（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:1843-1857`、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2343-2349`、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2601-2607`、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2933-2946`、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3074-3087`）。

### 商家呈现与权限投影

- Core 新增服务端 merchant projection，输入为已认证 `workspaceId`、当前输出 lens、已发布且 `accepted_frozen` 的 Recipe/Skill 绑定；只返回该 workspace/tier 有权使用且审核通过的少量能力包。平台层与行业层按已发布目录可见，workspace 层仅对 `ownerWorkspaceId === workspaceId` 可见；不得直接复用 admin catalog projection，不返回 SKILL.md、scripts、provider skill ID、隐藏 prompt、工具或治理字段。
- `backend_only`：merchant projection 排除；不渲染、不进入选择载荷，仍可被后台/运行时按 required 绑定使用。
- `explainable`：作为本次配方自动采用的增强说明展示为只读白话“本次优化”chip；不渲染勾选/取消控件，不进入 `userSelectedSkillRefs`。
- `user_selectable`：仅在 projection 通过审核、租户/tier/lens/recipe 过滤后渲染为能力包 pill；pill 是确认式“选用/已选用”，允许再次点击取消；不暴露工程字段，不形成前置阻塞或配置表单。未选时必须有负向断言：引用不进入提交载荷和运行时。
- 列表过滤和审核集合属于本票；推荐、个性化排序算法 out of scope。浏览/预览/套用只改 draft，不自动提交或执行。

### 单次选择数据契约与接缝

- Composer draft 内维护 `selectedSkillRevisionRefs: string[]`，只允许来自当前 merchant projection 的 `user_selectable` revision；集合去重、稳定排序，取消即移除。draft 不写 workspace 默认。
- 扩展 Composer body、creation command、`CreationExecutionSnapshot` 和 Harness task request 的版本化合同，增加可选的 `userSelectedSkillRefs` 字段（非空字符串引用数组，最多 50 项，缺省为空，保持 strict）；对应现有合同入口为 `mkfast-template-main/src/product/composer/composer-submission-client.ts:16-69`、`apps/core/src/p1/execution-spine/creation-execution-snapshot.ts:210-330` 和 `packages/contracts/src/harness.ts:46-56`。同字段必须贯穿 Web BFF `/api/core/p1/composer/submissions`、Composer 提交 body、submission coordinator、execution snapshot 和 Core admission，不允许通过未声明字段或二次旁路传递。
- 提交时服务端以 `workspaceId + recipe revision + workflow revision + lens + selectedSkillRevisionRefs` 校验：引用必须属于当前已发布 Recipe/绑定矩阵、`accepted_frozen`、`presentationPolicy=user_selectable`、当前 workspace/tier/lens 可见；任何越权、过期、disabled、backend-only、explainable 或目录外引用均以明确 4xx 失败，不能静默丢弃。服务端不得信任浏览器传来的标题、说明或 policy。
- 选择仅存在于本次 `CreationExecutionSnapshot` 的服务器快照字段（新增版本化字段 `userSelectedSkillRevisionRefs`）；快照由 Composer submission coordinator 创建并以现有幂等键/CAS 语义写入。重复相同 idempotency key 返回原任务；同 task 不同选择返回现有 `REQUEST_FINGERPRINT_CONFLICT`，不覆盖已冻结选择。
- admission 的 `select` 必须从 request 读取该字段并传给 `skillRuntime.instructionResolver.selectManifests`；`DurableSkillInstructionResolver` 继续把它传给 `SkillService.selectStageManifests`。五阶段选择结果在 `HarnessExecutionAssemblySnapshot.skillStages` 固化，execution 后续只读该快照。

### 绑定矩阵与优先级

- 不改 `required / disabled` 两态实现，但本票必须验收其与 `user_selected` 的矩阵：同一 `skillId` 在同一 stage/trigger 只保留确定性最高的 active binding；`disabled` 优先于任何用户选择；`required + user_selected` 不得产生重复注入，required 保持注入且用户引用不能改变其 mode；用户选择只对 `user_selected` 生效。
- 同一 Skill 的冲突（不同 revision、不同 mode、同一 slot）必须在服务端 projection/admission 返回可诊断冲突码；不得由浏览器排序或静默选择。Spec B 负责治理白名单来源和后台绑定表单，但 E 依赖其接口契约：B 必须提供按已发布 Recipe 目录解析的合法 `workflowRevisionRefs` 选择集合；后台表单不得再写死单一 workflow。即使历史或内部调用写入非集合的非空引用，bind 命令仍按现有非空校验接受，运行时按治理白名单筛选并产生可观测的未选/未生效审计，不把该行为误写成 bind 拒绝；E 不重复实现该治理逻辑。

### 冻结与三轴留痕

遵守 D-165：一次执行在 admission 前冻结 Skill revision/content hash、prompt name@version、catalog revision 三轴；`HarnessExecutionAssemblySnapshot`（`apps/core/src/p1/harness/task-admission.ts:93-101`）必须包含选择后的每阶段 manifest、冻结 route digest、prompt refs 和三轴 root axes。后续 Skill/Prompt/Recipe 发布或回滚只影响新任务；在途任务恢复时复用快照并拒绝版本/哈希漂移。事件与评价/trace 必须携带 `skillId + skillVersion + 场景 + promptName@promptVersion + catalogRevision`，不以导出时回查补齐（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3182-3230`）。

## User Stories

1. As a 商家, I want 在当前输出类型轴的配方卡目录看到少量审核后的创作能力包, so that 我能发现可用增强而不会进入技能市场。
2. As a 商家, I want 用白话 pill 确认选用或取消能力包, so that 我只需点是/否，不面对工程配置或前置门。
3. As a 商家, I want 浏览、预览、套用只改变 Composer draft, so that 我能在提交前调整而不触发执行。
4. As a 商家, I want 提交后看到选用确实影响本次生成, so that 选择不是摆设。
5. As a 商家, I want 看见必用技能与可选增强的区别, so that 我知道哪些由平台保证、哪些由我确认。
6. As a 运营, I want `presentationPolicy` 精确决定后台专用、只读解释或商家可选三种呈现, so that 配置有真实出口。
7. As a 平台负责人, I want 从绑定到 merchant projection、Composer payload、admission snapshot、stage invocation 和 audit trace 看到一条证据链, so that `user_selected` 可验收。
8. As a 实施 agent, I want 明确的合同、权限、幂等、冲突与冻结规则, so that 不需要在 wayfinder 后再次做架构选择。

## Implementation Decisions

- **先建接缝再建旅程测试**：第一交付顺序固定为合同/类型扩展 → BFF/Composer 透传 → admission/snapshot 注入 → merchant projection → pill 交互 → Core 行为与浏览器联测。不能先写一个绕过 production admission 的“红测”。
- **前台挂载**：能力包只挂在 D-139 的文案/图文/视频 lens 与配方卡目录；采用现有 Recipe pill 行的视觉/交互形态（`mkfast-template-main/src/product/composer/recipe-pill-row.tsx:30-76`），不新建独立 Skill 路由、市场或后台配置表。
- **服务端 projection**：projection 由 Core 依据 workspace、产品角色、tier、当前 lens、已发布 Recipe revision 和审核状态生成；Web 只消费白名单 DTO。普通商家不得读取 admin config/catalog：BFF 通过 session 的 `normalizeProductRole` 推导角色（`mkfast-template-main/src/lib/core-client.ts:151-175`），Core `config_get/list/history` 需要 `config.publish`（`packages/contracts/src/capability-permission.ts:485-500`），该能力只授予 admin（`packages/contracts/src/capability-permission.ts:40-82`），owner 被拒已有测试（`apps/core/src/p1/capability-permission/authorizer.test.ts:271-297`）。shell 缺独立管理员门是 P2 纵深加固，不是本票安全漏洞。
- **权限与隔离**：merchant projection 是唯一商家读模型；platform/industry 公开集合必须是已发布审核集合，workspace Skill 必须精确匹配 workspace；所有查询和提交都以认证 workspace 为边界。隐藏字段在序列化层剔除，不能靠 UI 隐藏。
- **展示语义**：`backend_only` 不可见；`explainable` 只读说明且不产生选择引用；`user_selectable` 可选且可取消，未选不注入。三类均有正向和负向 UI contract tests。
- **选择来源**：唯一生产者是 Composer draft 的确认式 pill；唯一持久化是本次 creation submission 的 execution snapshot/admission request，不做 workspace 默认。选择数组在服务端规范化后参与 fingerprint 与 idempotency。
- **OCC/幂等/失败**：projection revision 过期、引用不合资格、Recipe/Skill 不匹配、冲突或 disabled 均返回可诊断 4xx；不得静默降级为空。相同幂等载荷可重放原任务，不同载荷冲突；admission 生成快照后不允许修改选择。
- **Spec B 前置与责任**：Spec B 负责后台白名单动态来源、绑定表单合法 workflow 选择以及运行时筛选的可观测失败证据；E 只消费 B 的已发布绑定契约。B 的验收必须先通过后，E 才开启 merchant projection/旅程联测；若 B 未就绪，E 的 contract/projection 单测可运行但端到端门保持 blocked，不重复修 B。

## Testing Decisions

- **合同与接缝回归（先于 UI）**：为 `harnessTaskSubmissionSchema` 增加选择字段的 strict schema 正/负测试；Composer submission client/BFF 测试断言 draft 选择进入真实 `p1/composer/submissions` payload；Core admission 回归断言 request 读取选择并传入 resolver。旧 service 单测 `apps/core/src/p1/skills/skill-service.test.ts:845-863` 保留为 resolver 基线，不作为本票红测。
- **现状红测的正确位置**：新增 admission 级回归，使用真实 production assembly 端口证明“选择字段缺失/未透传时 user_selected 不进入 manifest”，再以实现修复使其通过；禁止重复 `selectStageRevisions` 已有行为。
- **merchant projection contract**：分别断言 `backend_only` 不返回且不渲染；`explainable` 返回只读说明、没有选择控件且不产生引用；`user_selectable` 返回 pill、可选可取消、选中/未选分别产生/不产生引用。补 workspace/tier/lens、未审核、retired、disabled、目录外 revision 的正负向过滤测试。
- **绑定矩阵行为**：Core service/admission 测试覆盖 required＋user_selected 叠加只注入一次、disabled 优先、同 Skill 冲突返回错误、用户只能选择 `user_selectable`，并覆盖 workflow/stage/tenant specificity。白名单目录外绑定的运行时筛选与可观测未生效证据由 Spec B 测试提供并作为 E 前置。
- **execution freeze/trace**：admission 集成测试断言 `CreationExecutionSnapshot.userSelectedSkillRevisionRefs`、每阶段 `HarnessExecutionAssemblySnapshot.skillStages`、route digest、prompt refs、catalog revision 和 root axes 全部冻结；发布新 Skill/Prompt/Recipe 后恢复原任务仍使用原 content hash/revision，新任务才读取新版本；审计事件携带三轴和场景。
- **完整商家旅程**：Playwright 不再使用 admin route-mock 作为验收。用已发布测试 fixture 完成 `defined → accepted_frozen → bound → exposed → invoked → persisted/traced`，在 merchant Composer 中选择 pill、提交真实 BFF/Core、读取结果/审计断言对应 stage 注入；同时覆盖取消后未注入和权限隔离。现有 admin route-mock 仅保留后台命令渲染回归，不宣称商家闭环。
- **验收门**：只有合同、BFF/Composer、admission snapshot、merchant UI、Core 注入和 trace 全通过，才称 `user_selected` 端到端完成；缺任一接缝不得以单测“取到 Skill 指令”替代。

## Out of Scope

- 不重写 `required / disabled` 两态实现，但其与 `user_selected` 的叠加、冲突、优先级矩阵属于本票验收。
- 不做技能推荐、个性化排序或学习算法；确定性的审核集合、可见性 projection、workspace/tier/lens 过滤和配方卡挂载属于本票范围。
- 不做独立 Skill 市场、开放互联网 Skill、Skill 下载/导出、商家模型选择、脚本/provider-native 首发能力；只消费已审核、已发布的 prompt-materialized Skill。
- 不重复实现 Spec B 的后台绑定白名单修复；依赖其接口和验收前置，失败时显式阻断 E 的真实旅程联测。
- 不处理 shell 独立管理员门的纵深防御加固；该项由 admin 安全加固票以 P2 接手，Core capability deny 仍是当前安全边界。
- 不提供 workspace 默认 Skill 选择或跨任务自动记忆；本票只保存单次提交冻结引用。

## Further Notes

本票修正三条全局事实：`presentationPolicy` 已在绑定期消费；白名单静默发生在运行时筛选而非 bind 拒绝；p1 配置读路径不存在商家 fail-open，真实缺口是 shell 管理员门的 P2 加固。复核关于“已有 service 测试不能复现”的判断不成立，反证是 `apps/core/src/p1/skills/skill-service.test.ts:845-863` 已传入选择并断言 allowlist；本票因此把红测移到 production admission 接缝。复核关于“技能绑定/白名单需在本票实现”的要求转交 `docs/specs/admin-backlog-2026-08-06/spec-b-silent-data-loss.md`，E 只声明前置接口、状态和失败处理。复核指出商家旅程、合同接缝、冻结审计和可见性边界的 BLOCK/MAJOR 均在本文的 Solution、Implementation Decisions 与 Testing Decisions 中锁定；未把任何关键选择留给后续 wayfinder。
