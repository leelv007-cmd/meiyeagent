# 主路径折叠 + 供给冷启动 开发规格（2026-07-19）

- 实施状态：T1–T6、Ta–Td、V1 与 D-046 增补已合入 `main`；GL-23（空额度卡内联兑换）仍为 P2 UX，GL-25/26 为独立持久层/迁移残差，详见实现总账 §7.7
- 决策依据：D-043（主路径折叠 + Day-0 体验合同）、D-044（平台默认供给 + 试用套餐）、D-045（额度流水补课 + 兑换码 + 支付接缝），见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
- 既有约束继承：D-023（默认一个主推荐）、D-027（Composer 场景 chips 不跳页不弹表单）、D-030（一键代理微交互）、D-031（前台无槽位填表）、P1 spec 模型供应节（图片/视频不跨品牌 Auto；LLM Auto 允许口径不变——原引 D-018 为错引，见 §7 勘误）、五类 HITL 节点纪律（hitl 调研 README）
- 票包：`.scratch/ux-fold-supply-2026-07-19/tickets/`（T1–T6 折叠、Ta–Td 供给额度、V1 验收）
- 走查证据：2026-07-19 真机截屏全链（fixture 栈，tour 脚本可复用为回归工具）；对标证据 `references/benchmark/interaction-study-2026-07-07/interaction-patterns-xyq-creatok.md`
- 参照实现：`references/repos/mkfast-app`（同栈积分/兑换码/退款/接缝参照，浅克隆不入库）

## 0. 问题陈述（一句话）

终点体验已建成（流式三候选、移动工作台、门店页、双端接力），但从「输入一句话」到「看到候选」隔着一个设置页：Brief 四卡、模型五卡、额度确认、开关、授权跳转全部前置平铺（约 8 步）；且新租户模型供给全灰，Day-0 无法出活。本规格 = 呈现层折叠工程 + 供给开通工程，**后端三进三出合同、审批/授权语义零改动**。

## 1. Day-0 体验合同（硬门，来自 D-043 决定①）

> 从输入一句话到看到流式候选 ≤2 次点击、0 个前置表单、0 次前置模型/额度确认；无冲突路径 0 张阻塞卡。

- 落 e2e 断言（真实计数点击），进 `uiux-creation-loop` 或新 spec 文件；任何票向主路径新增前置节，先过此门。
- 「点击」计数口径：从 composer 提交动作起算，到首个候选 token 可见止；提交动作本身计第 1 击。

## 2. 工作包 A：主路径折叠（T1–T6，纯前端）

主战场：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、快速起步段、`src/routes/dashboard/assets/`。合同层零改动。

### T1 Brief 折叠
- Brief 四卡（创作意图/场景/语气/受众）默认全采用，压成一行「本次将使用」chips 被动展示；点开 chips 才见卡可改。
- Agent 检出事实冲突才弹**单问**阻塞卡（一次一问，五节点纪律）。
- 「采用并确认 Brief」按钮从主路径消失（默认路径无此步）。
- 验收：无冲突路径 Brief 环节 0 次点击；冲突路径恰 1 问；chips 可展开可编辑接管。

### T2 模型/额度折叠
- 「未选择模型」卡从主路径移除；默认档（D-044 平台默认 binding）自动带出报价。
- 额度以按钮旁一行被动文案展示：「本次约 N 次额度 · 余 M」；余量不足才出阻塞卡。
- 换模型收进「更多设置」二级（逃生口保留，含现五卡完整信息）。
- 小额合并确认（D-043 决定③）：点「生成」即视为确认，审计留痕不变；视频大额保留显式确认卡。
- 验收：主路径不出现「模型」词汇与模型卡；小额路径确认+执行合并为一击；审计表确认记录仍逐条落。

### T3 开关下沉
- 品牌水印、整理标签收进更多设置（默认值生效）。
- AIGC 标识开关从商家界面移除——它是我方烧录义务（后端逻辑与烧录不动，仅撤 UI 决策权）。
- 验收：主路径 0 个开关；烧录行为回归测试不变绿→红。

