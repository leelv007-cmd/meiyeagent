# AP/MP 补足包 Agent Team 深度 Review 与修复报告（2026-07-21）

> **状态：活文档 · 代码审查快照。** 本报告对 `992fa71`（`main`，`merge: admin supply completion into UI journey main`）做只读深度 review；**未改业务代码**。  
> 权威链：`docs/handoff/admin-supply-handoff-2026-07-20.md` → `docs/specs/admin-supply-control-spec-2026-07-20.md`（D-048~D-071 + D-080）→ 票 #107–#128 → 既有审计 `admin-supply-ticket-completion-audit-2026-07-20.md` + gap `docs/evidence/admin-supply-accept-gaps-2026-07-20.md`。  
> **不作为完成证据**：默认 `pnpm test` 全绿、fixture/recorded 矩阵 alone、GitHub issue 开闭。

**HEAD**: `992fa71`（`main`，相对 `origin/main` ahead ~381）  
**方法**: 6 路并行 Agent Team（S2 合同脊柱 / G 供应核心 / H 权益池 / I 三模态 conformance / KZ 权限+接线+安全 / J 管理台前端）+ 主会话对抗核验关键路径  
**对照**: handoff 属主边界、防双建 15 条、D-080 六项、诚实纪律

---

## 0. 一句话裁决

**代码层 AP/MP 骨架与供应纵向已合入 main，且多数票面实现与 unit/recorded 门扎实；但不得宣称 #128 整包完成或生产 C5 multi-channel ready。** 主会话确认至少 **1 条 P0**（凭据轮换 pending 窗口掐断 in-flight 冻结版本装配）与若干会假绿/假完成的 P1，需优先修复后再谈发布口径。

| 维度 | 分 | 一句话 |
|---|---:|---|
| S2 合同脊柱 / RouteSnapshot | **6.8** | 适配器与 ledger 主路径在；「单一权威类型」过宣称；fallback policy 双读分叉真问题 |
| WT-G 供应核心 | **7.2** | 单 vault/expand、overlay PG、RoutePolicy CAS、热装配共读能力头扎实；P0 冻结装配 + DataPolicy 无 binding fail-open |
| WT-H 权益与池 | **8.1** | 双真相/三链分离/shared-dedicated 不互退/PG fair-queue 正确；fair 占坑与 RPM/TPM 死字段是 P1 |
| WT-I 三模态 + 故障注入 | **7.2** | 生产禁重提与 publish-gate 真；unit dualChannelReady 可跨 CatalogModel 假绿；live C5 不可宣称 |
| WT-K + Z2 接线 + 安全 | **8.2** | 默认拒绝/CF 只读/双进程 migration/pending-actions 无条件装配到位；service-token 面过大 + authorizer 可选 |
| WT-J 管理台 | **8.2** | 异常首页、真实 BFF supply、J5 治理动作、CF 只读达标；商户 dual-end 标签未挂主路径；路由模拟器 live 缺席 |
| **综合（代码可维护/可内测）** | **~7.5** | 可内测 dogfood + 继续修 P0/P1；**不可**宣称 C5 生产就绪 / #128 整包完成 |

---

## 1. 阶段与既有诚实边界（先读这个）

### 1.1 票面审计（不推翻，但需降调处）

| 来源 | 结论 |
|---|---|
| `admin-supply-ticket-completion-audit` | 多数 #107–#126 `proved`；#115/#127 `partial`（#92 ProductUsage）；#116–#119/#128 `external_blocked`（live 证据） |
| `admin-supply-accept-gaps` | G-LIVE-I4 / G-LIVE-TEXT·IMAGE·VIDEO / G-UI-MERCHANT-NO-FALLBACK / G-E2E-PLAYWRIGHT-D048 仍 open |
| 本轮 Agent Team | 在「代码层 proved」之上发现 **实现合同冲突与假绿缝**；建议 #108 从 proved **降为 partial**（见 F-S2-01/04） |

### 1.2 同一增量纪律（D-080 C3）

