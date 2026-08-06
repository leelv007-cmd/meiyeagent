# Spec A｜管理面权限收口（BFF 纵深、封禁时效、平台角色管理）

> 来源：`docs/reviews/admin-config-audit-2026-08-06.md` §2.8、§4.5、§六 D7、报备②，以及本轮对抗式复核裁决。本 spec 的 BFF 管理员门是 P2 加固项，不把已被 Core 拦截的越权读误报为 P0 漏洞。
>
> 状态：已批准并开票（2026-08-06）。实施票：#363 BFF 管理员门 · #364 封禁即时性 · #365 裸端点 404 · #366 平台角色管理。

## Problem Statement

平台管理面有三个需要收口的真实问题。第一，Web 的 Core 代理目前只在普通路径校验登录态和邮箱验证，独立的管理员门缺失：`mkfast-template-main/src/lib/workspace-core-authorization.ts:8-28` 没有按平台角色拦截，`mkfast-template-main/src/lib/core-client.ts:155-180` 才把 session 角色映射成 Core actor。它并不等于普通商家已经能读平台配置：Core HTTP 在 `apps/core/src/server.ts:568-586` 统一执行能力授权，`packages/contracts/src/capability-permission.ts:485-500` 要求 `config.publish`，现有测试已证明 owner 的 `config_get` 返回 `capability_denied`（`apps/core/src/p1/capability-permission/authorizer.test.ts:271-297`）。真实缺口是纵深防御只剩 Core 一层，且 BFF 没有可观测、可单测的管理员门。

第二，封禁提交后 Better Auth 的 cookie cache 仍可能让旧 session 在缓存窗口内被重复接受；缓存配置为 60 分钟（`mkfast-template-main/src/auth/auth.ts:35-48`），所以封禁与恢复的下一次请求时效需要单独定义并测试。

第三，平台角色管理没有产品入口，角色变更只能落到 Better Auth 的 `set-role` 端点；现有 `admin_assisted_account_audit` 只记录管理员代开账户，字段为 action、操作者、对象和时间，没有角色前后值或原因（`mkfast-template-main/src/db/auth.schema.ts:42-57`、`mkfast-template-main/drizzle/0015_admin_assisted_account_audit.sql:1-27`）。同时，Better Auth admin 插件会整体注册多个端点（`mkfast-template-main/src/auth/plugins.ts:6-13`、`mkfast-template-main/node_modules/better-auth/dist/plugins/admin/admin.mjs:66-81`），不能用一个开关按端点禁用。需要保留产品仍使用的管理能力，只精确关闭无产品面的管理端点。

## Solution

建立四道可审计的接缝：

1. 在 BFF 的实际 `/api/core/p1/commands` 与 `/api/core/p1/query` 路由前建立可注入的 admin-config action 管理员门：`config_get/list/history/apply/rollback` 要求平台管理员，`config_defaults` 允许已登录且邮箱已验证的 workspace actor。Core 能力授权保持不变，BFF 与 Core 形成两层拒绝。
2. 封禁后删除目标用户全部 session；所有受保护 Web 请求先经过共享的 authoritative active-session guard，以当前 session token 对 session 与 user 做最小联查，确认 session 仍存在且用户未被 banned，再决定是否接受 cookie cache 内的其他数据。封禁后的下一次请求拒绝并清理 cookie；解封后允许用户立即重新登录，不恢复已删除的旧 session。
3. 用自定义的精确 `/admin/set-role` 事务命令取代该路径的 Better Auth 原生 handler：近期重新认证、角色白名单、最后管理员防线、原因必填、用户角色更新、角色变更审计、目标用户全部 session 删除在一个数据库事务中完成。新增不可变 `admin_role_change_audit` 落点，不再要求“无新表”。
4. 在 `/api/auth/$` 的 handler 外层按精确路径拦截并返回 404：`/admin/remove-user`、`/admin/impersonate-user`、`/admin/set-user-password`。保留 `/delete-user` 自助账户删除端点及其设置页消费，不把商家自助功能误纳入管理面封禁；Better Auth admin 插件继续提供 ban/unban、create-user、set-role 等仍在产品流程中的能力。

## User Stories

1. As a 平台运营, I want BFF 对 global 平台配置增加独立管理员门, so that Core 之外仍有一层可观测的权限边界。
2. As a 商家, I want global 平台配置不会从 Web 代理返回给我, so that 平台商业配置不暴露；workspace 级配置仍按既有 Core 合同处理。
3. As a 平台运营, I want 封禁一个账号后它的下一次请求立即失效, so that 违规行为不会等待缓存窗口。
4. As a 被误封的商家, I want 解封后立即可以重新登录并恢复访问, so that 误操作可以快速纠正。
5. As a 平台运营, I want 在用户详情页把可信同事提升或降级为管理员, so that 平台不依赖单一管理员账号。
6. As a 平台运营, I want 角色变更前通过近期重新认证（step-up）, so that 被劫持的会话不能批量制造管理员；本 spec 不引入 MFA 或第二因素。
7. As a 平台运营, I want 每次角色变更记录操作者、对象、前后角色和原因, so that 事后可以追责。
8. As a 平台运营, I want 系统阻止降级最后一个管理员, so that 平台不会进入无管理员死锁。
9. As a 安全审计员, I want 明确关闭无产品面的 admin 管理端点, so that 攻击面与管理产品面一致；商家自助 `/delete-user` 不受影响。
10. As a 安全审计员, I want 越权读请求返回 403 并有结构化观测, so that BFF 缺口和异常访问模式可被发现。
11. As a 实施 agent, I want 保留 cookie cache 并对所有受保护请求校验最新 banned 状态, so that 即时封禁不以关闭全部 cookie cache 为代价。

