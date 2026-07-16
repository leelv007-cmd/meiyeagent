---
title: "美业内容副驾深度产品调研地图"
labels:
  - wayfinder:map
status: open
tracker: local-markdown
created_at: 2026-07-07
---

## Notes

Domain: 本地商家内容创作 Agent，首发美业到店 + 医美/医疗内容商家，云端 Web，Regulated Content Mode 创作副驾 P0。

Standing sources:
- Primary planning doc: `合集-v1.5-P0决策定稿.md`（v1.2 文件保留为历史基线；前置决策层与正文冲突时以前置为准）
- Local reference root: `references/`
- CreatOK research root: `references/creatok/`
- Decision records: `docs/adr/0001~0007`（0002 已 superseded）

Standing preferences:
- 中文研究结论；代码、文件中的技术标识和 commit message 用英文。
- 充分对标、深度调研，再分布讨论。
- 优先下载源码、官方文档、网页快照和截图到本地，方便后续 agent 重复访问。
- 对登录态产品页使用 `opencli browser` 复用本机浏览器状态。
- 每次只领取并解决一个 wayfinder ticket。

## Decisions so far

- [CreatOK 基础资产准备与功能拆解](issues/creatok-baseline-assets-and-function-breakdown.md) — CreatOK 是面向 TikTok Shop/跨境电商的垂类内容工作台；我方应借鉴结构化工作流、资产库、任务历史、积分账本、Agent Skills 和官方发布页机制，不应照搬爆款复刻/真视频优先。
- [我方 P0 需求到对标维度矩阵](issues/our-p0-requirements-to-benchmark-matrix.md) — 已形成 100 分竞品评分矩阵；CreatOK 样例评分约 63.6/100，定位为“高产品化参考，低直接 P0 迁移度”。后续竞品需按门店知识、真实素材、内容生成、内容库、发布/账号、线索、合规、用量和架构统一评分。
- [CreatOK 对我方产品化与技术架构差距分析](issues/productization-and-architecture-gap-analysis.md) — 已将 CreatOK 机制拆成进入 P0、P1/P2 后置、不照搬和必须自研四类；P0 应落创作台主工作流、真实素材库、内容母体/平台变体、发布包、账号能力矩阵、Usage Ledger、内部 tools/workflows、合规审计和线索台账。
- [我方 P0 产品页面蓝图与工作流规格](issues/p0-product-ia-and-workflow-blueprint.md) — 已落成页面级 PRD 与低保真原型；P0 一级导航定为创作台、内容库、线索台账、门店档案、用量/套餐，核心状态覆盖内容、合规、发布任务、用量和线索。
- [我方 P0 数据模型与 API 合同规格](issues/p0-data-model-and-api-contract.md) — 已明确 Core API/Postgres 的产品事实模型、状态枚举、索引、API envelope、主要 endpoint、错误码和审计事件；App Shell、Agent Service、Worker Pool、R2 均不得拥有业务事实。
- 2026-07-07 五角度评审 + 六项拍板（产出：`合集-v1.5-P0决策定稿.md` + `docs/adr/0004~0007` + 旧工作区 analysis 00-16/ADR 迁入并批注）— ①医美=资质准入制·轻量版 ②部署=阶段化（验证期 CF+混用模型，落地触发点不预设）③架构 A（Workers 壳+单 Node 服务+托管 Postgres，ADR-0006 supersede 0002）+框架 B（AI SDK 起步、Mastra 推迟，ADR-0007）④L2 移出 P0、L3 做厚四件套 ⑤挂价 199/499+定金 Go 门槛、WoZ 指标修正 ⑥竞品图扩六分类、差异化收缩为"合规服务化+数据飞轮+陪跑"。评审全文 `references/analysis/plan-review-2026-07-07/`；CreatOK 架构实探 `references/creatok/reports/creatok-architecture-estimate.md`（Vercel+Next.js 16 全栈单体、Better Auth 坐实、火山 TOS 加速域、任务=提交+轮询+退款、零 agent 框架痕迹）。
- 2026-07-07 晚 易用性增补四采四否（已落 v1.5 修订摘要第 9 条）— 采纳：上传入口做重（PWA 桌面快捷+直达相机+自动建议标签）、召回=连接桥（NotificationBridge port：P0 飞书/企微 webhook 三钩子、P1 MCP 通用化、WoZ 陪跑群人肉 SOP+打开率探针）、首页拟人化一句话提醒（非 SaaS 待办卡片）、界面话术=专业口语折中；否决防复活：产品内语音输入（输入法已解决）、发布包店员转交、口播提词器、周报转发长图（无 App 载体）。
- 2026-07-07 晚 小云雀(剪映)×CreatOK 核心创作流程交互实测（登录态只读，报告 `references/benchmark/interaction-study-2026-07-07/interaction-patterns-xyq-creatok.md`）— 八大共性模式（技能卡才是小白主路径/prompt 封装成领域字段+示例 placeholder/参数全可自动/资产四类：素材·角色·商品/任务异步+整段级操作无时间线/生成明码标价）；两家共同空白="该发什么"的经营指引（用户实测 200 字 brief=我们 Agent 要替用户生成的目标物活样本）；实测真视频 15s 生成耗时约 18 分钟→P1 视频必须"提交即走+连接桥通知"；Agent 角色定位：竞品=执行者，我们=指引（周计划+brief 代写）为主、替代（prompt 工程/选题/合规初审）+加速（改稿 chips/变体/打标）为辅，佐证"本周内容"结构化入口第一、副驾对话第二的排序与 ADR-0007。**三件已落 P0（2026-07-08 拍板，v1.5 修订摘要第 10 条）**：场景技能卡+字段表单（03 §3.2）、预置示例美甲店（03 §3.1）、用量透明（05 §3）。
- 2026-07-08 UI 适配与组件选型研究（四路并行：本地基线/AI组件库横评/AI原生UX实践/shadcn生态映射，合成报告 `references/benchmark/ui-adaptation-study-2026-07-08/00-合成-UI适配与组件选型.md` + 4 分报告 + 17 份一手快照）— 底盘硬事实：mkfast=React19+TW4.1+**Base UI 版 shadcn 4.0（非 Radix，新组件用 render={} 禁 asChild）**、54 primitives、六界面覆盖 5🟢5🟡1🔴（L3 全新）、有 AI 调用零 streaming；选型=shadcn 官方主干+**prompt-kit 首选**（Base UI 下仅 5 处改写、价值中心零改写）+AI Elements 按需单件+**Streamdown+cjk 中文流式**，全部 copy-in 手动单件移植不跑整包；**RSC/streamUI 官方判实验性禁生产，路线=AI SDK UI（tool parts 三态+data parts reconciliation+useObject）**；避坑（一手核实）=assistant-ui（核心包焊死 9 Radix）/CopilotKit（AG-UI+Runtime 绑定）/AutoForm（无License）/Origin UI（AGPL）/Tremor（放缓）；唯一真风险=**PWA on TanStack Start 生产构建 SW 不生成**（Serwist 社区解法，Week-1 POC）；第一眼价值锚定=流式逐字+分步白话叙事+拟人化问候（全是最轻组件承载）；交互规范六条（四态任务卡+退款分层：技术失败自动退/不满意送重试、AI 预填可编辑默认值、undo 优先、合规四段式、学徒心智、AI 标注）。**回写 v1.5 九项已全部落定（2026-07-08 晚拍板"全部按建议落"，修订摘要第 11 条）**：placeholder→AI 预填可编辑默认值、组件选型定稿块（05 §3）、任务四态+退款分层、合规四段式（09 §5）、spike 三题扩五题、Day-0+iOS 两项、系统字体栈、undo 优先、示例内容质量=第一优先级（WoZ 优选沉淀）；风险登记册+PWA 行。二轮补充：第一眼五杠杆之首=**示例内容质量（文案即产品本体，比视觉重要；Google 17-50ms/美学-可用性效应/Fogg design-quality 三条一手证据）**；视觉点睛=Magic UI/Aceternity 限量 1-2 处；Drawer 走模板已装 vaul；bottom nav=新建。
- 2026-07-08 生成式内容平台降门槛研究（用户纠偏"太工程化不适合客群"后重做；即梦登录态实拆+可灵/Higgsfield文档级+prefill字段范式，合成 `references/benchmark/ui-adaptation-study-2026-07-08/01-合成-生成式平台降门槛与主入口调和.md`+3 findings）— 最强共识=降门槛是**取消提示词**(视觉预设卡+传图/一句话+一键出片)非帮写；门槛光谱 L0做同款占位<L1预设点选<L2对话追问<L3字段预填；核心张力=即梦"纯对话藏字段" vs 字段范式"预填表单"，裁决=我们经营内容须结构化骨架→**主入口调和四层**：场景卡墙(按业务目的分类)→做同款占位预填(非空表单)→对话追问→字段级编辑；传图优先打字/品牌音建信任/按产出量卖定价/价格字段不预填隔离/AI标注可解释；可灵官方样例即美发门店。**8项回写v1.5清单待拍板(1/2项=对已拍板主入口形态的调整)**；可灵/Higgsfield未登录深入,即梦登录态补证。
  - 二轮登录态实测(可灵+Higgsfield直证)+higgsfield-deep深拆 → 主入口升级为**L-1至L4五层梯度+三设计铁律**(定稿见 `01-合成-...md` §4)：L-1贴链接零表单入口(Url to Ad)/L0场景卡墙自带"该传什么图"引导文案/L1拆少数语义槽位(内容类型×**钩子Hook独立成槽=爆款开场脚本库,最高产品增量**×场景)非大预设墙/L0.5做同款=引导式向导(预置+逐槽确认非静默填满)/L4字段永不留空默认Auto+渐进展开;选中预设即隐藏提示词框(两家实测);Generate内嵌成本;Apps全栈builder不照抄。**10 项已全部回写 v1.5（2026-07-08，修订摘要第 12 条，主入口 L0-L4 四层落 03 §3.2）**。