- AP 骨架与 MP 纵向 **不得分侧宣称完成**。
- recorded 门绿 ≠ live C5。
- #92 ProductUsage 持久化属跨包；本包只消费，**不得自建第二账本**（本轮确认未双建）。

### 1.3 防双建红线（本轮抽查）

| 红线 | 结论 |
|---|---|
| 第二 secret vault | **未建** — 复用 `SecretStorePort` |
| 第二 catalog | **未建** — expand/migrate 既有 CatalogRevision |
| 第四 cooldown map | **规划面已 PG**；recorded adapter 仍持进程内 `MemoryHealthOverlayPort`（P2） |
| 平行 EntitlementPolicy port | **未建** |
| 第二收件箱 | **未建** — 异常首页消费 pending-actions |
| GrantLot / ProductUsage / ProviderCost 合并 | **未合并** |
| 三 capability 概念类型名 | **互斥成立**（Registry / Permission / Catalog CapabilityRevision） |
| CF GraphQL broker | **未引入**（deferred） |
| incident ack/assign | **未引入**（C1） |

---

## 2. Agent Team 分路结论

### Agent-S2 · 合同脊柱 / RouteSnapshot / inventory

**Score: 6.8 / 10 · 条件通过（#108 建议降 partial）**

**做对的**
- 三概念类型名互斥；S2a re-export 完整；ledger 主路径走 normalize adapter；Strict BYOK 无回退语义；audio stub 诚实 `not_in_scope_for_supply_v1`。

**关键问题**
- 「单一 RouteSnapshot」未真收敛：Foundation / ModelSupply / StrictByok / Canonical 四形并存，Canonical 不落库。
- 媒体 fallback 只改 `policyRevision` 不改 `routePolicyRevisionId`，与 adapter 读优先级分叉（**主会话已核验** `index.ts:2920-2924` + `route-snapshot-normalize.ts:168-171` vs ledger 写路径 `:373-376`）。
- `expandDeployment` 把 `deployment.policyRevision` 误映射为 `dataPolicyRevisionId`（**已核验** `expand.ts:127-130`）。
- inventory 本身不承载完整 D-051 六问；web 投影把 instrumented+unknown 标 complete 过宣称。

### Agent-G · 供应核心

**Score: 7.2 / 10 · CONDITIONAL PASS**

**做对的**
- 单 vault + expand-not-dual-catalog；RoutePolicy CAS；Postgres health overlay + LiteLLM/Envoy 出处常量；三层排序 quality→health→cost；recorded placeholder 不进有效成本排序；capability head HTTP/Worker 共读；主路径 isolate/drain 阻断 I/O。

**关键问题**
- **P0**：`assembleForRequest` 在 `status === 'pending'` 时无条件拒绝，**含 `frozenVersion` 历史版本**（`secret-broker.ts:111-116`）— 与「运行中任务不静默换凭据 / 历史快照服务 in-flight」冲突。
- 冻结门控过松：仅 `credentialAccountId` 存在即 `useFrozenCredentialVersion`，缺 version 可能落到 head。
- DataPolicy：无 binding map 时退化为区域 thin 过滤，restricted 非 fail-closed。
- 排序缺证据时合成满分 fresh 证据（假绿）。

### Agent-H · 权益与池

**Score: 8.1 / 10**

**做对的**
- 产品/供应双真相；未重建 ProductUsage；三链分离；shared/dedicated 互不回退；PG fair-queue + 三层 concurrency 负向测试；fixed CatalogModel 只换 Deployment。

**关键问题**
- Fair-queue：`product_account` 拒绝后仍占 `selected`，饿死同 supply 其它账号（P1）。
- RPM/TPM 仅造型不执行（假绿风险）。
- dual-truth 投影未挂生产用户面；#92 bridge 生产注入不完整（已知 partial）。

### Agent-I · 三模态 conformance

**Score: 7.2 / 10**

**做对的**
- 生产路径：仅 `rejected_before_accept` 可跨渠道 fallback；accepted/unknown reconcile 不重提；Ark drain/health/durable recover 有真实现；publish-gate <2 故障域不得 multi-channel；live cost cap + fail-closed；视频共享制造商标 `channel_level`。

