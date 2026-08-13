# 当前项目状态（CURRENT）

> **唯一当前入口，复核日期：2026-08-13。** 带日期的 review、handoff、closeout 和 forensic 报告均为其所署 SHA 的历史证据快照；不得用旧文档中的 worktree、分支、数据库或直推配方恢复当前执行。

## 1. 集成与远端状态

| 项 | 当前事实 |
|---|---|
| 已复核代码基线 | `39ca4b399361a9226848c71009d3d6500612ce2c` |
| 本地分支 | `main`，工作树在本次文档更新前 clean |
| 远端 main | `meiyeagent/main@093b1421acce3f07728568d981522988bd33ab48` |
| 候选分支 | `meiyeagent/codex/v31-final-integration-39ca4b39` 已推送且指向 `39ca4b39` |
| Pull Request | 尚未创建 |
| 分支保护 | 已启用；main 只能经 PR，required check 为 `Core quality / required` |
| Worktree | 仅保留主 worktree；本地辅助 worktree 已清理 |
| 保留分支 | `repair/v31-current-review@e637e563` 作为远端历史 checkpoint；它是 main 祖先，不是当前执行入口 |

`39ca4b39` 是本轮文档复核的 **Integration SHA**。它已推到候选分支，但尚未获得同 SHA required CI，因此当前结论是：

- Implementation state：主要浏览器门修复与仪器已进入候选代码；
- Verification state：多条生产形态本地路径已在各自所署 SHA 验证，不能汇总冒充 `39ca4b39` 的 required CI；
- Release state：**pending required CI / PR，not release-ready**。

## 2. 已进入候选代码的关键收口

| 领域 | 当前实现 | 证据边界 |
|---|---|---|
| V31-63 paid execution successor | 事务内重建 context、quote/identity/rights pin、继承 Thread/run、显式 successor admission 与账务锁序均已实现 | `2f2960e6` production-candidate Chromium 1/1、真实 PG/DBOS 两 workflow SUCCESS；当前 Integration SHA required CI 待补 |
| W12 identity journey | store facts 前置、同一 Composer session 选择 identity，并在 deterministic brief 保留 exact identity ref | `2f2960e6` production-candidate Chromium 1/1；当前 Integration SHA required CI 待补 |
| Campaign handoff | W1 delivery 投影完成后才切 W2；query error fail closed | `2f2960e6` production-candidate Chromium 1/1，W1/W2 DBOS 2/2 SUCCESS |
| XHS fault/recovery | 阻断 Service Worker 干扰；patch resync 保留 session；fault receipt/recovery terminal 判据进入 `39ca4b39` | focused contracts/review 已过；`39ca4b39` 的真实 Chromium与 required CI 均待补 |
| V31-64/V31-70 gate instrumentation | service exit、Vite/workerd signature、fallback evidence、resolved verdict 与 NOT evaluated 均已 fail closed | 本地仪器合同与真实故障探针已验证；required CI 无级联轮待补 |
| Cloudflare/Vite stability | runtime pin 到 coherent Cloudflare chain；Vite watcher 排除 `output/playwright`，避免 trace HTML reload 风暴 | 旧 runtime 与 watcher OOM 已定性；新组合的长门连续轮仍待 required CI |
| V31-69 entry bundle | contracts 入口拆到精确 subpath，gzip 预算恢复到 350,000 | 本地 build/typecheck/budget 已通过；required CI 待补 |
| T39 credit reservation | initial confirmation 复用 task canonical credit operation；真正 successor 才使用 successor reservation | unit 46/46、fresh PG 4/4；最终 21-spec fixture 门待补 |

## 3. 仍未完成的验收与开发

1. 为候选分支创建 PR，并让 `Core quality / required` 在最终 PR head 上通过。
2. 在最终 Integration SHA 上 fresh 串行跑四个 fixture consumer specs 的完整 21 tests；旧轮只有 8 pass、2 独立产品红、1 instrument-interrupted、10 not evaluated，不能拼接成绿证。三个已知独立问题已分别修复：lens ARIA、initial confirmation double charge、Vite watcher OOM。
3. 在 `39ca4b39` 或其文档-only 后继上重跑 XHS production-candidate Chromium，证明 gap-close 与 replay-head 两个 fault 均形成严格 terminal receipt 与 recovery。
4. V31-71 保持 open：CPU 12x、retries=0 的本地 Chromium 5/5 未复现告警，因此没有产品猜修；等待 CI 再现时绑定临时 createTask/CDP 诊断。
5. required CI 未通过前，不把任何 pushed branch、旧 SHA Chromium 绿证或本地 PostgreSQL/DBOS 绿证写成 release-ready。
6. **Day-0 旅程门绿是 release-ready 的前置条件**（2026-08-13 批次 retro R1，用户拍板）：`v31-zero-source-image-text-first-visit.spec.ts` 升格为 v31 浏览器门 fail-fast 首位＋day-0 类 spec 种子掩码静态契约，落地票 V31-77；产品侧已知红 V31-76（remix 重定向）须一并清。

## 3a. 开票与派工冻结（2026-08-13 批次 retro R3）

Day-0 旅程门绿之前，**冻结新功能票的开票与派工**。解冻前只做（顺序即优先级）：

1. 候选分支 PR ＋ 同 SHA `Core quality / required` 绿（核销全部 release-verification-pending 票）；
2. V31-77（旅程门改约）与 V31-76（day-0 两条红）；
3. V31-29 AC6（两个 required job 实跑）；
4. V31-41 residual ＋ dev 库积分 100→0 疑似预留泄漏取证；
5. V31-71 等 CI 再现。

仪器票永远优先于功能票。流程改约全文（R1–R4，含「每批次旅程票先行、单波 ≤12 票」）见 `docs/reviews/v31-batch-retrospective-2026-08-13.md` §4。

## 4. 文档权威顺序

1. 本文：当前集成、验证和 release 边界。
2. `docs/ops/capability-ledger-2026-08-13.md`：**唯一工作队列权威**（2026-08-13 用户拍板，能力驱动改约）——17 条商家能力四态账本、仪器/平台排队、parked 清单与收敛顺序；票列表不再是 backlog。
3. `docs/tickets/v3.1/README.md` 与个票：任务状态事实源；个票 Status 为索引机器真相。
4. `CONTEXT.md` 与 `docs/adr/`：领域语言和稳定架构决定。
5. 带日期 reviews/handoffs：固定历史快照，只通过 superseded 横幅指回本文。

## 5. 禁止的旧恢复方式

- 不恢复已经删除的 lane/worktree 或临时测试数据库。
- 不执行旧 handoff 中解除管理员保护后直推 main 的命令。
- 不把 instrument failure 之后的剩余 spec 记为产品失败；其状态为 `not_evaluated`。
- 不把不同 SHA 的本地和 CI 结果拼成同 SHA release evidence。