- 2026-07-08 晚 **AI 原生骨架 + 分层买建 + 视频成片入 P0（D1-D5 全拍板并回写，v1.5 修订摘要第 13 条 + ADR-0008）**——触发=用户判 W0-W8 线稿"传统 SaaS 不 AI 原生"并升维到结构取舍；三源调研（KickArt 登录态+官方文档 / AgentKit 控制台 / ad_video_gen 源码三变体，合成 `references/benchmark/ai-native-journey-study-2026-07-08/02+03`，agentkit-samples 已 clone 留档）。**D1** 五层买建=模型买API/编排薄自建(抄三件套范式:state黑板+人话进度hook+评估抽卡)/体验自建/垂类自建/成片=模型端买+薄合成壳自建；**D2** KickArt=范式参考+视频路线第三候选,不订阅套壳(旗舰API ¥32.8万/年≈46家Growth才cover+合规控制点必须自控;其企业定价16800/月起证"范式可抄商业模式不可抄";同厂演进智能创作云→KickArt=骨架切换最强旁证)；**D3** 分页骨架="1 Agent工作台+3轻侧栏资产页"(工作台三段=拟人开场建议chips/中央意图框三喂料/创作流时间线brief卡→旁白→候选→预审→产物卡;两处轻确认=对官方样例零确认黑盒的差异化;两条supersede=副驾浮球取消+"结构化第一对话第二"改写"对话式外壳结构化内核";L0-L4换容器保内核)；**D4** 货架=chips一行+展开、候选按媒介分层(文案3选1+换一批/成片单发+免费重试)；**D5** 视频成片=P0主打(用户修正拍板):AIDA分镜→首帧→Seedance/即梦片段→ffmpeg薄壳合成+AIGC标识烧录,durable异步/存储标识链/视频额度三上提,spike六题,Scope Lock 保7缓6→**保8缓4**。W0-W8 线稿 v1 作废待重画 v2（W5-W8 结构可保留）。

