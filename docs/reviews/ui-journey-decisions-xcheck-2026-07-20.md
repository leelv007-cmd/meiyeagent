# UI/用户旅程决策块交叉复核报告（D-072~D-097）

- 日期：2026-07-20
- 范围：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 行 1264–1625 的 24 条新决策（D-072~D-078、D-081~D-097；D-080 为上一轮处置记录，不在本轮复核对象内；D-079 缺号，见 §4 F5）
- 方法：7 路 Opus 子 agent 并发（3 路代码实证 + 1 路调研包忠实性 + 1 路决策一致性对抗 + 1 路首轮铺开面评审 + 1 路存量票包对齐）+ 主会话引证抽验（7 处 file:line 全部命中）与交叉裁决。方法学沿用 D-080 轮（`docs/reviews/admin-supply-decisions-xcheck-2026-07-20.md`）。
- 处置状态：**待用户拍板**（§7 收敛项清单）；拍板后在 §8 记录处置。

## §1 总结论

1. **事实层零 P0**：三路代码实证共核验 40+ 条 CODE-FACT 声明，无一条"声称已存在实则缺失"；凡声称"尚缺"的（QuoteSnapshot、计费秒数、working-selection、compatibility Work、Recipe 枚举等）grep 全部为空。决策块的诚实纪律（"目标合同，不代表已实现"）与代码实况吻合。
2. **引用忠实性零 P0 零 P1**：调研包 17 个文件全部真实且实质，9 处决策引用全部 FAITHFUL；只读走查、截图 14–17、小云雀空项目保留等证据边界逐条对上。仅 3 条 P2 措辞精度问题。
3. **一致性零硬矛盾**：内部数值/命名全部自洽（六卡=八 variant、4/3 P0、≤3/≤2 工具、12 项搜索门、六/四条 Recent）；但有 4 处 P1 静默改写/未接线（ADR-0007 token 流式落点全块失语、D-076↔D-043 模型呈现位置反转未点名、D-078↔D-037 另建配置目录未对账、D-081↔D-043 前置门语义未对账）+ 4 条 P2 记录卫生。
4. **铺开面**：整体自我收敛好于上一轮后台/供应块（不建 DSL/插件市场/RBAC 等 7 处给分）；但上一轮 C1/C4 型过建面再现两类——为不存在的现实建迁移/发布安全机器（D-089 灰度矩阵、D-086 自动发布状态机、D-091 兼容锚写路径），以及把结构性钉死的小对象升级为全生命周期配置（D-078 Lens/Tool）。5 条收敛建议 + 3 条提示。
5. **重大前提勘误（票包）**：#50-#60 并非"实施未开始"，而是**已实现并合入 main**（commit `57abba8`/`3811050`/`0429e8d`/`d66a9be`/`e6348c3`，spec 头部亦声明；主会话已抽验）。裁定=约 5/11 durable、3/11 需 addendum、2/11 被取代（T4 工作台结果区→D-089、T6 场景 chips→D-082/083/084）、1/11 阻塞（V1 ≤2击硬门 vs D-081，须先拍口径）。

## §2 代码事实层（3 路实证）

### 2.1 Composer/对口/移动端（D-074~084 相关）
- 全部 CONFIRMED：桌面/移动默认 `copy.generate`（`unified-creation-workbench.tsx:932`、`mobile-action-book.tsx:1097`）；冷态 picker 仅两对口+`aria-pressed`（`creation-entry.tsx:196-225`）；`primaryCreationOperations()` 缺图片（`creation-entry-model.ts:57-59`，主会话抽验）；切 operation 重置比例（workbench:1480-1483）；`NAMED_PRESET_CONTRACTS`（`p1/operations-view-model.ts:340,555`）；`internalIntent` 覆盖 intent（workbench:1815，主会话抽验）；四套分类轴（`creation-entry.tsx:113-120,215,261`）；Pro Studio 六项能力全链路实锤（`routes/pro-studio.tsx`、`api/pro-studio/launch.ts`）。
- **P1-a（D-081 孤读低估桌面能力）**：桌面 mode picker 已含完整 `image.generate`（workbench:751），缺口精确=冷态一级入口，非"桌面全程无图片对口"。防止实现票重复建设。
- **P1-b（D-084 "80vh Drawer"指向失准）**：80vh Drawer 是共享组件（`components/ui/drawer.tsx:59`），移动创作面 `mobile-action-book` 并未使用（该面用 overflow-x 横条）；"替换现有 80vh Drawer"在移动创作路径落点为空，应校正为"移动创作面当前无 bottom sheet，需新建"。
- 低于 P1：D-076/D-082"硬编码时长"生产代码不成立（时长走冻结合同，仅比例硬编码）；"文案/视频"标签实为"图文/视频"。

