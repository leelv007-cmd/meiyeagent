---
title: vozeb 借鉴落地与 Pro Studio 升单线实施规格
status: ready-for-agent
triage: ready-for-agent
date: 2026-07-16
revision: 2 (2026-07-16 晚,经 6 路 Codex 交叉复核修订;裁决材料 `.scratch/spec-codex-review-2026-07-16/`)
source_of_truth:
  - 评审主文档:`references/analysis/vozeb-方案合集-2026-07-16.md`(§8 决策定稿 + §9 画布迁移定稿)
  - 4 路交叉验证:`.scratch/vozeb-canvas-migration-2026-07-16/reports/r1.md`、`r2.md`、`r3.md`、`r4.md`
  - Codex 16 票深调研:`.scratch/vozeb-product-reference-wayfinding/`(采用终裁 assets/14、路线 assets/15、主报告 assets/16)
  - ADR-0011 ContentPackage 唯一成品聚合
  - `docs/specs/contentpackage-productization-spec.md`(主线 N1 事实基线,本规格不重开)
  - ADR-0012 Composer 与 Pro Studio 两线产品边界
  - CONTEXT.md(画布作品 / 作品编辑上下文 / Generation Job 契约)
  - 用户 2026-07-16 晚补充拍板:采用同选区只落一次 / Pro Studio=加购项 / Audio=TTS+音效 / Agent 动词全集含改删
---

# vozeb 借鉴落地与 Pro Studio 升单线实施规格

> **领域合同保留、实现入口已取代（2026-07-22）**：本文继续拥有两线边界、ContentPackage adoption、工程生命周期、计费/安全和商业 release gates 等原始领域合同；画布 parity、ports/copies 治理、用户侧模型选择、Canvas ZIP 导出与 Agent 外壳拆分由 D-099 rev2 重新裁决。当前实现不得从本文的“首发含 Agent/Audio”表述直接拆票，实施顺序与验收以 [`pro-studio-parity-rework-spec-2026-07-22.md`](./pro-studio-parity-rework-spec-2026-07-22.md)、G01–G48 baseline 和 K1–K7 票包为准。

> 本规格是《vozeb 方案合集 2026-07-16》全部已拍板决策的工程落地口径。两条产品线:**主线**(L1 门店旅程,由 ContentPackage 产品化规格拥有,本规格只承接从 vozeb 借来的增强项)与**升单线**(L3 Pro Studio:无限画布 + 图片精修整套授权复用 + Audio + 画布 Agent,本规格的主体)。P1 Composer 的自由画布语义已收窄为日常轻编辑；首发范围含 Audio(TTS+音效)与 Agent(动词全集含改/删),整体量级如实计为 XL(详见实施决策 §12 的诚实口径:约 23-36 人周)。

## Problem Statement

面向陪跑培训、中高阶商家的升单客群,当前产品只有面向非专业商家的日常工作台(Composer),没有一个高自由度的定制创作工作台:

- 熟练运营做"多分支探索式"创作(一张参考图派生多个方向、反复精修再择优)时,只能反复导出到外部工具,创作过程资产全部流失在产品外。
- 图片精修(局部蒙版重绘、裁切、切图、放大)在产品内没有对应能力,商家拿到 AI 生成结果后"差最后一步"就得离开产品。
- 陪跑培训需要一个能现场演示"专业玩法"的工作台作为升单抓手,当前没有可卖的高阶档,也没有对应的加购收入位。
- 已获授权的 vozeb 实现(无限画布 13k 行 + 精修全套)功能密度高,但它是单机自托管产品:画布工程存在浏览器 localForage、媒体二进制存在浏览器 IndexedDB、任务是进程内 Map、计费是请求级积分、后端有任意路径代理与客户端自授权洞——直接搬进 SaaS 即背债。
- 我方现有 Polotno 页式编辑器与 vozeb 节点图不在同一层(版式定稿 vs 生成探索),"用 vozeb 取代 Polotno"已被交叉验证证伪;若不给 Polotno 一条有门槛的退役路径,会长期养两套编辑器,而其中承载的水印/AIGC 标识烧录是合规义务,断档即违规。

## Solution

产品形成**两档工作台**:日常应用工作台(Composer,快出活)+ 高阶自由度定制工作台(Pro Studio,vozeb 画布)。两档产出汇入同一个 ContentPackage 唯一成品体系。

- Pro Studio 以独立全屏子域打开(从主应用一键进入、免二次登录),画布渲染内核与图片精修工具**整套原样保留**;接入层(外壳、鉴权、持久化、后端适配)按 SaaS 标准重建。
- Pro Studio 是**独立加购项**(用户拍板):工作区购买后解锁,不进门店默认导航;未购买用户看到有说明与购买路径的介绍位,不是死链。
- 画布工程(AdvancedCanvasProject)与其媒体全部服务端化:工程 JSON 入 Postgres、媒体二进制入自有对象存储成为 Asset——跨设备可恢复、用户/工作区隔离、带不可变工程 revision。
- 画布内全部生成(图片/蒙版重绘/自由文本/反推/视频/Audio)走我方 Model Supply 与持久 Generation Job,计费走双账 ledger(reserve→commit/release),媒体结果落 OwnedAsset,文本结果落 durable text deliverable。
- 画布产出通过显式"采用"命令落为 ContentPackage(新建或在既有成品上开新版本),唯一成品原则不变;同一 revision 的同一选区只落一次(用户拍板),画布工程是创作过程事实,不是第二种成品。
- 首发含 Audio 全链(TTS+音效,新模态端到端)与在线画布 Agent(服务器侧 allowlist 动词全集含改/删,逐命令确认)。
- Polotno 走"立即冻结 → Composer 吸收日常轻编辑 → 过五条删除门槛后退役";vozeb 专心高阶档,不接页式版式定稿的活。
- 主线同步吸收 vozeb 借鉴项:Provider 协议**借代码作脱敏 fixtures** 与探测 UX、媒体 custody 表达、薄 Ops 信息架构与额度解释、最后管理员保护/离线改密不变量照搬。

## User Stories

### Pro Studio 权益与进入(加购项)