### T4 流中接管
- 「开始创作」后不再落创作台设置页，直接进入流式候选区（现 h03 帧形态：三候选并行流 + 停止本次流）。
- 创作台原各节改为流中可展开「本次详情」抽屉（含 T1 chips、T2 逃生口、T3 设置）。
- 验收：Day-0 体验合同 ≤2 击断言过；抽屉内容与原创作台信息等价（无信息丢失）。

### T5 授权内联
- 上传素材当下内联单问：「这是你店里的真实素材、允许公开宣传吗？」一键确认；授权文案与留痕字段不变，凭证编号收进可选展开。
- 素材库详情页表单保留（补录/审计入口）。
- 验收：首条内容路径不发生「跳素材库→填表→跳回」；授权审计记录字段与现行一致。

### T6 桌面场景 chips
- 移动端「灵感场景」chips 上桌面首屏；点击 = 替换推荐词 + 套组预设，不跳页不弹表单（D-027 原文）。
- 验收：桌面首屏有场景入口；点击后 composer 上下文与推荐词变化；无新表单出现。

## 3. 工作包 B：供给与额度（Ta–Td，core 为主）

主战场：`apps/core/src/p1/foundation/entitlement-module.ts`、`apps/core/src/p1/model-supply/`、`apps/core/src/p1/admin-config/`、web `src/p1/admin-plan-control.tsx`、`src/payment/`。

### Ta 试用套餐档
- entitlement 新增 `trial` 档：allowance 条数制 + `expireDays` + 每租户一次；过期回收产生 EXPIRE 流水（Td 语义）。
- `admin-config` PLAN_KEYS 增 `plan.allowances.trial`；AdminPlanControl 增一档可视化编辑（CAS 语义照旧）。
- 默认值可配置（额度量/expireDays 挂定价测算，先上可改默认值）。
- 验收：admin 页可编辑 trial 档并 CAS 保护；trial 过期后额度归零且有流水。

### Tb 开通钩子
- workspace 创建 → 自动授予 trial（复用 `checkout_plan`，幂等键=workspaceId，来源标记 REGISTER_GIFT 对应物）+ 绑定平台默认模型供给（目录默认 binding + 可用性预验证记录）。
- 验收：全新租户注册后直接走到流式候选（结合 T2/T4，Day-0 合同断言过）；「尚未完成可用性验证」在新租户主路径不可达。

### Tc 支付接缝
- Stripe/Creem webhook → core `checkout_plan` 映射：free→trial、pro 月/年→growth、lifetime→pro；映射表入 admin-config（后台可改不发版）。
- 参照 `mkfast-app/src/payment/provider/stripe.ts` webhook 内 addCredits 的位置与幂等处理。
- 验收：webhook 事件（测试模式）驱动套餐变更并落流水；重复投递幂等。

### Td 流水补课 + 兑换码
- entitlement 流水补七类型语义（条数制对应物）+ REFUND 挂链（relatedTransactionId→失败 USAGE）+ **失败自动退条数**（视频长任务优先覆盖）。
- 兑换码模块：生成/批量/核销 + `admin/redemptions` 管理页（参照 `mkfast-app/src/credits/redemption.ts`），兑换产生 REDEMPTION_CODE 流水。
- 验收：视频任务失败后条数自动回补且流水挂链可查；兑换码后台可生成/作废，核销幂等。

## 4. V1 验收与回归
- e2e：Day-0 合同断言（数点击）+ 无冲突路径 0 阻塞卡断言 + Tb 新租户直通断言。
- 走查回归：tour 截屏脚本同机位前后对比（脚本迁入 `tests/e2e/` 或 scripts/ 固化）。
- 指标：confirmation_precision、time_to_first_usable_draft 接入 Langfuse 现有四指标。
- impeccable critique 重跑对比分数。

