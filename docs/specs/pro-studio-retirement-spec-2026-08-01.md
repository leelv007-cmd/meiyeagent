# Pro Studio 全量退役规格

| Field | Value |
| --- | --- |
| Status | **authoritative for implementation** |
| Date | 2026-08-01 |
| Decision | **D-170** Pro Studio 全量退役（RETIRE）— 已写入决策日志 |
| Wayfinder map | `.wayfinder/map-pro-studio-retirement.md` |
| Supersedes (product authority) | D-127 FREEZE (Pro Studio row), D-110 ③ keep-code, D-103 “if kept = advanced canvas”, D-099 parity execution entry, D-075/077/084/092 entry family, ADR-0012 as current law |

> **实施唯一入口。** 删除代码、改文档、停 IO 均以本规格为准。  
> 冲突时：本规格 + D-170 > 旧 FREEZE/升单/并行表述。  
> 本规格 **不** 代替实施 PR；地图会话 **不** 执行 `git rm`。

---

## 1. 目的与边界

### 1.1 目的

将 Pro Studio（无限画布加购 / 专业工作区 / Canvas 服务 / 节点生成与画布 Agent）从产品与代码中 **全量退役（RETIRE）**，消除 D-127 FREEZE「只留入口」与半死运行时带来的引用漂移，主线仅保留定制创作 + 自由创作（模型原生薄路径）。

### 1.2 范围内

- 真删：`apps/canvas`、core `pro-studio*` 树（先迁 KEEP 能力）、Web 入口/加购/e2e、脚本门禁、env 服务网
- 数据：专属表 **STOP-WRITE / 产品面 STOP-READ**；**不强制 DROP**
- 文档：五层防漂移（新 D、CONTEXT 墓碑、现行 spec rewrite、旧文 banner、AGENTS/DESIGN）
- 无画布接替

### 1.3 范围外

- 设计替代无限画布 / 节点精修 / 画布 Agent / 专业 TTS·SFX 工作区
- 为「将来复用」抽公共画布内核或半死垫片
- bulk 改写/删除 `docs/evidence/pro-studio/**` 与历史 D 正文
- 强制 `DROP TABLE` 专属表
- 本规格文件本身不包含生产代码 diff

---

## 2. 产品收口

| 决策 | 内容 |
| --- | --- |
| 自由创作 | 模型原生薄路径；**不是**画布 |
| 定制创作 | agent 流式对话主线 **保留**（D-103 非画布部分不废） |
| Pro Studio | **已退役**；无新开发、新售卖、新入口、新 adoption |
| 历史成品 | 已 adoption 的 ContentPackage **只读**；无回写路径 |
| 高用量 Pro / 套餐名 | **≠** 已退役的 Pro Studio 加购 |

---

## 3. RETIRE / KEEP 清单

证据：`.wayfinder/issues/psr-05-lock-retire-inventory.md`；审计 `references/analysis/pro-studio-retirement-2026-08-01/{01,02,03}-*.md`。

### 3.1 RETIRE（真删 / 去编排 / 去产品面）

| 桶 | 路径或面 |
| --- | --- |
| Canvas 包 | `apps/canvas/**`（`@meiye/canvas`） |
| Core 子树 | `apps/core/src/pro-studio/**`、`apps/core/src/pro-studio-runtime/**`（**先**迁出 §3.2 KEEP 能力，再删树） |
| Package exports | `apps/core/package.json` → `./pro-studio`、`./pro-studio-runtime` |
| 脚本 / CI | `scripts/pro-studio/**`、root `pro-studio:*`、test 中 pro-studio 门禁、`scripts/ci/apply-pro-studio-schema.mts` 及 callers、release unit `canvas`、dev/typecheck 的 canvas filter |
| Web | `/pro-studio`、`api/pro-studio/**`、entitlement/checkout/launch、payment `pro_studio_add_on`、composer `tool.pro_studio`、相关 e2e/fixtures |
| Env | `CANVAS_SERVICE_URL` / `CANVAS_SERVICE_TOKEN` / `CANVAS_ORIGIN`、`PRO_STUDIO_*` |
| 运行时挂载 | readiness `canvas` 探活；worker 画布 poll/deletion；boot `migrateProStudioSchema` / `migrateProStudioWorkspaceState`；`AdvancedCanvasAdoptionFoundationModule` 与 **新** adoption 写口 |
| 纯画布域 | launch-code / sessions / advanced-canvas graph / canvas-agent / node generation-runtime / pro-studio entitlement |
| 画布生成写 | `model_canvas_*` 写路径与相关代码 |
| 门禁 allowlist | `d123-cost-boundary` 等中的 pro-studio 测试条目 |

