# V3.1 能力账本（Capability Ledger）

> **自 2026-08-13 起，本账本是唯一工作队列权威**（用户拍板，承接
> `docs/reviews/v31-batch-retrospective-2026-08-13.md` 的能力驱动改约）。
> `docs/tickets/v3.1/` 的票列表自此**不再是 backlog**——票只作为能力路径上的差距记账。
> 状态四态：**可用**（真浏览器走查绿）／**降级可用**（部分走通或仅 fixture 档验证）／
> **不可用**（走查确认死路或核心断裂）／**未走查**（只有 e2e/单测背书，从未被人走过——
> 诚实态，不得写成可用）。
> 更新纪律：每条能力 lane 收敛完成（旅程 spec 无掩码进门＋required CI 绿＋主控走查留痕）
> 后更新本表；不按票关闭更新。

## 0. 现状快照（2026-08-13 晚更新：盘点第一轮回写，证据=`docs/reviews/capability-baseline-audit-2026-08-13.md`）

走查代码树 `0487afd9`。17 条能力：可用 1、降级可用 3（C2/C3/C11）、**不可用 3（C4/C8＋注册链 V31-78 P0）**、疑不可用 1（C5）、未走查 9。
第一轮最大发现不在能力面而在环境面：**launchd 假 Core（54330 库）占 4100 多日，全部「dev 亲验」的数据面证据被拉低效力**；「积分泄漏」撤案（读错库）。
新开整改票：V31-78（P0 注册砖号）、V31-79（dev 环境单一真相）、V31-80（展示层二波）、V31-81（steering 断裂）、V31-82（图文悬死+钱无出口）。
**盘点第二轮回写（08-13 晚，报告=`docs/reviews/capability-baseline-audit-r2-2026-08-13.md`）**：两轮汇总四态=可用 1（C15）、降级 6（C2/C3/C10/C11/C14/C16）、不可用 5（C4/C5/C7/C8）、未走查/被挡 5；新 P0=V31-83（跨账号 sessionStorage 泄漏）、V31-84（五步录入双断点→档案/素材/配方链式死锁）；V31-85（视频 fallback 假出口）；**不可用共因三根：档案确认链（84）＋配方 slot（85/73）＋悬死无终态（82）**。

**双 P0 收口回写（08-13 深夜）**：V31-83（跨账号泄漏）、V31-84（档案确认链）均
implementation-complete＋主控活体走查证毕——档案链全确认路径通（说一句→提取回填→
逐条点头→finalize 200→7 事实落库→档案/门店信息投影→素材上传过门→授权成功）。
共因根一（档案确认链）拔除；走查揭出三张新票：**V31-86**（Day-0 跳过兜底路径与
Core 双门合同矛盾，07-27 W01 加固后即死，待设计拍板 A/B）、**V31-87**（同内容跨面
重传幂等 409 砖）、**V31-88**（素材库已授权资产无 composer 挂源入口——配方提交段
的真实断点，与 slot 根 85/73 相邻但独立）。余二根（配方 slot 85、悬死无终态 82）
为下一波派工对象。

**三 lane 共因根收官（08-13 深夜，main=97f534d0 未 push）**：V31-86（Day-0 档案卡＋门 2
有界豁免）、V31-85/88（视频假出口→诚实引导＋素材库挂源）、V31-82（悬死有界终态＋退款＋
解锁）三票全部 implementation-complete 并活体证毕。**Day-0 全链首次跑通**：注册→说一句→
档案卡一击保存 200→素材上传过门→授权→composer 从素材库挑选→slot 满足→提交 **202**。
三根共因全部拔除（档案链 84/86、配方 slot 85/88、悬死无终态 82）。新开 V31-89（说一句的
LLM 提取接线——用户要的「智能那一半」，capture 域不可复用故另立）。

