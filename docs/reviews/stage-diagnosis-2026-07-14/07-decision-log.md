# 阶段诊断 · 拍板决策记录（Decision Log）

> 用户逐条核对拍板，2026-07-14。控制器落盘固化，避免上下文膨胀丢失。
> 待决策全景见 `05-synthesis.md §四`；本文件只记「已拍板」结论 + 实际动作。
> 状态图例：✅ 已拍板 ｜ 🔨 已执行动作 ｜ ⏳ 待拍板 ｜ 💤 暂缓

## 决策清单总览（2026-07-14 全部拍板完毕）

| # | 决策 | 结论 | 状态 |
|---|---|---|---|
| D01 | done 定义钉死"一条真实跑通" | 批准 | ✅🔨 CONTEXT.md 已改 |
| D02 | 冻结 UIUX 追分（6.50 停） | 批准 | ✅ 即时生效 |
| D03 | 北极星换"真实跑通链路数"（当前=0） | 批准 | ✅ 即时生效 |
| D04 | 评审两轮熔断 | 批准 | ✅ 即时生效 |
| D05 | ContentPackage 唯一成品事实源【总闸】 | 批准 | ✅ ADR-0011 |
| D06 | 旧三套只迁移只读、不再双写 | 批准 | ✅ ADR-0011 |
| D07 | Work/Job/Asset 退出商家一级导航 | 批准 | ✅ ADR-0011 |
| D08 | 动作 C/C+：第一条真实链路 + 素材进媒体 | 批准 | ✅ LLM 三模板已先行落地 |
| D09 | 动作 D/D+：事实收敛 + 桌面手机同一产品 | 批准 | ✅ 依赖 D05 骨架 |
| D10 | 抖音/BYOK | 抖音只诚实标注；BYOK 现在接真实 | ✅ 用户细分拍板 |
| D11 | 管理员可视化配置中心（+持久层前置） | 批准全量列入（E7/配套管理面） | ✅ 已批准，待开发 |
| D12 | 标准 SaaS 管理后台 UI | 并入 D11 | ✅ |
| D13 | 默认主题=亮色优先中性偏暖 | 采纳 | ✅ |
| D14 | 状态用语=创作中/可使用/需处理 | 采纳 | ✅ |
| D15 | 费用=生成前简单提示明细二级 | 采纳 | ✅ |
| D16 | 首次示例=独立入口不混个人库 | 采纳 | ✅ |
| D17 | 手机=轻编辑+结果决策，版式留桌面 | 采纳 | ✅ |
| D18 | R2 遗留清理 | 一揽子批准（优先级最低） | ✅ |
| 补 | 三原生 LLM 模板（OpenAI/Anthropic/Gemini） | 路线甲：原生优先，中转后配 | ✅🔨 已落地全绿 |

**执行总序**（依赖驱动）：D01-D04 已生效 → ContentPackage ADR（D05-D07 固化）→ E1 冻结聚合合同 → E2-E4（含 D08/D09/D10-BYOK）+ E5 界面骨架（含 D13-D17）→ E7 管理后台（D11）→ E6 真实验收（北极星 0→1）→ 一次面世。D18 随手/攒批。

---

## 组一 · 立即止血（零代码/砍仪式，2026-07-14 全部批准）

### ✅ D01 — 改 done 定义，钉死"一条真实跑通"
- **拍板**：批准。把"P1 功能完成"硬钉在"至少一条真实 provider 端到端跑通并留证"，删除"真实账号未就绪也算闭环完成"的豁免措辞。
- 🔨 **已执行**：`CONTEXT.md` 两处已改——
  - `P1 功能完成` 定义（原 20-21 行）：加"and at least one must-have merchant journey … run end-to-end through a real provider with 留证 evidence；Recorded/fixture green tests alone do not satisfy"；`_Avoid_` 补"recorded 全绿即完成, 无真实跑通证据宣称完成"。
  - `模型供应 P1 闭环`（原 113 行）：删"even when individual live deployments remain conditionally inactive"的豁免，改为"the affected capability is 未完成/待激活, not 闭环完成; at least one real end-to-end run is required"；`_Avoid_` 补"真实账号未就绪也算闭环完成"。