### 3.2 KEEP

| 项 | 裁决 |
| --- | --- |
| contracts `DEFAULT_CANVAS_WORK_*` 等命名 | KEEP |
| model-supply `CANVAS_GENERATION_*` | KEEP |
| web `p1/canvas-library` / `canvas-name` | KEEP |
| ContentPackage / OwnedAsset / 通用 payment plan / jobs / Catalog 等 Product Core | KEEP |
| **`audio-contracts` / `audio-asset-pipeline` 能力** | **KEEP**（主线 TTS）；删树前迁到非 pro-studio 路径（建议 `apps/core/src/p1/model-supply/` 或同级；**精确落点实施 PR 自定**） |
| 主线 OwnedAsset / 通用对象存储 | KEEP（不经整棵 pro-studio 树续命） |
| `sourceRef.advancedCanvas` | **KEEP 只读血缘**；禁止新写入 |
| 对象键 `{workspaceId}/canvas/assets/*` | **禁止按前缀 bulk 删**（与 intake 共用） |

### 3.3 共享缝速查

| 缝 | 裁决 |
| --- | --- |
| audio-contracts / audio-asset-pipeline | KEEP 能力 → 先迁后删树 |
| canvas-asset-facade 仅画布资产/导出 | RETIRE |
| migrateProStudio* boot | RETIRE 调用 |
| AdvancedCanvas adoption 写 | RETIRE；历史 CP 只读 |
| readiness canvas + CANVAS_SERVICE_* | RETIRE |
| launch/session/graph/agent/generation-runtime/entitlement | RETIRE |
| fixture reference policy 仅画布 | RETIRE（main 引用则改挂主线或删引用） |
| model_canvas_* 写 | RETIRE |
| d123 pro-studio allowlist | RETIRE 条目 |

---

## 4. 数据 STOP-IO

### 4.1 STOP-WRITE

- `pro_studio_launch_codes`
- `pro_studio_canvas_sessions`
- `advanced_canvas_projects` / `advanced_canvas_revisions`
- `pro_studio_owned_assets`（禁止新行）
- `pro_studio_asset_deletion_outbox`（仅 drain 既有 pending；禁止新业务入队）
- `pro_studio_audit_events`（禁止新事件）
- `pro_studio_workspace_state` 全 namespace（`generation` / `entitlement` / `agent` / `adoption_v1` 及工厂 `adoption`）
- `pro_studio_checkout_bindings` / `pro_studio_payment_claims`
- 画布语义 `model_canvas_*`（含 `model_canvas_generation_quotes` 及审计所列 outbox/事件表）
- ContentPackage **新** `sourceRef.advancedCanvas` 写入

### 4.2 STOP-READ（产品面 fail-closed）

- Web `/pro-studio*`、Canvas 服务、entitlement 投影、加购 checkout/launch 不得再读专属表对外服务
- Core readiness 不再探 canvas

### 4.3 仍可读

- `p1_content_packages` / `p1_owned_assets` / `model_generation_jobs` / 通用 payment 等
- 历史 `advancedCanvas` 血缘字段（只读）

### 4.4 不强制 DROP

专属表可保留为空壳历史；`DROP` 为可选后续（须 outbox 空、无 in-flight claim、引用策略），**非本规格必达**。

### 4.5 生产义务

仓库侧 **无生产义务证据**（fixture/CI/本地为主）。若运营另有生产库，实施前独立对账；本规格不假设存在付费 Pro Studio 用户义务。

