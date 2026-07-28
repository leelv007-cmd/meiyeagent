# CreatOK 式生成工作台 UI/UX 总验收矩阵 v2

- 来源：[UI/UX 实施交接规格](13-uiux-implementation-handoff.md)
- 用途：S0–S5 阶段门槛与一次性生产切换证据索引
- 原则：`required` 失败不可切换；`waivable` 仅允许符合 P1 Owner acceptance 的 P2/P3 外围缺陷。
- Path B 机器映射：[decision-ticket-map.json](../../uiux-upgrade-b/decision-ticket-map.json)；本文件定义用户可见验收，JSON 定义决策、差距与票的唯一双向关系。

## A. 构建、迁移与回滚

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| A01 | required | `pnpm check`、`pnpm typecheck`、`pnpm test`、`pnpm e2e` 全部通过，且 Web node tests 确实被发现 | CI 日志、测试计数、commit |
| A02 | required | additive schema 可由 pre-cutover 构建读取 | 旧构建 + 新 schema smoke |
| A03 | required | 回填 dry-run/正式演练幂等、可重入，计数和冲突为已解释状态 | 迁移报告、对账摘要 |
| A04 | required | canonical ID、tenant、Work/Job/Asset/Content/发布/账本关系迁移前后相等 | 新旧读模型 diff |
| A05 | required | 运行 Job 使用原 RouteSnapshot/owner 恢复，不重投、不换模、不重复 Asset | cutover 集成测试、事件证据 |
| A06 | required | pre-cutover Web/Core 应用回滚成功且不回滚合法新数据 | 回滚演练记录 |

## B. 壳、路由、权限与安全

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| B01 | required | 桌面六项业务导航顺序与 canonical 路由一致，设置固定在工具区 | 路由测试、截图 |
| B02 | required | Agent 是生成工作台内模式，不存在第二工作台、两个 H1 或浮动 Chat clone | DOM/路由 E2E |
| B03 | required | 旧地址只读重定向到 allowlist 新地址，不双写、不接受开放 return URL | redirect table tests、security tests |
| B04 | required | Platform Admin、Workspace Owner、Operator、Reviewer 前后端授权一致 | 角色矩阵 E2E/API tests |
| B05 | required | 未授权用户看不到管理入口且服务端拒绝 `/admin/*` | SSR/middleware/API tests |
| B06 | required | 凭据只写入、不回显；日志、事件、trace、截图无秘密或用户正文/素材 | secret/PII scan、observability review |

## C. 冷启动与核心创作闭环

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| C01 | required | E0 可展示只读、零消耗的示例投影，但不得注入或复制为 canonical Task/Work/Asset/Content；一句意图或“做同款”预填不自动建对象 | E0 Playwright + API assertions |
| C02 | required | E1 复用既有 Task/Asset，不复制；显式动作才建 Work | E1 Playwright + DB assertions |
| C03 | required | Work → 执行合同 → Job → Assets → accepted Content 分层成立 | 固定旅程 + object graph assertions |
| C04 | required | 水印/AIGC 始终是用户开关，门店/资质/法务/套餐不形成页面级创作门禁 | interaction tests、copy scan |
| C05 | required | 模型、规格、报价/产出量、预计时长在提交前可检查；变化需显式接受 | Composer E2E |
| C06 | required | recoverable 续同 Job；unknown 只核验；terminal failed 新建 `retryOf`；修改合同新建 `derivedFrom` | state-machine + E2E |
| C07 | required | recorded/configured/缺激活证据模型不可提交且不伪装“可用” | catalog unit/API/E2E |
| C08 | required | 首创作四层事件分别记录，skip 不计 activation/value 且不强制重弹 | event contract tests |

## D. 运营、模板、工具、资产与历史

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| D01 | required | 右栏只有下一行动、五点周态势、异常摘要；完整任务在 canonical 收件箱 | UI/E2E |
| D02 | required | 批次逐项执行，异常不重跑成功项，发布不进入批次 | Core/Web tests |
| D03 | required | 上下文货架、`⌘K` 和参考解构台使用同一目录，不复制草稿/目录 | interaction/route tests |
| D04 | required | 模板继承不覆盖门店/发布事实；升级新建 Work revision 并保留历史 | template/version integration |
| D05 | required | 工具选择只插入动作，显式执行才建 Job，结果回写原记录 | tool Job E2E |
| D06 | required | 上传回执前不叫 Asset；成功媒体只有一个 canonical Asset | upload/DB idempotency tests |
| D07 | required | Recent/搜索/结果卡只投影 canonical 对象；来源返回刷新后仍可恢复 | deep-link/reload E2E |