**关键问题**
- Unit `dualChannelReady` **不校验同 CatalogModel**（`matrix.ts:63-66`）— 可跨模型假绿；live gate 有 `catalog_model_alignment` 挡住生产宣称，但 unit 报告会误导。
- handoff 矩阵 text/image 官方与转售 CatalogModel 本就不对齐 → live 会对齐检查 blocked。
- 默认 `InMemoryMediaProviderReceiptStore`；跨进程 recover 需显式 FS/PG store。
- 商户端 dual-end 标签：组件有、主路径未挂（与 Agent-J 一致）。

### Agent-KZ · 权限 + Z2 接线 + 安全

**Score: 8.2 / 10**

**做对的**
- 未知 module/action 默认拒绝；Cloudflare 写硬拒绝；GraphQL 未引入；HTTP+Worker migrations 对齐；pending-actions **无条件**装配；fixture 生产路径门控；payment actor 收窄。

**关键问题**
- `x-service-token` + `x-core-actor` 可提权至 worker（全量 bypass）/ admin；token 比较非 constant-time。
- `PermissionAuthorizerPort` 可选，缺省内部绕过；ledger/worker 部分实例未注入。
- 弱密钥黑名单不覆盖 `dev-token`。

### Agent-J · 管理台前端

**Score: 8.2 / 10**

**做对的**
- `/admin` = 异常首页（非 models redirect）；supply 真实 BFF snapshot + 服务端分页；J5 preview→reason/CAS→execute→audit；CF 只读；诚实 unknown/stale；未误碰 #83 composer/results/dashboard。

**关键问题**
- `ModelCardPicker` 仅单测引用，商户选择主路径未挂 → **G-UI-MERCHANT-NO-FALLBACK 仍 open**（主会话已核验）。
- Live 路由模拟器固定 `null`（仅 fixture 路径有 demo panel）。
- `/admin` `/admin/supply` 标题硬编码中文；exception home 加载态可能短暂像「无异常」。

---

## 3. 合并 Finding 清单（按优先级 · 修复指令）

> 状态：`OPEN` = 本轮确认未修；`KNOWN` = 已在 gap/审计中诚实记录；`DOC` = 文档/宣称口径问题。  
> 严重度：P0 合同冲突/可断生产 in-flight；P1 假绿/安全/合规缺口；P2 卫生/性能/文档。

### 3.1 P0 — 必须先修

| ID | 状态 | 域 | 问题 | 证据 | 修复指令 |
|---|---|---|---|---|---|
| **F-G-01** | FIXED | G 凭据 | 轮换 → `pending` 后，`assembleForRequest` **拒绝一切**请求，包括带 `frozenVersion` 的 in-flight 历史版本装配 | `secret-broker.ts:111-116`；`credential-lifecycle` rotate→pending；测试只覆盖 re-activate 后 frozen | **`frozenVersion` 命中 `versionHistory` 时允许 pending（及 drain）装配历史版本**；仅「无 frozen / 请求 head」硬拒 pending。补单测：rotate 后立刻 `frozenVersion: previous` 必须成功 |

### 3.2 P1 — 发布/验收前应修

