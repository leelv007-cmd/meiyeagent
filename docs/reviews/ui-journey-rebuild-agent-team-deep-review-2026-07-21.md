# UI Journey Rebuild · Agent Team 深度 Review 与修复报告（2026-07-21）

> **状态：活审查报告（HEAD 代码实锤）。** 本报告对 `992fa71`（`main`，相对 `origin/main` ahead ~381）的 UI/用户旅程重建包（handoff `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md`，票 #84–#105 / S1 #87）做代码层深度复核，并给出可执行修复清单。  
> **方法**：6 路并行 Agent Team（S1 合同脊柱 / WT-A / WT-B / WT-C / WT-D / WT-E+Z+WT-0）+ 主会话对抗抽验关键 P0（file:line 全命中）+ 本地 e2e 失败产物交叉。  
> **权威链**：设计 D-072~D-098 → `docs/specs/ui-journey-rebuild-spec-2026-07-20.md` → handoff → contracts + 实现。  
> **不作为完成证据**：GitHub issue 开闭状态、默认 `pnpm test` 全绿 alone、fixture 瞬时 ready 的 e2e alone。

---

## 0. 一句话裁决

**UI Journey 重建的「合同属主 + 纯投影骨架 + Z1 主入口切换」已合入 main 且方向正确；但多条验收主路径仍停在「测得过模型、跑不通 live / 生产主路径」——不可无条件宣称 #84–#105 全绿或三模态 Day-0 闭环完成。**

| 维度 | 分 | 一句话 |
|---|---:|---|
| S1 合同脊柱 | **6.5** | 四模块属主落地；浏览器可见合同仍夹 Deployment / 双报价真相 |
| WT-A 创作配置 | **7.5** | Catalog 发布聚合扎实；browser 默读 head 可暴露 draft |
| WT-B 计费交付通知 | **6.6** | 按秒结算算法强；视频完整包未挂 export 主路径 |
| WT-C Composer 前端 | **7.4** | 六卡/镜头状态机强；C4 提交时视频确认洞 |
| WT-D 结果中心 | **6.8** | Shell/路由/诚实交付强；ADR-0007 token 流未 live 接线 |
| WT-E 视频 + Z1 + 卫生 | **7.4** | 派生化与 Composer 主入口到位；durable 查询泄漏 + e2e 偏软 |
| **综合** | **~7.0** | 可 dogfood 主路径；不可宣称「三模态全旅程验收全绿」 |

### 宣称边界（硬）

| 可宣称 | 不可宣称 |
|---|---|
| S1 四合同文件属主与冻结矩阵已落地 | 浏览器可见合同诚实边界已钉死（Deployment 字段仍在 public 类型） |
| Composer 已是 `/dashboard` 主入口；legacy workbench 文件物理删除 | 三模态 e2e 诚实观测到 running/token 中间态 |
| ProductUsage 支持按秒差额；低退高不补扣算法正确 | 视频「拿到文件」= manifest/v1 完整 ZIP（主路径仍单 MP4） |
| Result Center 路由与 Shell 纯投影存在 | ADR-0007 token 级流式在 Result route live |
| VideoWorkflow 生产写权威在 Task/Job/Asset | 浏览器仅见 public video projection |
| Z1 T6 / ContentPackage 写动作静态退旧门存在 | #84–#105 票面全部 complete |

---

## 1. 审查范围与方法

### 1.1 分线（与 handoff 对齐）

| 线 | 票 | 审查面 |
|---|---|---|
| S1 | #87 | `packages/contracts` creation-experience / product-quote / result-center / video-workflow / actionable-inbox |
| WT-0 | #84–#86 | provision 双库、GL-25/26、Vitest+RTL、V1 C6 基线 |
| WT-A | #88–#90 | `apps/core/src/p1/creation-experience/**` |
| WT-B | #91–#94 | `product-billing/**` + `result-delivery/**` + export adapter |
| WT-C | #95–#98 | `mkfast-template-main/src/product/composer/**` + `routes/dashboard/index.tsx` |
| WT-D | #99–#101 | `src/product/results/**` + `results_/$workId.tsx` + handoff |
| WT-E | #102–#104 | video derivation / regeneration / `results/video/**` |
| Z1 | #105 | cutover 退旧 + 三模态 e2e |

