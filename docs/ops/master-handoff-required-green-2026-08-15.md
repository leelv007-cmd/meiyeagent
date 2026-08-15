# Master Handoff：PR #4 `required` 全绿收口（2026-08-15）

> **执行结果（2026-08-15 晚回写）：T1、T2 均已完成，`required` 于 `bb124004d`
> （run 31877687189）首次全绿——八依赖全 success，production-main-journey 18/18，
> 遥测同轮 19 绿 3 红。§3 工单已消耗完毕，保留作为方法记录。
> 唯一新增待办见 §6：绿锚点之后发生过一次回归，已回滚并立契约。**

> 交接对象：接手的执行 agent。目标只有一个：让 PR #4 head 上的
> `Core quality / required` 变绿。本文按序给出工单、每个红的已固化证据、
> 本地复现配方，以及**明确禁止**去碰的东西。背景决策见
> `docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`，当前权威状态见 CURRENT。

---

## 0. 一句话目标与完成定义

**目标**：`https://github.com/leelv009/meiyeagent/pull/4`（分支
`ci/v31-per-file-remaining-gate`）最新 head 上，workflow `Core quality` 的
`required` 聚合 job = success。

**完成定义就是这一条 CI 判决，没有别的**。本地任何绿证都不是完成定义；
本地测试只用于「复现单项红 → 验证单项修复」。

## 1. 不可违背的纪律（先读，防撞墙）

过去两周的死循环根因是：在不可靠的本机仪器上反复跑大而全的测试、对着
83% 误报率的红做法证、修一个点就重跑整门。以下纪律就是为了不再重演：

1. **CI 是唯一裁决**。判断修没修好，只看 push 后 CI 上该 job 的结论。
   禁止在本地跑 42-spec 全门（`run-v31-browser-acceptance.sh` 无 scope
   全跑）当验证；禁止本地全仓 `pnpm test` 当验证轮（root-quality 交给 CI）。
2. **每个红先归类再动手**：产品红 / spec 债 / 仪器红。归类依据是证据
   （CI artifact 里的 trace/截图/日志/instrument-failures JSON），不是猜。
   仪器红的判据：`mainline/instrument-failures/*.json` 或 `service-exits/`
   里有对应服务死亡记录；没有这些记录的红一律先当产品/spec 红查。
3. **本地只做单项复现**：跑单个 spec 文件、单个测试文件。修完跑同一个
   单项 + 相关 typecheck，就算本地验证完成。
4. **攒批推送**：把一批机械修复合成一个 commit 一次 push。CI 一轮
   40–90 分钟，逐项推送 = 乒乓浪费。本文 T1 是一批，T2 单独一批。
5. **门结构已冻结**，禁止改动：`required` 的组成（8 个 job）、
   `V31_GATE_SCOPE` 机制、遥测 job 的非阻塞地位。门是自引用的，动它必须
   同步五处（`.github/workflows/core-quality.yml`、
   `scripts/ci/assert-required-jobs.mjs` 及其 test、
   `scripts/ci/quality-gates.test.mjs`、
   `scripts/ops/apply-branch-protection.test.mjs`、
   `scripts/ci/suite-owner-manifest.json`），改不全 root-quality 会反咬。
   本轮工单**不需要**动门。
6. **账号与推送纪律**：remote 只有 `meiyeagent`
   （`https://leelv009@github.com/leelv009/meiyeagent.git`），gh 活动账号
   leelv009，仓内 git 身份已配置为 leelv009——**不要改回**，不要推任何
   其他 remote，新文档禁写旧账号名（用 legacy-origin-a / legacy-web-repo
   指代）。legacy 线 Actions 已死（全史 0 run），其上的 PR #436 已废弃。
7. **环境铁律**（仓根 CLAUDE.md）：`typecheck/test/test:interaction/e2e`
   都以 locale:compile 开头、会重写共享 paraglide 产物，同 worktree 内不与
   dev 并跑；e2e 库一律 `scripts/ci/provision-test-db.sh` 空库新建，
   **禁止**动本机 54329/54330 端口上的 lane 库，禁止 TEMPLATE meiye。
