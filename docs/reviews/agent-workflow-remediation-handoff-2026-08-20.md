# 丽客美页 Agent Workflow 修复暂停交接

> 状态：`PAUSED / IN PROGRESS`  
> 交接时间：2026-08-20（Asia/Shanghai）  
> 仓库：`/Users/bin/Desktop/开发/内容无人区/美业内容2`  
> 主任务：按 `docs/reviews/agent-workflow-full-project-review-remediation-2026-08-19.md` 完成全部修复  
> 重要：本文件记录的是暂停时的**实际状态**，不是完成声明，也不是 release-ready 声明。

## 1. 先读这些文件

1. 权威修复报告：`docs/reviews/agent-workflow-full-project-review-remediation-2026-08-19.md`
2. 产品决策日志：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
3. V3.1 权威计划：`docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md`
4. 本交接：`docs/reviews/agent-workflow-remediation-handoff-2026-08-20.md`
5. 本地工作记录（当前均未跟踪）：`task_plan.md`、`progress.md`、`findings.md`

权威顺序与 D-170～D-178 勘误已合入 main。不要回退到历史五场景首页、三桶计费、Pro Studio、自动发布或默认顾客审批链。

## 2. 暂停时的总裁决

- **没有完成完整目标。** Wave 2～5 仍有大量报告任务未做，不能更新 goal 为 complete。
- **main 已合入 Wave 0 的运行时与证据工具，但当前 merge-quality evidence guard 仍红。**
- **Wave 1 主要产品修复已完成并在独立分支验证，但尚未重放到当前 main，尚未合入。**
- **Delivery 最终代码候选已获独立 APPROVE，真实 Playwright 目标旅程已通过。**
- **内置浏览器的全用户旅程矩阵尚未在最终集成 SHA 上执行。**
- **Waffo、Provider live、staging/production deploy、release-required 均未完成。**
- 所有 Agent 已停止；暂停后不得继续写代码、跑迁移或合并，除非用户/下一位 Agent明确恢复。

## 3. 当前 Git 真相

### 3.1 main

```text
branch: main
HEAD: 93e7b07630df2a41fb98176249479ad8c73b8da2
remote relation: ahead 65
push: none
```

main 当前仅有以下未跟踪文件：

```text
docs/reviews/agent-workflow-full-project-review-remediation-2026-08-19.md
docs/reviews/agent-workflow-remediation-handoff-2026-08-20.md
findings.md
progress.md
task_plan.md
```

不要 `git add -A`。这些文档属于本轮工作，应逐文件审阅后再决定是否提交。

### 3.2 关键分支 / worktree

| 角色 | 分支 / HEAD | Worktree | 状态 |
|---|---|---|---|
| 当前 main | `main@93e7b0763` | `/Users/bin/Desktop/开发/内容无人区/美业内容2` | 已合入 Wave 0 + CI evidence 工具；无 tracked dirty |
| Wave 1 主集成 | `agent/wave1-main-integration@4bd7561b2` | `/Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-wave1-main-integration` | clean；基于旧 main `5e5f0aca6`，含 39 个 Wave 1/ADM-02 commit |
| Delivery 最终候选 | `agent/wave1-del-workspace-occ@89bae425a` | `/Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-wave1-del-workspace-occ` | clean；基于 `1fb63115d`，其后 12 个 Delivery commit |
| ADM-02 原分支 | `agent/adm02-catalog-migration@8e383267e` | `/Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-adm02-catalog-migration` | clean；已重放进 Wave 1 主集成为 `4bd7561b2` |
| CI evidence 工具 | `agent/ci-evidence-guard@93e7b0763` | `/Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-ci-evidence-guard` | clean；已快进 main |

关系：

```text
Wave 1 merge-base with current main: 5e5f0aca6
current main commits after merge-base: 12
Wave 1 integration commits after merge-base: 39
Delivery commits after 1fb63115d: 12
```

不要删除这些 worktree。不要在原分支 rebase --force；新建最终集成分支做重放。

## 4. 已合入 main 的工作

### 4.1 权威与 CI inventory

- D-170～D-178 权威摘要、D-178 勘误、V3.1/A-I 引用修复已合入。
- Journey ownership catalog、same-SHA persistence instrument、V31-82 instrument 隔离已合入。
- 当前 main catalog（未含 Wave 1 新增文件）仍是 Playwright 98 / persistence 96。

### 4.2 开发运行时

- stale install fail-fast；
- workerd 独立 heap flag；
- truthful Web/Core health supervisor；
- participant ownership transfer / atomic stack-state CAS；
- stale/legacy lock generation fencing；
- PostgreSQL secret zero-argv；
- Wrangler env-file 0600 + signal/failure cleanup；
- local recovery password SQL 经 stdin。

