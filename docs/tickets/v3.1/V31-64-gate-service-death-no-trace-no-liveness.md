# V31-64 — 浏览器必跑门中途丢服务进程：Core／候选 Worker 静默退出无留痕，门无存活断言，35/42 红为级联假红

**Parent**: 无——仪器级缺陷，承接 `docs/ops/browser-gate-tail-triage-2026-08-12.md` §2.3
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-50（Web SSR 进程死亡家族——prod 候选 Worker 半边可并入；v31/p2 死的是 Core 且日志 `53300`/`too many clients` 命中 0，非同根因）、V31-63（v31 门死亡触发器线索，见下）、V31-49（必跑门覆盖 audit）
**Status**: open（2026-08-12）— instrument landed & locally kill/control verified（两探针缺陷已修净）；等首轮 CI 浏览器跑的无级联判据后方可关票

**Implementation state**: done
**Verification state**: locally-verified — CI run pending
**Evidence SHA**: 9ac46064342e7621808153307bf4e2c12e887e37
**Workflow Run**: 31554310069
**Artifact Digest**:

## 现象（CI run 31554310069，三门各死一个长驻进程）

| 门 | 死掉的进程 | 最后存活证据 | 死后签名 |
|---|---|---|---|
| v31-browser-acceptance | Core（:4100） | Core 最后一行日志 `01:51:04` | `01:51:55` 起 Web 持续 `[vite] Internal server error: fetch failed` / `terminated` |
| p2-browser-acceptance | Core（:4100） | Core 5 分钟心跳最后一次 `02:15:40` | `02:16:31` 起同上 |
| production-main-journey | production-candidate（wrangler dev :3010） | `02:00:32` 连发 `read ECONNRESET` 后消失；Core/vite 均存活 | 其后 10 条 spec 全部 `ERR_CONNECTION_REFUSED :3010` |

进程死后每条 spec 都死在登录/清理 fixture（`fixtures/auth.ts:34/66/108`），没碰到产品面——本轮三门 42 红中 **35 条是此类级联假红**（逐条归属见 triage 报告 §1/§2.4）。三份日志均无 OOM/信号/退出码/crash stack；已排除 PG 连接耗尽（`too many clients` 命中 0）。

## 触发器线索（未定根因，修复留痕后取证）

- **v31 门**：Core 的最后一行日志（`01:51:04`）**恰是第三次** `Price-drift successor requires one not-started primary predecessor attempt` 报错（V31-63 缺陷 B 的未接错误；三次时刻 `01:44:46`/`01:47:40`/`01:51:04`）。前两次未致死、第三次后进程消失——V31-63 步骤 2（错误优雅收口）可能顺带移除本门的死亡触发器，但**不得以此关本票**：
- **p2 门**：`Price-drift` 命中 0 仍死——另有同形（未接错误→进程亡）触发器。
- **prod 门**：死的是候选 Worker 非 Core，形态与 V31-50（socket 'error' 未监听）同族，可并入该票核。

## 交付物（两件，缺一不可）

1. **异常退出必须留痕**：`mkfast-template-main/scripts/e2e/run-service.mjs` 目前只转发退出码/信号（`child.once('exit')`），不落证据。改为：子进程异常退出时把退出码/信号/最后 N 行输出写入 `CI_EVIDENCE_DIR`，三门（Core、Web、production-candidate）全覆盖。
2. **门级存活断言**：Playwright `webServer` 只在启动期把关（`mkfast-template-main/playwright.config.ts:66-170`，`/health` + 120s）。为三条门脚本加运行中存活检查：服务进程中途消失时，门以「仪器失效」终止并如实报告，**不得**继续跑出几十条假产品红。

## 排序约束

**本票先做**（早于 V31-28 重开与 V31-65 的验收跑）：不修留痕与存活断言，V31-63 主簇修复后的三门复跑仍会被级联污染，拿不到干净的判据。main@20179316 的 run 31559638579 跑完后复核「Core 是否又在同一时段死亡」，作为可复现性的第二数据点。

## 验收

- [ ] 人为 kill 门内 Core/候选 Worker，门以仪器失效终止且 `CI_EVIDENCE_DIR` 有退出留痕（退出码/信号/尾部日志）
- [ ] 三门在服务全程存活的一轮跑中，失败计数不再包含 `auth.ts:34/66/108` 级联形态

## 2026-08-12 主控验收记录

实现由 lane（worktree 三 commit，squash 合入 `6c21eb92`）交付；主控亲验揪出两处 lane 自测未覆盖的缺陷，均已修：

1. **reporter 相对路径在真实 `playwright test` 下 MODULE_NOT_FOUND**（config 加载期即崩，若上 CI 三门会全灭在启动期）。lane 的「rootDir 解析」合同测试钉的是自身假设——regex 读源码复读解析规则，真实加载从未发生。修法=`fileURLToPath(new URL(...))` 绝对路径＋合同测试改为 import 真实 config 对象断言（`6c21eb92` amend 内）。
2. **拆栈误报**：对照跑（不杀、正常失败）打出两条假 GATE INSTRUMENT FAILURE——Playwright 先拆 webServer 再回调 onEnd，onEnd 停表挡不住拆栈窗口。修法=supervisor 把 `shutdownRequested`（自身是否收到 SIGTERM/SIGINT）写进退出记录，verdict 只对无人要求的退出报警（`9ac46064`）。

双探针终态（本地，54329 全新 provision 库，spec=context-fence／admin-sensitive-words）：
- kill 探针：spec 运行中 `kill -9` Core → ≤2s 出结论行、run interrupted、退出码 130、`core-*.json` 记 `shutdownRequested:false`+SIGKILL+128 行 tail（tail 末行恰为 V31-63 的 DBOS 栈——留痕价值当场兑现）。
- 对照探针：0 条仪器行、正常产品红（B-2 admin select）、退出码 1、三条拆栈记录全 `requested:true`。

单测 13/13（新增 requested-shutdown 两用例）；biome 干净。余项=首轮 CI 浏览器跑的无级联判据（AC 第二条），届时回填。
