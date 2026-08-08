---
title: Pro Studio 画布上游对标重做实施规格（D-099）
status: superseded
triage: historical
date: 2026-07-22
revision: 2
tracker_issue: https://github.com/legacy-origin-a/legacy-web-repo/issues/162
source_of_truth:
  - 决策: D-099（docs/design/beauty-marketing-agent-product-design-2026-07-17.md）— **superseded by D-170**
  - 退役权威: docs/specs/pro-studio-retirement-spec-2026-08-01.md + D-170
  - 验收基线: docs/evidence/pro-studio/upstream-parity-gap-baseline-2026-07-22.md（G01–G48 行级核销索引；含 D-099 改判两行）
  - P0 共享底座: docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md（Issue #129）
  - P1 主线投影与治理: docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md（Issue #130）
  - 父规格: docs/specs/pro-studio-kernel-integration-spec.md（K01–K11；本规格修订其 K03 结论，其余不重开）
  - 祖规格: docs/specs/vozeb-adoption-pro-studio-spec.md（rev2，领域合同与发布门不重开）
  - ADR-0011 ContentPackage 唯一成品聚合 / ADR-0012 两线边界与授权口径（ADR-0012 superseded by D-170）
  - A2/A3 书面授权: docs/evidence/pro-studio/a2-authorization-2026-07-19.md、a3-authorization-2026-07-19.md
  - 上游钉死: csyqlz/vozeb @ a2c52c7（v1.0.0，本地镜像 references/repos/vozeb）
  - copy-manifest 现状: docs/evidence/pro-studio/copy-manifest.json（schemaVersion 1，42 行 exact copies）+ scripts/pro-studio/（apply-exact-copies / conformance-gate / kernel-integration-gate.test）
  - rev0→rev1→rev2 复核: .scratch/pro-studio-parity-spec-review-2026-07-22/（lane1 决策保真 + lane2 代码现实 + lane3 确认复核，处置见本文「复核处置」节）
---

# Pro Studio 画布上游对标重做实施规格

> **SUPERSEDED（2026-08-01）**：D-099 / K1–K7 parity 重做入口已废止。Pro Studio **全量退役（D-170）**；现行实施权威＝[`pro-studio-retirement-spec-2026-08-01.md`](./pro-studio-retirement-spec-2026-08-01.md)。本文正文仅作历史工程合同追溯，不得再拆 parity 票。
>
> 承接 D-099（历史）：K01–K11 交付的画布是"文件拷了、内核没挂"的自建简版（上游 canvas 目录 46 候选、exact-copy 34 个 canvas 组件 + 8 个共享 util 计 42 行 manifest；生产只挂载 1 个上游 UI 组件 `VozebCanvas`，另有 crop util 与 theme 两条非 UI 引用，其余 exact-copy UI 组件尚未成为生产可达组件）。本规格把画布重做为**真挂载上游内核**的高阶工作台，验收以对标基线逐行核销 + 与上游并排走查为准。Agent 对话式外壳按 D-099③ 独立成线，不在本规格。
>
> **rev2 关键结构（两路 Codex 复核 + 一路确认复核后）**：本规格不是"挂载 + 补 12 个文件"的接线活。真实 port 闭包约 86 个本地文件、近 1.9 万行，且现网缺三类合同（批量账本 / 模型选择端到端 / 画布导出公共接缝）。因此**功能票（K2–K7）前置一层「底座」(K1)**：manifest/port 治理、生产组件白名单、BackendPort vNext 合同冻结、批量账本合同拍板、宿主 UI runtime、跨包属主协调——K1 不落地，功能票不得开工。
>
> **与 P0/P1 的执行边界**：Pro Studio 的执行输入是不可变 `AdvancedCanvasProjectRevision + GenerationCheckpoint`，节点级生成是 Canvas GenerationJob，不进入 Composer 的 `CreationSubmissionCoordinator` 或营销五阶段 Harness，也不伪造 Recipe/Surface/Lens/platform。它必须复用 P0 的 Product Core 共享不变量；Asset 使用 `advanced_canvas_project_revision` originRef，只有显式 adoption 才通过唯一 ContentPackage revision port 写成品。P1 只治理 adoption 后的成品和 Pro Studio 来源 OwnedAsset，不接管画布工程。

## Problem Statement

升单客群（陪跑教练、中高阶商家）进入 Pro Studio 后看到的不是规划承诺的"上游式无限画布与精修"，而是一个功能骨架完整但交互简陋的替代品：

- 节点是裸卡片：不能改大小、没有悬浮工具条、没有右键菜单、类型名直接显示英文技术字段；图片不能点开大图。
- 连线要"恰好选中 2 个节点再按按钮"，不能从节点手柄拖出；连好的线不能选中、不能删除。
- 键盘上只有撤销/重做能用：Delete 删不了节点，复制粘贴、全选、Esc 收敛浮层都没有；文件拖不进画布。
- 立项核心卖点图片精修，六项能力只剩一个"无框居中方形裁切"：没有裁剪框、没有蒙版涂抹重绘、没有放大、没有切分、没有多角度、没有反推提示词——其中五个精修弹窗已 exact-copy 在 vendor（裁剪/蒙版/放大/切分/多角度），反推提示词是上游组合根逻辑（非独立弹窗）；纯前端变换 helper（crop/split/upscale）也已在仓库，但只有 crop 接了线。
- 生成没有任何参数表单：视频时长、音色语速等参数**后端已支持**（BackendPort 图片 width/height/ratio/resolution、视频 durationSeconds/generateAudio/watermark、语音 voice/tone/speed/format 等），但前端一个都没暴露；**张数（count）与质量（quality）后端合同尚不存在**——现网一次只能生成一张，也没有模型选择入口。
- 没有小地图、没有缩放控件、背景网格不能换；工程重命名弹的是浏览器原生 `window.prompt`。
- 顶栏直接暴露原始 workspaceId，提示词种子下拉暴露内部工程编号。

结果是演示与升单验证无法按规划走通，且"演示时像个 demo"直接损害升单档的可信度。

## Solution

按"挂载而非重写"重做画布的用户可见层，但先立底座、再上功能。