1. As a 单店商户(工作区 Owner), I want 为工作区购买 Pro Studio 加购项并立即解锁, so that 升级路径清楚、不用找客服开通。
2. As a 单店商户, I want 未购买时看到 Pro Studio 的介绍、演示与价格入口而不是死链或隐藏, so that 我知道这个高阶档存在、值多少钱。
3. As a 中高阶商家运营, I want 从主应用一键进入 Pro Studio 且不用二次登录, so that 高阶工作台是产品的一部分而不是另一个网站。
4. As a 中高阶商家运营, I want 从某个既有成品/素材"带上下文进入"Pro Studio 继续深加工, so that 高阶修改围绕我已有的东西展开而不是从零开始。
5. As a 中高阶商家运营, I want 从 Pro Studio 返回时回到我来时的对象(成品/素材/工程列表), so that 两个工作台之间不迷路。
6. As a 陪跑培训师(以学员工作区内已授权成员身份), I want 在学员门店的工作区内演示 Pro Studio, so that 培训场景直接用真实数据讲解升单价值。

### 工程管理

7. As a 中高阶商家运营, I want 我的画布工程与其中媒体都保存在云端并按工作区隔离, so that 换设备、清浏览器缓存后工程与图片仍在,别人看不到我的工程。
8. As a 中高阶商家运营, I want 新建、重命名、复制、删除画布工程并看到工程列表, so that 我能管理多个进行中的创作项目。
9. As a 中高阶商家运营, I want 删除工程走软删除且已被成品引用的工程保留溯源, so that 误删可挽回、成品来源不断链。
10. As a 中高阶商家运营, I want 显式保存检查点(不可变 revision)并能回看/恢复, so that 我能回到某个确定状态,采用成品时引用的是冻结版本而非"最新一瞬"。
11. As a 中高阶商家运营, I want 离开画布时若有未保存变更得到提醒, so that 我不会丢工作。
12. As a 中高阶商家运营, I want 画布主题跟随主应用的深浅色设置, so that 两个界面像同一个产品。

### 无限画布创作

13. As a 中高阶商家运营, I want 在无限画布上自由摆放文本、图片、配置、视频、音频节点并连线, so that 我能把"参考 → 提示词 → 生成 → 精修 → 择优"的探索过程可视化地组织出来。
14. As a 中高阶商家运营, I want 连线决定生成的输入上下文(沿入边收集文本/图片等作为生成条件), so that 一次实验的输入关系明确可追。
15. As a 中高阶商家运营, I want 框选、多选拖拽、无限缩放、撤销与快捷键, so that 大型工程的操作效率有保障。
16. As a 中高阶商家运营, I want 从我方素材库挑选素材插入画布, so that 门店真实照片能直接进入高阶创作。
17. As a 中高阶商家运营, I want 把画布里满意的生成结果一键存回我方素材库, so that 过程产物能沉淀为可复用素材。

### 图片精修

18. As a 中高阶商家运营, I want 对画布上的图片节点做局部蒙版重绘, so that 我能只改画面的一部分而不重生成整张。
19. As a 中高阶商家运营, I want 裁切、切图、放大(超分)图片节点, so that 常见精修不用离开产品。
20. As a 中高阶商家运营, I want 用参考图驱动图片编辑, so that "照着这张的风格改"这类高频诉求可以直接表达。
21. As a 中高阶商家运营, I want 精修结果作为新节点出现并保留与原图的派生连线, so that 我能对比多个精修方向再择优。

### 画布内生成(图片 / 文本 / 视频 / Audio)

22. As a 中高阶商家运营, I want 在画布内提交图片生成并看到任务进行中/成功/失败状态, so that 我不用盯着刷新。
23. As a 中高阶商家运营, I want 刷新页面或换设备后,工程内全部生成任务状态仍能按工程恢复, so that 长任务不会因为我关了页面而丢结果。
24. As a 中高阶商家运营, I want 自由文本生成与"图片反推提示词", so that 我能从一张好图反推出可复用的提示词。
25. As a 中高阶商家运营, I want 画布内提交视频生成(含按供应商能力声明的高级参数), so that 高阶视频实验不用出走别的工具。
26. As a 中高阶商家运营, I want 画布内生成配音(TTS)与音效并可试听、下载, so that 视频合成与内容创作的声音环节在产品内闭环。
27. As a 中高阶商家运营, I want 从内置的美业场景提示词起点开始生成, so that 首次上手不用面对空白输入框。
28. As a 中高阶商家运营, I want 生成前看到额度报价提示、失败自动退还并有人话解释, so that 花的每一分额度可解释、不为失败买单。
29. As a 平台运营者, I want 查看画布线的成本、用量、失败率与账实对账差异, so that 高阶档的经济账和主线同一套口径可观测。

### 采用为成品(与主线的唯一产品接缝)

30. As a 中高阶商家运营, I want 选中画布上的文案与若干张图/视频,显式"采用为成品", so that 探索的最好结果进入正式内容库。
31. As a 中高阶商家运营, I want 采用时选择"新建成品"或"作为既有成品的新版本", so that 画布既能开新内容也能迭代旧内容。
32. As a 中高阶商家运营, I want 同一张工程图的不同分支选区各自采用为不同成品,而同一选区重复采用回到同一成品, so that 多分支都能变现且不会误产重复成品。
33. As a 中高阶商家运营, I want 已采用的节点显示"已采用"徽标并可点击跳转到对应成品, so that 我知道哪些分支已经落地。
34. As a 单店商户, I want 从 Pro Studio 采用来的成品和日常工作台产的成品在同一个内容库、同一套版本/导出/复用体系并真的能编辑版本、导出、复用, so that 我不用关心它是哪个工作台产的。
35. As a 平台运营者, I want 每个成品版本保留到画布工程版本的结构化溯源引用, so that 审计能回答"这个版本来自哪次创作"。

### 画布 Agent(首发含,在线助手,动词全集)