8. **时间戳纪律**（本轮两次实证踩雷）：fixture/测试里禁止写绝对日期配
   相对窗口（V31-63 的 48h 窗定时炸弹）；遇到「昨天绿今天红且无代码差异」
   先查墙钟相关逻辑（跨午夜、+48h、当日窗口）。

## 2. 现场状态快照（2026-08-15 凌晨）

| 项 | 值 |
|---|---|
| 分支 / tip | `ci/v31-per-file-remaining-gate` @ `cb4b5151c`（含 5 个修复提交 + 本交接文档提交） |
| PR | #4 → main（leelv009/meiyeagent）；PR #3 已关（superseded） |
| required 组成 | redline-evals / core / session-quick-checks / root-quality / core-persistence / production-main-journey / **v31-day0-gate** / production-dependency-audit |
| 已在 CI 转绿 | core（typecheck+全套单测）、core-persistence、redline-evals、session-quick-checks、production-dependency-audit |
| 仍红（本轮工单） | v31-day0-gate（竞态）、root-quality（3 件机械项）、production-main-journey（产品级死点击） |
| 遥测（非阻塞，勿修） | p2-browser-acceptance 红；v31-browser-report：run1=16 绿/6 红、run5=17 绿/5 红、两轮仪器失败均为 0 |
| 关键 run | run1=31812359379（adc040dbc）、run5=31819090814（cb4b5151c，证据主来源） |

已修复项的提交锚点（勿重复修）：`b2b6908e3`（core typecheck never 收窄 +
V31-63 定时炸弹）、`afdb1712f`（steering 单测对齐 fail-closed）、
`a882c6cd3`（root typecheck 7 错 + root-quality 150m）、`cb4b5151c`
（candidate workerd V8 flags——注意：该修复与 main-journey 的红**无关**，
死点击另有原因，见 T2；但 flags 修复本身保留，勿回滚）。

## 3. 工单（按序执行）

### T1 机械项批（目标：day-0 门绿 + root-quality 绿；一个 commit 一次 push）

#### T1-a day-0 spec 的 quote 竞态

- **现象**（run4/run5 各红一次，run1/run2 绿——纯竞态）：
  `tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts:24`
  测试「零素材选图文发送进入引导，走不到确认并开始 400」等
  `composer-recipe-slot-guidance` 不出现，15s 超时，重试 2 次同败。
- **根因**（证据：run5 `v31-day0-gate-evidence` artifact 的
  error-context.md + 截图）：spec 在用量（quote）算好之前点了发送，产品
  弹出告警「这次的用量还没算好，所以没能开始。稍等一下，等发送键下方出现
  用量说明再点」并拒绝进入引导。**产品自己声明了前置条件，spec 没遵守**。
  截图显示超时时 quote 已算完（「本次约消耗 15 分」已渲染）——晚一步点就绿。
- **修法**：在该测试（以及同 spec 内任何「点发送」步骤）点击
  `composer-submit` 前，先等用量说明可见。去
  `src/product/composer/` 里 grep「用量」「约消耗」「用量已确认」找到对应
  testid（如果没有 testid，给用量说明元素补一个，比按文案匹配稳）。注意
  day-0 场景是零素材新商家，用量文案可能是「先补案例图」态——以页面实际
  锚点为准，先本地跑一次红的复现确认要等的元素。
- **本地复现**（fixture 栈，轻）：
  ```bash
  cd mkfast-template-main
  TEST_DATABASE_URL=postgres://127.0.0.1:5432/hf_day0 \
  TEST_DBOS_SYSTEM_DATABASE_URL=postgres://127.0.0.1:5432/hf_day0_dbos \
  bash ../scripts/ci/provision-test-db.sh
  CI=true MODEL_EXECUTION_MODE=fixture PLAYWRIGHT_CORE_PORT=4110 PORT=3010 \
  TEST_DATABASE_URL=postgres://127.0.0.1:5432/hf_day0 \
  TEST_DBOS_SYSTEM_DATABASE_URL=postgres://127.0.0.1:5432/hf_day0_dbos \
  HARNESS_DBOS_SYSTEM_DATABASE_URL=postgres://127.0.0.1:5432/hf_day0_dbos \
  pnpm exec playwright test tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts
  ```
  竞态在本机可能不容易触发（本机快）；可临时给 quote 请求加延迟或直接按
  机制修（等元素再点永远是对的），修完本地跑绿一次即可。