**底座（K1，功能票前置门，详见 Implementation Decisions「底座」小节）**：

- manifest/port 治理：`copies[]` 只承载字节级 exact-copy 不变；组合根移植另建 `ports[]`（源/钉死 commit/目标/内容 hash/授权证据/适配替换矩阵），并升级重放脚本、conformance gate 与硬编码 42 的测试，使 ported 文件不被 CI 误判或被重放删除。
- 生产组件白名单：把现有 42 个 exact 文件逐一分类为 `mount-exact` / `utility-exact` / `port-required` / `delete-from-inventory` / `out-of-scope`（Agent UI、上游 project page、本地持久化 store 归 out-of-scope 或仅审计归档，不靠制造假引用过"零死件"门）。
- BackendPort vNext 合同冻结：K1 交付一张封闭矩阵，列清并冻结所有新增/变更动作与字段——`modelId`、`defaultModelIdByOperation`/`unavailableReasonCode`、批量 quote/submit（仅当选 A）、画布导出、提示词目录、素材分页查询、成品选择列表、bootstrap workspace 显示名；每项带 request/response schema、兼容策略、幂等、错误码、Core owner、测试名。
- 批量账本合同拍板（见下）。
- 宿主 UI runtime：装包并锁版本（antd 6 / zustand 5 / localforage / Tailwind 4 / React Query / lucide / radix 等）、安装 Ant SSR provider 与 QueryClient、决定样式移植策略、让生产可达 vendor 进入 tsconfig 的 typecheck/build（现网 tsconfig 排除整个 `src/vendor`）。
- 跨包属主协调：见「跨包属主与合并序」节。

**功能（K2–K7，仅在 K1 冻结后开工）**：

- 把白名单里的 `mount-exact` 上游组件挂载为生产 UI（节点卡、悬浮工具条、主工具栏、右键菜单、连线、小地图、缩放控件、五个精修弹窗、工具注册表、@提及输入、素材选择、提示词库、尺寸选择、项目卡、删除弹窗）。**Agent 聊天 UI / 面板动效 / assistant 组合根不在挂载集**（D-099③ 独立线）；`canvas-agent-ops` 仅作为既有七动词/确认凭据治理内核的实现依赖存在，不得借此挂出对话壳。
- 移植上游组合根与生成编排层（画布主页面按功能段移植、节点生成组装、三个生成设置弹层、节点内联生成面板、Config 节点面板），把其中 localForage/IndexedDB/进程内任务/积分/模型渠道/服务调用逐项替换为宿主适配层等价物；只有 prop-pure leaf 才 exact-copy，组合根走 `ports[]`。**保留当前 `/` 鉴权 composition root**，新建宿主 state controller 把服务端 project/revision/job/asset 投影成上游 `CanvasNodeData`；本机 Agent 桥继续禁拷。
- 生成链路补齐参数表单与批量能力；按 D-099① 开放用户侧模型选择（平台默认供给从"唯一值"降级为"缺省值"，用户选的是 CatalogModel，供应渠道仍隐藏）。
- 按 D-099② 提供画布工程 zip 导出（创作过程资产带走权），与"采用到成品库"并存，走独立 `pro-studio-canvas-export/v1` manifest（不复用成品交付 manifest 的 package/platform/rights 语义），媒体从对象存储服务端收集。
- 当前实现优于上游的 8 项 SaaS 增强（报价两段式计费、生成前置检查点、采用到 ContentPackage、OCC 草稿保护、服务端任务恢复、Agent 凭据治理、诚实状态阶梯、软删除）全部保留，验收含无回退断言（各绑定测试锚，拆票时回填用例名）。
- 收尾卫生：**生产可达组件集**无死件（以 import graph + 浏览器旅程可见为机器口径，非文本 `rg` 扫描）；浏览器原生弹窗全部替换；商家语言泄漏清除；copy-manifest / ports-manifest 回写全部文件并有 CI 一致性校验。

## Test Seams

- **唯一领域接缝不变**：Canvas `BackendPort`（同源 canvas API）→ Product Core Application Service。本规格不新增跨服务领域接缝（`workspaceDisplayName` 落在既有 launch/bootstrap 上下文 seam，非第二领域 seam）。
- **执行来源判别**：Canvas quote/submit/job/Asset 必须绑定 projectId、revisionId、checkpointId、nodeId/itemId，并向公共 lineage 投影 `originRef.type=advanced_canvas_project_revision`。这一引用与主线 `marketing_creation_snapshot` 并列，不建立第二套 Catalog、Route、Usage、Cost、Asset、Capability 或审计事实。
- 上游内核对宿主环境的依赖（本地持久化、主题、素材库、生成调用、积分显示、模型渠道）通过 canvas 服务内部的**垫片/适配层**改接到既有 adapter（工程持久化、媒体、生成、采用、精修），垫片属于实现细节，不构成对外合同。
- UI 验收接缝 = Playwright 浏览器旅程（既有内核旅程 spec 的迁移+扩展），除注册/解锁 setup 外不得直调 Canvas action API。
- 交互逻辑的纯函数部分沿用既有纯函数测试接缝。

## User Stories

### 节点与卡片

1. As a 中高阶商家运营, I want 画布节点是带类型中文标签、状态动效（生成中转环/失败红字+重试）的富卡片, so that 我一眼能读懂每个节点在干什么而不是看英文字段名。
2. As a 中高阶商家运营, I want 拖四角手柄改节点大小（图片/视频锁比例，可切自由比例）, so that 我能按内容重要性布置画布。
3. As a 中高阶商家运营, I want 双击图片节点看大图, so that 我能检查细节再决定精修方向。
4. As a 中高阶商家运营, I want 文本节点双击改字、调字号、一键"生图", so that 文字想法能直接变成图片实验。
5. As a 中高阶商家运营, I want 悬浮在节点上出现工具条（信息/删除/下载/存素材/精修工具等，按节点类型出条目）, so that 高频动作不用去找全局菜单。
6. As a 中高阶商家运营, I want 自定义图片工具条显示哪些快捷工具, so that 我的高频精修动作触手可及。
7. As a 中高阶商家运营, I want 节点信息弹窗看 ID/尺寸/位置/状态/提示词, so that 排查问题不用猜。
8. As a 中高阶商家运营, I want 一次生成多张时结果以堆叠组呈现、可展开、可设主图, so that 多方向择优在画布上完成。

