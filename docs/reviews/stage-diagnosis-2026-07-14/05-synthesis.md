# 阶段性回头诊断 · 最终合成判定

> 控制器（主会话）跨维度合成，基于四路 Fable 5 并发诊断（Run `wf_823f273f-82a`）+ 亲自复核四份落盘报告 + 核验关键锚点。
> 日期：2026-07-14 ｜ HEAD：`22a9d4e`
> 状态：历史诊断快照；当前代码与决策以仓库 HEAD 和 07-decision-log.md 为准。
> 四路原始报告：`lane-1-tech-stack.md` / `lane-2-frontend-reality.md` / `lane-3-competitor-gap.md` / `lane-4-dev-process.md`
> **2026-07-14 融合**：并入 Codex 深度评审 `.scratch/product-value-deep-review-2026-07-14/FINAL-REVIEW.md`（控制器逐条核实锚点后融合，见 §六）。四路=病理诊断（在哪/为何），Codex=处方架构（往哪走的 ContentPackage 唯一成品）——互补，不重复。

---

## 零、一句话总判定

> **产品当前真实阶段 = L1 已达成且被过度加固，L2 零证据、未跨越。** 四路独立诊断从技术栈、前端、竞品、流程四个切面得出**同一个**病症：把"演示壳"打磨到了以假乱真的 L3 保真度，而"真实商家用真实模型端到端跑通一次"的数字**至今为 0**。这不是四个问题，是一个病症的四个投影。
>
> **Codex 评审独立复现同一总判（产品面世 NO-GO），并往下挖出病症的结构性病灶：不是"后端没做完"，而是"成品事实没统一 + AI 上下文没贯穿 + 真实素材没进媒体 + 结果没变成三平台可编辑资产"。其处方 = 一个用户可见的唯一聚合 ContentPackage 收束图文/视频/三平台/编辑/版本/内容库/导出/复用/撤权。**

统一标尺回顾：L0 脚手架能跑 / L1 recorded·fixture 能演示 / **L2 真实商家可端到端用（真模型真数据真产出无致命兜底）** / L3 商家易用。产品目标「商家可用且易用」= 必须先站上 L2。

---

## 一、四路阶段判定收敛表

| 维度 | 判定 | 最刺眼证据（锚点） |
|---|---|---|
| **技术栈本体** | **L2-就绪** | AI SDK v7 / pg-boss / Postgres / sharp 选型合理、与 ADR 自洽、无自写 framework——**仓库最扎实的一层，不是短板** |
| **技术栈执行面** | **L1→L2 过渡** | 无一条真实供应商调用在 CI 内被证明过；`live_verified` 由 3 个环境变量的 sha256 哈希伪装（`runtime-config.ts:91-94`），只证"配置没变"非"真调通" |
| **前端界面/接线** | **L2-就绪** | 45 视图系统性接线，07-13 差距报告的前端 P0 群（流式/缩略图/i18n/视频/⌘K）在 HEAD 上**已被真实修复**——纯"代码复现"判断已过时 |
| **前端真实体验** | **L1-演示壳** | 默认开箱 100% fixture 假流（`ai-sdk-runner.ts:308-315` 写死 6 段定时吐字）+ 43 张 seed 装饰图（`canonical-history-page.tsx:126-147` aria-hidden 假装资产满墙），**无一处真实生成产物** |
| **竞品功能对标** | **L1（约 80% 覆盖）** | 首页工作流/账本/异步任务/L3 包/单体架构全部有代码落地 |
| **竞品闭环对标** | **未进 L2** | accepted 内容进不了一级库（`application-service.ts:5638` 只写 `creativeContents`，前端读 `content.tsx:100` 的 `state.contents`）；真实媒体/抖音/BYOK 未激活 |
| **开发流程** | **L1 精装修空转** | 8 天 80 commit，07-13/14 两天 29 commit 里 23 个是 UIUX；真实媒体 provider 拖到**最后一个 commit** 才落地且默认 disabled |

**综合：产品站在 L1 顶端，向 L2 的门槛前止步。距离 L2 只差"最后一公里"，但这一公里恰恰是产品价值的全部所在。**

---

## 二、逐条回答你的三个问题

### Q1 · 技术栈是否合理？兜底与打磨 vs 真能力？

**（a）技术栈选型：合理，且是仓库最扎实的一层。** 后端 Node22 + AI SDK v7 + pg-boss + Postgres + sharp + Ark，前端 TanStack Start + Better Auth，全部与 ADR-0002/0006/0007/0008 自洽，没有引入未经论证的自写 framework。这一层**不用返工**。

