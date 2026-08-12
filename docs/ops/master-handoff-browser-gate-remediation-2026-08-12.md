# 主控交接：浏览器三门整改波（2026-08-12 晚暂停点）

> 交接性质：主控（merge controller）主动暂停，全部工作已 commit。接手 agent 从「快照」和「待完成事项」两节即可无损续跑。
> 决策权威与派发纪律：仓根 `CLAUDE.md`、`docs/ops/agent-dispatch-runbook-2026-07-29.md`。远程推送**仅限主控**经 `meiyeagent` remote 用管理员配方；执行 lane 禁一切 GitHub 写操作。

## 一、快照（暂停时刻）

- **本地 main**：`29e08d39`；工作树干净。**领先 remote 4 个未推 commit**（remote `meiyeagent/main` = `093b1421`）：
  - `ce3a0f0e` test(e2e): works-reshell 改走 Living Plan strip 开始制作（主控亲验 5 passed/2.4m）
  - `4d5551a4` docs(tickets): V31-70 第五数据点（production 门治愈实证）
  - `2985654b` docs(tickets): V31-28/65/68 盖 CI 绿证章（run 31589105737）
  - `29e08d39` docs(tickets): 开 V31-72（production 门两条 CI-only 真红 2/2 复现）
- **守卫全绿**：ticket index 72/72；opt-in evidence guard OK（在 `29e08d39` 树上）；biome/tsc 净。
- **CI 已全部定性**（无未读判决）：run 31587057598（f171b41d）与 31589105737（093b1421）三门＋root-quality 逐条归因完毕，结论已写进票面（V31-62/63/70/72）。
- **探针库保留**：`v3128_copy` / `v3128_copy_dbos` @54329（V31-28 验收现场，audit 内有 answer→11s 交付链证据）；另有 `v3128_copy_dbos_playwright_4286_*` 等派生库可清。`optin_leg67`/`optin_v3128` 两对临时库已 drop。
- **监控**：两个 CI run 监控已自然结束；无遗留 Monitor。

## 二、真红账本（此刻，全部已定性）

| 门 | 真红 | 归属 | 状态 |
|---|---|---|---|
| v31 | fence spec `INVALID_STATE: Price-drift successor requires a transaction-aware current context-bundle builder` | V31-63 | 诚实红，产品洞在修（lane 2 冻结态，见下） |
| p2 | **零产品红**（copy 问答族 run 31589105737 全绿、admin-sensitive-words 绿） | V31-28/65/68 | CI 绿证已盖章 |
| production | w12 :104（360s 整案超时）＋ xhs :63（断流注入无回执 @:144） | **V31-72** | CI 2/2 复现、本地恒绿，待时序定性 |
| 横切 | workerd Broken pipe 猝死 | **V31-70** | production 门已治愈（连续两轮 18 specs 全判决）；v31/p2 无治愈（workerd=vite 插件孙进程，重启预算不可见） |
| 观察 | note-compiler :731（风暴窗口内，暂归级联）；campaign 投影竞态（两轮 flaky 自愈）；V31-62 AC4 单例（并入 V31-72 线索） | — | 下轮 CI 复核 |

## 三、lane 2 冻结状态（V31-63 successor 事务化重建，被主控暂停）

- **worktree**：`.claude/worktrees/agent-afac18310eef8fff4`，分支 `worktree-agent-afac18310eef8fff4`，基线 `dca572a3`。
- **已落 4 commit**：
  - `1b4f0363` feat(core): transaction-aware context-bundle rebuild for price-drift successors
  - `1fbd4786` fix(core): successor confirmation authority reads its quote on the admission transaction
  - `28644191` fix(core): keep receiver bindings on the successor prepare authorities
  - `c0edec02` fix(core): resolve the successor confirmation chain through workflow_id
