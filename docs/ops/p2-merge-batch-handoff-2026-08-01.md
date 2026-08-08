# 主控 Handoff — P2 合入批 + journey 门禁（2026-08-01）

> **状态覆盖说明（Codex 2026-08-02）**：§1–§5 是 2026-08-01 的历史快照，包含旧 baseline、旧 lane HEAD 与当时 pending 的 run；不得按旧 SHA 操作。§6 是第一次复核快照；当前权威状态见 §7。

| Field | Value |
| --- | --- |
| 状态 | **历史快照**：当时合入前 journey 门禁执行中；当前见 §7 |
| main tip（历史合入基线） | `69cf06e1`（含 Composer delivered 去 sticky 修复） |
| 规格 | `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §8.3–§8.4、§11 |
| 通用纪律 | `docs/ops/agent-dispatch-runbook-2026-07-29.md` |
| 用户裁决 | 同步先执行 P2 开发；**后续一起核验门禁**；**完整 journey 门禁在单票合入前跑一次即可** |

---

## 1. Journey 门禁口径（本批硬规则）

### 1.1 规则

| 项 | 口径 |
| --- | --- |
| **门禁是什么** | CI Core quality 的 **`production-main-journey`**（required：assembly-gate + M-04 + production-build 主旅程） |
| **何时跑** | **整批单票合入开始前跑 1 次**，基线 = 即将 ff 的 `main` tip |
| **不必** | 每张 P2 票各自重跑完整 journey；lane 内 focused unit/interaction 仍按票交验 |
| **通过判据** | 该 job **`success`**（非 `cancelled`/timeout 假结论）；`required` 聚合绿 |
| **失败处置** | 不合入任何 P2 票；按 §3 判红 → 修 main 或重跑 → 再开合入窗 |
| **本机 e2e** | 不替代本门；宿主假红时 fallback=CI（见 master-handoff §3.4） |
| **P1-8 三文件** | 可选补证；**本批合入闸以 production-main-journey 一次绿为准**（用户 2026-08-01 明示） |

### 1.2 本次执行记录

| 字段 | 值 |
| --- | --- |
| Run | https://github.com/legacy-origin-a/legacy-web-repo/actions/runs/30699271165 |
| SHA | `69cf06e1a6e18734fcefef8122a833e8a4b8e3a7` |
| 第一次 attempt | step11 挂至 job **timeout 90m** → job **`cancelled`**；全 run `cancelled`，`required=failure` |
| 首 attempt 真因（证据包） | artifact `production-main-journey-evidence`：M-04 **`image_text → xiaohongshu`** 在 `chooseImageTextDirection`（`ui-journey.ts:181`）**稳定失败**——`the direction must land — by merchant click or frozen-route pre-answer`，**300s × 3 retries**；resume 行「已按你选的方向继续准备整套图文」始终未可见。**不是** sticky delivery-card 点击拦截（`69cf06e1` 已修那条）。3×5min 重试叠其他用例 → 逼近 90m 被 cancel |
| 处置 | `gh run rerun 30699271165 --failed`（2026-08-01T13:45Z 起第二 attempt）——用于确认是否复现 |
| 当前 | tip `118c3528` run `30705186695`：首 attempt **webServer 起不来**（EADDRINUSE :3001 + PG deadlock migrate/compensation，**测例未开跑**）→ `--failed` re-run |
| 终态（填） | _pending re-run after infra flake_ |

### 1.3 方向卡修复（2026-08-01 主控直修）

**根因（与 sticky 交付卡同族）**：Active 粘底 Composer（`z-30`）挡住时间线里的 **图文方向 / 补问 interrupt**，`chooseImageTextDirection` 点不到选项 → 300s×3 → job 90m cancel。

**修复**（commit 见 main tip）：
- `composer-conversation.tsx`：`question` / `execution_confirm` 帧挂 `WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS`；interrupt 出现时 `scrollIntoView({ block: 'end' })`
- `ui-journey.ts`：`chooseImageTextDirection` 支持 legacy `composer-question-card`、scrollIntoView + **force click**、放宽「两种图文方向」匹配
- static：`workbench-p1.static.test.ts` 钉 scroll-margin / scrollIntoView
- 双审 follow-up：scroll effect deps 收窄为 `liveInterruptTurnId`/`kind`（不跟整表 `turns`）；优先滚 **最新** interrupt；去掉 e2e 空 `stylesReady` 分支

**合入窗开启条件**：本 fix 合入 main 后，对该 tip 再跑 **一次** `production-main-journey` 且 `success`。

---

## 2. P2 第 4 波成品（历史候选；不得按本节旧 HEAD 合入）

基线均为 `69cf06e1`；各自 1 commit；票下有认领 + Verification。

| 票 | 标题 | lane HEAD | 分支 | 交底 |
| --- | --- | --- | --- | --- |
| #320 | 违禁词库 / 检查条 / CRUD | `8394b848` | `legacy-origin-a/lane-320` | `docs/ops/issue-320-p2-08-sensitive-words-handover-2026-08-01.md` |
| #321 | tone/role + 深度思考 | `486ebb7b` | `legacy-origin-a/lane-321` | `docs/handoff/issue-321-generation-params-2026-08-01.md` |
| #322 | 对象工作区 + Tiptap + 六动作 | `d00123c5` | `legacy-origin-a/lane-322` | `docs/ops/issue-322-p2-10-object-workspace-tiptap-selection-ai-handover-2026-08-01.md` |
| #323 | AI 封面 + 七维风格 | `481296b4` | `legacy-origin-a/lane-323` | `docs/ops/issue-323-p2-11-ai-cover-style-analysis-handover-2026-08-01.md` |
| #324 | 爆款复刻粘贴轨 | `973e0d92` | `legacy-origin-a/lane-324` | `docs/ops/issue-324-p2-12-viral-adapt-paste-track-handover-2026-08-01.md` |
| #325 | 「经验」+ 三处露出 + morph | `5e0c73d1` | `legacy-origin-a/lane-325` | `docs/ops/issue-325-p2-13-experience-surfaces-handover-2026-08-01.md` |

Worktree 根：`/Users/bin/orca/workspaces/美业内容2/lane-<N>`。

### 2.1 建议合入序（journey 绿后）

技术冲突面优先解耦；**合入序 ≠ 开发序编号**：

1. **#320**（core 词库，面窄）  
2. **#321**（Composer 参数）  
3. **#325**（导航文案 / morph，面散但改动可预期）  
4. **#322**（对象工作区壳 — #326/#327 前置）  
5. **#323**（封面 / 风格，可与 #322 后串）  
6. **#324**（爆款旅程，可与 #323 后串）  

每票：主控 worktree 外 **亲验 focused 绿 → ff 合入 → `docs/ops/merge-ledger.md` 一行 → 关票**。  
全程 **不** 要求每票再跑完整 journey（见 §1.1）。

### 2.2 第 5 波（journey 后、第 4 波台账齐后再派）

| 票 | 依赖 |
| --- | --- |
| #326 | #322 |
| #327 | #320 + #322 |
| #328 | #324 + HITL live 核销 |

---

## 3. 判红与超时

- Job `timeout-minutes: 90`（`core-quality.yml` `production-main-journey`）。  
- 历史成功 run 总长约 **20–25 min**；挂满 90m 的 `cancelled` **不计产品红**，应 re-run 或查卡死点。  
- 已知曾卡：Delivered 相位 sticky Composer 挡 `composer-delivery-card` 点击 → 已修于 `69cf06e1`。  
- **本批首 attempt 真因**：M-04 图文方向未落地（`chooseImageTextDirection`，见 §1.2），与 sticky 无关。  
- 判红三步法 + 宿主假红：master-handoff §3.4。

---

## 4. 下一步 checklist

- [ ] **Journey 一次门禁绿**（§1.2 终态填写）  
- [ ] 按 §2.1 串联合入 #320→…→#325（每票 ledger + 关票）  
- [ ] 更新 `docs/ops/p1-acceptance-xhs-2026-08-01.md`：P1-8/合入闸与本 handoff §1.1 对齐  
- [ ] 派发第 5 波 #326/#327（#328 仍待 HITL）  
- [ ] 本文件 journey 终态落定后可随 ledger 一并入库（或主控单独 docs commit）

---

## 5. 命令速查

```bash
# 盯 journey
gh run view 30699271165 --json status,conclusion,jobs \
  --jq '{status,conclusion,jobs:[.jobs[]|{name,status,conclusion}]}'

