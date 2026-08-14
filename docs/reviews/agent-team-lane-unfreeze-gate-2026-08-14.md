# Unfreeze condition — 全门可评价（同一 SHA 上 V3.1 browser gate 可跑完）

- Date: 2026-08-14（本机时钟 `2026-08-14T00:14:45+0800`）
- Investigator: unfreeze-condition investigator（read-mostly；本文件是唯一写入）
- Authority:
  - `docs/ops/current-project-status.md` §3 / §3a
  - `docs/reviews/v31-agent-team-product-deep-review-2026-08-13.md` EXEC-00b / D6=A
  - `scripts/ci/run-v31-browser-acceptance.sh`
  - `.github/workflows/core-quality.yml` job `v31-browser-acceptance`
  - tickets V31-50 / V31-64 / V31-70 / V31-77 / V31-79
- Verdict: **本工作树与 committed `0a693408` 都还不是「全门可评价」。** 代码存在 ≠ 门可评价。祖先 SHA 绿证 / 8+5+28 半轮不得拼到本 SHA。本轮**没有**跑完 23-file / 41-test 必跑目录。

Honesty: 1 条 spec 绿、`--list` 能解析、Chromium 能启动，都只证明 host 最小条件，不证明全门可评价。

---

## 0. 树身份（先钉死评的是哪一棵）

```text
git rev-parse HEAD
# 0a6934089a160a0f0cc3ffc084d42466d47140e2
# docs: archive the V3.1 gate verdicts into docs/reviews so they survive the next run
# 2026-08-13 21:45:43 +0800

git status --porcelain | wc -l
# 84   （脏工作树，不是一个 SHA）
```

| 项 | 事实 |
|---|---|
| Committed HEAD | `0a6934089a160a0f0cc3ffc084d42466d47140e2` |
| 工作树 | **dirty**（约 84 条 porcelain；含 EXEC 白名单 + 大量产品改动） |
| 远端 `meiyeagent/main` | 落后本地；`0a693408` 不在 GitHub（见同日 `agent-team-lane-unfreeze-required-ci-2026-08-14.md`） |
| 本轮是否跑全门 | **否** |
| 祖先全门 | `d97c9b09` / `167adafd`：42 tests → 8 passed / 5 failed / 1 interrupted / 28 did not run（workerd 死）。**不得当作本 SHA 证据** |

两套目录必须分开写，不能混称「HEAD」：

| 面 | `v31-82` 是否在 `v31_specs=()` 必跑数组 | 说明 |
|---|---|---|
| committed `0a693408` | **在**（真数组条目，不是注释） | `git show HEAD:scripts/ci/run-v31-browser-acceptance.sh` L45 |
| 本工作树（未提交 diff） | **不在**（改成注释） | D6=A 半落地 |

「全门可评价」要求 **ONE SHA**。脏树不是 SHA。把脏树结果写回 `0a693408` 是拼接。

---

## 1. Q1 — `v31-82` 是否仍在必跑数组？（D6=A 后应为 comment-only）

**工作树：是 comment-only。committed SHA：不是。契约测试与 TEST-CATALOG 反向合同未跟。**

工作树 `scripts/ci/run-v31-browser-acceptance.sh`：

```text
  tests/e2e/specs/v31-partial-resume-assisted-journey.spec.ts # V31-16 部分交付续跑
  # D6=A: v31-82 is instrument-only until a stall fixture exists (not product-red).
  tests/e2e/specs/v31-83-composer-session-cross-account.spec.ts # V31-83 跨账号会话隔离
```

- 必跑文件：**23**（day-0 独立先跑 + remaining 22）。`--list`：`Total: 41 tests in 23 files`。
- spec 文件仍在盘上：`mkfast-template-main/tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts`。
- 该 spec 自己写了 **KNOWN RED**（L88–98）：fixture 造不出 `running+0 job`；答完方向图文会跑完；重试会从 `alreadyTerminal` 假绿。D6=A 把它移出门是对的。

committed `0a693408` 同一位置仍是：

```text
  tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts # V31-82 悬死有界终态+退款
```

即：**干净 SHA 上门清单仍含故意红。** `required` 要 `v31-browser-acceptance == success`，干净 `0a693408` 按设计绿不了。