### 4.3 persistence 证据工具

main tip `93e7b0763` 已包含：

- catalog-aware stale guard；
- same-SHA selection；
- per-file timeout / process-group kill；
- owner-verified success/failure database cleanup；
- artifact realpath / symlink / secret scan；
- recursive TAP tree、plan、summary、Bail out、任意 plan `# SKIP` fail-closed；
- redacted receipt recorder。

该工具最终审查为 APPROVE，`node --test scripts/ci/*.test.mjs` 在 tip 上为 170/170。

## 5. main 的真实验证证据

### 5.1 已通过

| 证据 | SHA | 结果 | 注意 |
|---|---|---|---|
| Wave 0 persistence full run | `5e5f0aca6` | 96 files / 414 pass / 0 fail / 0 skip | artifact 位于 `meiye-wave0-integration/output/ci/persistence-instrument-local-wave0-5e5f0aca6/`；不是 current main `93e` 的 same-SHA receipt |
| Wave 0 control tests | `5e5f0aca6` 附近 | 241/241 | 含 dev/CI/recovery controls |
| Root build/typecheck | Wave 0 集成 | Web client + SSR build、Contracts/Core/Web/journeys 通过 | current main 添加 CI 工具后未再次做完整 root build，但产品代码未变 |
| CI evidence controls | `93e7b0763` | CI 170/170、Web check 通过 | 工具本身已审查通过 |

Wave 0 evidence 文件内容：

```json
{
  "commitSha": "5e5f0aca6a839b7ab371957d2d000620e4922944",
  "verdict": "pass",
  "summary": { "files": 96, "pass": 414, "fail": 0, "skip": 0 }
}
```

### 5.2 当前仍红

在 current main `93e7b0763` 运行：

```sh
node scripts/uiux/opt-in-test-evidence-guard.mjs
```

实际输出：

```text
24 blocking rerun
1 advisory
0 instrument
5 documented retired suites
```

原因：之前 96/414 的 run artifact 在 ignored `output/`，未使用新 recorder 写入当前 ledger receipt；不能从 `progress.md` 或旧 artifact 文本伪造回填。

## 6. Wave 1 已完成但未合入的工作

Wave 1 主集成 `4bd7561b2` 已包含：

- FE-01 account/workspace/thread store isolation、late SSE/replay fence；
- FREE-01 server-authorized explicit facts、Session exact allowlist、authority revision stale fence；
- PLAN-01A serial/retry-none/cache-none contract honesty；
- BILL-01 Commerce readiness、Waffo frozen settlement authority、forward-only 0026～0029 migrations；
- Commerce `createServerOnlyFn` boundary，client bundle 不再引入 `cloudflare:workers`；
- ADM-01 active three-bucket projection retirement、unknown evidence；
- ADM-02 boot-time catalog mutation removal，显式 dry-run/CAS apply/append-only rollback CLI；
- canonical handoff 基线、cross-account cache isolation、one-shot consume；
- Playwright FREE explicit-fact 与 handoff catalog coverage。

已知验证：

- root `pnpm typecheck` 在 `1fb63115d`（Commerce boundary 后）完整通过，含 Web client + SSR build；
- Wave 1 Core focused 443 pass / 0 fail / 1 expected PG-env skip；
- Contracts 233/233；
- Web focused 68/68 + 124/124；
- Commerce boundary/settlement 59/59 + interaction 16/16；
- catalog/quality 28/28；
- Web check 1484 files；
- ADM-02 focused 18/18，隔离 PG 2/2，真实 dry-run 5 个 key 均 `up_to_date@1`。

完整 Core suite 在候选与未改基线均有 `dbos-workflow-events.test.ts` 2 条旧期望失败：测试仍期待 `retry`，现行 D-176 语义为 `adjust_intent` / 返回工作台。该测试漂移尚未修，不得把完整 Core 宣称为全绿。

## 7. Delivery 最终候选

### 7.1 分支与提交

Delivery branch `agent/wave1-del-workspace-occ@89bae425a`，基于 Wave 1 `1fb63115d`。需在最终集成时重放 `1fb63115d..89bae425a` 的 12 个 commit。

该范围完成：

