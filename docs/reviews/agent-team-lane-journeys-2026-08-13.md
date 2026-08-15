# Lane D — Customer Journeys
- HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（读 `.git/refs/heads/main` 核过；本机无 shell，未跑 `git rev-parse`）
- Date: 2026-08-13
- Scope: 只读产品代码 + e2e spec + 票面收口 + 08-13 盘点/门判决/批次回顾。**本轮未做活体浏览器走查**；活体结论一律标「历史，未在本 HEAD 复走」。
- 台账：`docs/ops/capability-ledger-2026-08-13.md` 的四态是 08-13 盘点快照。HEAD 已合入 V31-73/77/78/79/82/83/84/85/86/87/88/89，表内 C1「修复中 / V31-78 P0」等行**落后于 HEAD**，下表按本树重判。

## 1. Verdict

漏斗（商家从注册到次日自报，**第一个会掉下去的地方**）：

```
注册 → 赠 100 分 / 模型默认供给
  │  V31-78 砖号已修；故障注入 e2e 仍缺（FIND-D-012）
  ▼
首页 Composer（零档案、零素材）
  │  选「文案」：可交付通用文案（C2 降级通）
  │  选「图文」：诚实引导卡，不扣分、不 400（C1 门绿）
  │  选「视频」：只留「去传素材」，无假出口（V31-85）
  │  要出图文成品必须离开 Composer 去建档+传图
  ▼
门店五步 / 档案卡一击保存（V31-84/86/89）
  │  代码上通；「说一句」LLM 提取失败不挡保存
  │  历史 remix / continue-item 仍红（V31-76，FIND-D-013）
  ▼
素材库上传 → 授权案例图 → Composer「从素材库选」（V31-88）
  │  挂源后图文才可提交
  ▼
Level 1 纯 copy
  │  账本与交付通；但「确认并开始 / 确认本次创作」仍会出来
  │  = §37.4-B「免确认直达」对商家不成立（FIND-D-001）
  │  时间线/标题仍可能吐内部指令（V31-80，FIND-D-006）
  ▼
Level 2 图文 Living Plan → 确认 → 扣分 → Make
  │  e2e 靠 seedComposerInlineAuthorize 跳过挂源
  │  活体历史：确认后 running 悬死；HEAD 有 15min sweeper+退款
  │  商家等不及 15 分钟就会以为丢钱（FIND-D-003）
  │  中途改要求：英文裸错，旅程断（FIND-D-002，P0）
  ▼
视频付费 / 撤权换图 / 报价变了再确认 / 中断恢复 / 部分续跑
  │  规格在、多数用 seed + fixture 锚点
  │  带素材活体未在本 HEAD 复走
  ▼
交付 → 发布交接面板 → 「我已发布」
  │  当日不追问（诚实）
  │  「次日 chips」只在 API 把时钟拨到昨天时出现，商家日历次日未证（FIND-D-009）
  ▼
经验清单 / 目标主动建议
  │  空态诚实；建目标无商家面；注入收据仍露 memoryId
```

**一句话**：Day-0 不再是「点发送就 400」的死路；商家现在会死在三处——**(1) 纯文案仍被按确认卡**、**(2) 图文中途调整英文裸错**、**(3) 付费图文开跑后长时间无进度、钱先走、要等超时才退**。钱账本本身在健康链上是对的；假绿来自 seed 把「没图也能交」测成了绿。

## 2. Journey scorecards

### J-A Day-0 / 零素材首访（C1, C2）

- Ledger state vs this review
  - 台账 C1=修复中（挂 V31-78）；C2=降级可用。
  - 本 HEAD：C1 **降级可用**（门级零素材 spec 绿史 + 引导卡产品在位；「拿到第一条**图文成品**」仍要建档+挂源）。C2 **降级可用**（fixture 自由创作可交付；live 模型链未走）。V31-78 砖号已修。
- Steps（商家语言）
  1. 注册进工作台，看到一句话输入框和创作类型。
  2. 还没店、没图：可以先写一条通用文案（自由创作 / 文案类型）。
  3. 若选「图文」就发：系统先说「这个配方要一张案例图」，给「去传素材」；图文还有「换不需要案例图的写法」。**不会开始生成、不会扣分。**
  4. 要出图文：去门店页说一句 → 档案卡改一改点保存 → 素材页上传并授权「顾客案例」→ 回到 Composer 从素材库勾上 → 再发。
  5. 文案跑完：同一会话里看到成品，可进发布交接。不写从没确认过的店名/项目/价格。
- Breaks
  - **第一摩擦（不是死路）**：选图文就发，停在引导卡。商家要离开创作主轴去建档+传图才能继续（§2.2 成功形态第 2–8 步对零素材店不成立）。
  - **第一死路（历史，代码已堵）**：V31-73 默认配方 `case_image` 硬门 +「可以直接再发一次」劝重试。现产品在提交前拦截，`v31-zero-source-image-text-first-visit` 断言零 POST。
  - 注册链历史死路 V31-78：model-default 失败 → 全站 500。HEAD 终态化+降级转发+banner；缺故障注入 e2e。
- Spec honesty
  - `v31-zero-source-image-text-first-visit`：**诚实**。头注禁止 `seedComposerInlineAuthorize`；不断「确认并开始」、不断 submissions。V31-77 升格为门内 fail-fast 首位。
  - `v31-day0-free-creation-journey`：无 seed、无 store seed；断言 `makeReady:true`、无 `execution-confirmation-interaction-card`、无 `/start`。但 `settleFreeSubmission` **会点「确认并开始」**（Brief/事实门），与「零确认」商家体感不一致。
  - `uiux-day0-contract`：自陈 demoted，4/7 历史红；**用 seed**；不得当 C1 绿证。
  - `uiux-creation-loop` / `dashboard-home-mount`：无 seed 合同（V31-77 清单）；仍挂 V31-76 红（remix 不换草稿、`continue-item`）。
- Error / empty / timeout / back / refresh
  - 零店：`productState.store === null`（V31-51），自由创作不被 grounding 挡。
  - 引导卡：不扣分、可改类型或去传图。
  - Provisioning 降级：banner，不再整页 500（`shouldAllowDegradedCoreForward`）。
  - 刷新：自由创作交付后 conversation 可恢复（Level-1 spec 有 reload 断言）。图文引导态草稿保留（V31-73 行为）。
