# 阶段性回头诊断 — 决策日志与追踪

> 目的：站在更高维度重判「面向本地商家（美业）的内容生产 Agent SaaS」当前真正所处的阶段。
> 触发：两轮 UIUX 冲刺（R1/R2，均分 3.83→6.50 EXIT PASS）后，产品缺口仍明显，怀疑开发流程需要重新梳理。
> 方法：Workflow 四路 Fable 5 并发，各深诊一维、落盘带证据锚点的详细报告；控制器（主会话）亲自合成最终阶段判定。
> 日期：2026-07-14
> Run ID：wf_823f273f-82a
> 状态：历史诊断快照；当前代码与决策以仓库 HEAD 和 07-decision-log.md 为准。

---

## 一、用户提出的核心问题（合成时必须逐条回答）

**Q1 — 技术栈与配套开发方案**
- 我们选的技术栈是否合理？
- 如果合理，配套的开发方案是否按预期进行？
- 有没有「更多的无效兜底」，或「老在打磨没必要的细节功能」，而真正的产品界面/适用功能迟迟不出现，一直停留在**代码复现阶段**？

**Q2 — 竞品对标为何落不到自己产品身上**
- 初期已给多个竞品 + 较多深度调研（references / doc 有详细记载）。
- 为什么这些对标迟迟没能落在我们自己的产品上？
- 是【开发路径问题】、【开发资源问题】、还是【时间问题】？

**Q3 — 过程记录（本条已在执行）**
- 项目大、内容多，关键结论与决策点要及时落盘本地，便于后续讨论和复盘，避免上下文膨胀后丢失。不要只留缓存。

---

## 二、统一阶段标尺（四路共用判据）

| 阶段 | 含义 |
|---|---|
| **L0** | 脚手架能跑 |
| **L1** | 核心链路 demo / recorded 能演示 |
| **L2** | 真实商家可端到端用（真模型、真数据、真产出、无致命兜底） |
| **L3** | 商家易用（低门槛、稳定、闭环顺滑） |

产品目标锚点：**「针对商家可用且易用的内容生产 Agent SaaS」= L2 达标并向 L3 迈进。**

核心商家链路（CONTEXT.md「P0 保 8」）：开店档案 → 真实素材库 → 小红书/抖音文案 → 成片视频 → 内容库 → 厚 L3 交付包 → 合规闸 → 手工线索台账。

---

## 三、项目真实路标（本次 scout 勘探结果，2026-07-14）

**后端 `@meiye/core`**（`apps/core/`）
- Node 22 + AI SDK v7 + `graphile-worker` 0.17 + `pg-boss` 12.26（**双队列，待查是否冗余**）+ PostgreSQL(pg 8.16) + sharp 0.34 + `@ai-sdk/mcp` + AWS Secrets Manager
- Ark（火山方舟）媒体适配器 `ark-media-adapter.ts` **888 行，最近 3 个 commit（22a9d4e）才加**
- **强信号 — recorded 兜底密集**：`p1/model-supply/adapters.ts` 出现 "recorded" 93 次、`runtime-config.ts` 33 次。待查：真实 provider 通路是否接通，还是主链路被挡在 demo 层。
- `apps/core/.data/p1-assets/` 下约 25 个 `ws_*` 本地工作区资产目录（recorded 产物）

**前端 `@meiye/web`**（`mkfast-template-main/`）
- TanStack Start + Better Auth + mkfast 模板；`src/product/` **72 个组件**；`src/routes/` 页面（dashboard / settings×13 / admin×8 / auth×5）
- R2 UIUX 冲刺塞入种子图 + 示例画廊（`example-store-preview.tsx`、`content.tsx` sampleGalleryCovers 等）——**待查是否「看着能用其实是假数据演示壳」**

**契约**：`packages/contracts/src/{product,uiux,product-schema,p1}.ts`