**素材链与 Day-0 智能化补齐（08-13 深夜二波，main=7e6876ac 未 push）**：V31-87（重传幂等砖）
＋V31-89（口语 LLM 提取）双 lane 收口。87=键改「内容 hash＋事实指纹」、Core 同 objectKey
复用改走元数据更新、失败分层（不可重试给出口指向素材库挑选）；主控追加撤权传播补 add_asset
复用分支＋补登记四条漏登记 spec（quality-gates 门在 main 上原本是红的，现 14/14 绿）。
89=新 `extract_store_sentence` command＋fixture canned，异步只填空不覆盖、失败不阻断；
主控追加修 district 脏值（「开在成都高新区」整段带动词入档）。**活体证毕**：纯口语句
（正则抓不到）→ 档案卡自动填名称/城市/行业并标 AI 推测 → 一击保存 200 → facts/profile/
provenance 三面正确。用户二轮拍板的「智能那一半」到位。
**08-13 晚补：V31-78/V31-79 已实现合入 main=1baf2074**（双 grok lane＋主控收口：终态化/降级转发/退避/提示 banner；boot 拦截/平台默认模型 seed/端口与 profile 断言/自包含 dev:smoke），两取证砖号活库自愈实证；余 required CI 与 plist 处置。

## 1. 能力清单（商家视角）

| # | 能力（商家可以…） | 规格锚 | 旅程 spec | 状态（HEAD `0a693408` + D1–D7） | 差距票（open/partial/red） |
|---|---|---|---|---|---|
| C1 | 零素材首访不撞死路、不被劝退、不扣分（图文给诚实引导） | §37.4-A＋retro R1＋**D2=A** | `v31-zero-source-image-text-first-visit`（引导腿，无 seed）＋`uiux-creation-loop`＋`dashboard-home-mount` | **降级可用**：引导/双出口/不扣分在。**不是可用**。禁止用 day-0 1/1 宣称 C1 可用。成品不在本能力 | V31-76；V31-78 残 e2e |
| C2 | 免费自由创作；承接「第一条可发布成品」 | §37.4-A＋**D2=A** | `v31-day0-free-creation-journey` | **降级可用**：fixture 可交付通用文案；live 未走；事实卡待 D1 落地 | required CI；新号不传图出通用文案 |
| C3 | Level 1 纯 copy 免确认直达（报价常显、余额不足双出口） | §37.4-B＋**D1=A** | `v31-level1-copy-journey` | **降级可用**：执行确认+事实卡对纯 copy 都禁（D1）；泄漏/实现债仍在 | V31-80；EXEC-01/02 |
| C4 | 定制图文全链（检索→只问一个问题→Living Plan→确认→逐页生成→交付） | §37.4-C | `v31-living-plan-journey` | **降级可用**（非可用）：admission/超时退款在；做成未同 SHA 绿。**D6=A**：82 浏览器 spec 先出门 | V31-82 仪器；V31-56；V31-28/63 RVP |
| C5 | 视频付费执行（时长/积分透明、中断恢复、部分失败不吞钱） | §37.4-D | `v31-video-paid-execution-journey` | **降级可用**：零素材诚实引导；带素材未走 | V31-36、V31-37 |
| C6 | 计费可信（报价=扣分、失败退回、不重复扣、余额对得上账） | §37.4-B/E＋§43 硬门①③ | `v31-context-fence-journey`＋结算链单测 | **降级可用**：健康链对；82 退款 live；旁路/空表/派生 revision 仍开 | V31-41、V31-45、V31-59、V31-55、V31-31 |
| C7 | 素材授权与撤权（撤权后 fail closed、可换素材、不重复扣费） | §37.4-F＋**D7=A** | `v31-rights-revocation-journey` | **降级可用**：上传授权挂源通；撤权未走真实 UI；门内禁 seed | 撤权走查；V31-58 |
| C8 | 生成中途改要求（steering：改两页其余不动；加页进 replan+requote) | §37.4-G | `v31-mid-run-steering-journey` | **不可用**：英文裸错。D3=A 只许 03a 中文护栏，03b 键对齐仍冻 | V31-81、V31-27 |
| C9 | 中断/恢复（关标签页回来不丢、过期退分、重复恢复幂等） | §37.4-H＋§43 门③④ | `v31-interrupt-resume-journey` | **降级可用**：悬死有界终态在；健康 interrupt 未走 | V31-82 仪器；V31-57 |
| C10 | Thread 连续创作（交付后继续同一会话产生新 Work、刷新不丢上下文） | §37.4-I | `v31-thread-root-workbench` | **降级可用**：换号泄漏已修；交付后续聊会断 Thread | EXEC-04 |
| C11 | 记忆注入透明（看注入清单、追溯来源、撤销后不再注入） | §37.4-B2 | `v31-memory-injection-b2-journey` | **降级可用** | V31-18 AC4；V31-34 |
| C12 | 发布交接与自报（交付→手机交接→次日追问→一键自报落 OutcomeEvidence） | §37.4-K | `v31-publish-handoff-selfreport` | **未走查**（入口在；次日 ask 被内存 ref 挡） | EXEC-05 |
| C13 | 目标与主动建议（MarketingGoal＋evidence 门控的 proactive） | §37.4 goal/proactive | `v31-goal-proactive-idle` | **降级可用** | 冻结后 |
| C14 | 运营控制面（Release/canary/rollback/kill switch，商家侧无感） | §37.4-J | `v31-ops-console-release-journey` | **降级可用** | 勿在冻结期做生产动作 |
| C15 | Admin 后台治理（敏感词、角色、运维健康） | admin 整备波 9 spec | admin 系列 spec | **可用** | V31-71、V31-44 |
| C16 | 成品原位生长（Artifact 流式落位、stable ID、无重复对象） | §37.4 artifact | `v31-artifact-growth-journey` | **降级可用**（标题泄漏） | V31-80 |
| C17 | 部分交付续跑（partial delivery 后 assisted 续跑不重扣） | V31-16 范围 | `v31-partial-resume-assisted-journey` | **未走查** | 等 C4/C5 |