- Money
  - 引导卡路径：零 POST，零预扣。
  - 自由文案：提交内 reserve+settle；失败退回文案在 quote chip。
- Merchant language
  - 引导卡中文。自由创作选模型是目录名。V31-80 交付叙述仍可能带 `ExecutionPlanSnapshot`。
- Findings IDs: FIND-D-001, FIND-D-006, FIND-D-012, FIND-D-013, FIND-D-018

### J-B Level 1 纯 copy 免确认（C3）

- Ledger vs this review：台账=降级可用 + 确认卡违约。本 HEAD **维持**：账本通，确认门仍在。
- Steps
  1. 门店已确认（或走档案卡）。
  2. 选「文案」，写「写一条朋友圈介绍护理」。
  3. 看见「本次约消耗 N 分 / 失败将退回积分」。
  4. 点发送 → **常会先出「确认本次创作 / 确认并开始」**（价格/事实高危门，不是付费执行卡）。
  5. 再点一次后开始生成，同一会话交付，扣 1 分左右。
  6. 余额不够：不提交，出「还差 N 分」+ 买加油包 / 升级套餐。
- Breaks
  - **第一断点（规格违约）**：商家要按两次。§3 / §37.4-B / §43 门 5 写「免确认直达」「简单任务不因升级变复杂」。产品把 D-043 事实门和 execution-confirmation 拆成两个概念；商家只看见两张「确认」脸。
  - 第二：时间线「结果」行 / 成品标题拼内部指令（V31-80，open）。
- Spec honesty
  - `v31-level1-copy-journey`：真链（只 fixture 模型）。断言无 `execution-confirmation-interaction-card`、无 `/start`、`makeReady:true`、重放不双扣。
  - **掩码**：`settleLevel1Submission` 主动点「确认并开始」，再宣称「免确认」。测的是「没有付费执行卡」，不是「商家零确认」。
  - 余额不足：`psql` 把 lot 打零（测试仪器，非生产路径）。
- Error / empty / timeout / back / refresh
  - 短额：submit disabled，零 POST。
  - 刷新：交付卡与扣分保持。
  - 返回修改：copy 路径无 Living Plan 条。
- Money
  - quote chip 常显；预扣=结算=报价；replay `replayed:true` 余额不动。
  - 无 hold 卡（policy_exempt_copy 无 confirmation request）。
- Merchant language
  - chip 中文。V31-80 内部动词仍可能进时间线。短额按钮中英正则都认（`购买加油包|Buy a booster`）。
- Findings IDs: FIND-D-001, FIND-D-006

### J-C Level 2 图文 Living Plan（C4）

- Ledger vs this review：台账=不可用（悬死）。HEAD：**仍不可对商家宣称可用**。V31-82 给了超时退款出口，但「确认后等到成品」活体未在本树复证；steering 仍断。
- Steps（对齐 §2.2 / §5.3–5.5 / §37.4-C）
  1. 有案例图挂上，选图文，说「明天下午两个空档，奶油风美甲，不要太像广告」。
  2. 系统应先检索店内项目/授权图，最多问一个问题。
  3. 左侧长出 Living Plan（目标 / 做什么 / 怎么说 / 事实素材 / 积分时长）。
  4. 可说「只做小红书，减到 4 页」→ 新版本，旧版还能点回去。
  5. 底下确认条：积分、余额、授权、失败退回；点「开始制作」。
  6. 可能再问一次「两种图文方向」。
  7. 右侧成品一页页长出，交付后进交接。
- Breaks
  - **第一断点（零素材店）**：没挂案例图走不到 Plan（J-A 引导卡）。
  - **第二断点（有图，历史活体）**：确认 → 扣约 20 分 → 首版卡有了 → work 永 `running`，无 job、无失败、无退款。V31-82：默认 15 分钟 sweeper → failed + refund + 解锁 composer。商家体感仍是「钱没了、一直在生成」。
  - **第三**：中途改要求 → J-G。
- Spec honesty
  - `v31-living-plan-journey`：真 Core 链；断言 `makeReady:false`、显式 `/start` 才 Make、revise 出 revision 2。
  - **掩码**：`seedComposerInlineAuthorize` + `seedConfirmedStore`。测不到 J-A 挂源。
  - V31-82 e2e：gate 第一次真跑红（pill testid）；修后 fixture 档 run **正常跑完**，加重试会从 `alreadyTerminal` 假绿。票面承认浏览器 spec **故意留红**。不是「悬死已在浏览器门证过」。
- Error / empty / timeout / back / refresh
  - 超时：sweeper + `reconcileRestoredSessionPhase`（刷新不再被旧 running 锁死）。
  - 返回修改：commit strip → 同一输入框发 revise。
  - 刷新：Plan / interrupt 应还在（H 旅程测 interrupt，不是 Plan）。
- Money
  - 确认前预扣（U8）；开始后 settle。悬死窗口内钱在 USAGE，要等超时才 refund。无商家「取消并退分」按钮。
- Merchant language
  - Plan 五节中文。V31-80：方案卡执行后仍可能显示「返回修改/开始制作」；右栏可能裸 `work-<uuid>`。
- Findings IDs: FIND-D-002, FIND-D-003, FIND-D-005, FIND-D-006

### J-D 视频付费（C5）

- Ledger vs this review：台账后写「降级可用（零素材已修，带素材未走）」。本 HEAD：**降级可用**，同意。
- Steps
  1. 有案例图，选视频 / 抖音成片配方。
  2. Plan 先写预计积分、预计时长（**不写分镜计价**，V31-35 废止）。
  3. 开始制作 → 付费确认 interrupt。
  4. 可关标签；回来还是同一张确认卡。
  5. 同意后做片；镜头清单在成片页。不承诺字幕轨/封面面板。
  6. 部分镜头失败：报告说清第几镜，只结算做成的。
- Breaks
  - **第一断点（零素材）**：曾有「换不需要案例图的写法」假出口，确认后仍被 `case_image` 打回。V31-85：`canSwitch=false`，无假出口。停在「去传素材」——诚实停，不是循环死。
  - **第二**：带素材全链本 HEAD 未活体走。e2e 全程 seed。
- Spec honesty
  - `v31-video-paid-execution-journey`：seed 两次（reload 后重挂）；Brief + start + interrupt；部分失败靠意图里的「视频部分失败样本」fixture 锚。
  - `v31-85-video-fallback-recipe-dead-end`：无 seed，诚实。
