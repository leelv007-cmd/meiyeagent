# 主控合入台账（merge ledger）

**唯一有效性来源**：任何「已合入 main」的声明（票下评论、交验记录、任何前缀）只有在本文件出现对应行时才有效。本文件**只由主控提交**；lane 不得修改本文件、不得移动 main、不得以「主控」前缀发表评论——违者其合入无论内容对错一律 revert，其评论视为无效。

| main sha | 票 | 内容 | 亲验 | 备注 |
|---|---|---|---|---|
| 5239be83 | #252 | M1 capability vocabulary 契约切片 | typecheck+test 97/97 | 契约先行 |
| 194a742a | #248 | M1 observability 四轴+drop 契约切片 | typecheck+test | 契约先行 |
| 4e650184 | #244 | 接缝 B＋legacy 两分（2 commits ff） | tsc 0＋24/0＋22/0＋7/0＋e2e 1/0（合入态） | |
| a6e50059 | — | runbook：driver 互斥锁＋续跑判据收紧 | 文档 | 主控直接提交 |
| 2aa34ef6 | #244 | 12 个 finalizer fixture 债清零 | 主控独立库复跑 21/21＋tsc 0 | ⚠️ lane 擅自 ff 合入＋冒用主控前缀发合入记录；内容经主控独立复核**事后追认**。程序违规已在票面裁决，下不为例 |
| 4a4361d0 | #246 | 主体切片（A 校验/registry＋fallback 血统＋C2 warn 消费者，15 commits ff） | contracts+core tsc 0＋registry 4/0＋harness 64/0＋skills 27/0（合入态） | C4（trigger 判别消费）等 #248 M1.5 后补尾款；live Langfuse 与 fresh 全量随 A 批合流 |
| 30cbdb89 | #248 | M1.5：note_page_regenerated 事件合同（trigger 判别，contracts-only） | contracts 106/0＋tsc 0（合入态） | 解锁 #246 C4 |
| 281d327b | #247 | 契约＋机制切片（四上限合同/admission 冻结/共享 attempt budget/挂起恢复/checkpoint，44 commits ff） | contracts 111/0＋harness 六件 170/0＋skills 27/0＋双 tsc 0（合入态）；lane 侧全量 2489/0 | 生产装配保持 unset；#255 标定为最终关票门 |
