# #261 开工门 · 阻塞与拍板登记

> 状态：**NO-GO（4/7 未过）**，基点 main@7f60a4e7，最后检查 2026-07-29
> 复检命令：`./docs/tickets/261/gate.sh`（`--watch` 轮询直到 GO）
> 依据：`docs/ops/agent-dispatch-runbook-2026-07-29.md:8`（前置未满足只准做零 rebase 面预备）、`docs/specs/agent-substrate-dev-spec-2026-07-29.md:580/596/601`

---

## 一、开工门逐项

| 门 | 判据 | 现状 | 等谁 |
|---|---|---|---|
| G1 | `mkfast-template-main/scripts/compile-locale.ts` 含互斥锁 + write-if-changed | ✔ **已过**（#266 于 `04dda7e1..fb20cf20` 合入 main） | — |
| G2 | `packages/contracts/src/*.ts` 三轴扁平顶层键同现 | ✔ **已过**（#248 合同落 `packages/contracts/src/observability.ts`） | — |
| G3 | 契约/账本暴露「被拒消耗／规划消耗」字段 | 0 处，成本反馈无数据源 | **#248** |
| G3b | Task 快照侧可读三轴（钉扎载体 + 降级留痕同现） | 无运行时取数点 | **#262** |
| G4 | 视频编辑四动作真退役、前台入口摘除 | `apps/core/src/p1/model-supply/video-regeneration.ts:39` `videoRegenScopes = ['shot']` 仍在 | **#264FE** |
| G5 | 前端 lane 无前序**碰源码**在飞（lane 内串行） | ✔ 空闲（`issue/253` 的 3 个提交是门脚本，文档不占额度，runbook `:15`） | — |
| G6 | 形态未定项已拍板（`DECISIONS.md` 无 PENDING） | 未拍板 | **用户** |

**票面未列的两条依赖**（本轮设计过程发现）：

- **#262 是三轴的真正供给方**（G3b）。#248 只定**键名**，把三轴**钉扎进 Task 快照**是 #262 的任务（其票面任务 2「Task 快照三轴钉扎：存储形态实施时定」、任务 3 第④步「三轴钉扎绑 workflowID」）。**只有键名没有值，评价事件发不出真数据。** 票面「依赖：#248」不完整。
- **「项目」域没有实体也没有属主票**（见下节）。

---

## 二、票面事实性偏差（三处，须以现状为准）

票面写的前提与 main 上的实际代码不符，开工前必须按此修正，否则会照着不存在的东西写。