#### T1-b biome 格式红

- **现象**：run5 root-quality `web-check.log failed with exit code 1`，
  biome 指向含 `PRODUCTION_CANDIDATE_HEALTH_FAILURE_WINDOW_MS` 的文件
  （在 `mkfast-template-main/scripts/e2e/` 下，grep 定位）。
- **修法**：`cd mkfast-template-main && pnpm check` 本地复现 →
  `pnpm exec biome check --write <该文件>` → 再跑 `pnpm check` 确认。
  只接受格式化产出，不顺手改逻辑。

#### T1-c web 单测两红

- **现象**（run5 root-quality `root-test.log`）：
  1. `not ok 989 - Composer gates render and submission on the current quote, not the bound one`
  2. `not ok 1124 - #323 browser gate requires paid-media confirmation before AI cover execution`
- **定位**：按测试名 grep `mkfast-template-main/src` 找到测试文件，
  `node --import tsx --test <文件>` 单项复现。
- **判法（重要）**：这两个大概率是 08-13/14 产品 churn（84d3d091 家族：
  quote 换 key、确认卡改造）改了行为、测试没跟上——和 steering 单测同款。
  **先读产品侧相关 diff（`git log -p 39ca4b39..HEAD -- <产品文件>`）确认
  行为变更是有意的，再改测试对齐**；若发现产品行为不自洽（比如 quote
  绑定确实丢了），升级为产品红报告，不要为了绿而弱化断言。
- 修完只跑这两个文件验证，不跑全仓。

#### T1-d opt-in test evidence 守卫红

- **现象**：run5 root-quality `[check] FAIL opt-in test evidence (exit 1)`。
- **定位**：根目录 `pnpm check` 本地复现，读守卫输出（守卫脚本在
  `scripts/` 下，账本是 `docs/ops/opt-in-test-evidence.json`）。大概率是
  `a882c6cd3` 删了四个 e2e spec 里的死助手后，守卫要求登记/更新对应
  evidence 条目。**按守卫的指示补账本**，不要绕过守卫。

#### T1 收尾

全部单项本地绿后：一个 commit（message 说清楚四件事各自的因果），
push meiyeagent，`gh run watch <新 run> --interval 300`。预期：
v31-day0-gate 绿、root-quality 绿，required 只剩 production-main-journey。

### T2 production-main-journey：「先核对信息」死点击（产品级，最后一关）

**这是通往 required 全绿的最后一个红，也是唯一需要产品级定位的。它挡住的
旅程 = 真实新商家的第一单，值得花力气。**

- **已固化的证据链**（不要重查一遍，直接从这里接）：
  1. 失败测试：`tests/e2e/specs/assembly-gate-required-journey.spec.ts:114`
     「registers a cold tenant and delivers its first copy with zero
     configuration」，在 `submitFirstCopy`（:68）等
     `POST /api/core/p1/composer/submissions` 响应 120s 超时。
  2. run5 trace 分析结论（artifact
     `production-main-journey-evidence` → `mainline/test-results/...`）：
     - quote 已确认（页面渲染「本次用量已确认」，product-billing/quote
       命令 200 返回）；
     - `composer-submit` 按钮此刻 aria-label=**「先核对信息」**；
     - Playwright click **成功完成**（trace log:「click action done」）；
     - 点击后**零网络请求、零 UI 变化**（无确认卡、无 ask 卡、无 toast
       残留），页面顶部有常驻「还差门店名称…去门店页补」引导条；
     - 2 分钟后 waitForResponse 超时；workerd 随后 broken pipe 崩溃——
       **崩溃是 Playwright 断连的下游余波，不是原因**，不要去修 workerd。
  3. 同 job 里 `m04-browser-hard-gate.spec.ts` 的红（「确认并开始」按钮
     element not stable → detached）疑似同根（确认卡链路 re-render），
     先修 assembly-gate，再看 m04 是否跟着绿。
  4. 该 spec 自 08-13 起每个 CI 样本都红（run1/2/4/5 一致）。08-13 之前
     的绿证在 `2f2960e6`（V31-84/86 门店录入链改造之前）。**变更源头
     锁定在 08-13 的 V31-84（Day-0 录入链）/ V31-86（档案卡一击确认）**：
     `b99140000`、`c755f6b1a`、`014824557`、`a023c2175` 附近。
