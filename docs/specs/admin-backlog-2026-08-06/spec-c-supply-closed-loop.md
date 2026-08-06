# Spec C｜供给闭环修复（凭据轮换回执 / 测试连接回显 / 模式键环境提示 / 动作去重 / 错标）

> 来源：admin-config-audit-2026-08-06.md §2.2、§2.4、§2.9、§3.2、§六 D6。DRAFT。
> 运行表的 `q`、模型、任务等筛选 UI 已在换装波完成；本票只保持其接线，不重新开票或改动筛选实现（`mkfast-template-main/src/p1/admin-supply-run-table-model.ts:37-51`、`mkfast-template-main/src/routes/admin/supply.tsx:13-37`）。

## Problem Statement

供给与集成面有几条「做了一半」的链路，让运营在产品里走不通或被界面误导。凭据轮换在集成页只完成暂存并签发了一个短时回执，但前端把回执丢弃只弹「已保存」，而在供给页完成轮换又强制要求手填这个回执 ID——接力棒在交接处掉了，平台凭据轮换事实上无法完成。回执有效期为 15 分钟，并绑定 workspace/account（`apps/core/src/p1/integrations/provider-credential-runtime.ts:341-377`；`apps/core/src/p1/supply-registry/postgres-admin-supply-runtime.ts:295-342`），因此不能通过 URL 暴露。

测试连接的事实缺口更精确地定义为：旧 `IntegrationConnection` 测试命令仍调用 `IntegrationApplicationService.testProviderConnection` 并把 `testStatus/testedAt/testErrorCode` 写回旧连接（`apps/core/src/p1/integrations/foundation-module.ts:345-352`、`apps/core/src/p1/integrations/application-service.ts:521-584`），而 `/admin_provider_credentials` 查询投影的是 `CredentialAccount.lastTest`（`apps/core/src/p1/integrations/foundation-module.ts:490-512`）。只有供给探针路径明确调用 `recordConnectivityResult` 写 CredentialAccount（`apps/core/src/p1/supply-registry/production-provider-evidence.ts:291-307`）。问题不是笼统的「写入另一个字段」，而是旧 command 路径没有桥接查询所依赖的 CredentialAccount。

模式键的事实限定为：在未显式设置环境变量、被 `runtime-profile` 解析为 `APP_ENV=e2e` + `MODEL_EXECUTION_MODE=fixture` 的开发启动中，runtime wiring 跳过两个模型模式键的落库读取（`apps/core/src/p1/admin-config/runtime-wiring.ts:69-86`；默认解析见 `scripts/dev/runtime-profile.mjs:22-56`）。显式 `APP_ENV=development` 会默认 `recorded`，不能把所有开发运行统称为「裸 dev 不生效」。

`stop_new_tasks` 与 `isolate` 当前在动作目录、Core action union、canonical 映射和预览投影中共存且预览均落到 `mode: isolated`（`mkfast-template-main/src/p1/admin-supply-quick-actions-model.ts:26-42`、`mkfast-template-main/src/p1/use-admin-supply-control.ts:145-163`、`apps/core/src/p1/supply-registry/admin-control-plane.ts:397-411`、`apps/core/src/p1/supply-registry/postgres-admin-supply-runtime.ts:972-980`）。`plan.payment-mapping` 的结算消费是真实存在的，但分类表尚未把它列为 wired；未写配置时投影 `effectiveValue` 可以为空（`apps/core/src/assembly/domain-rules.ts:63-71`、`apps/core/src/p1/admin-config/foundation-module.ts:1047-1058`）。

## Solution

把这几条链路补齐或去误导：轮换命令返回的回执在集成页显示，并通过不进 URL 的同源一次性 handoff 交给供给页；测试连接 command 路径桥接到 CredentialAccount 后回显到点击的同一页；模式键依据运行时真相快照（含 BYOK）诚实标注当前进程的生效条件；删除与 isolate 无差别的 `stop_new_tasks` 全链路入口；把支付映射键标为 wired，并用真实结算接缝证明其消费。

## User Stories

