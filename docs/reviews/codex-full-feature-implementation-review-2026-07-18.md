# Codex 全量功能实施深度评审报告（2026-07-18）

> **状态：固定提交快照。** 本报告中的票完成度、测试数字和缺口只适用于 `72acd06..ccdb342`；后续处置以 [`implementation-gap-ledger-2026-07-19.md`](./implementation-gap-ledger-2026-07-19.md) 和当前代码/测试为准，正文保留原始证据。

**评审对象**：25 张票（GitHub #25–#49）的 Codex 实施成果，范围 `72acd06..ccdb342`（60 commits，244 文件，+35,905 / −1,652 行），四条 lane（harness / data-storage / video / frontend）已全部合并回 main。
**评审方法**：主会话基线实测（typecheck + 四层测试真跑）+ Workflow 多 agent 评审（25 路逐票核验 + 6 路横切审计，全 Opus）+ P0/P1 发现逐条对抗验证。
**权威链**：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001~D-041）> spec #24 > 票体（含复审修订节）；跨票职责按 `docs/reviews/ticket-pack-codex-review-2026-07-18.md` §4 唯一属主矩阵。

---

## 1. 基线事实（主会话实测，非 agent 转述）

| 检查项 | 命令/条件 | 结果 |
|---|---|---|
| contracts 单测 | `pnpm --filter @meiye/contracts test` | ✅ fail 0 |
| core typecheck | `tsc --noEmit` | ✅ 通过 |
| core 单测全量 | `pnpm --filter @meiye/core test` | ✅ 1043 tests / 995 pass / **0 fail** / 48 skipped |
| core Postgres 真机层 | `TEST_DATABASE_URL=<带 web schema 的库>` 跑 `*.postgres.test.ts` | ✅ **21/21 pass** |
| DBOS 注册 smoke | `TEST_DBOS_SYSTEM_DATABASE_URL=<独立系统库>` | ✅ 2/2 pass（含五段式 workflow 真启动真交付） |
| 壳侧 typecheck | mkfast `pnpm typecheck` | ✅ 通过 |
| 壳侧单测 | mkfast `pnpm test` | ✅ 416 tests / 415 pass / 0 fail / 1 skipped |
| Playwright e2e | 需 dev server，本轮未跑 | ⚠️ 未执行（新增/扩充 6 个 spec 约 +658 行，仅静态审查） |

**两条实测注记**：

1. **48 个 skipped 的含金量问题**：默认 `pnpm test` 全绿不包含持久层——全部 `*.postgres.test.ts`（21 个用例）和 DBOS smoke 都以环境变量缺失为条件整体跳过。本轮补齐环境后真跑全过，但这意味着日常"全绿"信号不覆盖 OCC/交付/托管恢复这些最关键路径。建议：CI 增加带 Postgres service 的 job，或至少在 handoff/README 写明两个环境变量的验收要求。
2. **裸库跑不通是环境问题而非缺陷**：对空白库跑 postgres 测试有 6 例失败，根因是 `migrateProStudioWorkspaceState` 依赖 Better Auth `session` 表；换用含 web schema 的库后 21/21 全过。测试对"库里已有壳侧 schema"的隐式前提值得在测试 README 标注。

---

## 2. 总体判定

**交付是真实的，质量显著高于预期，可以在现有基础上继续推进，不需要回滚任何东西。**

**覆盖度**：25 票中 **13 complete、9 partial、3 missing**。3 张 missing（#47 收件箱、#48 Langfuse、#49 evals）全部是 handoff 里明确排到 WT-6 的合法延期，不是被静默跳过；9 张 partial 都有真实可用的核心实现，缺的是具体验收项（明细见 §3/§5）。

**最难做对的部分恰恰做对了**。本次评审最担心的高风险决策全部经代码级核验成立：D-041 DBOS 姿态 8 项成立 7 项、第 8 项的 P0 指控被驳回（durable ledger 挡在 provider 前）；聚合 OCC 是真 CAS+同事务列/payload 同步+独立连接审计恰一条；五段 kernel 纯函数零 DBOS；七门唯一实现全库无第二份规则；视频"成本≠售价"被结构性锁定；做同款重编译不复制；Preference 锁死 inactive_stage2 无 enable 命令；"今天值得发什么"是契约层硬禁冒充的持久状态机。X4 假绿猎杀深读约 20 个测试文件**未发现 P0/P1 级注水**——这批测试普遍是能失败的对抗测试。

**缺陷的共同面貌是"最后一公里"而非架构错误**。17 条确认缺陷（2 P0+15 P1）里，超过半数属于"东西建好了但没接线/没呈现/没部署"：outbox worker 未常驻、失效传播未注册 sink、机会卡只落库不展示、身份定义字段 write-only、回落口吻不上 chips、export_use 死枚举、receipt 溯源死 schema。真正的行为级缺陷只有一条并发安全问题（交付先发布后核销，§5-14）和两处验收造假（确定性导出 fake-green、完整率指标退化）。这些全部可以小 PR 逐个清掉，§7 给了顺序。

**对本轮"全绿"的正确理解**：默认测试信号不含持久层（48 skipped），本评审补齐环境后真跑 21/21+DBOS smoke 2/2 才确认真绿——CI 必须补真机 job（§7d-14），否则下一轮迭代的持久层回归不会被看见。

**建议路径**：7a 四条立即修（1-2 天）→ 7b/7c 按票捎带 → 开 WT-5/WT-6 扇出派工（#41→#48、#38/#40/#45/#47/#39/#49 补课项随票走）。

---

## 3. 逐票核验结论（25 票）

覆盖度定义：**complete**=验收项全部达成；**partial**=真实实现但有验收项未达成；**missing**=本轮无实现（含合法延期）；**divergent**=偏离票体设计。

### 3.1 关键路径与存储线（WT-1/WT-2 范围）