- **探查顺序**（按性价比）：
  1. 在 `mkfast-template-main/src/product/composer/` grep「先核对信息」，
     找到 submit 按钮进入该 label 的状态分支和 onClick 处理链；重点看
     冷租户（门店名缺失 / store profile 空）时点击应触发什么（ask 卡？
     档案卡？店内引导？），以及该路径在**哪个条件下会静默 return**。
  2. 对照 fixture 栈为什么活着：day-0 spec（`v31-84-store-onboarding-*`、
     `v31-86-*` 遥测里都是绿的）走的是同一套录入链但在 vite dev 栈；
     candidate 栈（`wrangler dev` + 生产构建）下这条链死了——查该分支
     依赖的东西里有什么在生产构建下不同（懒加载 chunk？SSR/CSR 差异？
     环境变量分支如 `import.meta.env.DEV`？）。
  3. 本地复现（candidate 栈，重；起之前确认本 worktree 没有并行 dev）：
     ```bash
     cd mkfast-template-main
     TEST_DATABASE_URL=postgres://127.0.0.1:5432/hf_pmj \
     TEST_DBOS_SYSTEM_DATABASE_URL=postgres://127.0.0.1:5432/hf_pmj_dbos \
     bash ../scripts/ci/provision-test-db.sh
     CI=true PLAYWRIGHT_PRODUCTION_CANDIDATE=true MODEL_EXECUTION_MODE=fixture \
     PLAYWRIGHT_AUTH_BASE_URL=http://localhost:3011 \
     PLAYWRIGHT_BASE_URL=http://localhost:3010 \
     PLAYWRIGHT_CANDIDATE_PORT=3010 PLAYWRIGHT_CANVAS_PORT=4210 \
     PLAYWRIGHT_CORE_PORT=4110 PORT=3011 \
     TEST_DATABASE_URL=postgres://127.0.0.1:5432/hf_pmj \
     TEST_DBOS_SYSTEM_DATABASE_URL=postgres://127.0.0.1:5432/hf_pmj_dbos \
     pnpm exec playwright test tests/e2e/specs/assembly-gate-required-journey.spec.ts --trace=on
     ```
     若本地复现成功（预期能——这不是 CI 特有问题），加 `--headed` 或读
     trace 里的 console 事件找 JS 报错。**若本地绿而 CI 红**，再回头对比
     CI 环境差异，但先假设可本地复现。
  4. 定位到死因后判：产品缺陷 → 修产品（这不受冻结限制：属于
     CURRENT §3a D3 白名单的「诚实性 / 死路 P0」）；spec 与新旅程错位
     （比如冷租户本来就该先走录入确认、spec 需要补走一步）→ 改 spec 对齐
     新旅程，并在 commit message 里引用 V31-84/86 的旅程定义。
- **验收**：本地该 spec 绿 + m04 spec 绿（同栈跑一次）→ 单独 commit
  push → CI 上 production-main-journey 绿 → **required 应当全绿**。

### T3 required 绿之后（不属于本轮，只留指针）

- 按 CURRENT §3a：required 绿 + V31-76 清 = 解冻门槛推进；合并 PR #4 由
  主控/用户拍板，不要自行 merge。
- 5 个跨轮稳定的旅程红（rights-revocation / mid-run-steering /
  ops-console-release / partial-resume-assisted / v31-85-video-fallback）
  进能力账本排队，是下一波的工作，**不是本轮的**。

## 4. 明确不做的事（每一条都有血泪案底）