- BFF/serverfn 共用 canonical default workspace resolver；
- no-workspace 零 consume；
- user+workspace+token cache isolation；
- manual publish duplicate/OCC/revision metadata 同一 transaction；
- failed/unknown/not_published 与 published lineage 分离；
- failed→published 严格两步 revision chain；
- consumed + any nonpublished terminal status 统一 `CANONICAL_HANDOFF_REPREPARE_REQUIRED`；
- Web 与 Core 同一最新 exact export → matching assisted event → deliveryIdentity approval 选择；
- handoff prepare 结构性等待 accepted package、exact successful export、visible consumed approval、matching assisted delivery；
- Playwright 本地端口从被 Docker TQAI 占用的 3000 隔离到 3200。

### 7.2 独立审查与测试

Delivery tip `89bae425a` 已获独立 APPROVE。

已记录验证：

- Core focused 54/54；
- Web Node 11/11；
- Web interaction 25/25；
- fresh PG 4/4（manual OCC 1/1 + canonical handoff 3/3）；
- Core/Web TypeScript、Biome、diff-check 通过；
- catalog/quality 28/28；
- `mkfast-template-main/test-results/.last-run.json` 当前为：

```json
{ "status": "passed", "failedTests": [] }
```

真实目标 Playwright 旅程已通过 1/1，路径不是 fixture shortcut：

```text
创作
→ Composer 入口打开 Result Center
→ 图文媒资工作区“采用这组”
→ ContentPackage accepted
→ “交付”
→ 下载完整 ZIP / result_export 回执
→ 返回创作
→ 顶栏异步任务中心
→ 可见“本次发布确认”表单
→ exact ApprovalReceipt / assisted delivery
→ handoff prepare
→ A 首次 one-shot consume
→ 产品 UI logout/login B
→ B 同 token 服务端 consumed/not_found，不能看到 A 内容
→ B 无 workspace 时零 consume
```

## 8. 尚未拍板的产品决策

### 8.1 DEL-SEC recipient authentication

报告要求二选一，用户尚未回答：

1. 仅登录商家本人跨设备（推荐，风险最低）；
2. 外部责任人使用 scope-limited、一次性、可撤销/过期 token。

当前代码仍不得宣称 external-owner 开放完成。

### 8.2 nonpublished 后“重新准备手机交接”

当前代码行为：旧 one-shot token 永远 consumed；failed/unknown/not_published 后自动 prepare 返回 `CANONICAL_HANDOFF_REPREPARE_REQUIRED`，不会自动签发新 token。

尚待用户确认是否新增显式商家动作：

```text
“重新准备手机交接” → 新 receipt / 新 token
```

在确认前不要自行实现，也不要自动重发 token。

## 9. 下一位 Agent 的安全恢复顺序

### Step 1：创建新的最终集成分支

不要修改现有候选 worktree。基于 current main 新建：

```sh
git worktree add /Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-wave1-final \
  -b agent/wave1-final main
```

### Step 2：重放 Wave 1 主集成

在新 worktree 中按原顺序重放：

```sh
git cherry-pick $(git rev-list --reverse 5e5f0aca6..agent/wave1-main-integration)
```

预期重叠：journey catalog、quality gates、persistence inventory。必须同时保留：

- current main 的 CI evidence/Issue-255/provisionStrategy；
- Wave 1 的 FREE/Delivery Playwright；
- Delivery 新 PG file。

不要选择 `ours`/`theirs` 整文件覆盖。

### Step 3：重放 Delivery 最终范围

```sh
git cherry-pick $(git rev-list --reverse 1fb63115d..agent/wave1-del-workspace-occ)
```

重放后至少验证 inventory 为最新实际值。Delivery 新增一个 PG suite，因此预计 persistence 从 96 增至 97；Playwright 预计从 main 的 98 增至 Wave 1 的 99。不要把预计值当真值，必须运行 validator。

### Step 4：组合验证

```sh
git diff --check main...HEAD
pnpm typecheck
pnpm --filter @meiye/web check
node scripts/ci/journey-ownership-catalog.mjs validate
node --test scripts/ci/quality-gates.test.mjs scripts/ci/journey-ownership-catalog.test.mjs
```

再运行 Wave 1/Delivery focused 测试与：

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/v31-publish-handoff-selfreport.spec.ts \
  -g "canonical handoff uses the server workspace" \
  --retries=0
```

测试必须使用隔离本地端口，不能复用 Docker TQAI 的 3000。

### Step 5：冻结最终 SHA 后生成 persistence selection

```sh
node scripts/uiux/opt-in-test-evidence-guard.mjs \
  --output output/ci/opt-in-evidence-guard.json \
  --selection-dir output/ci/persistence-selections