| 票 | 覆盖度 | 一句话结论 |
|---|---|---|
| #25 contracts | partial | 三进三出 schema/两类帧/五段冻结常量全落地，测试真实；唯一偏差=另造 structuredDecisionPatchSchema 违修订 #4（§5-3） |
| #26 ai@7 清债 | **complete** | 3 处 generateObject 全迁 Output.object，弃用别名清零，全仓 rg 零命中；对照 ai@7.0.22 d.ts 核实非侥幸通过 |
| #30 聚合 OCC | **complete** | 真 CAS（WHERE revision=expected）、列/payload 同 SQL 同步、审计走独立连接+确定性 id 保恰一条、全写路径入 CAS、多 transition 单次递增；缺口在 delivery 消费侧（§5-4，属 #42 侧） |
| #31 ①③节点 | **complete** | 幂等键稳定派生+ledger 持久去重双层防重复计费，structured-nodes 零 DBOS 纯函数边界符合 D-035，repair 显式 unsupported；1 P1=「嵌套字段完整率」指标退化为 schema 有效率复制品（§5-18） |
| #32 账本+编译+Bundle | **complete** | 账本不可变 revision+OCC、六维三池纯函数编译+canonical hash、Bundle 追加式 revision+DB 触发器拒 UPDATE（彻底避开 PoC 原地覆盖反模式）、8-key 围栏全通、失效联动接口在位 |
| #34 ④+七门 | **complete** | 七门纯函数唯一实现、逐门变异对抗测试、N→1 确定性平分、退款矩阵精确对齐 acceptance 三态；未发现 P0/P1 |
| #35 主 tracer | partial | 注册/唯一路由/效果键+fingerprint 409/决定接缝/⑤段同事务审计+OCC/PoC 已删全部真实且测试可失败；唯一实质缺口=outbox 补偿 worker 未部署为常驻件（§5-5） |
| #33 SSE 通道 | **complete** | 双事件源+归属先于读取统一 404、稳定游标在 durable 流内生成（非连接局部计数器）、Last-Event-ID 双向透传、终态竞态正确处置、轮询仅 degraded 兜底；"ADR-0006 兜底未落实"指控经验证**驳回**（条件式交付项，见 §6） |

### 3.2 视频与交付线（WT-3 范围）

| 票 | 覆盖度 | 一句话结论 |
|---|---|---|
| #27 视频闭环 A-E | **complete** | 五批全落地、修订八条 P0 全满足：时长/画幅贯通+和值校验、**成本≠售价被结构性锁定**（5 次真实时长请求仅扣 1 单位用户额度）、AIGC 按开关分支、subtitleEvidenceHash 彻底删除（反向断言）、旧 provider 退役、整链集成含源码级反双规划断言+重放零增量；仅 3 条 P2 观察项（评分器为版本化 fixture 恒回落人审——修订明确允许，留档防误读） |
| #42 批准+发布+台账 | partial | A 批一次性凭据调 #34 validator 不复制规则、B 批严守"抖音永不自动发布"P0-2（publish 直接 throw+provider 调用数 0 断言）、C 批原生台账+legacy 只读投影遵守 ADR-0011；缺口=失效传播生产未接线（§5-11）+先发布后核销（§5-14） |
| #46 结果面 | **complete** | 六 chips/三级来源/结果阶梯/周复盘全真实现+e2e 真跑；D-040 指标边界严格遵守（反向断言无转化率字样）；越权接入 A/B 批命令降级 P2 |

### 3.3 前端体验线（WT-4 范围）

| 票 | 覆盖度 | 一句话结论 |
|---|---|---|
| #28 上传权利内化 | **complete** | 上传→授权→原地执行一屏闭环、受限素材前后端双重强制证据、撤权/到期 grounding 拒绝、全程复用 CanonicalAssetGovernance 无第二状态机、全链 e2e，无假绿 |
| #29 候选呈现 | **complete** | 严格消费服务端 recommendedAssetId+DecisionTrace 七字段，legacy 无推荐绝不冒充主推荐（P0 修订完全满足）；运行态验收合法顺延 #35 |
| #36 Composer+单问卡 | **complete** | 五类入口按 D-023 七能力合同门控且"隐藏而非置灰"、8 旧 chip 归位二级无丢失；单问卡=服务端权威阻塞卡（无 AlertDialog/无 ignore/无本地 reducer，target-mismatch 无法伪造），答复经 DBOS.send↔recv 真续挂起 workflow；"resume 503 永久搁死"指控经验证降级 P2（接缝可重放有测试，缺口仅前端重放入口+reconciler，见 §6/§8） |
| #44 Day-0 | **complete** | "今天值得发什么"是真正的服务端持久状态机（事实 revision 全等才点亮，契约层 superRefine 硬禁冒充+真库集成测试）；ExampleStorePreview 零 diff 纯复用；示例隔离对抗 e2e 打真实接口断言账本恒空；2 条 P2（事实引用内部 ID 直出给店主、状态机 e2e 为全 mock 渲染测试） |

### 3.4 扇出票（T15-T26）