1. **不修 p2-browser-acceptance 和 v31-browser-report 的红**——遥测，
   不阻塞 required。修它们 = 又一轮点对点无效测试。
   **本条已有案底（2026-08-15，当日实证）**：required 在 `bb124004d` 绿之后，
   下一个提交 `1c45089f6` 为了让 p2 的 viral chip 与 mid-run steering 两条
   **遥测** spec 变绿，删掉了 Core 里 steering `resolveAuthority` 的
   `AND run.thread_id = $4`（线程作用域）并绕过 `steeringBindingMatchesAdmitted`。
   结果：跨 Work 串绑，`campaign-paid-work-confirmation`「Work 1 与 Work 2
   各自独立」由绿转红、Core 报 L0.5 `already bound to different facts`、
   **required 由绿转红**；而被绕过的守卫只剩自身单测引用，单测全程绿。
   已回滚，真问题转 V31-90，接线契约见
   `apps/core/src/p1/agent-session/steering-authority-isolation.static.test.ts`。
   **教训**：遥测红的优先级永远低于已到手的 required 绿；用放宽隔离换 spec 变绿，
   代价是产品语义。
2. **不碰 workerd/miniflare/OOM 方向**——死亡是断连余波；两轮遥测仪器
   失败为 0，仪器已稳。V8 flags 修复已在位，够了。
3. **不跑本地全门、不拿本地绿证下结论**——本地 42-spec 门历史误报率
   83%，已降级为调试工具。
4. **不动门结构、required 组成、分支保护**。
5. **不改历史提交署名、不 rebase 已推历史**——SHA 锚点遍布文档。
6. **不在验证配方里引用旧文档的 worktree/分支/DB**——CURRENT 开头的
   警告是认真的，带日期文档全是历史快照。
7. **不把「测试改绿」当目标**——每个红要么修产品、要么让测试如实对齐
   已拍板的产品行为、要么定性为仪器并留证据。为绿而弱化断言 = 假绿，
   本仓对假绿零容忍（复核文化会抓）。

## 5. 证据与命令速查

```bash
# 看 PR 与最新 run
gh pr view 4 --repo leelv009/meiyeagent
gh run list --repo leelv009/meiyeagent --branch ci/v31-per-file-remaining-gate --limit 3

# 下载某 run 的证据（job 级 artifact）
gh run download <runId> --repo leelv009/meiyeagent -n v31-day0-gate-evidence -D <dir>
gh run download <runId> --repo leelv009/meiyeagent -n production-main-journey-evidence -D <dir>

# 失败 job 的日志
gh api "repos/leelv009/meiyeagent/actions/jobs/<jobId>/logs" | grep -E "✖|failed|Error" | head

# 单项测试（node:test 风格）
cd mkfast-template-main && node --import tsx --test <file>
# 单项测试（vitest interaction）
cd mkfast-template-main && pnpm exec vitest run <file>
```

- 门收缩决策与诊断背景：`docs/ops/ci-arbiter-gate-shrink-2026-08-14.md`
- run5（证据主来源）：31819090814；run1（首轮全样本）：31812359379
- 两轮遥测 verdicts：各 run 的 `v31-browser-report-evidence` →
  `v31-file-verdicts.log`

---

## 5a. 遥测红要 ≥3 轮样本才配被追（2026-08-15 实证）

同一份 22 spec catalog 跑了五轮，只有 `v31-mid-run-steering-journey` 和
`v31-ops-console-release-journey` 稳定红；`rights-revocation`、`artifact-growth`、
`video-paid-execution`、`v31-83` 都翻转过（详表见 V31-90）。通过数在 17–19 之间浮动，
**代码树完全相同的两轮也能差 2 条**。

所以：**不要用单轮遥测差值判因果**，也不要照着一轮的 failed 列表开票。取 ≥3 轮
样本，稳定红才进能力账本。

### 更正：`required` 本身也不是零抖动（2026-08-15 晚，合并后实测）

本节初稿写「`required` 的八个 job 跨五轮零抖动」。**该结论已被推翻**——合并后在
main（`123eec360`）与仅差文档的分支（`f1ba27b8a`）上取样，同一份产品代码出现了
三条互不相同的间歇红，全部落在 `required` 内：