36. As a 中高阶商家运营, I want 画布内的 AI 助手能按我的意图新建/修改/删除节点、连线/断线、触发生成, so that 复杂编排可以用自然语言加速。
37. As a 中高阶商家运营, I want 助手的每个改动命令在执行前展示真实 diff、涉及资产与费用上限并经我确认, so that 助手不会背着我改画布或花我的额度。
38. As a 中高阶商家运营, I want 助手执行结果明确区分"已执行/画布已变化/出错"且失败命令不产生半成品改动, so that 我始终知道画布状态和助手动作的对应关系。
39. As a 平台运营者, I want 助手全部动作有审计事件并可按工程/用户查询, so that 出问题能还原全过程。
40. As a 平台安全负责人, I want 助手命令绑定画布快照版本并原子消费确认凭据、两个并发会话互不串写, so that 并发编辑下不会出现覆盖或越权写。

### 计费、额度与安全(Pro Studio 侧)

41. As a 单店商户, I want Pro Studio 的消耗与主产品共用同一套额度与账单, so that 我不需要理解第二套计费。
42. As a 平台安全负责人, I want 画布前端只持有不透明的任务/资产 ID、不能提交供应商地址/渠道/路径, so that 前端被攻破也拿不到供应商凭据、打不到内网。
43. As a 平台安全负责人, I want 跨工作区访问工程/资产/任务/成品/授权/确认凭据全对象被硬拒绝并留审计, so that 多租户隔离在高阶档不降级。
44. As a 平台安全负责人, I want 参考图对供应商的临时公网可读授权是短时、绑定任务、到期即回收且不可被缓存的, so that 素材不会变成长期公开 URL。

### 日常档与 Polotno 退役(主线侧)

45. As a 单店商户, I want 在日常工作台里直接完成改文案、换图、裁剪、模块排序、预览、保存版本、导出并进入内容库, so that 日常轻编辑不需要进任何"编辑器软件"。
46. As a 单店商户, I want 导出的图片始终带水印与 AIGC 标识, so that 我发出去的内容合规。
47. As a 单店商户, I want 历史画布作品在过渡期仍能打开与导出, so that 老作品不因内部换引擎而报废。
48. As a 单店商户, I want 所有创作入口都不再把我导向重型编辑器且 Pro Studio 不出现在默认导航, so that 非专业用户的默认路径始终是轻的。

### 主线借鉴项

49. As a 平台管理员, I want 接入新模型供应商时有脱敏协议语料(fixtures)与"配置→探测→留证"的探测流程, so that 接供应商不在真实计费路径上试错。
50. As a 平台管理员, I want 素材带来源标签(源素材/自有副本)且可对账、missing 可修复, so that 媒体资产的托管状态可解释。
51. As a 平台管理员, I want 平台不能删掉最后一个管理员、支持离线改密, so that 运维不会把自己锁在门外。
52. As a 单店商户, I want 额度与成本的解释是人话(这次预计花多少、实际花了多少、为什么、失败退了多少), so that 我信任计费。
53. As a 平台客服, I want 不进数据库就能在薄 Ops 后台按商户查任务、额度与失败原因, so that 支持效率不依赖研发。

> 注:原 rev1 中的"统一任务账务体系""服务器侧固定动词表""不安全模式不进构建""五门槛后才移除 SDK"四条系伪故事,已按 r6 裁决移入实施决策与发布门禁(§5/§7/§8/§13),不再占用故事位。

## Implementation Decisions

### 1. 范围、两条线与代码碰撞事实

- 本规格承接《vozeb 方案合集 2026-07-16》全部拍板:升单线(Pro Studio)为主体;主线含借鉴项与 Polotno 退役路径。主线 N1 门店旅程本身由 ContentPackage 产品化规格拥有,不重开、不重复;**N2 生产恢复门虽由独立工作实施,但"付费即触发、无豁免"——Pro Studio 作为加购项收真钱,其对外发售以 N2 过门为硬依赖**。
- 双线并行指资源池与客群分开;**代码层面升单线必然修改共享资产**:contracts(modality/operation/Asset mediaType/ContentPackage source/命令 schema)、core(Application Service/Model Supply/账务/PG repository/wiring)、主 Web(入口/启动码/素材选择/成品回跳)、根脚本与 E2E 编排(新增 canvas 服务)。实施采用 **contracts-first 合并顺序**,共享文件改动由主线侧 owner 评审,不假装零碰撞。
- 复用口径:获授权的画布渲染/精修 core **整套照搬不改造**;Vozeb 后端/业务 runtime（auth、JSON/Map 事实、代理、Points、Agent bridge）直接复制=0。接入层(应用壳、宿主接口、鉴权、持久化、后端适配)允许且必须重建。**媒体事实源服务端化与内核直接相邻**(见 §4),同属不可豁免改造,不止工程 JSON 一处。
- 授权前提:两位作者授权渠道已确认可用;实施须建立**精确 upstream commit + 直接复制文件 manifest + 每文件授权覆盖状态**,A2/A3 书面授权门是合入与发布前的硬门,不阻塞开工但阻塞"完成"。

### 2. 接缝(最高优先,总数最小)

- **复用现有最高接缝:Product Core Application Service。** 采用命令 `adopt_advanced_canvas_output` 与画布线全部领域命令/查询都进这同一接缝;Canvas 服务侧不建第二套资产/账务/任务/采用状态。
- **CanvasBackendPort = 单一同源门面 `/api/canvas/*`,定位为薄 BFF**:会话换取与可信上下文、schema 适配、一对一转发到 Application Service、把供应商字段挡在门外。**冻结 action 全集**(按能力组):
  - 会话:exchangeLaunchCode、getSessionContext(user/workspace/entitlement/theme/locale)
  - 工程:listProjects、createProject、renameProject、duplicateProject、deleteProject、loadProject(含该工程生成任务的权威合并投影)、saveProjectDraft(带 expectedDraftVersion)、createCheckpoint、listRevisions、getRevision、restoreRevision
  - 素材:listAssets、getAsset、getAssetDelivery(含 Audio 播放/下载的 Range/MIME 合同)、persistLocalCanvasArtifact(仅承接裁切/切图等**纯前端派生文件**;生成产物由 Job 自动持久化,客户端不得二次声明权威)
  - 生成:getCatalog(含 capability/高级参数声明)、quoteGeneration、submitGeneration、getGenerationJob、listProjectGenerations、cancelGeneration
  - 采用:adoptOutput(转发领域命令)、listAdoptions(节点↔成品关系,供"已采用"徽标与跳转)
  - Agent:planAgentOps、confirmAgentOps(消费确认凭据)、applyAgentOps(带 expectedRevision)、listAgentAudit
  - 用量:getUsageProjection