### 画布交互

9. As a 中高阶商家运营, I want 从节点手柄拖出连线、落到目标节点即连, so that 表达"这个素材喂给那个生成"像画图一样自然。
10. As a 中高阶商家运营, I want 拖线落在空白处时弹出"引用该节点生成"创建菜单（文本/图片/视频/音频/配置）, so that 探索分支一步长出来。
11. As a 中高阶商家运营, I want 点选连线并删除它, so that 输入关系画错了能改。
12. As a 中高阶商家运营, I want 右键节点出现复制/删除菜单, so that 常用操作符合肌肉记忆。
13. As a 中高阶商家运营, I want 全套快捷键（撤销/重做/全选/复制/粘贴/Delete 删除/Esc 收敛浮层）, so that 大工程操作效率有保障。
14. As a 中高阶商家运营, I want 复制粘贴节点保留连线并以画布中心重新锚位, so that 复用一组实验结构不用重搭。
15. As a 中高阶商家运营, I want 把图片/视频/音频文件直接拖进画布或从剪贴板粘贴, so that 素材入场零仪式。
16. As a 中高阶商家运营, I want 小地图和缩放控件（重置视图/缩放滑块/快捷键帮助）, so that 大画布不迷路。
17. As a 中高阶商家运营, I want 框选/追加框选与上游一致的键位, so that 从上游或教程迁移来的习惯直接可用。
18. As a 中高阶商家运营, I want 切换背景网格（点/线/空白）与图片信息等已批准的画布显示项, so that 演示与截图场景可控（深浅主题仍由 bootstrap/system 决定，不新增画布内主题真相）。

### 图片精修（核心卖点）

19. As a 中高阶商家运营, I want 交互式裁剪：拖裁剪框、8 向手柄、比例锁定、三分构图线、实时像素显示, so that 裁出的图直接可用于投放位。
20. As a 中高阶商家运营, I want 局部蒙版重绘：在图上涂抹选区、调笔刷、写修改要求, so that 只改画面一部分不重生成整张。
21. As a 中高阶商家运营, I want 图片放大（目标 1K/2K/4K 档+算法选择+输出尺寸预览）, so that 低清素材能达到投放标准。
22. As a 中高阶商家运营, I want 图片切分（行×列网格预览，子图成节点排布并连线）, so that 长图/拼图素材能拆开复用。
23. As a 中高阶商家运营, I want AI 多角度（方向滑杆+3D 预览，基于原图重生成新视角）, so that 一张产品图变一组机位。
24. As a 中高阶商家运营, I want 反推提示词（图→文本节点+配置节点+连线）, so that 好图的风格可以复用为提示词。
25. As a 中高阶商家运营, I want 所有精修结果都是带派生连线的新节点且刷新后血缘不丢, so that 我能对比多个方向再择优。

### 生成链路

26. As a 中高阶商家运营, I want 在节点上直接生成（面板随节点类型给对应输入）, so that 不用把注意力切到侧栏。
27. As a 中高阶商家运营, I want Config 配置节点聚合多路输入并切换生图/文本/视频/音频模式, so that 复杂实验的输入关系可视化。
28. As a 中高阶商家运营, I want 组装提示词编辑器（@ 引用已连接素材成芯片，只注入被引素材）, so that 提示词精确控制用哪些参考。
29. As a 中高阶商家运营, I want 图片生成参数表单（质量/尺寸比例含自定义/张数）, so that 不同投放位的规格一次到位。
30. As a 中高阶商家运营, I want 视频生成参数表单（分辨率/比例/时长/是否生成音频/水印开关按能力声明）, so that 高阶视频实验不出走。
31. As a 中高阶商家运营, I want 音频生成参数表单（音色/格式/语速/念稿指令）, so that 配音符合门店人设。
32. As a 中高阶商家运营, I want 选择用哪个模型生成（按能力列出目录内可用模型，平台默认为缺省值；未激活模型诚实标注不可选）, so that 我能按效果偏好换模型（D-099①）。
33. As a 中高阶商家运营, I want 一次生成多张（张数上限内）并以堆叠组入画布、部分失败有明确提示, so that 批量探索不逐张点。
34. As a 中高阶商家运营, I want 失败任务一键重试并复用原参数, so that 偶发失败不用重配。
35. As a 中高阶商家运营, I want 文本生成结果在文本节点内 token/delta 流式回填、刷新后以 durable 最终文本为准, so that 写文案时能边看边等而不是干等（对齐 ADR-0007；流式投影不得成为第二事实源；此项独立于 D-099③ Agent 对话流）。
36. As a 中高阶商家运营, I want 报价→确认两段式与额度预留/结算/退回继续有效, so that 批量生成的花费依然可解释（无回退）。
37. As a 中高阶商家运营, I want 生成仍以检查点冻结输入 revision, so that 结果可溯源（无回退）。

### 提示词与资源

38. As a 中高阶商家运营, I want 提示词库以分类可搜索的弹窗呈现、条目是人话标题, so that 起步不靠内部编号下拉。
39. As a 中高阶商家运营, I want 提示词输入支持 @ 提及画布资源, so that 引用素材不用记 ID。
40. As a 中高阶商家运营, I want 素材选择弹窗（分类 tab/搜索/分页）从本店素材库插入, so that 门店真实照片快速进画布。
41. As a 中高阶商家运营, I want 上传支持视频与音频（不只图片三格式）, so that 全模态素材都能入画布。

### 工程管理与导出

42. As a 中高阶商家运营, I want 工程卡显示节点数/连线数/更新时间、内联重命名、产品化的删除确认弹窗, so that 工程管理不再弹浏览器原生框。
43. As a 中高阶商家运营, I want 把画布工程导出为 zip（工程数据+媒体文件，服务端从对象存储收集）, so that 创作过程资产可以带走或归档（D-099②）。
44. As a 中高阶商家运营, I want 检查点、恢复开新草稿、OCC 冲突提示继续有效, so that 云端工程可靠性不回退。
45. As a 中高阶商家运营, I want 采用到成品库时"写入现有"用选择器挑成品而不是手填三个 ID, so that 采用不需要工程师陪同。