## E. 移动与发布交接

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| E01 | required | 手机只覆盖采集/上传、确认、进度/恢复、轻调、交接和桌面接力 | 320/360/390/430 + 横屏 E2E |
| E02 | required | 上传中断可续；持久化回执后才显示 Asset；相机权限失败有可执行替代 | mobile E2E |
| E03 | required | accepted Content 才进入 L1/L3；L1 再确认，L3 不伪装已发布 | publish E2E/API assertions |
| E04 | required | 分享、下载、复制只记录交接动作；人工结果回报和平台真实状态分开 | handoff tests |
| E05 | required | 手机设置/后台深链提供桌面接力与安全返回，不渲染缩小桌面后台 | responsive E2E |

## F. 设置、后台与套餐

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| F01 | required | 设置保留六项导航，并只有 account/models/connections 三项次导航 | route/UI tests |
| F02 | required | 用户模型面不暴露 Channel/Deployment/成本/秘密；Owner BYOK 与外部连接分责 | role + content assertions |
| F03 | required | 官方模板后台治理；个人/工作区模板和个人快捷位所有权不混淆 | admin/user tests |
| F04 | required | 管理六路由稳定、可深链、独立授权；高影响动作有 diff/范围/原因/审计 | admin E2E/API tests |
| F05 | required | 套餐/账户不出现积分/credit/token；可用/预留/结算/释放/到期分开 | copy scan、ledger projection tests |
| F06 | required | 权益不足只阻止对应付费动作并保留 Work，不锁模板/编辑/开关 | entitlement E2E |

## G. 无障碍、视觉与性能

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| G01 | required | 键盘可完成核心旅程；dialog trap/return、skip link、动态状态 announcement 正确 | keyboard/AX tests |
| G02 | required | WCAG 2.2 AA：名称/角色/值、标签、对比度、24px 桌面目标/44px 粗指针 | axe + computed/manual evidence |
| G03 | required | 1280px 200% 缩放关键操作可达，body 不裁切；手机和横屏无横向溢出 | viewport/zoom screenshots |
| G04 | required | p75 LCP≤2.5s、INP≤200ms、CLS≤0.1、关键反馈≤200ms | lab + RUM configuration |
| G05 | required | 工作台 initial JS/CSS/传输、DOM、长任务、≤6 关键查询和 lazy-load 预算通过 | build/performance report |
| G06 | waivable | 不影响任务/可达性的细微视觉差异或低频文案 | P1 Owner acceptance（如有） |

## H. 可观测性与切换

| ID | 级别 | 验收 | 必需证据 |
|---|---|---|---|
| H01 | required | 产品/技术双层事件符合最小数据原则，四层 activation 与 skip 分开 | schema tests、sample events |
| H02 | required | correlation ID 可从前端错误关联 Job/Attempt/发布/审计，不复制状态机 | trace drill |
| H03 | required | 短暂提交排空不阻塞已接单 callback/Asset 持久化；smoke 后恢复 | cutover rehearsal |
| H04 | required | 回滚告警和 runbook 可执行；首小时/24小时/7天观察职责明确 | on-call checklist、演练 |
| H05 | required | 验收和发布材料明确“无真实目标用户测试”，不得宣称真实用户验证 | wording review |

## I. Path B 体验合同

以下条目全部为 `required`。证据必须来自同一候选构建、同一测试数据、相同视口的“当前产品 vs 对标产品”并排截图；流式或阶段变化另附开始—进行中—完成三帧或短录屏。任一关键动作不可发现、只在非主路径可见、证据来自静态原型或不同候选构建，均判 `red`；只有完整旅程与证据同时成立才判 `green`。