| 票 | 覆盖度 | 一句话结论 |
|---|---|---|
| #45 促销 | partial | 场景投影+诚实降级+superRefine 强制真实落地并接入生产；缺口=无价数字门可绕过（§5-6） |
| #38 热点 | partial | 契约层 12 字段+硬约束+诚实降级扎实；但机会卡"只落库从不呈现"（§5-7）、主路径零测试（§5-8）、expired 不可达（P2） |
| #39 IP 身份 | partial | 生命周期核心扎实（独立领域表+四态状态机+OCC+源修订 bump，冒用走 #34 共享门零重复且 preflight 保证 provider 零触达，未把 D-022 越界套到身份）；但 1 P0=槽位表单违 D-031（§5-2）+2 P1=身份定义字段 grounding 丢弃（§5-16）、回落口吻无 chips 说明（§5-17） |
| #40 物料 | partial | 尺寸冻结+复用 Light Composer 链符合 P0#1/#2；但两类降级+receipt 溯源为死 schema（§5-1 P0）、确定性导出验收 fake-green（§5-9） |
| #41 快编 | partial | 派生 revision 数据模型层扎实（血缘边界完全符合修订 #1、reuseContentPackage 已退役）；但一键动作/NL 指令空心化（仅标签，内容变更靠手填）+export_use 死枚举（§5-10） |
| #43 做同款/系列 | **complete** | 五条修订 P0 全满足：做同款重编译不复制、Preference 锁死 inactive_stage2 无 enable 命令、结构阻断对抗测试证零注入；前端消费面属 #39/#28 职责 |
| #47 收件箱 | missing | 合法延期：属 WT-6"上游就绪领活"批次，本轮未领取；上游接缝（#35/#36/#42）已就绪 |
| #48 Langfuse | missing | 合法延期；现存 Langfuse 相关物（sender 接口/outbox 表/worker 类）均属 #35 独占接缝，非 T25 交付物 |
| #49 evals | missing | 合法延期（WT-6）；其锚点 #34 七门 gateId 已就绪，#43 候选链/#48 importer 未以所需接缝形态交付 |

---

## 4. 横切审计结论（6 维度）

| 维度 | 结论 |
|---|---|
| X1 DBOS/D-041 姿态 | **8 项姿态 7 项成立**：无 knex/drizzle datasource；效果键 `wf:{id}:s{n}:{unit}:{candidate}` 全链一致；workflowID=TaskID 去重 + fingerprint 异 payload 409；system DB 强制独立分库（同库即抛错，runtime-config:17-19）；五段 kernel 纯函数、时钟注入；⑤段审计与业务写同事务、CAS 失败硬停回滚；⑤段 `pg_advisory_xact_lock` + 双重 revision CAS。第 8 项"计费幂等 durable 层缺失"的 P0 指控经对抗验证**被驳回**——foundation ledger 的 `checkpointAttempt` 持久检查点挡在 provider 调用之前（见 §6） |
| X2 接缝与测试纪律 | **整体扎实**：HTTP+SSE 合同测试真实（真服务器+fetch，断言协议头/心跳/id·event 帧/Last-Event-ID 游标透传/属主 404）；sequence/revision 命名全局分离且有 `.strict()` 拒绝断言；无跨包深相对 import；纯五段内核及其单测 DBOS-free。1 条确认缺陷：terminal-failure 纯函数误置于 durable 载体模块致单测急加载 dbos-sdk（见 §5-11） |
| X3 重复建设与属主矩阵 | **防重复口径基本成立**：七门 validator 唯一实现（#34），#35/#42 均调用不重写；MarketingPackage 内嵌非第二聚合；两个 scorer 各司其职；无伪造 handoffPackages；前端真实复用 ExampleStorePreview 与 Light Composer 链。1 条确认越界：harness 直读 #32 账本私有表（见 §5-12）；1 条"自建聚合 OCC"降级 P2（修订节本身允许，见 §6） |
| X4 假绿猎杀 | **未发现 P0/P1 级 fake-green**（约 20 个测试文件深读+程序化扫描）：OCC 用真并发 `Promise.allSettled` 断言恰一冲突；idempotency 断言真实 provider 调用次数；asset-intake 端到端校验旧价 239 不泄漏下游；七门逐门变异断言；anti-double-planner 断言读真实源码可失败；video 集成用真 ffmpeg 烧录 AIGC 标识并 ffprobe 校验。2 条 P2 弱测试（见 §5 附表） |
| X5 前端真实性 | **整体诚实**：推荐字段真来自服务端持久化、legacy 无推荐时不冒充主推荐；"今日值得发"是 factsRevision 绑定的持久状态机非静态换名；单问卡走真 decision seam 带幂等键；三协议无串线；Last-Event-ID 双向透传；示例门店零写账本且有 e2e 兜底。2 条真问题：D-031 槽位表单违规（P0 确认，§5-13）、D-023 能力门全真常量喂入（降级 P2，§6） |
| X6 安全与租户隔离 | **鉴权面扎实**：BFF 服务端解析 workspace 盖头、客户端无法伪造；core 敏感路由全在 service-token 门后；所有权预检统一 404 不泄存在性；新 SQL 全参数化（标识符插值均来自固定字面量集）；advisory lock 带 workspace 前缀不跨租户冲突；outbox 无跨租户混淆。1 条实质缺陷：交付"先发布后核销"（§5-14） |

---

## 5. 确认缺陷清单（经对抗验证）

以下 17 条（2 P0 + 15 P1）全部经过独立对抗验证（验证 agent 以"驳倒它"为目标重查代码后仍判 CONFIRMED）。按严重度排序。

### P0（2 条）

**5-1.（#40 物料）两类降级未实现，物料 receipt 溯源为死 schema** — `packages/contracts/src/marketing-package.ts:340`
`promotionalMaterialReceiptSchema` 及其 capabilityStatus/missingMaterialFallback/provenanceRef/outputSha256 字段全仓无任何生产消费者；真实导出落的是通用 ExportReceipt（不含这些溯源字段），UI 亦无"辅助完成/缺料"标记路径。违反验收项 3"素材不足时的占位/文字版降级路径明确标记"与修订 P0#3。

**5-2.（X5/#39）brand_ip 入口在 Composer 内联多字段必填槽位表单，违反 D-031** — `mkfast-template-main/src/product/marketing-identity-manager.tsx:121`
`creation-entry.tsx:392` 在点击"品牌/个人 IP"入口后直接内联渲染含 select + 4 个 required Input 的表单。D-031 锁定决策明令"主流程禁止传统 SaaS 槽位填表——场景入口点击后只切换 Composer 上下文，不弹表单"。

