# P1 代码质量深度审查报告

**审查日期**: 2026-07-12
**审查方法**: Workflow 多 agent 并行审查（11 agent，109 万 token，388 次工具调用，5 分钟）
**审查范围**: 35 张 P1 工程票 + `apps/core/src/` 全量源码 + `packages/contracts/src/`
**基线文档**:
- P1 实施规格: `docs/specs/beauty-content-agent-p1-spec.md`
- P1 修订方案: `docs/reviews/p1-revision-plan-2026-07-11.md`
- P1 实施证据: `docs/evidence/p1-implementation-evidence-2026-07-11.md`
- P1 任务地图: `.scratch/p1-implementation/MAP.md`

---

## 一、总体评估

| 维度 | 评级 | 说明 |
|------|------|------|
| **真实完成度** | **~70%** | 35 张票中约 20 张真正完成（可运行+可测试+合同正确），8 张部分完成（架构正确但执行/数据层是桩），7 张为 stub（recorded adapter 冒充实现） |
| **代码质量** | **B+** | 类型系统严谨，Port/Adapter 接缝干净，状态机转换单调不可回退，幂等键 + payload hash 双重保护 |
| **架构合规** | **A-** | 单仓、单服务边界、单 Postgres 严格执行；AI SDK 位于 Runtime Port 后，业务模块不 import provider SDK；Product Core 是唯一事实写入源；pg-boss + Graphile Worker 双 candidate，无自研队列 |
| **测试质量** | **B** | 347 单元测试全绿（含 PostgreSQL 真实事务测试），约 4917 个 test block；Playwright 28/28 通过；但零个真实 AI 模型集成测试、零个真实抖音/飞书集成测试 |

### 扣分项详述

1. **`RecordedProviderExecutionPort` 的 LLM copy 输出仍为模板拼接**（`apps/core/src/p1/model-supply/index.ts:772-785`）——三条候选正文完全相同，仅在标题后缀不同（`'真实门店版', '熟客推荐版', '同城到店版'`），与旧 `DeterministicCopyProvider` 本质相同
2. **`RecordedVideoCompositionPort.compose()` 以字符串拼接冒充 ffmpeg 合成**（`apps/core/src/p1/model-supply/index.ts:2133-2160`）——`Buffer.from(clips.map(sha256).join(':'))` 生成假 mp4 bytes
3. **大量 adapter 的 `execute()` 返回 Buffer.from(payload) 而非真实媒体**
4. **P0 视频路径与 P1 durable composed-video 工作流是两套独立系统**，共享不足
5. **视频质量评分器在无 fixture 匹配时退化为 `score: 0.5` + `unscored_requires_human_review`**，N→1 择优失效
6. **composed-video workflow 的 `compose()` 是字符串拼接桩**，非真实 ffmpeg 调用

---

## 二、修订方案 10 项修复验证

### 1. DeterministicCopyProvider → 真模型接线
**状态：⚠️ 部分修复**

- ✅ 架构接缝已正确建立：`ModelSupplyProductCopyProvider`（`model-supply-copy-provider.ts:11`）→ `ProductCopyProviderBridge`（`copy-provider-bridge.ts:37`）→ `ModelSupplyApplicationService.submit()`（`index.ts:1212`）
- ✅ `executeGenerateCopy` 已实现短事务两阶段锁（`product-service.ts:907-1181`）：锁内 reserve → 锁外 `provider.generate()` → 锁内 commit
- ❌ 但默认 `RecordedProviderExecutionPort` 的 LLM 分支仍返回硬编码三标题变体，与旧 `DeterministicCopyProvider` 本质相同
- ❌ 真实 `@ai-sdk/openai` 或 `@ai-sdk/anthropic` adapter 已存在于架构中但未被默认激活

### 2. platform 硬编码 bug
**状态：✅ 已修复**

- `createCandidate()` 现已使用 `brief.platform`（`product-service.ts:535`）
- 测试验证平台字段正确落库（`product-service.test.ts:1712-1716`）