- **未提交改动 3 文件**（中断时正在「加 successor 显式 start 的单测」）：`apps/core/src/p1/agent-session/composer-plan-session.{ts,test.ts}`、`mkfast-template-main/tests/e2e/specs/v31-context-fence-journey.spec.ts`。
- **续跑方式**：可对该 worktree 重派 lane（提示词点明：续未竟单测→跑 core 合同测试→跑 fence spec e2e 红转绿），或主控亲自收尾。**账务教义**：只有 successor 的 admission 事务可持久化替代 authority——重建必须在同一事务内（V31-63 票面「本地验证撞墙」节有完整定性）。
- **产品洞位置**：`postgres-repriced-paid-execution-successor-builder.ts:80` 对 `contextDrifted` fail-closed；`refreshLiveBindingsInTransaction` 缝只盖 plan/quote，缺「当前 context bundle 的事务化读取/重建」。

## 四、完整待完成事项（按执行顺序）

### A. 关键路径（挡三门真绿）

1. **收尾 lane 2（V31-63）**：续未竟单测→core 合同测试绿→主控亲验 fence spec e2e 红转绿（配方见 §五-3；fence spec 新编舞已在 main，`v31-context-fence-journey.spec.ts`，从 strip 的 decide 请求 URL 捕获旧权威 id）→cherry-pick 入 main。
2. **合入后 opt-in 证据增量刷新**：lane 2 动了 `p1/harness`、`p1/agent-session` 等目录，会把这些目录的 env-gated 套件证据弄陈旧。配方见 §五-2（本波已跑通两次：37 套件 155 pass、7 套件 74 pass）。
3. **合批发布**：现押 4 commit＋lane 2 收编＋证据刷新 commit，一次管理员配方推上（§五-1），随后布 CI run 监控逐 job 判决。
4. **V31-70 第 2 路仪器（v31/p2 的 workerd 检测）**：把「vite `Internal server error: fetch failed/terminated` 首帧」识别为 GATE INSTRUMENT FAILURE（与 production 门进程退出同权），落 `mkfast-template-main/scripts/e2e/` 仪器族（run-service/service-liveness-reporter 是现成参照，16 单测在 `run-service.test.ts`/`service-liveness-reporter.test.ts`）。这是 v31/p2 两门唯一系统性阻塞，建议单独派 lane。
5. **V31-72（production 门两条 CI-only 真红）**：按票面工作路径——拉两轮 trace/artifact 核 xhs 首个 `/agent-threads/*/events` 调用时序与 `x-meiye-e2e-agent-fault-applied` 回执头，判「Core 未应用」vs「页面没收到」；w12 拉 trace 定位 360s 卡点，CDP CPU 节流本地对照。按定性分流：spec 合同→改编舞；产品传输→并入 V31-28 follow-up 修。

### B. 次级（非必跑门／小活／观察）

6. **四个 fixture 消费方 spec 批量验证**：`ui-journey-three-modal`、`t39-r-gate-journey-matrix`、`video-result-live-commands`、`p1-f2-acceptance`——全走 `submitComposerJourney`，dca572a3 的 fixture 重排已自动覆盖，**无需改代码**，lane 2 合入后各跑一轮即可（works-reshell 是唯一带私有拷贝的，已改已验已 commit）。
7. **V31-71（admin setState 竞态）**：CDP `Emulation.setCPUThrottlingRate` 节流复现→定位组件→副作用移入 useEffect。小活，可与 V31-72 同 lane。控件本体 467 行已排查干净，嫌疑在同页共同渲染树（AdminRoutePage／布局／运维健康挂件／共享 provider）。
8. **note-compiler :731 下轮复核**：本轮在 11:01 风暴窗口内暂归级联；若风暴外复发，按问答族余票处理（它要的是 `ask-merchant-option-comparison` 方向卡，V31-63 in-execution interrupt 族）。
9. **campaign 投影竞态**：连续两轮 flaky 自愈，继续观察，不派活。
10. **V31-64 关票**：需要一轮「无级联」CI 判据。production 侧已有连续两轮数据；等 #4 的仪器补口后 v31/p2 也有判据即可关。

### C. 收尾与归档（不挡门）

