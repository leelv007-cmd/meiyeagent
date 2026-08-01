# Codex 交接 Handoff — Journey 门禁 + 方向卡 + P2 合入批（2026-08-02）

| Field | Value |
| --- | --- |
| 交接原因 | 用户暂停 Grok 长等 CI；交 **Codex** 修 journey 门禁并收口 |
| 状态时刻 | 2026-08-02（会话时区）；main tip **`3bf21723`** |
| 本文件 | 可入库；不必等 journey 绿再 commit |
| 权威链 | 规格 `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §8 / §11 ＞ 本 handoff 用户裁决 ＞ 票面 |
| 通用纪律 | `docs/ops/agent-dispatch-runbook-2026-07-29.md` |
| 关联 handoff | `docs/ops/p2-merge-batch-handoff-2026-08-01.md`、`docs/ops/p1-acceptance-xhs-2026-08-01.md` |

---

## 0. 你要交付什么（成功标准）

1. **`production-main-journey` 在 main tip 上一次 `success`**（用户口径：**单票合入前完整 journey 跑一次即可**，不必每票重跑）。  
2. 若绿：更新 `p2-merge-batch-handoff` §1.2 终态，并通知主控可开 **#320→#325 合入序**（lane 不 push 关票；主控亲验）。  
3. 若红：用 **行为证据**（log + artifact + 根因 file:line）修到可绿，或明确 **阻塞项**（基建假红 vs 产品红）。  
4. **不要**在 journey 未绿时合入 P2 六票。

---

## 1. 用户裁决（必须遵守）

| 裁决 | 含义 |
| --- | --- |
| 同步先执行 P2 开发 | 第 4 波 #320–#325 已开发完成（lane 成品） |
| 后续一起核验门禁 | 合入闸 = 一次 journey 绿，不是 P1 本机 15 文件硬阻塞 |
| 完整 journey 合入前跑一次即可 | 门禁 = CI Core quality **`production-main-journey`** |
| 暂停 Grok 长等 | 改由 Codex 修；勿再空等 90m 无动作 |
| 双审已跑 | 见 §4；follow-up 小修已进 `3bf21723` |

---

## 2. Git / tip 快照

```
main tip: 3bf2172385fb98f43a5742af02c09d515e64dcbd
origin: 应与 tip 对齐（推送时 3bf21723）