### 2.2 结果工作区/图片采用/视频计费（D-085/087/088/095）
- 全部 CONFIRMED：两套采用（legacy `acceptedWriteOwner` 双写 vs `adoptIntoContentPackage`）；两套自由调整（`content-package-quick-edit.ts:170-210` 客户端字符串拼接 vs intent 派生 Task）；正式 `copy.adapt`（catalog.ts:346）；做同款断链（详情页按钮→`reuseContentPackage` 永远抛 `REUSE_TASK_REQUIRED`，`application-service.ts:8390`，主会话抽验）；`adopt_into_content_package` 原子有序 `visualAssetIds`（:6604-6862）；`attach_content_package_generation` OCC 附加（:6865）；canonical 画廊纯预览；`reuse-memory.ts` `AssetRevision`=配方/系列 head；`RouteCandidate.priceRevision/unitPriceMicros/unit`（`foundation/domain.ts:110-113`，主会话抽验）；QuoteSnapshot/per_output_second/billedSeconds/workingSelection 全库为空。
- **P1-c（D-085 低估 VideoWorkflow 降级成本）**：VideoWorkflow 今天是一等权威持久化存储（`model_video_workflows` 表 + OCC + create→confirm→run→cancel 生命周期，`model-supply/postgres-repository.ts:162`，主会话抽验）。降为"派生只读模型"是实质重构（真相迁往 Task/Job/Asset/ContentPackage + 保留崩溃恢复幂等），拆票须显式立项，防按低成本改造漏排期。
- 口径注：交付入口实际 ≥4 套（adopt_canvas_work_export / export_content_package / deliver_content_package / export_work + MP4 直下 + device-relay），比 D-085"三套"更碎，方向不受损。

### 2.3 路由/交付/通知（D-086/089/090/091/097）
- 全部 CONFIRMED：确定性 ZIP（`content-package-export-adapter.ts:230`，固定 mtime）+ ExportReceipt；video 仅单 MP4；零 `automatic_verified`（`main.ts:811-828` capability 全 false + `publisher.publish` 直接 throw，主会话抽验）；`/dashboard` 视口分裂 Workbench/ActionBook（`routes/dashboard/index.tsx:41,62-76`）；`content_/$contentId` 挂完整 `ContentLibrarySurface`；`ContentPackageDetail` 八项职责全命中；一级导航=创作/内容/素材/门店（`config/sidebar-config.ts`）；粗粒度 `from`+本地 stage（`trusted-return.tsx:18-24`）；migration+legacy 只读投影存在、compatibility Work 全库无。
- **P1-d（D-086 低估存量 handoff 范式）**：`routes/dashboard/handoff/$token.tsx` 已是功能完整可打开的交接页（token 解析 + `navigator.share`/`canShare` 文件降级 + 媒体下载 + 逐字段复制 + `report_handoff_result` 人工回报，主会话抽验），绑 legacy `handoffPackages`。D-086/D-096 应明确"复用该页面范式、替换数据源为 canonical delivery"，防从零重做。
- **P1-e（D-097 事件源缺口）**：通知矩阵六类中四类今天无持久事件源（"结果可用/任务失败"仅瞬态 async-task-center；`acceptance_unknown` 停在 model-supply provider 层；"交付部分成功/未知"依赖 D-086 未建的逐对象 attempt；现有 `deliveryEvents` 仅三类）。唯一权威源=pending-actions 收件箱（`p1/pending-actions.ts:37-87`，恰对应"需要选择/补确认"）。通知层必须为引用式投影、与 D-086 逐对象 attempt 投影同批建设，不建独立 Notification 表，否则与 #47 收件箱形成第二真相。

## §3 引用忠实性（1 路）

- 9 处引用全部 FAITHFUL；三份提案文档与 D-082/083/084 终稿字段级一致；README 无超额验证声明。
- P2-1：D-081 把"同步切换模型/参数/价格"写成三家竞品共同证明——讯飞绘文走查未展示价格/模型维度、CreatOK 模板继承未实测（并集写成分配），建议分家表述（小云雀完整 / CreatOK 模型+价格 / 讯飞绘文输入合同+示例）。
- P2-2：D-092 称 3.3KB 联合汇总为"详细六项联合合同"，"详细"略高，建议改"六项联合合同（汇总级）"。
- P2-3：D-085"字幕处理"vs 审计"字幕擦除"，可接受泛化，仅记录。

