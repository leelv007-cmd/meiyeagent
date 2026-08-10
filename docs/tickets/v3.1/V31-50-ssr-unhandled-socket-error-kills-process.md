# V31-50 — Web SSR 拿不到 PG 连接时未接管的 socket error 杀掉整个进程

**Parent**: 无 spec 条目——运行时健壮性缺口（非产品行为）
**批次**: 平台健壮性（独立开工，不与任何 lane 共享文件）
**Blocked by**: None
**Related**: V31-48（同为「测试基建/环境类红」家族，但本票是**产品进程的健壮性缺陷**，与仪器无关——见文末「为什么这是产品票而不是运维条目」）
**Status**: open

## 缺口（一句话）

Web SSR 在 Postgres 返回 `53300 sorry, too many clients already` 时，postgres.js 底层 socket 发出的 `'error'` 事件**没有任何监听者**，触发 Node 对未处理 `'error'` 的默认行为——**杀掉整个 SSR 进程**。一个拿不到连接的请求应该失败成 5xx，而不是带走所有并发请求和整个渲染进程。

> **锚署树**：行号出自 **`2da11d5ab`**（W4-D round3 的证据树，`merge: W4-B 4A — scope pre-run admission verify to the pre-admitted branch`）。

## 证据（W4-D journeys lane，2026-08-10）

| # | 证据 | 落点 | 说明 |
|---|---|---|---|
| 1 | 崩溃路径的查询点 | `mkfast-template-main/src/lib/auth/workspace-provisioning.ts:319`（`async get(workspaceId, ownerUserId)`）→ `:320` `this.database.execute<ProvisioningRow>(sql\`…\`)` | SSR 渲染 dashboard 时的 workspace 供给查询 |
| 2 | Round1 / Round2 崩溃堆栈**逐字节相同** | `scratchpad/w4d/09-v31-playwright-13specs-rerun.log:400-456`（`node:events:486` … `Node.js v24.9.0`） | 两轮独立复现同一形态，非偶发 |
| 3 | **同根因在 round3 被正常捕获成 500**（关键对照） | `scratchpad/w4d/round3-per-spec/v31-ops-console-release-journey.log:189`（`cause: PostgresError: sorry, too many clients already`）／`:197`（`code: '53300'`） | 同一个 `53300`，这次被 Drizzle 当查询错误捕获，进程存活 |
| 4 | Round3 逐 spec 独立进程后未再复现 crash-to-death | `scratchpad/w4d/round3-per-spec/SUMMARY.txt`（13 spec 全部跑完，`ALL_SPECS_DONE`） | 说明致命性**不是** round1/2 的跑法造成的 |

**证据 3 是本票的核心**，它把结论从「并发打满会崩」收窄成一句精确得多的话：**同一个 `53300` 错误，命中哪条连接池代码路径决定它是 500 还是进程死亡**。有一条路径把 socket error 接住了，另一条没接。所以这不是「负载太高」的问题，是**错误处理路径不齐**的问题——即使连接预算永远充足，任何让底层 socket 报错的原因（网络抖动、PG 重启、连接被 kill）都能走到同一个致命分支。

## 为什么这是产品票而不是运维条目

54329 实例 `max_connections=100` 被跨 lane 并发打满，这件事本身**是已知运维陷阱**（`e2e-lock.sh` 协议、记忆里的端口/库纪律），本票**不为它开票**。

本票要的是另一半：**无论什么原因导致拿不到连接，SSR 进程都不该死。** 这一条与环境无关——生产环境同样会遇到连接耗尽、PG failover、连接被管理员 kill。当前形态下这些都会让整个 Worker/Node 进程消失，而不是让那一个请求返回错误页。

## What to build

1. 给 postgres.js 的连接/socket 层挂上 `'error'` 处理，使**连接级错误变成请求级失败**：该请求 5xx（或降级渲染），进程继续服务其他请求。
2. 让两条连接池路径的错误处理**对齐**——证据 3 证明其中一条已经能正确捕获，先查明两条路径的差异，按能捕获的那条对齐，而不是新造一套。
3. 失败要**可观测**：日志里能看出「这次 5xx 是因为拿不到 PG 连接」，不要静默成通用 500。

## 边界（明确不做）

- **不改连接预算**、不动 `max_connections`、不动 `e2e-lock.sh`——那是运维面，且已有协议。
- **不加重试**。本票只要求「失败得干净」，重试是另一个决策（重试会在连接耗尽时加剧拥塞）。
- 不改 `workspace-provisioning.ts` 的业务语义，只改错误处理。

## Acceptance criteria

- [ ] 在 SSR 的供给查询路径上注入一次连接层错误（模拟 `53300` 或直接让底层 socket 报错）⇒ **该请求返回 5xx，进程存活**，后续请求正常
- [ ] 同一注入在**两条连接池路径**上都不致命（证据 3 已证其一可捕获；本条要求另一条对齐）
- [ ] 日志能区分「拿不到连接」与其他 500，商家不可见但运维可判
- [ ] **变异反证**：临时摘掉新加的 `'error'` 处理 ⇒ 注入用例必须由绿转红（进程死亡）。改后立即还原，终态 `git status --porcelain` 空
- [ ] 回归：`pnpm --filter @meiye/web test` 与 `test:interaction` 不因本改动新增红（基线见 W4-D 终表第一节：test 2101/2088 pass/13 skip、interaction 606 全绿）

## 留痕

- 开票：W4-D（journeys lane）三轮浏览器验收的 ECONNRESET 专题产出，主控 2026-08-10 派 review-memory 落票。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：锚点与三条日志证据逐条只读核证（`workspace-provisioning.ts` 真实路径为 `src/lib/auth/` 而非 `src/product/`，已按 `2da11d5ab` 署实）；把结论从「并发打满会崩」收窄为「同一 `53300` 的致命性取决于命中哪条连接池路径」，并据此把「两条路径对齐」写成独立验收项。本 commit 零代码改动。
