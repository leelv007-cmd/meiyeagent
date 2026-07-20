# WT-2 合同与存储线 Handoff

> **状态：历史 handoff，实施已合入。** 保留作 #25/#30/#32/#37/#43 的属主与接缝证据；当前状态见 [`../reviews/implementation-gap-ledger-2026-07-19.md`](../reviews/implementation-gap-ledger-2026-07-19.md)，不要据此重新开工。

**使命**：全图的类型地基与数据真相层。你先交付 contracts（#25，所有线都等它）与 ContentPackage OCC（#30），再交付事实账本+六维编译（#32）；扇出后接资产进入（#37）与做同款/学习旁路（#43）。

**文件域**：`packages/contracts/`、`apps/core/src/p1/operations/`（application-service、postgres-repository、content-package）。

## 认领序列

1. **#25 合同类型扩展**（无阻塞，**第一优先**——WT-1/WT-4 都在等）：三进三出类型+进度 envelope。修订节要点：`HARNESS_STAGES` 协议值冻结（intent_naming…assembly_delivery）；`sequence`（事件游标）与 ContentPackage `revision`（并发令牌）**分名不混用**；`workflow.progress`/`workflow.state` 两类帧 schema；复用 `assistantFieldPatchSchema` 不造同义类型；验收须给出可复制的测试命令。
2. **#30 ContentPackage 聚合 OCC**（等 #25）：内部分批 A=contracts+迁移+repository CAS+backfill、B=全部调用链改造。修订节 P0：冲突=409+无业务残留+**恰一条 `revision_conflict` 权威审计**；写路径清单补全（视频 reconcile/custody repair/撤权批量/Pro Studio adoption 全进 CAS）；列与 payload revision 同事务一致；递增=每次成功 CAS 恰一次（reducer 多 transition 不累计）。**你的 B 批是 WT-1 #35 的前置**。
3. **#32 事实账本+六维编译+ContextBundle**（等 #25）：内部分批 A=账本 schema/来源/时效、B=三池编译+canonical hash+**不可变 Bundle revision**、C=失效联动接口。修订节 P0：PoC 的 freezeBundle 是原地覆盖，**只抄 fence 控制流、禁抄持久化形态**；围栏须覆盖 `sourceRevisions` 八项不只 factsVersion。**你的 A+B 是 WT-1 #34 的前置**。
4. （#35 合入后）**#37 资产流内进入**（等 #28，WT-4 已完）：对象分流——事实进账本/素材进授权库/身份只出候选给 #39；入口只消费冻结 ContextBundle 禁直读账本。验收按修订节五条可判定断言。
5. （#35 合入后）**#43 做同款/系列/晋升+学习旁路**：内部分批 A=做同款/系列/AssetRevision、B=PreferenceCandidate（等 #41）。修订节两条硬货：`reuseContentPackage` 的复制语义违 D-014，做同款必须重编译不复制旧文案；Preference 确认后=`inactive_stage2`，仓内不得存在 enable 命令。

## 上下游

- **等你的**：#25 解锁 #30/#31/#32/#33 四张（尽快合入，一天内）；#30B+#32 解锁 WT-1 的 #34/#35；#32 的失效联动被 #42/#45 消费；#37 解锁 #44/#45；#43 解锁 #39/#49。
- **你等的**：#37 等 WT-4 的 #28（已在其首位）；#43B 等 #41（扇出后 WT-5）。

## 必读与红线

- 票体修订节；r2 报告 `.scratch/ticket-code-inventory-codex-2026-07-18/r2-durable-occ.md`（OCC 方案与写路径锚点全在里面）；admin-config PG head-CAS 是你的照抄范例（`admin-config/postgres-repository.ts:273/336`）。
- 红线：并发 token 不进 `contentPackageVersionSchema`；不建第二套聚合；transactionClient 路径必须仍取 workspace 咨询锁；示例数据零写入 store_facts。
- 协调热区：`application-service.ts` 也被 #42（WT-3 后期）改——错峰小批量，合并冲突以唯一属主矩阵裁。