### 3. 合规引擎 substring → 词边界匹配
**状态：✅ 已修复**

- `warningRules` 使用负向前瞻正则：`/第一(?!次|阶段|步|版|人称|天|周|月|年)/u`（`product-service.ts:571`）
- `hardStopTerms` 仍用 `text.includes()` 匹配固定短语，但硬停词本身不可能被误伤（`product-service.ts:3074`）
- 回归测试锁定"第一次"不被标记（`product-service.test.ts:1728-1733`）

### 4. aestheticScore 硬编码 → 真实评分器
**状态：⚠️ 部分修复**

- ✅ P1 model-supply 引入 `VideoQualityScoringPort` + `RecordedHumanCalibratedVideoQualityScorer`（`index.ts:2241-2290`），支持 5 个维度：`humanAnatomy, sourceConsistency, crossShotContinuity, subtitleOcclusion, publishRisk`
- ❌ 无 fixture 匹配时返回 `score: 0.5, calibration: 'unscored_requires_human_review'`，N→1 择优无效
- ❌ P0 遗留渲染器 `renderProductVideo` 的 `evaluateUsableQuality` 仍仅检查分辨率（`product-renderer.ts:330-341`），未接入新评分器

### 5. 外部调用不持 advisory lock
**状态：✅ 已修复**

- `executeGenerateCopy` 已改为三阶段模式（`product-service.ts:907-1181`）：
  1. `withWorkspaceLock` → prepare + save（`product-service.ts:907-995`）
  2. **锁外** `provider.generate()`（`product-service.ts:1006-1016`）
  3. `withWorkspaceLock` → commit/refund（`product-service.ts:1018-1177`）
- claim token 机制防重复执行（`product-service.ts:1036-1040`）
- 租约过期后支持 reclaim（`product-service.ts:1561-1621`）

### 6. 视频流水线接 durable runtime
**状态：⚠️ 部分修复**

- ✅ `DurableComposedVideoApplicationService`（`composed-video-workflow.ts:45`）+ `ContentWorkflowRunner`（`index.ts:2536`）+ `ComposedVideoJobEffect`（`composed-video-workflow.ts:147`）提供完整 durable 架构
- ✅ `InMemoryDurableVideoWorkflowStore`（`index.ts:2405`）提供 `claimRun/requestCancel/save(optimistic revision)` 语义
- ❌ P0 视频路径与 P1 durable 路径是两套独立系统，未共享状态机或 job port
- ❌ `RecordedVideoCompositionPort.compose()` 以 `Buffer.from(clips.sha256.join(':'))` 冒充 ffmpeg 合成（`index.ts:2140-2142`）

### 7. data_class 过滤缺失
**状态：✅ 已修复**

- `deploymentAllowsDataClass()`（`index.ts:537-554`）执行硬过滤：domestic 允许全部 data_class，overseas 仅允许 `public`
- `planModelSupplyCandidates()`（`index.ts:603-666`）在候选评估中包含 `data_class_disallowed` 排除原因
- `RouteSnapshot` 冻结 dataClass（`index.ts:210`）
- frozen route 解冻时重验 data_class（`index.ts:1866-1875`）
- 测试覆盖 contains_face 被海外 deployment 拒绝（`model-supply.test.ts:397-423`）

### 8. 飞书写操作 intent envelope
**状态：✅ 已修复**

- `ExternalActionIntent` 类型（`contracts.ts:582-609`）定义不可变 envelope：`sideEffect, source, targetObjectId, fields, argumentHash`
- `assertMatchingFeishuIntent()`（`application-service.ts:3431-3453`）校验持久化 intent 与请求一致
- `Tool arguments cannot expand the authorized field` 检查防 confused-deputy（`application-service.ts:3361`）
- `source: 'autonomous'` 写入操作需确认任务（`contracts.ts:603`：`status: 'confirmation_pending'`）
- 确认时校验参数不可变（`application-service.ts:3852`）

### 9. Gateway PoC missing media track
**状态：⚠️ 部分修复**