| 间歇红 | 所在 job | 票 | 定性 |
|---|---|---|---|
| `campaign-paid-work-confirmation:190` 显式 start 收 409 | production-main-journey | **V31-91** | 竞态，根因未定位 |
| `run-service.test.ts:673` 留下 fallback 证据 | root-quality | **V31-92** | 测试侧墙钟排序，机制已定位 |
| `memory-vault-governance` 的 `selectComposerLens` 20s 超时 | production-main-journey | **V31-93** | **产品缺陷**被重试掩盖：remount 甩掉点击 |

**实测分布**（同一份产品代码，main `123eec360` 与仅差文档的 `f1ba27b8a`／`12f48f201`）：

| Run | 树 | root-quality | production-main-journey | required |
|---|---|---|---|---|
| 31890594956 | main（push） | **红**（V31-92） | **红**（V31-93） | **红** |
| 31891110630 | docs（`f1ba27b8a`） | 绿 | **红**（V31-91） | **红** |
| 31892646103 | main（dispatch） | 绿 | 绿 | **绿** |
| 31892656795 | main（dispatch） | 绿 | 绿 | **绿** |
| 31893493391 | docs（`12f48f201`） | 绿 | 绿 | **绿** |
| 31894747957 | docs（`7708b69d3`） | —（被我取消） | **红**（V31-93 第二形态） | **红** |

即：`required` 在**产品代码零差异**的六轮取样里 **3 绿 3 红**。
`production-main-journey` 3 绿 3 红、`root-quality` 4 绿 1 红。
（31894747957 整轮后被我取消以让位新 head，但 `production-main-journey` 的红是真跑出来的
测试失败，不是取消造成的，故计入。）

**三次红的根因互不相同，但其中两次同源**：31890594956 与 31894747957 都是 V31-93 那个
Composer 胶囊吞点击的缺陷，只是一次经由包了重试的 `selectComposerLens`（表现为超时），
一次经由没包重试的 `assertThreeModalDiscovery`（表现为硬红）。详见 V31-93 的对照表。

**这就是「反复撞墙」的量化形态**：任何一次红都长得像「你刚才那个改动坏了东西」，
但代码根本没变。不先把抖动量出来，就会把每一次随机红都当成新缺陷去追。

**对下一个 agent 的含义**：

- `required` 红**不再自动等于「你的改动坏了东西」**。先比对失败模式（错误码 ／
  堆栈行号）与上表；命中即重跑，不要开始改产品代码；
- 但 `required` 仍是**唯一裁决器**——合并前必须拿到绿，只是允许「同 SHA 重跑」
  来穿过已立票的抖动。重跑要记进票里当样本，不要静默重跑；
- 反过来，**单轮 required 绿也不再等于零风险**：三条抖动都是「有时绿」。
  release-ready 类判断按能力账本单独取证。

这条更正本身就是 §1「先归类再动手」的用例：不先把红归到「仪器抖动」这一类，
就会去修一个根本没坏的产品。

## 6. 当前唯一待办（2026-08-15 晚）

`required` 已在 `bb124004d` 拿到真判决。此后唯一动作是把 `1c45089f6` 引入的
Core 回归回滚（见 §4.1 案底），并落下防复发契约与 V31-90。

**下一个 agent 只需要做一件事**：确认回滚后的 head 上 `required` 重新变绿，
然后**停手**，等用户拍板合并。具体：

1. `gh run list --repo leelv009/meiyeagent --branch ci/v31-per-file-remaining-gate --limit 3`
   找到回滚提交对应的 run；
2. 只看 `required` 的结论；绿 = 交付完成，向用户报告并停止推送；
3. 若 `required` 仍红，按 §1 纪律逐项归类——**但先确认红的 job 与回滚是否相关**：
   回滚只动了 `apps/core/src/assembly/core-assembly.ts`，它只可能影响 core /
   core-persistence / production-main-journey 三个 job；
4. **不要**趁机再修遥测红。V31-90 与其余遥测红都在 PR 合并之后排队。

合并动作由用户/主控拍板，执行 agent 不得自行 merge。