| ID | 级别 | 用户可见行为 | 对标对象 | 必需证据 | 映射票 |
|---|---|---|---|---|---|
| I01 | required | 能力从 `/dashboard` 真实旅程可发现、可操作、可完成；桶导出或隐藏页不算交付 | CreatOK 主旅程 | 同构旅程截图 + 动作完成证据 | 02, 03, 13, 15, 16, 21 |
| I02 | required | 只有一个生成工作台；外层有拟人化问候、建议与对话式时间线，内层仍可检查 Work/Job/Asset/Content，不新增 Chat clone | KickArt Agent | 工作台首屏与运行态并排截图 | 02, 19（P1-5） |
| I03 | required | 副驾 token 持续出现，文案候选以部分对象逐步成形；等待期不整段静默后跳出 | 即梦 / KickArt | 同一提交的开始—进行中—完成三帧或短录屏 | 02, 06, 07, 08（P0-1/P1-1） |
| I04 | required | 提交立即出现对应占位卡；长任务自动更新可信白话阶段，离页再回可恢复，不显示无法证实的百分比 | 即梦 / KickArt | 同一 Job 的占位、阶段、回收与离页恢复证据 | 02, 09, 10, 11（P0-6/P1-3/P1-4） |
| I05 | required | 今日建议和场景 chips 可点击，点击后真实预填可编辑意图并可继续生成 | KickArt Agent | 点击前后输入值与提交结果截图 | 02, 19（P1-5） |
| I06 | required | 默认先见场景/预设与必要输入，高级参数按需展开；选预设可隐藏提示词框；模型显式选择且无跨品牌 Auto | 即梦 / 可灵 / Higgsfield | 默认态、预设态、高级态与模型卡截图 | 02, 12, 13, 15（P0-4/P1-8/P1-9） |
| I07 | required | 内容模块可多选，默认组合可见，提交前可预览成套结构；执行合同确认框不冒充模块构建器 | CreatOK A+ | 模块勾选与组合预览并排截图 | 02, 14（P1-7） |
| I08 | required | 每次恰好展示 3 个文案候选，只能单选采用 1 个，并可换一批、免费重试最多 2 次 | 即梦 / KickArt | 三候选、单选、换一批与重试边界录屏 | 02, 18（D4） |
| I09 | required | 图片/视频在结果、历史与资产入口显示真实缩略图/预览，文案按富文本可读呈现，不以 ID 或裸文本代替成品 | CreatOK Gallery | 结果、历史、资产同一产物截图与预览证据 | 02, 08, 17（P0-3/P0-5） |
| I10 | required | 离开 Work 后仍可从任务浮标看见运行/完成状态并一键回源；业务壳任一一级页的 `⌘K` 区分“导航”和“添加到创作” | KickArt | 跨页状态回收与两个 palette 分组录屏 | 02, 10, 20（P1-4/P1-6） |
| I11 | required | 统一输入台支持打字、传图/拍照、图片拖放/粘贴；不承诺已 de-scope 的贴链接抓取 | 即梦输入台 | 四种输入行为录屏 + 无链接入口截图 | 02, 22（P2-1） |
| I12 | required | 旅程无模板品牌、内部模型 ID 或无故中英混杂；桌面/移动关键触区、大字号、生成与完成反馈真实可见 | CreatOK 桌面/移动 | 文案扫描 + 桌面/移动/大字号同构截图 | 02, 04, 23, 24, 25（P0-2/P1-11/P1-12/P2-2/P2-4/P2-5） |

### I 区基线证据

- 工作台当前态：`assets/current-product-screenshots/01-dashboard-desktop-live.jpg`；Agent 对标态：`assets/screenshots/02-agent-desktop-live.jpg`。
- 内容库当前态：`assets/current-product-screenshots/08-content-library-desktop-live.jpg`；Gallery 对标态：`assets/screenshots/09-gallery-desktop-live.jpg`。
- 以上仅是票 02 的基线取证，不代表 I01–I12 已转绿；实施票必须以同一候选构建重新取证。

## 总切换判定

- 所有 `required` 行必须有同一候选构建的证据并通过。
- I 区任一 `required` 未绿时，映射的实施票和 Path B 均不得关闭；票 02 关闭仅表示合同、映射与基线已定版，不表示实施条目已绿。
- `waivable` 只允许符合[缺陷豁免规则](13-uiux-implementation-handoff.md#决策-10缺陷豁免)的书面接受。
- 任何证据来自旧构建、静态原型或不同 commit，均不能替代候选构建验收。