## §4 一致性（1 路对抗，主会话抽验 F1/F2/F3 原文命中）

- **F1 | P1 | ADR-0007 token 流式落点全块失语**：D-032①"token 流式会话层一等公民"、D-043"直接进入 Harness 流式候选"；D-089 把运行搬进 Result Center 后只写"阶段 polite 播报"（恰是已废弃的 Job 级进度条口径），全块无一句声明 Result Shell 运行态承载 token 级流式。实现者极可能只做阶段进度条，静默回退 ADR-0007。修：D-089/D-085 补一句"Result Shell 运行阶段承载 ADR-0007 token 级流式候选，阶段播报仅为无障碍聚合层，并存不互替"。
- **F2 | P1 | D-076 模型呈现位置反转未点名 D-043**：D-043决定②"模型/额度从主路径移除"，D-076 把可见 CatalogModel 拉回首屏动态设置行，Supersedes 未点名 D-043，而 D-072 刚重申 D-043 仍是边界。点击数不破（Auto 默认不强制确认）。修：D-076 Supersedes 增列"细化 D-043决定②：可见模型名由更多设置上移首屏，不构成前置确认"。
- **F3 | P1 | D-078 另建 Creation Experience Catalog 未对账 D-037**：D-037"扩展存量 admin-config，不另建配置系统"；D-078 新建独立 Catalog 聚合（仅复用模式），全条无"D-037"字样。修：增对账句（属 D-037"新增强类型 artifact"一类、schema 形态因组合配置独立、不构成第二套配置运行时），Supersedes 列 D-037（细化非推翻）。
- **F4 | P1 | D-081 强制选对口 vs D-043"0 前置表单/0 前置确认"未对账**：点击数核算合规（纯自由文本路径=选对口1+CTA2 恰 2 击，模板卡路径 1 击两用；零余量）。残留=必选 radiogroup 是一道前置门，文档未声明其不计入"前置表单/前置确认"。修：D-081 或 D-043 补"必选创作对口是模式选择器，非所禁字段填表或前置确认，占用两次显式操作预算之一"。
- **F5 | P2**：D-079 全文缺号且 D-081 排在 D-080 前；确认跳号并标注。
- **F6 | P2**：D-076:1325"系统默认或推断当前对口"、D-078:1355"后台默认策略"被 D-081 取代的原句无 inline 标注（上一轮惯例是加指针）。
- **F7 | P2**：行 1670 待拍板指针"见 D-074~D-081 各条"过期（实际到 D-097，且圈入不存在的 D-079 与后端裁决 D-080）。
- **F8 | P2**：第⑤卡 D-075"抖音成片"vs D-078/082/083"抖音项目成片"，四处同源清单须逐字一致。
- 已排除嫌疑（10 项）：D-085↔D-089 第四套结果页 override 自声明 airtight；D-090 四导航=1 工作台+3 资产页；D-028/D-062/D-066/D-068/D-069/D-088 均显式保留；D-080 三项裁决未被重开；"做同款"三处均带指针；数值矩阵自洽；D-033 五段合同不变。

## §5 首轮铺开面（1 路评审）

收敛建议（只调建造面与排序，产品边界零改动）：
1. **D-078**：首轮 Recipe+Surface 走全发布生命周期与可视编辑器；Lens（D-081 钉死 3 个）降静态 enum、CreativeToolEntry（首批固定 6 项）作静态注册表种子；原子发布聚合收窄为 Recipe+Surface。解锁=对口重编组/第二批工具频繁上下架的真实需求。
2. **D-089**（最高价值，与上一轮 C1 同源）：灰度分桶/影子投影/新旧 renderer 共存/kill-switch 矩阵/Wave1 兼容 panel 的存在理由是保护线上用户，而 D-040 明确当前无真实用户。首轮=Wave0 基建 + 新 Result Center 三媒介工作面直接建 + 旧 workbench 结果分支与 ContentPackageDetail 重复动作**同轮直接退场**；整套灰度机器后置到 D-040 运营重启。
3. **D-086**：delivery attempt 的 delivering/partial/unknown/reconcile 状态机建模自动发布失败模式，首轮 0 平台 automatic_verified、无生产者。首轮全建"拿到文件"（manifest/ZIP/Share 矩阵/一次性链接）+ assisted 交接及 receipt 状态；自动发布状态机随首个平台过 live gate 再建。附：D-096 24h 提醒先做收件箱"待确认>24h"被动投影。
4. **D-091**：首轮只留 ResultTargetResolver 只读 legacy 分支（"历史档案"默认态已在 D-091 内）；`ensure_legacy_content_work_anchor` 命令+唯一约束 registry+修复命令后置。触发=真实存在 pre-lineage 内容。
5. **D-093**：首轮两 tab 均 <12 项，搜索按门槛根本不渲染。首轮只建 published-visible 计数+门槛闸；索引/匹配随真实跨线再建（门槛即触发器）。

