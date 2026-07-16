# Lane 4 · 开发流程与节奏诊断 — 是否陷入"代码复现空转 / 兜底与细节打磨过载"

> 日期：2026-07-14
> 维度：开发流程与节奏（力量投向、测试循环陷阱复现、流程层改法）
> 方法：git 全历史节奏统计 + recorded/真实通路接线核查 + 11 份 reviews 主题对照 + docs/evidence 与 .scratch 投入产出量化
> 铁律：每条发现带 file:line / commit hash / doc 路径锚点；区分「真跑」vs「recorded/mock 演示」vs「仅文档」。
> 状态：历史诊断快照；时间统计固定到报告原始终点，不能用作当前 HEAD 的提交计数。

---

## 第一段 · 现状实证

### 1.1 项目节奏骨架：8 天 80 commit，13 万+ 行

- 时间跨度：首 commit `0a4d837`（2026-07-07 23:03）→ 最新 `22a9d4e`（2026-07-14 21:45），**8 个自然日 80 个 commit**（`git log --oneline | wc -l` = 80）。
- 每日分布高度不均，明显是"评审驱动的集中爆发"而非匀速推进：
  | 日期 | commit 数 | 主题倾向 |
  |---|---:|---|
  | 07-07 | 1 | 决策快照 |
  | 07-08 | 4 | D1-D5 决策 + rev12/13 |
  | 07-10 | 4 | P0 workflows |
  | 07-11 | 4 | P1 平台 + revision plan |
  | **07-12** | **38** | **P1 落地 + UIUX cutover + 评审 remediation 爆发日** |
  | 07-13 | 11 | UIUX upgrade-B 票包 + Tailwind Plus 打磨 |
  | 07-14 | 18 | T1-T7 主题冲刺 + R2 验收 + 最后真实媒体 adapter |

  单日 38 commit（07-12）几乎全部是 P1 实现拆分 + UIUX cutover 分步 + review remediation，是典型的"仪式化分步提交"密度高峰。

### 1.2 力量投向：按主题分类的 commit 与代码量

commit 前缀分布（`git log --format=%s | awk -F: '{print $1}'`）：
- `feat` 24 · `docs` 23 · `fix` 17 · `test` 8 · `chore` 2 · 其余 6

按**实际投入的代码增量**归类（`git show --shortstat` 累加）：

| 类别 | insertions | deletions | 说明 |
|---|---:|---:|---|
| UIUX 打磨类（T1-T7 / polish / upgrade-b / cutover / wayfinding / seed / tailwind） | **75,999** | 14,654 | 反复重排、主题令牌、种子图接线、评分冲刺 |
| 真实产品能力 feat（媒体 adapter / 创作生命周期 / 工作台 / P0-P1 平台） | 118,512 | 9,474 | 但含 `d161449` P1 平台单 commit 87,544 行的一次性铺量 |
| docs 类 commit | 49,384 | — | 评审、对账、证据、票 brief |

> 注意：118K 的"产品 feat"被两个超大 commit 严重稀释——`d161449 feat: implement P1 content operations platform` 一次 **87,544 insertions / 301 files**，`222f14a feat: complete P0 beauty content workflows` **16,188 insertions**。剔除这两笔铺量后，"日常持续产品能力"投入与 UIUX 打磨投入基本 1:1，而 07-13/07-14 两天几乎完全被 UIUX（T1-T7、polish round 2、R2 评分）占据。

### 1.3 UIUX 反复打磨的具体轮次（R1/R2/T1-T7）

近 30 个 commit 里 UIUX 相关 23 个。可见的打磨轮次层层叠叠：
- **cutover 轮**：`2a79b0d` rebuild product shell → S1-S5 逐屏 evidence（`5d8fb70`/`302a00a`/`1dc0449`/`424cc38`/`fd622ea`）
- **deep-review remediation 轮**：`bc8f937` → `3ad57b5` → `74991fd`（三连 remediation）
- **upgrade-B 票包轮**：`a6e6b9f` 25 张 Codex 执笔票 + `daa9081` complete（427 files / 39,843 行）
- **Tailwind Plus polish round 2**：`96f939a` 快照 37 参考组件 → `84346aa` 14 包套用
- **T1-T7 主题冲刺**：`c49fa45`(T1 种子图) `9b36380`(T2 术语) `a68cd67`(T3 表面令牌) `3cb63e6`(T4 CTA) `4137b05`(T5 空状态) `e9ef172`(T6 密度) `8f6c8e0`(T7 补分)
- **两轮 Opus×9 评分验收**：`5452d86`（基线 3.83/10）→ `8d2edea`（R2 exit 6.50/10，仍低于 CreatOK 8.0）