**决策权威**
- `CONTEXT.md`（术语 + 当前权威规则，2026-07-13 更新）
- `合集-v1.5-P0决策定稿.md`（3799 行，P0 决策定稿）
- `docs/adr/0001~0010`（数据/服务/合规/准入/部署/运行时/AI-SDK-first/视频/单发布闸/UIUX-路径B）
- `docs/specs/beauty-content-agent-{p0,p1}-spec.md`

**已有评审（11 份，站在其肩上判断增量）**：`docs/reviews/`
- `uiux-productization-gap-report-2026-07-13.md`（24 条对抗验证差距）
- `p1-code-quality-deep-review-2026-07-12.md` + remediation
- `creatok-uiux-code-deep-review-2026-07-12.md` + remediation
- `historical-review-implementation-reconciliation-2026-07-14.md`
- `references-docs-uiux-unfinished-upgrade-reconciliation-2026-07-14.md`
- `doc-consistency-audit-2026-07-12.md`
- `p1-deep-review-workflow-2026-07-11.md` / `p1-document-consistency-review-2026-07-11.md` / `p1-revision-plan-2026-07-11.md`

**竞品调研**：`references/analysis/`（00~16 编号）、`references/creatok/`（screenshots/network/reports/raw）、`references/benchmark/`

**近期 git 节奏（提示投入方向）**
- 最近 4 个 commit 转向后端真实能力：`22a9d4e feat: add Ark media execution adapters` / `ebcb11c persist creative briefs and grounding snapshots` / `b761764 promote generation results in workbench` / `fbd8e45 docs: reconcile historical reviews and product gaps`
- 此前一大段是 UIUX：`8d2edea` R2 EXIT PASS → T7 → T6 → T4 → T2 → T1 → T5 → T3（R2 全套）；再往前 R1 polish round 2、Tailwind Plus 快照

---

## 四、四路切分（Workflow：meiye-stage-diagnosis / wf_823f273f-82a）

| Lane | 维度 | 落盘 | 对应用户问题 |
|---|---|---|---|
| 1 | 技术栈合理性 + 无效兜底审计 | `lane-1-tech-stack.md` | Q1 |
| 2 | 前端「真界面/可用功能」vs「演示壳/代码复现」 | `lane-2-frontend-reality.md` | Q1 |
| 3 | 竞品对标为何落不了地 — 路径/资源/时间归因 | `lane-3-competitor-gap.md` | Q2 |
| 4 | 开发流程与节奏 — 是否陷入代码复现空转/兜底打磨过载 | `lane-4-dev-process.md` | Q1+Q2 |

每路铁律：发现带证据锚点（file:line / commit / doc+小节）；区分「已实现真跑 / recorded-mock 兜底 / 仅文档规划」；只诊断不改码；输出「现状实证 / 缺陷清单(P0/P1/P2) / 阶段判定 / 增量建议」四段。

---

## 五、四路摘要与最终合成 —— 已完成（2026-07-14）

> 四路零错误收敛。控制器已亲自复核四份落盘报告 + 核验关键锚点（REVIEW-NOTES.md 第 3 节用户纠偏真实存在）。
> **最终合成见 `05-synthesis.md`**（本目录）。