### 1.2 主会话抽验（P0 锚点，全部命中）

| 断言 | 证据 |
|---|---|
| Composer 主入口 | `routes/dashboard/index.tsx:1,99` 挂 `ComposerHome`；`?workId=` → Result Center |
| browser catalog 读 head | `catalog-service.ts:626–647` `getRecipeHead`/`getSurfaceHead`，未强制 published |
| restricted 过触发 | `foundation-module.ts:305–308` `sourceIds.length > 0` ⇒ restricted |
| 视频 export 主路径 | `content-package-export-adapter.ts:183–217` 仍 `video/mp4`；`exportVideoFullPackage` 仅测调用 |
| token 流未接线 | `results_/$workId.tsx` 对 `partialCandidates`/`streamLoading`/`useCopyCandidateStream` **0 命中** |
| C4 video confirm 洞 | `composer-home.tsx:686` 放行 `video_confirm_required`；`782` `runCreate` 无 accept |
| Deployment 在 public 类型 | `product-quote.ts:101–102` `frozenCandidateDeploymentIds` |
| 缺可信 usage 吃满 ceiling | `quote-service.ts:593–596` |
| 三模态 e2e 失败产物 | `test-results/ui-journey-three-modal-Z1-...` phase 期望 running 得 ready |
| 分镜假 assetId | `video-worksurface-model.ts:357` `shot-asset-${shotId}` |

---

## 2. Agent Team 分路结论

### 2.1 Agent S1 · Contract Spine — 6.5/10

**Verdict**：可并行的文件属主脊柱完成；浏览器可见合同诚实 + 唯一报价/命令真相未钉死。

**Strengths**

- 四模块路径与 handoff 冻结表一致；`index.ts` 正式 re-export
- Nav `{workId, returnToDraftKey, focusKey}` 正确；禁止 stage 进 URL
- Inbox 引用式投影、无独立 Notification 表
- Video public projection 字段干净；Creation browser allowlist 存在
- 运行时 `toPublicProductQuoteSnapshot` 出站 strip Deployment（core）

**Findings**

| ID | Sev | 摘要 | 修复 |
|---|---|---|---|
| S1-01 | **P0** | `ProductQuoteSnapshot.frozenCandidateDeploymentIds` 在浏览器消费合同上 | 拆 Durable vs Public DTO；web 只 import Public；contracts 禁词序列化测 |
| S1-02 | **P0** | `ProviderCostSnapshot.deploymentId` 等同 barrel 暴露供应内部 | 迁 supply/internal 或不 barrel 给 web + ESLint boundary |
| S1-03 | P1 | 三套报价：`product-quote` + `CreativeExecutionContract` + `quoteFor` | 标 legacy；提交路径只认 `quoteId+revision` |
| S1-04 | P1 | `expectedRevision` string vs number 双轨 | 统一 number 或分字段 |
| S1-05 | P1 | 视频 `scope` shot/full_compose 未进 product-quote | 合同归位；core/web re-export |
| S1-06 | P1 | `ToolHandoff` 仅前端私有 | 迁 contracts |
| S1-07 | P1 | spine 测试仅 result-center 有；缺诚实序列化 | 四模块 + 禁词 JSON 测 |
| S1-08 | P2 | actionable-inbox 旁路 barrel；lens 状态机合同缺失 | 正式 export + 状态机类型 |

---

### 2.2 Agent A · Creation Experience — 7.5/10

**Verdict**：发布聚合 / 六卡种子 / PatchPreview / Brief / 事件 / 会话冻结完成度高；**merchant browser 默读 draft head** 与 **source⇒restricted** 会直接破 D-078/D-094。

**Strengths**

- 独立 `CreationExperienceFoundationModule`；Lens/Tool 静态（C3）
- draft→preview→validate→publish→rollback + CAS；session freeze insert-only
- 六卡八 variant 与 D-082/083 字段级锁定测齐全
- Brief 七触发码 + 提交原子性 postgres 测
- browser allowlist 挡 hidden prompt / provider 族

**Findings**