- Error / empty / timeout / back / refresh
  - 关标签：新 tab 同 `interruptId`+revision。
  - 字幕/封面 testid 计数 0（退役是正确行为）。
- Money
  - 先报价后花。恢复不二次扣。部分失败 `settled ≤ reserved`。
- Merchant language
  - 时长/积分中文。Brief「确认并开始」又是一张确认脸。
- Findings IDs: FIND-D-005, FIND-D-019

### J-E Plan stale + 报价变了（§37.4-E / C6 的一腿）

- Ledger：C6 降级可用。本 HEAD：**规格在、活体未走**。
- Steps
  1. 图文 Plan 已出、还没点开始。
  2. 店里价格被改掉（或系统发现报价过期）。
  3. 商家看到 diff（事实或积分那一节变了）。
  4. 旧「确认」作废，不能拿旧单继续扣。
  5. 新确认卡（新 requestId）点过，才继续做；再问图文方向；交付。
- Breaks
  - **第一断点**：价格漂移在 spec 里用 `finalize_store_intake` **API 注入**，不是商家在门店页改价。商家自己改价后是否同样出 diff，本轮未证。
  - 活体确认卡 vs commit strip 双表面：spec 写 V31-63「typed-interrupt 接线仍是 open item」，今日权威面是 `execution-confirmation-interaction-card`。
- Spec honesty
  - `v31-context-fence-journey`：seed 挂图；漂移是测试写事实，不是 UI。旧确认 POST 409。reload 后新卡还在。门第一次真跑时本文件被 workerd 打断，**无本 HEAD 全绿证**。
- Error / empty / timeout / back / refresh
  - 旧决定 409。刷新保留新 requestId。
- Money
  - 旧 hold 不得结算；只新确认后执行。
- Merchant language
  - diff 中文节名。API 409 商家看不到（测试直打 API）。
- Findings IDs: FIND-D-005, FIND-D-008

### J-F 素材撤权（C7 / §37.4-F）

- Ledger：后写降级可用（上传/授权/挂源已修，撤权链未走）。本 HEAD：**同意**。
- Steps
  1. 授权一张顾客案例图，做成三页笔记 Plan。
  2. 去做之前，在素材里撤回授权。
  3. 再点开始：失败，说明授权没了，**不交成品、预扣退回**。
  4. 「改一下要求」换新授权图，重新提交，只扣成功那一单。
- Breaks
  - **第一断点（商家面）**：e2e 撤权走 `productCommand({ type: 'withdraw_asset' })`，不是点素材页按钮。按钮在 `canonical-asset-actions.tsx`（已授权 → 撤回）。**Plan 形成后商家去素材页点撤回再回工作台**，本 HEAD 未走。
  - 上传链历史死锁 V31-84 已修。
- Spec honesty
  - `v31-rights-revocation-journey`：seed 挂图；撤权 API；账本用 `get_usage` + entitlements，不用页面有没有「重复扣费」四字。
  - 注释承认 note-path `get_usage` 可能少报多单位结算，断言允许 1× 或 2× receipt——**仪器诚实，产品计量仍糊**。
- Error / empty / timeout / back / refresh
  - 失败卡 `data-report-kind=failure`，理由含「授权已撤销」。
  - 换图前必须点「改一下要求」解冻 session，否则旧源继续挡。
- Money
  - 被挡单 `refunded`，used 不增；成功单一笔 settle。
- Merchant language
  - 失败理由中文。API 撤权无英文。
- Findings IDs: FIND-D-005, FIND-D-007

### J-G Mid-run steering（C8 / §37.4-G / §43 门 6）

- Ledger：不可用。本 HEAD：**不可用**。V31-81 **open / not-started**。
- Steps（规格）
  1. 图文正在做，底下有「还想改点什么」。
  2. 说「封面不要写最后两个名额，第二页少点字」。
  3. 看见：封面和第 2 页会改，别的页不动；若还没调用上游则不另算积分。
  4. 说「再加两页」→ 要重新算积分，回方案层确认。
- Breaks
  - **第一死路**：运行中提交 → Core `SteeringServiceError`「No admitted execution plan exists for task ${taskId} in this workspace.」面板 `setError(caught.message)` **原样英文+内部 task id**。
  - 根：`core-assembly.ts` 用 `getByWorkflowId(taskId)` 找 admitted plan；composer 任务键与 admission 键可能不在同一空间，或 admission 根本没完成（V31-82 悬死的下游）。
- Spec honesty
  - `v31-mid-run-steering-journey`：seed；`confirmCreationGateIfPresent` 用 try/catch **可跳过**确认门；progressHost 用 `.or()` 四选一。Wave-4 红在前置，**被测 steering 常走不到**。V31-27 降级 evidence-debt。
- Error / empty / timeout / back / refresh
  - 失败：红字英文，composer 仍锁在 running。
  - 无「取消本单」出口。
- Money
  - 此断点通常还没二次扣费；原单预扣仍挂着。
- Merchant language
  - **不过关**。占位符中文，错误英文。
- Findings IDs: FIND-D-002, FIND-D-005, FIND-D-014

### J-H Interrupt resume（C9 / §37.4-H / §43 门 3/4）

- Ledger：悬死分支不可用；健康路径未走。本 HEAD：**超时出口已落地，健康路径仍只靠 spec**。
- Steps
  1. 付费开始后弹出待确认。
  2. 发送键禁用，提示「请先处理上方待确认事项」。
  3. 刷新 / 关标签，卡还在，同一 id+revision。
  4. 点确认，继续（下一问常是图文方向）。
  5. 重复点确认 = 重放，不另扣。
  6. 拖太久：任务取消，积分退回，白话说明。
- Breaks
  - **第一断点（历史活体）**：悬死 running **没有**这张 interrupt，composer 整锁、无取消。V31-82 用超时代替商家取消。
  - 健康「关页再回」只在视频 spec / interrupt spec 里；本 HEAD 未活体。
- Spec honesty
  - `v31-interrupt-resume-journey`：seed；过期靠 `/api/e2e/interrupt-expiry-fixture`（e2e-only）。跨店偷 resume 负向有。
  - 时钟推进是仪器，不是商家等 1h–30d。