- 每个 action 必须给出 method/path、request/response schema(unknown 字段严格拒绝)、幂等键位置、401/403/404/409 错误矩阵——**这是 spec 的一部分,实施首个里程碑(M0)完成并冻结**;"表外 404、禁字段即拒"以该表为测试对象。禁止字段指结构化字段(channelId/baseUrl/serverUrl/apiKey/供应商路径),不误伤提示词正文。
- **CanvasHostBridge 降级为条件接口**:首发形态是顶层子域同标签导航,主应用运行时已不在,故首发**不启用** HostBridge——主题/工作区/返回目标经启动码兑换的 bootstrap 上下文传递,未保存提醒由画布本地 beforeunload 承担,素材与采用只走 BackendPort。仅当 iframe 或保留 opener 的形态启用时,才激活 HostBridge(届时必须定义 transport、origin 校验、握手 nonce、消息 schema 与窗口生命周期,并执行 frame-ancestors/postMessage.origin/最小权限)。

### 3. 部署形态与鉴权(不可降级条款)

- 首版 = **独立 Next Node 服务**,全屏子域(canvas.<域名>)顶层打开。CF Workers 不能原样承载(vozeb 服务端依赖本地文件持久化);M1 完成迁移后做一次构建验证,重新确认运行时约束,不把旧本地文件实现永久固化为部署依据。
- 最小嵌入 layout:剥离 vozeb 顶栏/积分/退出/管理员入口,保留画布工具顶栏;M1 验收 = 上游账户/积分/管理员 UI 在 DOM 与 bundle 均不存在、主产品返回/主题/语言/当前工作区可见、100% viewport、未登录/过期码/无工程/加载失败均有产品态。样式保留 antd,不做 shadcn 重写。
- **启动码协议**(冻结):分为两种 audience——`workspace`（工程列表/新建入口，仅绑定主会话、workspace 成员关系；后续每个 project/revision/action 重新鉴权）与 `project`（从既有工程/成品/素材带上下文进入，额外绑定 project 归属）。主 Web 签发时必须显式声明 audience，不能依赖“第一个 workspace”或缺省猜测。CSPRNG 生成、PG 只存 hash、30-60 秒 TTL、数据库原子消费(并发兑换仅一个成功);经顶层 form_post 传递,禁止进入 query/fragment/Referrer/日志/分析;兑换端在 Canvas Next 服务,兑换时绑定浏览器侧 nonce cookie(防窃码兑换),签发 `__Host-` 前缀、host-only、HttpOnly、Secure、SameSite=Lax 的画布会话 cookie,不设父域 Domain。
- **部署合同门禁**:在 M0 结束前冻结 production/staging canvas host、主站 origin、form_post action、allowed Origin、CSRF/HostBridge origin 清单；`canvas.<域名>` 只是占位符，不得作为可执行生产配置。
- 画布会话:定义 idle/absolute TTL;主应用登出、账号禁用、成员移除、切换工作区后,画布会话在明确上限内联动失效;所有写操作过 CSRF 防护(token + Origin/Fetch-Metadata 校验);CORS 默认关闭。
- Canvas 服务以**服务身份**访问 Core(复用既有可信服务头模式),不信任浏览器携带的 workspace 声明;每个 action 服务端重新鉴权对象归属(project/revision/asset/job/package/grant/confirmation 全对象)。
- Pro Studio 独立服务**不开放**独立注册、密码登录、首用户提权与独立管理员后台;用户/角色/成员关系只来自主应用(vozeb A5 反面教材的隔离)。
- 浏览器缓存约束:所有本地缓存 key 含 `userId+workspaceId+schemaVersion`;登出/切账号/切工作区时清理敏感 IndexedDB/localForage/Blob 缓存、中断在途轮询、跨 tab 广播、以 session fence 丢弃迟到响应;Service Worker 不缓存鉴权 API 与用户媒体。
- SPA 抽取(脱 Next 嵌 Vite)是运行稳定后的中长期收敛选项,不是首发形态。

### 4. 领域模型与工程生命周期

- 节点图与页式文档**不能无损互转**:不做模型合并,不做 `pages | graph` 联合类型。"画布作品"契约**只继续适用于页式 LayoutWork**;AdvancedCanvasProject 是独立聚合,不套用该契约,只有"作品编辑上下文"的原则延伸过来。
- **工程生命周期(冻结)**:自动保存写**可变 draft**(带 draftVersion,保存用 expectedDraftVersion 做 CAS,冲突返回固定冲突码);**不可变 revision** 仅在三处产生——用户显式检查点、采用命令、Agent applyOps;viewport/选区/面板开关属 UI session,不进 revision。恢复检查点 = 以旧 revision 内容开新 draft,不改写历史。
- **编辑上下文为新增正式契约**(实现 CONTEXT 语义,当前代码无此类型):

  ```ts
  type EditingContext =
    | { kind: 'layout_work'; workId; revisionId }
    | { kind: 'advanced_canvas'; projectId; revisionId }
    | { kind: 'asset'; assetId };
  ```