> **2026-08-13 回写（EXEC-00a）**：Integration SHA＝`0a693408`。决策 D1–D7 见 `docs/reviews/v31-agent-team-product-deep-review-2026-08-13.md`「已拍板决策」。C1/C4 **不得**标可用。V31-50 从「顺手收」升为仪器，见 §2。

**全局性核销**：大量票状态为 evidence-debt / release-verification-pending（V31-01…25 底座与近期修复），
统一由清红队列①（候选 PR＋同 SHA `Core quality / required` 绿）核销，不逐条列入差距票。

## 2. 仪器与平台（enabler，不是能力但排队优先于能力）

- **仪器（门与测试可信度）**：V31-77（门升格，兼 C1）、V31-29（AC6 required 实跑）、V31-64／V31-70／V31-72（门存活与 CI-only 红，余 CI）、V31-30、V31-39、V31-43、V31-48、V31-49（62 spec 不在门内的治理）、V31-66、V31-67、**V31-79（dev 环境单一真相：launchd 假 Core／dev 档起不来／平台默认模型供给／进程卫生断言——盘点 R1 头号环境雷）**。
- **平台稳定性**：**V31-50（仪器 P0：SSR postgres.js `socket.on('error')` 必须请求级失败，不得杀进程——影响一切走查）**、V31-69（bundle，余 CI）、V31-46、V31-33（AC4 残项）、V31-32。

## 3. Parked（不在任何能力路径上，不进工作队列）

- V31-35：已废止（2026-08-11 拍板）。
- V31-42：不可达分支，随 V31-03 晋升决策一并处理（票面自建议）。
- V31-32／V31-46／V31-33 残项：平台卫生，无商家可感知路径；某条能力 lane 触及其文件时顺手收，否则不动。
- **V31-50 已移出 parked**，升 §2 仪器 P0。