单是"把设计评分从 3.83 抬到 6.50"就消耗了 07-14 一整天的 8 个 T 系列 commit + 两轮 9 屏 Opus 评分仪式。

### 1.4 测试/评审/对账仪式的体量

- **test 前缀 commit 8 个**，另有大量 `fix: remediate/reconcile` 混入。含 evidence/remediate/reconcile/consistency/audit 关键词的 commit 达 **21 个**（≈ 全部的 1/4）。
- **11 份 reviews**（`docs/reviews/`）：p1-deep-review-workflow（**147KB** 单文件）、uiux-productization-gap-report（63KB）、p1-code-quality-deep-review（24KB）、historical-review-implementation-reconciliation（24KB）+ 各自的 remediation/consistency 配套。
- **.scratch 累计 324 个工作文件**，其中 UIUX 相关（creatok-uiux-wayfinding 107 + uiux-upgrade-b 70 + creatok-uiux-implementation 7 + uiux-gap-report-sections 10）= **194 个**，占 60%；产品链路相关（model-supply-wayfinding 51 + p1-implementation 37 + p1-wayfinding 39）= 127 个。**UIUX 过程稿量约为产品链路过程稿的 1.5 倍。**
- docs/evidence 下 5 个子域证据包（p0-release / p1-implementation / browser-dogfood / uiux-cutover / uiux-upgrade-b），S1-S5 每步都配一份 evidence md。

### 1.5 真实 provider 通路 vs recorded 兜底：接线实证

这是判断"是否空转"的核心。逐层核查：

**(a) 默认全系兜底。** 系统开箱默认值：
- LLM：`MODEL_EXECUTION_MODE ?? 'recorded'`（`runtime-config.ts:376`）
- 媒体：`MODEL_MEDIA_EXECUTION_MODE ?? 'disabled'`（`runtime-config.ts:368`）
- 即：不显式配置真实密钥时，**文案走 recorded 固定内容，图片/视频完全关闭**。

**(b) 真实 LLM 通路存在且真发 HTTP，但接线门槛极高。** `ai-sdk-runner.ts:67` 用 `createOpenAICompatible` + `generateObject`(:79) / `streamText`(:118) 真实调用。但主进程装配条件是（`main.ts:141-145`）：
```
mode === 'fixture' ? FixtureRunner
: activation === 'live_verified' && direct ? OpenAiCompatibleAiSdkRunner
: undefined
```
而 `activation: 'live_verified'` 仅当环境提供 `MODEL_DIRECT_ACTIVATION_EVIDENCE_REF`+`VERIFIED_AT` 等激活证据时才置位（`runtime-config.ts:92-94`）。默认无证据 → runner = `undefined` → 真实 LLM 不接线。

**(c) 媒体真实通路（Ark 火山方舟）代码在最后一天才落地，且未验证。** `ark-media-adapter.ts` 888 行真发 HTTPS（`:461`/`:504` `method:'POST'`，`:869` 强制 https），但：
- 该文件由**最后一个 commit `22a9d4e`（07-14 21:45）**才加入，是整个项目时间线的终点。
- 装配同样条件化：`mediaMode === 'ark'` 才构造（`runtime-config.ts:34`），默认 disabled。
- `.env.example:39` `MODEL_MEDIA_EXECUTION_MODE=disabled` 是默认交付态。

**(d) 发布/导出通路只有 recorded 单实现。** `job-worker.ts:199` 硬接 `new RecordedDouyinAdapter()`，`:283` 硬接 `new RecordedCanvasExportAdapter()`。全仓 `douyin.ts`（120 行）只有 `RecordedDouyinAdapter` 一个类、**零 fetch/http**（`grep -c fetch\(|http` = 0）；`operations/adapters.ts:304` `RecordedCanvasExportAdapter` 同理。真实抖音发布、真实画布导出**无任何真实实现**。

