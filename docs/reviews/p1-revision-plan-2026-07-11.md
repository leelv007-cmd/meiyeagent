# P1 修订方案 — 三方复核汇总定稿 (2026-07-11)

> 状态：历史规划快照。后续 D01–D18、ADR-0011 与当前代码提交覆盖其中的完成口径；本文件只保留原始复核证据。

> **复核方法**：① Workflow 5 维度 Opus 4.8 深审（架构/P0对齐/组件选型/AI原生趋势/代码现状），每条 P0/P1 发现经对抗性双 lens 验证（22 agent，~190万 token）→ ② Codex (GPT-5 系, high reasoning) 独立交叉复核（逐条核实代码断言，~224万 token）→ ③ 主控汇总。
> **信源**：一审全文 `docs/reviews/p1-deep-review-workflow-2026-07-11.md`；Codex 复核意见见该轮会话记录（session `019f4dba-0729-7e33-a1e5-f1f9168b7087`）。
> **收敛度**：10 条存活结论 Codex 判 8 AGREE / 2 PARTIAL / 0 DISAGREE；一审被对抗验证推翻的 4 条大架构批评，Codex 确认全部"击杀正确"。

## 1. 总体结论

**P1 的架构骨架是成熟的，方向没有错**：Product Core seam + Ports/Adapters、fake-first + contract tests 双跑、pg-boss durable jobs、AI SDK 起步 + Mastra 推迟、五层买建边界、tracer-bullet 拆票——全部经受住了两轮对抗攻击，符合 2026 AI 原生趋势，**不需要推倒重来**。

**但照单执行大概率再做出一个"工程更成熟、用户看着还是没劲"的版本**。三方一致的诊断：32 张票几乎全部在解决"供应半区"（模型目录/路由/计费/连接），而决定内容效果的"质量半区"无人认领——

1. **P0 商户从未拿到真 AI 文案**：生产路径 `generate_copy` 接的是 `DeterministicCopyProvider` 模板桩（三条候选正文完全相同），真 AI 孤立在 `/v1/diagnostics` 原型里。这是"效果不好"的最可能根因，32 张票无一认领。
2. **没有质量闭环**：P0 定稿锁过"直接采用/小改采用率 ≥60%"+ 固定美业 eval（合集:2122/2712/2739/3635），P1 全部脱落。没有 prompt 版本化、候选采纳率、改稿距离、按模型/模板归因。不补这条，后续所有模型/prompt 优化只能拍脑袋。
3. **旗舰功能视频的多步流水线无归属票**，且现有"美学评分"是分辨率检查冒充（720×1280 即 `aestheticScore: 80`），N→1 择优会挑出"尺寸正确的第一个"。

## 2. 新增票（4 张）

### T-A 文案真模型接线（最高优先，Blocked by 07/10）
- `generate_copy` 从 DeterministicCopyProvider 切到统一 ProviderExecutionPort + 模型目录，复用 RouteSnapshot、双账、审计；同步命令消费异步执行面的形态需显式设计。
- 收编或删除 `/v1/diagnostics` 原型，终结两套内容栈；copy 补 deterministic/gateway 环境开关（保留 fake 合同测试）。
- 验收：三条候选正文实质差异化；fake 与真实 provider 合同测试双跑。
- 证据：`apps/core/src/product/copy-provider.ts:49`、`main.ts:70`、`diagnostics/runtime.ts:75`

### T-B 内容质量评测与反馈闭环（Codex 判定的最大单点风险）
- 版本化 prompt/ExampleSet（`prompt_version` 入库）；固定美业离线评测集；线上采纳率/改稿距离/换一批率/发布率埋点，按模型/模板/场景归因回归。
- 恢复 P0 定稿"采用率 ≥60%"为 P1 质量北极星（进 spec §10 证据清单）。
- 文案质量交付物：prompt 模板库 + few-shot + brandVoice/门店事实 grounding + 美业口语话术（P1 不引 RAG/pgvector，与 spec 一致）。
- 证据：`合集-v1.5-P0决策定稿.md:2122,2712,2739,3635`