## Implementation Decisions

- **Admin-config 授权矩阵（单一决策）**：公开 BFF/Core HTTP 合同固定为：`config_defaults` 允许已登录且邮箱已验证的 workspace actor 和管理员；`config_get`、`config_list`、`config_history` 对 global 与 workspace scope 都只允许管理员；`config_apply`、`config_rollback` 也只允许管理员。Core foundation 内部仍可保留 workspace actor 查询 workspace definition 的领域行为（`apps/core/src/p1/admin-config/foundation-module.ts:915-979`、`apps/core/src/p1/admin-config/foundation-module.test.ts:928-971`），但不把它扩成 Web 公共 HTTP 合同。`packages/contracts/src/capability-permission.ts:485-500` 与 Core 测试保持不变。
- **BFF action 接缝**：新增一个由 Web 路由和测试共同调用的 `authorizeAdminConfigProxyRequest` 接口，输入经 `p1ModuleRequestSchema` 解析后的 module/action 与 authoritative session；admin-config 的 get/list/history/apply/rollback 要求 `role === 'admin'`，defaults 走既有登录/邮箱门，未知 admin-config action 默认拒绝。`/api/core/p1/commands` 和 `/api/core/p1/query` 的真实 route handler 必须使用该接口；不得只扩展 `authorizeWorkspaceCoreRequest` 的孤立单元测试。
- **封禁即时性**：保留 Better Auth cookie cache；先建立共享 `requireActiveSession` 接缝，供所有受保护页面、server function、BFF Core 代理、文件/API 与 admin 请求使用。它可复用 cookie cache 中的非授权 session 数据，但每次都以当前 token 对 session/user 做权威最小联查，session 不存在或 user.banned 即拒绝并过期 cookie。ban 事务成功后删除目标用户全部 session；unban 后旧 session 不复活，用户可立即重新登录。不得只修改当前三个 middleware 而遗漏直接调用 `createAuth().api.getSession` 的受保护路由。
- **角色管理入口与接缝**：用户详情页新增角色分区，动作只有“提升为管理员”和“降级为商家”。请求必须带 `userId`、目标角色和非空 `reason`。Better Auth 原生 `set-role` 只接受 `userId/role`（`mkfast-template-main/node_modules/better-auth/dist/plugins/admin/routes.mjs:43-77`），所以 `/api/auth/admin/set-role` 由 catch-all 外层的自定义 handler 接管，不再下传原生 handler；handler 在一个数据库事务内锁定管理员集合和目标用户、阻止降级最后一个管理员、更新角色、写 `admin_role_change_audit`、删除目标用户全部 session。审计字段为 actorUserId、subjectUserId、fromRole、toRole、reason、createdAt，数据库触发器拒绝 UPDATE/DELETE；任一步失败则角色、审计和 session 删除全部回滚。
- **Step-up 术语与范围**：统一使用“近期重新认证”或“step-up”，对应现有 15 分钟 `requireRecentAuthentication` 检查（`mkfast-template-main/src/auth/recent-admin-session.ts:51-71`）；不称“二次认证”，不实现 MFA。高风险 admin 路径已有 `disableCookieCache` 的近期认证中间件（`mkfast-template-main/src/middlewares/auth-middleware.ts:71-95`），角色包装层复用同一语义。
- **精确端点拦截**：不移除 Better Auth admin 插件；在 `mkfast-template-main/src/routes/api/auth/$.ts:4-9` 的 catch-all handler 外层按 pathname 分派。三个禁用路径返回 404 和稳定错误码，`/admin/set-role` 进入上述自定义事务 handler，其余路径下传 Better Auth。保留 `/admin/ban-user`、`/admin/unban-user`、`/admin/create-user`、`/admin/update-user`、session 撤销端点，以及商家自助 `/delete-user`。忘记密码流程继续承担用户自助改密需求。
- **Skill 事实转交**：Skill 白名单的静默点是运行时 `selectStageRevisions` 按治理白名单筛选（`apps/core/src/p1/skills/service.ts:1340-1354`），不是 bind 拒绝；bind 只做非空/状态与 `presentationPolicy` 校验（`apps/core/src/p1/skills/service.ts:1097-1118`）。白名单来源和消费者证明转交 Spec B；商家侧 `presentationPolicy` 展示/可选消费转交 Spec E。本 spec 不重复开票，也不把这两项写成 admin 访问漏洞。