自 sticky 基线 69cf06e1 之后（journey 相关）：
3bf21723 fix(web): dual-review follow-up for direction interrupt scroll
c37e195f style(web): biome format direction-card sticky fix files
118c3528 fix(web): clear sticky Composer so image-text direction cards click
e149967a docs(ops): run full journey once before merge
```

**产品改动面（方向卡）：**

| 文件 | 做什么 |
| --- | --- |
| `mkfast-template-main/src/product/composer/composer-conversation.tsx` | question / execution_confirm 帧 `WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS`；interrupt 出现 `scrollIntoView`；deps 仅 id/kind；优先 **最新** interrupt |
| `mkfast-template-main/tests/e2e/fixtures/ui-journey.ts` | `chooseImageTextDirection`：legacy 卡 + scroll + force click |
| `mkfast-template-main/src/product/composer/workbench-p1.static.test.ts` | 静态钉 scroll-margin / scrollIntoView |

**本地已绿（推送前）：** interaction 36、static 5、biome clean。

---

## 3. CI 时间线（为何「这么久」）

| 阶段 | tip / run | 结果 | 说明 |
| --- | --- | --- | --- |
| A | `69cf06e1` run `30699271165` | cancelled ~90m | M-04 `chooseImageTextDirection` 300s×3；证据包有明确 Error（见 §5） |
| B | 同上 re-run | 浪费 | 改修方向卡后 cancel |
| C | `118c3528` run `30705186695` | failure | **webServer 未起**：EADDRINUSE `:3001` + PG deadlock migrate/compensation；**测例未开跑** |
| D | 同上 re-run attempt2 | ~75m 无 mid-run log | GitHub 跑中 log 404；后 cancel |
| E | `c37e195f` | cancelled | 被更新 tip 取代 |
| F | **`3bf21723` run `30709104009`** | 交接时 **in_progress** | root-quality **已绿**；journey step11 曾跑 60+ min |

Run F 链接：https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/30709104009  

**先做：**

```bash
gh run view 30709104009 --json status,conclusion,jobs
# 若已 failure/cancelled：拉 evidence
gh run download 30709104009 -n production-main-journey-evidence -D /tmp/journey-3bf
rg -n "Error:|Timeout|direction|webServer|EADDRINUSE|deadlock" /tmp/journey-3bf -g'*.log' | head -40
```

---

## 4. 双审复核摘要（D-157，已落）

全文在会话；要点：

| 级别 | 点 | 状态 |
| --- | --- | --- |
| P1 | sticky 假设 vs 截图「空对话」可能错位 — 需 journey 绿或 trace 证明卡曾挂载 | **未闭环** |
| P1 | `useEffect` 依赖整表 `turns` 导致滚动抖动 | **已修**（`3bf21723`） |
| P2 | `force: true` 可能 e2e 假绿 | 保留作 e2e 兜底；产品仍靠 margin+scroll |
| P2 | 双 interrupt 只滚第一个 | **已修**（最新 interrupt） |
| P2 | stylesReady 空分支 | **已删** |

**裁决：** 代码方向对，**不能**在 journey 未绿时当合入闸已过。

---

## 5. 首失败真因（attempt A 证据，可复现读）

Artifact（旧 run，路径示例）：

- Error：`the direction must land — by merchant click or frozen-route pre-answer`
- 位置：`ui-journey.ts` `chooseImageTextDirection` / resume 行「已按你选的方向继续准备整套图文」
- 截图：对话区看似空、有 work id 在上下文栏 — **也要怀疑卡未挂载 / SSE·task 未绑**，不只 sticky 几何

产品假设修复（sticky）：与 成品交付卡同族 `z-30` 遮挡。

**若 Codex 复现仍无方向卡 DOM：** 升级查：

1. submit 202 后 `bindComposerTask` / `taskId`  
2. `readPendingHarnessInteraction` / `ask_merchant` 是否 pending  
3. `applyComposerPendingInterrupts` 是否写入 `question` turn  
4. Core note 路径是否到 `noteStyleQuestion`（`workflow-core.ts` ~1690）

---

## 6. 基建假红（勿当产品回归）

出现即 **re-run 或修 CI 起服**，不要改业务：

```
EADDRINUSE 127.0.0.1:3001   # DBOS admin / P1 Worker
deadlock detected             # migrate ↔ compensation (40P01)
webServer was not able to start. Exit code: 1
```

Job 配置：`.github/workflows/core-quality.yml` → `production-main-journey` **`timeout-minutes: 90`**。  
历史成功总长约 **20–25 min**；挂满 90m 多为测例长超时或假死。

---

## 7. P2 第 4 波成品（待合入，均未 push / 未关票）

Worktree 根：`/Users/bin/orca/workspaces/美业内容2/lane-<N>`  
基线均相对旧 main `69cf06e1`；合入前 **rebase/ff 到含 journey 绿 tip**。

| 票 | HEAD | 分支 | 主题 |
| --- | --- | --- | --- |
| #320 | `8394b848` | `leelv007-cmd/lane-320` | 违禁词库 / 检查 / CRUD |
| #321 | `486ebb7b` | `leelv007-cmd/lane-321` | tone/role + 深度思考 |
| #322 | `d00123c5` | `leelv007-cmd/lane-322` | 对象工作区 + Tiptap + 六动作 |
| #323 | `481296b4` | `leelv007-cmd/lane-323` | AI 封面 + 七维风格 |
| #324 | `973e0d92` | `leelv007-cmd/lane-324` | 爆款复刻粘贴轨 |
| #325 | `5e0c73d1` | `leelv007-cmd/lane-325` | 「经验」+ 三处露出 + morph |

**建议合入序（journey 绿后，主控）：**  
#320 → #321 → #325 → #322 → #323 → #324  

第 5 波未派：#326←#322，#327←#320+#322，#328←#324+HITL。

---

## 8. Codex 建议执行序（最小）

```text
1. gh run view 30709104009 … 是否已 settled
2. 未绿 → download evidence → 区分 基建假红 / 方向卡 / 空对话
3. 基建 → 只 rerun 或修 job 端口/迁移竞态（小 diff）
4. 产品 → 证明卡是否挂载；必要时修 harness/interaction/session，不要只加 force click
5. 本地 focused（可选）：biome + workbench static + conversation interaction
6. push → 等 production-main-journey success
7. 回写 docs/ops/p2-merge-batch-handoff-2026-08-01.md §1.2 终态
8. 停：不要自行 merge P2 / 关票 / 改 ledger（主控亲验）
```

**禁止：** 匿名抓取、逆向签名、账号池；Tiptap 进 Composer；新 agent runtime；凭证进 git。

---

## 9. 已停事项（Grok 侧）

- 已停 CI 长等 monitor（避免空烧）  
- 用户明确 **暂停** 本会话 hang 等  
- 未合入任何 P2 票；merge-ledger 无 #320–#325 行  

---

## 10. 一句话给 Codex

> main 上方向卡 sticky 修 + 双审 follow-up 已在 **`3bf21723`**；合入闸卡在 **CI `production-main-journey` 真绿**。先查 run `30709104009` 终态与 evidence，分清假红与产品红；绿后把终态写回 `p2-merge-batch-handoff`，P2 六票合入留给主控。

---

## 11. 速查链接

- 当前门禁 run：https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/30709104009  
- 旧方向卡失败 run：https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/30699271165  
- 旧 118c 假红 run：https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/30705186695  
- 规格：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md`  
- 派发手册：`docs/ops/agent-dispatch-runbook-2026-07-29.md`  