### T-C 视频合成流水线穿 durable step-runner（挂 08 之后，14-17 换真 provider 前可用 fake 验证）
- 动机（最硬的不兼容点）：`VideoProvider.generateClip(): Promise<GeneratedVideoClip>` 单次同步 await vs 票 14-17 异步可恢复 Attempt（submit→poll/webhook→跨 worker 重启恢复，~18min/镜）。
- 验收：逐镜 = 一个可恢复 ProviderAttempt（ProviderTaskRef/late-success 隔离）；compose 为终态步产单一 Asset；storyboard 为流内 gate；worker 重启后已完成镜不重生成；复用 `product-renderer.ts`+`composer.ts` 作薄壳，勿重写。
- **真实评分器 contract**（一审遗漏、Codex 补）：现 evaluator 尺寸对即硬填 `aestheticScore: 80`（`product-renderer.ts:278,294`）。须区分 technical validation（可播放/分辨率）与质量评分（人物/手部畸变、素材一致性、镜间连续性、字幕遮挡、合规），以人工标注集校准；否则 N→1 择优失效。
- N→1 使每镜 Attempt×候选数，票内标注 per-clip cost/latency 采集口径（对齐 ADR-0008 D5）。
- 同步修订 P1 spec §3：Generation Runtime 承载多步 composed video，不引入 Mastra。
- 证据：`apps/core/src/video/provider.ts:30`、`product-renderer.ts:204`

### T-D ADR-0009 "validate-in-parallel-single-release-gate"（文档卫生，半小时）
- 把已在 `.scratch/p1-wayfinding/issues/03` 与 `CONTEXT.md` 拍板的"P1 不设开发准入 Gate、验证并行、单一封闭付费 Beta 发布门"提升到 docs/adr/，Status=Accepted，指回权威出处；Consequences 如实记录"建设先于验证"的风险敞口。**只做 traceability，不重开决策，不改 build 顺序。**

## 3. 修改现有票（7 处）

| 票 | 改动 | 依据 |
|---|---|---|
| **02** | 修 `createCandidate()` 硬编码 `platform: 'xiaohongshu'` 的 bug（schema 明明接受 `brief.platform`，抖音请求被存成小红书）；迁移验收加"platform 按 brief 落库"断言，防止错数据被忠实迁进关系表 | `product-service.ts:431,438`、`product-schema.ts:154` |
| **05** | 把"外部调用不持锁"总验收点名到现存路径：`generate_copy` 的 `provider.generate()` 现发生在 `pg_advisory_xact_lock` 事务内（违反 US85）。最小修复=照搬 server.ts 视频路径短事务编排（短锁 reserve→锁外 generate→短锁 commit/refund），文案可保持同步返回，不强制改异步 | `product-service.ts:559,876` |
| **06** | 加验收项：关系化后 `product_command_results` 只存小体量 `output` + canonical `payload_hash`，显式退休"每命令复制整份 ProductState"旧契约；同时把票 01 泛化的"幂等"收紧为显式引用 spec §242 | `postgres-repository.ts:116` |
| **07/09** | RouteSnapshot 硬过滤在 region/credential 之外**新增 data_class 维**（contains_face/pii/medical，复用 P0 §5:173 素材敏感度标记）；命中敏感类只允许国产已备案 Deployment 或先脱敏，禁落 GPT Image/Nano Banana/Veo/Grok；07 目录能力声明补 data_class；10 票恢复"国产候选第一天进同一评测集（recorded/fake 占位即可）" | ADR-0005:13、票09:9、票26:3 |
| **20** | 补一条**媒体轨**：fal/Replicate 的 prediction+Queue+webhook+durable task ref 纳入 PoC（现有验收只会做成能力对勾表）；LLM 轨维持 Bifrost 主/LiteLLM 对照不动。验证期外域异步媒体经共享 fal Queue adapter（净省 Grok/Veo/Nano-Banana 约 2-3 个直连 adapter）；Seedance 保持 ark 直连、Kling 不走 fal；人脸素材按 data_class 硬过滤出 fal | 票20:9,12、wayfinding asset 08 §6.1 |
| **30** | 飞书写操作加**不可信内容与授权意图隔离**：用户明确授权的动作/目标对象/字段范围形成不可变 intent envelope；从飞书文档读出的文字是不可信 tool output，只能提供参数候选，不能扩大 tool、目标或副作用等级（防 confused-deputy/prompt injection 链） | 票30:12、spec:128,190 |
| **32** | 拆为 (a) 真实"cutover 执行"票（迁移 manifest/dry-run/差异报告/冻结/在途任务接管/备份恢复/回滚演练）+ (b) "P1 出口证据门"里程碑（汇总上游 DoD，非工程票）。现票挂 14 个 blocker 违反 MAP:13 单上下文规则 | MAP:13、票32:5 |