### 壳与语言

46. As a 单店商户, I want 顶栏显示工作区名称而非原始 ID、界面无英文技术字段泄漏, so that 这是我的产品不是工程后台。
47. As a 中高阶商家运营, I want 画布加载有骨架屏, so that 打开大工程不白屏。
48. As a 平台工程负责人, I want 所有 exact-copy 上游文件进 copy-manifest（来源/目标/sha256/A2/A3）、所有移植文件进 ports-manifest（源/钉死 commit/内容 hash/授权/适配矩阵）且 CI 校验一致性, so that 授权合规可审计且 exact 与 derived 不混淆。
49. As a 平台工程负责人, I want 完成后生产可达组件集无死件（import graph + 浏览器旅程可见为准，非文本扫描）, so that "拷了没挂"不再发生。
50. As a 平台工程负责人, I want 与上游钉死 commit 的并排走查记录（同场景截图对照）作为验收证据, so that "原样迁移"有可复核的定义。

## Implementation Decisions

> 分两层：**底座（D1–D6，K1，功能票前置门）** 必须先落地并冻结合同；**功能（D7–D18，K2–K7）** 在底座冻结后按依赖序开工。**D19 是继承门/验收边界**（K03 结论修订与父规格不变项），既非底座亦非功能，拆票工具不得按 D7–D18 截断而漏掉它。

### 底座（K1）

1. **manifest/port 治理双轨（含 port 审计门，不弱于 exact-copy 门）**：`copies[]` 只承载字节级 exact-copy，行结构与现行一致（source/target/sha256/authorizationStatus/a2Evidence/a3Evidence），vendor exact 文件保持只读、放 vendor 根。组合根与被改写的移植文件另建 `ports[]`，**port 行 schema 固定为**：`source`、`pinnedCommit`、`target`、`sourceSha256`（源@commit）、`targetSha256`（或规范 patch hash）、`authorizationStatus`、`a2Evidence`、`a3Evidence`、`thirdPartyNotes`、`reviewer`、`adaptationBoundary`、`adapterReplacementMatrix`，落 `src/kernel-host/ported/`，**不冒充 exact-copy conformance**。**前置**：现行 A2/A3 只为 `copies[]` 逐行授权（A2 甚至写"only by hashed copies[] rows"），故 K1 须先补 **A2/A3 derivative/port addendum**，把逐行授权规则扩到 port 行，再冻结 port schema。K1 第一动作是升级 manifest schema、`apply-exact-copies` 重放脚本、`conformance-gate`（**新增 ported-root ↔ `ports[]` 双向发现：每个 `src/kernel-host/ported/**` 文件恰一行、每行 target 存在且 targetSha256 重算一致、source 存在于 pinnedCommit、拒绝越界 target 与重复 source/target、拒绝未登记 port 文件**）与硬编码 `copies.length===42` 的测试，使 ported 文件既不被 gate 判错也不被重放删除；组合根含的 `@/services/**`、`use-config-store` 等现行 forbidden pattern 只能由"替换矩阵中已有宿主替换且代码扫描已消解"的条目关闭，不得静默进 exact 集。
2. **生产组件白名单**：把现有 42 个 exact 文件逐一分类 `mount-exact`（挂为生产 UI）/ `utility-exact`（crop helper、theme re-export 等非 UI 引用）/ `port-required`（走 ports）/ `delete-from-inventory`（从生产 inventory 移除，如上游 project page、`use-canvas-store`）/ `out-of-scope`（Agent UI/桥，仅审计归档）。**"无死件"针对经批准的生产集合，不靠制造假引用把 Agent/store 过门。** 白名单是 K1 产物，后续票只动白名单内文件。
3. **BackendPort vNext 合同冻结（K1 交付一张封闭矩阵，非开放清单）**：K1 DoD 内产出并冻结一张 vNext 矩阵，每行含 `action/field · request schema · response schema · 旧客户端兼容 · idempotency · 错误码 · Core owner · 测试名`，覆盖：`modelId?`（进 quote payload hash / submit quote 匹配 / 重试快照）、`defaultModelIdByOperation` 与前端安全 `unavailableReasonCode`（D10）、批量 action（**仅当 D4 选 A**，见 D4）、画布导出 action（D14）、`listPrompts(query/category/cursor)`、`listAssets(kind/query/cursor)`、`listAdoptionTargets(query/cursor)`。所有 generation action 还必须绑定 projectId/revisionId/checkpointId/nodeId 或 itemId，并在 Job/Asset lineage 中形成 `advanced_canvas_project_revision` originRef；不接受客户端传入营销 `CreationExecutionSnapshot` 占位字段。Canvas `generationInputSchema` 现为 strict，未声明字段会被拒——故所有新入参必须显式进 schema。以上均为 BackendPort → Product Core Application Service 这一唯一领域 seam 上的 additive；**`workspaceDisplayName` 例外**：它是既有 launch/bootstrap 上下文 seam 的 additive field（见 D16），不是 BackendPort 领域 seam 字段，二者分列不建第二领域事实源。
3.5. **参数矩阵盘点（逐项归类，非笼统"新合同"）**：每个 operation 参数标一种处置——`existing BackendPort field`（图片 width/height/ratio/resolution、视频 durationSeconds/generateAudio/ratio/resolution/watermark、语音 voice/tone/speed/language/format/maxDurationSeconds，纯前端接线）/ `UI alias normalized before BackendPort`（如 `quality` 若只是模型能力对 resolution 的产品化别名，写归一化规则、BackendPort 不新增字段）/ `new BackendPort field`（如 `count`，须进 strict schema 且与 D4 批量合同一致）/ `Core capability-registry change`（若某参数须扩 Core 能力注册表）。音频"念稿指令"短期归 `UI alias`（映射通用 `prompt`）。
4. **批量账本合同拍板（A/B 二选一，D3/Testing 随选项条件化）**：现网一次 submit 一 job、一 reservation、usage 恒 0/1，无 `count`；上游"1–15 张"实为前端 fan-out N 次单张调用。K1 二选一并写死，功能票不临场决定：
   - **方案 A（首选，保 D-099 两段计费无回退）**：新增 `quoteBatch/submitBatch`——`BatchQuote{quoteId,batchId,items[{itemId,payloadHash,idempotencyKey,usage,cost}],total}`，**冻结不变量**：batch 只是聚合确认，不是一个计费 Task；每个 item 原子创建一个独立 GenerationJob 与一个 reservation；total 必等于冻结 line items 之和；每项 idempotencyKey 绑定 quote item/job/reservation；并发上限致部分未入队时该项落"未 reserve"（非 reserve 后 release）；重试复用原 item/quote/job；前端所称"退款"在账本上必须落为既有 `release` 终态，不另造 refund 终态。补 repository/schema、并发上限、重试、逐项账本测试。
   - **方案 B（回退，仅当 K1 判 A 过重）**：宿主 fan-out N 个**现有**单张 quote+submit，每个 item 仍对应一个 GenerationJob 与一个 reservation，batch 仅作画布投影；冻结"一次 UI 确认展示 N 个 quote 总和、确定性 item keys、逐项提交/恢复"，**不新增 batch endpoint**。
   A/B 均须满足 US33（一次批量 UX）与 US36（两段计费不回退）。D3 的批量 action 与 Testing 的 batch quote/submit 断言**仅在选 A 时**生效；选 B 时测 N 个既有 quote/submit + 一个 UI batch projection。
