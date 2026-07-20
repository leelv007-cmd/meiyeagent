# 文档一致性全面复核 — 2026-07-17

状态：**当前一致性入口；grilling 已收口（用户 2026-07-17 认同 A/B/C 三层口径）**

本轮使用 `grill-with-docs`（`/grilling` + `/domain-modeling`），**Agent Team 五路并发只读审计**后汇总。  
权威状态以 **2026-07-17 已接受的 real-run-0002** 为准；real-run-0001 因生成图未进入同一 ContentPackage 聚合已驳回，不计数。

**已执行（A → D → G）：**  
- **A**：CONTEXT 入口 → 本报告；07-16 SUPERSEDED；Language 拆清 A/B/C。  
- **D**：`build-manifest.mjs` + 重生 `decision-ticket-map.json`：DEC-NORTH-STAR 当前=1；票 22 `closureEvidence` 挂 journey（**status 仍 open**）；MAP 同步；票 22 差距锚点改写；spec Problem 去掉「至今为 0」现时态；`decision-ticket-guard` 通过。  
- **G**：ADR-0011 现状注 + E6 图注；07-15 SUPERSEDED 横幅与矩阵 as-of；07-11 指针改 07-17；D03 决策 annotate 拍板时值 vs 现值。  

**用户认同收口口径：**  
1. 北极星 count = 1（evidence register）  
2. P1 功能完成 / 可面世：仍未宣称  
3. 票 22 open 不否定 count=1  
4. 一致性入口 = 本报告  

**仍可选（非本轮范围）：** 票 22 正式 close；stage-diagnosis 其它页轻量 banner。双账 DoD 已于 2026-07-17 从保留的同 run seam transcript 与 Postgres 账本补齐。

## 一、当前权威状态（事实，非待决）

| 项 | 现值 |
|---|---|
| 真实跑通链路数 | **1** |
| 证据根 | `docs/evidence/contentpackage/README.md` + `real-run-0002/journey/` |
| runId | `real-run-0002-1784236289412` |
| packageId | `content-package-5f75c81790ceb090a397c975`（`accepted` / 可使用） |
| CONTEXT Language「真实跑通链路数」 | Current counted value: **1** |
| contentpackage-productization-spec Solution / §10 | 当前 = **1** |
| 破零 ≠ 可面世 | ADR-0009 E1–E7 + Gate 0 仍适用（p0-release-evidence north-star note 已写） |
| ContentPackage 代码 | 已有写路径（`buildContentPackage` / `p1_content_packages` / adopt / variants 等） |
| 票 22（decision-ticket-map） | 仍 `open`，已挂 real-run-0002 六项 `closureEvidence`，`blockedBy: [06,09,11]`，gate 01 仍 open |
| Pro Studio | ADR-0012 加购线；非默认导航；外售需 N2 + 验证门（文档未过宣称） |

### 权威顺序（2026-07-17 已写入 CONTEXT）

