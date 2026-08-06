# Spec F｜异常首页真实化 + 管理入口改跳 + 敏感词门告警（D2 第二步 + D9）

> 来源：admin-config-audit-2026-08-06.md §2.7（敏感词软失败）、§2.12、§4.1/§4.4、§六 D2 第二步/D9。
>
> 状态：已批准并开票（2026-08-06）。实施票：#383 入口改跳＋共享投影 · #384 敏感词三态告警 · #385 URL 筛选。

## Problem Statement

管理员进后台的第一屏体验目前是错位且接缝不一致的。其一，商家壳的「进入管理模式」入口仍由命令式导航跳到 /admin/models，而不是异常优先首页（`mkfast-template-main/src/components/layout/sidebar-user.tsx:202-207`）。其二，异常首页并非纯静态基线：它已经接入 `OperationalMetric` 查询（`mkfast-template-main/src/p1/admin-exception-home.tsx:110-120`、`mkfast-template-main/src/p1/admin-exception-home.tsx:61-64`），但只做 metrics 投影；capabilities 页在同一 metrics 投影后继续叠加 supply snapshot（`mkfast-template-main/src/p1/admin-capability-registry.tsx:503-520`）。因此两页的差异集中在供给/权益能力投影，仍会对同一能力显示不一致。`not_verified` 是模型故意保留的诚实缺证据状态（`mkfast-template-main/src/p1/admin-exception-home-model.ts:448-461`），问题是重复的未核验噪音与两页状态矛盾，不应把 unknown 直接改绿。其三，敏感词门保留「启用词库为空则跳过扫描」的冷启动语义；当前列表查询允许按 `status` 过滤并返回 `total`（`packages/contracts/src/sensitive-words.ts:168-178`、`apps/core/src/p1/sensitive-words/foundation-module.ts:186-190`），但管理面尚未为该状态提供首页/审计告警（`mkfast-template-main/src/p1/admin-sensitive-words-control.tsx:61-70`）。

## Solution

把管理入口改跳到异常首页；先建立唯一的共享能力投影接缝，再让首页与 capabilities 页使用同一 metrics → supply snapshot → registry 组合；并在敏感词门被架空（启用词库为空）时于首页与审计页挂出有明确失败态的告警。三件事同批落地——入口改跳若不连带修复首页数据，管理员第一屏仍会撞见两页不一致的状态。

## User Stories

1. As a 管理员, I want 从商家壳进入管理模式时直接到异常优先首页, so that 我第一眼看到的是最需要我关注的东西。
2. As a 管理员, I want 首页的能力状态反映运行时真实情况, so that 我不会被重复的「未核验」噪音淹没。
3. As a 管理员, I want 首页与能力目录页对同一能力显示一致的状态, so that 我不会因两页矛盾而不知信哪个。
4. As a 管理员, I want 真正处于异常的能力被突出、正常的不误报, so that 异常清单可信、可据以行动。
5. As a 管理员, I want 敏感词门因词库为空或全停用而失效时在首页看到显式告警, so that 我知道内容红线此刻没在把关。
6. As a 内容合规负责人, I want 敏感词门失效的当前态也出现在审计页, so that 失效状态在管理面有据可查。
7. As a 管理员, I want 首页的「未接线/未知」诚实标注保留, so that 真未接线的项不被伪装成正常。
8. As a 平台负责人, I want 入口改跳与首页数据修复同批交付, so that 不会出现「跳到首页却充满未核验噪音」的中间态。

## Implementation Decisions