| ID | Sev | 位置 | 摘要 | 修复 |
|---|---|---|---|---|
| A-01 | **P0** | `catalog-service.ts:626–647` | `recipe_browser`/`surface_browser` 默认 `get*Head()`，可返回 draft | 默认 `latestPublished*`；非 published 对 workspace.read 404 |
| A-02 | **P1** | `foundation-module.ts:305–308` | 任意 `sourceIds` ⇒ restricted ⇒ Brief 过触发 | 仅真权利/受限信号；补「有源简单文案不 Brief」测 |
| A-03 | P1 | patch_preview 路径 | 不校验 recipe published | 仅 published 或 session 已冻 revision |
| A-04 | P1 | recipe_draft body | 可写入 `hiddenPromptBody` | command 强制 strip/forbid |
| A-05 | P1 | OAS `attachBriefSubmissionGate` | 冻结面扩方法（整合属主豁免需文档） | 改 DI 依赖或正式记豁免 |
| A-06..11 | P2 | 工具种子 4 vs 六项、retire 未闭环、事件 meta 丢 string、伪 platform 名、matrix 过时、PG 真并发 CAS 弱 | 见分路原文 |

---

### 2.3 Agent B · Billing Delivery Notification — 6.6/10

**Verdict**：quote→confirm→reserve→dispatch→settle 与按秒规则正确；**视频完整交付包未接生产 export**、**manifest revision 恒 0**、**inbox 双装配** 挡住 #92–#94 complete。

**Strengths**

- 单一报价属主；fallback 不二次预占；高产吸收到 supply cost
- Durable PG + advisory lock + UNIQUE(task)
- `revise_content_package_visuals` OCC；working selection 服务端 local-only
- Assisted「已交接≠已发布」；Resolver 只读 legacy；无 auto-publish SM
- image_text 已扩既有 adapter（固定 mtime ZIP）

**Findings**

| ID | Sev | 摘要 | 修复 |
|---|---|---|---|
| B-01 | **P0** | video `export()` 仍单 MP4；`exportVideoFullPackage` 无生产 caller | `exportContentPackage`/`result_export` 默认 full ZIP + manifest |
| B-02 | **P0** | manifest `contentPackageRevision` 默认 0 | export 入参强制真实 revision |
| B-03 | P1 | Durable settle 与 memory lifecycle 对 providerCost 行为分叉 | 对齐：settle 可创建/合并 attempt cost |
| B-04 | P1 | 缺可信 usage → 吃满 ceiling + 无 re-settle | 标签保持 estimated/unknown；补迟到证据一次向下修正 |
| B-05 | P1 | ops `productUsageQuantity: 0\|1` vs ProductUsage 分数单位 | 文档双账本边界 + 调用方禁混用 |
| B-06 | P1 | pending-actions HTTP vs actionable_inbox 双投影；main 过滤仅 question\|approval | 单一 `projectActionableInbox` 源 |
| B-07 | P1 | `beforeSubmit` 可从 quoted 自动 confirm | 仅 confirmed\|reserved 可 reserve |
| B-08 | P2 | float 金额、内存幂等等 | integer micros 等 |

---

### 2.4 Agent C · Composer Frontend — 7.4/10

**Verdict**：纯模型层 shippable；**ComposerHome 对 C4 提交时视频确认不完整**，C6 点击预算未在 Composer 测锁定。

**Strengths**

- Lens SM：`user_explicit`、无输入推断；六卡文案字面 D-083
- PatchPreview keep/stash/change；ToolHandoff 白名单；Pro Studio 仅 `/pro-studio`
- 移动 2×3、单 bottom sheet、目录搜索门槛 12
- GL-23 内联兑换；模型名回设置行；dashboard 主入口真实

**Findings**

| ID | Sev | 摘要 | 修复 |
|---|---|---|---|
| C-01 | **P0** | `attemptSubmit` 放行 `video_confirm_required` 后无 accept 调 `runCreate`；非 Brief 视频路径洞 | 视频始终 open Brief 或挂 home 确认区；仅 accept 后提交 |
| C-02 | P1 | Surface 失败时六卡不降级到 seeds | error/empty 时 `listColdCardsFromSeeds` |
| C-03 | P1 | C6 点击预算无自动化锁 | interaction 或 e2e 三路径计数 |
| C-04 | P1 | RecipeCardsPanel 与 parent lens 双状态可 desync | 单源或 parent 变更 hard reset confirm phase |
| C-05 | P2 | settings 行 / patch client 边缘测不足 | 补 RTL |