1. As a 运营, I want 在集成页完成凭据轮换的暂存后拿到并看到回执 ID, so that 我能在供给页完成轮换的第二半。
2. As a 运营, I want 集成页在轮换后能安全把我带到供给页并预填回执, so that 我不必手抄一串 ID 且回执不进入 URL 历史。
3. As a 运营, I want 平台凭据轮换能在产品里真正走完, so that 密钥版本能前进、凭据能被真实更换。
4. As a 运营, I want 点「测试连接」后在同一页看到测试结果, so that 我知道这次测试到底成没成。
5. As a 运营, I want 模型执行模式键的界面诚实告诉我它在当前进程和环境下何时生效, so that 我不会改完以为重启就行、结果白等。
6. As a 运营, I want 供给动作清单里不出现两个行为完全一样的动作, so that 我不会困惑该点哪个。
7. As a 运营, I want 支付映射的接线状态显示正确, so that 我不会把一个结算时真读的活配置当成死配置。
8. As a 平台负责人, I want 每处修复都能被一条端到端或契约测试证明, so that 闭环不会再断。

## Implementation Decisions

- **轮换回执断链**：固定交付为「集成页显示回执 ID 与 expiry」+「去供给页完成轮换的同源一次性内存 handoff」。命令返回的回执元数据只进入当前 SPA 会话的内存状态，handoff 记录包含 workspace、account、receiptId、expiry；导航不把 receiptId 放入 query、hash、Referer 或外链。供给页消费前再次以当前 workspace/account 向 Core 校验，成功、过期、重复消费或绑定不匹配后立即清除内存记录；页面刷新时 handoff 丢失，手工输入仅作为恢复入口，不作为主旅程。页面不得展示 secret、secretReference 或原始凭据。
- **测试连接回显**：选择修改 `admin_test_provider_connection` command 路径，而不是改查询投影。旧 IntegrationConnection 仍可作为探针取密钥的输入；探针成功后，command 必须把结果映射为对应的 global CredentialAccount（accountId、credentialVersion、status、testedAt、errorCode、受控 evidenceRef），调用 CredentialAccount 的 `recordConnectivityResult`/等价明确桥接端口并以该账户的公开元数据作为 command 返回。`admin_provider_credentials` 继续只读 CredentialAccount；禁止用「经既有 record 路径」替代上述映射契约。
- **模式键环境提示**：现有 `RuntimeEffectiveSnapshot` 只有 execution/media 两个模式及来源（`apps/core/src/p1/admin-config/foundation-module.ts:77-91`），且 admin-config projection 只投影这两个键（`apps/core/src/p1/admin-config/foundation-module.ts:986-1005`）；BYOK 目前仅由独立 `byokSource` 返回（`apps/core/src/p1/admin-config/runtime-wiring.ts:150-177`）。UI 要显示三个键当前进程的 effective value、source、bootedAt 与 fallback reason。先扩展 `RuntimeEffectiveSnapshot` 合同，增加 `runtimeEnvironment: { appEnv: string; modelExecutionMode: string }`、`byokMode`、`byokSource`、`byokFallbackReason`（`processKind` 沿用现有字段）；运行时在同一次装配中把实际环境对、`integrationAdapterEnvFromSources` 返回的 `byokSource` 与实际 BYOK mode 写入快照，admin-config projection 对三个键均投影该快照。fixture 档提示只在快照明确为 `runtimeEnvironment.appEnv=e2e`、`runtimeEnvironment.modelExecutionMode=fixture` 且对应 source 为 env fallback 时出现；不得把未写配置时 `effectiveValue` 非空作为要求。
- **动作去重（D6）**：删除 `stop_new_tasks` 的全链路类型/矩阵/投影/审计兼容与测试：前端动作目录和 canonical 映射、Core `GovernedSupplyActionId`/注册矩阵、预览与执行分支、能力映射及新动作断言均移除。历史审计记录保留并可只读展示/反序列化，但不得再接受新的 `stop_new_tasks` command。动作矩阵收敛为 isolate（停新增+隔离）与 drain（停新增+等在途排空）；第三语义另开票。
- **支付映射错标**：将 `plan.payment-mapping` 加入 `wiredKeys`，但不把它伪装成有 runtime 默认值。接线状态测试与结算消费测试分离：前者断言分类 `wired=true`；后者写入映射后通过真实 entitlements/payment settlement seam 读到该映射并断言计划层级变化（现有结算契约已覆盖该接缝，见 `apps/core/src/p1/foundation/entitlement-module.test.ts:1854-1926`）。未写配置时允许 projection `effectiveValue` 为空。

## Testing Decisions

