# ADR-0011: ContentPackage as the Sole User-Facing Content Aggregate

Status: accepted (2026-07-14)

依据 2026-07-14 阶段性回头诊断（四路 Fable 5 并发 + Codex 独立深度评审融合，报告 `docs/reviews/stage-diagnosis-2026-07-14/05-synthesis.md` 与 `07-decision-log.md`）的复核结论，用户逐条拍板 D05-D07 三项架构决定。本 ADR 将其固化为正式架构决策，作为下一阶段所有页面与工程方案的总闸。

## Context（病灶）

诊断与 Codex 评审独立收敛到同一结构性病灶：产品当前**同时存在三套结果事实**，靠投影拼接成"看起来像一个内容库"，实际断裂——

1. 旧 Product `ContentItem`（小红书/抖音，发布 + 交付流程）；
2. P1 `CreativeContent`（`apps/core/src/p1/operations/application-service.ts:5638` 采用只把**单个** Asset 变成一个 Content，`assetIds: [asset.id]` 写死单元素数组）；
3. 独立 `DurableVideoWorkflow`（视频完成后进不了同一成品、内容库与版本体系）。

已核实的直接后果（file:line 锚定）：
- 商家在工作台"采用"一条文案后，打开 `/dashboard/content`（读 `state.contents`）看到"0 条内容"——采用写的是 `state.creativeContents`，两套事实靠投影拼接（`application-service.ts:5638` vs `content.tsx:100`）。
- **文案 + 多张图无法组成一个图文成品**（采用是单 Asset→单 Content）。
- 真实素材进不了媒体生成（`ark-media-adapter.ts:449-465`：`image.edit` 拒绝真实素材、`image.generate` 只传 prompt）——"真实素材驱动"当前只是授权门禁，不是画面输入。
- 桌面 `UnifiedCreationWorkbench` 与手机 `MobileActionBook` 是两套产品，P1 采用结果不能可靠进入手机后续。

这是诊断三条路径病根中最硬的一条（"两套（实为三套）事实未收敛"），也是竞品闭环对标"落不到自己产品上"的根因：CreatOK 的价值是真实闭环，我方做成了 fixture 下三套投影拼接的壳。

## Decision

### D05（总闸）— ContentPackage 成为唯一用户可见成品与输出事实源

新增或演进出一个用户可见的唯一聚合 `ContentPackage`，收束图文/视频/三平台 variants/版本/导出/复用/撤权。责任边界：

- **Product Store/Project/Asset**：唯一输入事实源。
- **Brief/Grounding**：一次执行的确认上下文与事实快照。
- **CreativeWork/CreativeJob/DurableVideoWorkflow**：内部执行、恢复与审计对象（不再是用户一级对象）。
- **ContentPackage**：唯一用户成品与输出事实源。内容库、编辑、版本、导出、复用全部只读写 ContentPackage。

ContentPackage 聚合形态（Codex FINAL-REVIEW §7.1；**决策当时**全仓零命中即真实空白——**2026-07-17 现状**：代码已有 `buildContentPackage` / `p1_content_packages` 写路径，且 `docs/evidence/contentpackage/real-run-0002/` 已接受连续商户旅程；real-run-0001 因生成图未进入同一聚合已驳回，不得再把本句读成「实现仍空白」）：
```
kind: image_text | video
source facts/assets · generated assets + child runs · editable versions
Xiaohongshu variant · Douyin variant · Video Account variant
rights/compliance state · export receipts · reuse lineage
```

十条状态契约（共 12 个状态字面量：draft/needs_input → generating/verifying → partial → review_ready → accepted → needs_replacement → cancelling/cancelled → save_unknown → export_failed；供应商 URL 过期用 owned archive 规则，不新增状态），每条含"必须行为"：不创建付费任务补齐缺项、使用原幂等键只查询、保留成功子任务只重试失败、幂等查询不重复版本、撤权阻止新导出。详见 Codex FINAL-REVIEW §7.3。

### D06 — 旧三套只迁移只读、不再双写

旧 Product `ContentItem`、P1 `CreativeContent`、独立完成视频降为**迁移来源 + 只读历史**。新采用只写 ContentPackage；内容库只读 ContentPackage。防止"收敛一半又长出新分叉"。

### D07 — Work/Job/Asset/模型/路由退出商家一级导航

