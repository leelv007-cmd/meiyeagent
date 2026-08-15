# 当前项目状态（CURRENT）

> **唯一当前入口，复核日期：2026-08-15（required 首次全绿 + 回归回滚回写）。** 带日期的 review、handoff、closeout 和 forensic 报告均为其所署 SHA 的历史证据快照；不得用旧文档中的 worktree、分支、数据库或直推配方恢复当前执行。

## 1. 集成与远端状态

| 项 | 当前事实 |
|---|---|
| 已复核代码基线 / Integration SHA | **`123eec360`＝远端 main**（PR #4 merge commit，2026-08-15T14:41Z），其父 `a69ea7740` 是 required 绿的 SHA |
| 本地分支 | `main` 跟踪 `meiyeagent/main`；候选分支 `ci/v31-per-file-remaining-gate` 已合入、可弃 |
| 远端 main | `meiyeagent/main`＝`123eec360`（leelv009 仓）——**122 个提交经 merge commit 合入，历史保留**；`093b1421` 是合并前的旧 tip |
| 候选分支 | 无在途候选；历史 `codex/v31-final-integration-39ca4b39` 与 `repair/v31-current-review` 均非执行入口 |
| Pull Request | **#4 已合并**（leelv009 仓）；一号线（legacy-web-repo）#436 因该线 Actions 受限**废弃** |
| **required 绿锚点** | **`bb124004d`**（CI run 31877687189）——`Core quality / required` 八依赖全 success、日志 `All required jobs succeeded.`；production-main-journey 18/18。**这是本集成线首个通过 required 的 SHA** |
| 绿锚点后的回归与处置 | `1c45089f6` 为修遥测红删掉 steering `resolveAuthority` 的线程作用域＋绕过 `steeringBindingMatchesAdmitted`，致跨 Work 串绑（`campaign-paid-work-confirmation` 红、L0.5 `already bound to different facts`）、required 由绿转红。已回滚该 Core 改动至绿锚点版本，接线契约 `steering-authority-isolation.static.test.ts` 落地防复发，真问题存 **V31-90** |
| 分支保护 | leelv009 仓已启用；main 只能经 PR，required check＝**`required`**（strict＋enforce_admins）。**2026-08-15 修正**：此前配的 `Core quality / required` 在 head 上从不被报告（CI 按 job 名报，实际就叫 `required`），保护规则一直在等一个永不出现的状态，任何 PR 都合不进去——这正是历史上只能「临时关 enforce_admins ＋强推」的根因。已按仓库自身权威（`scripts/ops/apply-branch-protection.sh` dry-run ＋ `docs/ops/branch-protection-ruleset.json`）改为 `required`。同时评审计数临时置 0（单账号仓作者无法自批），备份见 scratchpad `branch-protection-backup-20260815T143724Z.json` |
| Worktree | 仅保留主 worktree |
| 保留分支 | `repair/v31-current-review@e637e563` 是远端历史 checkpoint，不是当前入口 |

**verification ≠ release**，但本行首次有了真判决：

- Implementation state：08-13 深夜 73–89、门收缩、08-15 的 T1/T2 收口修复均在本树；
- Verification state：**`bb124004d` 上 required 已绿（同 SHA 真判决，非祖先拼接）**。
  绿锚点之后的每个新 SHA 都要自己重新拿判决——`1c45089f6` 就是反例；
- Release state：**PR #4 已合并，main＝`123eec360`**。C1/C4 标 available 需按能力账本单独取证，
  required 绿只证明「门通过」，不等于「能力可用」。

决策 D1–D7 权威：`docs/reviews/v31-agent-team-product-deep-review-2026-08-13.md`「已拍板决策」。

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

> 2026-08-14 门收缩：`required` 组成收缩为非浏览器 job＋`production-main-journey`＋`v31-day0-gate`；下列条目中凡以「全门 / 21-test / 42-spec 可评价」为门槛的，一律降为 `v31-browser-report`/`p2-browser-acceptance` 遥测评价，不再阻塞合并（gate-shrink D1/D3）。

1. 为候选分支创建 PR，并让 `Core quality / required` 在最终 PR head 上通过。
2. 在最终 Integration SHA 上 fresh 串行跑四个 fixture consumer specs 的完整 21 tests；旧轮只有 8 pass、2 独立产品红、1 instrument-interrupted、10 not evaluated，不能拼接成绿证。三个已知独立问题已分别修复：lens ARIA、initial confirmation double charge、Vite watcher OOM。
3. 在 `39ca4b39` 或其文档-only 后继上重跑 XHS production-candidate Chromium，证明 gap-close 与 replay-head 两个 fault 均形成严格 terminal receipt 与 recovery。
4. V31-71 保持 open：CPU 12x、retries=0 的本地 Chromium 5/5 未复现告警，因此没有产品猜修；等待 CI 再现时绑定临时 createTask/CDP 诊断。
5. required CI 未通过前，不把任何 pushed branch、旧 SHA Chromium 绿证或本地 PostgreSQL/DBOS 绿证写成 release-ready。
6. **Day-0 旅程门绿是 release-ready 的前置条件**（2026-08-13 批次 retro R1，用户拍板）：`v31-zero-source-image-text-first-visit.spec.ts` 升格为 v31 浏览器门 fail-fast 首位＋day-0 类 spec 种子掩码静态契约，落地票 V31-77；产品侧已知红 V31-76（remix 重定向）须一并清。

## 3a. 开票与派工冻结（2026-08-13 批次 retro R3，**D3=A 修订**）

同 SHA `Core quality / required` 绿（2026-08-14 收缩后组成）＋ V31-76 清之前，**冻结新功能**（冻结以提交数度量，gate-shrink D5）。原「全门可评价」由 `v31-browser-report` 的 per-file verdicts 承担，不再是解冻门槛。解冻前只许诚实性 / 死路 P0 / 仪器（D3 白名单）：

1. 候选分支 PR ＋ 同 SHA `Core quality / required` 绿；
2. V31-77 已落；V31-76 remix/continue；**D6**：`v31-82` 先移出门 / `not_evaluated`，仪器后再请回；
3. V31-29 AC6 两 required job 实跑；
4. V31-41 residual；V31-45/59 钱债；credits 空表兜底；
5. V31-71 等 CI 再现；
6. D3 白名单产品诚实性：EXEC-01/02（D1 纯 copy 零确认卡）、06 泄漏、08 错误词典、03a 中文 steering、04 Thread、05 自报水合、07a 首屏插销、09 关旗不订 semantic、00d 付费门禁 seed（D7）。

仍冻：EXEC-03b、07b（D4=B 解冻后第一波，准入＝开 adapter）、L0/L3、Goal CRUD、字幕、生产 canary、内联挂源当 C1 定义。

D2=A 后 Day-0 门不必等「第一条图文成品」。仪器票永远优先于功能票。R1–R4 全文见 `docs/reviews/v31-batch-retrospective-2026-08-13.md` §4。

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