---

### 2.5 Agent D · Result Center — 6.8/10

**Verdict**：Shell 纯度 / 路由 / handoff canonical / delivery 诚实度高；**token 流未接线**、**整组 adopt 未闸门**、**套图漂移静默丢弃** 打穿 #99–#100。

**Strengths**

- 无第二 Result 表；not_found 不回落 latest
- handoff 页仅 canonical 数据源；share≠published
- copy.adapt 拒 client_concat；hand-edit OCC
- image role 矩阵模型完整；测试密度高

**Findings**

| ID | Sev | 摘要 | 修复 |
|---|---|---|---|
| D-01 | **P0** | `$workId` route 零引用 stream；运行态 phase-only | 接线 `useCopyCandidateStream` → `partialCandidates`/`streamLoading`；静态门禁 phase-only |
| D-02 | **P0** | `wholeSetAdopt` rejected 仍可点主按钮 | disable + route 二次 `validateWholeSetAdopt` |
| D-03 | **P0** | working selection revision 不等 → 静默 empty | hydrate + restore/compare/discard UI |
| D-04 | P1 | `canShareFiles` 未对真实 File `canShare` | 实测 files |
| D-05 | P1 | 选区改写 chips 死 UI；panel history/adjust 半成品 | 接线或隐藏动作 |
| D-06 | P2 | content 路由 legacy handoffPackages 残留 | Z 补清或标 archive-only |

---

### 2.6 Agent E+Z · Video + Cutover + Hygiene — 7.4/10

**Verdict**：生产写权威已派生；Composer 主入口与 T6 退旧到位；**durable video query 仍可泄漏**、**三模态 e2e 对 running 偏软**。

**Strengths**

- Canonical Task/Job/Asset 写；projection facade 禁写
- free-action 列表 core 强制；retry 必 re-quote；recover 同 supplier
- 视频工作面主能力齐；delivery direct-publish 隐藏
- provision 双库 + canvas 迁移断言（GL-26）；GL-25 归因修；Vitest+RTL 基建在
- Z1：workbench 文件物理删除；ContentPackageDetail 只读 + Result handoff

**Findings**

| ID | Sev | 摘要 | 修复 |
|---|---|---|---|
| E-01 | **P0** | `video_workflow`/`video_workflows` 返回完整 durable | 浏览器只暴露 public*；或 durable 强制 re-project |
| E-02 | **P0** | 三模态 e2e 瞬时 ready；断言已放宽为 running\|ready | 强制观测一次 running/token 或记录合法 fast-path 时间序 |
| E-03 | P1 | 分镜 `shot-asset-*` 假 id | 仅 canonical Asset 投影 |
| E-04 | P1 | VideoWorkflowPanel/Launcher 无 route 但代码仍活 | 物理删除或静态门禁 |
| E-05 | P1 | free ops poll/recover/download 工作面未全暴露 | 补 UI 或文档标明 runtime-only |
| E-06 | P2 | `model_video_workflows` 表仍 migrate；E3 stub 注释过时 | drop 票 + 改注释 |

**e2e 失败产物（本地）**

| Spec | 症状 |
|---|---|
| `ui-journey-three-modal` | phase 期望 running，得 ready（后 fixture 放宽，诚实性仍弱） |
| `admin-creation-experience-lifecycle` | Surface status `published · r7` vs 实际 r6 / 曾 preview |
| `catalog-live-navigation` | 期望 `composer-catalog-empty`「暂无可用创作工具」未出现 |

---

## 3. 交叉裁决：Must-Fix 总表（按优先级）

### 3.1 P0 — 宣称 complete / 三模态全绿前必修

