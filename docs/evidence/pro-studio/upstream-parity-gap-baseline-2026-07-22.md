# Pro Studio 画布上游对标差距基线（2026-07-22）

Status: baseline-for-rework（作为 K03 重做票的验收清单；每行差距要么修复、要么由用户显式豁免）
Method: 双路源码盘点合成 — 上游 `csyqlz/vozeb@a2c52c7` canvas 全组件逐文件枚举 vs 当前生产挂载链源码枚举
Upstream root: `references/repos/vozeb/web/src/app/(user)/canvas/`（`ccp` = `[id]/canvas-client-page.tsx`，3723 行组合根）
Current product repo baseline: `4625e4238748196a7fcb12226cb11e2c0420083b`（仅钉死本表“当前状态”的代码事实；本文与 D-099/rev2 的未提交文档变更不计入代码基线）
Current mount chain: `apps/canvas/src/client/canvas-shell.tsx` → `src/kernel-host/kernel-canvas-surface.tsx`（自建 509 行）→ `vendor/vozeb/.../vozeb-canvas.tsx`（**唯一被挂载的 vendor 组件**，纯 pan/zoom 视口）

## 背景诊断（已核实）

- 上游 canvas 目录 46 文件，exact-copy 了 34 个进 `apps/canvas/src/vendor/vozeb/`；未拷的 12 个恰含组合根 `canvas-client-page.tsx`、生成编排 `canvas-node-generation.ts`、三设置 popover、prompt 与 config-node 面板、assistant 与 local-agent 面板、agent store、导出工具。（另有 8 个共享 util，exact-copy 计 42 行 manifest。）
- 已拷的 34 个中生产代码只挂载 `vozeb-canvas.tsx` 1 个 UI 组件；另有 crop util 与 theme 两条非 UI 引用，其余 exact-copy UI 组件尚未成生产可达组件。
- 用户可见的节点卡/交互/精修/生成 UX 全为自建简版（kernel-host + canvas-shell 约 2k 行），这就是"低配新造"观感的来源。
- 根因：K03 验收无「与上游并排对标」条款（同族「验收不验体验」，见 `docs/reviews/uiux-productization-gap-report-2026-07-13.md`）。

## 图例

- ❌ 缺失：上游能力在产品中不存在
- 🔻 低配：存在但为粗糙替代
- ✅ 达标：等价或合理 SaaS 化适配
- ⤴ 超出：当前实现优于上游（SaaS 化增强，重做时**不得回退**）
- ⛔ 不迁：ADR-0012 排除（上游 runtime 耦合），由我方等价机制替代

---

## 1. 节点类型与节点卡片 UI

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 五类节点 Image/Text/Config/Video/Audio，类型化默认尺寸与标题（constants.ts:11-40） | 四类可渲染（image/video/audio/text），**无 Config 节点**；尺寸固定两档 | 🔻 |
| 富节点卡：状态四态（loading 旋转环/error 红字+重试按钮）（canvas-node.tsx:343-386） | 裸 `<fieldset>`，header 直接暴露技术字段名 "image"/"video"，状态仅文本字符串，无 spinner/重试 | 🔻 |
| 文本节点：字号调节、双击内联 mention 编辑、右上「生图」按钮（canvas-node.tsx:397-434） | 双击 textarea 编辑有；无字号、无生图按钮、无 mention | 🔻 |
| 图片节点：object-contain、双击大图预览（canvas-node.tsx:557-563,277-281） | img 渲染有；**无大图预览** | 🔻 |
| 批量组 batch stack：堆叠边框最多5张、展开/收起、「设为主图」（canvas-node.tsx:565-648; ccp:1802-1831） | 无（生成 count 恒为 1，见区 5） | ❌ |
| 视频/音频节点原生播放器+空态占位（canvas-node.tsx:503-529） | 有播放器+下载链接 | ✅ |
| 四角 resize 手柄，min 220×160，图/视锁比例，freeResize 切换（canvas-node.tsx:166-230; ccp:1781-1785） | **完全无 resize** | ❌ |
| 左右连接手柄（左 target 右 source，Config 无右）（canvas-node.tsx:665-682） | 无手柄（连线走按钮，见区 2） | ❌ |
| 选中蓝环/关联灰环/连接目标高亮（canvas-node.tsx:114-115,264-265） | 仅选中态 | 🔻 |
| 图片信息条（宽×高·体积）、资源引用角标（canvas-node.tsx:602-614,444-450） | 无 | ❌ |
| 「已采用」徽标（我方产品语义） | 有（kernel-canvas-surface.tsx:435-438） | ⤴ |