> 补注（2026-07-17 深夜）：本顺序限于 ContentPackage 计数与一致性域。产品方向与决策的唯一最高权威 = `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001~D-038，同日晚合并落盘），高于本报告及下列全部条目；见 CONTEXT.md「2026-07-17 宣发产品方向」段。

1. 最新用户确认决策 + 本报告（2026-07-17）  
2. `docs/evidence/contentpackage/`（计数登记处）  
3. `CONTEXT.md` Language（活计数与术语）  
4. `docs/specs/contentpackage-productization-spec.md` + ADR-0011 / 0012  
5. `decision-ticket-map.json`（票图与关票；**关票 ≠ 北极星计数**）  
6. `docs/reviews/doc-consistency-audit-2026-07-16.md` → **历史**（Pro Studio 边界裁决仍可用，计数句过期）  
7. 更旧 reviews / stage-diagnosis → 历史快照  

## 二、三层口径（必须拆开）

| 层 | 含义 | 当前 |
|---|---|---|
| **A. 北极星计数（D01/D03 测量）** | 连续 must-have 商户旅程 + 真 LLM + 真媒体 + 脱敏证据 | **1** |
| **B. P1 功能完成** | 锁定 must-have **全部** + release Gate + ≥1 真实旅程 | **未宣称**（B 充分条件未齐） |
| **C. 可面世 / 可公开收费** | ADR-0009 E1–E6+E7 + Gate 0 + 商业/合规块 | **未宣称** |

错误粘连：把 A 当成 B 或 C；或把 B/C 未完成说成 A 仍为 0。

## 三、FINDINGS（合并五路审计，按风险）

### P0 — 会把 agent/人带回错误「当前」

| ID | 位置 | 过期/危险声明 | 正确口径 | 建议处置 |
|---|---|---|---|---|
| C01 | `docs/reviews/doc-consistency-audit-2026-07-16.md` §四.6 / §五 | 真实跑通仍为 0；D01 仍为 0 | 计数=1；B/C 仍未完成 | **rewrite 或整体降级为历史** + CONTEXT 改入口 |
| C02 | `.scratch/contentpackage-productization/MAP.md` | 北极星 当前=0 | 当前=1 | rewrite current |
| C03 | `decision-ticket-map.json` `DEC-NORTH-STAR` | userVisibleContract 当前=0 | 当前=1 | rewrite machine truth |
| C04 | 票 22 正文 + map status | 北极星=0；evidence 不存在；open / 空 closureEvidence | 旅程已 accepted | 回填 evidence；是否 close 待决 |
| C05 | `contentpackage-productization-spec.md` Problem Statement | 「跑通一次的数字**至今为 0**」 | 同文件 Solution 已=1 → **文内自相矛盾** | rewrite Problem |
| C06 | ADR-0011「全仓零命中即真实空白」类实现现状句 | 暗示 ContentPackage 仍空白 | 代码已有写路径 + real-run package | annotate / rewrite 现状句 |

### P1 — 易误读或清单滞后

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| C07 | `CONTEXT.md` authority 段 | 仍以 07-16 为一致性入口；D01 句易读成「无旅程则 P1=0」且旅程已存在 | 升 07-17 入口；拆 D01 测量 vs P1 功能完成 |
| C08 | `CONTEXT.md` P1 功能完成 `_Avoid_` | 未显式禁「count≥1 即完成」 | 补 avoid |
| C09 | 票 22 DoD 双账 | ~~manifest usage 全 null~~ | **已补齐**：`journey/ledger-evidence.json` + manifest 非空摘要 |
| C10 | 07-15 一致性审计正文 | 以「当前」写 count=0 / ContentPackage 未落地 | 加强 SUPERSEDED 横幅（body 冻结） |
| C11 | 07-11 文档一致性报告 | 仍指向 07-15 为当前准据 | 改指针到 CONTEXT + 最新审计 |
| C12 | D03 决策标题焊死「（当前=0）」 | 0 是拍板日快照 | annotate 现值指针 |
| C13 | spec Further Notes | 媒体 e2e「后续待办」 | 改为已有 real-run 图链路，视频/其他仍待 |
| C14 | 全 22 票 open | 实现与证据超前于关票账 | 过程修复，勿读成功能全无 |

### P2 — 历史可保留

| ID | 位置 | 建议 |
|---|---|---|
| C15 | stage-diagnosis 05/00/lane-4 等「当时=0」 | A 类历史；可选轻量 banner |
| C16 | ADR-0011 E6 图「0→1」 | 目标语言可留；可注「测量已达 1」 |

## 四、已一致（勿回退）

- evidence register count=1 + journey 产物  
- CONTEXT Language 北极星 =1  
- productization-spec Solution / §10 =1  
- p0-release-evidence north-star note（破零 ≠ 可面世）  
- PRODUCT.md 北极星定义（未写死 0）  
- Pro Studio：未宣称可卖/默认导航  
- P1 spec：未宣称功能完成 / 可公开收费  

## 五、验证

- 五路 explore 只读审计（2026-07-17 会话）  
- 证据目录与 manifest `acceptanceChecklist` 全 true  
- `pnpm check`（含 secret-scan）在证据落盘后曾全绿（实现侧 TS 已修）  

## 六、grilling 拍板与执行

| 问 | 拍板 | 状态 |
|---|---|---|
| 1 入口 | **A** | 已执行 |
| 2 机器真相 | **D** | 已执行（票 22 open + evidence 挂接） |
| 3 剩余债 | **G** | 已执行 |
| 收口 | 用户**认同**四条口径 | **grilling 结束** |

## 七、结论（一句话）

**产品计数层与一致性入口已对齐 count=1；07-16/07-15 降为历史；MAP/DEC-NORTH-STAR/票 22 已证据先记账（关票流程仍 open）；A/B/C 三层已拆开。破零 ≠ P1 功能完成 ≠ 可面世。grilling 收口。**