**（b）配套开发方案没有按预期进行——"无效兜底"确实严重且有量化证据：**
- 236 处 recorded（`adapters.ts`）；157 行 `BifrostLiteLlmComparison.report()` 是静态文档冒充 gateway PoC 证据（`adapters.ts:1514-1671`，零真实网关请求）
- 682 行 graphile-worker 是休眠死代码（"双队列"不成立，pg-boss 才是唯一生产队列）
- 两套 Ark 视频真实实现并存（旧栈 `video/ark-provider.ts` 已孤立）
- 前端 43 张 seed 装饰图 + fixture 定时器假流撑起全部"成品视觉"
- **过度打磨的兜底保真度**：用真 ffmpeg 合成 1 秒**假** mp4（`createRecordedH264Video`）、为 recorded 媒体写数百行供应商生命周期模拟（错误码/冷却/AES 任务引用/late-terminal 对账）——给一个"背后没有真实供应商"的适配器做了生产级保真

**（c）"老在打磨没必要的细节功能，真正的产品功能迟迟不出现" = 成立。** 铁证：T1-T7 **七轮** token/密度/CTA 微调把设计评分从 3.83 抬到 6.50（花掉 07-14 一整天 8 个 commit + 两轮 Opus×9 评分仪式），而"商家能否用真模型生成一张真图"直到最后一个 commit 仍是 `disabled`。

**（d）"停留在代码复现阶段"——需要精确修正：** 前端已经**越过**了纯代码复现（组件全接线了），但停在一个更隐蔽的位置——**"演示壳做到了以假乱真的 L3 保真度，但真实商家从未端到端用过一次"**。这比代码复现更危险，因为它让"看起来完成"与"真实接通"的悬崖藏在了商家看不见的地方。

### Q2 · 竞品对标为何落不到自己产品身上？路径/资源/时间？

**明确归因：开发路径问题（命中 9 项未落地/半落项中的 6 项），不是资源、不是时间。**

- **证伪"资源不足"**：411+234 测试全绿、72 组件、Codex+Opus×25 对抗校验、假 mp4 都修了——需要真功夫的部分都落了，资源是**饱和**的（与你既定"饱和开发资源、拒绝残缺 MVP"一致）。
- **证伪"时间不足"**：图文套图管线、资产生命周期、Agent Skills 外部——这些是 ADR-0008/范围决策**主动后置**，不是排不进。
- **锁定"路径问题"三条病根**：
  1. **done 语义坍缩**——决策关闭、代码提交、fixture 测试、视觉退出线、正式关票被反复写成同一个"完成"；对标点在"壳成立"就被记为"已对标"
  2. **两套事实未收敛**——`creativeContents` vs `contents`、creative Asset vs Product Asset 靠投影拼成"像一个库"，动作与生命周期仍断裂；CreatOK 要求"流里跑、库里存"同源，我方做成了两源投影
  3. **局部优化代替结构重构**——T1-T7 沿"调 token"熟路走，绕开了"重构信息架构"的难路；而"成品领屏、意图态"是 IA 命题，视觉微调解不了（R2 自己都承认"不能靠继续换 token 达 8.0"）

**一句话根因：功能对标抄到了 80% 的形，却把闭环对标做浅了。CreatOK 的产品价值 = 真实闭环跑在 30 万用户上；我方现状 = fixture 下完整的壳。对标落不下不是"没抄到"，是"抄到了形、没接通真实价值链"。**

---

## 三、最该让你知道的元发现（Lane 4 挖出）

**这是"测试循环陷阱"的第三次同构复发。** 前两次：闲鱼项目（214/214 测试全绿但业务真跑为 0）、creator-agent（ship-readiness 假绿）。本项目 = recorded 全绿 + UIUX 6.50 分 + S1-S5 证据包齐全，但真实商家可用性 = 0。

**且这次更危险——它被半制度化豁免了：**
- `CONTEXT.md:20`：P1 功能完成 = must-have implemented + Gate passes，而"真实商家留存/省时…**do not block this state**"
- `CONTEXT.md:113`：`_Avoid_: 用真实供应账号未就绪拆掉产品闭环`——即"真实账号没接也算闭环完成"被**写进了决策**
- `p1-deep-review-workflow:144-150` 早已精准预警"n=0 真实商户撞闲鱼陷阱"并建议"done 反转为真实跑通"，却被评审用"CONTEXT 已诚实声明 + 付费 Beta Gate 会兜底"**判为 WEAKENED 驳回**——用"我知道没验证"的诚实声明去**豁免**"必须有一条真跑"的硬 Gate，而豁免理由依赖一个至今 n=0、未触发的未来事件