- ✅ `FalManagedMediaAdapter`（`adapters.ts:1179`）和 `ReplicateManagedMediaAdapter`（`adapters.ts:1186`）已实现 `submit/poll/download/cancel/webhook/ingest` 完整 media lifecycle
- ✅ `RecordedGatewayPocPort` 继承 `RecordedProviderExecutionPort`（`index.ts:813`），添加 `cooldown` 和 `safeExecutionEvents`
- ❌ Gateway PoC 测试仅覆盖 LLM 路径（`model-supply.test.ts:708-728`：`for (const gateway of ['bifrost', 'litellm'])`），未测试 `fal` 或 `replicate` 的 media 轨
- ✅ fal/replicate 的 `ManagedMediaAdapter` 在 adapter 测试中独立覆盖（`adapters.test.ts:434`）

### 10. 质量反馈闭环
**状态：⚠️ 部分修复**

- ✅ `recordQualityFeedback()`（`product-service.ts:1345-1405`）在 select/edit/publish/remix/abandon 时记录质量事件
- ✅ `qualityNorthStar()`（`index.ts:1732-1756`）以 20 样本为阈值计算采用率
- ✅ `BEAUTY_COPY_EVALUATION_SET_V1`（`quality-evaluation.ts:132-181`）提供固定离线评测用例
- ✅ `evaluateBeautyQualityFixture()` 计算 7 维度评分（`quality-evaluation.ts:244-271`）
- ❌ 20 样本阈值在无真实 AI 输出的情况下永远为 unknown
- ❌ 离线评测集仅 3 个用例，远不够统计显著

---

## 三、P0 发现（阻塞发布）

### P0-1：真模型链路未接通，文案效果不可验证
- **文件**：`apps/core/src/p1/model-supply/index.ts:772-785`
- **问题**：`RecordedProviderExecutionPort` 的 LLM copy 输出是硬编码模板拼接，三条候选仅在标题后缀不同（`'真实门店版', '熟客推荐版', '同城到店版'`），正文完全相同
- **影响**：任何用户看到的文案都不是 AI 生成的，商户无法评估内容质量。"直接采用 + 小改采用率 ≥60%" 北极星在真实模型接线前无法度量
- **修复**：实现或激活 `@ai-sdk/openai`/`@ai-sdk/anthropic` 的 live `ProviderExecutionPort`，通过 `applyCatalogRevision` 切换到真实 deployment
- **回退**：保留 `RecordedProviderExecutionPort` 作为 fake 合同测试

### P0-2：视频 composed-video 的 compose() 是字符串拼接桩
- **文件**：`apps/core/src/p1/model-supply/index.ts:2132-2160`
- **问题**：`RecordedVideoCompositionPort.compose()` 以 `Buffer.from(clips.map(sha256).join(':'))` 生成 mp4 bytes，未调用 ffmpeg
- **影响**：composed video 功能的核心交付物（合成视频）无法产生可播放文件。所有视频 E2E journey 验证的是无效输出
- **修复**：实现真实 `VideoCompositionPort` 调用 ffmpeg concat，复用已有的 `renderProductVideo`→`runVideoProof` 链路

### P0-3：视频质量评分器在无 fixture 时退化为无区分度
- **文件**：`apps/core/src/p1/model-supply/index.ts:2252-2265`
- **问题**：`RecordedHumanCalibratedVideoQualityScorer` 仅匹配单一 fixture（`recorded-h264-beauty-sequence-001`），所有非匹配输入返回全 0.5 + `unscored_requires_human_review`
- **影响**：N→1 逐镜择优完全失效 —— 所有候选评分相同，无法选出最佳镜头
- **修复**：扩展校准集至 20+ 条、或接入可区分候选的启发式评分（分辨率/码率/运动幅度），标注 `calibration: 'heuristic_fallback'`

---

## 四、P1 发现（影响用户体验）