- **入口改跳（D2 第二步）**：商家壳「进入管理模式」的目标从 `/admin/models` 改为 `/admin`（`Routes.Admin`）。
- **共享能力投影接缝**：先抽取唯一的 `useAdminCapabilityRegistryProjection` 共享 hook，内部固定组合 `adminOperationalMetricsQueryKey` 的 metrics 查询与默认 `useAdminSupplyControlSnapshot` 的 supply 查询，再调用现有 metrics 投影和 supply snapshot 投影。首页与 capabilities 页都只消费该 hook，不得各自重新组装。两路使用相同 query key、`refetchOnWindowFocus: true`、`staleTime: 15_000` 与失败语义：loading 保持 `not_verified`/加载态，metrics 或 supply 失败保留旧证据并标为 `stale`，不得合成零值或绿色；pending-actions 仍是首页独有来源，失败时沿用现有 `job_queue_harness` stale 标记。
- **敏感词门告警（D9）**：保留「启用词库为空则门跳过」的冷启动友好语义（不 fail-closed）。首页与审计页共享同一个 `list { status: 'enabled' }` 查询及 query key；仅查询成功且 `total === 0` 判定「敏感词门未生效」并显示告警，成功且 `total > 0` 不告警。查询 loading 显示「正在核验敏感词门状态…」，查询失败显示「敏感词门状态无法核验」；失败和 loading 均不得当成空库、不得假绿或假空。审计页展示当前派生态，不新增持久审计事件；若要历史追溯，另立审计事件 spec。
- **首页筛选 URL 契约**：本 spec 纳入设计稿承诺的 `?exceptions=` 可分享筛选（设计依据：`docs/design/admin-reui-restyle-plan-2026-08-06.md:43`）。参数为逗号分隔的异常严重度 token（`blocked,degraded,attention,not_verified,stale`），缺省表示全部；页面从 URL 初始化并以 replace 导航同步筛选，浏览器可复制 URL 后得到相同筛选结果。该筛选仍是客户端投影筛选，不改变后端查询。
- 三处均只改入口目标、共享投影接缝与告警/筛选呈现，不改能力投影底层查询、pending-actions 语义或敏感词门判定逻辑。

## Testing Decisions

- **入口改跳**：浏览器测试点击用户菜单的「进入管理模式」，断言 URL 为 `/admin` 且异常首页标题可见；不以 href 断言，因为入口由 `router.navigate` 产生（`mkfast-template-main/tests/e2e/specs/uiux-shell-routes.spec.ts:119-122`、`mkfast-template-main/src/components/layout/sidebar-user.tsx:203-207`）。
- **状态一致**：先写红测固定 `generation_image` 或 `model_supply_routing_quality`：使用同一 supply snapshot 时，现状 capabilities 页为活状态而首页仍为 `not_verified`（不要用会随 metrics 失败数变为 `attention/stale` 的 `job_queue_harness`；证据：`mkfast-template-main/src/p1/admin-capability-registry.tsx:142-149`）。实现后，交互测试通过共享 hook 的同一 mock 数据断言两页状态一致、供给失败均为 stale、loading 不宣称空态。
- **敏感词告警**：共享查询的三态测试——loading 显示「正在核验敏感词门状态…」；查询失败显示「敏感词门状态无法核验」且不显示「未生效」/空库成功态；查询成功 `total === 0` 时首页与审计页显示「敏感词门未生效」；成功 `total > 0` 时两页均无该告警。
- **URL 筛选**：浏览器测试打开带 `?exceptions=blocked,attention` 的 `/admin`，断言仅对应严重度可见；复制同 URL 重载后筛选保持。无参数时断言完整清单。
- 诚实 unknown 的既有断言不得被改绿。

## Out of Scope

- capabilities 页静态基线 capturedAt 的刷新机制。
- 敏感词门改为 fail-closed 或新增历史审计事件（当前态可见已在本 spec，历史追溯另立 spec）。
- p1 代理读路径的安全收口不属于本 spec：复核确认 BFF 通过 `normalizeProductRole` 从 session 推导角色（`mkfast-template-main/src/lib/core-client.ts:155-160`），Core 的 config_get/list/history 要求 `config.publish`（`packages/contracts/src/capability-permission.ts:492-500`），owner 被 capability_denied 已由测试钉死（`apps/core/src/p1/capability-permission/authorizer.test.ts:285-297`）。真实剩余项是 shell 层独立管理员门加固，转交 Spec A，优先级为 P2 而非 P0。
- Skill 白名单的运行时筛选与 presentationPolicy 的商家侧消费不属于本 spec：`selectStageRevisions` 按治理白名单筛选（`apps/core/src/p1/skills/service.ts:1338-1354`），绑定期已拒绝把非 `user_selectable` Skill 绑为 `user_selected`（`apps/core/src/p1/skills/service.ts:1113-1118`）；白名单修复转交 Spec B，商家展示/可选消费转交 Spec E。

## Further Notes

D2 第一步（六域侧栏分组）已在换装波完成；本 spec 是 D2 的第二步。入口改跳、共享能力投影接缝、敏感词三态告警与 URL 筛选必须同批交付，不可拆开单独上。复核 findings 本身无驳回项；本稿仅纠正审计中关于代理 fail-open、Skill bind 拒绝和 presentationPolicy 未被绑定期消费的旧说法，并按上方边界转交相邻 spec。