5. **宿主 UI runtime**：Canvas 现依赖仅 `@meiye/core/next/pg/react/react-dom/zod`，无 antd/zustand/localforage/Tailwind/React Query/lucide/radix；当前 UI 是手写 CSS。K1 装包锁版本（对齐上游 antd 6.4.2 / zustand 5.0.12 / localforage 1.10.0 等，用 lockfile+build 验 antd6×React19×Next SSR registry 组合）、在 root layout 安装 AntdRegistry+ConfigProvider+Ant `App`+QueryClientProvider、决定 Tailwind4 引入或样式移植、**让生产可达 vendor 进入 tsconfig typecheck/build**（现网 tsconfig 排除整个 `src/vendor`，故现有绿灯未 typecheck 上游组件）。K1 同时冻结 Canvas 独立 production entry 的 gzip/chunk 预算和 lazy-loading 规则，并证明依赖不会进入主 Web 初始 350 KB 包；装包完成不等于验收通过。
6. **宿主 composition root 与 state bridge**：保留当前 `/` 服务端鉴权 root，**不 exact-mount 上游 `/canvas/[id]` page/store**；新建宿主 state controller 把服务端 project/revision/job/asset 投影成上游 `CanvasNodeData`（title/position/width/height/metadata/batch/task/storage 字段），并为 metadata/batch/任务状态/布局/连接/viewport 分别定持久（进 revision）与会话（UI session）边界。graph-bridge 扩为上游 NodeData ↔ Core `{nodes[].data,edges,schemaVersion}` 的双向映射合同。绝不让 localForage 与服务端草稿形成双权威。

### 功能（K2–K7）

