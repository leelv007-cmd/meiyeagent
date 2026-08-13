# V31-89 — 「说一句」LLM 提取接线：Day-0 档案由模型整理，而不是前端正则

**Parent**: V31-86 Phase 2 可行性报告（`docs/reviews/v31-86-phase2-llm-arrange-feasibility-2026-08-13.md`）
**批次**: 清红队列（P1，Day-0 智能化——用户二轮拍板的另一半）
**Blocked by**: 无（V31-86 Phase 1 已合入，provenance 位已留）
**Related**: V31-84（正则即时层）、V31-86（档案卡与门 2 豁免）

**Status**: implementation-complete（2026-08-13）— 新 command 落地并活体证毕：纯口语句（正则抓不到）整理进档案卡，一击保存写库

**Implementation state**: implemented
**Verification state**: live-verified（新号空档案：说「我这家店叫晨昕美睫，开在成都高新区，做一次日式接睫毛收两百六」→ 名称/城市/行业(lash) 自动填入并标 AI 推测、三项平台兜底带徽章→补两项后**一击保存 200**→facts 5 条、profile 正确、回执 provenance 区分 ai_suggestion/platform_default/merchant_stated。变异：允许覆盖商家改值红）
**Evidence SHA**: 7e6876aca407939a953ded2ef88d57d996da1fb0
Evidence 注：走查号 journey-v3189-195946@example.test（ws_5unvREKBlOjpfBljBb7YJVWVvDEgQBCC）
**Workflow Run**:
**Artifact Digest**:

## 为什么另立票

用户二轮拍板要求「LLM 多介入这样简单的判断和推荐」。V31-86 交付了「不再反复确认」那一半
（档案卡批量确认），**智能那一半仍是前端正则**（V31-84 的 `extractStoreFactsFromSentence`）。
复用现有 capture 域不可行：字段词表是 tools/steps/corrections，产物是 `StoreWorkflowRecipe`；
入口要 `dbosWorkflowId + sourceConversationId + catalogRevision`；读上下文通道固定
`conversation.current`。硬接=新造 Core 链路，故拆票。

## What to build

1. **合同**：新 command（建议 `extract_store_sentence`）或把 parse target 扩到
   `spoken_sentence`；输出=门店档案字段建议（name/city/projectName/projectPrice/district…）
   ＋每字段置信与出处，**不新增 profile 字段口径**。
2. **Core**：fixture 档 canned 编译器（e2e/dev 恒绿）＋ production 编译器走既有模型供给；
   写通道仍只有 `finalize_store_intake`。
3. **向导**：正则即时填（保留，零延迟）＋ LLM 结果异步回填——**只填空、不覆盖商家已改值**；
   失败静默保留正则结果（三允许总纲：不为模型出错阻塞流程）。回填字段 provenance
   仍是 `ai_suggestion`，档案卡照常一击确认。
4. **测试**：fixture 绿测＋「不覆盖已改值」＋「提取失败不阻断保存」＋回填后档案卡渲染。

## Acceptance criteria

- [x] 合同（`extract_store_sentence`）＋fixture canned 落地，零外网
- [x] 异步回填只填空不覆盖（`provenance==='user'` 免疫，平台兜底可升级）；失败静默不阻断——均先红后绿
- [x] 活体证毕（见 Verification state）
- [x] 与 V31-86 档案卡合流：徽章正确、无新增确认步骤、保存路径不变

## 收口补记（2026-08-13 主控）

- **主控直修（活体抓到）**：fixture 编译器把「开在成都高新区」整段读成 district（带动词、
  且与城市重复）。档案卡会把它预填出来，商家一次点头就写进档案。修法=city/district 合读、
  捕获不得跨越处所动词、只重复城市的 district 宁可不说；「门店在西湖区」这种分开说的仍抓得到。
  先红后绿，见 `store-sentence-extract.test.ts` 两条新测。
- **诚实边界**：fixture 档对「日式接睫毛」「两百六」未识别（返回空而非瞎猜），商家手填后
  provenance 记 `merchant_stated`。production 档走真实模型，覆盖面另计。
- **未覆盖**：production 档提取质量未实测（需真实模型凭证）；全栈 e2e 归旅程门轮。