- **意义**：堵住诊断 Lane 4 抓到的"空转被半制度化豁免"漏洞（`p1-deep-review:150` 被驳回的那条建议就此扶正）。

### ✅ D02 — 冻结 UIUX 追分
- **拍板**：批准冻结。6.50 分停在当前水位，不再追 8.0；停止 token/密度/CTA 微调 + S 系列逐步 evidence + 元评审对账。
- **生效**：即刻。当前正在流血的伤口（力量还在往打磨走）就此止住；力量掉头投真实链路。
- **注意**：这不否定已完成的 R2 成果（6.50 是真实进步），只是停止边际收益趋零的继续追分。

### ✅ D03 — 北极星换"真实跑通链路数"
- **拍板时测量（2026-07-14）**：当前=0（标题历史写法「（当前=0）」仅表示拍板日快照，不是永久现值）。
- **拍板**：批准换指标。替代评分/绿测数/票关闭数这些 L1 内部指标。
- **规则**：在计数从 0 变 1 之前，任何 UIUX/评审/recorded 完备性都不计入产品进度；计数达到 1 之后，UIUX/评审/recorded 仍不能单独替代真实跑通证据。
- **现值（2026-07-17）**：真实跑通链路数 = **1**（`docs/evidence/contentpackage/real-run-0002/journey/`）。real-run-0001 为聚合矛盾驳回样本；现值 ≠ P1 功能完成 / 可面世。
- **与用户既有拍板一致**：`REVIEW-NOTES.md` 第 3 节"一次性交付可真实使用、可完整评审的单店产品"。

### ✅ D04 — 评审设两轮熔断
- **拍板**：批准。review→remediation→re-review 最多两轮；第三轮强制"要么真跑验证、要么标 open 冻结"，不再产出新评审文档。
- **意义**：11 份 review + 多份 remediation + 两份元对账已越健康阈值；熔断防评审自循环。

---

## 组二 · 架构地基（ContentPackage 总闸）— ✅ 2026-07-14 全部批准

### ✅ D05 — ContentPackage 成为唯一用户成品与输出事实源【总闸】
- **拍板**：批准。ContentPackage 收束图文/视频/三平台 variants/版本/导出/复用/撤权，成为唯一用户可见成品聚合。内容库/编辑/版本/导出/复用全部只读写它。
- **性质**：这是**结构性重构**，不是打补丁——会动数据模型、迁移旧数据、改前端读写源。一次性解掉诊断三条路径病根里最硬的一条（三套事实未收敛）。
- **约束力**：Codex 明示"这一项约束后面所有页面和工程方案"。D08/D09 及后续所有真能力动作以它为地基。
- **代价接受**：用户选"批准（代价=结构性重构非打补丁，但一次性解掉最硬路径病根）"，即认可重构成本换根治。

### ✅ D06 — 旧三套只迁移只读、不再双写
- **拍板**：批准。旧 Product ContentItem / P1 CreativeContent / 独立 DurableVideoWorkflow 降为"迁移来源 + 只读历史"，新采用只写 ContentPackage。
- **意义**：防止"收敛一半又长出新分叉"（诊断病根复发的典型）。

### ✅ D07 — Work/Job/Asset/模型/路由退出商家一级导航
- **拍板**：批准退一级。商家一级导航只留：创作 / 内容 / 素材 / 门店（Codex §5.2）。Work/Job/Asset/模型/路由/RouteSnapshot 降到二级详情。
- **呼应**：REVIEW-NOTES"对象模型不应反过来统治首屏体验"、Codex"这些不是用户一级产品对象"。

**组二联合影响**：三条共同确立"唯一成品事实源 + 单向迁移 + 商家一级导航收束"三支柱。已通过 ADR-0011 与 `CONTEXT.md` supersede 旧的"三套事实投影兼容"隐含路径。

---

## 补充执行 · 三原生 LLM 模板（G1-G4 缺项补足）— ✅ 2026-07-14 已落地全绿

