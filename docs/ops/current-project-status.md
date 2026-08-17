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
| 绿锚点后的回滚与处置 | `1c45089f6` 为修遥测红删掉 steering `resolveAuthority` 的线程作用域＋绕过 `steeringBindingMatchesAdmitted`，已回滚至绿锚点版本，接线契约 `steering-authority-isolation.static.test.ts` 落地防复发，真问题存 **V31-90**。**2026-08-15 更正**：本行初稿写「致跨 Work 串绑、required 由绿转红」，该因果指控**已撤回**——同一 409 与同一 L0.5 日志在线程作用域完好的干净树上照样复现（见 V31-91）。回滚仍成立，但依据只剩设计面：放宽跨线程绑定没有等价关系合同、该改动从未达成自身目标、守卫被架空后生产不走而单测照绿 |
| **required 的抖动（2026-08-15 晚实测）** | `required` **不是零抖动**：已立票的间歇红有 **V31-91**（`campaign-paid-work-confirmation:190` 显式 start 收 409，在 production-main-journey）与 **V31-92**（`run-service.test.ts:673` 墙钟排序反转，在 root-quality）；与 **V31-93**（`memory-vault-governance` 的 `selectComposerLens` 20s 超时——**产品缺陷**：session restore/replay 期间 remount 静默甩掉点击，被两轮测试放松掩盖成间歇红）。**含义**：required 红先比对失败模式再判归属，命中已立票抖动可同 SHA 重跑（须记进票当样本，不得静默重跑）；反之单轮 required 绿也不等于零风险。**修复前实测分布**（产品代码零差异八轮）：`required` **4 绿 4 红**，`production-main-journey` 4 绿 4 红、`root-quality` 6 绿 1 红；**四次红收敛到三个根因，V31-93 一个占三次**（分别经 20s 重试超时／裸调硬红／45s 重试超时三种表现）。**读法陷阱**：run 级 conclusion 因遥测＋release-manifest 恒为 failure，只看 `required` 这一个 job。详表见交接文档 §5a |
| **V31-93 部分修复（2026-08-15 晚，`0c80ee0e2`）** | **⚠️ 后续更正：修复不完整，不得关票。** 带修复的树上 `m04-browser-hard-gate:533` 仍以同一形态复现（run 31904089871，该 spec 修复后 2 绿 1 红）。判定为**点击在到达 handler 之前丢失**——契约测试②已证明受控状态扛得住重挂，故若点击登记成功面板必然出现；它没出现即说明点击没登记。**这一支没有状态可保存，提升状态救不了，只有停掉重挂能解＝V31-96，该票据此由「可选」升为「必需」。** 已解的那一支如下：五个胶囊面板开合状态提到 `ComposerHome`（两条卸载边界之上，与本来就扛得住的 `attachOpen` 同址）＋面板开着时不被密度折叠。证据＝先红后绿＋**变异验证**（撤掉受控接线两条立刻重新变红）＋composer 全套 267/267；浏览器层 run 31899526724 @ `6505e70a1` 三个 shard 全部执行（8/3/7 全过），**三种表现同一轮全绿**，同 SHA `required` **绿**。**仍在的抖动**：V31-91（409 竞态）、V31-92（fallback 未清理）、**V31-95**（w12 响应体被导航回收），三条各仅 1 次红样本。**V31-96** 记录重挂根因本身（可选清理，V31-93 后已无可见损害）。另记：journey 三个 shard 是**串行链**，前一个红则后续 shard `not_evaluated`，一条抖动会吃掉下游全部评价 |
| 发布线供给缺口（2026-08-15 实测） | `release-manifest` job **必红**且与代码无关：`leelv009/meiyeagent` 的 Actions variables `total_count=0`，六个必填 `RELEASE_*` 仓库变量一个都没配，生成器按设计 fail closed。已登记为供给清单 **R-1～R-6**（`docs/ops/provisioning-manifest.md` §C-R）。**不阻塞合并**（该 job 只在 workflow_dispatch／`release-candidate` 标签 PR 上跑，且不在 required 依赖里），但**挡 RC／发布**——所以「release-ready」在补齐这六项之前无从谈起 |
| 分支保护 | leelv009 仓已启用；main 只能经 PR，required check＝**`required`**（strict＋enforce_admins）。**2026-08-15 修正**：此前配的 `Core quality / required` 在 head 上从不被报告（CI 按 job 名报，实际就叫 `required`），保护规则一直在等一个永不出现的状态，任何 PR 都合不进去——这正是历史上只能「临时关 enforce_admins ＋强推」的根因。已按仓库自身权威（`scripts/ops/apply-branch-protection.sh` dry-run ＋ `docs/ops/branch-protection-ruleset.json`）改为 `required`。同时评审计数**定为 0（用户拍板，非临时）**：本仓只有一名维护者，「1 个批准」没有第二个人能满足，只会把每个 PR 变成永久阻塞——这正是历史上改走「关保护＋强推」的由来；真正的合并门是 required 状态检查。committed ruleset 与其契约测试已同步为 0，等真有第二名维护者再抬回。合并前配置备份见 scratchpad `branch-protection-backup-20260815T143724Z.json` |
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