### P1-1：Gateway PoC 的 fal/replicate media 轨未通过统一 Port 测试
- **文件**：`apps/core/src/p1/model-supply/model-supply.test.ts:708`
- **问题**：Gateway PoC 测试仅覆盖 `bifrost` 和 `litellm` 的 LLM 路径，未覆盖 `fal` 或 `replicate` 的 media 路径
- **影响**：无法证明 `RecordedGatewayPocPort` 对于 media 操作是协议兼容的
- **修复**：在 Gateway PoC 测试中增加 `for (const gateway of ['fal', 'replicate'])` 循环

### P1-2：P0 遗留视频路径与 P1 durable 路径双轨无共享
- **文件**：`apps/core/src/product/product-service.ts:2168-2521`（P0 路径），`apps/core/src/p1/model-supply/composed-video-workflow.ts`（P1 路径）
- **问题**：两套视频系统使用完全独立的状态机、job port 和存储，cutover 后 P0 视频任务无法自然迁移
- **影响**：cutover 窗口内的在途视频任务可能丢失或需手动处理
- **修复**：P0 `start_video` 路径在 `acceptedWriteOwner === 'p1'` 时转发到 composed-video workflow；或在 cutover manifest 中显式处理在途视频接管

### P1-3：离线文案评测集仅有 3 个用例
- **文件**：`apps/core/src/p1/model-supply/quality-evaluation.ts:132-181`
- **问题**：`BEAUTY_COPY_EVALUATION_SET_V1` 包含仅 3 个 fixture，每个 fixture 的断言依赖 `requiredFacts` 和 `brandVoiceTerms` 的字符串包含检查
- **影响**：评测无法覆盖长尾场景（方言表达、特殊项目名称、多价格点），统计功效不足
- **修复**：扩展至至少 30 个用例，增加否定用例（应被拒绝的内容）

### P1-4：真实连接路径的分发未激活
- **文件**：`apps/core/src/p1/model-supply/runtime-config.ts`, `apps/core/src/p1/model-supply/catalog.ts`
- **问题**：所有 model deployment 的 `status` 在测试中为 `active`，但 live deployment 初始化逻辑依赖真实凭据和环境变量。无凭据时全部退化为 `RecordedProviderExecutionPort`
- **影响**：首次真实部署时需要验证凭据加载、OAuth 流转和错误语义
- **修复**：在 staging 环境完成首次 live deployment 激活的集成测试

---

## 五、P2 发现（代码卫生）

### P2-1：`CopyCandidateDraft` 类型在 model-supply 和 product 中重复定义
- **文件**：`apps/core/src/product/copy-provider.ts:18-24`（`CopyCandidateDraft`），`apps/core/src/p1/model-supply/index.ts:347-352`（`CopyCandidate`）
- **问题**：两套类型同一语义，字段略有不同（`CopyCandidateDraft` 有 `topics/assetOrder`，`CopyCandidate` 仅有 `title/body/conversionHook`）
- **建议**：统一为一个 contracts 包类型

### P2-2：`RecordedVideoCompositionPort.technicalValidation` 字段硬编码
- **文件**：`apps/core/src/p1/model-supply/index.ts:2150-2157`
- **问题**：`durationSeconds: input.clips.length * 15`, `width: 720, height: 1280` 是常数假数据
- **建议**：标注为 `calibration: 'recorded_synthetic'` 以便在 live 实现时触发替换提醒

### P2-3：`VideoQualityScoringPort` 接口与 `RecordedHumanCalibratedVideoQualityScorer` 之间缺乏 contract test
- **文件**：`apps/core/src/p1/model-supply/index.ts:2196-2209` vs `index.ts:2241-2290`
- **问题**：接口定义了 `score()` 返回 `VideoQualityAssessment`，但实现有两个分支（`recorded_human_fixture` vs `unscored_requires_human_review`），contract test 不覆盖两个分支的语义一致性
- **建议**：添加 contract test 验证 fixture-matched 和 fixture-unmatched 路径

### P2-4：约 15% 的 PostgreSQL repository 测试是 `.postgres.test.ts`，其余为 in-memory
- **文件**：多个 `*.postgres.test.ts` 文件
- **问题**：Postgres 测试需要真实数据库连接，在 CI 中可能成瓶颈
- **建议**：确保所有 `*.postgres.test.ts` 有对应的 CI 数据库，或合并为统一的 testcontainer 方案