- **Generation Job**:契约保留(vozeb 进程内 Map 不满足恢复合同)。拍板为**泛化现有 CanvasImageJob 的来源绑定**——从强制 workId/workRevisionId 改判别式 origin(layout_work | advanced_canvas),只有 layout_work 来源才回写页式 Work revision。**如实的爆炸半径:约 11 个生产文件 + 5 个测试文件**(应用服务/模块/仓储/类型/前端任务与历史投影),含 latest 查询语义、`payload->>'workId'` 表达式索引迁移与旧数据 backfill,在 M2 前以 contracts+迁移先行落地。
- **采用命令**(与用户拍板对齐后的定稿):

  ```ts
  adopt_advanced_canvas_output({
    projectId,
    revisionRef: { kind: 'frozen'; revisionId } | { kind: 'freeze_current_draft'; expectedDraftVersion },
    selection: { textNodeId?, orderedMediaNodeIds },  // 顺序即成品媒体顺序,不得排序归一
    target: { kind: 'new_package' } | { kind: 'existing_package'; packageId; baseVersionId },
    idempotencyKey,
  })
  ```

  - `freeze_current_draft` 在命令内原子冻结并返回 revisionId,消除"传入尚未存在的 revision"循环。
  - **业务唯一性(用户拍板"同选区只落一次")**:同一 `projectId+revisionId+selection(文本节点+有序媒体节点原序)` 至多产生一个成品/版本;重复采用(无论幂等键、也无论 `new_package` 或 `existing_package` target)返回首次结果或固定 `ADOPTION_ALREADY_EXISTS`，包/版本/关系/审计零副作用。要产出另一个成品,改选区或出新 revision。调用级幂等沿用现有"key+完整 payload hash,同 key 异 payload 返回 IDEMPOTENCY_CONFLICT"。
  - selection 约束:`orderedMediaNodeIds` 非空(image_text 成品另要求 textNodeId 存在);服务端验证所选节点 assetId 已入自有存储、关联 Job 达可交付终态、节点属于该 revision。
  - **采用清单**(恢复 r1 原裁决,不许实现者猜):正文快照、有序 Asset IDs、child Job IDs、来源 Asset IDs、项目 revision——经 Application Service 原子建包/建版本并同步写入 `source.assetIds` 与版本 `orderedAssetIds`；顺序以 `orderedMediaNodeIds` 为规范顺序，节点删除/未知节点导致冻结校验失败，不得静默重排或丢弃。
- **溯源为版本级**(修正 rev1 包级设计):每个由画布采用产生的 `ContentPackageVersion` 携带不可变 `sourceRef.advancedCanvas{ projectId, revisionId, selectedNodeIds, orderedMediaNodeIds, schemaVersion }`;`selectedNodeIds` 必须保持节点选择与媒体顺序契约，`orderedMediaNodeIds` 不排序、不去重后再解释；包级不维护会被覆盖的单值。`schemaVersion` 首值 = 1,未知更高版本读取时降级只读展示、不拒绝加载;老成品不回填。`advancedCanvas` 参与 `hasSource` 判定,保证新包不落 `needs_input` 死路。不复用现有面向 CreativeWork 三候选的采用命令。
- **媒体事实源服务端化(与工程 JSON 同为硬前提)**:vozeb 图片/视频/音频二进制在浏览器 IndexedDB(image_files/media_files),导入、裁切、切图、超分、蒙版产物必须转为 OwnedAsset,storageKey→AssetId 迁移与 hydration 进 M1/M2;chatSessions 归 Agent 审计域,viewport 归 UI session,不入 revision。
- **工程删除/复制语义**(冻结):删除 = 软删除 + 保留期;被任一 ContentPackage sourceRef 引用的工程与 revision 不可物理清除(归档保溯源);删除不影响已产出的 OwnedAsset 与成品。复制 = 仅复制当前草稿节点图,引用同批 OwnedAsset,不复制 revision 历史/Agent 会话/采用关系。
- "已采用"徽标只读 ContentPackage 关系(listAdoptions 投影),节点上不维护第二套 accepted 状态。

### 5. 后端能力映射、计费状态机与反面教材隔离

- 能力口径按业务能力(7 已有/9 需扩展/4 真缺口),逐条映射矩阵以 r3 报告 20 行表为准(见 source_of_truth),spec 不复述但视为约束;"提示词库缺口"精确指**用户可检索提示词库**(我方已有内部 copy prompt revisions,非同物)。
- **计费状态矩阵(冻结,替代一句 reserve→commit/release)**:job/reservation 未持久化不得 dispatch;供应商接单前明确拒绝→release;accepted/未知→保持 reserved,不因 2xx/SSE 建连/客户端超时结算;媒体成为可读 OwnedAsset→commit;**文本结果成为 durable text deliverable→commit**(text.respond 不产 Asset 也能正确结算,修正 rev1 总纲);失败/无交付→release 且 Provider Cost 独立记账;provider 成功但下载/存储失败→保持 reserved 只重试下载,禁止重新生成;取消待确认→reserved,确认后 release;取消后迟到成功→不重开用户结算,隔离保存;状态未知→reconcile,不得 TTL 自动释放后重复 dispatch;多结果部分交付→按实际交付 commit、余量 release;commit/release 互斥且持久幂等。现有 Core 已实现的取消/迟到终态/下载重试语义声明为**不可降级不变量**。
- **dispatch 顺序(A7/A9 隔离)**:同一事务创建 job+请求指纹+reservation+attempt+outbox,提交后 worker 才可访问供应商;客户端丢创建响应以幂等键查询原 job,不重建;并发槽与额度原子占用,禁止先 count 再 create;仅"确认未接单未计费"的错误可 fallback,生产计费链禁协议试探。
- **统一 safe-fetch(A1/A4 隔离,替代通用代理)**:所有服务端远程抓取(供应商结果/参考图/Audio)仅允许配置内 provider/CDN host;DNS 全记录校验拦截私网/loopback/metadata 并防 rebinding;redirect manual 逐跳复验限跳数;不外带 Cookie/Key;超时+双重大小限制+并发限制;MIME allowlist+magic-byte 验证;不接受客户端 poll_url/绝对 URL/requestTemplate;资产响应带可信 Content-Type + nosniff + 私有缓存。若 Core 现有 provider result delivery 尚未覆盖上述 safe-fetch，不得以“通用 Egress 尚未触发”为理由绕过；需将该 provider-safe-fetch 作为 N2/N6 发布依赖，通用用户 URL/可配 endpoint 仍保持证据触发。
- 三反面教材整条拒绝迁移(不变):任意路径代理→固定 action;客户端 serverUrl 自授权→前端只碰不透明 ID,日志为 canonical history 只读投影;Points 请求级结算→双账 ledger。蒙版用有角色的 mask Asset ID;视频高级参数按 capability 显式声明。
- **ProviderReferenceGrant 条件式建设**(仅当真实供应商确认不收 data URL):token≥128bit 只存 hash、全链路脱敏;仅 GET/HEAD 且限次数/字节/并发/Range;响应 `Cache-Control: private, no-store`(不得复用现有资产门面的一年 immutable 缓存);每次读取复验 expires/revoked/rights/workspace/job/attempt,存储不可用 fail closed;接单/TTL 回收幂等 + 定时 janitor;rights 撤回联动撤销;canonical origin 不信任 Host 头;spec 诚实声明:bearer URL 在 TTL 内任何持有者可读,如需真受众认证须另加 mTLS/签名/egress allowlist。
- 自由文本与反推 = 新固定业务操作 `text.respond`(服务器选模型、文本+授权 Asset 输入、持久任务、计用量、结果写画布文本节点),不映射三候选 copy,不开任意 passthrough。