---

## 12. Codex 合入审核补充（2026-08-02 04:10 CST）

> 本节是对上方历史交接快照的当前补充。上方 `3bf21723` / `in_progress` 等文字保留为当时事实，不再作为当前状态。

### 12.1 当前边界

| 项 | 当前事实 |
| --- | --- |
| `main` / `origin/main` | `5f456dfec152e2d836b6cf13c3e2964753fb4b48`（审核启动时一致） |
| P1 #313–#319 | Issue 与原台账均已 CLOSED，原交付 commit 全部是 main 祖先；但本次行为审核发现合入后缺口，不能只凭 closed/ledger 判通过 |
| P1 修复链 | `f54ce5c6`…`4d04e7bf` 已是包含本行 commit 的祖先；Core 全量证据基线 `99f91995`，浏览器补修锚点 `4d04e7bf`，exact-tip CI pending |
| P2 #320–#325 | 原 lane 都基于旧 `69cf06e1`；经双轴审核后均有 follow-up HEAD，尚未合入 main |
| P2 #326–#327 | 尚未实现；必须等 #320–#325 基于新 P1 主线集成后串行开发 |
| P2 #328 | 除 #324 依赖外还需要真人已登录小红书浏览器 / live 核销；fixture 不能冒充 HITL |

### 12.2 严重超时的核查结论