### P1（12 条）

**5-3.（#25）另造 `structuredDecisionPatchSchema`，未复用 `assistantFieldPatchSchema`** — `packages/contracts/src/harness.ts:51`
与 p1.ts 的 assistantFieldPatchSchema 同为 {field,value,reason} 形，是复审修订 #4 明令要防的重复建设。

**5-4.（#30）delivery 冲突路径抛 409 但不写权威审计** — `apps/core/src/p1/operations/content-package-delivery.ts:528`
修订 #1（P0）要求任何 revision 冲突留恰一条 `content_package.revision_conflict` 权威审计。Operations 与 adoption 路径都照做，唯独 delivery 服务缺失。

**5-5.（#35）通用补偿 worker 建好却未部署为常驻件** — `apps/core/src/p1/harness/outbox-worker.ts:24`
`HarnessLangfuseOutboxWorker` 已实现并单测，但 main.ts 合成根从未实例化/调度它。D-041 固化姿势、#35 修订 §3、#48 修订 §1 三处都要求它在跑。job-worker.ts 已有同模式常驻先例可照抄。

**5-6.（#45）无价数字门正则不完整且是唯一防线** — `apps/core/src/p1/harness/production-stage-ports.ts:299`
七门只检查模型自报的结构化 factClaims（实测常为空数组），不扫 body/title/conversionHook 自由文本；该正则只匹配带 元/折/%/券/次/¥ 的数字，可被对抗内容绕过。违反验收 1"无价：成品不出现任何具体优惠数字（对抗测试）"。

**5-7.（#38）机会卡从不在任何 UI 呈现** — `mkfast-template-main/src/product/content-package-quick-edit.ts:24`
opportunityCard 已投影落库，但全仓唯一读 `contentPackage.marketing` 的前端只取 factRefs/rightsRefs，从不读 `.opportunity`；详情页无机会卡区块。验收 1/3 的用户可见面未达成。

**5-8.（#38）"粘贴热点→active 机会卡"主路径零测试** — `apps/core/src/p1/harness/marketing-scene-policy.test.ts:72`
全仓无任何测试断言从含 URL/截图的输入产出 status='active' 的机会卡；现有测试只覆盖 evergreen_fallback 与手搓字面量 parse。

**5-9.（#40）确定性导出验收造假：哈希的是输入而非渲染输出，且助手为死代码** — `mkfast-template-main/src/product/promotional-material.test.ts:61`
`lightComposerMaterialFingerprint` 哈希输入(document+font+assets)而非输出 PNG，且全仓仅被自身测试引用、未接入真实导出。真实导出的重复确定性无自动化断言。fake-green。

**5-10.（#41）`export_use` 目标层级为死枚举，6 个导出/物料动作无差异化路由** — `mkfast-template-main/src/product/content-package-quick-edit.ts:16`
前端构造 intent 只按"是否选中 variant"输出两种 target，与 action 解耦，export_use 永不被发出；票内明列的朋友圈导出/门店物料/海报等动作没有差异化承载。

**5-11.（#42）失效传播链生产未接线：价格过期不会使待发布批准失效** — `apps/core/src/p1/operations/content-package-delivery.ts:290`
`ContextInvalidationService` 只在测试里被 new，main.ts 从未实例化；delivery 暴露的 `handleContextInvalidation` 也不符合 sink 接口，生产无人调用。验收 4 端到端未达成。

**5-12.（X2）terminal-failure 纯函数误置 durable 载体模块，单测急加载 dbos-sdk** — `apps/core/src/p1/harness/terminal-failure.test.ts:5`
被测 `normalizeHarnessTerminalFailure` 是无 DBOS 依赖的纯函数，却放在顶层 `import { DBOS }` 的 dbos-workflow.ts 里，违反"测试永不 import durable 载体"接缝纪律。修复=纯函数抽独立模块。

**5-13.（X3）harness 直读 #32 账本私有表 `p1_store_fact_workspace_heads`** — `apps/core/src/p1/harness/postgres-store.ts:269`
`readTodayRecommendation` 直接对账本私有表发 SQL，与 #32 `currentRevision()` SQL 逐字重复。违反属主矩阵"入口票只消费冻结 ContextBundle，禁直读账本"。

**5-14.（X6）交付先发布后核销：一次性审批凭据在不可逆外部发布之后才 CAS 核销** — `apps/core/src/p1/operations/content-package-delivery.ts:201`
`authorize()` 只读校验 status==='approved' 不翻转状态；真正的单次核销发生在 `publisher.publish()`（携带付费/公开外部副作用）之后，并发重复交付可绕过单次约束导致重复付费/发布。

**5-15.（#35）⑤段 OCC 冲突审计事件命名 `revision_conflict` vs 修订 §7 字面 `occ_conflict`**（P2 边缘，随 5-4 一并对齐口径即可）

以下 3 条来自补跑评审（首轮 3 路评审 agent 结构化输出失败+1 路输出垃圾后重跑），同样经独立对抗验证 CONFIRMED：

**5-16.（#39）品牌/个人身份定义字段在 grounding 被整体丢弃（write-only）** — `apps/core/src/p1/harness/production-context-port.ts:456`
brandClaims/forbiddenClaims/visualPrinciples/seriesAnchors/realWorldRole/portraitAuthorization 等八个判别字段在合约定义、表单写入后零读取方：identityContribution 只放子集，无二次水化路径，生成器永远只见子集，无补偿门。验证注记：普适医美禁忌仍会被 critical_fact_source 门拦下，但品牌自定义禁忌与正向定位字段确无机制触达生成器。违反 acceptance #2「身份一致的成品」+「栏目锚点」。