未同步、已实测红：

| 合同 | 状态 | 本轮命令 |
|---|---|---|
| `scripts/ci/quality-gates.test.mjs` `v31AcceptanceSpecs` 仍含 82 | 未改 | `node --test --test-name-pattern 'V3.1 browser gate' scripts/ci/quality-gates.test.mjs` → **2 fail / 0 pass** |
| 「runs every named §37.4 journey spec」 | 第二段 Playwright 命令**不再含** 82，测试仍期望含 | AssertionError deepEqual |
| 「fails closed when a journey spec is absent」 | 循环到 82 时门脚本不再索取该文件 → stderr 无 `missing 1 required spec` | AssertionError |
| 「every V3.1 spec in the repository is registered」 | **仍绿**（JS 清单含 82 + 文件仍在） | 与 D6=A 冲突：文件在就必须进必跑门 |
| `mkfast-template-main/tests/e2e/TEST-CATALOG.md` L1132–1133 | 明文：仓内每个 `v31-*.spec.ts` 必须在门清单；反向漂移 fail closed | 未给 82 开豁免 |

`pnpm test`（root-quality）会跑 `node --test scripts/ci/*.test.mjs`。脏树若原样提交，**`root-quality` 会在浏览器门之前红**。D6 注释一行 ≠ EXEC-00b 完成。

---

## 2. Q2 — workerd / Vite 中途死，剩余 spec 是 `not_evaluated` 还是产品红？

**代码意图：剩余 = NOT evaluated，并 SIGINT 停跑。本 SHA / 本脏树没有做「人为杀 workerd」探针。祖先 08-13 轮证明过仪器会开火，那一轮不能算本 SHA。**

### 2.1 两条路径

**A. Day-0 fail-fast（V31-77，门脚本）**

`run-v31-browser-acceptance.sh`：day-0 单独先跑；红则写 `day0-gate-not-evaluated.log`，列出其余 22 条，**不发起**第二段 Playwright。措辞：`DAY-0 RELEASE GATE RED: … remaining N specs NOT evaluated`。这是枚举式 `not_evaluated`。本轮未做 day-0 变异。

**B. 服务 / workerd 中途死（V31-64 / V31-70，Playwright reporter）**

| 件 | 本树事实 |
|---|---|
| `playwright.config.ts` reporter | 绝对路径加载 `scripts/e2e/service-liveness-reporter.mjs` |
| Vite 首帧 | `[vite] Internal server error: fetch failed\|terminated` → `kind=vite-workerd-disconnected` |
| candidate 断连 | `Network connection lost` → `kind=workerd-network-connection-lost` |
| 父进程退出 | `service-exits/*.json` + `shutdownRequested !== true` |
| 判决句 | `GATE INSTRUMENT FAILURE: … — remaining specs NOT evaluated; instrument evidence: <file>` |
| 动作 | reporter `SIGINT`（grace 30s，否则 exit 2） |
| 枚举剩余 spec 文件 | **无**（不像 day-0 的 `day0-gate-not-evaluated.log`） |
| Playwright 结果重写 | **无**。已 failed 的条目保持 failed；未开跑 = did not run；在跑 = interrupted |

`playwright.config.ts` 默认 `E2E_SERVICE_MAX_RESTARTS=2`（CI v31 job **不**覆盖；production 门脚本才钉 0）。Vite 内嵌 workerd 是孙进程：web 父进程可以不退，重启预算救不了它；靠的是错误首帧检测。

### 2.2 仍会变成产品红的窗口

1. 检测轮询 2s：死到判决之间，login fixture 可以先红。
2. 死**之前**已经 failed 的 spec 保持产品红（08-13 把 5 条死前红判成真红，这是对的）。
3. Playwright JSON 没有 `not_evaluated` 状态。读 summary 的人若只数 failed、不读 `GATE INSTRUMENT FAILURE` 行，会把 interrupted 算错。

### 2.3 本轮没有证明什么