7. **挂载而非重写**：用户可见层以白名单 `mount-exact` 上游组件为准；现自建简版 surface/节点渲染在对应组件挂载后退役。既有适配层"复用已有能力并补齐 kernel ports"——实测覆盖：工程持久化较完整；media 仅 delivery/persist/node helper；generation 仅可用性判断+单任务 payload+job→node；adoption 严校验但写现有成品仍需三 ID；agent 有 plan/confirm/apply/audit；retouch 仅 crop；interactions 有历史/框选/拖动/文本但快捷键只识别 ⌘Z。故需逐项新增：node model bridge、connection CRUD、clipboard/keyboard 全集、batch 投影、job retry、asset query、prompt catalog、package lookup、retouch operations——不得隐含进一张组合根票。
8. **移植而非 exact-copy 组合根**：上游画布主页面（3723 行）与生成编排层按功能段移植进宿主，把 localForage/IndexedDB/进程内任务/积分/模型渠道/服务调用逐项替换为适配层等价物；只有 prop-pure leaf 才 exact-copy。**真实 port 闭包约 86 个本地文件、近 1.9 万行（其中约 49 个在现 manifest 外）**，K1 白名单票须产出逐 import 替换矩阵与封闭文件清单，禁止以"补 12 个文件"估工。
9. **垫片映射（拆持久/会话两类）**：进 server draft/checkpoint 的**只有**节点/边/派生血缘/OwnedAsset 引用；viewport、选区、临时面板、工具栏显示偏好（上游 localStorage）留 UI session 或用户偏好存储，**绝不进工程 revision**（父/祖规格边界）。其余映射：主题 store→bootstrap 主题桥；素材 store→BackendPort 素材通路；生成调用→报价/提交两段合同；积分成本显示→额度报价（reserve/commit/release）；模型渠道就绪→服务端目录激活状态。持久与会话各加合同测试。
10. **模型选择开放（D-099①）**：Canvas 公开请求加 `modelId?`；Core catalog 已返回 models(active/capabilities) 与 operation 默认 modelId，但 Canvas `Catalog` 类型现忽略 `models`、schema 无 modelId——K1 补 `defaultModelIdByOperation` 与前端安全 `unavailableReasonCode`（不暴露 provider/deployment）。选择器按能力列目录内模型；平台默认（D-044）为缺省值（不靠数组首元素偶然顺序）；未激活不可选并给诚实原因；成本语言遵守"无价门"。
11. **批量生成 UX**：按 D4 冻结的合同落地；批量结果以 batch 堆叠组入画布、可展开、可设主图；部分失败逐张标注、失败张额度退回。
12. **精修通路**：crop/split/upscale 是**浏览器 pure transform 后上传、服务端仅持久化**（Core 接受 crop/mask/retouch/split/upscale bytes 但不执行算法；vendor 已有 pure helper，split/upscale 未接线）——split 补多资产原子性/部分失败合同、upscale 补算法档位与输出尺寸合同；mask 走 `persist mask asset → image.edit(reference+mask)`；**angle 现无 capability 参数**（image.edit 仅 width/height/ratio/resolution/strength），须定义四角度参数如何规范化进 prompt 或正式扩 capability 参数，不能只写"走 image edit"。所有精修结果为新节点+派生边，血缘服务端持久。
13. **文本流式（US35，ADR-0007）**：`text.respond` 的 token/delta 在文本节点内可见回填，复用主线 SSE envelope、sequence、恢复与去重语义；刷新后以 durable canvas text node + project revision 为最终真相，不以 ContentPackage 校准。流式投影不得成为第二事实源。独立于 D-099③ Agent 对话流。
14. **zip 导出（D-099②）**：抽取中性 deterministic-zip pure export 或由 Core 新增 Canvas export application service（现网 `packDeterministicZip` 存在但未从 `@meiye/core` exports 暴露、Canvas 无 export action）；走**独立 `pro-studio-canvas-export/v1` manifest**，不复用成品交付 manifest 的 package/platform/rights 语义，但不得绕过 P1 Asset 权利与访问策略。服务端从对象存储收集引用媒体前，逐 Asset 校验 workspace access、当前 `private_retrieval_eligible` 与 export policy；不可导出项默认使请求 fail-closed，只有用户明确选择“仅导出可用项”时才可排除，并在 manifest 写入稳定 reason code/warning。补齐缺失/重复资产、checksum、文件名碰撞、大小上限/流式、审计持久化、Pro Studio 权益门和 retrieval receipt。AI 生成媒体只有在 OwnedAsset 当前策略允许时原样导出（过程资产）；成品标识义务仍由主线 adoption/交付链承担。
15. **八项无回退**：报价两段式、检查点前置、adoption 唯一成品出口（zip 是过程资产带走，不是第二成品通道）、OCC 草稿、服务端任务恢复、Agent 凭据治理、诚实状态阶梯、软删除——每项绑测试锚，拆票回填用例名。adoption 必须调用 P0 冻结的 Product Core ContentPackage revision port，携带 expected revision、幂等键与 `sourceRef.advancedCanvas`；不得保留独立 ContentPackage 写路径。
16. **商家语言**：bootstrap 补 `workspaceDisplayName`（**既有 launch/bootstrap 上下文 seam 的 additive field，非 BackendPort 领域 seam 字段**；Main Web 已解析完整 workspace 且 DB 有 name，但发往 Canvas 的 body 只带 workspaceId——须同步 Core launch type/launch issue-consume tests/Canvas Zod schema/Main Web producer/session 投影/顶栏 fallback，来源限服务端已授权 workspace，不接受客户端表单覆盖；通常无需 DB migration）。节点类型/状态全中文；提示词种子先解决 A3 状态（现清单 `a3EvidenceStatus:"pending"`）与人话 title/schema，类型不再锁死单一 operation，不把上游 prompt service 一起搬入。
17. **收尾卫生**：`window.prompt/confirm` 全部替换为产品对话框；死件判定用"生产可达"机器口径（从 Canvas app entry 构建 import graph，识别 static/dynamic import 与 re-export，UI 组件另需浏览器旅程可见，不以测试 import 充数）；exact archive / pure utility / production UI 分开计数，production 集进 build/typecheck；manifest CI 校验（sha256 重算 + ports content hash + 引用检查）。
18. **上游共享控件授权判定前置**：五个共享控件真实路径与体量——`components/image-settings-panel.tsx`(246行)、`video-settings-panel.tsx`(323行)、`audio-settings-panel.tsx`(85行)、`model-picker.tsx`(121行)、`prompts/prompt-select-dialog.tsx`(86行)，直接文件 861 行但递归闭包约 18 文件/2092 行（14 个未拷）。K1 先做 A2/A3 授权范围判定（A2 工程 exact-copy policy 窄到 canvas/render/retouch core，A3 不自动放行第三方字体/图标/媒体/prompt corpora）：范围内则补拷入 `copies[]`/`ports[]` 并引 A3；超范围则以同等交互重建该控件层。判定结论写入 manifest 附注，为 K1 产物。
19. **K03 结论修订（精确边界）**：仅撤销 K03 对"上游 parity/内核完成"的 pass 结论与"import 即挂载"充分性判据；K03 已取证的现状行为事实（focusable 节点/graph-backed 文本编辑/Shift 框选/等距多拖/可见 Undo-Redo 已挂载并被 exercised）**保留为回归基线**。K02、K04–K11 的 pass 与证据全部保留；K10/K11 旅程、一级导航"Pro Studio remains outside first-level navigation"、Audio fail-closed 均仍有效。

## Testing Decisions