**好消息：你本人已经开始纠偏。** `REVIEW-NOTES.md` 第 3 节你的最新拍板："不再做过细的 A/B 分段开发和不可评审的过程稿……一次性交付一个可真实使用、可完整评审的单店内容生产产品；不把半成品当阶段性交付。" 这次诊断不是逆着你走，是**印证并量化了你已有的直觉**。

---

## 四、下一阶段力量投向（四路 + Codex 融合，待你拍板）

**核心动作：冻结 L1 打磨，把 100% 力量投向 L1→L2 的跨越。** 融合后有一个**前置的架构决策**——它约束下面所有动作：

> **动作 0（最高优先，零代码，Codex §13 第一项）：拍板 ContentPackage 是否成为唯一用户成品与输出事实源。** 这一条决定"三套结果事实收敛到哪、旧的是否只迁移只读、Work/Job/Asset 是否退出一级导航"。它是 Codex 六工作流的地基，也是我动作 D（收敛事实）的架构答案。不先定这个，D 只能打补丁、C 跑通的链路也无处沉淀。

| # | 动作 | 类型 | 对应病根 / 融合来源 |
|---|---|---|---|
| **0** | **拍板 ContentPackage 唯一成品架构**（+旧三套只迁移只读+Work/Job/Asset 退一级导航） | 定架构·零代码 | Codex E1，收敛三套事实的地基 |
| A | **把 done 硬钉在"一条真实跑通"**：改 `CONTEXT.md:20/113` 措辞，真实账号未就绪时状态是"未完成/待激活"而非"闭环完成" | 改决策·零代码 | done 语义坍缩 |
| B | **冻结 UIUX 打磨**：6.50 分不再追 8.0，停止新增 token/密度/CTA 微调、停止 S 系列逐步 evidence、停止元评审对账 | 砍仪式 | 局部优化代替重构 |
| C | **跑通并录制一条真实链路**：真档案→真模型流式文案→真 Ark 图/片→真入库→三平台版本，留一份 live 证据替换 `p0-release-evidence.md:17` 那条 skipped | 真能力 | fixture 掩盖最难部分 / Codex E6 |
| **C+** | **真实素材必须进媒体生成**：修 `ark-media-adapter.ts:449-465`——把 `referenceAssetIds` 解析成 provider-readable URL 喂进 Ark image.edit/generate，让"真照片+AI 文案"成立 | 真能力·新 P0 | Codex §4.2（我四路漏抓） |
| D | **收敛结果事实**：三套（旧 ContentItem / P1 CreativeContent / 独立视频）收敛到 ContentPackage；采用支持"文案+多图"成一个成品（改 `application-service.ts:5638` 单元素数组）；验收走"生成→采用→一级库可见→编辑"真实用户链 | 真能力 | 两套事实未收敛 / Codex E1·E4 |
| **D+** | **桌面/手机同一产品**：同一 ContentPackage+Brief+任务状态，设备只改布局不改对象；手机后段脱离旧 ContentItem/发布交接 | 真能力·新 P0 | Codex E5（我四路漏抓） |
| E | **抖音/BYOK 停止"只差 Key"表述**：`main.ts:326,334` 是硬编码 RecordedAdapter，须换装配，不是补 Key 即通 | 诚实标注 | done 语义坍缩 |
| F | **北极星换成"真实商家跑通链路数"（当前=0）**：替代评分/绿测数/票关闭数这些 L1 内部指标；0→1 之前任何 UIUX/评审/recorded 完备性都不计产品进度 | 度量 | 全局 / Codex §11 验收 |
| G | **评审设熔断阈值**：review→remediation→re-review 最多两轮，第三轮强制"要么真跑验证、要么标 open 冻结" | 砍仪式 | 评审自循环 |

**执行顺序**：动作 0（定 ContentPackage）与 A（改 done 定义）是零代码前置，先拍；然后 B（冻结 UIUX）立即释放力量；C/C+/D/D+ 是真能力主战场，按 Codex E1→E2-E4→E5→E6 依赖序推进；F/G 是贯穿的度量与流程护栏。**Codex 明确警告：ContentPackage 与切换策略获批前，不建议开始大规模页面或后端扩建。**

---

## 五、四路原始摘要留档