## 3a. ~~开票与派工冻结~~ —— **已由用户解除（2026-08-16）**

> **解冻拍板（2026-08-16，用户）**：R3 的「开票与开工冻结」**即刻解除**，不再等
> 「同 SHA required 绿 ＋ V31-76 清」这两个门槛。解除时的事实：
> `required` 已在 `5caeb9b39` / main `ac367dc06` 上跑绿（八门全绿，唯一红的
> `p2-browser-acceptance` 属 advisory 且已由 V31-104 定性）；**V31-76 仍 open，
> 用户明示不作为解冻前置**。
>
> **解除的只有 R3 的冻结条款。** 同批 retro 的其余改约**继续有效**：
> R1（Day-0 零素材首访＝release gate）、R2（每批次先开旅程票、验收=真浏览器走查）、
> R4（单波 ≤12 票、每波必含旅程票），以及「仪器票优先于功能票」的排序原则。
> ADR-0019 的纵切交付与接缝属主纪律不受影响。
>
> 触发本次解冻的输入＝2026-08-16 全项目五轴复盘（功能缺口／前后接线／退役清理／
> 测试合理性／冗余兜底），产出 10 条架构候选，其中 4 条（语义事件发射器、
> 成批能力产品面、composer-home 拆 seam、按停用编号命名的模块重命名）此前受本条冻结阻塞。

## 3b. 五轴架构复盘 C1–C10 —— 全部落地（2026-08-17）

用户拍板「全部都要优化」，10 条候选全做，成 11 个提交在 `review-candidates-c1-c10`：

| 候选 | 提交 | 落点 |
| --- | --- | --- |
| C6 | `d6cef3322` | 三道不具判别力的门恢复判别力（catch-continue 吞掉死条目 etc.） |
| C1 | `e6719a38b` + `dd04dd7c1` | 「谁可以写旧计费账本」有了属主 `LegacyBillingLedger`；D-170 冻结遗留的 636 行重试链删净 |
| C3 | `4a8f4873b` | 商家话术单一来源 `@meiye/contracts/billing-ux-copy`；lens 标签五份副本收一 |
| C10 | `0597753a7` | 退役残渣清扫（含 `advanced-canvas` 四处、167×2 条 i18n 键） |
| C4 | `d4f0b4f99` | 注入翻译不了的记忆偏好进入回执一等公民（`unmapped`） |
| C2 | `874c910c8` | 未发射的事件/工件类型从「缺席」变成「有理由的名单」 |
| C7 | `5acf5b79a` | ADR-0019 §1 的消费者规则第一次有机器检查 |
| C5 | `03f2b3e98` | v3.1 旅程 spec 必须跨 UI 接缝 |
| C9 | `d4eb2c17b` | 按停用票号命名的模块变成只能缩短的 backlog（**31 条一方，非报告说的 81**） |
| C8 | `62c1ba444` | ComposerHome interface 11→7；两个零传入的注入口直接删 |

**报告被证伪的四条**（不改代码，留证据）：`plan.addons` 生产侧已只读且仍被读取；三桶配额面板已有免责且渲染真实种子额度；「我已发布」确有点击；C9 的 81 里 381/413 是 `references/repos/` 的第三方代码。

**被放大的三条**：计费裸写点有第二处（`:1944`）；lens 标签是五份不是两份；自报旅程 spec 两个接缝都到不了 ask（三处 skip）。

**发布**：PR #26，`required` 八门在 `c2c94c6c3` 全绿，ff 推入 main（tip 即验绿 SHA，不是未验过的合并提交）。

**过程中撞到并已还的债**：首轮 `root-quality` 红在 opt-in test evidence——这批动了七个目录，底下 21 个 `*.postgres.test.ts` 无库时静默 skip，之前每条提交报的「0 fail」都是真的但没覆盖它们。全新空库对真跑 77/77/0 fail/0 skipped，再逐文件重跑证明没有文件贡献 0（贡献 0 既不报失败也不报跳过，正是这道门要抓的同一种沉默）。

**观察债（未结）**：`v31-83-composer-session-cross-account` 在 PR 轮 1 红、同码轮 2 绿，轮 2 换成 `v31-video-paid-execution`；`production-main-journey` 的 M-04 硬门轮 1 绿轮 2 红、两轮代码差异只有一个 docs JSON，重跑即绿。三轮对照的固定核心是 mid-run-steering×2＋artifact-growth×1，外围在轮换。**「轮 2 绿」不构成机制不存在的证明**——`clearProductSessionClientStateOnAuthBoundary()` 靠六个 UI 组件各自记得调一次，是本轮反复点名的枚举病形态；按「拿到失败瞬间的状态才准改」的判据，本轮没抓到，不许凭空改。