- Error / empty / timeout / back / refresh
  - 错 schema 400；旧 revision 409；重复 accept `outcome:replayed`。
  - 过期：`core_hold_expired` + usage `refunded`。
- Money
  - hold 到期全额退。无「点取消立刻退」的商家按钮。
- Merchant language
  - 待确认条中文。过期白话在决策投影，本轮未读 UI 文案是否露出 `core_hold_expired`。
- Findings IDs: FIND-D-003, FIND-D-005

### J-I Thread 连续（C10 / §37.4-I）

- Ledger：降级可用（V31-83 修完）。本 HEAD：**降级可用**。
- Steps
  1. 一单交付后，同一会话再说下一句 → 新 Work，旧成品还在这条线。
  2. 刷新 / 换设备打开同一条，上下文还在。
  3. 「最近」列表是找回会话的入口。
- Breaks
  - **第一断点**：`v31-thread-root-workbench` **不跑交付再续聊**。用 `create_thread` / `open_legacy_work_thread` API 种会话。§37.4-I「Delivered 后继续同一 Thread 产生新 Work」**没有商家编舞**。
  - 悬死 work 会绑架会话（V31-82 半径）；解锁后应能再发。
  - V31-83：同 tab 换号曾泄漏上一号时间线。HEAD 有 scoped session + 登出清理 spec。
- Spec honesty
  - 测的是 thread 容器，不是连续创作。多 Work 注释写「semantic replay 未接线则只 assert attached」。
  - `v31-83-composer-session-cross-account`：无 seed，诚实。
- Error / empty / timeout / back / refresh
  - 刷新：`data-resolve-source=explicit_thread`。
  - 换号：A 的 running/hung 句不得出现在 B。
- Money：本旅程不花钱（API 种线程）。
- Merchant language：列表标题中文。
- Findings IDs: FIND-D-010

### J-J Harness release ops（C14 / §37.4-J）

- Ledger：降级可用。本 HEAD：**降级可用**（商家不可见；运营台在）。
- Steps（运营，不是店主）
  1. `/admin/ops-console` 看 production / retired、pin、Langfuse。
  2. Publish → evaluating → canary → promote。
  3. canary 店用新 release，其他店用 production。
  4. rollback 后新任务回旧版；在途任务仍钉冻结 release。
  5. 记一笔 rollback drill。
- Breaks
  - **第一断点**：本 HEAD 未真实对生产做 promote/rollback。R2 只看渲染。
  - 商家路径：copy 提交用 `if (brief.isVisible)` **可跳过**——仪器软。
- Spec honesty
  - `v31-ops-console-release-journey`：真发命令改 release；商家侧用 seed 挂图做在途钉。
  - 「Rollback drill recorded」是英文（运营可接受）。
- Error / empty / timeout / back / refresh
  - 控制台刷新 run pins。失败应留在 evaluating，本轮未读失败 UI。
- Money：不直接扣商家分；错误 release 会伤后续生成质量。
- Merchant language：商家无感。运营台中英混。
- Findings IDs: FIND-D-015

### J-K 发布交接 + 次日自报（C12 / §6 / §37.4-K）

- Ledger：未走查。本 HEAD：**入口在，次日腿是 API 时钟，未商家走完**。
- Steps
  1. 交付后同一屏：标题/正文/话题/CTA 可复制；ZIP 名确定；手机二维码自己发。
  2. 不出现「系统代发」。
  3. 点「我已发布」绑死当前版本。
  4. **第二天**一句「昨天的笔记有人来问吗？」+ chips（有人问/加微信/预约/买券/到店/没动静）。
  5. 同一条最多问一次；连着两次不理就对该店降频。
- Breaks
  - **第一断点**：当日点「我已发布」后 `self-report-journey` **计数 0**（`not_yet_next_day`）。商家第二天回来会不会自动出 chips，**没有浏览器过日编舞**。
  - 交付依赖 seed 图文旅程；零素材店走不到交接。
- Spec honesty
  - `v31-publish-handoff-selfreport`：seed；交接面板无条件断言（好）。次日腿 `self_report_ask` 把 `publishHandoffCompletedAt` 设成昨天——**测决策函数，不测次日打开工作台**。
  - A19：`attempt_publish_from_handoff` 403 `DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED`。
- Error / empty / timeout / back / refresh
  - ZIP 失败：可能 `error.message` 直出。
  - 当日无 chips = 诚实，不是漏做。
- Money：交接不扣分。
- Merchant language
  - 面板中文。「已记录发布（绑定当前版本）」略内部。QR 不说代发。
- Findings IDs: FIND-D-005, FIND-D-009

### Extra — 注册→供给（V31-78）

- Steps：注册 → 登录工作台 → 看见约 100 体验分、能报价。
- Breaks（历史 P0，已修）：model-default 一步失败 → command 悬 pending → 该店所有 Core 请求 500 → 积分 pill 空白。HEAD：失败终态、trial 完成后降级转发、outbox 退避 20 次、banner。
- Spec honesty：`registration-redemption-chain` 测兑换码与进工作台，**不注入** model-default 失败。e2e 总带 `E2E_PLATFORM_DEFAULT_MODEL_*`，门绿看不见此砖。
- Money：trial 100；兑换一次；作废后再兑失败。
- Findings IDs: FIND-D-012

### Extra — 门店五步 / 档案卡（V31-84/86）

- Steps：门店页五步 → 「说一句」→ 第 5 步一张档案卡（店名/城市/行业/项目/价格等已预填，带来源徽章）→ 「都对，保存」一次 → 事实入账、素材门打开。
- Breaks（历史）：提取空、确认按钮零请求、跳过兜底 409。HEAD：正则+LLM 提取（失败不挡）、一击 finalize、门 2 仅对平台兜底常量放宽。
- Spec honesty：`v31-84` / `v31-86` / `v31-89` 无 composer seed；84 后半走真实库挑选。`w01-storefact-wiring` / `w02-five-step-intake` 仍可能 `productCommand`/`seed`，是旧合同，不是 Day-0 门。
- Money：建档不扣分。
- Merchant language：档案卡中文；来源=商家说的 / AI 推测 / 平台兜底。
- Findings IDs: FIND-D-013（相邻 remix），无新 P0

### Extra — 素材库挂源（V31-88）+ 重传（V31-87）