| ID | 状态 | 域 | 问题 | 证据 | 修复指令 |
|---|---|---|---|---|---|
| **F-S2-01** | FIXED | S2 | 媒体 fallback 后 `policyRevision` 与 `routePolicyRevisionId` 分叉；adapter 与 ledger 读优先级相反 | `index.ts:2920-2924`；`route-snapshot-normalize.ts:168-171` vs `:373-376` | 明确两字段语义（route policy vs deployment policy）；fallback 同步维护；ledger 与 adapter **共用同一解析函数**；用生产 `snapshotFor` + fallback 快照做契约测 |
| **F-S2-02** | FIXED | S2/G | `expandDeployment` 把 `policyRevision` 误映射为 `dataPolicyRevisionId` | `expand.ts:127-130` | 仅在有真实 DataPolicy 绑定时填 `dataPolicyRevisionId`；deployment/route policy 另字段；禁止别名 |
| **F-S2-03** | FIXED | S2 | Foundation checkpoint 写回丢弃 top-level dataPolicy/sourceKind 等 | `toFoundationRouteCheckpoint`；`domain.ts` 字段集 | 扩展 foundation 列或规范为 primary candidate 派生并 round-trip 断言 |
| **F-G-02** | FIXED | G | 冻结凭据门控过松：仅有 accountId 即 use frozen，缺 version 可落到 head | `index.ts:1745-1752`；`secret-broker.ts:133-134` | 有 `credentialVersion` 必须传 `frozenVersion`；缺 freeze 字段 fail-closed |
| **F-G-03** | FIXED | G | DataPolicy 无 binding map 时 restricted 非 fail-closed | `supply-control-plane.ts:417-454`；`data-policy.ts:267-302` | restricted dataClass 且无 DataPolicy head → 全局 fail-closed；或强制每个可路由 Deployment 绑定 revision |
| **F-G-04** | FIXED | G | 排序缺证据时合成满分 fresh 证据 | `supply-control-plane.ts:514-584` | 缺关键证据 → excluded/canary；禁止合成 fresh 满分 |
| **F-H-01** | FIXED | H | Fair-queue product 层拒绝后仍占 `selected`，饿死邻居 | `postgres-repository.ts` claimTurn + tryAcquireFair | product 层拒绝立即 requeue/终态；仅 supply/system 限流可持有 selected 重试 |
| **F-H-02** | FIXED | H | RPM/TPM 死字段，测试写 rpm 却只断言 concurrency | `three-layer-capacity.ts`；`supply-pools.test.ts` | 实现滑动窗口 **或** 从契约/测试删除 rpm/tpm，避免假绿 |
| **F-I-01** | FIXED | I | Unit `dualChannelReady` 不校验同 CatalogModel | `fault-injection/matrix.ts:63-66`；`matrix-models.ts` 跨模型 | unit 矩阵要求 `primary.catalogModelId === fallback.catalogModelId`；修正 matrix-models / fakes 对齐 handoff 或显式标 `channel_matrix_misaligned` |
| **F-I-02** | KNOWN | I | Live C5 / fault injector 未跑 | accept-gaps G-LIVE-* | 开闸 `RUN_PROVIDER_LIVE_FAULT_INJECTION=1` + secrets + external hook；更新 gap 文件后才可宣称 |
| **F-J-01** | PARTIAL | J/#83 | 商户端 single-channel/no-fallback 未挂主路径 | `ModelCardPicker` 仅 test 引用；gap G-UI-MERCHANT-NO-FALLBACK | model-settings ModelCard 已挂 `channelReadiness` badge；composer 全量 ModelCardPicker 仍 deferred |
| **F-J-02** | FIXED | J | Live 路由模拟器缺席 | `admin-supply-control.tsx:185-187` | 接 Core route simulate 命令；禁止仅 fixture 可见 |
| **F-KZ-01** | FIXED | KZ | service-token 提权面过大 + 非 timing-safe | `server.ts` p1Identity；`authorizer` worker_bypass | timingSafeEqual；worker/payment 独立凭证或 mTLS；缩小 actor 可设范围 |
| **F-KZ-02** | FIXED | KZ | authorizer 可选 → 内部静默全开 | `application-service.ts:171` | 生产构造 **require** authorizer 或默认 `createPermissionAuthorizer()` |
| **F-KZ-03** | FIXED | KZ | 弱密钥黑名单不含 `dev-token` | `secret-hardening.ts`；本地 `.env` | 拒短熵 + 扩展 placeholder 列表（含 `dev-token`） |
| **F-H-03** | KNOWN | H/#92 | ProductUsage 仅 Memory；bridge 生产注入不全 | product-billing；审计 #115/#127 partial | 等 #92 持久化；本包禁止自建第二 ledger；wiring 注入 durable usage + freeze 关联 |

### 3.3 P2 — 卫生与后续

