# V31-86 Phase 2 — 「说一句」LLM 整理接入可行性

**结论：不可接。** 本票走定性报告，不半接线。正则即时层（V31-84）保留。

## 调查对象

`p1_store_workflow_capture_*`（`apps/core/src/p1/skills/store-workflow-capture.ts`）与 harness 通道。

## 断点

1. **域不对。** capture 会话的字段词表是 `tools | steps | corrections | inputOutputFormats`，产物是 `StoreWorkflowRecipe`（店内作业流程菜谱），不是门店档案 `name/city/district/address/booking/project*`。
2. **入口不对。** `store_workflow_capture_start` 要求 `sessionId + taskId + dbosWorkflowId + workflowRevision + sourceConversationId + catalogRevision`，且 `taskId === dbosWorkflowId`。五步录入第 3 步的「说一句」只是一段 textarea，没有 DBOS workflow、没有 conversation、没有 catalog revision。
3. **读上下文通道不对。** start 后走 agent primitive `read_context`，scope 固定 `conversation.current`，query 是 conversation id。句子不在 conversation 里，这条通道读不到。
4. **harness / parse 也接不上。** parse-service fixture 编的是价目表照片 / 视觉槽位，不是一句口语。五步向导 interaction 测试已钉：整条路径从不发 `store_workflow_capture_start`。

把「说一句」送进现有 capture 域，等于新造一条 Core 链路：新 command、新字段词表、新 canned fixture、向导异步回填协议。那不是接线，是新票。

## 若要做，工程量（建议拆票）

| 块 | 工作 | 量级 |
|---|---|---|
| 合同 | 新 command（如 `extract_store_sentence`）或把 parse target 扩到 `spoken_sentence`；canned fixture 出 name/city/project/price/district 建议 | M |
| Core | fixture 编译器 + production 编译器占位；只填空、不覆盖商家已改值；与 finalize 仍只走一条写通道 | M–L |
| 向导 | 正则即时填（已有）+ 异步回填空位；失败静默保留正则结果 | S |
| 测试 | fixture 绿测 + 不覆盖已改值 + 不发 capture 域 | S |

建议后续票面：`V31-xx spoken-sentence LLM extract（新 command，不复用 store_workflow_capture）`。本票不预埋半截 client。

## 本票已保留

- V31-84 正则即时层：`extractStoreFactsFromSentence` + 前进自动整理。
- 第 5 步档案卡对 AI 推测行标注 `ai_suggestion`，给未来异步回填留了 provenance 位，但没有调用任何 capture / harness 提取 API。