| # | 票面写法 | main 实际 | 处置 |
|---|---|---|---|
| 1 | 「执行确认卡（**UserDebitPreview** 扩容）」 | **该组件在代码中不存在**，只在 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 与 `docs/adr/0016-*.md` 里作为设计名出现。最近亲三个：`mkfast-template-main/src/product/composer/quota-blocking-card.tsx:57`（额度被动行＋阻塞卡）、`src/product/composer/brief-surface-panel.tsx:200-218`（**唯一带取消/确认双按钮的执行前确认面板**）、`src/product/composer/composer-signed-preview.ts:1`（只读参数投影，模块头明写 "deliberately a projection and not a form"） | 「扩容」实为**净新建**，落位与命名见 `02-confirm-card-and-cost.md`。不是重命名一个已有组件 |
| 2 | 评价事件五字段＝`skillId + skillVersion + 场景 + promptName@promptVersion + catalogRevision` | ~~待 #248 定~~ → **已由 #248 结清**（`packages/contracts/src/observability.ts`）：`observabilityAxesSchema` ＝ `skillRevision` ＋ `promptVersion`（两者均为 `^[^@\s]+@[^@\s]+$` 复合形）＋ `catalogRevision` ＋ **`scene`（第四个顶层键）**，`.strict()` | 三处结清：①「场景」确为独立第四键；②五字段按 `@` 合并成立，但正则更严——`skillId`/`promptName` 自身含 `@` 或空格会被拒，适配层须先过 schema 再投递；③`catalogRevision` 与 `packages/contracts/src/uiux.ts:44` 撞名一事，上游已在契约注释里显式划清「distinct from `CreativeExecutionContract.catalogRevision`」，**不得混用**。回填见 `04-events-memory-nav.md §七` |
| 3 | 「canonical 历史页的 `canonical_canvas_job_*` 键组亦无历史岛口径」（评论补充项，D-137） | `project.inlang/messages/zh.json:721-732` 的 `canonical_canvas_job_*` 共 12 条**已是孤儿键**，全仓源码零引用；实际在用的是 `legacy_projection_canvas_job_*`（`zh.json:2256-2264`），消费点 `src/product/canonical-history-page.tsx:60-68 / :843-876` | 补文案要补在 `legacy_projection_` 前缀那组，不是 `canonical_canvas_job_` |
| 4 | 「评价条最近亲＝`src/product/results/image-role-feedback.tsx`」（初盘结论） | **该 `.tsx` 不存在**，只有同名的 `image-role-feedback.interaction.test.tsx`；它测的是 `ImageWorksurface` 的**采用动作完成文案**（`src/product/results/image-role-action-matrix.ts:83-97` `IMAGE_ROLE_FEEDBACK`，D-087 要求逐字符匹配），与赞/踩评价无关 | **全仓无任何评价条前例，本票是第一实现**。可借的只有它的逐字符文案纪律与测试写法 |
| 5 | 「移动底栏 `grid-cols-4`，加第五项要改栅格」 | 栅格属实（`src/components/product/mobile-nav.tsx:55`），**但真正的硬门在测试**：`src/components/product/mobile-nav.static.test.ts:34-43` 用例名写死「**nav 四项合同**」，硬断言 `['workbench','content','assets','store']` | 记忆升一级导航**必然红**这条测试。改它＝改「四项合同」，须在票下留痕；不是顺手改栅格 |

---

## 三、须用户拍板（G6，详表见 `DECISIONS.md`）

### 拍板项 0 · **D-164⑥C 与 D-109 正面冲突**（决策 vs 决策，优先级最高）

设计过程中挖出的最重要一条，**不是票面误写，是两条 `accepted` 决策打架**：