## 4. 盘点计划（第二步，只定性不修）——**第一轮已完成（2026-08-13，C1/C3/C4/C6/C8/C12/C16＋环境定性，报告见 reviews）；第二轮待排：C5/C7/C9/C10/C11/C13/C14/C15/C17，环境配方已固化（报告 §2.6）**

每条「未走查/疑不可用」能力一次真实走查：fixture 档真浏览器走全程；C5／C6 加
`dev:all` 真链路抽查（计费与生成是两处 fixture 掩码重灾区）。产出=每条能力的
四态定性＋死点截图/网络证据，回写本表 §1。预估一天。**盘点期间冻结令（CURRENT §3a）
继续有效，途中发现的问题只记账不修。**

## 5. 收敛顺序（第三步，按商家价值，一条到门绿再下一条）

C1（在途）→ C2/C3（免费线）→ C6（钱）→ C4（付费图文）→ C5（视频）→ C7 → C9/C10 →
C12 → C8 → C11 → C13 → C14 → C17（C15/C16 已达标线，只随 CI 核销）。
每条 lane 的完成判据：旅程 spec 无掩码进必跑门＋required CI 绿＋主控真浏览器走查留痕回写本表。

## 6. V31-77 门升格＋门第一次真跑（2026-08-13 晚，commit `d97c9b09`，未 push）

**仪器**：day-0 零素材首访升格为门内 fail-fast 首位（**必须独立先跑**——Playwright 按文件
路径序走，不按命令行顺序，本轮实证目录首位是 day-0 而实际先跑的是 v31-82）；红则整门停在
第一段并按 V31-64 形制写 `DAY-0 RELEASE GATE RED … remaining 23 specs NOT evaluated` 判决书；
day-0 类 spec 禁用 `seedComposerInlineAuthorize` 升级为常驻静态契约（进 required）。两项均有真跑变异反证。

**门第一次真跑（42 test：8 绿 / 5 红 / 28 未跑）**：28 未跑＋context-fence 中断＝仪器债
（workerd 12:23:13 断连），5 条红发生在仪器死亡之前、是真红，且全是当日合入只做过 `--list` 的新 spec。
定性＝**4 条 spec 说谎、1 条产品真缺陷**，逐条与修法见 V31-77 票面表格；判决书原文＋三服务存活表＋五轮复跑留档在 `docs/reviews/v31-77-gate-verdicts-2026-08-13.md`。

**能力状态变化**：
- **C1（Day-0 首访到成品）**：day-0 门 spec 真跑 **1 passed（49.3s）**；day-0＋84/86/87/88 合跑 **5 passed**。
  C1 的门级证据首次成立（此前只有主控手工走查）。
- **C3（门店档案/事实账本）**：修出真缺陷——门店页把 `store_facts_active` 的 `at` 钉死在挂载时刻，
  而 Day-0 保存就发生在本页，写入的事实全在钉之后 ⇒ 商家看到「档案已确认」但下方事实账本一直空到刷新。
  已随 store revision 重钉；spec 现钉住 5 条事实（店名/城市/行业/项目/价格）且平台兜底值不得进账本。
- **C4（付费图文执行）**：V31-82 的浏览器 spec **故意留红**——fixture 档下 run 答完方向就跑完，
  没有悬死可推进；加重试会从 `alreadyTerminal`（跑成功）拿到假绿。需新仪器票（答方向前从服务端取
  workId ＋ 把 run 摁在无 job 态）。V31-82 产品修复本身仍由 unit/PG＋活体背书。

**新增仪器债（待开票）**：①V31-82 浏览器可复现性仪器（上条）；②web 单测 main 上 2 条存量红
（`composer-home.tsx` currentQuoteView 契约、`p2-browser-closure.spec.ts` #323 契约），本轮未触及其文件；
③门在 workerd 断连后无自动重启，一次仪器抖动就废掉整轮 28 条证据。
