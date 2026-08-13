# V31-89 — 「说一句」LLM 提取接线：Day-0 档案由模型整理，而不是前端正则

**Parent**: V31-86 Phase 2 可行性报告（`docs/reviews/v31-86-phase2-llm-arrange-feasibility-2026-08-13.md`）
**批次**: 清红队列（P1，Day-0 智能化——用户二轮拍板的另一半）
**Blocked by**: 无（V31-86 Phase 1 已合入，provenance 位已留）
**Related**: V31-84（正则即时层）、V31-86（档案卡与门 2 豁免）

**Status**: open（2026-08-13）— 可行性已定性，未派工

**Implementation state**: not-started
**Verification state**: n/a（新建能力）
**Evidence SHA**: 97f534d0c76a4c2b6f92222f70e831e21fb4dbfb
Evidence 注：V31-86 lane 的只读调查结论；`store_workflow_capture` 域=店内作业流程菜谱，非门店档案
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

- [ ] 合同与 fixture canned 落地，dev/e2e 默认档零外网可跑
- [ ] 异步回填只填空、不覆盖；失败不阻断（先红后绿）
- [ ] 活体：说一句含非模板措辞（正则抓不到的表达）也能被整理进档案卡
- [ ] 与 V31-86 档案卡合流：来源徽章正确、保存路径不变
