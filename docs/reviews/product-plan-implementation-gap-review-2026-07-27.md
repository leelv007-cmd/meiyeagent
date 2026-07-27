# 美业内容2 产品规划落地差距审计报告

> 审查日期：2026-07-27
> 审查基线：`main@d0700122`（与 Codex 工程 review 同基线）
> 审查性质：只读审计。未修改产品代码。
> 审查视角：**产品承诺 → 用户实际可得**。与 `agent-team-ticket-implementation-review-2026-07-27.md`（票面 DoD 视角）互补，不重复其 P0 发布阻断结论。
> 方法：5 个并行只读审计 agent 分面核查（首页入口 / 成品与结果 / 资产与身份 / 商业化计费 / 对话流交付合同），全部结论带 file:line 证据。
> 对照权威：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-101~D-132）+ `.scratch/orca-run-2026-07-25/` 中的 D-133~D-138 追加裁决 + `PRODUCT.md`。

## 一、总判

用户的直觉成立：**46 票全部合入 ≠ 产品规划落实**。本轮审计确认的主导失效模式不是「没建」，而是：

1. **后端建满、前台不接**（最普遍）：契约层与 core 执行层大量按设计原文精确实现，web 前台从未构造对应调用。典型：快捷修改 13 动作、五步录入范式、交付 manifest、事实纠错、失效引擎、拟人化失败文案——全部后端就绪、前台零消费。
2. **整块产品承诺无票认领**：五类场景入口、推荐依据（确定性规则+行业先验）、承接终点/CTA 选择、时间桥拉回机制等设计文档一部正文的旅程级承诺，从未映射到 T01-T46 任何一票，也没有 OI 登记。
3. **属主真空**：T24 与 T33 对「五步录入 UI」互指属主（双方票面都声明对方负责），结果无人实现且两票各自验收全绿。
4. **测试为未完成功能背书**：多处测试名承诺了断言里没有的东西，fixture 注入生产产不出的值，CI eval 扫的是硬编码字符串——假绿系统性掩盖产品断点。

同时必须区分：**D-133~D-138（07-26/07-27 用户裁决）已把四块「未落实」转为「主动延后」**——原生视频编辑面（D-133）、内容工作区套餐容器（D-135）、IA 收口（D-136/D-137）、抖音封面字幕（D-138）。这些不算规划失守，但裁决目前只存在于 `.scratch/orca-run-2026-07-25/STATUS.json:1401,1561-1563` 与 closeout 材料，**未回写权威设计文档**。

## 二、P0 产品断点（用户可见破面 / 产品核心价值断裂 / 诚实性）

### P0-1 建档链最后一公里断裂：商家确认的门店事实进不了 ContextBundle

- `confirm_store`（流内补录轨与门店页轨共用）只写 `ProductState.store`（`apps/core/src/product/product-service.ts:1946`）；
- ContextBundle 只读 StoreFact 账本（`apps/core/src/p1/operations/context-foundation-module.ts:149-172`）；
- 两者之间**零投影代码**：`store_fact_append` 生产调用 0，`confirm_asset_intake_fact` 前台调用 0。
- 后果：产品核心主张「编译本店事实」在真实商家路径上拿不到商家确认的门店档案；fixture/示例店测试掩盖此断点。
- ⚠️ 修复前须先做一次聚焦数据流复核（确认是否存在其他写入 StoreFact 的生产路径），再定接线方案。

### P0-2 失败申报与 partial 诚实交付整条链未落地（D-096/D-116/D-122）

- 事件信封无商家消息字段（`packages/contracts/src/harness.ts:141-149`），core 写好的失败文案（视频失败/exactText 不符/超时取消退额/`merchantPartialFailure`）全部死在传输层；
- 任务失败时对话流渲染为空（`composer-session.ts:265` 只置 phase），用户只见通用 toast「操作未完成，请检查当前状态后重试」；
- `merchantPartialFailure` 生产调用 0，仅为 CI eval 变绿存在；图片失败兜底是英文工程句。

### P0-3 图文笔记风格选择卡：盲选 + 30 秒 vs 48 小时合同冲突