| # | 线 | 问题 | 建议修复 | 验收门 |
|---|---|---|---|---|
| 1 | S1 | Public quote 含 Deployment 字段 | Durable/Public 拆分 + contracts 禁词序列化测 | `pnpm --filter @meiye/contracts test` 含禁词 |
| 2 | A | browser catalog 读 draft head | 默认 `latestPublished*` | publish→draft head→browser 仍上一 published |
| 3 | B | 视频完整包未挂 export 主路径 | `result_export`/exportContentPackage → full ZIP | ZIP + `beauty-delivery-manifest/v1` |
| 4 | B | manifest revision=0 | 强制真实 package.revision | manifest.revision === package.revision |
| 5 | C | 提交时视频确认洞 | Brief 必开或 home 确认区；禁 bare runCreate | 视频无 accept 不可创建 Job |
| 6 | D | token 流未 live | route 接线 copy stream | running 时 `result-token-stream` + first token |
| 7 | D | 整组 adopt 未闸门 | rejected disable + 二次校验 | partial set 无法 submit |
| 8 | D | 套图漂移静默丢 | compare/discard/reapply UI | 漂移必显三选一 |
| 9 | E | durable video 查询泄漏 | public-only 对 browser | 序列化无 routeSnapshot/attempts |
| 10 | E/Z | 三模态 e2e 诚实性 | 强制中间态或合法 fast-path 证据档 | e2e 绿且证据可审计 |

### 3.2 P1 — 下一迭代强推（验收缺口 / 诚实半对齐）

| # | 线 | 问题 |
|---|---|---|
| 11 | S1 | 三套报价收敛；OCC revision 统一；scope 入合同；ToolHandoff 入 contracts |
| 12 | A | source 不默认 restricted；patch 仅 published；禁 hiddenPromptBody 入 draft |
| 13 | B | durable settle providerCost 对齐；禁 quoted auto-confirm；inbox 单投影；estimated re-settle |
| 14 | C | Surface 失败 seed 六卡；C6 点击预算自动化；panel/lens 单源 |
| 15 | D | canShareFiles 真测；选区改写接线或隐藏；copy outcome a11y |
| 16 | E/Z | 假 assetId 去除；VideoWorkflowPanel 退旧门；free ops 文档/UI |

### 3.3 P2 — 卫生与长期债

- float 金额 → integer micros  
- creation-experience events meta 与合同一致  
- migration-matrix 更新 Postgres 已落地  
- `model_video_workflows` drop 排期  
- content 路由 legacy handoffPackages archive 清理  
- actionable-inbox 正式 barrel export  
- admin Surface revision e2e / catalog capability empty 态修复  

---

## 4. 红线与纪律对照（D-098 / handoff 全局规则）

| 红线 | 状态 |
|---|---|
| 不建灰度机器 / 自动发布 SM / Lens-Tool 发布生命周期 / anchor 写路径 / 搜索实现 / 浏览器通知 | **Pass**（本轮未见越界建机器；direct-publish 隐藏） |
| 跨线接口走 contracts + HTTP 合同 | **Partial**（ToolHandoff / scope / PublicQuote 未全在 contracts） |
| 诚实：不显示 Provider/Deployment/Credential/fallback | **Fail 类型面**（product-quote Deployment；video durable query）；运行时 strip 部分存在 |
| 「已交接」≠「已发布」 | **Pass**（assisted + delivery 文案） |
| 缺可信 usage → estimated/unknown | **Pass 标签**；**Partial 钱路径**（吃满 ceiling 无 re-settle） |
| 退旧仅 Z1 三媒介齐后 | **Mostly Pass**（workbench 删；VideoPanel 残留） |
| A/B 不向 OAS 塞新方法 | **Partial**（Brief gate 扩方法；记整合豁免或收回） |

---

## 5. 建议修复批次（可执行顺序）

```
Batch 0（诚实边界，1–2 天）
  S1-01/02 Public DTO + 禁词测
  E-01 video public-only 查询
  A-01 browser published-only

Batch 1（交付与计费接线，2–3 天）
  B-01/02 视频 full ZIP + revision
  B-03/07 settle 对齐 + 禁 auto-confirm
  B-06 inbox 单源

Batch 2（前端主旅程，2–3 天）
  C-01 视频提交确认
  D-01 token 流 live
  D-02/03 套图闸门 + 漂移 UI
  C-02 seed 六卡 fallback

Batch 3（验收诚实化，1–2 天）
  E-02/C-03 三模态 + C6 e2e
  修 admin/catalog e2e 失败产物
  E-03/04 假 assetId + legacy panel 退旧

Batch 4（收敛债）
  S1-03 报价唯一属主收口
  B-04 estimated re-settle
  A-02 Brief 过触发
  P2 卫生项
```