## 5. 非目标（钉死）
- 不引入 assistant-ui / CopilotKit / AI Elements（D-019；本包零新依赖诉求）。
- 不动三进三出合同、审批/授权后端语义、DBOS 载体。
- 不换计量模型（条数制保留，不引积分币）。
- 不做聊天记录式重构（对话式外壳 = 流中卡片与默认值，非 thread UI）。
- 不采 mkfast-app 的 admin/prompts（与 D-037 Langfuse prompt management 重叠）。

## 6. 依赖与分线建议
- T1/T3/T5/T6 相互独立可并行；T2 依赖 Tb（默认 binding 存在才可移除模型卡——可先以 fixture/配置兜底并行开发，联调时接 Tb）；T4 依赖 T1/T2 完成折叠对象。
- Ta→Tb→Tc 顺序；Td 独立。
- 属主互斥：workbench 主文件（T1/T2/T3/T4）建议单线顺序或按 section 拆属主，避免同文件冲突；Ta–Td 在 core 侧与前端线天然隔离。

## 7. 复审修订（2026-07-19 晚 · Codex 五路交叉复核）

裁决报告：`.scratch/ux-fold-supply-2026-07-19/xcheck/ADJUDICATION.md`（lane 原文同目录）。五路 findings 全部采纳，各票以「复审修订节」为准（票文件与 GH #50-#60 评论已同步）。要点：

1. **现状勘误三条**（本 spec §0/§2 的部分「现状」描述在死供给环境下失真）：模型卡本已在折叠区、报价自动接受 effect 已存在且全操作生效、agent 路径创建后已自动直发。折叠工程的真实剩余 = Brief 0 击（须 core 创建即确认接缝）、两套流统一 + D-023 候选呈现、CTA 竞态与 QUOTE_CHANGED/额度恢复分支、整理标签死 UI、内联授权一键化、场景 preset 映射。
2. **决策勘误已入权威文档**：D-043 Supersedes 对象改 D-012 边界细化（D-024 完整有效）；AIGC 开关保留（D-039）；视频大额显式确认为缺陷修复；D-044 去 D-018 错引、不 supersede LLM Auto。
3. **新挖出的既有缺陷**（随票修复）：视频报价自动接受违 D-012（T2）、额度投影无视 periodEndsAt（Ta）、整理标签死 UI（T3）、点场景清 preset（T6）、acceptance_unknown 与视频外层失败不结算（Td-2）。
4. **依赖与实施顺序修订**：前端 T1→T2→T3→T4 单线（共享 CTA/professionalOpen/执行合同）；T5/T6 并行另树；core Ta→Tb→{Tc,Td}（Ta 冻结 period 策略与 grantKey 接口）；Tc 内部三批、Td 内部四批；free→trial 归 Tb。
5. **Day-0 合同计数口径**（§1 增补）：isTrusted 捕获计数、首 token data-has-token testid、指标名=用户激活次数（快捷键计 1）、canonical 不点暂时跳过、冲突路径豁免 ≤2 门（另断言恰 1 问）、种子=测量前置清零且内联授权须走 composer 路径。

## 8. D-046 增补：流内自由追问口（2026-07-19 · 聊天流三路复核）

针对「为什么不做聊天流」的三路对抗复核（steelman/工程/合规）裁决：thread-as-primary 维持不做（四项硬机制被聊天容器静默破坏 + DBOS 双写风险 + 竞品自我否证），但坐实真缺口——result 阶段 composer hidden，自由文本转向意图无入口（D-031「chips 穷尽性」待验证的实证否定）。用户拍板采纳建议第 1 条：

- **T4 新增范围 6**：result 阶段常驻自由文本「调整方向」输入，提交=revise turn→派生 Task/derived revision（D-033 既有机制），零新内核、不新增消息持久化实体，D-019 真相层边界不动。验收与 e2e 断言见 T4 票 D-046 增补节。
- 可见迭代血缘时间线进 backlog；§5 非目标「不做聊天记录式重构」维持不变。
- 决策全文：设计权威文档 D-046。