- 前台问题卡丢弃 `option.description`（`composer-question-card.tsx:200-215`、`harness-question-card.tsx:174-186`），双风格草稿正文不过浏览器——用户只见两个风格名，**盲选**；
- core 对该卡设 `unattended:'hold'` + 48h 保留 + 超时取消退额（`workflow-core.ts:1262`；`dbos-workflow.ts:75,150-183`），前台 30 秒硬编码发「未作答」，core 匹配不到 styleId 直接抛 `HarnessMediaScopeError`——**超 30 秒选风格的商家拿到内部报错**。与 Codex review 的 T31/T45 同族，但范围更大：修复票应把「携带风格描述+草稿预览」一并纳入。

### P0-4 首页主推荐：英文工程串上屏 + 图片/视频商家恒冷态

- `whyNow` 硬编码 `'Single primary result; comparative scoring was not run.'`（`apps/core/src/p1/harness/execution-selection.ts:248-255`）直达首页卡片与 Composer 预填文本；测试用生产产不出的中文 fixture 恒绿掩盖（`today-recommendation.test.ts:186-189`）；
- 图片/视频交付 `candidateScores` 恒空（`unified-media-stage-ports.ts:1225-1241`）→ 只做图/视频的商家永远显示「你还没生成过东西」——降级态伪装成冷态，反向不诚实。

### P0-5 图文任务前台放行、后端拒收（已登记 G-10 未修）

- 服务端图文双桶扣（copy+image，`composer-submission-gate.ts:544-547`），前台只预检 image 一桶（`composer-home.tsx:680-688`）→ copy 不足时提交必 409。

### P0-6 硬编码能力谎报

- `apps/core/src/p1/harness/marketing-scene-policy.ts:33-42` 把 `capabilities:{quickEdit:true, remix:true,...}` 当字面常量盖在每个成品包上，而前台快捷修改入口不存在——基于该字段的任何验收自动变绿。

### P0-7 测试背书清理（质量信号完整性）

- e2e `sample task ... and exports` 不断言任何导出（`dashboard-home-mount.spec.ts:273,102-134`；Day-0 链 `adoptedCandidateId` 仍 null、`exportReceipts` 0）；
- `today-recommendation.test.ts` fixture 注入生产产不出的值；
- merchant-language promptfoo 实际只扫 5 条硬编码字符串（`evals/merchant-language/cases.ts:36-73`），护栏 `merchantVisibleLanguageIssues` 生产接线 0。

## 三、产品承诺主体缺失（需产品拍板：补建 or 正式改约）

### A. 首页与入口（audit-home）

| 承诺 | 状态 | 关键证据 |
|---|---|---|
| 五类任务入口 + 场景上下文切换 | **未落地，被物理退役，无票认领** | `creation-entry-model.ts:150-151`（"T6 scene chips physically retired"）；现存分类=文案/图文/视频输出轴；工具条无场景入参（`composer-home.tsx:1845-1852`） |
| 推荐依据=确定性规则+行业先验（D-126） | **未落地** | `today-recommendation.ts:19` 是最近交付回放；admin-config 无推荐键；provisioning C-6 ☐ 未供给 |
| 「一天一个」主推荐 | 未落地 | `postgres-store.ts:314-328` 取最近交付，无日期逻辑 |
| 自由创作次入口（D-103/D-114） | **只有提交体字段，无第二界面** | `creationMode` 仅 4 个消费点无渲染分支；参数面板已删并被静态测试锁死（`reuse-panel-retirement.static.test.ts:104-113`）；无显式模型选择（Composer 从不读 `readCurrentModelSelection`）；非注入 fail-closed 保证零测试（`route:'free'` 测试 0 命中） |
| Pro Studio 冻结（D-127） | 三态扎实；**冻结只靠缺 env 维持** | launch→canvas 全链活着（218 行 SSO + `main.ts:793-794` 每次启动跑其迁移）；checkout 是真 Stripe/Creem（`checkout.ts:77-100`）；「自由创作高阶版」定位文案全仓零命中 |
| 冷态示例店（D-126/D-029） | 已落地（结构性隔离佳） | 偏差：三种子出厂 `hidden:true`，Day-0 首屏默认折叠 |

### B. 成品面与结果（audit-works）