- 好测试只测外部行为：浏览器可见交互与 BackendPort 合同，不测 vendor 组件内部实现（exact-copy 组件视为可信内核，字节级一致由 manifest CI 保证；ported 文件按功能行为测，不测其内部实现）。
- **Playwright 内核旅程扩展**（先例：既有 `pro-studio-kernel-ui.spec.ts`，498 行）：该 spec 现绑定简版 DOM（`.project-card`/`.canvas-toolbar`/`.kernel-node`）与 `window.prompt` dialog，本规格要退役这些 UI，故任务是**迁移旧旅程 + 扩展**——先锁定保留的业务断言（云端恢复/OCC/报价/adoption/审计），换成稳定 role/test-id，**不得为让旧 selector 继续绿而保留简版 DOM**；再补 拖拽连线/落空白创建/右键复制删除/快捷键全集/文件拖入/节点 resize/大图预览/五类精修各一次真走（fixture 模式）/参数表单改值生效/模型切换/批量堆叠展开设主图/文本流式回填/zip 导出下载。除注册与权益解锁外不直调 Canvas action API。
- **纯函数测试**（先例：既有交互纯函数测试）：裁剪归一化/切分网格/放大尺寸解析/粘贴锚位重定位/快捷键分派/graph-bridge NodeData 双向映射。
- **合同测试**（先例：BackendPort HTTP 合同测试）：`modelId` 入参与 quote 匹配、`defaultModelIdByOperation`/`unavailableReasonCode`、批量（**选 A** 测 batch quote/submit + 逐项 idempotency/退款为 `release`；**选 B** 测 N 个既有 quote/submit + 一个 UI batch 投影）、zip 导出端点与 export manifest、`listPrompts`/`listAssets`/`listAdoptionTargets` 分页、bootstrap `workspaceDisplayName`。
- **批量账本映射测试**：A/B 两案都断言 batch 本身没有 reservation；每个 item 恰有一个 GenerationJob、quote item、idempotency key 与 reservation，total 等于冻结 item 行之和，部分未入队 item 不产生 reservation。
- **来源与权利测试**：Canvas Job/Asset 投影 `advanced_canvas_project_revision` originRef；ZIP 覆盖跨 workspace、已撤权、已过期、不可私下取回、仅导出可用项、manifest warning、retrieval receipt 与全部不可用 fail-closed。
- **Audio/SFX fail-closed 红线**（父规格 K07 硬要求）：无 production activation evidence 时 Audio/SFX operation 与模型不可提交、表单只能以明确"未开放"态展示或隐藏、BackendPort quote/submit 双重拒绝、fixture/recorded 模式不改变商业 readiness；激活后再测参数改值真实进入冻结 quote/submit contract。禁止"可点但必败"的假入口。
- **持久/会话边界测试**：断言 viewport/选区/面板/工具栏偏好不进工程 revision（D9）。
- **无回退断言**：⤴ 8 项各绑定至少一个既有或新增测试锚，重做分支上先跑红线（改坏即红）。
- **死件机器口径**：CI 从 Canvas app entry 构建 import graph（static+dynamic+re-export）判生产可达；production 集进 typecheck/build。
- **并排走查**：上游镜像本地起跑，与产品同场景截图对照，归档入 evidence；此为人工验收动作，不入 CI。

## Out of Scope

- **Agent 对话式外壳**（D-099③ 独立票）：上游助手面板/聊天 UI/面板动效/assistant 组合根的挂载、流式输出对齐 ADR-0007、会话管理——独立成线，依赖本规格的内核挂载完成。（注：本规格 US35 的文本节点流式回填是 `text.respond` 结果写回，**不属于** Agent 对话流，在本规格内。）
- Composer `CreationSubmissionCoordinator`、营销 `CreationExecutionSnapshot` 与五阶段 Harness 的实现；Pro Studio 只消费共享领域端口，不进入主线编排器。
- 本机 Agent 桥（ADR-0012 ⛔ 禁拷，维持）。
- 商业发售门（继承父/祖规格，**包括但不限于**，任何遗漏不构成关闭）：N2 生产恢复、安全生产矩阵演练与人工批准、定价、升单真实验证、Audio/SFX 商业激活。
- 上游后端/业务 runtime 的任何复制。
- Polotno 冻结/退役主线（另有主线闸）。
- 上游积分体系、独立登录、管理员台（已由我方等价机制替代）。
- 画布内独立主题真相：深浅主题继续由 bootstrap/system 决定，US18 的"画布外观"仅指已批准的网格点/线/空白与图片信息等画布显示项，不照搬上游主题面板。

## 跨包属主与合并序

`apps/canvas/**`、`apps/core/src/pro-studio/**` 不在两个在途 pack 的冻结清单，Canvas UI/BackendPort 可独立开发；但以下后端落点有属主/冻结碰撞，K1 须先协调，不得盲改：

- **P0 主线编排**（#137/#139/#140）：`CreationExecutionSnapshot` 与营销 Harness 不接管 Canvas GenerationJob，故不是 K2–K7 功能前置；K1 只需冻结共享 quote/route/provider/ledger/storage/capability/audit 引用，禁止改 Composer Coordinator 来迁就 Canvas。
- **ContentPackage revision port**（P0 #141）：Product Core 是唯一写属主。Pro Studio adoption 在 #141 合入后切到该 port；过渡期旧 adapter 只能兼容调用，不能扩成第二套写合同。
- **OwnedAsset / 对象存储**（P0 #142）：S3-compatible adapter、receipt、hash、跨进程读取与孤儿清理由 #142 拥有。K3/K6 只消费稳定 Storage Port；若 #142 未冻结，涉及生产对象存储和 ZIP 收集的实现不得宣称完成。
- **运行构建与发布门**（P0 #143）：Canvas 保持独立 production build 和预算，但同一 release manifest 必须绑定 P0 readiness/commit 真相。P0 关闭不等待 G01–G48 parity；任何包含本重做的发布必须额外通过 K7。
- **模态/主题语义**（P0 #145）：共享的是 focus、Portal 主题、单一 aria-modal、焦点返回等行为合同，不要求 Canvas 与主 Web 使用同一组件库；Canvas 由 Ant ConfigProvider/SSR root 满足。
- **文案流式**（P1 #151）：复用 SSE envelope/sequence/reconnect 语义，不复用 Result 的 ContentPackage terminal projection；Canvas terminal truth 仍是 text node + project revision。
- **Assets 治理**（P1 #155）：P1 拥有 OwnedAsset 搜索、权利、来源与 export eligibility 公共投影。K5 的 `listAssets` 是消费者，不建第二索引或第二权利判断；P1 未合入前的临时 adapter 必须满足同一 DTO 合同。

- **model-supply**（`p1/model-supply/foundation-module.ts`、supply-contracts）：模型选择/catalog reason/count-quote 若改此处，撞 admin pack WT-G 独占供应 hunk，并须避开 UI pack #102 对 model-supply 视频段的改造顺序 → 待 WT-G/#102 合并后或由其 owner 执行。
- **result-delivery**（`p1/result-delivery/**`）：复用 ZIP 若直接改此处撞 UI pack WT-B 独占 → 由 WT-B 暴露稳定 deterministic-zip 公共口，Canvas 只消费。
- **`apps/core/src/main.ts`**：并行期冻结，新增 Core wiring 只交接线 diff 给整合属主。
- **E2E**：`pro-studio-kernel-ui.spec.ts` 未逐名冻结，但 UI pack 将 e2e 断言文件整体归 WT-0 → 改前确认 WT-0 范围，让渡或代改。

## Further Notes

