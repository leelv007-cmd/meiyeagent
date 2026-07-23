# K7 最终验收（#169 PRO-K7）证据（2026-07-23）

状态：`local candidate / external gates blocked`。收口分支
`canvas-k3-residual`（基线 `fe05a493` + 7 个 K7 commit）。本记录汇总 Issue #169
（PRO-K7 最终验收）的 parity 层收口证据；**未 push、未改远端 Issue 或发布状态**；
`MODEL_EXECUTION_MODE=fixture`。本地单测/构建/bundle/隔离库 e2e 不能替代真实
provider、生产 security drill、受保护发布环境或人工审批的通过证据（发布门归
#119/#146/#147，见 §4 诚实登记）。

## 一、收口分支拓扑（fe05a493 之上 7 commit）

| commit | 来源 | 内容 |
| --- | --- | --- |
| `9e9e4b69` | main（真机 e2e 揭示） | fix(canvas)：capability 映射补 `estimatedDurationSeconds` 透传（+UI 防御 +回归单测） |
| `24e799ab` | K7 WS-A | manifest 收敛：删 2 幽灵条目 + 重分类，productionInventory 归 40 |
| `b74a151a` | K7 WS-C | K2 高阶画布 parity 证据（G01–G25，干净库 e2e 1 passed） |
| `a7e29f5b` | K7 WS-C | cross-service K6 连带 stale 选择器修（3 处） |
| `bd0262e2` | K7 WS-C | security:789 补修 + 完整 impact scan（2 spec/4 处收口） |
| `72ec5701` | K7 WS-C | 决策落盘 + 遗留段两类分离（test-rework vs #119 供给） |
| `60cb9f8f` | K7 WS-B | kernel-ui e2e spec 迁移到 rework 后画布（1 passed） |

四票（K3–K6）功能与证据此前已在 `fe05a493`（PR #191 收口分支）。

## 二、G01–G48 核销矩阵（从 #169 全 B0 升级为真证据）

**背景**：`issue-169-final-local-qa-2026-07-23.md` 时 G01–G48 **全部 B0**——
`pro-studio-k2-canvas.spec.ts` 的 webServer 在共享脏库 PG migration 阶段以 `42P07`
（`payment_webhook_settlement_outbox already exists`，App Shell Drizzle 表 journal 漂移，
非 pro-studio）退出，浏览器根本没起。本轮用**干净隔离库**（K2/kernel-ui 各自
`meiye_k7ev*`/`meiye_k7ui`）跑绿，把矩阵从"代码+单测候选"升级为**真浏览器证据 +
单测锚 + 诚实分层缺口**。

证据类型：`✅e2e`=真浏览器硬断言直证；`✅单测锚`=@meiye/canvas 单测证（277 pass），
e2e 未逐项断言；`⚠️#119`=需 image.edit/text.respond/audio/ratio 供给激活（平台默认只
seed 4 个 `.generate/.speech` operation，诚实降级非缺陷，#162 豁免对象）；`⚠️挂载B0`=
vozeb-native mount-contract 保证挂载、无逐控件行为 e2e；`➖defer`=归 A1 独立票。