- Steps：素材页上传并授权顾客案例 → Composer「添加素材」→「从素材库选择」只列合格图 → 缺图告警消失、报价出现 → 提交 202。同图再传不 409、不建第二份。
- Breaks（历史）：只有新上传、同内容 409 砖。HEAD 挑选器+幂等键改内容 hash。
- Spec honesty：88/87 **禁止** `seedComposerInlineAuthorize`。
- Findings IDs: FIND-D-005（对照：C/D/E/F/G/H/K/C16/C17 仍 seed）

### Extra — 积分诚实（C6）

- Steps：顶栏 pill = 可用分；设置里批次+流水；报价=预扣=结算；失败/过期/撤权退回；重放不双扣。
- Breaks
  - 健康链：盘点 R1「100→0 泄漏」撤案（读错库）。
  - **空表**：`MerchantCreditDetailPanel` 对 `batches`/`transactions` 空数组只渲染表头，无「还没有流水」空态。断链/新号像坏掉。
  - 悬死单：钱停在 reserved，要等 V31-82 超时。
  - 双行：「本次约消耗」与「本次用量已确认」可同屏（V31-80 #6）。
- Spec honesty：Level-1 / rights / interrupt 查账本。credits 页空态无 e2e。
- Merchant language：流水 operation/type 有中文映射。加载失败有重试。
- Findings IDs: FIND-D-003, FIND-D-008, FIND-D-017

### Extra — Artifact 原位生长（C16）

- Steps：Make 时右侧同一对象变长，不叠三张候选+结果+交付；刷新不复制卡片；手机全屏作品表。
- Breaks：fixture 标题/叙述可被内部指令污染（V31-80）。稳定 ID 行为 e2e 有（AC1–4 门跑绿史）。
- Spec honesty：`v31-artifact-growth-journey` **seed**；真 start + 图文方向 interrupt。AC2 用 e2eAgentFault 改 query，不 fulfill 成功。
- Findings IDs: FIND-D-005, FIND-D-006

### Extra — 部分续跑（C17）

- Ledger：未走查。本 HEAD：**未走查**。
- Steps（规格）：部分页失败 → 已做成的可交接（assisted）→ 续跑剩下的不重扣已做成部分。
- Breaks：依赖付费图文跑到 partial；被 C4/C5/C7 挡。spec 用「持续冲突样本」fixture 锚 + seed。
- Spec honesty：`v31-partial-resume-assisted-journey` 关 tab 恢复 interrupt 后走到 `partially_refunded`。**无商家点「续跑剩下页」的编舞**。
- Findings IDs: FIND-D-005, FIND-D-016

### Extra — 记忆 B2（C11）

- Ledger：降级可用。本 HEAD：**降级可用**。
- Steps：任务详情 → 注入了哪几条经验 → 来源一句话 → 撤销其中一条 → 下次不再用这条。
- Breaks：空店没有注入数据，面板不出现（诚实）。AC4「删来源对话」仍 evidence-debt（票面）。收据仍渲染 `memoryId` 一行。
- Spec honesty：`v31-memory-injection-b2-journey` 头注删掉了「风格字数生效」（那是 fixture 自证）。用两条偏好防「撤销=层坏了」。来源断言 `因为你 .+ 说过` / 「来源对话已删除」。
- Merchant language：陈述中文；`memory-injection-receipt-memory-id` 仍是内部 id。
- Findings IDs: FIND-D-011

### Extra — 目标 / 主动建议（C13）

- Ledger：降级可用。本 HEAD：**降级可用（空态诚实，建目标无商家面）**。
- Steps（规格）：Idle 看见当前目标 + 为什么现在建议；点建议开新会话且不扣分；关掉的刷新后还记得。
- Breaks
  - `/dashboard/goals` 非 200——**按设计无管理页**。
  - 建目标：spec 用 `propose_create_goal` + `confirm_goal_proposal` API。店主没有「设一个目标」按钮。
  - 建议默认 `threshold_unset` 关闭；要 admin-config allowlist + 拨时钟才出。
- Spec honesty：`v31-goal-proactive-idle` 是 API/投影合同，不是店主点选旅程。
- Merchant language：有目标时「当前目标 / 已交付 N · 经营信号 M」。无目标时空 section，不撒谎。
- Findings IDs: FIND-D-010（同族：面在、主路径 API）

## 3. Findings

### FIND-D-001 — Severity: P1
- Journey: J-B（也擦到 J-A 自由创作）
- Break step: 发送纯文案之后、生成之前
- Evidence
  - 规格：§3 Level 1、§37.4-B、§43 门 5。
  - 盘点 R1（历史）：盘点四号 copy 单出了确认卡。
  - 代码：`approvalBasisForSubmission` 对 `copy` 是 `policy_exempt_copy`（`composer-plan-session.ts`），**免的是 execution-confirmation / `/start`**。
  - 同时 `v31-level1-copy-journey` / `v31-day0-free-creation-journey` 的 settle 助手**等待并点击「确认并开始」**；D-043 `fact-satisfaction.ts` 会问「请确认本次创作要用的…」。
  - 客户端 `EXECUTION_CONFIRM_TRIGGER_MODE='existing_gates'`：Brief/事实门算「已有门」，通过后不再叠第二张付费卡——商家仍经历了第一张。
- Merchant impact: 「写一条朋友圈」变成两次确认。简单任务因升级变复杂。
- Fix contract: 零付费媒体 + 无高危冲突的 Level 1，发送一次到流式结果；高危仅内联一句知情，不占整卡。Quote chip 仍在。
- Files: `apps/core/src/p1/harness/fact-satisfaction.ts`；`mkfast-template-main/src/product/composer/composer-home.tsx`；`execution-confirm-card.ts`；`tests/e2e/specs/v31-level1-copy-journey.spec.ts`
- Tests: 改 Level-1 为**无「确认并开始」也 202**；保留「无 execution-confirmation-interaction-card」。禁止再把点确认写进 happy path。
- Do not: 不要删测试里的卡却留产品卡；不要把事实门改名叫「不是确认」了事。
- Depends on: 产品拍板：D-043 与 §37.4-B 谁让。

### FIND-D-002 — Severity: P0
- Journey: J-G（C8），锁 §43 门 6
- Break step: 图文 running 时提交中途调整
- Evidence
  - 票 V31-81 open：活体 `No admitted execution plan exists for task composer-task:…`
  - `apps/core/src/assembly/core-assembly.ts` `resolveAuthority`：找不到 admitted plan 就抛上述英文。
  - `steering-composer-panel.tsx` catch：`setError(caught.message)`。
  - V31-27 Wave-4：前置红，steering 行为未走到。