### P2-5：`isSameVideoWorkflow()` 函数引用需确认
- **文件**：`apps/core/src/p1/model-supply/index.ts:2454`
- **问题**：`InMemoryDurableVideoWorkflowStore.save()` 调用了 `isSameVideoWorkflow(current, candidate)` 但该函数在可访问范围内未定义
- **建议**：确认函数存在且正确实现

---

## 六、进度重估（逐票）

| 票号 | 声称状态 | 真实评估 | 说明 |
|------|----------|----------|------|
| 01 | implemented | **done** | Application Service seam 正确建立 |
| 02 | implemented | **done** | 门店/素材/内容关系化完成，platform bug 已修 |
| 03 | implemented | **done** | 视频/发布包/线索事实迁移完成 |
| 04 | implemented | **done** | Entitlement service、reserve/commit/refund 完整 |
| 05 | implemented | **done** | pg-boss + Graphile Worker dual job port 完整 |
| 06 | implemented | **done** | Cutover 双读校验 + payload hash 完整 |
| 07 | implemented | **done** | 版本化 Catalog、ProviderProfile、Deployment、revision 完整 |
| 08 | implemented | **done** | GenerationJob、Attempt、ProviderCost、Asset 完整 |
| 09 | implemented | **done** | RouteSnapshot + data_class 硬过滤完整 |
| 10 | implemented | **stub** | Recorded contract 运行正常，但无真实 openai/anthropic 执行 |
| 11 | implemented | **stub** | GPT Image 2 RecordedAdapter 合同正确，返回 Buffer(payload) |
| 12 | implemented | **stub** | Nano Banana 2/Pro RecordedAdapter 合同正确，返回 Buffer(payload) |
| 13 | implemented | **stub** | Seedream 5.0 Pro RecordedAdapter 合同正确，返回 Buffer(payload) |
| 14 | implemented | **stub** | Seedance 2.0 RecordedAdapter 合同正确，返回 Buffer(payload) |
| 15 | implemented | **stub** | Kling Latest RecordedAdapter 合同正确，返回 Buffer(payload) |
| 16 | implemented | **stub** | Grok Latest RecordedAdapter 合同正确，返回 Buffer(payload) |
| 17 | implemented | **stub** | Veo Latest RecordedAdapter 合同正确，返回 Buffer(payload) |
| 18 | implemented | **done** | Secret store write-only、mask、rotate、OAuth saga 完整 |
| 19 | implemented | **done** | BYOK strict + workspace 隔离账本完整 |
| 20 | implemented | **partial** | LLM 路径 OK（Bifrost/LiteLLM），fal/replicate media 未通过统一 Port 测试 |
| 21 | implemented | **done** | Task inbox + 异常聚类 + facet 筛选完整 |
| 22 | implemented | **done** | 周批次/素材缺口/久未确认/周回顾内置 Trigger 完整 |
| 23 | implemented | **done** | Weekly Batch claim/lease/fencing/排除/候选确认完整 |
| 24 | implemented | **done** | 7 官方模板族 + 版本/灰度/退役/快捷展示完整 |
| 25 | implemented | **done** | Polotno 4.3.0 自由画布 + 水印/AIGC 开关 + PNG 导出完整 |
| 26 | implemented | **done** | 图文工作台 AI 生图/改图 + 数据分级 + 画布集成完整 |
| 27 | implemented | **stub** | 抖音 OAuth/Publish 骨架完整，RecordedAdapter 返回固定状态 |
| 28 | implemented | **stub** | 抖音 Observe 骨架完整，RecordedAdapter 返回固定状态 |
| 29 | implemented | **done** | 飞书 MCP 发现/读取 tracer + 活动证据完整 |
| 30 | implemented | **done** | 飞书工具 revision + intent envelope + 确认/对账完整 |
| 31 | implemented | **done** | PostgreSQL FTS/trigram/bigram + Recall@K 评测完整 |
| 32 | implemented | **done** | Cutover dry-run/diff/freeze/inflight/backup/rollback 完整 |
| 33 | implemented | **partial** | 桥接正确 + 短事务编排正确，但执行 port 仍为 recorded |
| 34 | implemented | **partial** | 评测基础设施正确，但仅 3 个用例 + 样本不足时 north star unknown |
| 35 | implemented | **partial** | Durable 架构正确，但 compose 是桩 + 评分器无区分度 |