| G | 区 | 能力 | 票 | 证据 | 来源 |
|---|---|---|---|---|---|
| G01 | 1 | 五类节点/Config/默认尺寸 | K2 | ✅e2e | k2-canvas 五类落位计数=5 + kernel-ui 补强 |
| G02 | 1 | 富节点四态/重试/中文 | K2 | ✅单测锚 | node-media + node-info 中文状态 |
| G03 | 1 | 文本字号/mention/生图 | K2 | ✅单测锚 | surface 字号 + resource-workflow mention |
| G04 | 1 | 图片双击大图 | K2 | ✅单测锚 | surface owned-image preview |
| G05 | 1 | batch stack/展开/设主图 | K4 | ✅e2e | K4 test1 展开2卡+设为主图+刷新水合 |
| G06 | 1 | 四角resize/比例锁/freeResize | K2 | ✅e2e | k2-canvas 四角拖动宽度增大 + surface clamp |
| G07 | 1 | 左右连接手柄 | K2 | ✅e2e | k2-canvas 右→左手柄拖连 1 边 + surface 归一化 |
| G08 | 1 | 选中/关联/连接目标高亮 | K2 | ✅e2e | k2-canvas 拖线目标 pointer-events-auto 高亮 |
| G09 | 1 | 图片信息条/资源角标 | K2 | ✅单测锚 | node-info 商家字段脱敏 |
| G10 | 2 | Ctrl框选/Shift追加 | K2 | ✅e2e | k2-canvas Control marquee 选 2 节点 + Shift 追加 |
| G11 | 2 | 多选toggle/⌘A全选 | K2 | ✅e2e+单测锚 | k2-canvas toggle/Esc；⌘A 归 surface 快捷键集 |
| G12 | 2 | 拖线/落空白五类创建 | K2 | ✅e2e | k2-canvas 落空白 create-menu 选音频 6 节点 |
| G13 | 2 | 连线选中/右键/删除 | K2 | ✅e2e+单测锚 | k2-canvas Delete 删关联边；右键单测 |
| G14 | 2 | 节点右键复制/删除 | K2 | ✅e2e+单测锚 | k2-canvas Delete 8→6；右键复制单测 |
| G15 | 2 | 小地图 | K2 | ⚠️挂载B0 | vozeb-native mount-contract（行为e2e缺口） |
| G16 | 2 | 小地图控件 | K2 | ⚠️挂载B0 | vozeb zoom-controls（逐控件e2e缺口） |
| G17 | 2 | 完整快捷键 | K2 | ✅e2e | k2-canvas Esc/⌘C⌘V/Delete/⌘Z 全链 + kernel-ui undo/redo 补强 |
| G18 | 2 | 复制带连线/重定位 | K2 | ✅e2e | k2-canvas ⌘C⌘V 8节点3内部边 |
| G19 | 2 | 文件拖入/剪贴板 | K2 | ✅单测锚 | surface clipboard payload routing |
| G20 | 2 | 网格切换 | K2 | ✅单测锚 | shell-coordinator 栅格 + vozeb 背景切换挂载 |
| G21 | 3 | 顶栏菜单/内联重命名 | K2 | ✅单测锚 | project-persistence renameProject 契约 |
| G22 | 3 | dock五类/素材/外观/删除/清空 | K2 | ✅e2e | k2-canvas 五类建节点 + node-adapter |
| G23 | 3 | hover工具条 | K2 | ✅单测锚 | mount-contract ported/hover-toolbar |
| G24 | 3 | 节点信息弹窗/脱敏 | K2 | ✅单测锚 | node-info desensitizeNodeJson |
| G25 | 3 | 图片工具栏自定义 | K2 | ✅单测锚 | ported/image-quick-tools 5 例 |
| G26 | 4 | 交互式裁剪 | K3 | ✅e2e | K3 test1 8手柄+实时像素+比例锁→派生子节点 |
| G27 | 4 | 局部蒙版重绘 | K3 | ⚠️#119(image.edit) | retouch-generation 单测 + test2 MaskDialog 挂载+诚实降级 |
| G28 | 4 | 1K/2K/4K放大 | K3 | ✅e2e | K3 test1 选4K→派生子节点 |
| G29 | 4 | 网格切分 | K3 | ✅e2e | K3 test1 2×2网格→4子节点 |
| G30 | 4 | AI多角度 | K3 | ⚠️#119(image.edit) | retouch-generation 单测 + test2 AngleDialog 挂载 |
| G31 | 4 | 反推提示词 | K3 | ⚠️#119(text.respond) | retouch-generation 单测 + test2 入口可达 |
| G32 | 5 | 节点内联生成面板 | K4 | ✅e2e | K4 test1 节点生成→workbench 可见 |
| G33 | 5 | Config节点生成面板 | K4 | ✅e2e | K4 test1 编辑/生成图片动作+模型+设置+数量 |
| G34 | 5 | mention Composer/只注入引用 | K4+K5 | ✅e2e | K4 test1 composer 输入 e2e（提及键盘导航分层）+ kernel-ui @mention 血缘边成形 |
| G35 | 5 | 图片/视频/音频设置+自定义比例 | K4 | ✅e2e+⚠️#119 | K4 test1 自定义 w/h 进冻结报价；ratio 型模型未seed分层 |
| G36 | 5 | count并发/batch/部分失败 | K4 | ✅e2e | K4 test1 数量2→报价2项→提交2/2；batch-orchestrator 部分失败单测 |
| G37 | 5 | 失败重试复用参数 | K4 | ⚠️#119(recorded失败供给) | contract 冻结输入单测；工作台不轮询到failed |
| G38 | 5 | 文本流式回填 | K4 | ⚠️#119(text.respond) | canvas-text-stream SSE 单测；test2 诚实标未激活 |
| G39 | 6 | 提示词库分类搜索/人话标题 | K5 | ✅e2e | 库加载无503（修 wire prompts provider bug）+安全呈现 |
| G40 | 6 | 资源@mention | K5 | ✅e2e | composer 候选/chip/删除 + kernel-ui 血缘边成形 |
| G41 | 6 | 素材三tab/搜索/分页/音视频上传 | K5 | ✅e2e | asset picker + resource workflow |
| G42 | 7 | Agent对话助手外壳 | A1 | ➖defer | 独立票（D-099③）；forbidden-surface 单测防引入 local-agent 桥 |
| G43 | 8 | 工程卡信息/重命名/单项导出 | K6 | ✅e2e | 真下载 + manifest 交叉核对 + kernel-ui E4 采用 |
| G44 | 8 | 产品化删除确认 | K6 | ✅e2e | DeleteProjectsDialog + selection/delete 契约 |
| G45 | 9 | workspaceId/英文/seed id 泄漏 | 多票 | ✅e2e/单测 | project journey/node info/workbench 均查商家安全标签 |
| G46 | 9 | 加载骨架 | K6 | ✅e2e | K6 e2e aria-busy 加载态断言 + canvas-shell load state |
| G47 | — | 用户侧模型选择（D-099①） | K4 | ✅e2e | K4 test2 诚实门控 + 脱敏原因（无 provider/uuid 泄漏） |
| G48 | — | zip数据导出（D-099②） | K6 | ✅e2e | 真下载 + fflate 解压 + manifest 交叉核对 + P0 NUL 锁修复 |