| run / attempt | 真实原因 | 修复 |
| --- | --- | --- |
| `30699271165` | 方向 helper 每次等待 300s，重试 3 次；方向没有真正落地 | 产品用可见 `aria-pressed=true` 与恢复文案证明落地；普通 click，不再用 `force` 制造假绿 |
| `30705186695` attempt 1 | Core recovery/compensation 与 Worker migration 并发，PostgreSQL `40P01`；DBOS admin `:3001` 还制造 EADDRINUSE 噪音，测例未开跑 | migration key advisory lock 包住 recovery/compensation；Worker `runAdminServer:false` |
| `30705186695` attempt 2 | `force` click 返回但 `aria-pressed=false`，无 interaction POST；随后 W12 cleanup `DELETE` 无总期限，卡到 90m | 去掉 `force`，补真实 settle 断言；cleanup 增加 15s 总 deadline，CI job 收紧为 60m |
| `30709104009` / `30711498117` | 均已 settled 为 `cancelled`，不是 success；前者 journey 约 89m，后者由并行更新取消 | 不再把 cancelled/in-progress 当证据；新候选推送后只认 exact-tip `production-main-journey=success` |

因此“严重超时”不是单一 sticky 几何问题，而是 **产品点击假绿 + 数据库迁移竞态 + 无界清理** 三项叠加；继续空等或只 rerun 不能闭环。

### 12.3 P1 审核修复与实跑结果

- #317：failed/cancelled 保持终态，迟到 progress/interrupt 不得复活；等待商家回答时 sticky Composer 与 interrupt 层级分离。
- #318：Delivered 恢复 recommendation/activity shelf；proposal Active 时用原生 `hidden` 收起而不卸载，避免推荐小卡展开态在 replay 中丢失。
- #286 / P0-4 回归：样例 handoff 无 `outputHint` 时不再静默强选 copy。
- #319：canonical note outline OCC 持久化；未提交编辑跨页保护；每页重生成严格走 `prepare → quote → confirm → result_adjust`。
- CI/基础设施：migration/recovery 互斥、关闭 Worker DBOS admin server、W12 cleanup 有界。
- #315 Langfuse：远端已同步 **20/20 prompt sites**，仓库根本机 `.env`（gitignored）已固定 20 个版本；GitHub Actions 当前没有可更新的 secrets/variables，故不声称部署态凭证已更新。

实跑证据：

| 门 | 结果 |
| --- | --- |
| Contracts/Core/Web focused 与 typecheck | 全部 exit 0 |
| Core 全量独立 PostgreSQL | `3007 total / 2986 pass / 0 fail / 21 explicit skip`；safe-provision 另跑 `3/3` |
| UI/UX gates | `Overall PASS` |
| Chromium 针对性热租户 | `1/1 pass`（23.9s；整轮 56.5s） |
| Chromium 三文件最终门禁 | `15/15 pass / 0 fail / 0 skip`（3.0m） |

上述浏览器证据使用 fixture structured model + 真实本机 PostgreSQL/Chromium；live provider / 生产部署 / #328 HITL 明确不在该证据内。

### 12.4 P2 修订候选（仍未合入）

| 票 | 审核后 HEAD | 状态摘要 |
| --- | --- | --- |
| #320 | `c73e61ba` | carrier 全覆盖、左最左最长、原始 UTF-16 offset、fail-closed recheck、10s deadline/retry、原子 seed、CRUD |
| #321 | `3bb6abe3` | 生产消费者真正冻结 generation params / identity 默认值 / XHS scope |
| #322 | `9b019358` | selection 清理与真实 image_text note/Tiptap/Selection AI 可达；合入基线后仍欠最终 Chromium Result 旅程 |
| #323 | `7654a913` | 真实 Core model path + UI 可达的 AI 封面/风格分析 |
| #324 | `0b3373ae` | 去假上传；真实 VLM reference；exact recipe；prompts materialized；fail closed |
| #325 | `8b838141` | frozen experience basis、进度/终态、stale/foreign rejection |

P2 当前仍是 **候选已修、未合入**。下一硬门：推送 P1 修复链与本次台账 → 等该 exact-tip `production-main-journey` success；绿后才允许把 #320–#325 逐票集成复验并登记 ledger。