# 失败后仅重跑失败作业（本批已用）
gh run rerun 30699271165 --failed

# 合入示例（主 checkout，journey 绿后）
git fetch origin main && git checkout main && git pull --ff-only
git merge --ff-only legacy-origin-a/lane-320   # 或 cherry-pick 8394b848
# 写 merge-ledger → commit → push → gh issue close 320
```

---

## 6. Codex 复核更新（2026-08-02，合入前）

### 6.1 旧 journey 终态

- `30705186695`：workflow `failure`；journey job attempt 2 最终 `cancelled`，required `failure`。
- `30709104009`：workflow / journey `cancelled`，required `failure`。
- `30711498117`（`5f456dfe`）：workflow / journey `cancelled`，required `failure`。

上述都不是合入门 `success`。超时根因与修复详见 `codex-handoff-journey-gate-p2-2026-08-02.md` §12.2；新 P1 候选推送后必须重新等待 exact-tip journey。

### 6.2 #320–#325 审核后候选

| 票 | 原 handoff HEAD | 当前 HEAD | 复核终态 |
| --- | --- | --- | --- |
| #320 | `8394b848` | `c73e61ba` | focused/Core real-PG/Web/Chromium 均有实跑绿证，lane clean |
| #321 | `486ebb7b` | `3bb6abe3` | focused/Chromium/typecheck/Biome 绿，lane clean |
| #322 | `d00123c5` | `9b019358` | unit/interaction/static/typecheck/Biome 绿；最终 Result Chromium 须在新基线复跑 |
| #323 | `481296b4` | `7654a913` | contracts/core/web focused 与 checks 绿，lane clean |
| #324 | `973e0d92` | `0b3373ae` | Core/Web focused 与 checks 绿，lane clean |
| #325 | `5e0c73d1` | `8b838141` | contracts/core/web/interaction 与 checks 绿，lane clean |

六个 lane 仍从旧 `69cf06e1` 分叉，**不得把“lane clean / Issue closed”当成可直接 ff 的证明**。集成时基于新 P1 exact tip 按实际冲突面串行 cherry-pick/rebase，并在 base change 后重跑相应门禁。

### 6.3 后续票边界

| 票 | 当前状态 |
| --- | --- |
| #326 | 未实现；#322 真实 image_text 路径要求单一 NoteObjectWorkspace，组合媒资、Tiptap 与双预览；建议 #323 先进入集成基线 |
| #327 | 未实现；依赖 #320 scanner + #322/#326 编辑器可达性，必须 bounded scan 与 decorations/replacements |
| #328 | 未验收；依赖 #324 且需要真人已登录浏览器、真实小红书笔记 URL 与 live 核销，fixture 不得替代 |

因此当前 checklist 是：推送已进入 main 的 P1 修复链与台账 → exact-tip journey 绿 → 集成复验 #320–#325 → 实现 #326/#327 → #328 HITL。ledger 与 Issue 只在对应 commit 真正进入 main 且证据完成后更新。

---

## 7. Codex 最终集成候选（2026-08-02）

> 本节覆盖 §6.2 与 §6.3。九票已经在 P1 exact-tip 之后完成串行集成与复核；本节落库时仍待 main fast-forward 和该 final main SHA 的 required CI，因此不提前宣称合入或关票。

### 7.1 九票终态

| 票 | 终态摘要 |
| --- | --- |
| #320 | 原子 CRUD、全 carrier、UTF-16 offset、左最左最长与 delivery guard |
| #321 | 签名 generation params；customized 无隐藏 voice role、standard thinking、MarketingIdentity 保留 |
| #322 | 单一 NoteObjectWorkspace、Tiptap、六动作、空段落与 derived terminal |
| #323 | 五 preset、三 ratio（9:16=`1152×2048`）、授权 style refs、七维分析 |
| #324 | viral paste／OpenCLI structured source、exact recipe、两条 viral prompt；Langfuse 扩至 22/22 |
| #325 | 当前任务 frozen experience basis、三处露出、morph、stale/foreign 拒绝 |
| #326 | 手机笔记预览＋双列封面预览，复用同一对象工作区 |
| #327 | bounded inline replacement、冻结选区、明确 variant/history/delivery；历史及 mixed-version destination 只读投影 |
| #328 | stale read cancellation、bridge fail-closed、paste fallback；live 一次 read＋一次 download、写动作 0 |

### 7.2 最终本地验证

| 门 | 结果 |
| --- | --- |
| Core fresh business＋DBOS | `3096 total / 3075 pass / 0 fail / 21 explicit skip`；safe-provision `3/3` |
| Contracts | `165/165`，typecheck exit 0 |
| Web | build/check/typecheck 绿；unit `1712 pass / 0 fail / 3 skip`，三个 PostgreSQL opt-in 文件另跑 `3 pass / 0 fail / 0 skip`；interaction `390/390`；secret scan 0 finding |
| Chromium fresh business＋DBOS | 五文件 `19/19 pass / 0 fail / 0 skip`，7.8m |
| Prompt authority | remote `22/22`；strict `22/22`、fallback 0、contentMatches 22；Actions secrets/variables `0/0` |
| Agent Team 终审 | `P0=0 / P1=0 / P2=0` |

Core 首轮 `13` 红的逐项原因、focused 修复证据、compact rolling-deploy 兼容修复与证据边界见 `docs/ops/codex-handoff-journey-gate-p2-2026-08-02.md` §13。

#328 live 门与 fixture 证据必须分开：`2026-08-01T20:53:37Z` 的用户自有登录态只执行一次真实 note read 与一次 download，外部写入为 0；fixture 浏览器只证明注入 bridge 合同、fail-closed 和 paste fallback，不证明生产 companion 或 live provider 已部署。

### 7.3 剩余合入门

1. 冻结候选 commit，并先 fast-forward 本地 `main`（不 push）。
2. 以该本地 main 祖先为合入锚，逐票更新并提交 `docs/ops/merge-ledger.md`，再 fast-forward 本地 `main` 到这个 final ledger commit。
3. push final main SHA，等待该 SHA 的 `production-main-journey`、`core-persistence`、`root-quality`、`core` 与聚合 `required` 全部 success。
4. CI 全绿后再关闭 #320–#328；任何 cancelled、旧 SHA 或本地 fixture 结果都不能替代 exact-SHA CI。