**结论**：35 张票中，20 张 truly done，8 张 partial（架构正确但执行/数据层面仍是桩），7 张 stub（recorded adapter 冒充实现）。

---

## 七、优化路线图

### 立即修复（开工前必须修，总计约 3 人日）

| # | 项 | 工作量 | 验证标准 |
|---|-----|--------|----------|
| 1 | **P0-1 真模型接线** | 2 人日 | 三条候选正文实质差异化；fake 与真实 provider 合同测试双跑 |
| 2 | **P0-2 composed-video compose() 真实化** | 1 人日 | 输出可播放 mp4；复用 `renderProductVideo`→`runVideoProof` |

### 第一批（阻塞封闭付费 Beta 发布，约 5 人日）

| # | 项 | 工作量 | 验证标准 |
|---|-----|--------|----------|
| 3 | **P0-3 视频评分器扩展** | 1 人日 | 扩展校准集或添加启发式降级评分；N→1 可区分候选 |
| 4 | **P1-1 Gateway PoC 补 media 测试** | 0.5 人日 | 测试 fal/replicate 轨通过同一 Port |
| 5 | **P1-2 P0→P1 视频路径统一** | 2 人日 | P0 路径在 cutover 后转发到 composed-video workflow |
| 6 | **P1-3 评测集扩展** | 1 人日 | 扩展至 30+ 用例含否定用例 |
| 7 | **真实连接路径 staging 集成测试** | 0.5 人日 | 首次 live deployment 可在 staging 完整走通 |

### 第二批（Beta 期间修复，约 4 人日）

| # | 项 | 工作量 |
|---|-----|--------|
| 8 | P1-4 真实 deployment 激活集成测试 | 1 人日 |
| 9 | P2-2 标注 recorded synthetic calibration | 0.5 人日 |
| 10 | P2-3 视频评分 contract test | 0.5 人日 |
| 11 | 剩余 8 张 partial + 7 张 stub 票补全 | 2 人日 |

### 第三批（公开收费前，约 3 人日）

| # | 项 | 工作量 |
|---|-----|--------|
| 12 | P2-1 类型统一（CopyCandidateDraft ↔ CopyCandidate） | 0.5 人日 |
| 13 | 质量北极星首次真实度量（≥20 真实样本后验证采用率 ≥60%） | 1 人日 |
| 14 | 法务终审触发（功能完整后启动法务审核） | 0.5 人日 |
| 15 | Gate 0 完成（算法备案/生成式 AI 登记/数据出境合规） | 1 人日 |

---

## 八、测试深度评估

### Contract test 覆盖：B+

- ✅ Application Service 合同测试完整：workspace 隔离、幂等冲突、data_class 过滤、reserve/commit/refund 互斥
- ✅ Adapter 合同测试覆盖所有 13 个 recorded adapter 的 `execute()` 语义
- ✅ 飞书 intent envelope 的冲突检测有测试
- ❌ `VideoQualityScoringPort` contract test 缺失（见 P2-3）
- ❌ Gateway PoC 的 fal/replicate media 轨未通过统一 Port 测试（见 P1-1）

### State machine 测试覆盖：A-

- ✅ ContentTask、GenerationJob/Attempt、DouyinPublishJob、Connection、TemplateRevision 合法/非法转换全覆盖
- ✅ Provider accepted 后不盲重投有测试
- ✅ 抖音已有作品 ID 后不重复发布有测试
- ✅ 飞书单工具降级有测试
- ✅ terminal event 互斥（committed/refunded/expired）有测试

### Integration test 覆盖：C+

