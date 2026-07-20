# AP/MP 补足包 Worktree Handoff（2026-07-20）

> 状态：**开放中的交付编排**。权威链：设计文档 D-048~D-071 + D-080 六项处置（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`）> spec issue #106 / `docs/specs/admin-supply-control-spec-2026-07-20.md` > 各票（#107-#128）。复核链：`docs/reviews/admin-supply-decisions-xcheck-2026-07-20.md` + 本包双路 Codex 复核与双路一致性复核（`.scratch/admin-supply-spec-review-2026-07-20/`，38+9 条全落地）。票号映射 `.scratch/admin-supply-tickets-2026-07-20/issue-numbers.json`。
>
> **与 #83 包（#84-#105）并行开发**：跨包属主与冻结纪律见 `ui-journey-rebuild-handoff-2026-07-20.md`「跨包接缝增补」节（双向确认）；本包只消费 #92（ProductUsage/报价）、#94（ActionableInboxItem+pending-actions 无条件化）、#102（VideoWorkflow 派生化）、#87（S1 冻结清单）。

## 分线与认领序列

| 线 | 认领序列 | 分支建议 | 一句话职责 |
|---|---|---|---|
| S2 spine（整合属主执行） | #107(S2a) → #108(S2b) | `lane/ap-spine` | contracts 三件套+model-supply 无行为抽取+capability inventory；RouteSnapshot 四形规范化 |
| WT-G 供应核心 | #109 → #110/#112 → #111/#113 | `lane/supply-core` | registry expand/migrate、CredentialAccount+secret broker、热装配 domain、RoutePolicy+overlay、数据政策+排序 |
| WT-H 权益与池 | #114 → #115 | `lane/entitlement-pools` | EntitlementPolicy 扩展+AccountAllocation；SupplyPool+三层容量+供应侧账本字段 |
| WT-I 三模态 conformance | #116/#117（合同侧先行）→ #118 → #119 | `lane/provider-conformance` | MP-04T/I/V conformance（缺口=health/drain/跨进程 recover/late-terminal）+MP-08 故障注入矩阵 |
| WT-K 权限合同（单票） | #120 | `lane/capability-permission` | key 注册表+默认拒绝+审计；enforcement 只改 server.ts 集中授权点 |
| WT-J 管理台前端 | #121 → #122/#123 → #124 → #125/#126 | `lane/admin-console` | capability 骨架、异常首页（阻塞 #94）、目录编组、供应控制中心、凭据/模拟器/快捷动作、Cloudflare 只读 |
| Z2 收尾 | #127(WIRING 批A/批B) → #128(ACCEPT) | `lane/ap-wiring` / `lane/ap-accept` | 唯一接线属主（main/job-worker/runtime-assembly/前端共享面）；同一增量整体验收 |

## 依赖图（阻塞边）

```
#87/S1 → S2a(#107) → S2b(#108) ∥ K1(#120) ∥ H1(#114)
S2a+S2b → G1(#109) → G2(#110)/G4(#112) → G3(#111)/G5(#113)
S2a → I1(#116)/I2(#117) 合同侧先行；运行时接入等 G3+Z2-WIRING(#127 批A)
H2(#115) ← H1+G1+S2b+#92(B2)
J1(#121) ← S2a+K1；J2(#122) ← J1+#94；J3(#123) ← J1
J4(#124) ← J1+G1+G4+H1；J5(#125) ← J4+G2+G3+K1；J6(#126) ← J1
I3(#118) ← I2+#102(E1)；I4(#119) ← I1+I2+I3+G4+Z2-WIRING(批A)
Z2-WIRING(#127) ← G3+H2+K1+S2b（批A）/ J1-J3（批B）
Z2-ACCEPT(#128) ← 全部
```

合并顺序：`S2a → S2b/K1/H1 → G1 → G2/G4 → G3/G5 ∥ J1-J3 ∥ I1/I2(合同) → Z2-WIRING → J4-J6/I3 → I4 → Z2-ACCEPT`。

## 每票分支纪律 + 建议执行顺序（防并发冲突）

**分支纪律（硬规则，与 #83 包同口径）**：
1. **每一票都从最新 `main` 新建独立分支执行**，命名 `ticket/<issue号>-<短slug>`（如 `ticket/107-s2a-contract-extract`）；上表「分支建议」列的 `lane/*` 只作分组参考，**不建长活共享 lane 分支**。
2. 合并前在票分支跑过该票验收节声明的测试门（core 真机含双库；供应商 live 测试按 env 开闸）——**绿了才发 PR/合并，合并后删分支**。
3. 开工前 `git pull` 最新 main 再切分支；长票每日 rebase；同一文件域同一时间只允许一票在飞（线内串行），不同文件域才并发；冻结/共享文件一律不碰，接线走 Z2-WIRING/跨包整合属主。

**建议执行顺序**（同一行内可并发，行间为推荐先后）：

| 步 | 领票 | 说明 |
|---|---|---|
| 1 | #107（S2a） | 全包唯一入口，整合属主执行；**应赶在 #102(E1) 大改 `model-supply/index.ts` 之前合入**（同文件不同段，先到先合、后者 rebase） |
| 2 | #108（S2b）∥ #120（K1）∥ #114（H1） | 三票文件域互斥可并发；单人执行推荐 S2b→K1→H1（S2b 解锁面最大） |
| 3 | #109（G1） | 等 S2a+S2b |
| 4 | #110（G2）→ #111（G3）∥ #112（G4）→ #113（G5） | G 线内两条子链；G2→G3 与 G4→G5 文件域基本互斥可交错，稳妥则全串行 |
| 5 | #116（I1）∥ #117（I2）合同侧 ∥ #121（J1）→ #123（J3） | I 与 J 文件域互斥；J2(#122) 等 #94 到位后随时插入 |
| 6 | #115（H2） | 等 H1+G1+S2b+#92(B2) |
| 7 | #127（Z2-WIRING）批A → 批B | 批A 等 G3/H2/K1；批B 收编 J1-J3 的接线 diff |
| 8 | #124（J4）→ #125（J5）∥ #126（J6）∥ #118（I3，等 #102 E1） | |
| 9 | #119（I4） | 等 I1-I3+G4+Z2-WIRING 批A，跑真机故障注入矩阵 |
| 10 | #128（Z2-ACCEPT） | 全部合入后整体验收 |

## 属主边界（文件域）

**完整 glob 清单权威=`.scratch/admin-supply-spec-review-2026-07-20/lane2-reality.md` §属主文件清单建议**（本表为摘要，冲突时以该节为准）：

- **S2a**：contracts `capability-registry.ts`/`supply-registry.ts`/`capability-permission.ts`（新）；`model-supply/` 五个抽取文件（supply-contracts/route-contracts/provider-lifecycle/ledger-contracts/route-planning，新）；`index.ts` 仅无行为抽取+re-export。**冻结文件（`uiux.ts`/`contracts/index.ts`）修改仅由跨包同一整合属主执行**。
- **S2b**：`foundation/domain.ts`、`foundation-ledger.ts`（仅快照转换段，合入后移交 Z2-WIRING）、`integrations/contracts.ts`、`integrations/foundation-byok-ledger.ts`+tests。
- **WT-G**：`p1/supply-registry/**`（新）；S2 后独占 `catalog.ts`、`foundation-module.ts` 供应 hunk（建议抽 `supply-control-plane.ts`）、`provider-credential-runtime.ts` 迁移适配器。**禁**：main/job-worker/runtime-assembly/runtime-config/视频文件。
- **WT-H**：`p1/entitlement-pools/**`（新）；独占扩展 `entitlement-policy*`、`entitlement-service.ts`（resolver）、`p1-model-policy.ts`、`entitlement-job-port.ts`（只传 projection）；`grant-lot*` 窄扩展。**禁**：`foundation-ledger.ts`（Z2-WIRING）、ProductUsage 合同（#92）。
- **WT-I**：ark/tuzi/volcengine 系列、`activation-probe-executor*`、`live-*.integration.test.ts`、新 `provider-conformance/**`；`adapters.ts` 先抽后改。**禁**：catalog/domain/ledger/接线/视频段（`index.ts:3053-4780`+`composed-video-workflow*`=#102 WT-E 独占）。
- **WT-K**：`p1/capability-permission/**`（新）、`contracts/capability-permission.ts`（S2a 定 shape 后 K 加 key）、`server.ts` authorize 段+contract tests。**禁**：operations 五件套、各 FoundationModule action switch、main.ts。
- **WT-J**：`components/admin/{capability,supply,entitlements}/**`（新）、`p1/admin-{capability,supply,entitlement,cloudflare,exception}-*`（新）、admin routes+tests。**与 #83 WT-C/WT-D 业务 glob 零交集**（composer/results/dashboard index 不碰）。共享接线面（`lib/routes.ts`/sidebar/locales/routeTree）只交 diff 说明。
- **Z2-WIRING**：批A=`main.ts`/`job-worker.ts`/`runtime-assembly.ts`/`runtime-config.ts`/`foundation-ledger.ts`（S2b 后）/`server.ts` 模块接线/migration 注册；批B=前端共享接线面（跨包冻结增补，经跨包同一整合属主）。

## 全局规则（各线通用）

1. 跨线/跨包接口一律 contracts 类型+HTTP 合同测试；不跨 worktree import 未合入代码。
2. **防双建红线**（spec 现状基线节 15 条为准）：不建第二 secret vault、第二 catalog、第四份 cooldown map、平行 EntitlementPolicy port、第二收件箱；GrantLot/ProductUsage/ProviderCost 三链永不合并；三个"capability"概念类型名互斥。
3. 诚实纪律：`not_instrumented`/`not_verified` 显式；recorded≠生产事实；estimate 带风险折扣；单通道标 no-fallback；unknown 成本不伪装零。
4. D-080 红线：无 ack/assign/incident 持久化；无传播引擎；无 CF GraphQL broker（只读 REST 盘点**在** scope）；凭据三态主干；C5 双渠道门不打折。
5. Commit message 英文；不擅自 git push；每票独立 PR；合入即通知被解锁线。
6. 同一增量纪律：AP 骨架与 MP 纵向合并验收（#128），任何一侧单独宣称完成无效。
7. **调研/参考优先检索仓内既有资料**：需要相关调研、竞品对照、组件比选、历史决策依据时，先检索 `/Users/bin/Desktop/开发/内容无人区/美业内容2/references/`（供应商控制面比选、网关组件研究、harness 调研、上游源码镜像等）与 `/Users/bin/Desktop/开发/内容无人区/美业内容2/docs/`（设计决策、spec、评审报告），再考虑外部检索——大部分选型与边界已有落盘结论，重复外查既浪费也易与已拍板口径冲突。

## 验收环境

- **双渠道测试模型矩阵（2026-07-20 拍定，I1-I4/C5 门用；凭据一律走 `.env`/`docs/_private/`，永不进票和文档正文）**：

| 模态 | official_direct（火山方舟） | upstream_reseller（tuzi 中转） |
|---|---|---|
| 文本 | `doubao-seed-2-0-mini-260428`（env `ARK_TEXT_MODEL`；首调 2026-07-20 PASSED） | `gemini-3-flash-preview`（env `MODEL_DIRECT_*`，probe PASSED 07-14） |
| 图片 | `doubao-seedream-5-0-260128`（env `ARK_SEEDREAM_MODEL`；⚠️ 哥口径 5.0-lite 账号列表无此模型，暂用标准版待确认） | `doubao-seedream-4-5-251128`（env `TUZI_GPT_IMAGE_2_MODEL`） |
| 视频 | `doubao-seedance-1-5-pro-251215`（env `ARK_SEEDANCE_MODEL`；⚠️ 状态 Retiring 仍可用，现役备选 `doubao-seedance-2-0-260128`） | `doubao-seedance-1-5-pro_720p`（env `TUZI_SEEDANCE_MODEL`） |

  凭据落点：方舟=`docs/_private/ark.env`+根 `.env` ARK 块（均 gitignored）；tuzi=`docs/_private/tuzi.env`。⚠️ 两渠道视频同为 Seedance 1.5 系（共享制造商），按 D-069 只可声称**渠道级容灾**，不算独立故障域的制造商级双供应——I4 的 C5 门若需制造商级独立性，视频侧需引入第三家或以此口径明示标注。

  **代码落点（I4 / MP-08）**：机器可读矩阵 = `apps/core/src/p1/model-supply/provider-conformance/fault-injection/matrix-models.ts`（`DUAL_CHANNEL_MATRIX_MODELS`）；故障注入四场景 = `fault-injection/matrix.ts`；发布门（<2 合格故障域不得标 multi-channel ready）= `fault-injection/publish-gate.ts`；次级 operation 单通道标签 `single-channel/no-fallback` = `fault-injection/channel-label.ts`。
- Core 持久层：`./scripts/ci/provision-test-db.sh` 双库（业务+DBOS system）；`pnpm --filter @meiye/core test`+typecheck。
- 供应商真机：`live-*.integration.test.ts`+env 显式开闸；**live matrix 走独立受保护 CI workflow（`.github/workflows/provider-live.yml`，manual/scheduled + `environment: provider-live` secrets + `PROVIDER_LIVE_COST_CAP_USD`），不复用 core-persistence**。开闸 env=`RUN_PROVIDER_LIVE_FAULT_INJECTION=1`。
- 前端：node:test 纯模型+SSR（现状）；#86 落地后 RTL；Playwright e2e 四服务真启动（异常首页→下钻→快捷动作→审计闭环；D-048 交互禁令断言）。