- Merchant impact: 改两页这个核心卖点不可用；英文+task id。
- Fix contract: 有 admitted snapshot 的 running 图文，改封面/第 2 页有中文影响句；失败中文、无 id。无 snapshot 时中文解释「还不能改，因为…」+ 可等待或取消。
- Files: `apps/core/src/assembly/core-assembly.ts`；`apps/core/src/p1/agent-session/foundation-module.ts`；`steering-client.ts`；`steering-composer-panel.tsx`；`v31-mid-run-steering-journey.spec.ts`
- Tests: 去掉 `confirmCreationGateIfPresent` 软跳；前置必须走到 `steering-submit`。负向：无 admitted plan → 中文、无 `composer-task:`。
- Do not: 不要前端编造 impact；不要把英文映射成空成功。
- Depends on: V31-82 定性（无 admission 则 steering 是受害者）；V31-16 键空间。

### FIND-D-003 — Severity: P1
- Journey: J-C / J-H / C6
- Break step: 确认并开始制作之后、第一张可用图之前
- Evidence
  - 盘点 R1/R2：work-cd980cd4 等 `running`、无 image job、composer 锁死。
  - V31-82 implementation-complete：sweeper + refund + `reconcileRestoredSessionPhase`。默认约 15 分钟。
  - `v31-82-stalled-image-work-timeout.spec.ts`：fixture 下常跑完，**不能**当悬死绿证。
- Merchant impact: 先扣 15–20 分，长时间「正在生成」；取消只能等超时。会认定吞钱。
- Fix contract: 有界等待（分钟级可见倒计时）+「停止并退回积分」；停则 failed+refund+解锁，无需清 storage。
- Files: `apps/core/src/p1/execution-spine/stalled-work-sweeper.ts`（及装配）；composer session reconcile；`v31-82-*.spec.ts`
- Tests: 新仪器：start 后、建 job 前注入停滞（不要等跑成功）。断言 pill 恢复、输入解锁。
- Do not: 不要用「跑成功」假绿关掉 82 spec。
- Depends on: 生成链为何不建 job（独立缺陷，本 finding 只要求钱和出口）。

### FIND-D-004 — Severity: P2
- Journey: J-F
- Break step: Plan 已出，商家想撤回这张图
- Evidence: 撤权 UI 在 `canonical-asset-actions.tsx`（`asset_governance_withdraw`）。e2e 不点它，走 `productCommand`。R2 明确撤权链未走。
- Merchant impact: 不知道撤回会不会立刻卡住正在确认的 Plan。
- Fix contract: 素材页点撤回 → 回到未开始的 Plan → 开始制作失败中文+退款 → 换图重做只扣一笔。
- Files: `canonical-asset-actions.tsx`；`v31-rights-revocation-journey.spec.ts`
- Tests: 用真实撤回按钮替换 `productCommand`。
- Do not: 不要只断言页面没有「重复扣费」四字。
- Depends on: 无

### FIND-D-005 — Severity: P1（仪器 / 假绿）
- Journey: C, D, E, F, G, H, K, C16, C17, XHS 主链
- Break step: 测试替商家挂上案例图
- Evidence
  - `seedComposerInlineAuthorize` 仍被 living-plan / video / context-fence / rights / steering / interrupt / publish / artifact / partial / xhs-image-text-main 调用。
  - Day-0 四件被 V31-77 静态禁种。对比证明：禁种后才暴露 73/85/88。
- Merchant impact: 门绿 ≠ 新店能出图文。
- Fix contract: 每条「从零到成品」的必跑旅程，挂源必须走库挑选或引导卡，禁止 inline authorize。付费执行旅程可另列「已有授权图」前置，但不得冒充 Day-0。
- Files: `tests/e2e/fixtures/product.ts`；上列 spec；V31-77 静态清单
- Tests: 扩静态契约。K/C 若宣称主旅程，加一条无 seed 变体（允许停在引导卡）。
- Do not: 不要删 seed 又不给挑选步骤（会红成假产品缺陷）。
- Depends on: V31-88 挑选器（已在）

### FIND-D-006 — Severity: P1
- Journey: J-B, J-C, C16
- Break step: 交付后看时间线 / 标题 / 右栏
- Evidence: V31-80 open，七项清单（内部指令、`work-uuid`、方案卡不冻、双叙述、用量双行、事实计数矛盾）。本轮只读代码，未复走四号账号。
- Merchant impact: 成品像内部工单；不敢发。
- Fix contract: 商家面零内部类型名/裸 id；方案卡 delivered 只读；一句用量。
- Files: composer conversation / delivery / living plan strip / inspector
- Tests: 静态扫描 + 一条 copy 交付 e2e「不得含 ExecutionPlanSnapshot」。
- Do not: 不要只改 fixture echo。
- Depends on: 无（展示层）

### FIND-D-007 — Severity: P3
- Journey: C7 商家发现路径
- Break step: 与 FIND-D-004 合并实施即可
- Evidence: 见 FIND-D-004
- Merchant impact: 低（按钮在，缺的是旅程证明）
- Fix contract: 同 FIND-D-004
- Files / Tests / Do not / Depends on: 同 FIND-D-004

### FIND-D-008 — Severity: P2
- Journey: C6 积分页
- Break step: 打开设置 → 积分
- Evidence: `merchant-credit-detail-panel.tsx` 空数组仍出空表。加载失败有 Alert。盘点 R1：断链号空表无兜底。
- Merchant impact: 新店/断链像系统坏了。
- Fix contract: 空批次/空流水各有一句中文空态；与 pill 同源。
- Files: `mkfast-template-main/src/product/merchant-credit-detail-panel.tsx`
- Tests: 新号打开 credits 见空态，不是空白 thead。
- Do not: 不要用 fixture 种子假装有流水。
- Depends on: 无

