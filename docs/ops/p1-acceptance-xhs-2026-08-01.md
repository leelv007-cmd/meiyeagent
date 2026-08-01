# XHS P1 验收记录（主控）

**日期**：2026-08-01  
**规格**：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §8.2 P1 验收门  
**main tip**：`cbcbe4da`（含 #313–#319 台账）  
**台账凭证**：`docs/ops/merge-ledger.md` 行 #313…#319  

## 票面收口

| 票 | 内容 | 台账 sha | 状态 |
|---|---|---|---|
| #313 | P1-01 工作台壳 / 双栏 / 粘底 / AgentFrame | `b58cec17` | CLOSED |
| #314 | P1-02 carrier 收编 | `4a1a36b7` | CLOSED |
| #315 | P1-03 Langfuse 六 prompt | `32d4e3d3` | CLOSED |
| #316 | P1-04 记忆三层 | `37b0ef73` | CLOSED |
| #317 | P1-05 流内 confirm + note 过卡 | `76c60c75` | CLOSED |
| #318 | P1-06 Activity Shelf + 轻胶囊 | `76e745e6` | CLOSED |
| #319 | P1-07 note 时间线 + 写方 | `01169b44` | CLOSED |

## 验收门裁决

| 门 | 断言 | 裁决 | 证据（合入态 main） |
|---|---|---|---|
| **P1-1** | ≥1240 Active/Delivered 双栏（resizable） | **PASS** | `workbench-shell.test.ts`：dual column only when width ≥1240 and Active/Delivered；`workbench-p1.static.test.ts`：react-resizable-panels product path；**9/9** unit 含 P1-1/2/7 |
| **P1-2** | Active Composer 粘底；移动端避让底栏 | **PASS** | static：Active sticky Composer clears mobile-nav `4.25rem`；`workbench-shell.interaction.test.tsx` **6/6** |
| **P1-3** | Shelf ≤3 卡；状态 + 下一步 | **PASS** | `activity-shelf.test.ts` MAX_CARDS=3 + status/next action；unit **25/25**（含 dashboard contract）；interaction shelf+capsules **11/11**（须先 `locale:compile`） |
| **P1-4** | 记忆三层；待确认默认上 | **PASS** | `memory-vault-page.interaction.test.tsx` **17/17**（含「待你确认」置顶）；须先 `locale:compile` |
| **P1-5** | note 时间线可编 ≥1 页大纲 + 配图状态 | **PASS** | `note-plan-timeline.test.ts` **5/5**（含 P1-5 edit outline）；interaction **3/3**；static 钉 C7 交付门 |
| **P1-6** | 付费媒体流内 confirm；拒绝零执行 | **PASS** | `workflow-core.test.ts` **60/60** 含：paid media/note wait confirm；reject runs no execution；cancel terminates without execute；pure-copy skip（D-043）；composer-session **29/29** + agent-frame interaction **4/4** |
| **P1-7** | 媒体 ~1240 / 对话 ~800 | **PASS** | `WORKBENCH_CONVERSATION_MAX_WIDTH_PX=800` / `MEDIA=1240`；shell class `max-w-[800px]`/`[1240px]`；unit 明示 P1-7 |
| **P1-8** | typecheck + composer/image-text/dashboard-home e2e | **PARTIAL→以 CI journey 收口** | **typecheck**：contracts/core/web **0**（web 须 `locale:compile`）；**check-gates Overall PASS**。本机 15 测因宿主假红未收口。**用户 2026-08-01 裁决**：合入闸用完整 `production-main-journey` **一次绿** 代替每票/本机三文件硬阻塞（见「合入闸裁决」与 `docs/ops/p2-merge-batch-handoff-2026-08-01.md` §1） |

## 环境纪律注记

1. **locale:compile 前置**：P1-3/P1-4 interaction 与 web typecheck 依赖 paraglide 产物；干净 clone / 过期 `src/locale/paraglide` 会假红（missing message exports）。验收前必须 `pnpm --filter @meiye/web locale:compile`。  
2. **e2e 锁**：与 credit 轨并行时不得清他人锁；P1-8 本机三文件仍为可选补证，**不**再阻塞 P2 合入窗（以 journey 一次门禁为准）。

## 合入闸裁决（用户 2026-08-01）

| 口径 | 结论 |
|---|---|
| **完整 journey 门禁** | **单票合入开始前跑一次即可**；门禁 = CI `production-main-journey` @ 合入基线 main tip |
| **不必** | 每张 P2 票各跑一遍完整 journey |
| **本批执行** | 基线 `69cf06e1`；run `30699271165`；首 attempt 90m timeout→`cancelled`（非断言红）→ `--failed` re-run **执行中**；绿后开 #320–#325 合入窗 |
| **权威落点** | `docs/ops/p2-merge-batch-handoff-2026-08-01.md` |

## 总裁决