### 6. Audio 首发全链(用户拍板:TTS + 音效都要)

- 两个独立操作合同:`audio.speech`(TTS:voice/语言/语速/音色/格式/时长上限)与 `audio.sfx`(音效:文本描述/时长/格式);各自 catalog 条目、provider adapter、任务恢复、计费单位。供应商选型与真实凭据激活是 M3 前置门(configure→probe→留证),探测不过则该操作不开放,不做假可用。
- Audio OwnedAsset 与 MIME 扩展;`Asset.mediaType` 加 audio;**如实爆炸半径:modality/operation/UsageResource/OwnedAsset MIME/mediaType 等穷举 union 在 contracts、core、前端至少 20 个生产/测试文件**,M3 前以 contracts 先行。
- **内容安全合同**:允许的 container/codec/MIME/扩展名 allowlist;服务端 magic-byte+实际解码验证;大小/时长/码率/采样率/metadata 上限;隔离转码不拼 shell;随机 object key+私有存储+workspace 授权;ID3 等 metadata 仅转义展示;播放走 getAssetDelivery(验证后 Content-Type、nosniff、私有缓存、受控 Range),下载用安全 Content-Disposition;CSP media-src 限可信源;provider 音频 URL 同过 safe-fetch。
- 音频现阶段服务视频合成与画布内复用;**独立音频成品类型**需扩产品范围另行拍板,不在本规格。

### 7. 画布 Agent 首发形态(用户拍板:动词全集含改/删)

- **服务器侧 allowlist 动词全集(冻结)**:`read_canvas`、`create_node`、`update_node`、`delete_node`、`connect_nodes`、`disconnect_nodes`、`run_generation`;viewport/选区类操作为 UI-only,不入服务端合同、不产生 revision。每个动词冻结参数 schema、返回、权限与副作用声明;不转发模型侧任意 tool schema,`apply_ops` 的 payload 经服务端 schema 严格校验。
- **确认凭据合同**:逐命令确认;凭据绑定 user/workspace/session/project/base revision + 规范化 op 列表 hash + 读取依赖集(输入 Asset 版本/授权、baseVersion、角色、额度报价、capability)+ 最大成本与生成数上限 + TTL + 一次性 nonce;服务端持久化、原子消费;执行时重新鉴权,任一 read-set 变化整体拒绝并要求重新确认;确认 UI 展示真实 diff/资产范围/费用上限,限制批量连发防确认疲劳。
- `applyAgentOps` 全部成功或全部回滚(三态:executed/changed/error 互斥语义在 M0 合同中定义);带 expectedRevision,双会话并发以数据库乐观锁裁决,败方零写入;`run_generation` 经事务 outbox,费用发生须在确认信息中显式列明。画布文本/素材 metadata/模型输出一律视为 prompt-injection 输入,不得影响工具授权。
- vozeb 本地 Agent 桥的不安全模式(URL 携带 agentToken、localStorage 存 token、自动连接静默关确认、通用 shell)**不进 SaaS 构建**,以构建产物负向扫描落实(§13),不靠文档声明。Agent 量级如实记为 **H 增量**(叠加在 Audio 之上)。

### 8. Polotno 处置(冻结 → Composer 吸收 → 退役,五门槛判据定稿)

- 立即冻结:只维护现有作品打开/保存/导出。Composer 吸收日常轻编辑最小闭环(改文案、换图/裁剪/适配、模块排序、即时预览、保存 revision、导出并烧录合规标签);自由连线/任意节点/复杂图层留高阶档。领域契约不随 SDK 退役。
- **五条删除门槛(全过才移除 SDK,判据冻结)**:
  1. 轻编辑接管:E2E 走通"建模板→改文案→换图/裁剪→排序→保存 revision→导出→进入 ContentPackage"完整闭环,日常流量 100% 不调用 Polotno。
  2. 历史 Work:线上 Work/Revision/Template 100% 盘点(数量、页面数、element kind、未知字段、最后编辑时间、导出记录),逐类裁定"可转换/只读打开/raster 回退",全部可打开可导出。
  3. 合规渲染:水印/AIGC 标识四种开关组合对导出二进制与 receipt/evidence 断言通过,新旧渲染器对照样本一致——合规义务不可断档。
  4. 入口切换:枚举全部入口(CreationShelf、模板卡、空白画布、深链、历史详情)并以路由/E2E 证明不再进入 Polotno。
  5. 依赖清零:runtime 引用为零,package/lock/env/locale 清零,领域测试保留,build/test/typecheck/bundle 全过;退役后相关现行文档标注历史状态。

### 9. 主线借鉴项(含 DoD)

- Provider 协议兼容:**借 vozeb 代码作脱敏 fixtures**(纠正 rev1"不搬代码"表述;此为方案合集 §8.1 原裁决)+ "配置→sandbox→canary 探测留证" UX;不进计费路径。fixture 仅在 A2/A3 manifest 明确文件集合、来源、脱敏证明、审核人后进入仓库。DoD = submit/poll/download/cancel/费用/错误分类过门。
- 媒体 custody:source/owned/replica 标签与资源对账。DoD = source→owned→Package 对账可抽样、missing 可修复。
- 薄 Ops 与额度解释:借信息架构不抽组件。DoD = 授权人员不进数据库可按商户诊断任务/额度/失败原因,账与投影一致;额度解释含预计/实际/原因/退款四要素。
- 最后管理员保护 + 离线改密不变量照搬(成本 S)。DoD = 删除最后管理员被拒 + 离线改密流程演练通过。