```

先检查 blocking/advisory/instrument 分类和 owner。不要借用 main `5e5` 的 96-run。

### Step 6：在最终 SHA 跑 blocking 与 advisory

严格使用 `docs/ci/root-quality-gate.md` 的流程：

```sh
export RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
export PERSISTENCE_EVIDENCE_PATHS_FILE=output/ci/persistence-selections/blocking.json
export PERSISTENCE_POSTGRES_ADMIN_URL=<通过环境注入，不放进 argv/文档>
export CI_EVIDENCE_DIR=output/ci/persistence-blocking
bash scripts/ci/run-persistence-evidence-instrument.sh

node scripts/ci/record-opt-in-persistence-evidence.mjs \
  --provision output/ci/persistence-blocking/provision.json \
  --results output/ci/persistence-blocking/results.json \
  --receipt docs/ops/persistence-calibrations/<commit>-<provision-id>.json
```

advisory 单独跑，不能贡献 release verdict。新 runner 会 owner-verified 自动清理数据库；cleanup 失败本身必须判红。

### Step 7：真实浏览器与内置浏览器

- 先运行 cataloged Playwright 主旅程；
- 再启动最终集成栈并检查 `/api/ping`、Core `/health/ready`；
- 使用 `browser:control-in-app-browser`，不要替换成 Chrome/普通 Playwright；
- 全量走 P0 copy/note/image/video、FREE、credits、resume、delivery、cross-account、移动端；
- 当前会话只完成了 terminal Playwright，**未完成最终 SHA 的内置浏览器完整矩阵**。

### Step 8：只有全部门绿后才合入 main

```sh
git merge --ff-only agent/wave1-final
```

不要 push，除非用户另行授权。

## 10. Wave 2～5 实际未完成

以下报告任务仍未完成，不能因 Wave 0/1 接近收口而省略：

- Wave 2：SUBMIT-01A/B、TIMEOUT-01、STORE-01、MEM-01/02、WORK-01、LINK-01、ART-01、UX、Credits、完整浏览器矩阵；
- Wave 3：typed P1 registry、单客户端投影、Operations/ModelSupply deep modules、Agent phase、HarnessRelease、graph sealing、background/write ownership、物理 locality；
- Wave 4：Pro Studio/model_canvas、standalone tools、legacy publisher、U14 retirement 等条件退役；
- Wave 5：CI-01B required promotion、CI-03 merge/advisory separation、immutable staging artifacts、Core/worker production deploy、Provider/Waffo/network live、release-required。

特别是：

- Waffo Test/Production checkout→webhook→settlement 未做真实 live 验证；
- Core/DBOS production deploy workflow 仍未落地；
- 自动发布仍应保持冻结/归档，不得恢复；
- destructive retirement 的 production data/in-flight/audit/rollback 门尚未满足。

## 11. 已知陷阱

1. `ComposerDeliveryCard` 的“采用这一版”只打开 Result Center；真实图文采用动作是媒资工作区“采用这组”。
2. handoff 前必须有 accepted package、exact successful export、可见批准及 matching assisted delivery。
3. Docker TQAI 占用 3000；Delivery Playwright 使用隔离 3200。
4. source-branch Evidence SHA 经 cherry-pick 后不再是 integration ancestor；必须在集成 SHA 重跑，再写票据。
5. ignored `output/` artifact 不是可提交 evidence；必须使用 receipt recorder。
6. 不要改写已应用 migration（尤其 0027）；Wave 1 使用 0028/0029 前向 proof/gate。
7. 不要把 `dbos-workflow-events.test.ts` 的旧 `retry` 期望当现行产品合同；先按 D-176 核对后单独修测试。
8. 不要运行宽泛 `DROP DATABASE` / `rm -rf`；所有临时库必须按 receipt/name/owner 精确清理。

## 12. 当前禁止宣称

- 不得宣称完整目标完成；
- 不得宣称 release-ready；
- 不得宣称 current main same-SHA persistence green；
- 不得宣称 Wave 1 已合入 main；
- 不得宣称内置浏览器全旅程已通过；
- 不得宣称 Waffo/Provider/production deploy 已验证；
- 不得宣称 external-owner handoff 已拍板或上线。

## 13. 给下一位 Agent 的启动提示

```text
请先读 docs/reviews/agent-workflow-remediation-handoff-2026-08-20.md。
任务仍是完整执行 agent-workflow-full-project-review-remediation-2026-08-19.md，不能缩为只合并 Wave 1。
先从 current main 93e7b0763 新建 wave1-final worktree，按 handoff 的两个 commit range 重放；不要删除原 worktree，不要复用旧 evidence，不要自动决定 DEL-SEC 或新 token UI。
```