**5-17.（#39）identityFallback 计算了却从不在 chips 说明** — `apps/core/src/p1/harness/marketing-scene-policy.ts:52`
回落"行为"半边已实现（空 identity 时 prompt 令用中性品牌官方口吻），但 acceptance #3 的"并在 chips 说明"半边完全缺失——全仓无任何生产组件读取 identityFallback。用户无法得知本次成品用的是品牌口吻而非主理人 IP 口吻，触及"绝不代言"意图。

**5-18.（#31）「嵌套字段完整率」指标退化为 schema 有效率的复制品** — `apps/core/src/p1/harness/structured-nodes.ts:275`
成功分支恒 complete=total、失败分支恒 complete=0，从不读取 result.output 真实字段填充度——第四指标是第一指标的确定性函数，零独立信号。D-035 的 BAML 迁移阈值明文靠四指标标定，此项造假使标定给出虚假满分置信，违反修订 §4「指标诚实：不得用恒定值伪装已观测」。

---

## 6. 被驳回/降级的评审主张

对抗验证驳回 6 条、降级 7 条。**驳回项里有两条原本是最吓人的指控**，记录驳回理由防止后续误传：

### 驳回（节选 4 条关键项）

- **"#33 ADR-0006 拓扑兜底未落实，长期只有 polling 降级"（补评 T10，原 P1）→ 驳回**。兜底是条件式交付项：禁压缩/禁缓冲透传实体已建（core-stream.ts:19-26 `content-encoding: identity` + `x-accel-buffering: no` 且在转发白名单）；"CF Workers 边缘无缓冲验证"是生产运行时属性，ADR-0006 本就归入 Week-1 部署期、D-040 又将部署/运行时验证整体置后——验证未运行更未失败，条件兜底现在不该建，预建绕壳直连反而破坏身份透传边界。polling 是票内硬性验收且修订允许的断流降级。残点（catalog 18.2 无专属 spec）至多 P2。

- **"效果键计费幂等只在内存兜底，in-flight 重跑会重复扣费"（X1，原 P0）→ 驳回**。指控遗漏了第三层防线：PG 持久化的 foundation ledger `checkpointAttempt`（model-supply/index.ts:2057）挡在 provider 调用之前，返回 recoveredResult 即直接短路返回，崩溃重跑不会二次调用 provider。D-041 姿态实际成立。
- **"D-024 物料渲染能力门完全缺失"（T18，原 P0）→ 驳回**。定位错误：被指控处是编辑器内"输出用途"下拉框（本就不该有门）；真正的能力门在 `marketingEntryReleased`/`releasedMarketingEntries`（marketing-entry-model.ts:94-106）且已接线在入口层。
- **"T15 过期价格泄漏硬门无测试"→ 驳回**。修订节明确该硬门与 #34 共用 `priceBenefitFreshnessGate`，其阈值 0 对抗测试在 policy-gates.test.ts 真实存在；T15 本票只消费提示，不另建校验器。

### 降级（7 条，均"事实成立但定级高估"）

| 原判 | 终判 | 主张 | 降级理由 |
|---|---|---|---|
| P1 | P2 | #38 'expired' 状态不可达 | 事实全部成立，但当前无 consumer 读该状态，影响面小 |
| P0 | P1 | #41 一键动作与自然语言指令不产生任何转换，仅作惰性标签 | 缺陷属实：changes 100% 来自手填字段，intent 只是可选元数据——但有手动路径兜底，非 P0。**已并入 §5-10 处置** |
| P1 | P2 | #41 前端未处理新聚合 OCC 错误码 REVISION_CONFLICT | 真实但仅降级为通用报错，不丢数据 |
| P1 | P2 | #41 验收 1 的 e2e（就地修改→diff→undo）缺失 | e2e 确实没写，但单元层覆盖存在 |
| P1 | P2 | #46 结果面越权接入 #42 的 A/B 批命令 | 调用属实，但属依赖收窄口径问题非行为错误 |
| P1 | P2 | #35 harness 直写 p1_content_packages 自建一套聚合 OCC | 直写属实，但修订节允许 harness 侧持有交付写路径；判为可维护性问题 |
| P1 | P2 | X5 D-023 能力门由硬编码全真常量喂入 | `productionMarketingEntryCapabilities()` 确实无条件返回全真——但门本身的判定逻辑真实存在且有测试；等真实能力数据接入后即生效。**注意与 §6 驳回项区分：门存在，喂的数据是常量** |
| P1 | P2 | 补评 #39 撤权→拒绝→回落→失效全链无测试 | 评审核心证据错误：identityChanged 失效门有专门测试（content-package-approval-freshness.test.ts:27，评审漏查该文件）；拒绝门/生命周期均真绿。真缺口=整链集成粘合 e2e 与 provider零触达+回落口吻两子步骤断言，属测试补强 |
| P1 | P2 | 补评 #36 resume 503 永久搁死挂起工作流 | 接缝级定性被证伪：resume_status 保持 pending，同 idempotencyKey 重放 POST 会再次 resume，且有真实测试（decision-service.test.ts:54-81 断言 resume:1/resume:2/resumed）。残留缺口=前端 503 后无重放入口（问题区渲染 null 无按钮）+ 无 resume_status reconciler，影响限于瞬时 503 窗口，修复很小 |

---

## 7. 处置建议

按修复性质分四组（组内按依赖顺序）。所有项都可按"每项一小 PR"节奏走，不需要回滚任何已合并代码。

### 7a. 立即修（正确性/安全，1-2 天）