对应 vendor 资产：`canvas-node.tsx`（682 行，已拷未挂）。

## 2. 画布全局交互

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 平移（中键/左键空白拖）、滚轮光标锚点缩放 0.05–5、双指 pinch（vozeb-canvas.tsx:76-193） | ✅ 一致（唯一挂载的 vendor 组件所提供） | ✅ |
| 框选：Ctrl/Cmd+拖，Shift 追加（ccp:1326-1348） | Shift+拖才能框选（键位不同且无追加/普通二态） | 🔻 |
| 多选点击 toggle、Ctrl/Cmd+A 全选（ccp:1367-1372,1715） | 点击 toggle 有；**无全选** | 🔻 |
| 多选整组拖动含 batch 子节点、rAF 节流（ccp:1353-1533） | 多选整组拖动有 | ✅ |
| **拖拽连线**：手柄拖出、落节点即连（方向规范化）、落空白弹「引用该节点生成」五类创建菜单（ccp:1765,3608-3617,187,870） | 「连接选中」按钮且**必须恰好选 2 个节点**；无拖拽、无落空白创建 | 🔻 |
| 连线选中/右键/删除（canvas-connections.tsx:33-57; ccp:1736-1742） | 边为静态 SVG，不可选不可删 | ❌ |
| 右键菜单（节点：复制/删除）（canvas-context-menu.tsx:30-31） | 无 | ❌ |
| 小地图（自适应边界、类型着色、视口拖动定位）（canvas-mini-map.tsx） | 无 | ❌ |
| 缩放控件（小地图开关/重置视图/5–500% 滑块/快捷键帮助弹窗）（canvas-zoom-controls.tsx） | 只读缩放百分比文本 | 🔻 |
| 快捷键全集：⌘Z/⌘⇧Z/⌘Y、⌘A、⌘C/⌘V（内部剪贴板+系统剪贴板图文）、Delete/Backspace 删节点删连线、Esc 关浮层（ccp:1694-1763） | 仅 ⌘Z/⌘⇧Z；**无删除键、无复制粘贴、无全选、无 Esc 收敛** | 🔻 |
| 复制节点 +36 偏移、内部剪贴板带连线、粘贴画布中心锚点重定位（ccp:1160,1178,1198） | 无 | ❌ |
| 文件拖入画布上传（图/视/音分派）（ccp:2254）、剪贴板粘贴图片/文本（ccp:1675） | 无（上传仅左栏按钮，且仅 png/jpeg/webp） | ❌ |
| 撤销/重做深度 50、180ms 防抖、拖拽期间暂停（ccp:724-734,1390） | 会话内存历史有（无深度上限差异可接受） | ✅ |
| 背景网格 点/线/空白 三态切换（vozeb-canvas.tsx:279-299 + toolbar） | 固定 lines，无切换 UI | 🔻 |