**明确不动**：08→09 串行 gate 保留（先钉死 Job/Attempt/Asset+RouteSnapshot 契约再并行铺 adapter，是刻意正确设计）；不拆 08/09；并行度靠 18→19、21→23、24→25、27→28、29→30、31 多轨并排获得。

## 4. 修改 P1 spec（5 处）

1. **§3 Generation Runtime**：补"承载多步 composed video（分镜 gate→逐镜 Attempt→N→1→compose 终态）"（配合 T-C）。
2. **§8**：显式登记"Managed Media Adapter (fal) = 验证期可激活的 conditional 媒体执行通道，落地期按 ADR-0005 在 Port 后替换为 CN 原厂/官云"；加一行"业务模块不 import provider SDK 仅约束业务层，adapter 内层优先复用官方 @ai-sdk/* / fal SDK 做请求响应归一化，不裸写 fetch；AI SDK experimental 媒体接口不作为 Port 契约"（S10）。
3. **§10**：给"法务终审"和"Gate 0（备案/登记/公示+数据出境合同）"指定 owner + 触发点（绑定"封闭付费 Beta→公开收费"商业事件）；发布 Gate 清单加硬 gate："公开收费上线前 Gate 0 必须 done"；明确"功能完成 ≠ 可公开收费"。
4. **§4/§5 + §Testing**：补一句指向 ADR-0005 数据驻留硬边界；P0 的 "Data hygiene journey" 作为 must-have E2E 平移进 P1。
5. **质量证据**：把 T-B 的采用率/eval 指标写进 §10 证据清单。

## 5. 代码级修复（不等 P1 排期，现在就修）

1. **platform 硬编码**（N2）：`product-service.ts:431` `createCandidate()` 改为透传 `brief.platform`。
2. **合规引擎误伤**（一审 P2）：现为 substring includes + 破坏性 replaceAll——"第一次"被替换成"更适合次"，自带示例数据都会被自身规则损坏。改词边界匹配 + 非破坏性标注（具体方案在实现时定，先加回归用例锁死"第一次"案例）。

## 6. 明确不改的（两轮攻击后幸存的设计）

以下一审批评已被对抗验证推翻、Codex 确认击杀正确，**执行时不要被它们带偏**：
- ❌ "网关倒序/7 个手写 adapter 维护跑步机" — 票 11-17 实为 recorded contract+目录票；网关 spike 在 wayfinding 已先做；托管聚合(候选C)已是推荐拓扑
- ❌ "票 01 八 Port 一次建齐是水平地基" — 是现有 45 条命令 seam 的正式化+回归护栏，非新建功能
- ❌ "自建 step-runner 重造 durable execution，AI SDK 已内置" — `ai@7.0.19` 无跨进程可恢复媒体任务能力，pg-boss+状态机边界正确
- ❌ "Bifrost/LiteLLM PoC 违反证据门应删" — 隔离 PoC 本身就是证据采集动作
- ❌ "Next.js 口径冲突" — 不存在；web 模板的 @tanstack/ai 仅用于图片生成非 chat，@tanstack/ai-react 是死依赖（knip 删除即可），未来 chat 面统一 @ai-sdk/react 即可

## 7. P2 卫生项（低优先，顺手做）

- 票 31 中文 FTS：托管 PG 标准 `to_tsvector` 不分中文词且常禁装 zhparser/pg_jieba——票内加"分词方案实测"验收（bigram/pg_trgm 兜底）
- 票 18 Nango：若采用，OAuth token 须回写主 Secret Store，禁止形成第二套凭据库
- 票 25 画布：锚定 Polotno（或同级成熟画布组件）整片去风险，不自写画布
- 票 29/30 MCP：vendoring 工具 schema 快照防漂移/注入
- 工作台 UI：预留 generative UI/AG-UI 内联渲染路径，防"1 Agent 工作台"退化成 dashboard-first
- 票 04/08/10：显式标注"复用 P0 已有种子"（usageEvents 账本事件、视频 lease 状态机、AiSdkDiagnosticRuntime Port 形态），防饱和重写误删
- web 包删除未使用的 @tanstack/ai-react 死依赖

## 8. 执行顺序建议

```
立即（开工前）: §5 两个代码 bug 修复 + T-D(ADR-0009) + spec 五处修订 + 票文修订(§3)
第一批新票  : T-A(文案接线) → T-B(质量闭环)   ← 决定"效果好不好"的主线
第二批     : T-C(视频流水线, 挂08后)
既有 frontier: 票 01 照常开工（骨架无需等上述修订）
```