| 承诺 | 状态 | 关键证据 |
|---|---|---|
| 快捷修改动作族 | **13 动作后端全实现，前台零 QuickEditIntent** | `marketing-package.ts:406-419` + `content-package-lifecycle.ts:88-171` vs `result-content-package-hand-edit.ts:64-88` 无 intent 字段；弱促销/强CTA 组件完整但挂载点不传 `onSelectionRewrite`（`result-center-page.tsx:372-380`）；海报/套图/口播/预约卡渲染器为不可达死码；唯一真通=三平台改写；朋友圈 chip 恒拒（`copy-image-text-worksurface-model.ts:581-587`） |
| 保存为系列/「以后都这样」 | 未落地 | reuse-memory 全套活命令前台零调用；偏好钉死 `inactive_stage2`；scope 展示给用户但从不让选 |
| 再创作血缘 | 部分 | 动作真但只能从结果页发起；`sources.contentPackage` 已声明从不填（`composer-home.tsx:1137`）；存了的 `derivedFrom` 从不展示；两条创作线转入转出不存在 |
| 承接终点/CTA | **契约完整，商家无法选择、从不渲染** | `promotionCallToActionSchema`（`marketing-package.ts:29-52`）只在团购场景自动派生；CTA=模型自由文本 `conversionHook`，无选择器；活动包实体不存在 |
| 结果 chips | 部分 | 真写库+fail-closed 诚实；缺数量/时间/备注三可选字段（契约与 core 都支持）；`occurredAt` 恒服务端 now；私信无独立 chip |
| 三级信号分层 | **三缺二** | verified 无生产者恒空；inferred core 实现但挂在前台零调用的查询上（`content-package-delivery.ts:441-465`）；UI 三层展示对两层是装饰 |
| 周复盘 | **一键动作语义假** | `$workId.tsx:1441-1456` 续做/换CTA/换平台三动作 payload 逐字节相同，`action` 不进 payload；无独立周复盘路由 |
| 结果中心 | 大部分落地 | 六入口 4 可用（最近创作不可达、通知无深链）；返回键恒返 `/dashboard`（`result-return-navigation.ts:139-146` 忽略入参）；`missing_target` 错误页未实现 |
| 交付面（D-096） | manifest/确定性 ZIP core 过硬；**前台断链** | `fullPackagePlan` 零生产者恒 null；文件分享 `kind:'files'` 从不填 files 数组（`$workId.tsx:1483-1488`）→面板判定恒错；partial 分支恒死；回执四 kind 无生产者 |
| 「为什么用了这些」chips | 部分 | 六维 3.5/6（活动/CTA 零投影）；四个一键动作 0/4 全被动；`correctFact` 完整后端前台零命中；「待确认」徽标是死胡同 |

### C. 资产与身份（audit-assets）

| 承诺 | 状态 | 关键证据 |
|---|---|---|
| 五步录入范式（D-119） | **仅后端无前台；T24/T33 属主互指真空** | `parse-service.ts:747-775` 五步精确实现含 admin-config guidance；前台 grep 全部 intake action = 0；`t24-mineru-intake-2026-07-26.md:7,22` vs `33-fe-store-identity-workspace-reshell.md:9` 互指；四 slot 前台另一套五分类手动下拉；权利确认硬阻断与合同「软提示不阻断」相反（`canonical-asset-actions.tsx:490-495`）；团购/品牌元素无页面 |
| 双轨同链 | 部分；**事实层两套真相** | 门店档案层同链（同 `confirm_store` 同 schema）；但见 P0-1；轨二=跳回对话流的链接；轨一 4 blocking 字段不可跳过、字段硬编码非意图驱动 |
| 解析管线（D-120） | 仅后端无前台 | 四层表真 DDL+PG 触发器不可变；**生产结构化段=Fixture 正则非 LLM**（`main.ts:799-800`）；批量走 pg-boss 非 DBOS（违 ADR-0013 口径）；上传 PUT 端点未透出 web（`routes/api/core/p1/assets.ts:4-9` 只有 GET/HEAD），前台连 payload 都拼不出 |
| MarketingIdentity 向导（D-117） | 部分 | 三动作分离+revision 双重卡点=全场最扎实（`composer-submission-gate.ts:323-341` + `production-context-port.ts:416-470`）；**对话式向导+AI 草案完全不存在**（12 题纯手输，`marketing-identity-form.ts:35-54`）；identity 无 provenance/unconfirmed |
| 生命周期失效 | **引擎精良，两端断开** | outbox+精确回查+只失效命中 receipt 全对；但前台无处填 `expiresAt`→全部 null→管道生产从未触发；资质 `validUntil` 收了不用；IP 撤权「停止新生成」已落地、「待发布引用失效」生产未接线（`marketing-identity.ts:171-204` 不调 advance/dispatch）；`invalidated` 态无 UI |
| 内容工作区（D-121） | 未建——**D-135 已裁延后，不算失守** | 反向护栏测试防提前实现（`workspace-assets-page.test.ts:30,40`）；租户红线守住 |