| 口径 | 结论 |
|---|---|
| **代码面 P1-1…P1-7** | **齐 PASS**（合入态 focused 绿 + 台账齐） |
| **严格 P1-1…P1-8 齐验（本机三文件）** | **未齐**——宿主假红欠账；**合入闸改走 CI journey 一次绿** |
| **P2 合入闸**（用户覆盖） | **journey @`69cf06e1` 一次 success 后开闸**；不要求 P1-8 三文件本机先绿 |

## 欠账清单

1. Playwright：`composer-reshell` + `dashboard-home-mount` + `image-text-note-compiler`（15 tests）——见下节 **P1-8 e2e 续跑（handoff §3.4）**。  
2. 可选：将 `locale:compile` 列入 CI/验收 checklist 显式步骤（防假红）。

## P1-8 e2e 续跑记录（按 master-handoff §3.4）

权威：`docs/ops/master-handoff-xhs-p0-closeout-2026-08-01.md` §3.4 多路并发资源与判红。

### 已执行纪律

| 规则 | 动作 |
| --- | --- |
| 共享锁 `/tmp/meiye-e2e.lock` | lane-298 锁 pid 已死 → 清孤儿锁后主控持锁；用完删 |
| 独占冷库 | `meiye_p1_acc` / `meiye_p1_acc_dbos` 自 `meiye_golden*` TEMPLATE 克隆，不与 optin/issue255 共写 |
| 并发额度 | 本面只占 1 槽 e2e；不与 dev 同 worktree 并跑 |
| 杀进程 | 仅杀本主控 lock 树 + 3000/4100 e2e 栈；不误杀并发会话 |
| 判红 | 宿主 load≈9–16；`appstoreagent`/`Virtualization.VirtualMachine`/`Codex` 高 CPU；前两测 **5.0m 超时**、短测 2–4s 绿 → **形态不稳 = 基建/宿主假红** |
| fallback | 停本机长 e2e；**标准 fallback = CI**（handoff 明文） |

### 本机误跑教训

`pnpm e2e -- <files>` 在本环境会变成「`playwright test -- <files>`」，**滤掉路径、跑全量 suite**。正确写法：

```bash
pnpm exec playwright test \
  tests/e2e/specs/composer-reshell.spec.ts \
  tests/e2e/specs/dashboard-home-mount.spec.ts \
  tests/e2e/specs/image-text-note-compiler.spec.ts
```

全量误跑已中止；聚焦 15 测开跑后前 2 条 journey 超时，宿主降级成立后停跑放锁。

### CI 侧

- push `cbcbe4da` Core quality：`e2e` job **skipped**（`needs: release-manifest` 未满足；全量 RC e2e 非每推必跑）。
- `production-main-journey`（required）在跑中——覆盖 assembly-gate / m04 / 主旅程，**不等于** P1-8 三文件清单。
- 本地 `check-gates` 仍 **Overall PASS**。

### 下一动作（方案 1 收口）

1. **优先**：宿主恢复后（uptime 正常、appstoreagent 不霸核）按正确命令重跑 15 测；或 **Mac 重启**（handoff：fseventsd/appstoreagent 积压无可清型）。  
2. **并行**：盯 CI `production-main-journey` @`cbcbe4da`；绿则作为 required 浏览器门佐证，仍须补 P1-8 三文件证据。  
3. **RC 全量 e2e**：仅在需要 `run-e2e`/`release-candidate` 标签且 release-manifest 链路齐时开 draft PR（勿用半吊子 label 空跑）。

## 命令摘录（可复跑）

```bash
cd mkfast-template-main && pnpm locale:compile
pnpm exec tsx --test \
  src/product/composer/workbench-shell.test.ts \
  src/product/composer/workbench-p1.static.test.ts \
  src/product/activity-shelf.test.ts \
  src/product/composer/note-plan-timeline.test.ts \
  src/product/composer/composer-session.test.ts
pnpm exec vitest run \
  src/product/composer/workbench-shell.interaction.test.tsx \
  src/product/dashboard-continue-section.interaction.test.tsx \
  src/product/suggestion-capsules.interaction.test.tsx \
  src/product/memory-vault-page.interaction.test.tsx \
  src/product/composer/note-plan-timeline.interaction.test.tsx \
  src/product/composer/agent-frame.interaction.test.tsx
cd ../apps/core && pnpm exec tsx --test src/p1/harness/workflow-core.test.ts
cd ../.. && pnpm --filter @meiye/contracts exec tsc --noEmit \
  && pnpm --filter @meiye/core exec tsc --noEmit \
  && (cd mkfast-template-main && pnpm exec tsc --noEmit)
node scripts/uiux/check-gates.mjs
# e2e when lock free:
# pnpm --filter @meiye/web e2e -- tests/e2e/specs/composer-reshell.spec.ts \
#   tests/e2e/specs/dashboard-home-mount.spec.ts \
#   tests/e2e/specs/image-text-note-compiler.spec.ts
```