合并纪律（沿 handoff）：每票独立分支 `ticket/<n>-<slug>`；绿门后再合；同文件域不并发。

---

## 6. 建议验收命令（修复后）

```bash
# Contracts 诚实边界
pnpm --filter @meiye/contracts test

# Core 合同 + 模块
pnpm --filter @meiye/core test
# 持久层（双库）
./scripts/ci/provision-test-db.sh
# 再跑 *.postgres.test.ts 相关 job

# Web 纯模型 + RTL
pnpm --filter web test

# 三模态全旅程（须诚实中间态）
pnpm --filter web e2e -- tests/e2e/specs/ui-journey-three-modal.spec.ts

# 关联失败产物复跑
pnpm --filter web e2e -- tests/e2e/specs/admin-creation-experience-lifecycle.spec.ts
pnpm --filter web e2e -- tests/e2e/specs/catalog-live-navigation.spec.ts
```

**通过标准**（全部满足才可宣称 UI Journey 包 complete）：

1. P0 表 10 项全部 CLOSED，且有回归测试  
2. 三模态 e2e 绿，且证据含 running 或可审计 fast-path  
3. 视频 download 完整包 = ZIP + manifest/v1，revision 非 0  
4. contracts public 序列化禁词测绿  
5. browser catalog 永不返回 draft head  

---

## 7. 与历史报告关系

| 报告 | 关系 |
|---|---|
| `agent-team-full-project-deep-review-2026-07-19.md` | 全项目旧快照；D-042 等已被后续取代 |
| `ui-journey-decisions-xcheck-2026-07-20.md` | 决策块交叉复核；本报告审的是 **实现** |
| `.scratch/ui-journey-spec-review-2026-07-20/` | Spec 两路 Codex；本报告对照 **合入后代码** |
| 本报告 | **实现后** Agent Team 深度 review + 修复清单 |

---

## 8. 附录：分路分数卡

```
S1 ████████░░ 6.5  属主✅ 诚实类型❌
A  █████████░ 7.5  聚合✅ browser draft❌
B  ████████░░ 6.6  算法✅ 视频包主路径❌
C  █████████░ 7.4  模型✅ C4 confirm 洞
D  ████████░░ 6.8  Shell✅ token live❌
E/Z█████████░ 7.4  派生✅ durable 查询❌
────────────────────
综合 ~7.0 / 10 · Amber · 可 dogfood · 不可宣称全绿
```

---

## 9. 主会话对抗核验记录

| 抽验项 | Agent 声称 | 主会话结果 |
|---|---|---|
| product-quote Deployment 字段 | P0 | **CONFIRMED** `product-quote.ts:101-102` |
| browser get*Head | P0 | **CONFIRMED** `catalog-service.ts:626-647` |
| restricted sourceIds | P1 | **CONFIRMED** `foundation-module.ts:308` |
| export 视频单 MP4 | P0 | **CONFIRMED** adapter:183-217；full pack 仅 test |
| token 流未接线 | P0 | **CONFIRMED** route 0 hits |
| video_confirm 放行 | P0 | **CONFIRMED** composer-home:686,782 |
| settle 无 trusted 吃 ceiling | P1 | **CONFIRMED** quote-service:593-596 |
| Composer 主入口 | Strength | **CONFIRMED** dashboard/index.tsx |
| Z1 workbench 删除 | Strength | **CONFIRMED** static test + files absent |
| 三模态 e2e 失败产物 | P0 诚实性 | **CONFIRMED** test-results error-context |

**结论**：6 路 Agent 的 P0 级发现经主会话抽验 **无一条虚假**；本报告修复优先级可直接作为下一波 `ticket/*` 拆票输入。

---

*Generated by Agent Team deep review · HEAD `992fa71` · 2026-07-21*
