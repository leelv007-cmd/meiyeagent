# 架构评审整改波收尾台账（2026-08-12）

分支 `refactor/arch-review-wave-2026-08-12`（基于 main=8c543599），17 commits，67 文件，+2341/−2676。
**已于同日经主控亲验 ff 合入本地 main（连同下方追加的 26b 三 commit，main=eaba743b）；未 push——远端发布走 meiyeagent 净化单提交线，另行执行。**评审报告（10 候选+8 小切口）另见当日临时 HTML 报告。

**追加（同日晚，用户拍板）**：五段旧 runner 直接清理（V31-26b X1 + 追加项），另 2 个
refactor commit + 本台账/票面文档 commit，见「有意未做」第 4 条的执行记录与
`docs/tickets/v3.1/V31-26-legacy-retirement.md`「26b 五段 runner 执行记录」。

## 已落地（按 commit 序）

| Commit | 内容 | 判据来源 |
|---|---|---|
| 18498989 | supply-registry 死迁移控制器 dual-read controller 删除（保留 expand 保真校验） | 候选-小切口 |
| f23c5647 | execution-selection 两个纯 re-export barrel 删除，internal 升正 | 候选-小切口 |
| ba20d5b6 | 死的 validateBriefAgainstSnapshot（零调用+结构性不可失败）删除；ADR-0020 补 materialization 澄清注 | 小切口「fail-closed 假象」 |
| b4896d72 | maxRetries:0 收进 languageModelCallSettings（7 处手抄→1） | C8 部分 |
| bb1400bf | secret-hardening 收进 contracts（shell 6 项短名单漂移修复，CORE_SERVICE_TOKEN 门恢复全强度） | C3 组1 |
| ce0b7406 | delivery ZIP 命名+caption 收进 contracts（\p{Cc} 严格版为准） | C3 组1 |
| c72e805b | 死的周批次执行机械退役（settleWeeklyBatchExecution 零调用且是唯一绕过 TRANSITIONS 的 done 写者；batchExecutor 注入后从不读） | C7 |
| 2ee390d4 | actionable-inbox 唯一 source 分类器（recoverable jobs / legacy published / contentId 深链上线；两 HTTP 面同模块） | C6 |
| e6f0dafa | 确认权威 store conformance 套件（memory+Postgres 各 8/8）；死 getById 孪生删除 | C9 |
| 8720d789 | **MemoryOperationsRepository 诚实化 → 暴露真缺陷**：migration re-backfill 同 revision 改写（真 PG 必 409），已按聚合协议修复 | C9 |
| 7ccbff46 | 三 carrier bounded-suspension 循环收束为一（行为零漂移，DBOS durable 冒烟 19/19 真库）；交付 effect 骨架共享；media fence-recompile 首测；note 无 bounded exec 显式化（产品决策待定） | C1（Top rec） |
| a8e75039 | 付费确认门 4 处 12 参手工装配 → ports+runtime 单封装 | M |
| 36dd56b2 | workbench-state-model 解散（7 死导出删除；3 真行为迁 results 域；import-line pin 测试删除） | C10 核心 |
| aecdead6 | 工作台四态首次命名为类型（4 个私有 Set 收敛；inspector 折叠留档待产品决策） | 四态小切口 |
| cacf0e48 | phase 单一决策 composerPhaseFrom（Core progress 帧 suspended 为第一权威；三条竞态注释成因根除） | C4 |
| 1a6c0bbd | ContentPackage 导出门收进 contracts（3 份复写→1） | C4 后半 |
| b774f88c | WorkbenchSessionProjection 三份→contracts；admin-config BFF 门改由 requiredP1Capability 表推导 | C3 组余+小切口 |

## 验证证据

- contracts 221/0；mkfast 全量 unit 2067/0（13 skip）；core 触及面累计（workflow-core 78、runner-convergence 49、operations 109+、agent-session 33、model-supply 42、pending-actions 14 等）全绿。
- DBOS durable step 顺序冒烟 19/19（scratch 真库 54329）；确认权威 conformance Postgres 侧 8/8（scratch 真库）。
- 三包 typecheck 全绿。

## 有意未做（票级递延，理由在案）

1. **C8 attempt authority 模块**：executeSubmission 1,079 行方法重构，billing 邻接，先补 characterization tests 再动。
2. **C5 时间线双投影收编**：最大前端改造（两 ~950 行 reducer＋4,726 行宿主），需 journey 级验证；地基（phase 统一/四态命名/投影共享）已铺。
3. **C2 priorOutputs 唯一通道＋fence 显式 unit**：改 durable 重放身份与冻结 plan 兼容性＝迁移窗口级变更；前置（三机器收束）已完成。
4. ~~**五段旧 runner 删除**：retirement-proof-matrix.static.test 钉死 V31-26b 验收后方可，属用户拍板项~~ → **已执行（2026-08-12 用户拍板「直接清理」）**：frozen-legacy-five-stage.ts 整删＋force_legacy_five_stage 全链摘除＋静态测试反转钉 0＋追加项（pre-factScope 指纹回退连 skip 测试删除）；验收=runner-convergence 基线套件＋DBOS durable 冒烟 17/17（真库）＋postgres-store 11/11（真库）＋core tsc 全绿；回退面=application version pin。26b 余项（R1/R2/R6/R7、U14 归档执行、journey 收官）仍开。
5. 其余机械波：contracts 480 死导出 prune、delivery-b3/admin-supply 镜像、composerSubmissionBodySchema schema 链迁移、~37 个 readFileSync 测试替换、2s 轮询降级（需 journey 验证每类等待都有 suspended 帧）、ops-console/AgentSessionHarnessService 转发收敛、OperationsRepository 按聚合 seam。