### D. 商业化（audit-billing）

| 承诺 | 状态 | 关键证据 |
|---|---|---|
| 三桶商家感知（D-123） | 后端真实；**前台只在 /settings/account 深处** | 首页/Composer 无三桶总览；视频桶零提示（刻意但结果是零感知）；超额报停=算术副作用，`OverageMode` 死字段 |
| 加油包 | **后端完整 SKU，前台零购买面且被测试钉死** | `entitlement-module.ts:87-107` 三 SKU 可后台改价；`workspace-assets-page.test.ts:41` 断言不许出现「加油包」；「查看套餐」→`/settings/credits`→重定向只读页=死胡同 |
| 视频定数 3/6/9 + 档位命名 | **不存在** | 三处代码 2/5/20/60、1/5/20/60、5/20/60 互不一致；档位名仍 Starter/Growth/Pro |
| 代运营引流钩子 | 未落地 | 全域零命中 |
| 公开定价同源（D-125） | **未落地** | `pricing.tsx:47-88` 无 loader 全硬编码；Landing ¥399 vs /pricing ¥499 公开矛盾且被契约测试固化（`pricing.contract.test.ts:51`）；第二套额度文案喂给从未挂载的 PricingCard |
| Landing AI 生成软提示 | 未落地 | landing 域零命中（产品内部 AIGC 标识存在） |
| 注册通道（D-124/D-128） | **基本落地（全场最完整）** | 尾巴：发件域仍沙箱 `onboarding@resend.dev`；缺 key 静默降级 LogMailProvider 且返回 success:true（部署漏配=假绿）；注册表单无兑换码字段 |
| 能力门三态 | 交付面已落地且优质 | 非通用机制，其它面不受约束 |

### E. 对话流（audit-chat）

| 承诺 | 状态 | 关键证据 |
|---|---|---|
| 卡片家族 7 类（D-114） | 4/7 在流内 | 补问卡/进度卡/成品卡真；意图卡=气泡；**计划卡完全不存在**（无组件无 turn 类型）；确认卡/额度卡在流外；补问卡读靠 2 秒轮询 |
| 对象工作区纵深 | 已落地（三层最扎实） | `composer-home.tsx:1260-1280` 绑真实 revision |
| 时间桥拉回 | **未落地** | 无 Notification/SW/角标变更，全域零命中；关标签页丢 sessionStorage 把手且挂载不查在飞任务；异步任务中心数据源无 harness 任务 |
| NotePlan（D-116） | 后端按合同精确实现；前台盲选 | 见 P0-3；回炉=同 prompt 重发（评估 reason 被丢弃），文本侧失败原理上修不好；单页重生成纯函数无生产调用方；风格集合无前台配置面 |
| 拟人化语言合同 | 文案库真、**执行层缺** | 五阶段白话+任务总结真在生产；护栏零生产接线；三套禁词表漂移（web 镜像漏 5 词、目录契约漏 17/20）；LLM 原始输出直接上屏（`structured-nodes.ts:606-610` 的 gap.question/options 2000 字符）；工程术语泄漏多处（snapshot/LLM/refresh token/交付清单 revision/关联 UUID） |
| token 流（D-118） | 已落地且诚实 | 无假打字机（`response-stream.tsx:5-12`）；仅 copy lens（与 D-118 措辞一致） |
| 意图确认卡（D-111/D-116/D-122） | 交互质量高 | 默认值明示/单键跳过（有意设计）/编辑暂停/终态文案区分；硬伤=前台 30 秒硬编码非运营参数（core 侧 config key 已备）+终态提示离场即失 |
| 离场恢复 | 后端重放高质量；**前台把钥匙丢了** | DBOS 持久流+Last-Event-ID 补发全对；关标签页=永久失去回到运行的路径；T41 语义续跑仅覆盖迟到应答，无「带新指令续跑」用户入口 |

## 四、跨面根因