- 好测试断言运营可观察到的结果：回执可见且安全交接、测试结果可见、动作清单不含新建的重复项、接线徽章正确、模式提示与运行时快照一致。
- **轮换回执**：先补集成页 command 返回值的 Core fixture/Mock、同源一次性 handoff 接缝与版本查询断言，再写 Playwright 红测：集成页暂存轮换 → 断言回执 ID/expiry 显示且 URL 无 receiptId → 跳转供给页并由 handoff 预填 → 完成轮换 → 断言 secretVersion 前进。负例必须覆盖 receipt 过期、重复消费、错误 account、错误 workspace；断言消费后 handoff 被清除，且不记录 secret 或 receipt 到外链/分析请求。
- **测试连接回显**：新增同型 interaction test，mock `commandP1` 返回更新后的公开 CredentialAccount 元数据，并 mock query invalidation/refetch；点击后断言同页 `testStatus`、`testedAt`、`testErrorCode` 更新。另保留 Core 契约测试验证 command 返回与 `admin_provider_credentials` 查询均来自 CredentialAccount，且不泄露 secret/secretRef；现有静态 SSR 测试只能作为投影回归，不充当点击测试。
- **动作去重**：前端模型测试断言无 `stop_new_tasks`，Core 类型/矩阵/预览/执行测试断言新请求被拒绝、isolate/drain 语义仍成立；增加历史 `stop_new_tasks` 审计只读展示回归。
- **分类表与结算**：独立断言 `plan.payment-mapping` 的 `wired=true`；再通过真实 entitlements/payment settlement seam 写入映射并断言结算读到新 tier。不要无条件断言未写配置时 `effectiveValue` 非空；`assertAdminConfigKeyConsistency` 只用于分类结构完整性。
- **模式键提示**：扩展 RuntimeEffectiveSnapshot 的 Core 契约测试，分别覆盖默认 runtime-profile 的 e2e+fixture、显式 development+recorded，以及 BYOK 的 `byokSource`/fallback reason；交互测试断言 UI 仅在前者提示「当前环境开机不读落库值」，并显示 process/source/effective value。

## Out of Scope

- 改变 runtime-profile 的默认环境对（未显式环境变量时为 `APP_ENV=e2e` + `MODEL_EXECUTION_MODE=fixture`），或取消 fixture 档跳过模式键落库读取的规则；本 spec 只做界面诚实标注。
- BYOK 的完整 live 切换、热切换或凭据激活流程；本票只扩展 fixture 档 effective source/提示所需的只读快照契约。
- 运行表筛选 UI（已完成，仅保持接线）。
- `/admin/models` 的 Catalog `capabilities/routes` 死字段与统计 chip、revision activity 查询接入、生命周期表单结构；转交 Spec G，避免与本票重复开票。
- 供给动作的权限模型变更；删除 `stop_new_tasks` 的全链路类型/矩阵/投影/审计兼容与测试属于本票，但独立 shell 管理员门加固转交 Spec A，按 P2 加固项处理。
- p1 代理读路径 fail-open、普通商家可读全部平台配置：该说法是误报，不作为本票安全漏洞；BFF 由 session 通过 `normalizeProductRole` 推导角色（`mkfast-template-main/src/lib/core-client.ts:151-165`），Core config_get/list/history 需要 `config.publish`（`packages/contracts/src/capability-permission.ts:485-500`），且 owner 被 capability_denied 钉死（`apps/core/src/p1/capability-permission/authorizer.test.ts:271-297`）。仅 shell 独立管理员门加固转 Spec A/P2。
- Skill 白名单静默筛选不属于本票：bind 只做非空及 `presentationPolicy` 校验（`apps/core/src/p1/skills/service.ts:1097-1118`），运行时由 `selectStageRevisions` 治理白名单过滤（`apps/core/src/p1/skills/service.ts:1338-1354`）；运行时白名单修复转 Spec B，商家侧 `presentationPolicy` 展示/可选消费转 Spec E。

## Further Notes

轮换回执断链是本批影响面最大的一条——它让「平台凭据轮换」这个能力在产品里名存实亡，建议优先。实现顺序固定为：先建 command→CredentialAccount 桥接与 receipt handoff 接缝，再补交互/Playwright 红测，最后收敛 D6 全链路删除与分类/提示回归。测试连接的供给探针 `recordConnectivityResult` 不是旧 command 的既有路径，不能以其存在替代桥接实现。