**(e) 交付证据自陈全线 recorded。** `docs/evidence/p1-implementation-evidence-2026-07-11.md:3` 状态明写 `implemented-recorded`；模块 01-17 **全部标注 `implemented-recorded`**（:18-34）。P0 证据 `p0-release-evidence.md:17` 明写 "31 pass, **1 live-provider smoke skipped**"，:36 "live Ark smoke remains **opt-in** because it spends provider quota"。

**(f) 7-14 对账文档已独立确认这一断链。** `historical-review-implementation-reconciliation-2026-07-14.md:41`：
> "**真实图片/视频供应商执行一直未接入 P1 统一运行时**：当前 `direct` 只装配真实 LLM；图片/视频仍是 recorded/fixture media。ffmpeg 能合成输入片段，不等于用户能生成真实 AI 图片/视频。"

同文档 :91/:96/:98 逐项标注 P0-1 token 流式、P0-6 长任务、P1-1 AI SDK 选型全部"部分实现 / **live-provider 仍未验证**"。

---

## 第二段 · 缺陷清单（带严重度）

### P0-A｜真实商家可用性零推进：全链路无一条 live-provider 端到端跑通证据
- **证据**：`p0-release-evidence.md:17`（1 live smoke **skipped**）；`p1-implementation-evidence-2026-07-11.md:3,18-34`（01-17 全 `implemented-recorded`）；`historical-review-implementation-reconciliation-2026-07-14.md:41`（图片/视频真实供应商未接入统一运行时）；Ark 真实媒体 adapter 直到终点 commit `22a9d4e` 才落地且默认 disabled、未验证。
- **判定**：这是"绿测/评分达标但真跑为 0"的**同构病症确凿复现**。8 天里产出了 recorded 契约、fixture 走测、UIUX 6.50 分、S1-S5 证据包——**没有一份证据显示真实商家用真实模型跑通过一条"门店档案→选题→图文/视频→适配→确认→入库"链路**。用户 MEMORY 记录的闲鱼"214/214 测试全绿但业务真跑为 0"在此项目为"recorded 全绿 + UIUX 6.50 + 证据包齐全，真实商家可用性 = 0"。
- **严重度 P0**。

### P0-B｜开发力量结构性倾斜到 UIUX 反复打磨，真实产品能力接线滞后到时间线末端
- **证据**：07-13/07-14 两天 29 commit 里 23 个是 UIUX（T1-T7 + polish + R2 评分）；`.scratch` UIUX 过程稿 194 个 vs 产品链路 127 个（1.5:1）；真实媒体 provider（`ark-media-adapter.ts`）在**最后一个 commit** 才出现；真实 LLM 接线默认 undefined（`main.ts:145`）。UIUX 打磨代码量 76K 行，与剔除两笔铺量后的日常产品投入基本持平甚至反超。
- **判定**："老在打磨没必要的细节功能（表面令牌 T3、CTA 层级 T4、空状态温度 T5、密度 T6、补分 T7、Tailwind Plus 套壳），真正的产品适用功能（真实模型出图出片、真实入库、真实发布）迟迟不出现"——**成立**。把设计分从 3.83 抬到 6.50 花掉一整天 8 个 commit + 两轮 Opus×9 评分，而"用户能否用真模型生成一张真图"直到最后仍是 disabled。
- **严重度 P0**。