1. **交付核销顺序反转**（§5-14）：把 approval receipt 的 `consume()` CAS 移到 `publisher.publish()` 之前（先核销后发布，发布失败走补偿恢复 receipt），或最低限度在 publish 前做 CAS 预占。这是唯一一条并发下可造成重复付费/发布的缺陷。
2. **outbox worker 接线**（§5-5）：main.ts 合成根按 job-worker.ts 现成模式实例化+调度 `HarnessLangfuseOutboxWorker`。一行级改动，解 D-041 姿态悬空 + #48 依赖。顺带把 `resume_status='pending'` 的 reconciler 挂进同一常驻循环（§8 #36 项），一并消掉决定接缝的瞬时 503 搁置窗口。
3. **delivery 冲突审计补齐**（§5-4）：delivery 路径冲突时按 #30 已有模式写恰一条 `revision_conflict` 权威审计；顺手统一 §5-15 的事件命名口径。
4. **失效传播接线**（§5-11）：main.ts 实例化 `ContextInvalidationService` 并把 delivery 注册为 sink（先对齐 sink 接口签名）。

### 7b. 验收未闭环补课（每票半天-1天）

5. **#40 物料**：两类降级+receipt 溯源接线（§5-1），确定性导出改为对渲染输出 bytes 做双跑同 hash 断言、删除死助手（§5-9）。
6. **#38 热点**：详情页补机会卡区块读 `.opportunity`（§5-7）+"粘贴热点→active"主路径测试（§5-8）。
7. **#41 快编**：一键动作接真实转换分支（按 action 声明目标层级/允许字段），export_use 路由接线（§5-10）。
8. **#45 促销**：无价数字门改为扫描 body/title/conversionHook 自由文本+扩正则，加对抗测试（§5-6）。
9. **#39 IP**：MarketingIdentityManager 迁出 Composer 主流程（守 D-031，§5-2）；身份定义字段（forbiddenClaims/seriesAnchors/brandClaims 等八项）接入 identityContribution 使生成器可见（§5-16）；identityFallback 接入 chips 呈现（§5-17）；撤权整链粘合 e2e 补强（降级 P2，失效门单测已有）。
10. **#31**：「嵌套字段完整率」指标改为真实检视嵌套字段填充率（D-035 阈值标定依赖此信号）。

### 7c. 接缝卫生（半天内打包一个 PR）

11. `structuredDecisionPatchSchema` 合并回 `assistantFieldPatchSchema`（§5-3）。
12. `normalizeHarnessTerminalFailure` 抽出 dbos-workflow.ts 到独立纯模块（§5-12）。
13. harness `readTodayRecommendation` 改调 #32 的 `currentRevision()` API（§5-13）。

### 7d. 测试基建（跟 CI 一起做）

14. **CI 补 Postgres/DBOS 真机 job**：本轮证明默认"全绿"不含 21 个持久层用例与 DBOS smoke（全部 env-var 门控跳过）。CI 起 Postgres service 注入 `TEST_DATABASE_URL`（需含壳侧 schema——注意测试隐式依赖 Better Auth `session` 表）与 `TEST_DBOS_SYSTEM_DATABASE_URL`。
15. Playwright e2e 纳入验收流程（本轮未跑，静态审查发现 catalog 条目与可执行 spec 不一一对应）。
16. P2 弱测试清理（§5 附表 20 条中的 fake-green 类：ffmpeg validated 回显断言、structured-nodes 恒等 deepEqual、#40 文字裁切安全区断言脱节）。

### 未完成票的排期确认

#47 收件箱、#48 Langfuse、#49 evals 为合法延期（WT-6 批次），其上游接缝均已就绪或明确。建议在 7a 完成后按 handoff README 第 5 条开 WT-5/WT-6 派工。

---

## 8. P2 观察项附表（30 条，未经对抗验证/验证降级项，按票归组）

> 修复不紧急，但排 backlog 时按票捎带。含首轮 20 条 pass-through、补评新增、验证降级项。

- **#25**：progress envelope 的 eventId 未约束「workflow+sequence 稳定确定」。
- **#30**：delivery 的 expectedRevision 校验 TOCTOU（锁外预检、锁内不复核）。
- **#31**：单缺口 schema 断言测试验证了错误的失败原因；跨进程 recoveredResult 去重路径无测试。
- **#32**：失效测试 hash 自引用断言；Postgres 集成测试 env 门控（并入 §7d-14）。
- **#35**：冲突审计命名 revision_conflict vs occ_conflict（§5-15）；harness 直写 p1_content_packages 自建 OCC（验证降级，可维护性）。
- **#27**：provenance 校验失败分支无负向测试；评分器为 fixture 查表恒回落人审（修订允许，防误读留档）；RecordedVideoCompositionPort 无条件 validated:true（非生产路径）。
- **#33**：HTTP 边界负向测试用泛型 mock 源；cancelled 映射 success。
- **#28**：交付层权利复核未做到期检查，与 grounding 口径不一致。
- **#37**：预览卡未展示适用范围（scope）。
- **#29**：主推荐生产不可达（合法顺延 #35 运行态）；catalog item 14 无可执行 spec。
- **#38**：expired 状态不可达（验证降级）；matchedStoreReferences 仅 factRefs、relevanceExplanation 写死。
- **#39**：allowedPlatforms/allowedScenes 无硬门且 UI 全开；撤权整链粘合 e2e（验证降级）。
- **#40**：文字裁切安全区断言与冻结 textSafeArea 脱节、textFit 死代码。
- **#41**：前端未处理 REVISION_CONFLICT 错误码（验证降级）；验收 e2e 缺失（验证降级）。
- **#45**：促销投影从 live activeFacts 侧信道取价，偏离冻结 Bundle 消费边界。
- **#46**：越权接入 #42 A/B 批命令（验证降级）；推断相关性为 1:1 拷贝；结果阶梯建模偏薄。
- **#43**：前端消费面未接线（属 #39/#28 职责，扇出期落位）。
- **#44**：事实引用内部 ID 直出给店主（非技术客群审美原则）；状态机 e2e 为全 mock 渲染。
- **#36**：D-023 能力门喂全真常量（验证降级；真实能力数据接入后即生效）；resume 503 前端无重放入口+无 resume_status reconciler（验证降级，建议随 §7a-2 一并做）；chipsSignalInputSchema 全仓零接线（D-029 学习信号死 schema）；e2e 未覆盖"任务继续→成品交付"一腿。
- **X4**：ffmpeg validated 回显断言不可失；structured-nodes 恒等 deepEqual 近乎只验证透传。