1. **纵切拆票缺「旅程收口」对偶**：D-131 防了「前端组内部自闭环不接真后端」，没防「后端按合同建满、无票负责前台消费」。接缝合同写了，接缝两端没人对账。
2. **拆票映射有洞**：设计文档第一部分（Product Shape/承接结果面/能力门三态）的旅程承诺未逐条映射到票；五类入口被退役时无 OI 登记。
3. **测试为未完成功能背书**：名不副实 e2e、生产产不出的 fixture、扫硬编码的 CI eval、字面常量 capabilities——假绿是本项目反复出现的病症（装配失守、M-04 病症同源）。
4. **D-116 语言合同只建了文案库没建执行层**：单一真相文件质量高，但守卫零接线、三套词表各自漂移、信封不传商家消息。

## 五、正面清单（真实落地且质量高，应保护不回退）

- Pro Studio entitlement 三态单一真相 + 静态钉死
- Landing 能力宣称契约（从运行时事实反推禁用词）
- 确定性 ZIP（固定 mtime+排序+固定 level，字节级断言）
- 事实失效引擎（outbox+精确回查+最窄失效粒度）
- identity revision 双重卡点（准入+运行时）
- 示例店结构性隔离（保留命名空间+独立字段）
- Day-0 不阻塞（T44）+ 诚实冷态三层设防
- 意图确认卡交互设计（单键跳过的取舍判断正确）
- token 真流无假打字机
- 结果阶梯逐字对齐 + 非因果结构性保证
- 兑换码全旅程 + 运营参数后台（admin plans CAS/审计/回滚）
- canonical 写路径/OCC/幂等主体（Codex review T12-T15 结论一致）

## 六、与 Codex 收口路线的合并建议

Codex 阶段 2（修产品主线 P1）与本报告高度互补，建议合并为一个「产品接线批」，因为**大量修复是挂载点接线而非新实现**：

1. T31/T45 timeout 合同票**扩围**：+风格描述/草稿预览携带（P0-3）、+前台 timeout 读 admin-config、+终态持久痕迹；
2. 新增 P0 票：建档链投影（P0-1，先复核后接线）、失败申报信封+前台 turn（P0-2）、whyNow/恒冷态（P0-4）、双桶预检（P0-5=G-10）、capabilities 谎报（P0-6）、测试背书清理（P0-7）;
3. 快捷修改第一批只做「接线」：selection rewrite 挂载点传 prop、export intent 前台发送（渲染器已备）、`sources.contentPackage` 填充；
4. 周复盘三动作 payload 区分；
5. 其余主体缺失项（五类入口/五步录入 UI/加油包购买面/AI 向导/时间桥/expiresAt 入口）**先过用户拍板再开票**（见下节）。

## 七、拍板事项（2026-07-27 用户逐项裁决完毕 → D-139~D-149，已回写设计文档决策日志）

| # | 事项 | 裁决 | 决策号 |
|---|---|---|---|
| 1 | 五类场景入口 | **正式改约为输出类型轴**（五类任务保留为配方卡命名/分组语言，不再是结构轴） | D-139 |
| 2 | 五步录入 UI | **立即开票**，前端 lane，与 P0-1 建档链投影同批收口 | D-140 |
| 3 | 加油包购买面 | **延后绑 E 门触发点＋死链即修**（改指兑换码+联系运营） | D-141 |
| 4 | MarketingIdentity AI 向导 | **补建，排 P1**；合规字段静默硬编码单独列修 | D-142 |
| 5 | 视频定数与档位数字 | **按 D-123 原文对齐**作种子基准，登记 provisioning manifest，公开页同源 | D-143 |
| 6 | leads CRM 台账 | **退役真删**（有真实数据先降只读进删除批） | D-144 |
| 7 | 时间桥 | **修把手（接线批）＋主动拉回延后绑触发点**（连接桥/试点反馈） | D-145 |
| 8 | 决策落盘 | **全部回写**：D-133~138 补录＋今日裁决 D-139 起（已执行） | — |
| 9 | HeroUI Pro V3 | **全量扩容替换批**（65 组件按面铺开＋两模板重对齐＋Motion 进产品面＋token 桥修复；对话流替换须 e2e 门在位） | D-146 |
| 10 | Harness 智能层 | **接＋删同批成 P1 票；copy-stream 旁路＋评分器死注入立即先行清除** | D-147 |
| 11 | durable 载体口径 | **ADR-0013 修订为分层＋④段自旋改 DBOS.recv 事件化单独成票** | D-148 |
| 12 | 提示词承载 | **现在补齐 Langfuse**（推送脚本＋请求时钉扎＋14 位点全量＋outbox dead-letter 同批） | D-149 |
| 13 | 断连根因流程化（追加） | **完成语义锚定旅程**：消费者证明关票门／接缝对称防线＋联调票必开／假绿治理／支线旅程硬门——票面模板新增「消费者证明」「接缝对端」必填栏，约束三批及以后全部开票 | D-150 |