- 开发票包：K1 [#163](https://github.com/legacy-origin-a/legacy-web-repo/issues/163) → K2 [#164](https://github.com/legacy-origin-a/legacy-web-repo/issues/164)；K3 [#165](https://github.com/legacy-origin-a/legacy-web-repo/issues/165)、K4 [#166](https://github.com/legacy-origin-a/legacy-web-repo/issues/166)、K5 [#167](https://github.com/legacy-origin-a/legacy-web-repo/issues/167) 在 K1/K2 后按功能面实施；K6 [#168](https://github.com/legacy-origin-a/legacy-web-repo/issues/168) 收口工程/adoption/导出；K7 [#169](https://github.com/legacy-origin-a/legacy-web-repo/issues/169) 统一验收。GitHub 原生 `Blocked by` 为执行权威。
- 差距行级依据、G01–G48 行级核销索引与 vendor 挂载状态清单见验收基线文档；本规格不重复行级表。
- 当前 G01–G48 代码事实基线钉死于产品仓库 commit `4625e4238748196a7fcb12226cb11e2c0420083b`；若 K1 开工前 P0/P1 或其他分支改动 `apps/canvas/**`、`apps/core/src/pro-studio/**`、共享 model-supply/result-delivery 接缝，必须重跑基线并记录差异，不能沿用过期“当前状态”。
- 量级如实口径：真实 port 闭包约 86 文件/1.9 万行，是祖规格"约 23–36 人周"中被 K03 简版化绕过的主体工作量。K1–K7 是编号/收口顺序；实际依赖 DAG 为：**K1 底座 → K2 组合根/交互 → K3 精修、K4 生成 UX、K5 资源、K6 工程管理/导出按功能面并行 → K7 对标验收（含 D19 继承门）**。其中 K3/K6 另等 P0 #142，K6 另等 P0 #141，K7 另等 P0 #143；K1 不冻结，K2–K7 不开工。
- 教训沉淀（与 07-13 UIUX 复盘同族）：凡"迁移/对标"类票，验收必须含与参照物的并排走查条款，"接缝真+旅程可走通"不构成对标完成；且规格不得把"已有底层积木"写成"已有可直接复用的完整合同"。

## 复核处置（rev0 → rev1 → rev2）

三路 Codex 对抗复核（报告在 `.scratch/pro-studio-parity-spec-review-2026-07-22/`）：lane1 决策保真 1 P0/6 P1/3 P2，lane2 代码现实 3 P0/14 P1/2 P2，lane3 确认复核 0 P0/4 P1/1 P2。去重合并后**全部采纳**（无驳回——findings 或代码实证或决策实证）。

**rev1 落点（lane1+lane2）**：

| 复核发现（合并） | 采纳落点 |
| --- | --- |
| P0 "33 全挂载"泄漏 Agent 外壳 + 与"零死件"不可同时成立（l1F01/l2·2） | Solution 挂载集排除 Agent；D2 生产白名单；D17 死件机器口径 |
| P0 `ported-derived` 冲垮 exact-copy manifest 制（l1F04/l2·1） | D1 双轨 manifest（copies/ports 分离）+ 升级脚本/gate/测试 |
| P0 批量账本合同不存在（l2·3） | D4 批量账本合同拍板（A 聚合/B fan-out）+ D3 BackendPort vNext |
| P1 无稳定行级核销集/计数不符（l1F02/l2·18） | 基线加 G01–G48 索引 + 修正汇总（见基线文档） |
| P1 文本流式回填掉行（l1F03） | US35 + D13 |
| P1 持久化垫片写 UI 态进 revision（l1F05） | D9 拆持久/会话两类 + 边界测试 |
| P1 发售门漏安全演练（l1F06） | Out of Scope "包括但不限于" + 安全生产矩阵人工批准 |
| P1 Audio fail-closed 无可执行验收（l1F07） | Testing Audio/SFX 红线 |
| P1 后端 schema 过满/模型选择合同不全/workspace 多点/copy 面 86 文件/宿主 runtime/组合根不可直挂/适配器≠覆盖/精修派生/D-096 未公共/prompt-asset-package 缺合同/跨包碰撞/E2E 近重写/死件扫描（l2·4-17） | D3.5 参数矩阵、D10 模型端到端、D16 workspace 多点、D8 port 闭包、D5 宿主 runtime、D6 composition root、D7 适配器补 ports、D12 精修、D14 zip 公共接缝、D3 list 合同、跨包属主节、Testing E2E 迁移、D17 死件机器口径 |
| P2 US18 主题边界/Problem 过满/K03 措辞/计数口径（l1F08-F10/l2·18-19） | Out of Scope 主题条、Problem Statement 修正、D19 精确边界、前言横幅计数澄清 |

**rev2 落点（lane3 确认复核）**：

| 确认发现 | 采纳落点 |
| --- | --- |
| P1 A01 rev0 处置未贯穿权威链（D-099 仍写"33/17-21"、基线附录 zip 标"待拍板"） | D-099 已改写为 G01–G48/白名单/ports 口径；基线附录 `canvas-export` 改判必修 |
| P1 B01 D4 的 A/B 被 D3/Testing 无条件锁成 A | D4 冻结 A 不变量 + B 合同；D3/Testing 批量断言随 A/B 条件化 |
| P1 B02 D3 名"冻结"实为开放清单 + 混两 seam | D3 改为 K1 交付封闭矩阵（含 D10 字段）；D3.5 参数四类归类；workspaceDisplayName 分列为 launch/bootstrap seam field（D16） |
| P1 B03 `ports[]` 无 A2/A3 派生审计门 | D1 固定 port 行 schema + A2/A3 derivative addendum + ported-root 双向 conformance |
| P2 A02 D19 在 D1–D18 声明外悬空 | Implementation Decisions 抬头声明 D19 为继承门/验收边界 |

lane3 PASS C 回归扫描确认：adoption 仍唯一成品出口、zip 独立 manifest、BackendPort 仍唯一领域 seam、Pro Studio 不进一级导航、Audio fail-closed、本机 Agent 桥禁拷——均无回归；K1 前置未把任何 G-index/US/浏览器旅程从验收删除。