## 3. 顶栏 / 工具栏 / hover 工具条

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 顶栏：汉堡菜单（主页/文档/我的画布/新建/删除/导入/撤销重做+快捷键标注）、标题双击内联重命名（ccp:3243-3293） | 顶栏有工程名+保存/检查点/重命名(window.prompt)/复制/删除 | 🔻 |
| 底部 dock 主工具栏：Hand、撤销重做、**添加 文本/图片/视频/音频/生成配置 五类节点**、上传、我的素材、外观面板（主题/网格/图片信息）、删除选中、清空画布（canvas-toolbar.tsx:79-198） | 添加入口仅「文字节点」+左栏素材点击插入；**无空图片/视频/音频/Config 节点创建、无外观面板、无删除选中、无清空画布** | 🔻 |
| hover 工具条 ~16 动作：信息/删除/重试/存素材/下载/编辑对话/编辑文字/生图/生成配置/字号±/上传替换媒体 + 图片专属工具集（canvas-node-hover-toolbar.tsx:156-197） | 无 hover 工具条 | ❌ |
| 节点信息弹窗（信息/JSON 双视图，JSON 脱敏）（canvas-node-hover-toolbar.tsx:238-290） | 无 | ❌ |
| 工具栏自定义（勾选可见工具+显示标签，localStorage 持久）（canvas-image-toolbar-settings-modal.tsx） | 无 | ❌ |

## 4. 图片精修套件（立项核心卖点）

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 交互式裁剪：拖拽裁剪框+8 手柄+比例锁定+三分线+实时像素/比例（canvas-node-crop-dialog.tsx） | 「方形裁切」按钮：**无裁剪框**，固定居中正方形（canvas-image-data.ts:37-45） | 🔻 |
| 局部蒙版重绘：双 canvas 涂抹、画笔/擦除、笔刷 8–160、蓝色蒙版预览、修改要求文本、PNG mask 产出（canvas-node-mask-edit-dialog.tsx） | 无涂抹 UI；image.edit 仅「蒙版 Asset 下拉」选既有资产 | ❌ |
| 放大：1K/2K/4K 档+三算法+输出尺寸预览（canvas-node-upscale-dialog.tsx） | 无（backend derivation 支持 upscale，UI 无入口） | ❌ |
| 切分：行列 1–12 网格预览、子节点右排+连线（canvas-node-split-dialog.tsx; ccp:1987） | 无（backend 支持 split，UI 无入口） | ❌ |
| AI 多角度：三滑杆+广角+CSS 3D 实时预览，走图片 edit 重生成（canvas-node-angle-dialog.tsx; ccp:2097） | 无 | ❌ |
| 反推提示词：图→文本+Config 节点+连线（ccp:1923） | 无 | ❌ |
| 精修结果=新子节点+派生连线（各 dialog → ccp） | 方形裁切有派生边（retouch-adapter.ts:18-79） | ✅（仅此一类） |

对应 vendor 资产：五个 dialog + `canvas-image-toolbar-tools.tsx` 已拷未挂；`splitDataUrl`/`upscaleDataUrl` 纯前端算法已在 `canvas-image-data`。