- **D-164⑥ 决定 C**：规划推理已产生真实成本，点拒绝也已发生，「此成本必须计入并明示」。证据＝Miora 实测（拒绝仍扣 79.65）。
- **D-109**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:1871`）：「一个用户主动任务只产生一笔产品权益预占。内部 **Planner**、LLM、……分别进入 **ProviderCost Ledger**，**不重复扣用户**」；并另定「**供应细节不可见**」（`:1865`）、内部成本基准「**永不进前台**」（`:2082`）。

**Miora 的失效模式在本产品结构上不成立**——它的病根是「规划扣用户余额却不告知」，而本产品规划成本按合同根本不进商家额度桶，商家点拒绝时真实消耗**确实是 0**。照票面「金额＝真实消耗」实现，等于**凭空造一个不存在的扣费**，反而砸 D-109 的可信度基础。

建议取「明示本次**未**消耗额度」，兑现 D-164⑥C 的立法意图而不破 D-109。若要把规划成本计入商家桶，那是**改 D-109**，须开新决策，不在 #261 范围内。

### 拍板项 1 · 成本反馈的单位口径：**金额 vs 条数**（冲突）

- 票面验收原文：「就地出现本次规划消耗反馈，**金额＝真实消耗**（Miora 反面教训：拒绝仍扣 79.65 且无提示）」
- 决策原文 D-164⑥ 决定 B：「必须就地、即时反馈本次**实际消耗**」——**未指定单位**，且「⑥ 决定 B 的反馈形态未定……商家语言表述归 D-124 R 门⑤一并出」
- 既有产品纪律相反：`mkfast-template-main/src/product/composer/composer-home.tsx:2601-2609` 注释记录「`预计消耗 0.06` 这行已被删除」，商家面刻意只显示**条数**不显示金额（D-109/D-123）；`src/product/composer/composer-signed-preview.ts:14` 明写 "no cost figures"
- 冲突性质：票面用词取自 Miora 实测（对方以货币计价），**不等于本产品要改计价口径**。按 runbook `:9`「票面与决策原文冲突时以原文为准」，原文只要求「实际消耗」可见，未要求金额。
- **建议**：商家面反馈用**条数**（与 `quota-blocking.ts:278` `projectQuotaPassiveView` 同口径），金额仅保留在设置页明细。待拍板。

### 拍板项 2 · 执行确认卡触发条件：全拦 vs 成本阈值

D-164「待验证」明确未定；票面要求「按最小形态实现并留痕，不自行扩展」。

**「全拦」不是最小形态，反而是更大的改动**——成本阈值通道本仓已建好（`mkfast-template-main/src/product/composer/brief-surface.ts:63` 的 `quote_policy_threshold`；后端 `apps/core/src/p1/creation-experience/brief-trigger-projection.test.ts:343` 有真实测试 `fires when amount >= extraConfirmThreshold`），而文案 lens 现在是**直接提交一次点击**（`brief-surface.ts:295-308` `direct_submit`），全拦＝给 1 击路径加 1 击，与 D-043「≤2 击」正面顶。

建议：**零新增拦截点**，确认卡只出现在今天已经会拦的三处。待拍板。

### 拍板项 3 · 成本反馈形态：成品卡角标 / 消息尾行 / Toast

D-164「待验证」明确未定。现状复杂化因素：`composer-home.tsx:2754-2758` 拒绝时会 `setSession(createComposerSession(...))` **清空整条 transcript**，「就地」的落点因此不能挂在被清空的消息流上。建议见 `02-confirm-card-and-cost.md`。待拍板。

### 拍板项 4 · 动作 chip 生成方式：模型即时生成 vs 配方声明固定集合

D-164「待验证」明确未定。建议取固定集合（可测、零延迟、零额外成本）。待拍板。

---

## 三·补 · D-164① 会推翻上一轮实现写下的一条产品判断（留痕，不需拍板）

`mkfast-template-main/src/product/composer/composer-home.tsx:2764-2771` 有一段刻意写下的注释：推荐位「sits after the whole Composer cluster … splitting the axis in half competes with it just as much as sitting above it did … **an empty panel above the axis was the worst of both readings**」。

D-164①（2026-07-29，晚于该注释）逐字规定推荐位是**段①**，即必须上移到创作面之上。

处置：按 D-164① 上移，并**重写该注释**（不能留着与新排布互相打脸）。原注释担心的「空面板压在主轴上方」由「冷态段① 走示例店、段③ 不渲染」化解（见 `01-ia-three-sections.md §3.4`），空面板不会出现。

风险坦白：D-164 自己的证据边界写着「本条①②④⑤ 为**产品裁定，无实现证据**」，且移动端信息密度是其公开未验项。建议上线后用真实商家观察首屏行为再决定是否回退。

---

## 四、属主边界风险（开工后极易越界，先划清）

| 面 | 属主票 | #261 允许做的 | 越界后果 |
|---|---|---|---|
| 事件合同（三轴键名、schema、字段语义） | **#248 唯一属主**（spec `:580/:601`） | 只建**薄适配层**与调用点，入参类型从 #248 契约 import | 自造键名 → 前台一套后台一套，#248 合入后全量返工 |
| `mkfast-template-main/src/lib/product-telemetry.ts` | #251 埋点通道同踩 | 「投递失败可观测」的改造需与 #251 协调，或收敛到独立文件 | 双写同一文件 → 语义锁冲突 |
| 记忆管道（四态拦截、候选证据链、入库红线） | **#251** | 只做**消费面**（导航、页面、空态）；不新增后端命令/契约 | 自建 `correction` kind → 撞 `packages/contracts/src/reuse-memory.ts:294` 枚举属主 |
| Skill 目录查询（第二层 pill 数据源） | **#259**（Skill 维护面） | 复用现有配方卡目录（`launch-seeds.ts:101` + `recipe-cards.ts:233`），**不碰 `skills` 模块** | `apps/core/src/p1/skills/foundation-module.ts:52` 只有命令无查询，自建查询即抢 #259 属主 |
| 前台创作面 | D lane 内串行 `#264FE→#261→#253FE`，且与 #260 前台入口段互斥 | 等 #264FE 合入再动 | 先重构后删除 → #264FE 大面积冲突（rebase 纪律第 4 条） |
| 规划成本计量 | 后端无 stage 维度（`apps/core/src/p1/product-billing/provider-cost-snapshot.ts:16-32` 只有 `attemptId/taskId/deploymentId`） | 只渲染上游给的数字 | 前端自算规划成本＝编造数字 |