### 10. 提示词 seed(范围锁死)

- 首版为前端静态 seed:**30-50 条美业场景中文配方**(内容由产品侧提供或从我方既有 copy prompt 语料改写,不采集 vozeb 874 条),按品类/场景分组,标注适用 operation;交付物必须包含版本化 seed 文件/schema、owner、operation 映射、来源与 A3 审核/授权证据，禁止 agent 临场生成。仅作上手辅助。**明确不含**:通用 CRUD、远程库存、社区、增长机制——防范围漂移;后续接 X2 领域配方。

### 11. 实施顺序(升单线内部,修订依赖后)

- **M0 合同冻结(新增)**:BackendPort 全 action 的 wire contract(schema/错误矩阵/幂等);启动码协议;工程 draft/revision/CAS 合同;Agent 动词 schema 与三态语义;ContentPackage sourceRef 扩展与 Job origin 的 contracts+PG 迁移设计;直接复制文件 manifest + 授权覆盖表。
- **M1 骨架**:独立 Next Node 服务(最小嵌入 layout)→ 启动码 SSO 全协议 → 门面实做(会话/工程 CRUD 含 CAS/素材 list/get)→ 工程与媒体服务端持久化(AdvancedCanvasProject + revision + storageKey→AssetId hydration)→ 迁移后构建验证。
- **M2 生成主链**:Job origin 泛化落地(迁移+backfill 先行)→ 图片生成/编辑+蒙版接 Model Supply → OwnedAsset+双账+日志只读投影 → `text.respond` → **供应商参考图能力实测**(data URL 是否可用;不可用则启动 grant 建设,不拖到 M4)。
- **M3 视频 + Audio + 采用**:基础视频+capability 高级参数;Audio 双操作全链(供应商激活门先行);`adopt_advanced_canvas_output` + 版本级 sourceRef → 主应用采用回落与徽标闭环。
- **M4 Agent + 加购 + 门禁**:在线助手全集动词+确认凭据;Pro Studio 加购项允许在进入 Pro Studio surface 处做 entitlement gate，未购用户看到介绍/购买路径；不得锁住 P1 Composer 已有草稿、模板、编辑和既有对象，生成/采用/导出等 Pro Studio 新动作再做动作级权益校验；提示词 seed;安全验收与 E2E 验收组(见 Testing);发布门禁核验。
- 并行(主线侧):Composer 轻编辑吸收 + Polotno 冻结,按五门槛推进退役。

### 12. 量级诚实口径

- 整体 XL。按里程碑粗估 **23-36 人周**(M1 4-6、M2 4-6、M3 6-9、M4 4-7、主线 Polotno 并行 5-8),未计供应商等待、授权交付与生产部署;三人稳定并行约 10-14 自然周。**最可能爆的是 M3**(视频高级参数+Audio 新模态+跨主线采用三项跨栈绑定),M4 次之。Audio 后置一个里程碑的降级预案保留,**需用户点头才动**;Agent 为 H 增量。

### 13. 发布门禁(conformance gates,非运行时测试)

- A2/A3 书面授权覆盖 manifest 全部文件,precommit/CI 校验 manifest 与实际复制文件一致。
- 构建产物负向扫描:无 local Agent 路由/agentUrl/agentToken/token query/canvas-agent 包/child_process/通用 shell/catch-all 代理;无 vozeb 注册/首用户提权代码。
- 静态检查:画布前端仅经 BackendPort 发请求(无散落跨域 fetch);独立 Next Node 发布单元形态;iframe 未启用时无 HostBridge 死代码暴露。
- 商业门:Pro Studio 对外发售前 N2 恢复门过门(付费即触发,无豁免);加购项定价与升单验证门(见 Further Notes)由产品侧放行。Pro Studio surface 可有独立进入门，但 P1 既有动作保持开放，Pro Studio 生成/采用/导出等新动作采用动作级权益检查。

## Testing Decisions

- **好测试的定义**:领域与接缝测试只断言外部行为(命令进、事实出、投影可读),不测 pg-boss/AI SDK/供应商 SDK 内部,不测 vozeb 内核内部函数;但架构/授权/安全禁入/发布形态类红线用 §13 的静态与构建门禁验收——"只测外部行为"不等于不验收这些约束,更不等于不验收用户可见行为。
- **Application Service 接缝测试**(prior art:operations 应用服务测试与 foundation-module 命令分发测试,含既有幂等/未知 action 拒绝形态):
  - 采用:新建包/既有包新版本;**同 revision+selection 重复采用(任意幂等键)返回既有成品且包/版本/关系/审计事实零增长**;同 key 异 payload 返回 IDEMPOTENCY_CONFLICT 且零副作用;stale baseVersionId 固定冲突码且不建版本;选中节点未达终态/资产未入自有存储/节点不属该 revision 被拒;selection 为空或 image_text 缺文本被拒;freeze_current_draft 与 expectedDraftVersion 冲突路径。
  - 工程:创建/draft CAS 冲突/检查点冻结/恢复开新 draft/软删除与 sourceRef 引用保护/复制边界(仅当前图+同 Asset 引用)。
  - Job origin:advanced_canvas 来源的图片/文本/视频/Audio 全生命周期(提交→恢复→交付→结算/退款),layout_work 独占页式回写;backfill 后 latest 查询语义不变。
  - 计费矩阵:§5 状态矩阵逐行成为用例(含 2xx 后失败不结算、下载失败只重试下载、取消迟到成功隔离、部分交付按实结算、重复 callback 幂等),对齐既有退款测试的 reserved/committed/released/available 断言精度。
