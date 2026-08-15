# V31-69 — 首屏入口 chunk 减重：paraglide 按 locale 拆分＋contracts schema 迁出入口路径

**Parent**: root-quality bundle 预算 2026-08-12 重定基线（350k→380k）的配套减重票
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-24（HeroUI 扩容波）、uiux-upgrade-b ledger（预算最初设定处）

**Status**: implementation-complete / release-verification-pending（2026-08-13）— contracts 精确 subpath 已切断入口 schema 聚合，gzip 恢复到 350k 预算内；未扩张 i18n 管线，最终 required CI 待补

**Implementation state**: done for the measured bundle target
**Verification state**: local build/typecheck/budget verified; required same-SHA CI pending
**Release state**: pending PR + `Core quality / required`
**Evidence SHA**: 7693bfb5b49c5450faaf8d38833631864c273e89
Evidence 注：implementation；integration candidate 39ca4b399361a9226848c71009d3d6500612ce2c
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

root-quality 的 bundle 守卫在 `main-*.js` 入口 chunk 上量出 gzip 370,661 字节，超原 350,000 上限 5.9%。2026-08-12 用 sourcemap 归因（`vite build --sourcemap`＋map sources 分析，893 个模块）确认**无一小时级懒加载快赢**，按拍板将基线调至 380,000（`scripts/uiux/evidence-tools.mjs` 注释记录），真实减重收进本票。

## 归因数据（入口 chunk，源码字节，压缩前）

| 来源 | 源码体积 | 说明 |
|---|---|---|
| `@base-ui/react` | 556 KB | shell 在用（floating-ui-react 192K/menu 74K/navigation-menu 66K/internals 63K…），非误引 |
| `react-dom` | 533 KB | 不可避免 |
| **`src/locale/paraglide`** | **362 KB** | **messages 300 KB（214 个模块）＋runtime 62 KB，全量进入口** |
| `zod` | 266 KB | 被入口可达的 contracts schema 拉入 |
| contracts 系（agent-domain 83K＋content-package 38K＋marketing-package 31K＋harness 24K＋product 20K…） | ~220 KB | schema 密集模块在入口路径上 |
| `@tanstack/*`（router-core 153K＋react-router 71K＋query-core 65K…） | ~320 KB | 框架层 |

## 减重方向（按性价比）

1. **paraglide 消息按 locale/按需拆分**：214 个消息模块（含双语内容）全量进入口。方向＝消息模块产物按 locale 分文件、非活跃 locale 懒加载，或按路由/模块边界切消息包。⚠️ 本仓的消息编译是自有管线（`scripts/compile-locale.ts`，message-modules 10,207 文件），改造要动编译器输出布局与 runtime 读取面——**这是 i18n 管线级工作，不是配置开关**；且 typecheck/test/e2e 都以 locale:compile 开头，产物布局变更牵连所有门。
2. **contracts schema 迁出入口路径**：查 entry→contracts 的引用链（大概率是 auth/session 或 route loader 层引了聚合导出），把 schema 引用下沉到用到它们的 route/feature chunk，切断 zod＋~220KB contracts 源进入口。
3. （观察项）`routes/dashboard` 51KB＋`routes/admin` 33KB 源码出现在入口——TanStack 路由本应按路由分包，核对 routeTree 是否存在 eager 引用把路由代码卷进 main。

## 验收

- 入口 gzip 回到 ≤350,000 后，把 `evidence-tools.mjs` 基线调回 350_000 并删除重定基线注释；
- 三门与 root-quality 全绿；i18n 双语言行为在 e2e 下无回归。