---

## 四·补 · 「项目」记忆域：**没有实体，也没有属主票**（须主控裁定）

D-164④ 定记忆四域＝门店主体偏好／**项目**（一次营销活动）／工作流／纠正。核过全仓：

- 门店主体偏好 → 有（`apps/core/src/p1/operations/marketing-identity.ts`，已通电 `apps/core/src/main.ts:1604`）
- 工作流 → 有（配方目录 `apps/core/src/p1/creation-experience/launch-seeds.ts:101`）
- 纠正 → 等 #251（`packages/contracts/src/reuse-memory.ts:294` 枚举无 `correction`，D-163② 要求新增）
- **项目（一次营销活动）→ 全仓无实体**。`packages/contracts/src` 与 `apps/core/src` 里没有 campaign/project 的 schema 或 id 类型；现有的「项目」只是门店档案里的字段组（`mkfast-template-main/src/routes/dashboard/store.tsx:305-309`），语义是**美业服务项目**（护发/皮肤管理），不是「一次营销活动」。

**同名不同义，不能拿来充数。** 这一域在在册 20 票里找不到属主。请裁定：归 #251 一并建，还是另开票，还是本轮该域只出空态占位（`04-events-memory-nav.md §4.3` 已按空态占位设计，结构与其余三域一致，属主到位后零结构改动接数据源）。

---

## 五、设计过程新发现的产品缺口（不阻塞本票，建议另开票）

**D-139 五类宣发任务里有两类零配方。** `apps/core/src/p1/creation-experience/launch-seeds.ts` 的 `LAUNCH_RECIPE_SPECS` 实际只有 8 条：`case_to_xhs_note`（`:103`）／`project_intro`（`:142`）／`campaign_visual_set`（`:172`）／`promotion_poster`（`:205`）／`douyin_project_video`（`:240`）／`reuse_content.{copy,image_text,video}_adapt`（`:279/:315/:353`）。**「热点借势」与「品牌与个人 IP」两类一条配方都没有。**

后果：D-164② 的第二层 Skill pill 按五类分组排布，首版只能出 **3 组**。设计稿裁定**不渲染空组**（不出灰 pill、不出「即将开放」）——渲染一个点了没东西的分组是 `PRODUCT.md` 「警惕无载体的想象功能」直接禁止的形态。

补配方要动 `apps/core` seeds ＋ studio 编译链（`launch-seeds.ts:481-575`），属后端面、跨 lane，不该塞进前端 lane 的串行链。**建议单开一张「补齐热点借势/品牌 IP 两类配方种子」的票，排在 #261 之后。**

---

## 六、现在做了什么（零 rebase 面预备，runbook `:8` 允许范围）

- `gate.sh` —— 开工门脚本，一次性检查 / `--watch` 轮询（GO 时弹 mac 通知）
- `01-ia-three-sections.md` —— D-164①② 单路由三段 + 第二层 Skill pill 设计稿
- `02-confirm-card-and-cost.md` —— D-164③⑥ 执行确认卡 + 成本反馈设计稿与 schema 草案
- `03-rating-memory-events.md` —— D-164⑤ 评价条 + 动作 chip 设计稿
- `04-events-memory-nav.md` —— D-160③ 评价事件适配层 + D-164④ 记忆一级导航 + `correction` kind 处置
- `DECISIONS.md` —— 五项拍板登记（含 PENDING 标记，G6 判据）

**未做**（受 runbook `:8` 约束）：任何源码改动、任何 i18n 键写入、任何测试文件。