## 八、HeroUI Pro V3 采用面专项（D-130，用户点名后补查）

**总判：镜像侧一件不缺（65 组件+4 模板+14 主题全在本地），缺口全在取用侧——`components.json` 只点了 12/65（真用 8 件），AI Chat 五件族只进了 1 件，两个模板起点当天即弃。Codex review 给 T02 的 100% 是 spike 票面成立，不代表 D-130 采用合同成立。**

根因一个文件：`mkfast-template-main/src/components/heroui-pro/components.json:9-22` 的 12 项清单从未按 T30-T35 实际需要扩容。时间线错位是结构性原因：`composer-home.tsx`（1877 行主容器）2026-07-20 手写完成，早于 D-130 拍板（07-24）4 天；spike 07-25 落地当天即被绕过，T30 换壳只往手写容器上贴了 4 件组件。

### 缺口清单（用户所指「几个重要的组件和模板」）

| # | 缺口 | 镜像 | app | 替代物 | 影响 |
|---|---|---|---|---|---|
| A | AI Chat 族 4/5 缺：chat-conversation / chain-of-thought / markdown / code-block（仅 prompt-input 真用；另 ChatMessage/ChatLoader/Segment 在用） | 全有 | 未复制 | 手写 div+endRef；手写 `<ol>` 进度；prompt-kit 改写的 response-stream（07-13，早于 D-130）；代码块裸渲染 | T30 对话流主容器、T31 进度卡；库内 markdown 本身=Streamdown+CodeBlock 封装，app 重复造轮子还丢了高亮/复制 |
| B | 后台表单族全缺：cell-select/switch/slider/color-picker、inline-select、native-select、data-grid、number-stepper、rich-text-editor | 全有 | barrel 零导出 | 硬编码分支+原生 `<select>`+JSON 文本域（`admin-runtime-config-control.tsx:798-820`） | **D-107「后台动态表单＝HeroUI 表单组件族组装」完全未实现**；`src/p1/`（105 文件，全部 admin control）对 heroui-pro 零引用 |
| C | 后台可视化族全缺：kpi/kpi-group/line-chart/area-chart/bar-chart/pie-chart/timeline/kanban/stepper 等 | 全有 | 零复制 | 无 | T35「用量/任务/租户三面板按 template-dashboard 组件族组装」无件可用 |
| D | 已复制但生产死掉 5 件：Sheet、ItemCard、ItemCardGroup、TrendChip、PromptSuggestion | — | 只活在 PROD 404 的 heroui-spike 路由 | — | **ItemCard 正对卡片场景，T31 卡片族九个文件全体手写绕过** |
| E | 两个模板均为名义起点 | 全有 | template-chat 的 9 件消息结构一件未继承；template-dashboard 只继承了壳（Sidebar/Widget/ListView/EmptyState，admin 壳≈90% Pro 是唯一亮点） | 手写容器 | T30/T35 |
| F | IA 层未换壳：产品前台 `/dashboard` 仍是 shadcn sidebar，Pro Sidebar 只在 admin | — | — | 「Glass CSS 罩在 shadcn sidebar 上」混装 | T34 |
| G | Motion 体系零使用：产品四棵树 Motion import=0，唯一用 Motion 的是 D-130 例外面 Landing；产品路由付了 vendor Motion 的 bundle 成本一行没写 | — | — | `custom.css` 通铺 transition | 全产品面；`useReducedMotion` 只存在于 vendor |

### Glass 主题 token 桥三个实质破口

1. `--surface` 映射成全不透明 `--meiye-paper`，上游 Glass 是 0.8 alpha → ~60 个选择器的 `backdrop-filter: blur(24px)` 纯 GPU 开销零视觉效果；DESIGN.md 三档玻璃 `--meiye-glass-80/50/35` 在桥内 var() 引用 0。
2. 玫瑰金火花在 HeroUI 面零表达（rose 系 token var() 引用全 0，测试只做反向断言）。
3. `.meiye-porcelain` 等同名类双定义碰撞（`styles.css:244-266` 有 layer vs `heroui-glass.css:48-72` 无 layer 胜出且丢 border）→ 挂 Glass 表的 10 条生产路由上白瓷描边静默消失，违反 DESIGN.md「玻璃有边法则」。