11. **V31-28 关票归档**：七腿全修净＋CI 绿证已盖，余票面 follow-ups（SSE 404 上收 server 侧备选；dev 传输悬案——线索已并入 V31-72）；关票时按 evidence 政策补 Workflow Run/Artifact Digest。
12. **V31-65／V31-68 关票归档**：CI 绿证已盖章，走关票流程即可。
13. **V31-62 evidence-debt 归档**：AC4 观察已挂 V31-72 指针。
14. **V31-70 治本**：workerd-linux-64@1.20260424.1 / miniflare@4.20260212.0 / @cloudflare/vite-plugin@1.25.0 版本组合的已知问题排查与升级评估（治愈只是止血）。
15. **V31-69**：入口 bundle 减重两路径（paraglide 按 locale 拆分＋contracts schema 迁出入口）待实施；当前预算基线 380k（`08a0a253` 重基线）。
16. **旧递延三项**（重构清单票级递延，非本波）：C8 attempt authority／C5 single timeline projection／C2 priorOutputs as only channel。
17. **V31-26b 余项**：R1/R2/R6/R7 runner（仍有消费者）＋U14 归档 fail-closed（部署后按条件门）。
18. **V31-29 AC6**：两个 required job 需真实跑数（不能拿静态绿冒充），等三门恢复健康后补。

## 五、关键配方（本波实测有效）

1. **管理员发布**：`gh api -X DELETE repos/leelv009/meiyeagent/branches/main/protection/enforce_admins` → `git push meiyeagent main:main`（必须 ff）→ `gh api -X POST .../enforce_admins`。推后 `gh run list` 按 headSha 找 run，布逐 job 监控。
2. **opt-in 证据刷新**：`node scripts/uiux/opt-in-test-evidence-guard.mjs` 列 STALE → `bash scripts/ci/provision-test-db.sh "postgres://meiye:meiye@127.0.0.1:54329/<名>" "...<名>_dbos"` → 在 `apps/core` 下 `TEST_DATABASE_URL=... TEST_DBOS_SYSTEM_DATABASE_URL=... node --import tsx --test --test-concurrency=1 <套件列表>` → 回写 `docs/ops/opt-in-test-evidence.json`（verifiedAt=当前 HEAD 全 sha，note 记库对与战果）→ guard 复核 → drop 临时库。**注意**：任何触碰 apps/core 受监目录的合入都会重新弄陈旧对应套件——先合完再刷一次，别提前刷。
3. **e2e 亲验**：必须 `TEST_DATABASE_URL`/`TEST_DBOS_SYSTEM_DATABASE_URL`（**无 TEST_ 前缀会污染共享 meiye 库**）＋每次唯一 `PORT`/`PLAYWRIGHT_CORE_PORT`＋`CI=true PLAYWRIGHT_PROVIDER_FREE=true --retries=0`＋跨 lane 锁 `.scratch/orca-run-2026-07-25/e2e-lock.sh` 包裹（54329 max_connections=100，一个栈约 20 连接）。
4. **票面纪律**：改任何票的 Status 后跑 `node scripts/ci/assert-v31-ticket-index.mjs`；README 行与票面 Status **逐字一致含加粗标记**（本波实证：剥 `**` 会 fail closed；可用 `--generate` 打印全表对照）。
5. **CI triage**：job 日志走 `gh api repos/leelv009/meiyeagent/actions/jobs/<id>/logs`（grep 要 `-a`）；风暴判据=vite `fetch failed` 首帧时刻，之后的 auth.ts 形态红全是级联；风暴前的红才要单独定性。`sorry, too many clients`（53300）=本地 54329 撞库，先查 `pg_stat_activity` 再定性。

## 六、铁律速记（接手必读）

- 每 lane 独立 worktree；`typecheck/test/test:interaction/e2e` 重写共享 paraglide 产物，同 worktree 不与 dev 并跑。
- lane 不 push、不关票；合入由主控亲验（消费者证明／行为为证／反向复核；review 双向跑，复核取反驳立场）。
- 本仓**禁裸 `git stash`**（stash 栈里有他树遗留，pop 会炸 AA 冲突；本波实证）。
- commit message 别用裸反引号（shell 会吃掉；本波实证 `restarted: true` 被吞，amend 补救）。
- 文档禁写旧账号名；`references/repos/herouipro-v3/` 不得发布；本地 shallow 历史不外发。
