# V3.1 Wave-4 收口交接（2026-08-10 深夜，主控换手）

> 交接原因：用户令「暂停修复、换手收尾」。本文档是新主控的唯一起点，读完即可接管。
> 上游权威：`docs/handoff/v3.1-full-remediation-handoff-2026-08-09.md`（Wave 全局）＋
> `docs/superpowers/plans/2026-08-09-v31-full-remediation.md`（计划）＋
> `docs/reviews/v3.1-current-head-actual-completion-deep-review-2026-08-09.md`（深评基线）。
> 本文只写 Wave-4 期间的增量与当前敞口，不重复上游内容。

## 0. 一句话现状

集成树 `codex/v31-integration` tip＝**本文档所在 commit**（前一 commit=V31-55 状态更新；未 push）。
付费链六个系统性根因已修复合入并浏览器实证生效（四类系统签名终审轮全零）；
**唯一未修完的系统项＝变体③第二臂**（rights 指纹第二处 freeze/verify 不对称，压着 b2/ops-console 两旅程）；
其余 7 spec 残红为局部缺陷、各有归票预案。W4-E 深评复跑与 push 未做。

## 1. 树与合并链（全部未 push）

- Worktree：`/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-integration`，分支 `codex/v31-integration`。
- Wave-4 起点 `98949870a`。关键 merge（时序）：
  `10cfa069d`(web 契约同步) → `17d39a130`(biome) → `5ed00f453`(delivery/publish-handoff 双修) →
  `41c1a4266`(route-table 48+canonical-write pins) → `bb6fe34be`/`d552006cc`(W4-B 前期) →
  `2da11d5ab`(**4A**) → `35c6de074`(**4C**) → `0abdc36f`(V31-18 证据回填) → `00536a8b5`(V31-18 三框勾) →
  `bbba8d9ec`(**4D 双臂**) → `a1cc7c354`(V31-55 验收落笔) → `abd4b3b33`(**变体③ platform 臂**) →
  `d3e29ee0f`(**hop② 路由 404**) → V31-55 状态更新 → 本文档。
- 执行 lane 分支：`codex/v31-w4-confirmation`（worktree `美业内容2-v31-w4b`，tip `fc57986c6`，代码面=集成树）；
  `codex/v31-w4-tickets`（worktree `美业内容2-v31-w4c`，已关，20 commits 全合入）。

## 2. 已修复并实证的六个系统性根因（勿重查）

| # | 根因 | 修复 SHA | 浏览器实证 |
|---|---|---|---|
| 4A | dbos-workflow 预跑 verify 无条件执行，杀死 pending_confirmation 分支 | (Wave-4 前期) merge `2da11d5ab` | variant0 签名清零 |
| 4B | turn 无 plan 无 question 时 run 不置 failed | `1d5d43a03` | — |
| 4C | interrupt projection 重算 runId 而非读 sourceTaskId | merge `35c6de074` | `unavailable for interrupt projection` 清零 |
| 4D臂1 | putImmutable 对自己刚写的行判假冲突（`assumptions: undefined` 键被 JSONB 往返丢弃） | `7789f5dae` | `IDEMPOTENCY_CONFLICT` 清零 |
| 4D臂2 | identity ref 解析不到不推占位头→fence 恒误击发 | `fafbf06a5` | `context head drifted` 清零 |
| hop② | 路由 `workflowRuntimeId` 不认裸 merchant taskId（**两份重复实现都已改**：:693 class method＋:3856 module-level；加 `request->>'sourceTaskId'=$3` 臂＋排序翻最新） | `fc57986c6` | `HARNESS_TASK_NOT_FOUND` 404 清零 |

缺陷家族口径：「重算坐标 vs 读传入坐标」共七例；「absence≠drift」是其中子族。
新增普适方法论（已入 V31-18/V31-55 票面）：①单点变异不翻红先分「断言失鉴别力」vs「另一层防线先拦」；
②判别实验必须复刻**客户端真实输入**（hop② 教训：curl 喂服务端存的坐标得出过错误的「后端无辜」）。

## 3. 唯一在修中断项：变体③第二臂（重启修复从这里开始）

- 症状：终审轮 v2（含 `8d5bddcb0` asRightsPlatform 修复的树）b2×2/ops-console×4 仍报
  `DBOS verification failed: snapshot is stale (rightsRevisionRefs)`（execution-plan-admission.ts:439 通用 SNAPSHOT_STALE 分支）。
- 已证的第一臂：platform 指纹不对称（编译期裸传 `wechat_moments`、校验期白名单丢 undefined），已修合入 `abd4b3b33`。
- 第二臂候选：`productRightsRevision`（product-package-rights-adapter.ts:164-170）的其余指纹输入
  ——known/unauthorized asset ids、requested asset ids——某个在 freeze 与 verify 两侧算法不一致。
- 取证方法（二选一）：a) 对照库里 `p1_execution_plan_snapshots.rightsRevisionRefs`（freeze 存值）与
  execution-plan-live-facts.ts rights 分支 verify 侧重算输入逐字段 diff；
  b) 两侧加 `[V355-DEBUG]` 探针重跑 b2 单 spec（约 3 分钟，探针用完必剔）。