另：`design-token-bridge.test.ts` 九个测试全是 `--meiye-*` 自证，**删掉整段 HeroUI remap（bridge:65-141）测试照样全绿**——「测试为未完成功能背书」第五例。README/文件头仍写「dev-only、production 404」，实际已被 10 条生产路由 link。

### 处置建议

不是重写，是**扩容+替换批**：① `components.json` 按 T30-T35 需要扩容（A/B/C 三族）；② 对话流容器与卡片族逐件替换（chat-conversation/chain-of-thought/ItemCard）；③ admin 表单与三面板用 B/C 族重组（正对 D-107）；④ token 桥补 HeroUI 侧断言+修三破口；⑤ Motion 体系进产品面或正式改约。其中 ②③ 与本报告第三节的「前台接线批」天然同批——**换组件的同时把没接的后端能力一起接上，一次触碰完成两个合同**（符合 D-127「触碰时拆」精神）。

## 九、Harness 编排落地专项（D-032~D-041/D-112/D-113/D-118/D-122/D-129，用户点名后补查）

**总判：五段骨架真、DBOS 载体真、四类硬门真；断掉的是智能层——D-112 承诺的「段内受限 agent loop」不存在（每段=单次结构化调用），D-113 的「LLM 事实满足度判断」是零生产调用的死代码，而它们本该取代的正则场景引擎（`marketing-scene-policy.ts`）在⑤段有 7 个活调用点。死代码集中在新范式一侧、活代码集中在旧范式一侧——修复动作是补接线+删旧规则，不是改内核。**

### 与合同相反的三处

1. **「DBOS=唯一 durable 载体」（ADR-0013）**：生产并存至少五套载体——DBOS（仅五段控制流）、pg-boss（批量解析/媒体生成/cron 8 类）、裸 setInterval PG outbox ×4、视频重生成自研 lease 状态机、canvas 进程内自调度 loop。最伤一处：④段媒体执行把活派给 pg-boss 后**在 DBOS step 内自旋轮询最长 150 秒**（`unified-media-stage-ports.ts:864-875`，note 准入锁再自旋 300 秒）。graphile-worker 依赖已装、适配器已写、生产零构造。
2. **事实槽链条断裂（D-113）**：Recipe factTypes 只写不读（运行时从不加载 Recipe 记录）；`assessRecipeFactSatisfaction` + `FactRightsAuthorizationPort` + expiry/权利过滤全部只在死代码内；③段把整个 bundle 原样 canonicalJson 送模型，`layer:'current_fact'` 区分位无消费者——已确认事实与未确认上传对模型是同一堆 JSON。Codex review T09 四条指控全部核实。
3. **提示词承载（D-036/D-037）**：14 个 LLM 位点只有 2 个在 Langfuse（intent-naming/brief-copy），且钉扎方向反了——按可变 label 'production' 拉取、版本 hash 是拉回后的事后收据而非请求时锁定；任何失败静默回落硬编码 builtin-v1；无推送脚本。

### 部分落地/有缺口