## Testing Decisions

- 测试只断言外部响应、状态和可查询事实；所有“先红后绿”必须在真实接缝上复现。
- **BFF HTTP 集成先例**：先建立 route-level harness，直接调用 `/api/core/p1/commands` 与 `/api/core/p1/query` 的实际 POST handler，注入 session getter、action authorizer 和可控 Core upstream。三分支固定为：普通商家请求 `config_get`/`config_history`/`config_list` → BFF 403 且不调用 upstream；管理员同请求 → 转发并可得到 Core 200；普通商家 `config_defaults` → 转发并可得到 Core 200。另保留 Core HTTP owner `config_get` 403 断言，证明 BFF 测试验证的是纵深缺口而非虚构越权。
- **Admin-config 矩阵**：保留 `apps/core/src/p1/admin-config/foundation-module.test.ts:928-971` 的内部 workspace 查询领域测试；在 BFF 与 Core HTTP 两层分别覆盖 defaults、get/list/history、apply/rollback 的 merchant/admin 矩阵。未知 admin-config action 必须拒绝。
- **封禁时效**：用两个 Playwright browser context：独立 `admin context` 登录管理员，独立 `merchant context` 登录商家并保留其 cookie。管理员封禁后，merchant context 的下一次页面和 API 请求都被拒绝并清理 cookie；管理员从 admin context 解封，merchant context 重新登录后第一条请求成功。补共享 session guard 单元测试，覆盖 cookie cache 命中时 session 已撤销与 user 已封禁两条拒绝分支，并以静态/路由覆盖测试证明所有受保护 session 读取都经过该 guard。
- **角色管理**：交互/HTTP 覆盖提升、降级、最后管理员拒绝、缺少近期重新认证拒绝、原因为空拒绝、自身目标 session 撤销。变更后目标用户旧 session 的下一请求必须 401；重新登录后的第一条请求必须按新角色授权。查询 `admin_role_change_audit` 断言 actor、subject、fromRole、toRole、reason 五项且 UPDATE/DELETE 被数据库拒绝。
- **裸端点**：对 `/admin/remove-user`、`/admin/impersonate-user`、`/admin/set-user-password` 各做管理员和非管理员 404 回归；对 `/delete-user` 保留自助 UI/API 正常路径与近期重新认证测试，防止误封商家删号。
- **先红后绿边界**：越权读的红测必须证明普通商家 BFF 在 Core upstream 假设 200 时当前会放行；不能用已有 Core owner 403 测试冒充 BFF 缺口。封禁红测必须从真实缓存 session 形态开始，而不是只测数据库字段。

## Out of Scope

- 不改变 Core 既有 `config.publish` 能力合同，也不把 workspace 级 `owner/operator/reviewer` 改成平台管理员；global/workspace/config_defaults 的矩阵只在本 spec 的边界内收口。
- 不关闭商家自助 `/delete-user`，不删除忘记密码/重置密码流程；任何自助账户删除兼容性变更另立 auth spec。
- 不做管理员权限分级（超管/普通管理员），仍是单一 `admin` 角色。
- 不引入 MFA、IP 限制或登录风控；“近期重新认证/step-up”仅复用现有 15 分钟检查。
- 不移除 Better Auth admin 插件；仍在产品流程中的 ban/unban、create/update-user、role 和 session 撤销端点保留。
- 不处理 Skill 白名单或商家技能旅程：分别转交 Spec B 与 Spec E。

## Further Notes

完成标准是：BFF 真实 route handler 有独立管理员门，Core 仍保留 capability 兜底；封禁在目标用户下一请求生效，解封后可立即重新登录；角色升降权在目标用户重新认证后的第一条请求按新角色生效；角色、审计与 session 撤销原子提交；三个精确 admin 裸端点关闭而 `/delete-user` 保持可用。

本轮复核中被判定为事实错误并已改正的说法有三项：普通商家可读全部平台配置是误报（反证为 `apps/core/src/server.ts:568-586`、`packages/contracts/src/capability-permission.ts:485-500`、`apps/core/src/p1/capability-permission/authorizer.test.ts:271-297`）；Skill bind 会拒绝非白名单工作流不成立，真实静默在运行时筛选（`apps/core/src/p1/skills/service.ts:1097-1118`、`:1340-1354`）；`presentationPolicy` 并非完全未消费，绑定期已拒绝不合规的 `user_selected`（同文件 `:1113-1118`）。

已明确转交：Skill 治理白名单与运行时消费者证明交给 `docs/specs/admin-backlog-2026-08-06/spec-b-silent-data-loss.md`；商家侧 `presentationPolicy` 展示与 user_selected 旅程交给 `docs/specs/admin-backlog-2026-08-06/spec-e-user-selected-skill-journey.md`。