- 没有 `kill -9` Core / 没有拆 workerd。
- 1-spec 探针（§4）三服务 `shutdownRequested: true`，`instrument-failures/` 空，日志无 `GATE INSTRUMENT`。只证明短跑拆栈不误报。
- 08-13 在 `d97c9b09` 上仪器对 `vite-workerd-disconnected` 开过火（28 not evaluated）。那是祖先，不是 `0a693408`，也不是这棵脏树。

EXEC-00b DoD「断 workerd → 剩余=`not_evaluated`」：**实现在，同 SHA 活体未核。**

---

## 3. Q3 — V31-50：SSR `socket.on('error')` 是失败请求还是杀进程？

**请求路径的 query reject → 503：有。真实 postgres.js socket `'error'` 监听：本工作树加的 bind 是空操作。进程不被杀：未在本树用真 socket 证明。**

文件：`mkfast-template-main/src/db/postgres-connection-safety.ts`、`mkfast-template-main/src/db/index.ts`。

| 层 | committed `0a693408` | 本工作树 diff |
|---|---|---|
| `withPostgresRequestBoundary` | 有。只包 `workspace-provisioning.ts` `ensureVerifiedWorkspaceProvisioned` | 未改接线面 |
| 503 | `PostgresRequestUnavailableError` → `APIError('SERVICE_UNAVAILABLE')` | 同 |
| `bindPostgresClientSocketErrors` | **无** | **新增**；`getDb()` 里 `postgres(...)` 之后调用 |
| 单测 | 无 socket listener 用例 | mock 对象上 `.on('error')` 不 throw |
| child-process | 已跟踪。向 `database.execute()` **抛 query 错**，断言 503 且后续请求可用 | 未覆盖真实 socket |

对 **真实** `postgres` 客户端（本机 `node` 探过）：

```text
typeof sql.on = undefined
'on' in sql = false
keys = CLOSE,END,PostgresError,array,begin,close,end,file,json,largeObject,
       listen,notify,options,parameters,reserve,subscribe,typed,types,unsafe
```

`bindPostgresClientSocketErrors` 开头是 `if (typeof client.on !== 'function') return;`。对 postgres.js **整段不执行**。单测只测自己传入的假 `{ on }`。

postgres.js 内部已经 `socket.on('error', error)`；idle 且无 in-flight query 时 `errored()` 不 reject。票面要的「socket `'error'` → **该请求** 5xx」并没有接到 `withPostgresRequestBoundary`：新 listener 即使挂上了也只是吞 capacity 错，**不会 fail 当前请求**。注释写的是「下一枪 query 再走 boundary」。

因此 EXEC-00b「SSR socket.on('error') fail the request instead of killing the process」：

- 杀进程：依赖 postgres.js 自己听 socket + Vite 侧 `vite-disconnected-socket-plugin.ts`（另一路 HTTP/peer reset），不是 V31-50 新 bind。
- fail the request：只有 **query promise reject** 且走了 `withPostgresRequestBoundary` 的供给路径。其它 SSR 查询没有这层。
- 票面 AC「摘掉 listener → 进程必须死」的变异：**未跑**。
- child-process 绿 ≠ 真 socket 绿。

Lane E（08-13）写「postgres.js socket `'error'` 仍无监听」对 **committed HEAD** 仍成立。脏树多了一个对 `.on` 的空绑，没有改变这个事实。

---

## 4. Q4 — 本机 Playwright 能不能起来？

**能起浏览器、能 `--list` 全部必跑文件、能在隔离库上跑通 1 条 spec。全门 41 tests 没跑。**

### 4.1 最小探针（已做）

| 探针 | 结果 |
|---|---|
| Node / pnpm | v24.9.0 / 10.30.3（CI job 是 Node 22） |
| `pnpm --filter @meiye/web exec playwright --version` | **1.61.0** |
| Chromium `chromium.launch()` | **launched** `149.0.7827.55`，386ms |
| ffmpeg | 6.1.6 |
| `--list` day-0 单文件 | 1 test |
| `--list` 工作树 23 个必跑文件 | **41 tests in 23 files**，全部可解析 |
| 54329 / 54330 / 5432 | `pg_isready` accepting；用户 `meiye` 可建库 |
| 探针前 3000/3010/4100/4110/3020/4120 | listen 空 |