商家一级导航只留：**创作 / 内容 / 素材 / 门店**。Work/Job/Asset/模型/供应商/报价/RouteSnapshot/canonical ID/技术日志降到二级详情。呼应 `REVIEW-NOTES.md` 第 4 节铁律"对象模型不应反过来统治首屏体验"与 Codex §5.2。

## Considered Options

- **继续投影兼容/打补丁**（`creativeContents`→`contents` 加映射层）——诊断已证明这条路"停在第一步、永远收敛不了"，三套事实的动作与生命周期仍断裂。否决。
- **保留三套双写、加同步机制**——双写一致性成本高，且 Codex 病根 B 明确"两源投影"是路径债本身。否决。
- **ContentPackage 唯一聚合 + 旧三套只读迁移**（本决策）——结构性重构，一次性解掉最硬路径病根。采纳。

## Consequences

- **性质是结构性重构，不是打补丁**：会动数据模型、迁移旧数据、改前端读写源。代价被用户明确接受（D05 拍板"批准，代价=结构性重构换根治"）。
- **约束力**：本 ADR 是下一阶段总闸。ContentPackage 与切换策略已获批，但实现仍需按 E1-E7 建设面推进；在迁移与真实验收完成前，不得把架构方向描述为已上线能力。
- **不 supersede 既有底座 ADR**：ADR-0001（数据架构：product facts 在 Core/Postgres）、ADR-0006（运行时拓扑）继续有效——ContentPackage 是**在这些底座之上**新增的用户成品聚合层，属 ADR-0001 中 "Content Core" 的收敛落地，不改数据归属与授权/审计要求。
- **与 ADR-0009 单一发布 Gate 一致**：ContentPackage 六工作流 E1-E6 一起通过才发布，不发半产品，落实 ADR-0009 的单发布闸 + D01（真实跑通才算完成）。
- **与 ADR-0008 D4 候选策略一致**：ContentPackage 的版本/编辑不改变"文案 3 选 1 单选采用"，采用后进入 Package 版本体系。（2026-07-17 注：「3 选 1」呈现政策已被合并版权威 D-023 取代为「默认一个主推荐、备选按需展开」；本条所述「单选采用进入 Package 版本体系」的机制不变。）

## 六条主线与一条管理员配套面（E1-E6 + E7，是一套产品的建设面，非分期发布）

```
E1 冻结 ContentPackage 聚合合同 + 状态机 + 平台版本 + 迁移旧三套
   ├─ E2 Brief/Grounding/准备度/授权统一（confirmed Brief 门禁）
   ├─ E3 图文/视频统一编排 + 真实素材进媒体（含 C+）+ 合规落到输出
   ├─ E4 三平台 variants/编辑/版本/回滚/导出/复用
   └─ E5 桌面/手机同一产品旅程（同一 Package + 状态机，设备只改布局）
            ↓
      E2-E4 接入 E5 界面骨架 → 历史迁移与对账
            ↓
      E6 完整真实验收（真实 provider 端到端；北极星测量 0→1 已于 real-run-0002 达成，count=1；≠ 一次面世）
            ↓
         一次面世

E7 管理员可视化配置中心（D11–D12，已批准/待开发）在配置持久层（票 05）完成后可与 E1–E5 并行建设；它不是第七条用户主线，但公开面世前必须满足其配置与审计门槛。
```

关联决策：D08（E3/E6 真实链路 + 素材进媒体）、D09（E1/E4 事实收敛 + E5 桌面手机统一）、D10（E4 中抖音只诚实标注、BYOK 接真实）、D11（E7 管理后台）、D13-D17（E5 设计选择）。

执行地图允许 E7 管理线在配置持久层（票 05）完成后与 E1–E5 并行；票 22 的首条真实链路也可在其最小依赖满足后先取证。图中的 E7 → E6 只表示一次面世前的发布闸顺序，不表示所有开发票必须串行。

本决定来自 2026-07-14 阶段诊断后的用户逐条拍板，是对既有 ADR 的传导落地而非重开：不重开 P1 Scope Lock，不改 ADR-0006 拓扑、ADR-0007 AI-SDK-first、ADR-0009 单发布闸。最大风险仍是"票关了体验没到"——故验收以 D01 硬 Gate（一条真实端到端跑通留证）+ Codex §11 完整面世验收清单为准，禁止以"后端就绪/组件完成/fixture 绿"关票。