---

## 5. 实施阶段 P0–P6 与绿集

证据：`.wayfinder/issues/psr-06-lock-retirement-phase-order.md`。

| 阶段 | 内容 | 退出门禁 |
| --- | --- | --- |
| **P0 权威先行** | D-170 + CONTEXT 墓碑 + AGENTS/DESIGN 等 rewrite（§6）；可与 P1 同批，须在大删包前合入主干 | 现行入口不再把 PS 写成可用能力 |
| **P1 产品 fail-closed** | 下线入口/composer 工具/加购 webhook 分支/launch | 无法进入画布商业路径；plan 支付仍绿 |
| **P2 抽出 KEEP 缝** | 迁出 audio-contracts / audio-asset-pipeline | core typecheck + TTS/model-supply 相关测绿 |
| **P3 Core 卸挂载** | 去 readiness/boot migrate/adoption 写/worker 画布任务；STOP-WRITE 代码 | core 启动不依赖 canvas |
| **P4 删 Canvas 包与编排** | `git rm apps/canvas`；去 dev/typecheck/release canvas；去掉 CANVAS 必填 | 无 `@meiye/canvas`；dev 默认 web+core |
| **P5 删 pro-studio 树与门禁** | 删剩余模块/exports/scripts/e2e；`PRO_STUDIO_*` 出 env.example | §5.2 绿集 |
| **P6 数据停 IO 固化** | 确认无代码再写专属表；可选 outbox drain | 无新写路径；**不做 DROP** |

### 5.1 硬序

- **P2 ≺ P5**（先迁 audio 再删树）
- **P0 ≺ P4/P5**
- P1 建议先于或并行 P3，结束「仍可购/进画布」中间态
- 允许单 PR 或多 PR；合并顺序必须尊重阶段序

### 5.2 最小绿集（P5 / 退役完成）

| 门禁 | 要求 |
| --- | --- |
| `pnpm typecheck` | 绿 |
| `pnpm test` | 绿（已无 pro-studio/canvas 子集） |
| `pnpm build` | 绿（无 canvas release unit） |
| web `check`（若触达 web） | 绿 |
| core TTS/model-supply/payment plan | 绿（P2/P3 重点） |
| Playwright | 不强制全量；删 `pro-studio-*.spec.ts` 后 smoke/required 不因缺 canvas webServer 而红 |
| `pro-studio:conformance` / `pro-studio:security` | **删除，不再是 CI 要求** |

### 5.3 回滚

- 分阶段 git revert；P4/P5 成本高，依赖 P0–P3 稳定
- 表不 drop；代码回滚 **不** 自动恢复商业售卖（P1 产品决策优先）

---

## 6. 文档五层与 supersede

证据：`.wayfinder/issues/psr-07-lock-supersede-and-glossary.md`、`psr-08-lock-doc-sync-checklist.md`。

### 6.1 D-170（决策日志）

正式决策已分配 **D-170** 并写入 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`。至少 supersede：

| 靶 | 废止 gist |
| --- | --- |
| D-127 FREEZE（Pro Studio 行） | → RETIRE / 真删 |
| D-110 ③ | 保留代码与付费墙 |
| D-103 画布保留假设 | 自由创作高级画布 |
| D-099 投入入口 | parity / K1–K7 现行执行 |
| D-075 / D-077 / D-084 / D-092 | 入口必达 / canonical gate |
| ADR-0012 当现行 | 升单并行工程 |

**不废**：定制+自由薄路径双主线、ContentPackage 唯一写口、Product Core、历史 evidence 事实。  
**禁止**改写旧 D 正文装成 RETIRE（leave-historical + 新 D 指针）。

### 6.2 CONTEXT 墓碑原则

- 标题：`Pro Studio（已退役）`
- 定义：历史加购画布；已退役；无新开发/售卖/入口；无画布接替；自由创作＝模型原生薄路径
- Avoid：当现行、恢复 FREEZE 入口、并行工程票、`/pro-studio` 必达、新 adoption、半死垫片
- 清洗 `开放图文工作台` / `Composer 日常轻编辑` 中「属 Pro Studio 加购」现行分界
- 文首：去掉 D-099 重做入口 / D-127 FREEZE 现行声张 → 指针 **D-170 + 本规格**

### 6.3 必须 rewrite

| 文件 |
| --- |
| `CONTEXT.md` |
| `AGENTS.md` |
| `DESIGN.md` |
| `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（摘要 + 新 D；旧 D 正文不动） |
| `docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md` |
| `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md` |
| `docs/specs/contentpackage-productization-spec.md` |
| `docs/specs/reshell-and-extend-dev-spec-2026-07-25.md` |
| `docs/specs/bucket-disposition-matrix-2026-07-25.md` |
| `mkfast-template-main/tests/e2e/TEST-CATALOG.md` |
| **本文件**（已创建；后续仅勘误） |