### 4.2 1-spec 真栈（已做；不是全门）

隔离 env（**禁止**默认 `TEST_DATABASE_URL=…54329/meiye`）：

```text
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54330/meiye_unfreeze_probe_0814
TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54330/meiye_unfreeze_probe_0814_dbos
PORT=3020 PLAYWRIGHT_CORE_PORT=4120
PLAYWRIGHT_PROVIDER_FREE=true MODEL_EXECUTION_MODE=fixture
CI_EVIDENCE_DIR=output/ci/v31-unfreeze-probe-20260814
```

- `scripts/ci/provision-test-db.sh`：建库 + Drizzle migrate + platform default model seed。**成功**。
- `playwright test tests/e2e/specs/v31-85-video-fallback-recipe-dead-end.spec.ts --retries=0`
- 结果：**1 passed (1.0m)**，用例本身 15.8s。
- Core fixture harness 起来；Web = `vite dev --host 127.0.0.1 --port 3020 --mode e2e`。
- 拆栈：core exit 0 / p1-worker exit 0 / web SIGTERM，全部 `shutdownRequested: true`。无 instrument-failure。
- 证据：`output/ci/v31-unfreeze-probe-20260814/`（provision.log、playwright-v31-85.log、service-exits/）。

这只证明：**在显式隔离库 + 错开端口时，脏树上短栈能起、能跑完 1 条。** 不证明 23 文件 / 41 tests 能跑完，不证明 workerd 在长目录下活着。

### 4.3 本机默认会踩的坑（所以不能「直接跑门脚本」）

`playwright.config.ts` 默认 `TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye`（**活体库**）。不覆盖就打进 `meiye`。

本调查结束时，**另一路 Playwright 正在用默认活体库**：

```text
PORT=3015 PLAYWRIGHT_CORE_PORT=4115
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye
# uiux-creation-loop.spec.ts + dashboard-home-mount.spec.ts（V31-76 面）
```

因此：

- 不设 `TEST_DATABASE_URL` / `PORT` / `PLAYWRIGHT_CORE_PORT` → 打 54329 活体，并与并行 lane 抢 Core/Web。
- `reuseExistingServer: !process.env.CI`：本地会复用已占用端口上的**别人的**栈。
- 门脚本还要 `RELEASE_COMMIT_SHA`（40 hex）。`production-network-boundary-gate.mjs` 无 `--evidence` 时只验合同，不挡本地。

### 4.4 没跑的

- `scripts/ci/run-v31-browser-acceptance.sh` 全文（day-0 + remaining 22）
- 41 tests 串行
- day-0 变异 / workerd kill 探针
- CI 形态（ubuntu / Node 22 / postgres:16 service / 不 reuseExistingServer）

**不得把 v31-85 1/1 写成全门可评价或 C5 可用。**

---

## 5. Q5 — 这棵树上，什么仍让门「不可评价」？

「可评价」= **同一 SHA** 上必跑目录里**每一条**都得到产品判决（pass 或真产品 fail），中间不被仪器截成大片 `not_evaluated`。不是「有代码」、不是「1 spec 绿」、不是「祖先跑过」。

现在卡住的是：

1. **没有同一个 SHA。** 脏 84 文件。评价 `0a693408` 必须干净树；评价脏树必须先提交成新 SHA。两边都不能拿对方的结果。
2. **全目录从未在 `0a693408` 或本脏树上跑完。** 最近一次全门企图是祖先 `d97c9b09`/`167adafd`，workerd 在 ~7.4m 打死，28 条未评。那次之后没有同 SHA 复跑。
3. **workerd 长目录仍是未核销可靠性债。** 仪器能把剩余标成 NOT evaluated（§2），标成 not_evaluated **本身就是「未评价」**。检测 ≠ 复活。1-spec 1 分钟活着，不能外推 41 tests。
4. **D6 不完整。** 干净 `0a693408` 必跑里有 82 KNOWN RED → 门在 fixture 下按设计红。脏树把 82 改成注释，但 `quality-gates.test.mjs` + TEST-CATALOG 反向合同仍要 82 进门 → 提交即 `root-quality` 红。没有 stall fixture 之前，82 不能请回。
5. **V31-50 真 socket 路径仍空。** 供给 query 的 503 边界在；`client.on` 不存在。进程级 socket 死仍可能把整门打成仪器债。
6. **本地默认环境不能当门。** 必须显式独立库 + 错开端口；54329/`meiye` 是活体；调查当时已有并行 Playwright 占着它。`CI=true` 才会关掉 `reuseExistingServer`。
7. **同 SHA `Core quality / required` 不存在**（解冻三件套的另一件）。`0a693408` 不在 GitHub，无 check-run。见 `docs/reviews/agent-team-lane-unfreeze-required-ci-2026-08-14.md`。本文件不重复那份 CI 结论。
8. **V31-76 清 ≠ 可评价，但是解冻条件。** §3a = 全门可评价 **且** V31-76 清 **且** 同 SHA required 绿。本轮没跑 remix/continue spec，不宣称 76 状态。