**`production-main-journey` 本门的可靠性（新证据，2026-08-17）**：五次尝试红两次，且两次红在**不同 spec**——PR #26 轮 2 是 `m04-browser-hard-gate`（stale URL taskId → delivery card 120s 不出现），PR #27 是 `campaign-paid-work-confirmation`（explicit start 期待 202 得 409）。**PR #27 相对 main 的 diff 只有一个 markdown 文件**，所以这不是任何代码改动引起的。这是 required 八门之一，意味着每个 PR 都要赌这一把；按仪器票优先于功能票的排序原则，它该有自己的票。

**V31-91 的证据到了（任务 #9 原本 blocked on evidence）**：PR #27 那次红就是 `/start` 409 `COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH`（「方案已经更新过，请回到方案页重新确认后再开始。」），correlationId `corr-71bc7388-1d98-45d3-8f75-114e39dcff0b`，job 95218290272，`campaign-paid-work-confirmation.spec.ts:190`（`admitPromotionPosterMake`）。同一 job 日志里在其前约两分钟有 `EvalLayerResult l0.5:make:composer-task:result-adjust:...:plan-r2 is immutable and already bound to different facts`——**r2 的出现是线索不是结论**：需要先确认这两条是否同一 workflow，再谈「confirm 与 explicit start 之间方案被推进到 r2」这个假设。未验证前不许据此改代码。

**读法陷阱（记账）**：`gh run view --log-failed` 返回的是整个失败**步骤**的日志，真失败与跑过的 spec 混在一起——按它抓 spec 名会得到 22 个文件，按 `F::error file=` 标记才是 4 条。

**明确挂起并写明理由**（不猜）：C4 的回执另一半（put-once 行＋取回先于编译的次序）；C9 的实际重命名（绑死环境变量名／DB 白名单字面量／路径键 opt-in 证据／V31-67 未关）；C7 那 56 个动作的「运维 vs 产品缺口」分类；C3 的 fail-closed/fail-open 阈值分歧；商家中文 vs admin i18n 的 lens 归属。

### 历史条款（保留作案底，不再执行）

原文：开票与派工冻结（2026-08-13 批次 retro R3，**D3=A 修订**）

同 SHA `Core quality / required` 绿（2026-08-14 收缩后组成）＋ V31-76 清之前，**冻结新功能**（冻结以提交数度量，gate-shrink D5）。原「全门可评价」由 `v31-browser-report` 的 per-file verdicts 承担，不再是解冻门槛。解冻前只许诚实性 / 死路 P0 / 仪器（D3 白名单）：

1. 候选分支 PR ＋ 同 SHA `Core quality / required` 绿；
2. V31-77 已落；V31-76 remix/continue；**D6**：`v31-82` 先移出门 / `not_evaluated`，仪器后再请回；
3. V31-29 AC6 两 required job 实跑；
4. V31-41 residual；V31-45/59 钱债；credits 空表兜底；
5. V31-71 等 CI 再现；
6. D3 白名单产品诚实性：EXEC-01/02（D1 纯 copy 零确认卡）、06 泄漏、08 错误词典、03a 中文 steering、04 Thread、05 自报水合、07a 首屏插销、09 关旗不订 semantic、00d 付费门禁 seed（D7）。

仍冻：EXEC-03b、07b（D4=B 解冻后第一波，准入＝开 adapter）、L0/L3、Goal CRUD、字幕、生产 canary、内联挂源当 C1 定义。

D2=A 后 Day-0 门不必等「第一条图文成品」。仪器票永远优先于功能票。R1–R4 全文见 `docs/reviews/v31-batch-retrospective-2026-08-13.md` §4。

## 3c. 仓库归属终态（2026-08-17，用户拍板）

- **主仓＝`meiyeagent`（已由三号名下转移回一号名下）**；旧路径靠 GitHub 重定向解析，本地 `meiyeagent` remote 的 path 已改指新址（消除「有人在旧路径重建同名仓则推送静默走错仓」的风险），推送凭据暂不变（转移前属主保有 collaborator push，当日全链实证：push → 14 job 真执行 → required success）。
- **旧仓 `legacy-web-repo` 已归档只读，勿删**：397 issue（票据史）、29 PR、CI 运行史都在那里，文档里的票号与证据链接全指向它。
- **两仓不做历史缝合**：两条 git 历史 08-09 起刻意不同源；旧线代码内容已由快照带入新线（旧 tip 止于 08-08，diff 全是此后新工作，无遗失）。禁 `--allow-unrelated-histories`／禁重写——证据体系（opt-in evidence 的 verifiedAt、merge-ledger、Evidence 字段）全部钉在裸 SHA 上，重写＝台账作废。
- **08-17 下午更新**：三号账号已由用户删除（传播中）；本机全线切回一号（gh 活跃账号、remote 凭据、git 提交身份，推送已 dry-run 验通），废弃凭据已清理。**注意：一号当前系支持方授予的「临时访问」，转正审查在途**——已回邮确认迁移完成并同意服务条款、请求全量恢复；**在转正确认前，重要发布不要赌在这个访问窗口上**。
- 待用户另行拍板（本轮未裁）：「新文档不写旧账号名」的口径是否随一号恢复而调整。

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