| ID | 状态 | 域 | 问题 | 修复指令 |
|---|---|---|---|---|
| **F-S2-04** | DOC | S2 | 「#108 单一 RouteSnapshot proved」过宣称 | 审计改 **partial**；措辞改为「字段规范 + 双向 adapter，Canonical 不落库」 |
| **F-S2-05** | OPEN | S2 | adapter 缺字段注入 `recorded-*-v1` 伪装完整 | 生产缺关键 revision throw；recorded 仅 harness |
| **F-S2-06** | OPEN | S2 | contracts `SupplyDeployment` vs model-supply `ModelDeployment` 双套类型 | 收敛 SSOT + 单向 adapter |
| **F-G-05** | FIXED | G | recorded adapter 私有 MemoryHealthOverlay | 注入共享 HealthOverlayPort |
| **F-G-06** | OPEN | G | catalog revision report 进程本地；`supportsDeployment` 无 head 时 true | catalog head 共读；生产无 head fail-closed |
| **F-G-07** | OPEN | G | PG RoutePolicy publish 抛裸 Error | 统一 `P1DomainError('IDEMPOTENCY_CONFLICT')` |
| **F-H-04** | FIXED | H | 全局 capacity advisory lock 热点 | 锁粒度改 supply_account + 独立 system 计数 |
| **F-H-05** | FIXED | H | service_turns 无限增长 | 滑动窗口 / purge |
| **F-I-03** | FIXED | I | 默认 InMemory receipt store | 生产 media adapter 强制 durable store |
| **F-J-03** | FIXED | J | `/admin` `/admin/supply` i18n 硬编码 | paraglide keys |
| **F-J-04** | FIXED | J | exception home 加载态静默 | 显式 loading/error |
| **F-J-05** | FIXED | J | WIRING-DIFF 过时 | 同步 live reporters 已接线事实 |
| **F-KZ-04** | FIXED | KZ | product command 授权与 P1 分叉 | 未知 command 对 worker 也 default-deny |
| **F-KZ-05** | OPEN | KZ | runtime assembly 硬编码 recorded catalog revision id | live 路径用 published head 标签 |
| **F-I-04** | KNOWN | I | Playwright 四服务 D-048 e2e | gap G-E2E-PLAYWRIGHT-D048 |

---

## 4. 建议修复波次（可执行顺序）

### Wave 0 — 止血（1–2 天，P0）

1. **F-G-01** secret-broker frozenVersion 在 pending 下放行历史版本 + 单测  
   → verify: rotate 后 in-flight frozen 装配绿；新任务无 frozen 仍拒 pending  
2. 同步检查 **F-G-02** 冻结字段 fail-closed（可同 PR）

### Wave 1 — 假绿与合规（3–5 天，P1 核心）

1. **F-S2-01 + F-S2-02** policy/dataPolicy 语义与 expand 映射  
2. **F-G-03 + F-G-04** DataPolicy fail-closed + 排序缺证不合成满分  
3. **F-I-01** unit dualChannelReady 同 CatalogModel 硬约束  
4. **F-H-01 + F-H-02** fair-queue 占坑 + RPM/TPM 诚实化  
5. **F-KZ-01~03** service-token timing-safe / authorizer 强制 / 弱密钥  

→ verify: 相关 unit + 真实 PG 组；secret scan；authorizer 装配测试

### Wave 2 — 验收闭环（依赖外部 / 跨包）

1. **F-I-02** live matrix（secrets + injector + cost cap）  
2. **F-J-01** 商户 dual-end 标签（协调 #83）  
3. **F-H-03 / #92** ProductUsage 持久化 + Z2 bridge 完整注入  
4. **F-J-02** live 路由模拟器  
5. **F-I-04** Playwright 四服务 D-048  

→ verify: 更新 `admin-supply-accept-gaps` 与 ticket-completion-audit 状态；**禁止**在 gap 关闭前写「#128 complete」

### Wave 3 — 债务清理（P2）

- Foundation 字段超集 / 类型 SSOT / overlay 共享 / capacity 锁粒度 / i18n / WIRING-DIFF / receipt store 默认 durable