**核销分布（48 行）**：达标（e2e直证/单测锚）**39** + 分层 #119 豁免 **6**（G27/G30/G31/G35-ratio/G37/G38）+ 挂载 B0 **2**（G15/G16）+ defer **1**（G42）。

## 三、机械门坐实（收口分支 canvas-k3-residual，2026-07-23）

| 门 | 结果 |
| --- | --- |
| `pnpm --filter @meiye/canvas test` | **277 pass / 0 fail / 1 skip，EXIT=0**（含 estimatedDurationSeconds 映射回归断言） |
| `typecheck` + `check`（biome + 两类 TS） | **EXIT=0** |
| `build` + `verify:bundle`（450 KiB gzip 门） | **Canvas bundle budget passed，EXIT=0** |
| Main Web `build` + `uiux:bundle-check`（350 KiB gzip 门） | **passed，JS gzip 329,168 B / CSS gzip 42,988 B，EXIT=0**（与 issue-169 旧值一致 → canvas 依赖未渗入 Main Web 初始包，架构隔离坐实） |
| `conformance-gate.test.mjs` | **EXIT=0** |
| `pro-studio:conformance` | EXIT=1，**本地源码/分类/build 门全过**（WS-A 修幽灵 + canvas build 后 manifest 消除），只剩外部销售/发布门（见 §4） |

## 四、发布门 BLOCKED 诚实登记（conformance 剩余 9 项 → 外部）

`pro-studio:conformance` 的非零退出**仅保留需真实/受保护环境的外部门**，本工作树无法解，
**不伪造为通过**：

