# V31-79 — dev 环境单一真相：launchd 假 Core 清除、dev 档可启动、平台默认模型供给、worker 配对

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §2）
**批次**: 清红队列（仪器/环境，先于能力收敛）
**Blocked by**: 无
**Related**: V31-78（触发因供给）、V31-64/V31-70（进程存活仪器先例）、`feedback-provisioning-single-gate`（清单先行）

**Status**: implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（scripts 30/30、seed+harness 4/4、core tsc、biome、dev:smoke 两跑全绿零漏库），余 plist 处置（等用户确认）与 required CI

**Implementation state**: done（main@1baf2074，rebase 后）
**Verification state**: locally verified（见 Evidence 补记）
**Evidence SHA**: 1baf207461e57fd4fafbdce250a4582ddef03bcb
Evidence 注：走查代码树；launchd agent 已 bootout（plist 文件保留待处置）
**Workflow Run**:
**Artifact Digest**:

## 缺口（一句话）

本机 dev 环境多日无单一真相：launchd 常驻 e2e Core（业务库 54330）占 4100 掩盖了
「dev Core 在当前 main 上根本起不来」，web（54329）与 Core（54330）双库分脑，
积分/事实各看半套——所有本地走查与「dev 复核」的可信度被整体拉低。

## 事实清单（盘点取证）

1. `~/Library/LaunchAgents/com.meiye.core-test.plist`：KeepAlive 守护 e2e fixture Core，
   DB 改写 54329→54330。已 bootout；**plist 来源不明**（何时何人安装待考），文件保留。
2. `.env`＝`APP_ENV=development`+`MODEL_EXECUTION_MODE=direct` 时，Core boot 抛
   `Harness production runtime requires a live direct structured model`（activation 无
   live 探针核销）⇒ `pnpm dev` 的 Core API 必崩，靠假 Core 掩盖。
3. 平台默认模型（`admin-config global/__global__/platform_default_model_*`）在 54329
   从未配置；e2e 靠 `E2E_PLATFORM_DEFAULT_MODEL_*` env 兜底 ⇒ dev 库上注册即触发 V31-78。
4. 媒体生成需要配对 worker；dev 栈 worker 与 API 的 env 档位可各自漂移（direct worker
   ＋ fixture API 混跑），无一致性断言。
5. 孤儿进程：已删 worktree 的 Core（3d14h）、凌晨 Playwright 残浏览器——lane 清理不含进程面。

## What to build

1. **处置 plist**：确认来源后删除（或改造成显式 `pnpm dev:core-test` 脚本，禁 KeepAlive）。
2. **dev 档可启动**：给 development 档一条合法启动路径——要么 activation 探针核销流程
   跑通（live 门一次核销），要么 dev 默认 `recorded` 并在 runtime-profile 里对
   `development+direct 无 activation` 给出**启动时明错**（指向解法），不许静默死。
3. **平台默认模型供给**：`provision-test-db.sh`／dev bootstrap 把四个平台默认模型写入
   admin-config（或 dev 档同样吃 `PLATFORM_DEFAULT_MODEL_*` env），清单入 `.env.example`。
4. **进程卫生断言**：`pnpm dev` 启动前探测 4100/3000 占用者身份（端口被非本栈进程占用时
   明错退出，打印占用者 cmdline），对齐 V31-64「门无存活断言」的教训到 dev 面。
5. **worker 配对断言**：API 与 worker 的 APP_ENV/MODEL_EXECUTION_MODE/DATABASE_URL
   不一致时启动即报。

## Acceptance criteria

- [ ] 全新克隆＋`pnpm dev` 在无任何手工 env 的情况下起来一套自洽栈（web/Core/worker 同库同档）
- [ ] 注册新账号 → 100 分可见 → copy 单走通（dev 栈冒烟脚本化，可进 `pnpm dev:smoke`）
- [ ] 4100 被外部进程占用时 dev 启动明错并打印占用者
- [ ] plist 处置完毕并在本票留痕

## 留痕

- 开票：2026-08-13 盘点第一轮。教训升格：**「验收环境的进程面」与「代码」同等是仪器**——
  假 Core 存活期间，所有「dev 亲验」证据的效力都要打折（含 08-13 早 V31-73/74/75 的 dev
  复核轮——行为面结论仍成立，因为假 Core 跑的也是产品代码，但其数据面结论（积分等）已被
  本轮重新定性）。

## Evidence 补记（2026-08-13 主控收口，实现树 1baf2074）

- 亲验：scripts/dev 测试 30/30、seed＋harness runtime 4/4、core tsc 净、biome（lane 文件）净；
  dev:smoke 两跑 `dev:smoke passed: register … credits=100 task=composer-task:…`，临时库计数归零
  （主控修一处清库 SQL：双语句单 `-c` 落隐式事务致 DROP DATABASE 报错，拆两个 `-c`）。
- opt-in evidence 守卫：harness 目录变更触发 25 个 env-gated 套件 STALE；点名四套件本地新库亲跑
  ——合跑一次红定性为多文件并发共库的调用方式问题（主树对照绿＋lane 树单跑绿），非本票回归；
  全量重跑与 evidence 台账更新归 required CI 轮。
- 残项：①plist 处置（票面 What to build 第 1 项，host 操作，等用户确认来源后删除或改造显式脚本）；
  ②development+recorded 依旧被 activation 门挡（不视为缺陷：零凭据路径钦定为 e2e+fixture，
  recorded 档若要开放需 activation 语义决策，报主控）。

## R2 补记（2026-08-13 晚）

- boot 门实弹：`.env`（development+direct）起栈被拦、三条解法输出正确；按解法 1 以
  e2e+fixture 整栈 `pnpm dev` 全绿（provision 自动 seed 平台默认模型），单一真相流闭环。
- 新孤儿定性：**2 天龄 ppid=1 的 workerd**（当前 vite 无自己的 workerd 子进程、一直与僵尸对话）
  为全天反复 undici「fetch failed」SSR 潮的头号嫌疑；kill＋整栈重启后未复发。
  → 票面第 4 项「进程卫生断言」应把 workerd 纳入探测面（不只 web/core 端口）。
- admin 走查配方：e2e helper 路由（/api/e2e/users）需 web `vite dev --mode e2e`；
  否则用 DB 改 `"user".role` ＋重登（角色缓存在 session）。