- **门面契约测试**(以 M0 冻结的 action 表为对象):表外 action 拒绝;每 action 的 schema 严格拒绝 unknown 字段与禁止字段;401/403/404/409 错误矩阵;会话/workspace 边界;`persistLocalCanvasArtifact` 拒绝声明生成产物权威。
- **安全验收(扩充为可执行判据,发布门)**:
  1. 启动码:并发兑换仅一成功;过期/错 audience/错 nonce/错 user-workspace-project 全拒;码不出现在 URL/Referrer/日志/分析。
  2. 会话:cookie host-only 属性;跨子域 CSRF 被拒;主应用登出/禁用/移除成员/切工作区后画布会话在上限内失效。
  3. 全对象 IDOR:project/revision/asset/job/package/grant/confirmation 跨 workspace 404、零泄露、零副作用、留审计;伪造 workspaceId/服务身份头/objectKey。
  4. 伪造 serverUrl/poll_url/requestTemplate 等协议字段 schema 层拒绝,无 job/ledger/provider 副作用。
  5. 持久化顺序:创建响应丢失以幂等键找回原 job 不重建;dispatch 前后 crash 恢复;并发槽原子超限。
  6. safe-fetch:DNS rebinding、逐跳 redirect、metadata IP、Cookie/Key 外带、超大响应、MIME/polyglot、并发上限。
  7. grant(分支判据):未启用时无 grant endpoint 且生成路径不产 grant URL;启用时 TTL/audience/绑定/过期拒绝/接单回收/回收失败告警/CDN 不缓存/日志脱敏全过。
  8. Agent:确认凭据一次性/过期/op-hash 与 read-set 绑定;未知工具、合法工具越 workspace、参数注入三类拒绝;双会话交错——A 以 R 确认得 R+1,B 以 R 应用返回固定 REVISION_CONFLICT 且节点/连线/job/reservation 零产生,B 重读 R+1 后可成功;刷新后凭内存态继续执行被拒;prompt injection 不影响工具授权。
  9. Audio:伪造 MIME、恶意 metadata、超长/异常 codec、Range 滥用、跨 workspace 播放与下载。
  10. 浏览器缓存:同设备 A 登出→B 登录零残留;跨 tab 登出;旧会话迟到响应被 fence 丢弃。
- **E2E 验收组**(prior art:既有 e2e 旅程用例目录,位于前端包 tests/e2e/;Playwright 编排需新增 canvas 服务为第四个 webServer):拆四组 + 一个跨服务 happy-path smoke,不用单条巨型旅程:
  1. 权益与工程壳:未购看介绍位→购买解锁→一键进入免登→新建/重命名/复制/删除/恢复检查点→未保存提醒→刷新与换设备恢复(含媒体)→主题一致。
  2. 创作与生成:插入素材→画布节点/连线/框选/缩放/撤销/快捷键抽样→裁切/切图/超分/蒙版/参考图编辑且派生连线保留→图片/视频/文本反推/TTS/音效生成→报价提示→失败退款人话解释→Audio 试听与下载→提示词 seed 可发现可用。
  3. Agent:建/改/删节点与连线经逐命令确认→三态结果展示→拒绝确认不执行→stale snapshot 冲突提示→审计可查。
  4. 采用回流:选区采用新建包→同选区重复采用回同一成品→改选区产第二个成品→既有包新版本→"已采用"徽标跳转→内容库中编辑版本/导出/复用真实可用→从成品带上下文再入画布。
  - smoke:登录→进画布→生成一图→采用→内容库可见。
- **主线借鉴项验收**:§9 各条 DoD 即验收(fixtures 过门清单、custody 对账抽样、Ops 无 DB 诊断演练、最后管理员/离线改密演练)。
- **Polotno 退役回归**:五门槛判据(§8)各自对应验证——门槛①④走 E2E,②走盘点报告+批量打开导出脚本,③走导出二进制与 evidence 断言+新旧对照样本,⑤走 build/test/bundle 门;既有画布作品领域测试保留为新日常编辑器验收基线。

## Out of Scope

- 主线 N1 门店旅程本身(ContentPackage 产品化规格拥有);N2 恢复门的实施细节(独立工作,但其过门是 Pro Studio 发售的硬依赖,见 §13)。
- 触发式演进项 X1-X3、Work Command 网关、统一 Egress 出口、Replica/Export、Private/Agency/多门店/跨行业(各有独立触发证据门)。
- **跨门店教练关系**:陪跑培训师首发以学员工作区内已授权成员身份(现有角色)进入;新的教练-门店授权关系属 Scope Reopen。
- **外部设计师专业席位**:首发人群收敛为陪跑培训 + 中高阶商家;交付型设计师席位待升单验证门产生真实证据后再议。
- 独立音频成品类型(ContentPackage 新 kind)——需扩产品范围另行拍板。
- SPA 抽取(脱 Next 嵌 Vite)——中长期收敛选项。
- vozeb 全功能 parity;WebDAV 同步;874 条提示词采集;签到/积分/CDK(已全局取消);本地 Agent 桥;通用媒体代理;通用提示词平台。
- vozeb 内核本身的功能增强(artboard/页式能力等)——违背"整套照搬"前提。

## Further Notes

- **升单验证门(加购项发售的产品门)**:建议判据——至少 3 家真实陪跑/中高阶商户,各自完成"进画布→合格成品→采用→导出交付"并明确愿按报价付费;由产品侧(用户)放行,通过前加购项可内部/白名单先行,不公开售卖。停止条件:连续样本不能完成成品或不愿付费,回评审。
- **与"Growth 与高用量 Pro 功能相同、不设功能墙"口径的对齐**:该口径约束主线门店功能不拆墙;Pro Studio 是升单线新增付费面(加购项),不从主线既有功能中抽取,不构成冲突。
- 首发含 Audio(TTS+音效)+ Agent(全集动词)是用户拍板;量级后果(23-36 人周)已如实计入;Audio 后置一个里程碑的降级预案保留入口但需用户点头。
- 画布工程是升单线自有事实、不进主线 canonical;红线仅一条——画布不得冒充/覆盖已生成的 ContentPackage 成品事实。
- 独立 Next 形态保留 vozeb 上游可合并性;SPA 化才会断。
- 本规格 rev2 的逐条修订依据:6 路复核报告与裁决在 `.scratch/spec-codex-review-2026-07-16/`;全部决策溯源见《vozeb 方案合集 2026-07-16》§8/§9 与 4 路交叉验证报告(r1.md-r4.md 四个文件)。