## Fog

- **待研究专项：连接识别店铺/团单信息**（贴大众点评/美团/抖音团购链接自动录入店铺档案+项目价格）— 产品价值成立（最低门槛建档，对标 Higgsfield Url to Ad），但**服务端抓取中国平台不可靠**（2026-07-08 实测：点评裸抓 302 风控 + JS 动态渲染 + 价格字体加密 + 无第三方 API；opencli 能抓是借本机登录态浏览器≠产品服务端）。待研究技术方向：①商家授权 API（美团/点评商家后台/抖音来客，最合规）②商家侧授权登录态抓取（触凭据托管，须与凭据保险库/L2 群控 260 万判例红线一并评估）③第三方数据聚合采购 ④无头渲染服务。P0 降级替代=截图 OCR（冷启动已有）+粘贴文本。详见 `references/benchmark/ui-adaptation-study-2026-07-08/01-合成-生成式平台降门槛与主入口调和.md §4.1`。教训=Higgsfield 海外能力想当然平移未做外部现实轴检查。

- 还需要继续补齐同类产品矩阵：新增的第五类（番薯侠/我赢 AI 等垂类工具）与第六类（微盟 WAI/有赞智能助手）待登录态实测拆解并按 100 分矩阵评分；平台原生 AI（抖音来客/小红书聚光）待商家侧实测。
- 开源与官方文档快照：Mastra/mkfast/TanStack 已有；待补 Vercel AI SDK（v5/v6）与 promptfoo 官方文档快照、satori CJK 渲染验证样例。
- 小红书/抖音医美类目商家侧发布权限：Week-0 用真实认证商家账号实测（ADR-0004 前置项）。