---

## 5. 不可宣称清单（红门）

在对应 gap 关闭并更新本报告/审计文件之前，**禁止**对外或对内宣称：

1. **#128 Z2-ACCEPT 整包完成**  
2. **生产 C5 multi-channel ready**（三模态 × 同 CatalogModel × official_direct + upstream_reseller × 独立故障域 × 真故障注入）  
3. **unit `dualChannelReady=true` = 同 CatalogModel 双渠道**（F-I-01 已修：text/image 跨模型诚实 `false`；live 仍需 F-I-02）  
4. **商户端 dual-end single-channel/no-fallback 完成**（F-J-01 仅 model-settings partial）  
5. **RouteSnapshot 已单一权威落库**（F-S2-04）  
6. **ProductUsage 持久化预占/结算完成**（属 #92，本包 partial）  
7. **视频制造商级双供应**（仅可声称渠道级容灾，Seedance 同源）

**可以诚实宣称**：

- AP/MP 代码骨架与 recorded/unit 验收 harness 已合入 `main`（`992fa71`）  
- 防双建红线本轮抽查通过（无第二 vault/catalog/收件箱/权限缝/GraphQL broker）  
- 生产路径禁 accepted/unknown 跨渠道重提  
- 管理台异常首页 + 供应控制中心真实 BFF + J5 治理动作链路  
- Cloudflare 只读三件套边界  

---

## 6. 与既有审计的差异（本轮新增）

| 既有口径 | 本轮调整建议 |
|---|---|
| #108 S2b = proved | → **partial**（单一类型过宣称 + policy 双读分叉 + foundation 字段有损） |
| #110 G2 proved「运行中不静默换凭据」 | 状态机与 history 在；**pending 窗口 in-flight 装配 P0 断** → 修 F-G-01 前不得写死该验收句 |
| #113 G5 / 排序 | 序正确；**缺证合成满分** 削弱 D-065 → F-G-04 |
| #119 I4 external_blocked | 维持；并补 **unit 假绿** F-I-01 作为代码债（非仅 env） |
| G-UI-MERCHANT-NO-FALLBACK open | 维持；确认组件孤岛，非「差一点接线」 |

其余 proved 票（#107/#109–#112/#114/#120–#126 等）本轮 **未发现**足以推翻 proved 的反证；保留，但依赖 Wave 0/1 修复的周边合同。

---

## 7. 验证命令（修复后回归）

```bash
# Core 相关（按模块收窄后全量）
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/supply-registry/credential-account.test.ts \
  src/p1/route-snapshot-normalize.test.ts \
  src/p1/model-supply/provider-conformance/fault-injection/fault-injection.matrix.test.ts \
  src/p1/entitlement-pools/supply-pools.test.ts \
  src/p1/capability-permission/authorizer.test.ts \
  src/p1/z2-accept/z2-accept.test.ts

# 真实 PG 票据组（需 provision-test-db）
# ./scripts/ci/provision-test-db.sh && pnpm --filter @meiye/core test -- *.postgres.test.ts

# Web AP
pnpm --filter @meiye/web exec tsx --test src/p1/z2-accept-ap.test.tsx

# 可选 live（secrets + cost cap）
# RUN_PROVIDER_LIVE_FAULT_INJECTION=1 pnpm --filter @meiye/core test -- live-fault-injection
```

---

## 8. Agent Team 元数据

| 项 | 值 |
|---|---|
| 日期 | 2026-07-21 |
| HEAD | `992fa71` |
| 分路 | S2 / G / H / I / KZ / J（6 路 explore，read-only） |
| 主会话 | 对抗核验 F-G-01、expand dataPolicy、matrix dualChannelReady、ModelCardPicker 孤岛、worker_bypass、pending-actions 无条件装配 |
| 产出 | 本文件（Review + 修复指令）；**未改业务代码、未 push** |
| 后续 | Wave 0 起修；修完回写本文件「处置记录」节 + 更新 ticket-completion-audit / accept-gaps |

---

## 9. 处置记录