---

## 9. 评审方法与可信度说明

- **两层评审**：Workflow 一轮 = 25 路逐票 + 6 路横切（Opus），55/58 agent 完成，约 550 万 token、1509 次工具调用、43 分钟；其中 3 路结构化输出失败（T05/T09/T17）、3 路输出占位符垃圾（T10/T11/T24），全部以独立 agent 补跑重审，25 票最终无一漏评。
- **对抗验证**：全部 P0/P1 发现（首轮 27 条 + 补评 6 条，共 33 条）逐条交独立验证 agent 以"驳倒它"为目标重查，最终 **17 确认 / 9 降级 / 7 驳回**。**近半 P0/P1 指控没能原级活过验证**——报告 §5 只列活下来的。验证环节还纠正了两处评审自身的证据错误（漏查测试文件、定位错误），并化解了一处两路评审结论冲突（#36 resume 503：接缝可重放 vs 前端搁死——两半各对，合并裁决）。
- **基线实测**：§1 的测试/typecheck 结果全部由主会话亲手运行，不经 agent 转述；agent 一律被禁止自跑测试套件，防止以"跑不通"为由的误报。
- **局限**：Playwright e2e 未真跑（静态审查）；X4 假绿猎杀为深度抽样（约 20 个测试文件）非穷举；#36 补评晚于其余票（见 §3.3）。

---

## 10. 处置执行记录（2026-07-18 修复轮，追加）

§7 全部处置项已执行完毕并合入 main（本节完成时 HEAD `164a2e5`）。执行方式：5 条 Codex lane 并发（worktree 隔离+文件属主互斥）→ 主会话合并与真机全量验证 → 6 路 Opus 对抗复核 → 缺口定向返工（Codex 二轮 4 路 + 三轮 1 路）→ 原复核员定点二验/终验。

### 10.1 最终状态（全部经独立对抗复核确认）

| 处置项 | 状态 | 关键 commit |
|---|---|---|
| 7a-1 核销先于发布（§5-14） | ✅ FIXED | 366facf |
| 7a-2 outbox worker + resume reconciler 常驻（§5-5） | ✅ FIXED | d33a613 |
| 7a-3 delivery 冲突审计+命名口径（§5-4/5-15） | ✅ FIXED | 5980243 |
| 7a-4 失效传播接线（§5-11） | ✅ FIXED（二轮补 producer：过期检出→分发→sink 整链生产可达） | d564b99 + 27ebbd9 |
| 7b-5 #40 两类降级+receipt 溯源（§5-1） | ✅ FIXED | d8720c5 |
| 7b-5 #40 确定性导出（§5-9） | ✅ FIXED（哈希渲染输出 bytes 双跑；死助手/textFit 删净） | 665e7be |
| 7b-6 #38 机会卡呈现+主路径测试（§5-7/5-8） | ✅ FIXED | 03c7fdb + 5e84468 |
| 7b-7 #41 快编+export_use（§5-10） | ✅ FIXED（三轮闭环：真转换→服务端差异化 carrier→前端消费面） | 34e64f4 + 4149fb2 + fcd47f5 |
| 7b-8 #45 无价门（§5-6） | ✅ FIXED（二轮补 9 类必拦样本+修 次/% 误杀；三验实证通过） | 793f219 + 10470d9 + 742e39c |
| 7b-9 #39 D-031 迁出/八字段/chips（§5-2/5-16/5-17） | ✅ FIXED（二轮补 brand 三字段前端采集） | 85b7854/cfeba28/ec676cb + 7b04169 |
| 7b-10 #31 完整率指标（§5-18） | ✅ FIXED | 17547f6 |
| 7c-11 schema 合并（§5-3） | ✅ FIXED（返工恢复 p1 枚举收窄，canonical 单一形状） | 82225b8 + 7013421 |
| 7c-12 terminal-failure 纯模块（§5-12） | ✅ FIXED（import 图实证不触达 dbos-sdk） | 454c704 |
| 7c-13 账本公开 API（§5-13） | ✅ FIXED | 6ba5c69 |
| 7d-14 CI Postgres/DBOS 真机 job | ✅ FIXED（provisioning 脚本经本机真库验证；assert 二轮修 reporter 假红，8 格矩阵自测） | 43deb3c + 8651572 |
| 7d-15 Playwright 纳入验收 | ✅ FIXED（opt-in job；catalog 17.14/18.2 打 MISSING SPEC 不伪造） | 0a1e3c7 |
| 7d-16 弱测试清理 | ✅ FIXED（ffmpeg 真 ffprobe 断言/structured-nodes 判别断言/textSafeArea 对齐） | 59886de 等 |

复核发现并同轮闭环的两个新缺陷：assistantFieldPatchSchema 放宽破坏 p1 约束与前端 typecheck（7013421）；receipt 核心边界零校验（12a8869，Zod+provenance+双 SHA 核验）。

### 10.2 修复轮后基线（主会话实测，HEAD 164a2e5）

| 检查项 | 结果 |
|---|---|
| contracts | ✅ 31/31 |
| core typecheck | ✅ 通过 |
| core 全量（含 TEST_DATABASE_URL + TEST_DBOS_SYSTEM_DATABASE_URL 真机） | ✅ 1115 tests / 1109 pass / 0 fail / 6 skipped（仅 live-provider 门控） |
| mkfast typecheck + 全量 | ✅ 434 tests / 433 pass / 0 fail / 1 skipped |
| CI assert 断言矩阵自测 | ✅ 8/8 |
| provision-test-db.sh 本机真库 | ✅ 建库+壳侧 migration+session 表 |

