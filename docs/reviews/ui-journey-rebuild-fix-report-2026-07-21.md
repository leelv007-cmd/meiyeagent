# UI Journey Rebuild · Review 修复完成报告（2026-07-21）

> **分支**：`fix/ui-journey-review-findings-2026-07-21-v2`（基于 main `240161e`）  
> **权威输入**：`docs/reviews/ui-journey-rebuild-agent-team-deep-review-2026-07-21.md`  
> **方法**：Agent Team 分 Batch 0/1/2 并行 + 主会话 P1/测试适配 + 目标测试门禁  
> **状态**：P0 10 项 + 关键 P1 已落地；未宣称三模态 e2e 全绿（E-02 为 fixture 诚实化，未跑完整 Playwright 三模态）

---

## 0. 一句话

按 deep-review 的 Must-Fix 表，在独立修复分支完成 **诚实边界 / 视频完整包 / Composer 视频确认 / Result token 流与套图闸门 / video public-only** 等 P0，并补 **A-02/A-03/A-04/B-07** 等高价值 P1；目标单测门禁绿。

---

## 1. P0 闭环表

| # | ID | 状态 | 关键改动 | 验收证据 |
|---|---|---|---|---|
| 1 | S1-01/02 Public quote 去 Deployment | **CLOSED** | `packages/contracts` `PublicProductQuoteSnapshot` + `toPublicProductQuoteSnapshot` + 禁词测；core re-export | contracts 55/55 含禁词测 |
| 2 | A-01 browser catalog published-only | **CLOSED** | `catalog-service` 默认 `latestPublished*`；非 published → NOT_FOUND | catalog-service 10/10 |
| 3 | B-01 视频 full ZIP 主路径 | **CLOSED** | `export()` → `exportVideoFullPackage` | export-adapter + video-content-package 22/22 |
| 4 | B-02 manifest revision 强制 | **CLOSED** | `resolveContentPackageRevision` 缺则 throw；`exportContentPackage` 传 `package.revision` | 缺 revision 拒绝用例绿 |
| 5 | C-01 视频提交确认洞 | **CLOSED** | `decideSubmitPath.videoConfirmRequired`；video 禁 bare `runCreate` | brief-surface 新用例 |
| 6 | D-01 token 流 live | **CLOSED** | `$workId` 接线 `useCopyCandidateStream` + `partialCandidates`/`streamLoading` | static wiring 门禁 |
| 7 | D-02 wholeSetAdopt 闸门 | **CLOSED** | rejected 时 primary disable + early return | interaction 11/11 |
| 8 | D-03 套图漂移三选一 | **CLOSED** | hydrate 产 drift UI restore/compare/discard | interaction + reducer 测 |
| 9 | E-01 video durable 查询泄漏 | **CLOSED** | foundation 查询强制 `projectVideoWorkflowPublic`；web list/panel 对齐 public | composed-video 39/39；web 43/43 |
| 10 | E-02 三模态 e2e 诚实性 | **PARTIAL** | `waitForResultJourney` 区分 intermediate running vs auditable fast-path | fixture 诚实化；**未跑完整 e2e** |

---

## 2. 额外完成（P1 / 连带）

| ID | 状态 | 摘要 |
|---|---|---|
| C-02 | **CLOSED** | Surface 失败 → `listColdCardsFromSeeds` |
| E-03 | **CLOSED** | 去掉假 `shot-asset-*`；`assetId` optional |
| E-04 | **CLOSED** | VideoWorkflowPanel 切 public projection；成片回 Result Center |
| A-02 | **CLOSED** | 仅真权利信号才 restricted，不再 `sourceIds.length>0` |
| A-03 | **CLOSED** | `recipe_patch_preview` 仅 published |
| A-04 | **CLOSED** | `recipe_draft` 命令 strip `hiddenPromptBody` |
| B-07 | **CLOSED** | `beforeSubmit` 禁 quoted 自动 confirm；仅 confirmed\|reserved |

**未做（明确延后）**

- S1-03 三套报价全收敛、OCC revision 统一、ToolHandoff 入 contracts  
- B-03/04/06 settle providerCost 全对齐、estimated re-settle、inbox 单投影  
- C-03 C6 点击预算自动化全覆盖  
- 完整三模态 Playwright 绿门（需本地 e2e 环境）  
- P2 卫生项（float micros、model_video_workflows drop 等）

---

## 3. 测试门禁（本分支已跑）

```text
pnpm --filter @meiye/contracts test                          → 55 pass
apps/core: catalog + foundation + lifecycle + export adapters → 46 pass
mkfast-template pure (composer/results/video/observer/panel) → 109 pass
vitest image-role-feedback.interaction                        → 11 pass
```

**未跑**：全量 core test、postgres 双库、`ui-journey-three-modal` e2e。

---

## 4. 关键文件索引

**Contracts / Core**

- `packages/contracts/src/product-quote.ts` + `product-quote.test.ts`
- `apps/core/src/p1/product-billing/server-quote-authority.ts`
- `apps/core/src/p1/product-billing/lifecycle-port.ts` + durable-service
- `apps/core/src/p1/creation-experience/catalog-service.ts` + foundation-module
- `apps/core/src/p1/model-supply/foundation-module.ts`
- `apps/core/src/p1/operations/content-package-export-adapter.ts` + content-package + application-service

**Web**

- `composer/composer-home.tsx` + `brief-surface.ts`
- `routes/dashboard/results_/$workId.tsx`
- `results/image-worksurface.tsx` + video-worksurface-model
- `creative-job-observer.ts` + async-task-center-model + video-workflow-panel
- `tests/e2e/fixtures/ui-journey.ts`

---

## 5. 宣称边界（修复后）

| 可宣称 | 不可宣称 |
|---|---|
| Public quote 合同层已 strip Deployment 字段 + 禁词测 | 三模态 e2e 已全绿 |
| Browser catalog 永不返回 draft head | token stream 已自动 submit 并产生 first token（route 已接线，submit 仍待完整 CopyStreamRequest 装配） |
| 视频 export 主路径 = ZIP + manifest/v1 + 真实 revision | 所有 P1/P2 债已清 |
| 视频无 accept 不可 bare create | #84–#105 票面全部 complete |
| video 浏览器查询 public-only | |

---

## 6. 建议后续

1. 在 e2e 环境跑 `ui-journey-three-modal` + admin/catalog 失败产物复验  
2. 补 copy stream `submit()` 装配（catalogModelId / contract / submissionKey）  
3. 开独立 ticket 做 B-04 estimated re-settle、inbox 单投影、报价属主收口  

---

*Agent Team fix run · branch `fix/ui-journey-review-findings-2026-07-21-v2` · 2026-07-21*