## 5. 生成链路 UX

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 节点内联生成面板（模式随节点类型、mention 输入、模型选择、设置 popover、积分成本显示）（canvas-node-prompt-panel.tsx） | 生成集中在右侧 RuntimePanel，**节点上无任何生成入口** | 🔻 |
| Config 节点面板：生图/文本/视频/音频 Segmented、输入摘要 chips、组装提示词（canvas-config-node-panel.tsx） | 无 Config 节点 | ❌ |
| 组装提示词 Composer：contentEditable + `@[node:ID]` 引用芯片、候选菜单、只注入被引素材（canvas-config-composer.tsx; canvas-node-generation.ts:57-114） | 裸 textarea | ❌ |
| 图片设置：质量/尺寸/**张数 1–15**；视频设置：分辨率/尺寸/时长/generateAudio/watermark；音频设置：音色/格式/语速/指令；比例选择含自定义（三个 popover + size-picker） | **零参数表单**。backend-port.ts:143-234 schema 已支持 width/height/resolution/strength/durationSeconds/generateAudio/watermark/voice/tone/speed/language/format 等，前端一个都没暴露；**count/quality 后端合同不存在，usage 恒 0/1**；ratio 仅随 seed 带入 | ❌ |
| 批量生成：count 并发+batch 堆叠+部分失败提示（ccp:2333-2465） | count 恒 1 | ❌ |
| 重试：溯源 Config 复用参数（ccp:2624,3666）；停止/中断（ccp:401-421） | 失败任务无重试；进行中可「请求取消」 | 🔻 |
| 文本流式回填（ccp:2540-2603） | 任务完成后一次性入库（我方 token 流式在主产品 Composer 已落，Pro Studio 未接） | 🔻 |
| 刷新恢复：中断态复位+任务续跑（ccp:635-708,3654） | 服务端持久任务+2s 轮询+commit-gate，**恢复能力强于上游** | ⤴ |
| 报价→确认两段式、额度预留/结算/退回、诚实状态八态+失败分类文案（runtime-panel.tsx:385-421; generation-ui-contract.ts:501-573） | 上游为请求级积分直扣 | ⤴ |
| 生成前置检查点（冻结 revision 输入绑定） | 上游无此概念 | ⤴ |
| 模型选择 ModelPicker（按 capability 列模型）[runtime-coupled] | 目录 6 operation 按钮+可用/未激活诚实原因；**D-099① 已拍板开放**（G47） | ❌（改判必修） |

## 6. 提示词与资源

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 提示词库弹窗（懒加载、分类/搜索）（canvas-prompt-library.tsx） | 40 条美业 seed 下拉，**全部锁死 image.generate**，选项文案暴露内部 `group·id·fileName` | 🔻 |
| 资源 @提及输入（候选菜单/键盘导航/chip 高亮/预览）（canvas-resource-mention-textarea.tsx） | 无 | ❌ |
| 素材选择弹窗（三类 tab/搜索/分页每页 8/hover 插入）（asset-picker-modal.tsx）[runtime-coupled 数据源] | 左栏缩略图网格，无搜索无分页；上传仅 png/jpeg/webp（无视频/音频上传） | 🔻 |

## 7. Agent / 助手

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 对话式助手面板：流式输出、会话管理/历史、20+ 画布工具、HITL 逐工具确认卡、noop 九类解释、图片粘贴、选区引用 chip、日志双视图、可拖宽（canvas-assistant-panel.tsx; canvas-agent-chat-ui.tsx） | 表单式：意图 textarea+成本/数量上限 → 计划 → 逐条勾选 → 应用；**非对话、无流式、无会话**；diff 为裸 JSON `<pre>` | 🔻 |
| Agent ops 引擎+单步撤销（canvas-agent-ops.ts; ccp:1013-1046） | 服务端 allowlist 七动词+凭据绑定（user/session/project/revision）+冲突强制重载+审计列表 | ⤴（治理强，交互弱） |
| 本机 Agent 桥（17371 SSE/Codex 线程/免确认自动连）（canvas-local-agent-panel.tsx） | 不迁（ADR-0012 禁拷上游 runtime 桥） | ⛔ |

> 判定口径：我方三段确认+凭据+审计是合规硬要求（D-032 族），重做时保留为底座；差距在**交互形态**——上游是对话式副驾，我方是审批表单。对齐方向 = 对话式外壳包住既有确认/凭据内核（与 ADR-0010「对话式外壳结构化内核」同口径）。**D-099③ 已拍板拆独立票 A1，不在本重做主线。**

## 8. 导出与工程管理

| 上游能力（证据） | 当前状态 | 级别 |
| --- | --- | --- |
| 工程列表卡：节点数·连线数·更新时间、多选、内联重命名、单项导出（canvas-project-card.tsx） | 左栏卡片仅 名称+草稿 vN；重命名/新建用 `window.prompt`，删除用 `window.confirm` | 🔻 |
| 删除确认 Modal（多选计数）（canvas-delete-projects-dialog.tsx） | 原生 confirm（软删语义正确） | 🔻 |
| zip 导出（projects.json+媒体）（canvas-export.ts） | 无导出；**D-099② 已拍板要做**（走独立 `pro-studio-canvas-export/v1` manifest，与 adoption 并存，G48） | ❌（改判必修） |
| 自动保存 400ms 防抖+pagehide/beforeunload flush（use-canvas-store.ts:54-107） | 1200ms 防抖+beforeunload 拦截+OCC 冲突提示+服务端持久 | ⤴ |
| 检查点/不可变 revision/恢复开新草稿 | 上游无 | ⤴ |
| 采用到 ContentPackage（有序选区、新建/写入现有、错误码中文映射） | 上游无；但「写入现有」需手填 Package ID/Base version/Aggregate revision 三个裸 input，应改为选择器 | ⤴（含一处 🔻） |

## 9. 其他

| 项 | 上游 | 当前 | 级别 |
| --- | --- | --- | --- |
| 主题 | 浅/深切换入工具栏 | 跟随 bootstrap+system，无画布内切换 | ✅（口径不同可接受） |
| 空态 | 各节点类型占位 | welcome/空画布/空检查点占位齐 | ✅ |
| 商家语言 | — | 顶栏直接暴露原始 `workspaceId`；节点 header 暴露 "image" 等技术词；seed 下拉暴露内部 id | 🔻（同 07-18 走查「商家语言泄漏」族） |
| 加载骨架 | CanvasRefreshShell | 无骨架 | 🔻 |

---

## 汇总

- 计数口径（rev1 校正，经 Codex 复核 l1F02/l2·18 + lane3 机械复算）：上表按最终级别**逐行字面计数**为 ❌ **22 行**、🔻 **24 行**、⤴ **8 行**、⛔ **1 行（本机 Agent 桥）**；另有 D-099 从原"⛔/待拍板"**改判为本票必修**的 2 行（模型选择、zip 导出）。合并入 G-index 后为 24 ❌ + 23 🔻 + 1 defer（Agent 对话行）= 48 行（本机 Agent 桥 ⛔ 单列不入 G-index）。初稿"❌17/🔻21"是去重后的能力项估数，非表行数——权威以下方 **G01–G48 行级核销索引**为准，不再用 17/21 口径。
- 差距最重两块：**精修套件**（区 4：六缺一低配，立项核心卖点整体未兑现）与**节点/交互层**（区 1–3：resize/hover 工具栏/右键/小地图/快捷键/拖拽连线成片缺失）。
- ⤴ 的 8 项（两段计费、检查点、adoption、OCC 草稿、服务端任务恢复、Agent 凭据治理、诚实状态、软删）是 SaaS 化真增强，**重做验收必须含"无回退"断言**。
- 本表是 commit-scoped 事实，不是永久库存。K1 开工前若 `apps/canvas/**`、`apps/core/src/pro-studio/**`、共享 model-supply/result-delivery 接缝已被 P0/P1 或其他分支修改，须对变更面重新盘点并更新 G 行状态、证据与 current product repo baseline。

### 行级核销索引（G01–G48）

稳定行 ID，供 spec/票逐行反向引用（每行"要么修复、要么票内记录豁免"）。级别取上表最终判级；`defer` = D-099③ 正确延期（Agent 对话外壳，不属本票修复）。

| ID | 区 | 能力 | 级别 |
| --- | --- | --- | --- |
| G01 | 1 | 五类节点/Config/类型默认尺寸 | 🔻 |
| G02 | 1 | 富节点卡四态/失败重试/中文状态 | 🔻 |
| G03 | 1 | 文本字号/mention 编辑/生图 | 🔻 |
| G04 | 1 | 图片双击大图 | 🔻 |
| G05 | 1 | batch stack/展开收起/设主图 | ❌ |
| G06 | 1 | 四角 resize/比例锁定/freeResize | ❌ |
| G07 | 1 | 左右连接手柄 | ❌ |
| G08 | 1 | 选中环/关联环/连接目标高亮 | 🔻 |
| G09 | 1 | 图片尺寸体积信息条/资源引用角标 | ❌ |
| G10 | 2 | Ctrl/Cmd 框选/Shift 追加 | 🔻 |
| G11 | 2 | 多选 toggle/Ctrl+A 全选 | 🔻 |
| G12 | 2 | 拖线连节点/落空白五类创建 | 🔻 |
| G13 | 2 | 连线选中/右键/删除 | ❌ |
| G14 | 2 | 节点右键复制/删除 | ❌ |
| G15 | 2 | 小地图 | ❌ |
| G16 | 2 | 小地图开关/重置/缩放滑块/帮助 | 🔻 |
| G17 | 2 | 完整快捷键（含 Delete/⌘C/⌘V/⌘A/Esc） | 🔻 |
| G18 | 2 | 复制带连线/中心锚位重定位 | ❌ |
| G19 | 2 | 文件拖入/剪贴板图文粘贴 | ❌ |
| G20 | 2 | 点/线/空白网格切换 | 🔻 |
| G21 | 3 | 顶栏菜单/内联重命名 | 🔻 |
| G22 | 3 | dock 工具栏五类节点/素材/外观/删除/清空 | 🔻 |
| G23 | 3 | hover 工具条 | ❌ |
| G24 | 3 | 节点信息弹窗 | ❌ |
| G25 | 3 | 图片工具栏自定义 | ❌ |
| G26 | 4 | 交互式裁剪 | 🔻 |
| G27 | 4 | 局部蒙版重绘 | ❌ |
| G28 | 4 | 1K/2K/4K 放大 | ❌ |
| G29 | 4 | 网格切分 | ❌ |
| G30 | 4 | AI 多角度 | ❌ |
| G31 | 4 | 反推提示词 | ❌ |
| G32 | 5 | 节点内联生成面板 | 🔻 |
| G33 | 5 | Config 节点生成面板 | ❌ |
| G34 | 5 | mention 芯片 Composer/只注入被引素材 | ❌ |
| G35 | 5 | 图片/视频/音频设置与自定义比例 | ❌ |
| G36 | 5 | count 并发/batch/部分失败 | ❌ |
| G37 | 5 | 失败重试复用参数 | 🔻 |
| G38 | 5 | 文本流式回填 | 🔻 |
| G39 | 6 | 提示词库分类搜索/人话标题/非单操作锁死 | 🔻 |
| G40 | 6 | 资源 @mention | ❌ |
| G41 | 6 | 素材选择三类 tab/搜索/分页/视频音频上传 | 🔻 |
| G42 | 7 | Agent 对话助手外壳 | `defer` |
| G43 | 8 | 工程卡信息/内联重命名/单项导出 | 🔻 |
| G44 | 8 | 产品化删除确认 | 🔻 |
| G45 | 9 | workspaceId/英文类型/seed id 泄漏 | 🔻 |
| G46 | 9 | 加载骨架 | 🔻 |
| G47 | — | 用户侧模型选择（D-099① 改判必修） | ❌ |
| G48 | — | zip 数据导出（D-099② 改判必修） | ❌ |

## 重做票验收基线（建议 DoD）

1. **对标走查**：按本表逐行核销；每个 ❌/🔻 要么修复、要么在票内记录用户豁免决定。验收含与上游 `a2c52c7` 本地起跑的并排截图走查（同场景：建节点→连线→生成→精修→采用）。
2. **精修四件套+多角度**真机可用：交互式裁剪框、蒙版涂抹重绘、放大、切分（走既有 `persistLocalCanvasArtifact` 的 crop/mask/split/upscale derivation，均为浏览器 pure transform 后上传，Core 仅持久化）+ 多角度重生成（angle 参数须定映射）；结果均为派生子节点+血缘边，刷新后血缘不丢。
3. **交互基线**：拖拽连线+落空白创建菜单、节点 resize、hover 工具条、右键菜单、小地图+缩放控件、快捷键全集（含 Delete/⌘C/⌘V/⌘A/Esc）、文件拖入与粘贴上传。
4. **生成参数表单**：三类设置 popover 暴露参数——视频时长/generateAudio/watermark、语音 voice/tone/speed/format 等 backend **已支持**（纯前端缺口）；但**张数 count 与质量 quality 后端合同尚不存在**（现网 usage 恒 0/1），属新合同（详见 spec D3.5/D4）；图片 count 批量+batch 堆叠组按 spec 冻结的批量账本合同走。
5. **挂载而非重写**：优先挂载 vendor 已拷 `mount-exact` 组件（canvas-node/hover-toolbar/toolbar/context-menu/connections/mini-map/zoom-controls/五 dialog/工具注册表/mention/asset-picker/composer）；组合根与生成编排层按「移植（ports）+ 适配层替换 runtime 调用」处理——**真实 port 闭包约 86 文件/1.9 万行，非"12 个排除件"**；上游 `web/src/components/` 下共享控件（image/video/audio-settings-panel、model-picker、prompt-select-dialog）先做 A2/A3 授权范围判定再定拷/重建。工程前提：canvas 服务引入 antd/zustand/localforage/Tailwind/React Query 等并锁版本、装 Ant SSR provider+QueryClient、生产可达 vendor 进 tsconfig typecheck；localForage/useThemeStore/useAssetStore 以 adapter 垫片重定向到 BackendPort。详见 spec 底座层 D1–D6。
6. **无回退断言**：⤴ 8 项逐项有测试锚。
7. **收尾卫生**：完成后**生产可达组件集**无死件（import graph + 浏览器旅程可见判定，非文本扫描；要么挂载、要么移出拷贝集并更新 manifest）；`window.prompt/confirm` 全部替换为产品对话框；商家语言泄漏三处（workspaceId/技术字段名/seed 内部 id）清除。
8. **三项已拍板（2026-07-22，D-099）**：① 用户侧模型选择**开放**——ModelPicker 接我方 catalog，D-044 平台默认降级为缺省值（区 5 该行由 ⛔/待拍板 改判 ❌ 纳入修复，G47）；② zip 数据导出**要做**——与 adoption 并存，媒体从对象存储服务端收集打包，走独立 `pro-studio-canvas-export/v1` manifest（区 8 该行改判 ❌ 纳入修复，G48）；③ Agent 对话式外壳**独立票**——不并入画布重做主线，流式对齐 ADR-0007（区 7 判定口径不变，G42 defer）。
9. **两线共享合同**：Canvas GenerationJob 以 `advanced_canvas_project_revision` 为 origin，不进入 Composer Coordinator/Harness；batch 每 item 一个 job/reservation；adoption 只调用唯一 ContentPackage revision port；G48 逐 Asset 执行 workspace access、`private_retrieval_eligible` 与 export policy，不因独立 Canvas manifest 绕过撤权或访问门。

## 附：vendor 拷贝件挂载状态清单

已拷未挂（33，按重要度）：canvas-node、canvas-node-hover-toolbar、canvas-toolbar、canvas-connections、canvas-context-menu、canvas-mini-map、canvas-zoom-controls、canvas-node-crop-dialog、canvas-node-mask-edit-dialog、canvas-node-upscale-dialog、canvas-node-split-dialog、canvas-node-angle-dialog、canvas-image-toolbar-tools、canvas-image-toolbar-settings-modal、canvas-config-composer、canvas-resource-mention-textarea、canvas-prompt-library、asset-picker-modal、canvas-size-picker、canvas-project-card、canvas-delete-projects-dialog、canvas-agent-chat-ui、canvas-agent-panel-motion、use-canvas-store、use-canvas-ui-store、canvas-agent-ops、canvas-resource-references、canvas-node-size、canvas-image-data(部分用)、constants、types、export-types、[id]/page。

> 分类去向（K1 生产白名单 D2 定案）：多数进 `mount-exact`；Agent UI（canvas-agent-chat-ui/panel-motion）与 canvas-agent-ops 归 A1 独立票域，本重做主线 `out-of-scope`；use-canvas-store、[id]/page 归 `delete-from-inventory`（本地持久化/上游路由，由宿主 state controller 取代）。

未拷需评估补拷（12）：canvas-client-page（组合根，主移植对象，走 ports）、canvas-node-generation、canvas-node-prompt-panel、canvas-config-node-panel、canvas-image/video/audio-settings-popover、canvas-assistant-panel（⛔ 归 A1）、canvas-local-agent-panel（⛔ 不拷）、use-canvas-agent-store（⛔ 归 A1）、canvas-export（**D-099② 必修，实现走独立 Canvas export contract**）、page.tsx。