### FIND-D-009 — Severity: P2
- Journey: J-K
- Break step: 「我已发布」的第二天
- Evidence: `v31-publish-handoff-selfreport` 当日 `self-report-journey` count 0；次日用 query 传入昨天的 `publishHandoffCompletedAt`。`use-publish-handoff.ts` 问的是 Core 窗口，浏览器不拨日历。
- Merchant impact: 学习闭环进不了 Memory/Proactive。
- Fix contract: 发布满一个日历日后打开该 Work/工作台，自动出现一句追问+六 chips；同 Work 第二次 mark_asked 冲突；两次 ignore 降频。
- Files: `use-publish-handoff.ts`；`publish-handoff-panel.tsx`；operations `self_report_ask`
- Tests: e2e 用服务端 now 夹具打开 dashboard，不断手调 query 字段。
- Do not: 不要当日强行出 chips 凑覆盖率。
- Depends on: 交付可达（C4/C16）

### FIND-D-010 — Severity: P2
- Journey: J-I / C13
- Break step: 交付后再说一句；或想设经营目标
- Evidence: thread spec 不创建 Work。goal spec 断言无 `/dashboard/goals`，用 API 建目标。Idle 面板无目标时 `data-state=empty`。
- Merchant impact: 「同一条线继续做」和「这个月推头皮护理」没有店主入口。
- Fix contract: 交付条上「接着做下一张」留在同一 threadId 并出新 workId。Idle 有「定一个这周目标」短入口（仍走 propose→confirm，无 CRUD 页）。
- Files: `v31-thread-root-workbench.spec.ts`；`idle-goal-proactive.tsx`
- Tests: 真 copy 交付后再提交，assert 同一 thread、不同 work。
- Do not: 不要加 `/dashboard/goals` 管理后台。
- Depends on: 无

### FIND-D-011 — Severity: P3
- Journey: C11
- Break step: 打开注入清单
- Evidence: `memory-injection-receipt.tsx` 渲染 `memory-injection-receipt-memory-id`。V31-18 AC4 未勾。
- Merchant impact: 能看懂「因为你说过」，但多一行内部 id。
- Fix contract: id 只进 title/aria，主文用 preview；删来源后「来源对话已删除」在收据与经验页一致。
- Files: `memory-injection-receipt.tsx`；`memory-vault-page.tsx`
- Tests: B2 已有来源断言；加「可见文本不含 mem_ / 裸 uuid」。
- Do not: 不要用「风格字数」fixture 自证冒充注入生效。
- Depends on: 无

### FIND-D-012 — Severity: P2
- Journey: 注册供给
- Break step: 平台默认模型缺失时的注册
- Evidence: V31-78 产品修了；AC「注册旅程故障注入 e2e」未做。e2e 恒带四件套 env。
- Merchant impact: 回归时店主再次整号残废，门仍绿。
- Fix contract: 一条注入 model-default 失败的注册 e2e：非全站 500、有 banner、补模型后自愈。
- Files: `workspace-provisioning.ts`；`registration-redemption-chain.spec.ts` 或新 spec
- Tests: 见上。禁 seed 掩码。
- Do not: 不要在 required e2e 里永远塞平台模型却声称覆盖了失败。
- Depends on: V31-79 单一真相栈

### FIND-D-013 — Severity: P2
- Journey: J-A 示例店 / 热启动
- Break step: 换行业后再点「复用这条结构」；或有作品的首页「接着上次」
- Evidence: V31-76 open。`uiux-creation-loop` remix 仍写第一家店草稿。`dashboard-home-mount` `continue-item` 5s 不见。产品侧 `continue-item` 仍存在于 `dashboard-continue-section.tsx`。
- Merchant impact: 示例店骗草稿；老客首页找不到续做。
- Fix contract: 第二次 remix 覆盖草稿；有未完成/近作时 `continue-item` 可见。
- Files: suggestion/remix handlers；`dashboard-continue-section.tsx`；两 spec
- Tests: 解 V31-76 两条，不 skip。
- Do not: 不要改 h2/h3 契约躲红。
- Depends on: 无

### FIND-D-014 — Severity: P2
- Journey: J-G spec
- Break step: 测试自己
- Evidence: `confirmCreationGateIfPresent` catch 后 return；`progressHost` `.or()` 四表面。可在没进 mid-run 时绿或红在前置。
- Merchant impact: 间接——steering 假绿/假红都耽误修 FIND-D-002。
- Fix contract: 固定编舞：quote → submit → 确认（若规格还要）→ 图文方向 → `note-plan-timeline-frame` → steering。
- Files: `v31-mid-run-steering-journey.spec.ts`
- Tests: 删除 isVisible skip。
- Do not: 不要 fixme 整文件。
- Depends on: FIND-D-002

### FIND-D-015 — Severity: P3
- Journey: J-J
- Break step: copy 提交辅助路径
- Evidence: `startCopyRun` `if (await brief.isVisible({ timeout: 3_000 }))`。
- Merchant impact: 无（运营台）。仪器可把「没出 brief」当成功往下走。
- Fix contract: 与 Level-1 同一 settle：要么断言无 brief，要么必须点。
- Files: `v31-ops-console-release-journey.spec.ts`
- Tests: 去软 skip。
- Do not: 不要在商家路径复制这种 if。
- Depends on: 无

### FIND-D-016 — Severity: P2
- Journey: C17
- Break step: 部分失败之后「把剩下的做完」
- Evidence: spec 只到 partial report + 部分退款。无 resume 剩余页。台账未走查。
- Merchant impact: 做成一半不知道怎么只补失败镜/页、会不会再扣全款。
- Fix contract: 部分失败卡有「只做失败的」；不重扣已 settle 页。
- Files: `v31-partial-resume-assisted-journey.spec.ts`；Make resume
- Tests: fixture 锚可留，但必须点续跑并断言第二次 settle 增量。
- Do not: 不要整单重跑冒充续跑。
- Depends on: C4/C5 能跑到 partial

### FIND-D-017 — Severity: P2
- Journey: C6 UX
- Break step: 确认前看费用
- Evidence: V31-80 #6；V31-74 自称修了互斥，盘点仍见双行。
- Merchant impact: 「到底扣没扣」说不清。
- Fix contract: 未确认只「约消耗」；已预留只「已预留」；已结算只回执。三态互斥。
- Files: composer quote line / `resolveComposerQuoteUsageLine`
- Tests: 确认卡路径 interaction：两句不能同屏。
- Do not: 不要只改 copy lens。
- Depends on: FIND-D-006