- **触发**：用户指出原始开发要求「三组供应商 OpenAI/Anthropic/Gemini 的原生格式是固定模板」。审计发现**契约层三家齐全、执行层只落 OpenAI 一家**：`AnthropicDirectRecordedAdapter`/`GeminiDirectRecordedAdapter` 名字带家族但父类是 recorded 桩；真实 runner 只有 `createOpenAICompatible`（`ai-sdk-runner.ts`）。
- **用户拍板**：路线甲——**优先三原生模板**，中转站后续手动适配（难度不大）。
- **已执行**（改动最小、surgical）：
  - 装 `@ai-sdk/anthropic@4` + `@ai-sdk/google@4`（官方 provider）。
  - `ai-sdk-runner.ts`：抽 `createNativeLanguageModel(options)` 按 `apiFamily` 分发——openai→`chatModel`、anthropic→原生 `/v1/messages`、gemini→原生 `generateContent`；**三家共用全部业务逻辑**（generateCopy/streamAssistant/startCopyStream 只依赖 `this.model`），options 加 `apiFamily?` 字段（默认 openai 向后兼容）。
  - `runtime-config.ts`：`directOptions` 从「只接受 openai」改为「接受 openai/anthropic/gemini 三家 native family」，返回 `apiFamily` 传给 runner。
  - `.env.example`：注释说明 catalog model id 自动选家族模板。
- **验证**：四闸全绿——typecheck ✅ / 424 测试（404 pass/20 skip，**新增 2** 个家族路由断言证明 anthropic→`/messages`、gemini→`generateContent` 真路由非假接）/ biome ✅ / secret-scan `findings:[]` ✅ / decision-guard ✅。`runtime-config.test` 反转旧断言（`llm-anthropic` 从「被拒」→「接受」）。
- **凭据**：tu-zi 中转 Key 存 `docs/_private/tuzi.env`（gitignore + secret-scan 范围外），`.env` 只留占位指路；LLM 探针实测通过（`gemini-3-flash-preview` 经 tu-zi 真实返回）。
- **待办**（用户定后续做）：① 真实 provider 端到端冒烟（凭据已备）② 中转站媒体手动适配 `TuziMediaAdapter`（tu-zi 图片 `/v1/images/edits`、视频 `/v1/videos` 格式与 Ark 原生不兼容；其 `reference_image` 角色恰好解 C+ 素材进媒体缺口）。

---

## 组三 · 真能力主战场 — ✅ 2026-07-14 拍板

### ✅ D08 — 动作 C/C+：跑通并录制第一条真实链路 + 真实素材进媒体
- **拍板**：批准 C/C+。把第一条真实商家链路（真档案→真模型文案→真图/片→真入库→三平台版本）端到端跑通并留证；含修复"真实素材进媒体生成"（`ark-media-adapter.ts:449-465` 现拒真实素材）。
- **执行状态**：LLM 三模板已通（见补充执行章）；素材进媒体的路子已探明——tu-zi `/v1/videos` 的 `reference_image`/`reference_video` 角色天然支持传参考图/视频 URL，正好解 C+ 缺口。
- **依赖**：真实链路落库形态依赖 D05 ContentPackage 骨架；凭据已备（`docs/_private/tuzi.env`）。

### ✅ D09 — 动作 D/D+：收敛结果事实 + 桌面手机同一产品
- **拍板**：批准 D/D+。改 `application-service.ts:5638` 单元素数组 → 支持"文案+多图成一个成品"；桌面/手机同一 ContentPackage + 状态机，设备只改布局。
- **性质**：D05 ContentPackage 的落地实现。

### ✅ D10 — 抖音只诚实标注、BYOK 现在接真实【用户细分拍板】
- **抖音**：**只诚实标注**。不真接（等 pilot 触发点，符合 CONTEXT 条件启用能力）。动作 = 把 `main.ts:334` 的 `RecordedDouyinAdapter` 及目录/文档里"只差 Key"式表述改为诚实标注"未接入（硬编码 recorded）"，与真能实现的能力区分开。
- **BYOK**：**现在接真实**。BYOK 不绑平台审核（商家自带 key 直接调），可独立于抖音先做。动作 = 换掉 `main.ts:326` 的 `RecordedByokExecutionAdapter`，接真实 BYOK 执行通路。
- **依据**：两者原是同类"硬编码桩+误导表述"问题（诊断动作 E），但时机不同——BYOK 无 pilot 依赖故先行，抖音待 pilot 故先止表述。