- **Lane 1（技术栈）**：L1→L2 过渡带。技术栈本体最扎实、无自写 framework；但无一条真实供应商调用在 CI 内证明过，`live_verified` 由哈希伪装；gateway 的 Bifrost/LiteLLM 纯 recorded、157 行报告冒充 PoC；Ark 适配器（888 行真调通）已反转对账 P0-E 但仅覆盖 8 媒体模型中的 2 个；graphile 是 682 行死代码。
- **Lane 2（前端）**：L2 界面就绪 / L1 真实体验分裂态。07-13 差距报告已过时，其绝大多数前端 P0/P1 在 HEAD 已真实修复；但默认开箱 100% fixture 假流 + seed 装饰图，无一处真实生成；真流式前端零证明；真实渲染管道其实是通的，短板不在界面而在"真实商家从未端到端用过一次"。
- **Lane 3（竞品）**：卡在 L1→L2 过渡前半程未进 L2。功能对标抄到 80%，闭环对标做浅。根因主线是开发路径问题（命中 6/9），非资源/时间。P0：accepted 内容进不了一级库；真实媒体/抖音执行未激活。校正对账两处（Ark 媒体晚于对账 HEAD、选模已接优先级链）。
- **Lane 4（流程）**：L1 已达成且被过度加固，L2 零证据未跨越——闲鱼"测试循环陷阱"第三次同构复发。真跑为 0；力量结构性倾斜 UIUX；"完成"定义把真实价值解耦、被 CONTEXT 措辞半制度化豁免。你本人已在 REVIEW-NOTES 启动收口。

---

## 六、融合 Codex 深度评审（`FINAL-REVIEW.md`，控制器逐条核实锚点）

> Codex 这份是**处方级**评审（NO-GO + ContentPackage 唯一成品架构 + 六工作流 E1-E6 + 完整验收清单），与我四路的**病理级**诊断互补。我没有盲信——对它最重的几条技术底论断亲自查了代码，下面区分「核实为真」「Codex 高估须修正」「处方增量」三类收录。

### 6.1 Codex 挖出、我四路没挖到的真增量（已核实为真）

**★ 真实素材根本进不了媒体生成——比"默认 disabled"更致命的一层（核实为真，Codex 独有）**
- 我 Lane 1 只抓到"Ark 默认 disabled + 仅覆盖 2/8 模型"。Codex 往下挖了一层：**就算把 Ark 打开，商家上传的真实照片也进不了图片生成。**
- 铁证：`ark-media-adapter.ts:449-453` `image.edit` 操作**直接抛错拒绝**（`reference_asset_resolution_required` / "Ark image editing requires provider-readable reference asset URLs."）；`ark-media-adapter.ts:464-465` 图片生成请求体**只有** `prompt` + `size`，不含参考图。
- `referenceAssetIds` 确实从 grounding snapshot 一路流转过来（`model-supply-creation-adapter.ts:318,386`），但到 Ark adapter 层要么被拒（edit）、要么被丢弃（generate 只用 prompt）。
- **意义**：产品反复强调的"真实门店素材 = 护城河"，在媒体生成链路上**当前只是授权/事实门禁，不是画面输入**（Codex §4.2 原话，核实精确）。这直接掐断了"真实照片 + AI 文案 = 图文成品"这条核心价值。**升级为新 P0。**

**★ 采用一次只把一个 Asset 变成一个 Content——文案+多图无法组成一个图文成品（核实为真）**
- `application-service.ts:5638` `assetIds: [asset.id]`——写死单元素数组。这补强了我 Lane 3 的 P0-1（内容入库断链）：不仅"进不了一级库"，而且**结构上就不支持"一篇图文 = 文案 + 多张有序图"的成品概念**。
- ContentPackage 聚合 grep 全仓零命中（`ContentPackage/成品包/orderedVisuals` 均无）——Codex 处方针对的是**真实空白**，不是重复造轮子。

**★ 三套结果事实并存（我 Lane 3 抓了两套，Codex 补出第三套）**
- 我抓到 `creativeContents` vs `contents` 两套。Codex 指出实际是**三套**：① 旧 Product ContentItem（小红书/抖音，发布+交付流程）② P1 CreativeContent ③ 独立 DurableVideoWorkflow（视频完成后进不了同一成品/内容库/版本体系）。三套靠投影拼接，无唯一成品事实源。

**★ 桌面与手机是两套产品（Codex 独有，我四路未覆盖移动端断层）**
- 桌面 `UnifiedCreationWorkbench` vs 手机 `MobileActionBook`；手机后段仍围绕发布/交接/L1-L3/旧 ContentItem，**P1 采用结果不能可靠进入手机的编辑/发布后续**。设备不该改变对象与状态机，只该改变布局。Codex 设计维度给"桌面/移动一致性 3/10"。