| 日期 | 动作 | 结果 |
|---|---|---|
| 2026-07-21 | Agent Team 深度 review 落盘 | 1 P0 + 16 P1 + 若干 P2 登记；修复波次 0–3 已排；业务代码未动 |
| 2026-07-21 | Wave 0/1 core 落地 (`a8f8e17`) | **FIXED**: F-G-01, F-G-02, F-G-03, F-G-04, F-S2-01, F-S2-02, F-I-03 |
| 2026-07-21 | Wave P2 + docs (`aa044e3`) | **FIXED**: F-S2-03（foundation `dataPolicyRevisionId`/`sourceKind` round-trip）、F-G-05（recorded adapters 改用 `getSharedRecordedHealthOverlay`）；**DOC**: F-S2-04（#108 审计降 partial） |
| 2026-07-21 | Wave 1 I/H (`1dd60ba`) | **FIXED**: F-I-01 dualChannelReady 同 CatalogModel + channelMatrixAligned；F-H-01 product 拒后立即 requeue；F-H-02 滑动窗口 RPM/TPM |
| 2026-07-21 | Wave 1 H follow-up (#115) | **FIXED**: F-H-04 capacity 锁改 supply_account + 独立 system lock；F-H-05 service_turns 滑动窗口（`FAIR_QUEUE_SERVICE_TURN_WINDOW`）+ complete 时 purge |
| 2026-07-21 | Wave 1 KZ (`8ca86f5`) | **FIXED**: F-KZ-01 timing-safe token + elevation allowlist；F-KZ-02 authorizer 默认强制；F-KZ-03 weak secrets；F-KZ-04 product command default-deny |
| 2026-07-21 | Wave 1/2 J (`724cc1b`) | **FIXED**: F-J-02 live 路由模拟器；F-J-03/04 i18n + loading；F-J-05 WIRING-DIFF；**PARTIAL**: F-J-01 model-settings badge（composer 全量 ModelCardPicker deferred） |
| 2026-07-21 | Wave 2 外部门禁（保持 OPEN/KNOWN） | **OPEN/KNOWN 未动**: F-I-02 live matrix、F-H-03/#92 ProductUsage、F-I-04 Playwright D-048；#128 仍 external_blocked，严禁宣称整包完成 |
| 2026-07-21 | Agent Team 修复收口 | 分支 `fix/admin-supply-review-findings-2026-07-21`；Core/Web 相关 unit 回归绿；**未 push** |

---

## 附录 A · 分路分数雷达（便于对照）

```
S2  ████████░░  6.8
G   █████████░  7.2
H   ██████████  8.1
I   █████████░  7.2
KZ  ██████████  8.2
J   ██████████  8.2
─────────────────
综合 ~7.5  可内测 / 不可宣称 C5·#128
```

## 附录 B · 快速定位文件

| 主题 | 路径 |
|---|---|
| 凭据 broker P0 | `apps/core/src/p1/supply-registry/secret-broker.ts` |
| expand 误映射 | `apps/core/src/p1/supply-registry/expand.ts` |
| RouteSnapshot 归一化 | `apps/core/src/p1/route-snapshot-normalize.ts` |
| 媒体 fallback 快照 | `apps/core/src/p1/model-supply/index.ts`（submissionForFrozenMediaCandidate） |
| 故障注入 unit 假绿 | `apps/core/src/p1/model-supply/provider-conformance/fault-injection/matrix.ts` |
| publish-gate | `.../fault-injection/publish-gate.ts` |
| Fair-queue | `apps/core/src/p1/entitlement-pools/postgres-repository.ts` |
| Authorizer | `apps/core/src/p1/capability-permission/authorizer.ts` |
| 管理台 supply | `mkfast-template-main/src/p1/admin-supply-control.tsx` |
| 商户标签组件 | `mkfast-template-main/src/product/model-card-picker.tsx` |
| 既有 gap | `docs/evidence/admin-supply-accept-gaps-2026-07-20.md` |
| 既有票审计 | `docs/reviews/admin-supply-ticket-completion-audit-2026-07-20.md` |