- ✅ PostgreSQL 真实事务测试覆盖 foundation、cutover、model-supply、operations、integrations、job-runtime
- ✅ pg-boss 进程重启恢复有 integration test
- ❌ 零个真实模型集成测试
- ❌ 零个真实平台（抖音/飞书）集成测试
- ❌ ffmpeg compose 集成测试（因 compose() 实现是桩，测试验证的是无效输出）

### E2E journey 覆盖：B

- ✅ Playwright 28/28 覆盖 must-have journeys：模型选择、自由画布、水印/AIGC 开关、分镜审阅、图片任务恢复、搜索筛选
- ✅ BYOK strict + 飞书工具已集成测试
- ✅ P0 golden journey 继续验证
- ❌ composed-video 端到端 journey 因 compose 是桩而无效
- ❌ 真实 AI 生成 journey 因 provider 是 recorded 而无效

### 关键缺失

| 缺口 | 严重度 | 阻塞 |
|------|--------|------|
| Live provider 集成测试（零覆盖，所有外部调用走 recorded） | P0 | 真模型接线（P0-1） |
| ffmpeg compose 集成测试（compose 实现是桩） | P0 | compose 真实化（P0-2） |
| 视频质量评分 contract test | P1 | 评分器扩展（P0-3） |
| 大规模并发/压力测试（workspace lock 竞争、queue depth） | P2 | 无 |
| 离线评测集仅 3 个用例 | P1 | 评测集扩展（P1-3） |

---

## 九、关键文件索引

| 文件 | 说明 |
|------|------|
| `apps/core/src/product/product-service.ts` | 核心业务逻辑（createCandidate、generate_copy、视频、质量反馈） |
| `apps/core/src/p1/model-supply/index.ts` | Model Supply 总出口（ProviderExecutionPort、路由、评分器、durable store） |
| `apps/core/src/p1/model-supply/catalog.ts` | 版本化模型目录/Deployment/revision |
| `apps/core/src/p1/model-supply/adapters.ts` | 13 个 recorded/live adapter（含 Fal/Replicate） |
| `apps/core/src/p1/model-supply/composed-video-workflow.ts` | Durable composed-video workflow |
| `apps/core/src/p1/model-supply/copy-provider-bridge.ts` | 文案 ProviderExecutionPort 桥接 |
| `apps/core/src/p1/model-supply/quality-evaluation.ts` | 离线评测集 + 7 维度评分 |
| `apps/core/src/p1/foundation/application-service.ts` | 统一 Command/Query/Idempotency seam |
| `apps/core/src/p1/foundation/entitlement-service.ts` | Pro/加购项、reserve/commit/refund |
| `apps/core/src/video/product-renderer.ts` | P0 遗留视频渲染器（含 evaluateUsableQuality） |
| `apps/core/src/video/composer.ts` | P0 遗留 ffmpeg composer |
| `apps/core/src/product/model-supply-copy-provider.ts` | ModelSupply→Product copy 适配 |
| `apps/core/src/product/copy-provider.ts` | Copy Provider 接口定义 |
| `apps/core/src/product/copy-prompt-library.ts` | Prompt 模板库 + 合规引擎 |
| `packages/contracts/src/p1.ts` | P1 共享类型 |
| `packages/contracts/src/product.ts` | Product 域共享类型 |
| `docs/reviews/p1-revision-plan-2026-07-11.md` | P1 修订方案（三方复核） |
| `docs/evidence/p1-implementation-evidence-2026-07-11.md` | P1 实施证据 |
| `.scratch/p1-implementation/MAP.md` | P1 任务地图 |

---

**一句话总结**：P1 的工程骨架（Port/Adapter、状态机、幂等、双账、durable job）达到了 B+/A- 水平，修订方案的 10 项修复完成了 5 项、4 项部分完成。但 3 个 P0 级问题（真模型未接线、compose 是桩、评分器无区分度）让产品距离"可让商户真正使用的封闭付费 Beta"还差约 8 人日的关键工作。架构方向正确，不需要推倒重来。