**★ 合规/撤权没有覆盖所有成品（核实方向成立）**
- 旧撤权逻辑只检查旧 Product 内容；P1 内容和独立视频**不会**得到 needs_replacement；图文水印/AIGC 开关**没有落实到实际输出文件**。这是我 Lane 3 P1-4（合规只做骨架=负债）的具体化。

### 6.2 Codex 高估、须诚实修正的一条（我核实后不采纳原措辞）

**"Workbench 不调用 Brief update/confirm，可见助手接受/编辑只改本地 reducer"（Codex §4.2）—— 部分过时。**
- 实测 `unified-creation-workbench.tsx:1007-1024` 有 `briefCommand` useMutation，`:1539/:1542` 真调用了 `confirm_creative_work_brief` / `update_creative_work_brief`，后端 `application-service.ts:4663-4720` 有对应持久化处理。**Brief 已接进主链，不是纯本地 state。**
- 但 Codex 另一半论断**成立**：`application-service.ts:5092` 显示 `!briefSnapshot.confirmedAt` 时仍有提交路径（"完全没有 Brief 时仍可提交"）——**Brief 确认非强制门禁**。
- **修正口径**：不是"Brief 没接线"，而是"Brief 已接线但确认不是硬门禁 + Brief 内容没有真正约束下游图文/视频所有子任务"。这条仍是真问题（对应 Codex E2），但严重度从"完全断裂"降为"接了但松"。

### 6.3 Codex 的处方架构（增量收录，待你拍板）

Codex 给的不只是问题，还有一套完整的**唯一成品架构 + 六工作流 + 验收门槛**，这是我四路（止于"往哪投力量"七动作）没展开的下一层。核心：

**处方核心 = 引入用户可见的唯一聚合 `ContentPackage`**：
- 收束：图文（copy + 有序视觉）/ 视频（脚本+分镜+成片）/ 三平台 variants（小红书·抖音·视频号）/ 可编辑版本 / 权利合规态 / 导出回执 / 复用血缘。
- 责任边界：Product 事实=唯一输入源；Brief/Grounding=一次执行的确认上下文快照；Work/Job/DurableVideoWorkflow=内部执行审计对象；**ContentPackage=唯一用户成品与输出事实源**；内容库/编辑/版本/导出/复用全部只读写 ContentPackage；旧三套=只迁移只读、不再双写。
- 十条状态契约（draft/needs_input → generating/verifying → partial → review_ready → accepted → needs_replacement…），每条都有"必须行为"（不重复计费、保留成功子任务、幂等查询不重复版本）。

**六工作流（E1-E6，是"一套产品的六个建设面"不是六次发布）**：
E1 唯一 ContentPackage 与切换 / E2 Brief·Grounding·准备度·授权统一 / E3 图文视频统一编排+真实素材进媒体+合规落到输出 / E4 三平台·编辑·版本·导出·复用 / E5 桌面移动同一产品旅程 / E6 真实生产证据与完整发布门槛。依赖关系：E1 冻结合同 → E2-E4 并行 + E5 界面骨架 → 接入 → 历史迁移对账 → E6 真实验收 → **一次发布**（不发半产品）。

**三个必须先拍板的架构决策（Codex §13，第一项约束后面全部）**：
1. ContentPackage 是否成为唯一用户成品与输出事实？
2. 旧三套（Product ContentItem / P1 CreativeContent / 完成视频）是否只迁移只读、不再长期双写？
3. Work/Job/Asset/模型/路由是否全部退出门店用户一级导航（降到二级详情）？

### 6.4 融合后的联合结论

- **两份评审独立收敛到同一总判**：产品不能作为完整产品面世（我=L2 未跨越/Codex=NO-GO），底座扎实（我=技术栈最扎实层/Codex 基础设施 7.5/10），病不在"后端没做完"而在"真实价值链没接通 + 成品事实没统一"。
- **Codex 把我"往哪投力量"的方向，具体化成了"投成什么结构"**：我的动作 D（先收敛两套事实）↔ Codex E1（唯一 ContentPackage）；我的动作 C（跑通一条真实链路）↔ Codex E3+E6（真实素材进媒体 + 真实生产证据）。**两者不冲突，Codex 是我处方的架构落地版。**
- **新增的、我四路漏掉的三个 P0**：① 真实素材进不了媒体生成（`ark-media-adapter.ts:449-465`）② 无唯一成品聚合、采用只转单 asset（`application-service.ts:5638`）③ 桌面/手机两套产品。这三条都并入下方 §四动作表的依赖前序。