- [x] Lane 1 摘要：L1→L2 过渡带；技术栈本体最扎实无自写 framework；无一条真实供应商调用在 CI 内证明过，`live_verified` 由 sha256 哈希伪装（runtime-config.ts:91-94）；gateway 157 行报告冒充 PoC；Ark 888 行真调通但仅覆盖 8 媒体模型中 2 个；graphile 682 行死代码。
- [x] Lane 2 摘要：L2 界面就绪 / L1 真实体验分裂；07-13 差距报告已过时（前端 P0 群已真实修复）；默认开箱 100% fixture 假流 + 43 张 seed 装饰图，无一处真实生成；真实渲染管道其实通，短板在"真实商家从未端到端用过一次"。
- [x] Lane 3 摘要：功能对标抄到 80%、闭环对标做浅；根因主线=开发路径问题（命中 6/9），非资源/时间；P0=accepted 内容进不了一级库（application-service.ts:5638）+ 真实媒体/抖音未激活。
- [x] Lane 4 摘要：L1 已达成且被过度加固、L2 零证据——闲鱼"测试循环陷阱"第三次同构复发；被 CONTEXT.md:20/113 措辞半制度化豁免；用户已在 REVIEW-NOTES 启动收口。
- [x] **最终阶段判定**：**L1 已达成且被过度加固，L2 零证据、未跨越。** 距 L2 只差"最后一公里"，而这一公里是产品价值的全部。
- [x] **Q1 回答**：技术栈合理（最扎实层，不返工）；但无效兜底严重（236 处 recorded / 157 行伪 PoC / 682 行死代码 / 用真 ffmpeg 合成假 mp4）；"老打磨没必要细节"成立（T1-T7 七轮把评分 3.83→6.50，真出图仍 disabled）；"停留代码复现"需修正为"演示壳做到以假乱真 L3 保真度，真实商家从未端到端用过一次"。
- [x] **Q2 回答**：**开发路径问题**，非资源非时间。证伪资源不足（411+234 测试全绿+72 组件+假 mp4 都修）、证伪时间不足（后置项是主动决策）；三条病根=done 语义坍缩 + 两套事实未收敛 + 局部优化代替结构重构。
- [x] **下一阶段力量投向**：冻结 L1 打磨，100% 投 L1→L2 跨越。七个动作 A-G（见 05-synthesis §四）：A 把 done 钉在"一条真实跑通"改 CONTEXT 措辞 / B 冻结 UIUX 追分 / C 跑通并录制一条真实链路 / D 先收敛两套事实 / E 抖音BYOK 停止"只差 Key"表述 / F 北极星换"真实跑通链路数(当前=0)" / G 评审设两轮熔断。

---

## 六、Codex 深度评审融合（2026-07-14 追加）

用户提供 Codex 独立评审 `.scratch/product-value-deep-review-2026-07-14/FINAL-REVIEW.md`（NO-GO + ContentPackage 处方 + 六工作流 E1-E6）。控制器逐条核实其技术底锚点后融合进 `05-synthesis.md §六`：

- **核实为真（我四路漏抓的三个新 P0）**：①真实素材进不了媒体生成（`ark-media-adapter.ts:449-453` image.edit 直接拒绝、`:464-465` generate 只传 prompt+size）②无唯一成品聚合、采用只转单 asset（`application-service.ts:5638` `assetIds:[asset.id]`），实为三套结果事实并存 ③桌面/手机两套产品。
- **核实为 Codex 高估（修正后收录）**："Workbench 不调用 Brief update/confirm" 部分过时——`workbench:1007-1024,1539,1542` 已真接线；成立的一半是"无 Brief 仍可提交"（`application-service.ts:5092`），口径修正为「接了但松」。
- **处方收录**：动作表升级——新增动作 0（拍板 ContentPackage 唯一成品架构，约束全部后续）、C+（素材进媒体）、D+（桌面手机同一产品）；执行序按 Codex E1→E2-E4→E5→E6。
- **联合结论**：两份评审独立收敛同一总判；四路=病理（在哪/为何），Codex=处方（往哪走）；不冲突，Codex 是我方向动作的架构落地版。

---

## 七、新增待开发功能登记（2026-07-14 用户提出）

**管理员后台可视化配置中心** —— 详见 `06-backlog-admin-control-plane.md`。用户原话："所有的配置功能要能够简单清晰地在前台进行设置，不用每一次进行代码级的修改，或者模型的配置。"

- 勘探结论：admin 后台"一半有肉一半空壳"——`admin-model-control.tsx`（1876 行，模型目录草稿/发布/回滚真可写）是地基；但**诊断锚定的运行时配置项零可视化**（执行模式 env、provider 凭据、`main.ts:326,334` 硬编码 adapter 装配、激活证据），且**无任何 DB 配置持久层**（模型目录 in-memory `new Map`，前台配了重启即丢）。
- 定位：不是范围膨胀，是诊断病根"改代码才能配"的根治；隐藏前置=配置持久层。
- 状态：**待拍板**（用户明确后续统一拍板），与 ContentPackage 六工作流一起排序。