### P1-C｜"完成"定义把真实商家价值解耦，制度化地掩护了空转风险
- **证据**：`CONTEXT.md:20`（P1 功能完成 = every must-have implemented + Gate passes；"Real merchant counts, retention, time savings... **do not block this state**"）；`CONTEXT.md:113` `模型供应 P1 闭环` 的 `_Avoid_`：明写"**用真实供应账号未就绪拆掉产品闭环**"（即"真实账号没接也算闭环完成"是被写进决策的）。
- **张力**：`p1-deep-review-workflow-2026-07-11.md:144-150` 已有 finding 精准指出"n=0 真实商户下授权 32 张全量 build 撞闲鱼陷阱"，并建议"done 反转为真实商户端到端跑通"；但同文档 :160/:170/:199 的评审反驳用"CONTEXT 已诚实声明功能完成≠已验证 + Gate 要求付费 Beta"把该建议**判为 WEAKENED 驳回**。结果是：诚实的声明（"我知道没验证"）被用来**豁免**"必须有一条真跑"的 Gate，风险被制度化接受而非消除。
- **判定**：这不是无意识空转，是**被决策层显式批准的空转**——但批准的理由（"付费 Beta Gate 会兜底"）依赖一个至今 n=0、未触发的未来事件。`.scratch/product-value-deep-review-2026-07-14/REVIEW-NOTES.md` 第 7 条用户最新拍板已开始纠偏："不再做过细 A/B 分段和不可评审过程稿……一次性交付一个可真实使用、可完整评审的单店产品；不把半成品当阶段性交付"——用户本人已察觉并开始收口。
- **严重度 P1**（有决策依据、已启动纠偏，但根因未除）。

### P1-D｜评审/对账/证据仪式自身成为一条平行的重工作量流
- **证据**：11 份 reviews（含 147KB 的 p1-deep-review 单文件）+ 每份配 remediation/consistency；S1-S5 每步一份 evidence md；21/80 commit 含 evidence/reconcile/audit；两轮 Opus×9 评分 + benchmark 验收报告。docs 类 commit 净增 49K 行。
- **判定**：评审密度已超出"发现问题"的边际收益，进入"评审驱动 remediation、remediation 再触发对账、对账再产出新 review"的自循环。`historical-review...2026-07-14.md` 与 `references-docs-uiux-unfinished-upgrade-reconciliation-2026-07-14.md` 同日两份对账，本质是给前面 11 份 review 之间的口径打架做仲裁——**元评审**。这类仪式消耗真实工时但不推进 L2。
- **严重度 P1**。

### P2-E｜过报/口径漂移的零星痕迹（诚信小瑕，非系统性造假）
- **证据**：`historical-review-implementation-reconciliation-2026-07-14.md:85` 抓到 R2 Exit 报告称"40 张种子图入位"，实际 `t1-wiring.md` 记录"30 已接、10 未接"；upgrade-B `MAP.md` 顶部标"implementation complete"但机器真相是 25 票只关 01-03、04-25 仍 open（同文档 :83）；dogfood ISSUE-002（fixture 全模型不可用、提交永久禁用）虽已由 `29a0534` 修复，但暴露过"仓库声明的走测模式与 E2E 合同自相矛盾"。
- **判定**：单点过报会被后续对账抓回，说明诚信基线尚在；但"报告数字比代码乐观"的漂移倾向存在，且需要额外对账工时去纠。
- **严重度 P2**。

---

## 第三段 · 阶段判定

**本维度阶段判定：L1（核心链路 recorded/fixture 可演示）已达成并被过度加固；L2（真实商家端到端可用）零证据、未跨越。**

裁定依据：
- **L0 脚手架** ✅ 双 runtime workspace（`9f2e670`）、pg-boss/graphile 双队列、契约齐全。
- **L1 demo/recorded** ✅✅（**超额**）：recorded 契约覆盖 17 模块、fixture 走测链路打通（`29a0534`）、UIUX 从 3.83 打磨到 6.50、S1-S5 证据包、25 张 UIUX 票。这一层被投入了远超必要的资源。
- **L2 真实可用** ❌：无一条 live-provider 跑通；真实 LLM 默认不接线（`main.ts:145` undefined）；真实媒体最后一天才落地且 disabled 未验证；真实发布/导出零实现（`RecordedDouyinAdapter`/`RecordedCanvasExportAdapter` 单实现）。**判为未进入 L2。**
- **L3 易用** ❌：无从谈起（L2 未过）。

**流程病灶定性**：项目**停在"L1 精装修"阶段空转**——把本该用于跨越 L1→L2（接通真实模型、拿到第一条真实商家跑通）的力量，大量投入到 L1 内部的 UIUX 评分打磨、recorded 契约完备性、评审对账仪式上。这是用户 MEMORY 里闲鱼"测试循环陷阱"与 creator-agent"ship-readiness 假绿"的**第三次同构复发**，且本次因 `CONTEXT.md:20/113` 的决策措辞而被**半制度化豁免**。所幸 `product-value-deep-review-2026-07-14/REVIEW-NOTES.md` 显示用户已在最新拍板中亲自启动收口。