| conformance 门 | 归属 |
| --- | --- |
| `PRO_STUDIO_UPSTREAM_ROOT` pinned checkout | 上游并排走查环境（见 §6） |
| `production_security_drill` / `manual_security_approval` | #146/#147 生产安全 drill + 人工审批 |
| `securityMatrix: status must be passed` | #146/#147 |
| `n2Recovery: status must be passed` | #119 N2 恢复 |
| `audioSpeechActivation` / `audioSfxActivation` | #119 audio 激活（非平台默认，`generation-runtime.test.ts:303` 实锤 inactive） |
| `pricingApproval` / `upsellValidation` | #146/#147 定价 + upsell 验证 |

`release-evidence.json` 保持 security=partial / audio=blocked / pricing=null，**未修改以伪造通过**。

## 五、两类遗留（Phase 2 发布结论须区分，来自 72ec5701）

- **类 A 旧 spec 绑定契约 stale test（非 #119，test-rework 待办）**：cross-service
  `image.generate`（:189）+ security `reject foreign workspace`（:360）同签名
  `GENERATION_INPUT_BINDING_INVALID`。旧 spec 用 prompt-only GenerationInput，未对齐收紧后
  `freezeGenerationLineage`（backend-port.ts:1422 要求真实冻结 nodeId/itemId）。**决策
  （team lead）：本轮不修，登记 K7 遗留**——补齐要给生成腿绑冻结节点、级联 audio 腿 +
  audio.sfx（落入类 B #119），完整绿仍 BLOCKED；且非 parity 核销主线（四票新 spec 已对齐
  收紧契约并跑绿，cross-service/security 属 K2 时代旧 spec 双 stale，与 kernel-ui 同族漂移，
  kernel-ui 已 fix-forward 完成）。
- **类 B #119 深层供给 BLOCKED**：copy 额度（security CAS :621）/ 身份 provisioning
  （security identity :774）/ audio.sfx（cross-service :208）。发布门归 #119。

**K6 连带 stale 选择器**（2 spec/4 处：cross-service 167/169/261 + security:789）**已修并
证实隔离**（K6 给 project-card 加带名按钮致 `getByRole('button',{name:project.name})`
substring 多命中）。

## 六、上游 `a2c52c7` 并排走查处置

DoD 第 1 条要求"与上游 `a2c52c7` 本地起跑的并排截图走查"。上游 `csyqlz/vozeb@a2c52c7` 是
**完整独立 app**（依赖/runtime/后端自成一套），在本收口工作树起跑运行时不现实。处置：
- **parity 依据**：以 `upstream-parity-gap-baseline-2026-07-22.md` 的**双路源码级对标**
  （上游 canvas 46 文件逐文件枚举 vs 当前挂载链源码枚举）为 G01–G48 核销的权威依据，本文件
  §2 矩阵逐行落地。
- **运行时截图走查**：诚实登记为**需人工/独立环境**（conformance 的 `PRO_STUDIO_UPSTREAM_ROOT`
  pinned checkout 门即对应此项），不伪造运行证据。

## 七、发布结论

**parity 层收口完成**：G01–G48 逐行核销——39 项 e2e 直证/单测锚达标、6 项分层 #119 豁免
（#162 形式化登记，逻辑层单测证 + UI 层挂载可达 + 诚实标未激活）、2 项 vozeb-native 挂载
B0、1 项 defer（A1 独立票）。五道机械门全绿（canvas/Main Web 单测·typecheck·两 bundle 预算）
+ conformance 本地源码/分类/build 门全过、外部销售门 BLOCKED（§4）。收口过程真机 e2e 揭示并
根治 3 个潜伏产品 bug（K5 prompts provider 503 /
K6 export NUL 锁 / capability 映射漏 estimatedDurationSeconds），均非造假绿可及。

**发布门 BLOCKED（诚实登记，本工作树不可解）**：生产 security drill + 人工审批 + securityMatrix
+ pricing/upsell（#146/#147）、N2 恢复 + audio 激活（#119）、上游运行时并排走查（需人工环境）。
另有类 A 旧 spec 绑定契约 stale test（cross-service/security，非 #119，test-rework 待办）。

**总判定**：#169 的 parity 收口目标在本工作树达成并有真机证据支撑；发布级门禁受阻于外部/
受保护环境，按诚实纪律登记 BLOCKED，不升格 fixture/本地证据为发布通过。