- ⚠️ 一次性证据库可能已按交割令销毁（W4-B 交割时清理）；重跑一次 b2 即可再造证据。

## 4. 终审轮 v2 残红归票表（逐条待落，尚未执行）

| Spec / 断言 | 现死点 | 归属 |
|---|---|---|
| context-fence :215 `agent-plan-diff` 不可见 | 改价 diff 渲染 | **V31-28**（该票本就 merged-with-evidence-debt 挂浏览器债，追加本证据） |
| interrupt-resume :78 中断面元素 ＋ 1 条 | workbench 渲染 | **V31-28** 同上 |
| interrupt-resume `E2E interrupt expiry fixture could not advance the clock`（INVALID_STATE） | e2e 基建 | **开新小票**（fixture 时钟推进失效） |
| partial-resume :143 `agent-pending-interrupt`(noteStyle) | 中断面 | **V31-28** 或随取证改判 |
| rights-revocation :190 `授权已撤销` 文案 180s 不出现 | terminal 文案链 | 查 **V31-29**（fixture 真伪）交集后归票 |
| living-plan :232/:327（免费调整段 `/revise` waitForResponse 超时，404 零命中，与付费链无关） | 独立根因 | **V31-56 待开**（W4-B 有症状材料，交割消息里会带；票面只记症状与证据） |
| b2 :612 / ops-console | 变体③第二臂压着 | **V31-55**（§3） |

已存在的独立缺陷票（Wave-4 前期已归，勿重开）：day0 store null、video 文案、steering progressHost(V31-27/28)、goal-proactive zod config（裁定 server 守卫正确、hard gate=listSuggestionsSchema 不得放宽）、K case_image fixture(V31-54)。

## 5. 纸面状态

- **V31-18**：AC1/AC2/AC5 已勾（主控三组变异亲验背书，坐标勾选授权=`00536a8b5`）；AC3 等变体③修复后 b2 复跑、AC4 等 production-main-journey 首跑。两条如实归属见票面「主控亲验记录」。
- **V31-55**：Status=partially-fixed，paused by user order；根因三章节＋各债 note 齐全；「变异反证」框主控退勾（浏览器腿未做）。
- **V31-39** 勾选先例：变异背书不留痕类勾选=主控复现后方可勾。这是所有勾框动作的标准。
- Wave-4 盖章、W4-E 深评复跑（对 `docs/reviews/v3.1-current-head-actual-completion-deep-review-2026-08-09.md` 逐项复核）：**未做**。

## 6. 环境与纪律（铁律，违反必炸）

- **push 仅限主控经 `meiyeagent` remote**；历史 remotes 禁读写；执行 agent 禁一切 GitHub 写操作。
- DB 实例 54329（PGPASSWORD=meiye，user meiye；54330 也住着 lane 库，清库署实例号）。e2e 库一律
  `scripts/ci/provision-test-db.sh` 空库建+migrate＋时间戳唯一后缀，**禁 TEMPLATE meiye**；用完即销。
- 浏览器轮走 `e2e-lock.sh`；lane 专属 PORT/PLAYWRIGHT_CORE_PORT（本波用过 3131/4131、4151/4251、4152/4252、4153/4253）；凭日志 `[Core]` 引导行确认没误用别人栈。
- `typecheck/test/test:interaction/e2e` 重写共享 paraglide 产物，同 worktree 不与 dev 并跑。
- **端口 3001 的 pid 35520 不许杀**。孤儿清理先例：27h 的 `runtime-entry.ts worker`（连 playwright-pid 后缀 DBOS 子库=实锤测试孤儿）可杀。
- 工具坑：Bash 每次调用重置 cwd（全用绝对路径/`git -C`）；tsx 对不存在路径静默 exit 0（跑测试后必须看到 pass/fail 行才算跑了）；zsh 裸 `$VAR` 不分词。
- 变异复现配方：替换脚本对目标串做唯一性断言、多处同串改按行号；每组「恰红一条=目标断言」才算背书。

## 7. 证据位置（会话级 scratchpad，可能被回收，要用趁早拷）

`/private/tmp/claude-501/-Users-bin/e60a9977-7692-47f9-aec3-5bc1d12fbd16/scratchpad/` 下：
`w4d/FINAL-REPORT.md`（round3 A–K 终表）、`w4d/round3-per-spec/`、`w4d/w4-final/`（终审 v1＋trace-context-fence）、
`w4d/w4-final-v2/round-per-spec/`（终审 v2 逐 spec 日志＋SUMMARY）、`trace-cf/`＋`trace-ir/`（主控拆包的 404 证据）。

## 8. 接手后的建议序列

1. 收 W4-B 交割消息（变体③已有发现＋living-plan 症状材料＋最终 HEAD 确认），关其 lane。
2. 残红归票（§4 表逐条落：V31-28 追加证据、expiry fixture 小票、V31-56 开票、rights-revocation 归属判定）。
3. （若用户解除暂停）变体③第二臂取证修复（§3），随后 b2/ops-console 复跑＋V31-55 浏览器变异反证＋V31-18 AC3 回填。
4. W4-E：对深评文档逐项复跑复核，出 Wave-4 终报告。
5. Wave-4 盖章，经 `meiyeagent` push（主控亲手）。