---

## 第四段 · 增量建议（流程层改法）

### 改法 1【立即】把 done 硬钉在"一条真实跑通"，废止 recorded 达标即完成
- 在 `CONTEXT.md` 的"P1 功能完成"定义里加一条**硬 Gate**：至少一条 must-have 旅程（门店档案→选题→图文 **或** 视频→三平台适配→确认→入库）用**真实 provider（direct LLM + Ark 媒体）端到端跑通并留证**，否则不得声明"功能完成"。这正是 `p1-deep-review:150` 被驳回的那条建议——本维度证据表明它当初不该被 WEAKENED。
- 对应删除/降级 `CONTEXT.md:113` 的 `_Avoid_: 用真实供应账号未就绪拆掉产品闭环` 措辞对"完成"的豁免效力：真实账号未就绪时，状态是"未完成/待激活"，不是"闭环完成"。

### 改法 2【立即】下一阶段力量 100% 投向 L1→L2 跨越，冻结 UIUX 打磨
- **砍掉的仪式**：停止第三轮 UIUX 评分冲刺（6.50→8.0 的追分）、停止新增主题令牌/密度/CTA 的微调 commit、停止 S 系列逐步 evidence md、停止元评审对账（两份同日 reconciliation 已够）。UIUX 6.50 分对"商家能否用"零影响，把它冻结在当前水位。
- **投入的方向**（按依赖序）：
  1. 用一个真实火山方舟账号，把 `MODEL_DIRECT_*` 与 `MODEL_MEDIA_EXECUTION_MODE=ark` 真实配起来，跑通 `ai-sdk-runner` 生成真实文案候选 + `ark-media-adapter` 生成真实图/片，**留一份真 live 证据**（替换掉 `p0-release-evidence.md:17` 那条 skipped）。
  2. 给 `RecordedDouyinAdapter`/`RecordedCanvasExportAdapter` 至少补一条真实导出/发布通路（哪怕先只做本地导出，不做抖音 OAuth）。
  3. 拉 1-2 家真实门店，用真数据真授权素材跑完整链路，记录"前置资料齐→第一条可用内容"是否真在 5 分钟内（`REVIEW-NOTES.md` 第 4 条的历史铁律）。

### 改法 3【机制】给评审设"熔断阈值"，防止评审自循环
- 规则：一个模块的 review→remediation→re-review 循环**最多两轮**；第三轮触发时，强制升级为"要么真跑验证、要么明确标 open 并冻结"，不再产出新 review 文档。当前 11 份 review + 多份 remediation + 两份元对账已越过健康阈值。
- 每份新 review 开头强制声明"本轮结论能否被一条真实运行证据证伪"；不能被真实运行证伪的纯文档口径之争（如 `p1-deep-review` 里 finding 与反驳的拉锯）不再单独立文档。

### 改法 4【度量】用"真实跑通链路数"替代"评分/绿测数"作为北极星
- 当前仪表盘事实上以"设计评分（6.50/10）、测试通过数（31 pass）、票关闭数、evidence 包数"为进度信号——**全是 L1 内部指标**。
- 换成单一北极星：**真实商家用真实模型跑通的完整链路数**（当前 = 0）。在这个数从 0 变 1 之前，任何 UIUX/评审/recorded 完备性的推进都不计入产品进度。这与用户 `REVIEW-NOTES.md` 第 7 条"一次性交付可真实使用、可完整评审的单店产品"的最新拍板一致。

---

*诊断完毕。核心一句话：项目把 L1 精装修到 6.50 分并用 11 份评审反复加固，却在真实模型接线上停到时间线最后一天且默认 disabled——这是闲鱼式"测试循环陷阱"的第三次复发，且被 CONTEXT 措辞半制度化豁免；下一阶段唯一该做的是冻结 UIUX、把 done 钉死在"一条真实商家跑通"。*