- **轻输出未真退化（D-118）**：copy 实际是三次串行 LLM 调用（①正名→③brief→④生成），③段没有退化成模板拼接；只有④段有 token 流。`OUTPUT_COMPILER_CONTRACTS` 分级合同表无任何生产读者，真实分派是 lens 硬分支；image 与 video 声明不同编排等级却走同一 `runMediaHarnessWorkflow`。共享面成立：四类同 workflow/同效果键/同额度结算/同进度流，**无轻链路旁路**；free 模式=同端点一个字段。
- **段内智能（D-112b）**：无 agent loop、无 allowlist 工具（全仓唯一 tools+stopWhen 在对话助手，不在 harness）；「自检」只有 note 五维评估与 exactText VLM 两处外部评估器+一次有界重试。
- **四类底线（D-112）**：四道硬门都在（七门制承载+额度门独立）；但⑤段正则场景引擎（价格关键词/URL/`/screenshot|截图/` 文件名判断热点/24h 硬编码）正是应退位的那类。
- **择优收窄（D-113）**：真做了（单主候选+各一次有界重试；video 无质量门）；但 `StructuredCandidateScorer` 每次 copy 任务仍被构造注入、从不调用——活雷。
- **Langfuse outbox**：审计表+outbox 同事务双写做得好；但无 dead-letter/attempt 上限，毒消息 30 秒无限重试可顶爆 readiness 探针（R 门遗留坐实）。
- **promptfoo**：正/负控在 CI 阻塞但全是确定性直调；唯一真打模型的 redteam 被门在 workflow_dispatch，PR 上永不运行；事实满足度与候选评分零 golden 集。
- **admin-config 参数位**：harness 只有 1 个可配参数（30s 确认卡超时），**48h 决策持有期硬编码不可配**——同类参数两种待遇；outbox 重试/租约/热点有效期/指标阈值全硬编码。
- **D-035 节点**：AI SDK 现行 API（generateText+Output.object）干净、DeepSeek 接线成立、视觉例外成立；仅缺 repair 埋点（BAML 迁移阈值数据不完整）。
- **D-038 五约束**：①纯函数内核②at-least-once 幂等③大产物走引用④OCC 条件写——四条扎实；⑤发布 SOP（in-flight 排空/版本粘滞入 CI）完全缺失，`HARNESS_DBOS_APPLICATION_VERSION` 无人设置，**apps/core（DBOS 宿主）没有部署 workflow**。
- **AgentKit/Kickart 边界（D-113）**：干净，无第二套 agent runtime（全仓 grep 零命中）。

### 额外发现（重要）

- **`p1/copy/stream` 是结构完整的旁路**：直连模型流式出文案，无五段/无 ContextBundle/无策略门，前端接线也在；仅因上游 `submit_creative_work` 被下线而打不到。任何人重新接上即获得绕过全部硬门的路径——建议按 D-118「禁止旁路」显式删除而非留置。
- **③④段无确定性 fallback，违反 D-122**：①段有保守回退；③brief/note 评估器/exactText 失败直接抛，note 二次评估有残留即整任务失败——典型「为零错误阻塞流程」。
- **decision_traces 与 audit_events 不同事务**：Langfuse span 可能挂错 trace（影响回放可信度不影响 system of record）。
- **AIGC 证据合同疑似未随 D-118 收口**（低置信，待交叉核）：contracts 仍校验「我方烧录」形态全套字段，默认由可关布尔挡住。

### 处置建议

1. **接线+删除批**（与产品接线批同批）：事实槽内核接入③段（bundle 分层消费）→ 删 `marketing-scene-policy.ts` 正则规则 → 删 `StructuredCandidateScorer` 注入 → 删 `p1/copy/stream` 旁路 → 删/接 `OUTPUT_COMPILER_CONTRACTS`。
2. **载体口径拍板**：ADR-0013「唯一 durable 载体」按现实修订（DBOS=五段控制流权威，pg-boss=子任务执行层，写明边界与④段跨载体等待的替代方案——DBOS.recv 事件化而非自旋）或立专项票收敛。
3. **Langfuse 提示词**：要么补推送脚本+请求时钉扎+其余 12 位点入库，要么修订 D-037 为「代码常量为权威、Langfuse 仅观测」。
4. D-122 fallback 补齐（③④段）、48h 持有期入 admin-config、outbox dead-letter、D-038⑤ 发布 SOP。

## 十、额外风险登记（不阻塞，交属主）

- ProgressiveFactCard 整体替换会抹掉已有账号/项目（数据丢失风险，`progressive-fact-card.tsx:58-60` + `product-service.ts:1953`）
- 六个合规字段前端静默硬编码写入商家档案（四平台全开/五场景全开，无 provenance 无法区分，`marketing-identity-form.ts:161-179`）
- 邮件缺 key 静默假成功（`mail/provider/log.ts:48`）
- Google 登录按钮无条件渲染点击必败
- `assisted_intake_*` 孤儿文案组（zh.json:513-528）说明代填交互曾设计到文案级，只差组件
- ParseService 授权器不对称（`job-worker.ts:459-466` 恒 false）
- identity 跨页交接版本窗口（失败无解释）
- 重连时进度帧可能被 React 批处理合并丢失（静态推断未实跑）
- supersedes「更正自」UI 有读取渲染逻辑但契约/core 无字段（永不会亮）
- legacy 字符串拼接快捷编辑残留 core 且产物被前台拒收