### 10.3 复核新增 P2 backlog（不阻断，按票捎带）

- **交付**：补偿自身失败窗口（receipt 卡 consumed，失败安全但需人工）；publisher 无 receipt 派生幂等键（随 #48 真适配器补）；create() 内部 TOCTOU 冲突路径不写审计。
- **失效 producer**：耦合在 harness 门后（需确认生产恒开 harness）；失败续跑分支零测试；内存游标重启全量重扫；无跨副本 DB claim（弱于 outbox/reconciler 姿态）；expiresAt 水位漏「append 即过期」事实。
- **无价门**：外币（$/USD/yuan）、繁体/异体字（圆/塊）、超 8 字距离窗口属 RMB 中心正则边界外。
- **导出承载**：light_composer 的 sourceWorkId 全链无消费者——「去做海报」打开尺寸正确的空白画布，需后续票补源内容播种；poster 与 appointment_card 共用 1080×1080 规格仅 templateRole 区分。
- **其它**：身份管理面在资产页仍为表单形态（D-031 严格读法有张力，§7b-9 处置口径下合规）；机会卡仅详情页未上工作台 hero；CI 首跑需确认 node 22 接受 NODE_OPTIONS 内 --test-reporter（fail-loud 无假绿风险）。

### 10.4 方法记录

两轮 Codex 修复共 23 个 commit（首轮 5 lane 16 个 + 返工 5 项 7 个），全部经 6 路 Opus 对抗复核 + 5 路定点二验 + 1 路三验；复核共否决/降级返工 5 处（无价门、失效 producer、export_use 两跳、身份三字段、CI assert 假红），全部返工后终验通过。教训沉淀：codex exec 的 workspace-write 沙箱不含 worktree 的主仓 .git 元数据，需 `-c sandbox_workspace_write.writable_roots` 显式加白，否则 commit 全阻。

---

## 11. WT-5/WT-6 收尾派工记录（2026-07-18 晚，追加）

§7 修复完成后按 handoff README 第 5 条开出最后三票，25 票（#25-#49）至此**全部实施完毕**（本节完成时 HEAD `c4dd32a`）。

### 11.1 交付与复核

| 票 | 交付 | 复核裁决（Opus 对抗验证） |
|---|---|---|
| #48 Langfuse（4 commits 318b7cc..ada7463 + importer 8567d99） | sender/映射/白名单、prompt 受理冻结、四指标 dataset、钉扎四件套 compose、EvalRun importer | 六项红线全达标；importer 二验 5/5 FIXED |
| #47 收件箱（3 commits cedc586..a0ae509 + 硬化 c83fd45..2462d8c） | 服务端权威 pending-actions 投影、D-032 单阻塞不变量（双向+同库 fail-fast）、批准请求聚合（幂等唯一/CAS 恰一次消费）、AsyncTaskCenter 壳复用+卡片直用 #36/#42、活版本批准、交付重试入口、e2e | 主干 FIXED；复核揪出 1 P1（不变量零测试）+2 P2（冻结版本卡死/孤儿态）+1 回归（assisted 误判重试）均返工后终裁 FIXED |
| #49 评估门（3 commits df6bc16..4e9b3cf） | EvalRun 合同（strict+聚合一致性）、promptfoo 七红线（provider 直调生产 validateHarnessPolicy、gateId parity 无孤儿、CI 双层）、BeautyPreferenceMemoryEval（硬等式+故障注入自证必红） | 「真门非假绿」，假绿攻击面压测全拦红 |

设计拍板（执行中裁决）：pending approval request 持久化归 #42 批准域、创建接缝=目标平台导出可交付后、批准经既有一次性凭据 CAS 消费（#47 复核确认无第二状态机）；#49 与 #48 按修订节方案以 EvalRun artifact 解耦并行。

### 11.2 e2e 通路修复（RW-8）

真机运行揭示 CI `e2e` job 自身缺口：job 注入 `HARNESS_DBOS_SYSTEM_DATABASE_URL` 激活 harness 运行时，但 playwright 以 `MODEL_EXECUTION_MODE=fixture` 起 core，`main.ts` 硬性要求 live 直连模型 → 启动必崩（所有 harness 旅程 e2e 本地与 CI 均不可执行，此前从未真机跑过故未暴露）。修复 `84fac43`：fixture 模式下 harness 以 fixture 结构化通路启动（全链真走：单问卡→答卡恢复→候选→评分→交付），非 fixture 环境保留原硬崩+双分支单测。

### 11.3 收尾基线（主会话真机实测，HEAD c4dd32a）

| 检查项 | 结果 |
|---|---|
| core 全量（真 Postgres+DBOS，含新增双向不变量 postgres 测试） | ✅ 1159 tests / 1153 pass / 0 fail / 6 skipped |
| mkfast typecheck + 全量 | ✅ 440 tests / 0 fail |
| contracts | ✅ 34/34 |
| 评测门真跑 | ✅ redlines 7/7（含改坏生产门必红自证）+ preference-memory 0 fail |
| **#47 收件箱 e2e 真机**（四服务真启动 + provision 脚本建库） | ✅ **1 passed（46.1s）** |

### 11.4 本阶段新增 P2 backlog

- #48：brief 重编译两次尝试映射同 spanId（Langfuse 视图覆盖首次）；决策理由自由文本透传的理论 PII 面（建议 enum/ID 化）；importer transport helper 拷贝未与 sender 物理共享。
- #49：promptfoo 层 cases 无显式 assert（独立信号可能空壳，node 测试层已兜底）；abstention 硬等式在 Stage-2 抽取器落地前为诚实空断言。
- #47：读侧发现双阻塞抛 409 整收件箱 fail-closed（防御性脚枪）；completedDelivery 按 platform+variant 匹配不绑 receiptId（幂等键兜底，实际不可达）。