---

## 6. 若要在这台机器上评价全门：缺什么（精确）

可以跑，但必须同时满足。缺任一条就不要开全门：

1. **先变成一个 SHA。** 要么 `git stash` / 干净 `0a693408`（接受 82 在目录里且 KNOWN RED），要么一次提交完整 D6（shell 注释 **+** `quality-gates.test.mjs` 豁免 82 **+** TEST-CATALOG 反向合同改写）。只注释 shell 会红 root-quality。
2. **独占隔离库**，不要 54329/`meiye`：
   - `TEST_DATABASE_URL` + `TEST_DBOS_SYSTEM_DATABASE_URL` 两个库名
   - `PORT` / `PLAYWRIGHT_CORE_PORT` 避开 3015/4115 以及其它 lane
   - 先 `lsof` 确认端口；先看是否已有 Playwright 打活体库
3. Env：`RELEASE_COMMIT_SHA=<40 hex>`、`PLAYWRIGHT_PROVIDER_FREE=true`、`MODEL_EXECUTION_MODE=fixture`、`CI_EVIDENCE_DIR=output/ci/v31-browser-acceptance`。本地若要禁止 reuse：`CI=true`。
4. Host：Playwright 1.61 Chromium、ffmpeg、`psql`、`meiye` 可 `CREATE DATABASE`。这些**已经有**。
5. 命令：`bash scripts/ci/run-v31-browser-acceptance.sh`（不是单 spec）。预期墙钟：数十分钟；CI job timeout 120m。
6. 收证据：day-0 段 log、remaining 段 log、`service-exits/`、`instrument-failures/`。若出现 `GATE INSTRUMENT FAILURE` / `NOT evaluated`，该轮 **不可评价**，不要把已跑绿的 spec 拼成全门。
7. GitHub：推非 main 分支 + PR，才有同 SHA `v31-browser-acceptance` job。本机 log 替代不了 required check。

本调查**没有**开全门，也**没有**推 PR。

---

## 7. 五问收口

| # | 问 | 答（本工作树，字面） |
|---|---|---|
| 1 | 82 是否已移出必跑数组？ | **脏树：是（注释）。`0a693408`：否。** `quality-gates.test.mjs` / TEST-CATALOG 仍把 82 当必跑。脏树契约测试 2 红。 |
| 2 | workerd 死 → 剩余 not_evaluated？ | **代码会打印 NOT evaluated 并 SIGINT。** 无剩余清单文件；已 failed 不改写。本 SHA 未做 kill 探针。 |
| 3 | V31-50 socket fail-closed？ | **query reject → 503 有。** `bindPostgresClientSocketErrors` 对真实 postgres.js 是 no-op。真 socket 未证。 |
| 4 | Playwright 能 launch 吗？ | **能。** 1.61.0 + Chromium 149；`--list` 41/23；隔离库上 v31-85 **1 passed / 1.0m**。**全门未跑。** |
| 5 | 为何仍不可评价？ | 脏树不是 SHA；全目录从未在本 SHA 跑完；workerd 长目录未核销；D6 半落地会红 root-quality；V31-50 bind 空；默认库是活体且当时有并行占用。 |

**全门可评价 = false。** 解冻条件未满足。不要派 EXEC-03b / 07b / L0 / L3 / Goal / canary。