---

## 组四 · 新功能 — ✅ 2026-07-14 拍板（D11）

### ✅ D11 — 管理员可视化配置中心（+配置持久层前置）
- **拍板**：批准全量列入待开发。所有配置前台可设、不再代码级修改。
- **范围**：六个配置域（模型执行配置/集成连接器/套餐定价额度/合规开关/审计运维健康），详见 `06-backlog-admin-control-plane.md`。
- **隐藏前置**：配置持久层（DB 配置表 + 配置服务），否则前台配了重启即丢（当前模型目录 in-memory `new Map`）。
- **与用户"标准 SaaS 管理后台 UI"诉求合并**。排序：候选 E7 或作 E3/E6 配套管理面，与 ContentPackage 六工作流一起排。

## 组五 · 设计选择 — ✅ 2026-07-14 全部采纳（Codex §13 推荐）

- ✅ **D13 默认主题**：亮色优先、中性偏暖，暗色可选。（面向美业门店新手，不用开发者暗色审美）
- ✅ **D14 状态用语**：统一"创作中 / 可使用 / 需处理"。
- ✅ **D15 费用显示**：生成前只显示简单用量/费用提示，明细放二级。
- ✅ **D16 首次示例**：独立"查看示例"入口，不混入个人内容库。
- ✅ **D17 手机编辑边界**：手机完成轻编辑 + 结果决策，精确版式编辑留桌面。

## 组六 · 遗留小项 — ✅ 2026-07-14 一揽子批准（D18）

- ✅ 场景货架 primary 按商家品类动态排（当前全美甲）
- ✅ social_cover 退出精选位（可翻案）
- ✅ 40 张 raw PNG（~80MB）归档、不入 git（`docs/design/图片/` 已 gitignore）
- ✅ 5 个孤儿 i18n key + 旧 model-preview png 出清理票
- **优先级最低**，不占当前主战场力量；清理票可随手做或攒批。

---

## 待办（拍板衍生的落盘动作）
- [x] 新建 ADR：ContentPackage 唯一成品架构（记 D05-D07 + E1-E7 建设面中的 E1-E6 依赖序）→ [`docs/adr/0011-contentpackage-sole-content-aggregate.md`](../../adr/0011-contentpackage-sole-content-aggregate.md)
- [x] 更新 CONTEXT.md：加 ContentPackage 术语 + 标注旧三套为迁移来源/只读 + 一级导航收束
- [ ] 真实 provider 端到端冒烟（三模板 + 素材进媒体，凭据已备）→ 已进票 22（E6 验收票）
- [ ] TuziMediaAdapter（tu-zi 图片/视频手动适配，含 reference_image 解 C+）→ 已进票 10
- [x] 统一 commit：.gitignore（docs/_private 保护）+ 三模板代码 + CONTEXT done 定义（D01）+ 决策文档（5 commit：7f2ff33/9a00204/2e3e3d4/cd45f87/a386e82）
- [x] commit ADR-0011 + CONTEXT ContentPackage 术语（`10c8a6e`；后续导航措辞修订随当前文档审计提交）
- [x] **决策 → spec → tickets 落地（2026-07-15）**：to-spec 合成 [`docs/specs/contentpackage-productization-spec.md`](../../specs/contentpackage-productization-spec.md)；to-tickets 拆 22 张 tracer-bullet 垂直切片票（22 agent workflow 并发执笔，逐票实核锚点漂移）→ [`.scratch/contentpackage-productization/`](../../../.scratch/contentpackage-productization/MAP.md)（MAP 波次图 + decision-ticket-map.json 机器真相 + guard 双清单接线，票 01 为关票 gate）。commit `81243c2`（guard 多清单）+ `812c61a`（spec + 22 票）。D08-D18 全部映射入票；D01-D04 为验收/流程护栏不单独立票。
