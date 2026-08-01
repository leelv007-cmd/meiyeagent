# 主控 Handoff — P2 合入批 + journey 门禁（2026-08-01）

| Field | Value |
| --- | --- |
| 状态 | **执行中**：合入前 journey 一次门禁进行中 |
| main tip（合入基线） | `69cf06e1`（含 Composer delivered 去 sticky 修复） |
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
| Run | https://github.com/leelv007-cmd/meiyeweb-agent/actions/runs/30699271165 |
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

## 2. P2 第 4 波成品（待合入，均未 push）

基线均为 `69cf06e1`；各自 1 commit；票下有认领 + Verification。

| 票 | 标题 | lane HEAD | 分支 | 交底 |
| --- | --- | --- | --- | --- |
| #320 | 违禁词库 / 检查条 / CRUD | `8394b848` | `leelv007-cmd/lane-320` | `docs/ops/issue-320-p2-08-sensitive-words-handover-2026-08-01.md` |
| #321 | tone/role + 深度思考 | `486ebb7b` | `leelv007-cmd/lane-321` | `docs/handoff/issue-321-generation-params-2026-08-01.md` |
| #322 | 对象工作区 + Tiptap + 六动作 | `d00123c5` | `leelv007-cmd/lane-322` | `docs/ops/issue-322-p2-10-object-workspace-tiptap-selection-ai-handover-2026-08-01.md` |
| #323 | AI 封面 + 七维风格 | `481296b4` | `leelv007-cmd/lane-323` | `docs/ops/issue-323-p2-11-ai-cover-style-analysis-handover-2026-08-01.md` |
| #324 | 爆款复刻粘贴轨 | `973e0d92` | `leelv007-cmd/lane-324` | `docs/ops/issue-324-p2-12-viral-adapt-paste-track-handover-2026-08-01.md` |
| #325 | 「经验」+ 三处露出 + morph | `5e0c73d1` | `leelv007-cmd/lane-325` | `docs/ops/issue-325-p2-13-experience-surfaces-handover-2026-08-01.md` |

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
git merge --ff-only leelv007-cmd/lane-320   # 或 cherry-pick 8394b848
# 写 merge-ledger → commit → push → gh issue close 320
```