仅提示：A）D-081 强制选对口可辩护（Lens 决定费用档+媒介，误判代价高；模板卡路径零额外摩擦），但"空 composer+阻塞提交"混合式成熟先例弱，交互原型须专门量"纯自由文本不点卡"路径；B）D-097 浏览器系统通知（Web Notifications+SW）后置到真实用户阶段，站内矩阵保留；C）ResultTargetResolver 可作 resolver 内函数，防单页过度抽象。

已良好收敛给分：D-082 不建 DSL；D-092 不建插件市场；D-096 不建 RBAC；D-094 条件 Brief=既有信号投影；D-088 单一计费链；D-090 无第五列表页；D-085 纯投影 Shell。

新增命名对象盘点（12）：真契约 4（CreationRecipeVersion、CreationSurfaceRevision、ProductQuoteSnapshot、delivery manifest/v1）；纯投影/adapter 5（ResultShellModel、ResultCommandAdapter、ResultTargetResolver、RecipePatchPreview、ToolHandoff，纪律正确）；可折叠 2（CreationLensDefinition、CreativeToolEntry）；条件性 1（compatibility Work anchor）。第二真相最高风险点=D-086"delivery attempt"与既有 DeliveryAttempt 命名/真相撞车，实施时须显式声明为扩展同一对象。

## §6 存量票包对齐（1 路，前提勘误经主会话抽验）

**前提勘误**：#50-#60 已实现并合入 main（`57abba8` T1-T4、`3811050` core seams、`0429e8d` T5/T6、`d66a9be` V1、`e6348c3` Tc/Td；spec 头部"T1–T6、Ta–Td、V1 已合入 main"）。项目记忆中"实施未开始"过时，已更正。

| issue# | 票 | 裁定 | 冲突 D | 处置 |
|---|---|---|---|---|
| #50 | T1 Brief 折叠 | NEEDS-AMENDMENT | D-094/D-074 | core auto-confirm 接缝 durable 且 D-094 依赖；前端 chips 重挂新 Composer，废"展开四卡"路径 |
| #51 | T2 模型/额度折叠 | NEEDS-AMENDMENT | D-076/D-088 | 后端修复 durable；模型名按 D-076 回首屏设置行；视频确认重挂 ProductQuoteSnapshot/per_output_second |
| #52 | T3 开关下沉 | UNAFFECTED（容器 re-parent） | — | 开关合同/AIGC 烧录边界 durable |
| #53 | T4 流中接管 | SUPERSEDED（过渡后拆除） | D-089/D-090/D-085 | 后端直发路径/Harness 守卫 durable 喂给 Result Center；工作台结果 UI= Wave 迁移对象，勿再加码 |
| #54 | T5 授权内联 | UNAFFECTED（re-parent 进 `+来源`） | — | 一键 evidence pointer/受限素材追问 durable |
| #55 | T6 桌面场景 chips | SUPERSEDED（废弃） | D-084/082/083/081/078 | `SceneVisualButton`+`sceneChipGroups`+`NAMED_PRESET_CONTRACTS` 硬编码由版本化 Recipe 卡+RecipePatchPreview 取代；shipped"点击替换推荐词"违 D-081 |
| #56 | Ta trial 档 | UNAFFECTED | — | grant-lot 账本=D-088 底座 |
| #57 | Tb 开通钩子 | UNAFFECTED（ModelPolicy 联调项） | — | |
| #58 | Tc 支付映射 | UNAFFECTED | — | |
| #59 | Td 退额/兑换码 | NEEDS-AMENDMENT | D-088 | 视频失败退额细化为秒数差额/attempt 级分账 |
| #60 | V1 验收硬门 | **BLOCKED** | D-081↔D-043 | ≤2击计数口径须先拍板（见 §7 C6），解决前 e2e 硬门不能重立 |

xcheck 旧裁决被推翻/深化：T6"补 presetFamily 映射"→被 D-084 推翻；T2 视频确认"按 D-012"→被 D-088 深化；V1"≤2击钉死"→被 D-081 重新打开。

实施纲领：下一轮 D-072~D-097 实现票=**在 #50-#60 已 shipped 的后端接缝之上重建首屏与结果面**，勿再基于 SceneVisualButton/工作台结果分支加码。