### FIND-D-018 — Severity: P2（产品设计债，不是回归）
- Journey: J-A → 图文成品
- Break step: 引导卡之后
- Evidence: §2.2 成功形态假定已有项目和授权图。零素材店要：档案卡 + 上传 + 授权 + 挑选 + 再提交。每步 HEAD 可走，但主轴离开 Composer。
- Merchant impact: 「帮我发点奶油风美甲」不能一次说完。
- Fix contract: 引导卡内联上传/授权（不必先去素材页），或自由图文无 case_image 的明确降级配方（现仅文案降级）。
- Files: `recipe-source-slot-guidance-card.tsx`；intake / library picker
- Tests: 零素材图文：**不**要求一次提交出图；要求引导内完成挂源后再 202。禁止 seed。
- Do not: 不要放宽 Core `case_image` 门。
- Depends on: 产品拍板

### FIND-D-019 — Severity: P2
- Journey: J-D 带素材
- Break step: 有案例图之后的确认→成片
- Evidence: R2 C5 带素材被当时 C7 死锁挡住；此后 84/88 修了，**无新活体记录**。
- Merchant impact: 未知是否还能做片、部分失败是否退钱。
- Fix contract: 一条带真实挑选（非 seed）的视频 dogfood：报价 → 确认 → 成片或诚实失败+退款。
- Files: `v31-video-paid-execution-journey.spec.ts` 变体
- Tests: 无 seed 变体；可允许更长 timeout。
- Do not: 不要再断言字幕/封面面板存在。
- Depends on: FIND-D-005

## 4. Recommended walk order for a later live dogfood

只列，本轮未走。

1. 全新注册（可临时摘掉平台默认模型一次）→ 看 pill / banner / 自愈。
2. 零素材：选图文发送 → 引导卡 → 不扣分。
3. 选文案发送 → 数确认次数 → 交付 → 看有无内部词。
4. 门店「说一句」→ 档案卡一击保存 → 事实账本不用刷新。
5. 素材上传 → 授权 → Composer 库选 → 图文提交 202。
6. 确认制作 → 盯 pill 与是否出 job；超时前试 steering 一句。
7. 素材页撤回该图 → 再开始 → 应失败退款。
8. 视频：零素材引导；有图再走确认/成片。
9. 交付屏复制块 / ZIP / QR /「我已发布」；记第二天再打开。
10. 换号同 tab：B 看不见 A。
11. `/settings/account?section=credits` 空态与一单流水。
12. `/admin/ops-console` 只看，不在生产 promote。

## 5. Executable ticket pack

按商家漏斗，不按票号好看。

| ID | Title | Sev | Journey | First slice | Honest test |
|---|---|---|---|---|---|
| T-D-01 | Steering admitted-plan 键 + 中文错误 | P0 | J-G | 定性 taskId vs workflowId；商家面禁 raw message | `v31-mid-run-steering-journey` 走到 submit；负向无英文 |
| T-D-02 | Level-1 免确认对齐 §37.4-B | P1 | J-B | 拍板后去掉纯 copy 的「确认并开始」卡 | Level-1 happy path 零「确认并开始」 |
| T-D-03 | 悬死可见倒计时 + 立即退款按钮 | P1 | J-C/H | 不等 15min；composer 解锁 | 停滞夹具，禁 alreadyTerminal 假绿 |
| T-D-04 | 必跑旅程去 seed / 改走库选 | P1 | C–K,C16,C17 | V31-77 清单扩到 living-plan/video/publish | 静态契约红则门红 |
| T-D-05 | V31-80 展示层七项 | P1 | B/C/C16 | 内部词/裸 id/用量互斥 | 交付 e2e 禁 `ExecutionPlanSnapshot` |
| T-D-06 | 注册供给失败注入 e2e | P2 | 注册 | 补 V31-78 AC | 失败非全站 500 |
| T-D-07 | V31-76 remix + continue-item | P2 | J-A | 第二次 remix 覆盖 | 两 spec 全绿不 skip |
| T-D-08 | 撤权走真实按钮 | P2 | J-F | 替换 productCommand | rights spec 点 UI |
| T-D-09 | 次日自报浏览器编舞 | P2 | J-K | now 夹具打开工作台 | chips 可见并可落 OutcomeEvidence |
| T-D-10 | Thread 交付后续聊 + Idle 定目标 | P2 | I/C13 | 真 Work 再提交 | 同 thread 新 work |
| T-D-11 | 积分页空态 | P2 | C6 | 空表文案 | 新号 e2e |
| T-D-12 | 部分续跑按钮 | P2 | C17 | 只补失败页 | 第二次 settle 增量 |
| T-D-13 | 视频带素材无 seed 狗食 | P2 | J-D | 库选后成片或退款 | 新变体 spec |
| T-D-14 | 引导卡内联挂源 | P2 | J-A | 不离开 Composer 传/选图 | 零素材图文到 202 |
| T-D-15 | 收据隐藏 memoryId | P3 | C11 | 主文只留 preview | B2 可见文本无 uuid |

冻结纪律（retro R3）仍在：Day-0 门绿之前少开新功能。T-D-01/03/04/05 是收敛 C3/C4/C8 的最小包；T-D-02 要拍板。

## 6. Open questions / unproven

1. 本 HEAD 未活体。盘点活体 SHA 是 `0487afd9` / `1baf2074` / `97f534d0`。82/84/86/88 收口活体在更早 commit；**不能**写成「0a693408 主控刚走通」。
2. V31-82 浏览器 spec 在 fixture 下不可复现悬死——生成链「为何不建 job」在 live/direct 是否仍在，未知。
3. FIND-D-001 是规格冲突还是产品 bug，要主控在 D-043 vs §37.4-B 之间拍板。
4. Steering 是键空间错误还是 admission 未写完，修前必须答（V31-81 票面三问）。
5. `v31-context-fence` 全文件在 08-13 门轮被仪器打断，E 旅程无本树绿证。
6. note-path `get_usage` 15 vs ledger 30（rights spec 注释）——计量是否双单位，C6 未关。
7. 次日自报是否依赖 due-delivery 工人，仅打开 dashboard 会不会出 chips，未读 due worker 与 handoff 的接线。
8. `uiux-day0-contract` 仍在树里且自陈 demoted——会不会被误加回 required，属门治理。
9. CURRENT.md 仍写 Integration SHA `39ca4b39`，与本 HEAD `0a693408` 不一致；release 叙事不要混用。
10. 未跑 Playwright，不声称任何 spec 在本机绿。