`PRODUCT.md`：可选一句「无无限画布/专业工作区加购」——不强制。

### 6.4 必须 supersede-banner

| 文件 |
| --- |
| `docs/adr/0012-two-lane-pro-studio-overlay.md`（Status → superseded） |
| `docs/specs/pro-studio-parity-rework-spec-2026-07-22.md` |
| `docs/specs/vozeb-adoption-pro-studio-spec.md` |
| `docs/specs/ui-journey-rebuild-spec-2026-07-20.md` |
| `docs/reviews/doc-consistency-review-2026-07-22.md` |

### 6.5 leave-historical

- `docs/evidence/pro-studio/**`（bulk 不改）
- 历史 D 正文、handoff、多数 reviews、旧 content-agent specs

---

## 7. 验收

### 7.1 产品 / 代码

- [ ] 无可达 `/pro-studio` 商业或画布路径
- [ ] monorepo 无 `@meiye/canvas`；无 package exports `./pro-studio*`
- [ ] 无 canvas readiness / boot migrateProStudio*
- [ ] audio TTS 主链仍绿（迁出后）
- [ ] §5.2 绿集通过

### 7.2 文档漂移（机器辅助候选）

在 rewrite 集上不应再出现「可用能力」声张（墓碑/retired/historical 语境除外）：

```bash
rg -n "当前重做入口|只保留入口|Engineering may proceed in parallel|pro-studio-parity-rework" \
  CONTEXT.md AGENTS.md DESIGN.md \
  docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md \
  docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md \
  docs/specs/reshell-and-extend-dev-spec-2026-07-25.md \
  docs/specs/bucket-disposition-matrix-2026-07-25.md
```

人工：rewrite 文件无「进入 Pro Studio」产品 CTA、无 FREEZE 当现行分桶。

### 7.3 数据

- [ ] 无代码路径对新专属表行 / 新 advancedCanvas sourceRef 写入
- [ ] 未执行强制 DROP（除非另开可选票）

---

## 8. Out of scope（重申）

见 §1.3。

---

## 9. 证据与决策指针

| 类型 | 路径 |
| --- | --- |
| Wayfinder 地图 | `.wayfinder/map-pro-studio-retirement.md` |
| 关闭票 | `.wayfinder/issues/psr-01` … `psr-09` |
| Runtime 审计 | `references/analysis/pro-studio-retirement-2026-08-01/01-runtime-code-inventory.md` |
| Web/商业/e2e 审计 | `.../02-web-commerce-e2e-inventory.md` |
| 数据审计 | `.../03-data-schema-inventory.md` |
| 文档审计 | `.../04-docs-decision-inventory.md` |

---

## 10. 下一步（实施）

1. 开实施工作（非 wayfinder 地图）：按 **P0 → P6** 提交 PR。  
2. P0：**D-170 已写入决策日志**；§6 rewrite/banner 文档同步（本批）。  
3. P1–P5：代码与编排删除；P2 必须先于 P5。  
4. P6：停 IO 固化；绿集与 §7 验收。  
5. 关闭任何仍指向 parity/FREEZE 为「现行」的外部 issue 链接（若有）。

**决策地图 Destination（P0 文档）已闭合。代码实施（P1–P6）按阶段推进。**
