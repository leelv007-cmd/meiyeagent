# UI/用户旅程重建 Worktree Handoff（2026-07-20）

> 状态：**开放中的交付编排**。权威链：设计文档 D-072~D-098（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`）> spec issue #83 / `docs/specs/ui-journey-rebuild-spec-2026-07-20.md` > 各票（#84-#105）。复核链：`docs/reviews/ui-journey-decisions-xcheck-2026-07-20.md`（七路交叉复核+C1~C7 处置）+ `.scratch/ui-journey-spec-review-2026-07-20/`（Codex 两路 31 条全采纳）+ 一致性双复核。票号映射 `.scratch/ui-journey-tickets-2026-07-20/issue-numbers.json`。

## 分线与认领序列

| 线 | 认领序列 | 分支建议 | 一句话职责 |
|---|---|---|---|
| WT-0 卫生与测试基建 | #84 → #85 → #86（三票互不阻塞可并发） | `lane/hygiene` | CI 真机清障（GL-25/26）、V1 C6 口径重立、Vitest+RTL 基建 |
| S1 contract-spine | #87（唯一前置，整合属主执行） | `lane/contract-spine` | 四合同属主（creation-experience/product-quote/result-center/video-workflow）+ 共享文件冻结宣告 |
| WT-A 创作配置合同（core） | #88 → #89 / #90 | `lane/creation-experience` | Catalog 发布聚合、首发种子+PatchPreview、条件 Brief projection+事件 revision |
| WT-B 计费交付通知合同（core） | #91 / #92 / #93 → #94 | `lane/billing-delivery` | adoption OCC、QuoteSnapshot 按秒结算、manifest/assisted、inbox/Recent/resolver |
| WT-C 首屏 Composer（前端） | #95 → #96 → #97 / #98 | `lane/composer` | lens 状态机、六卡、移动+目录+工具、条件 Brief UI+GL-23（含提交时视频确认区） |
| WT-D 结果中心（前端） | #99 → #100 / #101 | `lane/result-center` | Shell+路由+token 流式、文案图文与图片工作面、交付面板 |
| WT-E 视频线（跨栈窄切） | #102 → #103 → #104 | `lane/video` | VideoWorkflow 派生化（实质重构）、regeneration 确认结算、视频工作面 |
| Z 收尾 cutover | #105（C/D/E 三线全绿后） | `lane/cutover` | 退旧（含视频面旧分支）+ V1 全量门 + 三模态全旅程 e2e |

## 依赖图（阻塞边）

```
WT-0(#84/#85/#86) ∥ S1(#87)
S1 → A1(#88) → A2(#89), A3(#90)
S1 → B1(#91), B2(#92), B3(#93) → B4(#94)
A2+B2+#86 → C1(#95) → C2(#96) → C3(#97)；A3+C1 → C4(#98)
S1+B4 → D1(#99)；B1+D1+#86 → D2(#100)；B3+D1 → D3(#101)
S1 → E1(#102)；A3+B2+E1 → E2(#103)；E1+E2+D1(合同) → E3(#104)
C3+C4+D2+D3+E3 → Z1(#105)
```

合并顺序：`WT-0 ∥ S1 → A/B 并行 → C/D1/E1 → C 系/D2/D3/E2/E3 → Z1`。
关键裁决（cons-global P1）：Composer **提交时**视频确认 UI 归 **C4**（消费 product-quote 合同渲染）；WT-E 只做工作面内 regeneration 确认；故 E 前端仅依赖 D1 合同，无 C 边。

## 每票分支纪律 + 建议执行顺序（2026-07-20 增补，防并发冲突）

**分支纪律（硬规则）**：
1. **每一票都从最新 `main` 新建独立分支执行**，命名 `ticket/<issue号>-<短slug>`（如 `ticket/88-catalog-aggregate`）；上表「分支建议」列的 `lane/*` 只作分组参考，**不建长活共享 lane 分支**。
2. 合并前必须在票分支上跑过该票验收节声明的测试门（core 侧 `pnpm --filter @meiye/core test`+typecheck，涉持久层加双库真机；前端 `pnpm --filter web test`，涉 e2e 跑相关 spec）——**绿了才发 PR/合并，合并后删分支**。
3. 开工前先 `git pull` 最新 main 再切分支；长票每日 rebase main，避免大漂移。
4. **同一文件域同一时间只允许一票在飞**（同线内串行）；不同文件域的票才并发。冻结清单文件任何票不碰，接线走整合属主。

**建议执行顺序**（S1 #87 已交付 ✅；同一行内可并发，行间为推荐先后；被阻塞票以依赖图为准）：

| 步 | 领票 | 说明 |
|---|---|---|
| 1 | #84 / #85 / #86（WT-0）∥ #88（A1）∥ #91（B1）∥ #102（E1） | 四个不同文件域并发；⚠️ #102 大改 `model-supply/index.ts` 前，先让 AP/MP 包 S2a(#107) 合入（同文件不同段，S2a 快票先行） |
| 2 | #89 → #90（A 线串行）∥ #92 → #93 → #94（B 线串行） | A/B 线内一票一分支依次合入 |
| 3 | #95（C1，等 A2+B2+#86）∥ #99（D1，等 B4） | 前端两线起步 |
| 4 | #96 → #97 / #98（C 线）∥ #100 / #101（D 线）∥ #103（E2，等 A3+B2） | C/D/E 三线文件域互斥可并发，线内串行 |
| 5 | #104（E3） | |
| 6 | #105（Z1 cutover） | C/D/E 全绿后 |

## 属主边界（文件域）

完整 glob 清单见 `.scratch/ui-journey-spec-review-2026-07-20/lane2-reality.md` 属主节（本表为摘要，冲突时以该节为准）：

- **WT-0**：`scripts/ci/`、CI workflow、e2e 断言文件、`p1/harness/delivery.postgres.test.ts` + `postgres-store.ts` 窄 hunk（仅 GL-25）、Vitest 配置与样例。
- **WT-A**：`apps/core/src/p1/creation-experience/**`(new) + `packages/contracts/src/creation-experience.ts`(new)；admin-config 只读参考。
- **WT-B**：`p1/product-billing/**`(new)、`p1/result-delivery/**`(new)、`p1/pending-actions*`、`operations/content-package*`、contracts `product-quote`(new)/`content-package`/`actionable-inbox`(new)。
- **WT-C**：`src/product/composer/**`(new)、creation-entry/creation-catalog-model/creative-quote 系、`routes/dashboard/index.tsx`（**C 唯一属主**）、全屏目录新 route、Creation Experience 薄 BFF。
- **WT-D**：`src/product/results/**`(new)、`routes/dashboard/results_/$workId.tsx`(new)、workbench-state-model/copy-candidate/copy-stream 系、`handoff/$token.tsx`、content-package-detail（仅退重复动作）。
- **WT-E**：`model-supply/composed-video-workflow*`、`video-workflow-contract.ts`(S1 抽出后 E 独占)、`video-content-package-port.ts`、contracts `video-workflow`(new)、前端 `video-workflow-*`、`src/product/results/video/**`(new)。

**共享冻结清单（并行期仅 Z 票/唯一整合属主可改）**：`operations/application-service.ts`、`operations/foundation-module.ts`、`operations/types.ts`、`operations/repository.ts`、`operations/postgres-repository.ts`、`apps/core/src/main.ts`、`packages/contracts/src/index.ts`、`packages/contracts/src/uiux.ts`、`unified-creation-workbench.tsx`、`mobile-action-book.tsx`。`routeTree.gen.ts` 仅生成永不手改。A/B 禁止向 OperationsApplicationService 塞新方法（各建独立 FoundationModule，整合票薄接线）。

### S1 delivered — contract spine + freeze matrix (#87, 2026-07-20)

权威细表：`docs/handoff/contract-spine-freeze-2026-07-20.md`。摘要如下。

| Module | Owner lane | File path |
|---|---|---|
| creation-experience | WT-A exclusive | `packages/contracts/src/creation-experience.ts` |
| product-quote | WT-B exclusive | `packages/contracts/src/product-quote.ts` |
| result-center | WT-D1 owner (C/E consumers) | `packages/contracts/src/result-center.ts` — nav `{workId, returnToDraftKey, focusKey}` |
| video-workflow (public) | WT-E exclusive | `packages/contracts/src/video-workflow.ts` (projection only) |
| video-workflow-contract (durable) | WT-E after S1 extract | `apps/core/src/p1/model-supply/video-workflow-contract.ts` (pure types; re-exported from `model-supply/index.ts`) |

**Shared freeze list (integration owner only during parallel period)**

| Path | Note |
|---|---|
| `operations/application-service.ts` | operations 五件套 |
| `operations/foundation-module.ts` | |
| `operations/types.ts` | |
| `operations/repository.ts` | |
| `operations/postgres-repository.ts` | |
| `apps/core/src/main.ts` | thin wiring only via integration |
| `packages/contracts/src/index.ts` | re-export surface; S1 already touched |
| `packages/contracts/src/uiux.ts` | |
| `unified-creation-workbench.tsx` | frozen container |
| `mobile-action-book.tsx` | frozen container |
| `routeTree.gen.ts` | generate-only, never hand-edit |

**Cross-pack freeze addendum (document only; do not rewrite those files in feature lanes)**：`mkfast-template-main/src/lib/routes.ts`、sidebar configs/layouts、`project.inlang/messages/{zh,en}.json` — see 跨包接缝增补 below.

**A/B wiring discipline**：A/B must create independent `FoundationModule`s; **no new methods** on `OperationsApplicationService`. Integration tickets do thin wiring only.

### 跨包接缝增补（AP/MP 补足包，2026-07-20，双向确认）

AP/MP 补足包（spec `docs/specs/admin-supply-control-spec-2026-07-20.md`）与本包并行开发，以下为**双向生效**的跨包属主约定：

1. **共享冻结清单扩充（前端接线面）**：`mkfast-template-main/src/lib/routes.ts`、sidebar 配置与布局（`config/sidebar-config.ts`、`components/layout/sidebar-main.tsx`/`dashboard-sidebar.tsx`/`sidebar-user.tsx`）、`project.inlang/messages/{zh,en}.json` 加入并行期共享冻结：两包各线只交付业务文件+接线 diff 说明，由**跨包同一整合属主**（=执行 S1(#87) 与 AP/MP S2a 的同一属主纪律）合入；`routeTree.gen.ts` 口径不变（仅生成）。
2. **S1 冻结文件的 AP/MP 兼容迁出**：`packages/contracts/src/uiux.ts`/`index.ts` 中 `productCapabilities`/`requiredP1Capability` 无行为迁出到 `capability-permission.ts`（AP/MP S2a）属冻结文件修改，仅由上述同一整合属主执行，其余票不碰。
3. **`publication.handoff` 分工反向确认**：capability permission key 注册表属 AP/MP 包（contracts `capability-permission`，其 WT-K 演进）；本包（#83）的 `publication.handoff` 权限映射为该注册表**消费者**，不在本包内另建/另改注册表。
4. **账本/收件箱/视频属主不变**：ProductUsage 预占结算与 ProductQuoteSnapshot=#92、ActionableInboxItem=#94、VideoWorkflow 派生化=#102；AP/MP 包只消费（其异常首页阻塞 #94，其 MP-04V 阻塞 #102 E1，其 H2 结算字段消费 #92）。#94 交付时需连带解除 pending-actions 的 harness runtime 条件装配（或明确移交 AP/MP Z2-WIRING 执行）。

## 全局规则（各线通用）

1. 跨线接口一律走 contracts 包类型 + HTTP 合同测试，不允许跨 worktree import 对方未合入代码；跨入口上下文走 typed ToolHandoff/result-center 合同（`{workId, returnToDraftKey, focusKey}`）。
2. D-098 收窄红线：灰度机器/自动发布状态机/Lens-Tool 发布生命周期/anchor 写路径/搜索实现/浏览器通知均不建；发现票面要求越界即回 spec 对照。
3. 诚实纪律：不显示 Provider/Deployment/Credential/fallback（序列化测试锁定）；"已交接"≠"已发布"；缺可信 usage 保持 estimated/unknown。
4. 退旧纪律：含视频面的旧 workbench 结果分支物理删除只在 Z1（三媒介新面齐备后退旧，D-098 C1）；并行期间旧面冻结不加码。
5. Commit message 英文；不擅自 git push；每票独立 PR 不攒大分支，合入即通知被解锁的线。
6. 三个"看似改名实为重构"的坑位已显式立项：VideoWorkflow 派生化（#102）、handoff 页 canonical 化（#101 内）、copy.adapt 与客户端拼接双轨收敛（#100 内）。
7. **调研/参考优先检索仓内既有资料**：需要相关调研、竞品对照、组件比选、历史决策依据时，先检索 `/Users/bin/Desktop/开发/内容无人区/美业内容2/references/`（KickArt/小云雀等范式参考、上游源码镜像、harness 调研等）与 `/Users/bin/Desktop/开发/内容无人区/美业内容2/docs/`（设计决策、spec、评审报告），再考虑外部检索——大部分选型与边界已有落盘结论，重复外查既浪费也易与已拍板口径冲突。

## 验收环境

- Core 持久层：`./scripts/ci/provision-test-db.sh` 双库（业务 + DBOS system，禁止同库）；**#84 合入前 fresh provision 环境存在两处已知红（GL-25/26），以 #84 为准绳**。
- 前端：`pnpm --filter web test`（node:test 纯模型）+ Vitest/RTL（#86 落地后）+ `pnpm --filter web e2e`（Playwright 四服务真启动，先例 `tests/e2e/specs/uiux-day0-contract.spec.ts`）。
- 点击计数口径（D-098 C6）：普通模板 2 击 / 纯文本 2 击 / 视频 +Brief 确认一次；V1 门断言见 #85。
