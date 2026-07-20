# 全量功能票包 Codex 六路复审（2026-07-18）

> **状态：历史票体复审快照。** 本报告继续作为 #25–#49 修订依据与属主证据，但不表示当前实现仍待开工；后续完成度与残差以 [`implementation-gap-ledger-2026-07-19.md`](./implementation-gap-ledger-2026-07-19.md) 和当前代码/测试为准。

- 对象：GitHub issues #25–#49（25 张，全量功能开发票包，parent #24）
- 方法：6 路 Codex exec 并发（主会话 bash driver，read-only 沙箱），按域分组，五维复审：锚点真实性（±20 行）/ D-001~D-041 一致性 / 验收可判定性与阻塞边 / 防重复 / 同批交叉冲突
- 原始报告：`.scratch/ticket-review-codex-2026-07-18/lane1-infra.md` ~ `lane6-delivery.md`
- 处置：25 票全判「需修订」；裁决后以「复审修订节」追加至各 issue 票体（本节口径优先于上文冲突处），2026-07-18 已全部回写。修订稿在 `.scratch/tickets-full-feature-2026-07-18/amend-*.md`，最终票体 `.final-*.md`

## 1. 总量与 P0 分布

六路合计约 22 个 P0、40+ 个 P1/P2，全部裁决采纳（无驳回——各路证据均带代码实锤）。P0 集中在五类：

1. **放行门/能力门诚实性**（4 路独立命中）：五类入口空壳上线违 D-023（#36/#44/#45 等）；抖音生产装配仍是 RecordedAdapter 不得称已验证（#42）；成片能力证据齐前不标已验证（#27）。
2. **唯一事实源**：legacy handoff 兼容选项违 ADR-0011，改唯一方案=ContentPackage 原生台账+legacy 只读投影（#42）；审计层双属主收口为 #35 独占、#48 只注入 sender（#48）。
3. **冒充/伪装**：候选 A 改名主推荐（#29）、静态 openingSuggestions 伪装个性化推荐（#44）、恒零 repair 率伪装已观测（#31）、跨环境 hash 假确定性合同（#40）。
4. **重复建设**：ExampleStorePreview 已建（#44）、Light Composer/模板目录/导出链已建（#40）、asset 撤权≠IP 生命周期可复用（#39）、reuseContentPackage 复制语义违 D-014（#43）。
5. **语义混淆**：Provider 成本≠产品售价（#27）；AIGC 验收须按开关分支（#27）；OCC 冲突审计口径统一（#30/#35：无业务残留+恰一条 revision_conflict 权威审计）；事件游标 sequence 与聚合 revision 分名（#25/#30/#33）。

## 2. 阻塞边变更（以各票复审修订节为准）

#29→+#35；#35→#29/#30(B)/#31/#32/#33(A)/#34；#38→+#36；#39→#35/#36/#42/#43；#40→+#36；#44→#29/#35/#36/#37；#45→#36/#37/#41/#42；#47→#35/#36/#42；#49→+#48。#33 不依赖 #35（#35 依赖 #33A，防成环）。

## 3. 超窗票的内部分批（不炸 issue 数，票内按序落 PR）

#27=A 参数贯通/B AIGC+provenance/C 字幕+评分器/D 旧 provider 退役/E 整链测试；#30=A 存储层/B 调用链；#33=A 服务端/B 前端；#32=A 账本/B 编译/C 失效联动;#34=A 执行择优/B 七门 validator；#35=A 注册路由/B 审计 OCC 决定接缝/C 合同 e2e+删 PoC；#42=A 批准域/B 发布导出桥/C 原生台账（#46 只依赖 C）；#43=A 做同款系列/B 学习旁路。

## 4. 跨票唯一属主矩阵（合并 L2/L3/L5/L6 裁决）

| 能力 | 唯一属主 | 其他票 |
|---|---|---|
| ①③节点、StructuredNodeRunner 窄口 | #31 | #35 调用 |
| 事实账本/六维编译/Bundle revision | #32 | 入口票只消费冻结 ContextBundle，禁直读账本 |
| ④执行择优+七门 canonical validator | #34 | #35/#42 按阶段调用；#49 只做离线 cases+parity |
| ⑤回装/生产 workflow/DecisionTrace 持久化/审计表/outbox/补偿 worker/决定接缝 | #35 | #48 注入 sender；#36/#47 消费决定接缝 |
| SSE 传输协议实现 | #33 | 协议 schema 归 #25 |
| 主推荐呈现 | #29 | #35 只交付 recommendedAssetId+解释数据 |
| 五类 chips/上下文切换/QuestionCard | #36 | #44 只做首页布局与冷态；入口票只做配方 |
| 视频候选质量评分 | #27 | 独立于 #34 scorer |
| 系列/晋升机制+Preference 持久化 | #43 | #39 消费 |
| 结果台账命令 | #42 | #46 只消费展示 |
| Langfuse 部署/映射/prompt mgmt/dataset importer | #48 | #49 只交 EvalRun artifact |

## 5. 上游勘误

- r1-video-wiring.md:192 `runtime-config.ts:206` 为错锚（实为 gateway 解析）；正确=`runtime-config.ts:217-260`+`adapters.ts:2030/2124`（已写进 #27 修订节，r1 正文不改，按本报告口径引用）。
- 各路共报约 15 处行号漂移/语义错位（:682 用量台账非血缘、:452 列表非回写、5344 声明非判断等），均已在对应票修订节勘正。

## 6. 其他

- 复审确认无医美默认纳入、无店务越界（#45 补 CTA 边界防线）、Stage 2 无明文偷渡（#43 补 inactive_stage2 关严）。
- 待验证 4/15 措辞由「调研已答」统一改为「实现边界已定、研究仍未答」。
- 本轮改动（票体回写在 GitHub；本报告+scratch 材料在仓库）未提交，待 commit 指令。