## §7 收敛项清单（待用户拍板）

决策级（C1~C7，均不改产品边界）：
- **C1**（D-089）：Result Center 首轮直接建新面+同轮退旧分支；灰度分桶/影子投影/renderer 共存回滚/兼容 panel 后置到 D-040 运营重启。建议采纳。
- **C2**（D-086+D-097）：自动发布 delivery attempt 状态机后置到首个平台过 live gate；首轮交付=拿到文件+assisted 全建；D-097 四类无源通知与 D-086 逐对象投影同批、引用式投影不建独立表。建议采纳。
- **C3**（D-078）：首轮 Recipe+Surface 全生命周期，Lens/Tool 静态引用起步，原子发布聚合收窄。建议采纳。
- **C4**（D-091）：兼容锚写路径后置，首轮只留只读 legacy 分支。建议采纳（低-中置信）。
- **C5**（D-093）：搜索索引/匹配后置，首轮只建计数+门槛闸。建议采纳。
- **C6**（D-081↔D-043，解 #60 阻塞）：确认口径=模板卡一击两用（选对口+套用）、纯自由文本路径"选对口(1)+开始创作(2)"恰 2 击合规；将"必选对口=模式选择器，非前置表单/前置确认，占两击预算之一"写入对账句；V1 e2e 断言按此重立基线。建议采纳。
- **C7**（D-097）：浏览器系统通知后置到真实用户阶段，站内矩阵保留。建议采纳（轻）。

文档级修正批（口径/卫生，不改变任何拍板内容，拍板后一次回写）：
F1 token 流式落点补句（ADR-0007 保真，最高优先）；F2 D-076↔D-043 对账；F3 D-078↔D-037 对账；F4 对账句（并入 C6）；F5 D-079 跳号标注；F6 inline 已取代标注；F7 待拍板指针更新至 D-097；F8"抖音项目成片"统一；P1-a D-081 桌面图片可达性精确化；P1-b D-084 Drawer 指向校正；P1-c D-085 补 VideoWorkflow 实质重构立项句；P1-d D-086/D-096 补 handoff/$token 范式复用句；P2-1 D-081 竞品归因分家；P2-2 D-092"详细"降格；口径注 交付入口"三套"→"≥4 套"。

## §8 处置记录（2026-07-20 回填）

用户裁决：**C1~C7 全部采纳**，已落盘为 **D-098**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`，D-097 之后）。

决策级回写：
| 项 | 决策 | 回写位置 |
|---|---|---|
| C1 | D-089 | 状态行指针（直接建新面+同轮退旧，灰度机器后置 D-040 运营重启） |
| C2 | D-086、D-097 | 两条状态行指针（自动发布状态机后置首平台 live gate；通知=引用式投影与 D-086 同批） |
| C3 | D-078 | 状态行指针（仅 Recipe+Surface 全生命周期，Lens/Tool 静态起步） |
| C4 | D-091 | 状态行指针（只留只读 legacy 分支，anchor 写路径后置） |
| C5 | D-093 | 状态行指针（计数+门槛闸起步） |
| C6 | D-081（含 D-043 对账） | D-081 决定内对账句（模式选择器非前置表单/确认，占两击预算之一；模板卡一击两用；#60 解除阻塞） |
| C7 | D-097 | 并入 D-097 状态行指针（浏览器系统通知后置真实用户阶段） |

文档级修正批（14 处，全部完成并经 grep 验证）：
F1 D-089 补 ADR-0007 token 流式落点句；F2 D-076 Supersedes 增 D-043决定② 细化对账；F3 D-078 增 D-037 对账句+Supersedes 列 D-037；F4 并入 C6 对账句；F5 D-081 前插 D-079 跳号编号说明；F6 D-076「系统默认或推断当前对口」与 D-078「默认策略」inline 已取代标注；F7 待拍板指针更新至 D-098；F8「⑤抖音成片」→「⑤抖音项目成片」（残留 0）；P1-a D-081 桌面图片可达性精确化；P1-b D-084 Drawer 指向校正；P1-c D-085 VideoWorkflow 实质重构立项补注；P1-d D-086 handoff/$token 范式复用句；P2-1 D-081 竞品归因分家表述；P2-2 D-092「详细」降格为汇总级；另 D-085「三套交付入口」→「至少四套」。

回写均为处置指针与证据性补注，除 D-098 明文收窄/改写的首轮建造面外，不改变任何已拍板产品边界；本轮消耗决策编号 D-098。#50-#60 票包处置按 §6 表执行，#60 阻塞已由 C6 解除。
