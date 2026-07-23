# K2 高阶画布对标（G01–G25）验证证据（2026-07-23）

状态：`local candidate / real-stack verified`。代码基线 `k7-evidence@fe05a493`（打包
K3–K6 parity 收口）。本记录补齐 Issue #164（PRO-K2）在 #169 统一 QA 时**被 PG migration
崩溃阻塞、始终缺一次跑绿浏览器证据**的残差；未 push、未改远端 Issue 状态；
`MODEL_EXECUTION_MODE=fixture`。真实 live 发布证据仍归 #119 / #146。

## 背景：#169 时 K2 是唯一无独立 parity 证据的票

K3–K6 各已落一份 `*-parity-evidence-2026-07-23.md`，唯 K2 缺。#169 最终本地 QA
（`docs/evidence/pro-studio/issue-169-final-local-qa-2026-07-23.md:18-20,44`）实锤：
`pro-studio-k2-canvas.spec.ts` 的 Playwright `webServer` 在 PostgreSQL migration 阶段以
SQLSTATE `42P07` `DrizzleQueryError`（`relation payment_webhook_settlement_outbox already
exists`）退出 1，`Process from config.webServer was not able to start`——**浏览器根本没起**，
G01–G25 在 #169 全部只有 `C`（code）/`C+U`（code+unit）级别，无浏览器确认。

功能不是问题：K2 的五类节点 / 四角 resize / 连接手柄 / 框选 / 复制带连线 / 删除撤销 /
保存恢复在基线上**已落地并接线**（`kernel-canvas-surface.tsx` + vozeb `VozebCanvas` +
`k2-canvas-toolbar.tsx` + `project-persistence.ts`），单测扎实（`kernel-canvas-surface.test.ts`
17 例「K2 ...」直证）。真实残差 = **缺一次干净跑绿的浏览器证据** + K2 独立 parity 证据文件。
本轮用干净隔离库跑绿并补齐本文件。

## 根因：#169 的 42P07 来自共享脏库 Drizzle journal 漂移，非 K2、非 pro-studio schema

- **现象**：`webServer` 起 Core 前先跑 `provision-test-db.sh` → `pnpm db:migrate:local`
  （App Shell Drizzle）在共享默认库 `meiye` 上执行，撞
  `relation payment_webhook_settlement_outbox already exists`（`42P07`）而退出 1。
- **真凶**：`payment_webhook_settlement_outbox` 是 **App Shell（Drizzle）表，不是 Pro Studio
  表**。共享 `meiye` 库被前序其它分支 / 其它票的 e2e 反复复用，`__drizzle_migrations`
  journal 与实际表结构**漂移**（表已存在但 journal 记录缺失/被重置）→ Drizzle 对已存在表重发
  `CREATE TABLE` → `42P07`。这是典型"共享脏库 + journal 漂移"，与 K2 画布代码零关系。
- **排除 pro-studio schema 为元凶**：provision 第二段 `apply-pro-studio-schema.mts`
  → `migrateProStudioSchema` / `migrateProStudioWorkspaceState` **全部 `CREATE TABLE/INDEX
  IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`**（`apps/core/src/pro-studio/postgres-pro-studio-migration.ts`
  逐行核实幂等），且 `apply-pro-studio-schema.mts` 建 workspaces 亦用 `IF NOT EXISTS`。
  Pro Studio 段对已 provision 的库重跑不崩——**42P07 不可能来自这里**。
- **修复（无需改脚本）**：用**干净隔离库**（本票 `meiye_k7ev` / `meiye_k7ev2`，跑前不存在）。
  provision 在全新库上首次建表 + 首次写 journal，二者一致 → 无漂移 → 无 42P07。这正是 #169
  文档 `:119` 自开的药方（"由测试夹具提供干净、隔离的测试数据库"）。`provision-test-db.sh`
  本身**无缺陷、未改动**（surgical：不修不坏的东西）；DBOS 系统库由 `playwright.config.ts:21-28`
  自动派生唯一名（`<base>_playwright_<corePort>_<pid>`），天然隔离。

## G01–G25 证据矩阵

`✅ e2e` = 本轮 `pro-studio-k2-canvas.spec.ts` 干净库跑绿逐项硬断言；`✅ 单测锚` =
逻辑由 `@meiye/canvas` 单测证（277 pass），本 e2e 未逐项断言；`⚠️ 挂载保证` = vozeb-native
组件经 mount-contract 保证挂载但无逐行为断言（诚实 e2e 缺口）；`➖ 排除` = 非本票域。
行号指 `apps/canvas/src/kernel-host/kernel-canvas-surface.test.ts`（缩写 `surface:N`）与
`tests/e2e/specs/pro-studio-k2-canvas.spec.ts`（缩写 `spec:N`）。

| G | 能力 | e2e（pro-studio-k2-canvas 硬断言） | 单测锚点 | 结果 |
|---|---|---|---|---|
| G01 | 五类节点/Config/类型默认尺寸 | 工具栏点文本/图片/视频/音频/生成配置逐个落位，`.kernel-node` 计数=5（spec:108-143） | surface:87「mounts approved rich node for all five node types」；kernel-node-adapter「maps all five kernel node types to approved defaults」 | ✅ e2e |
| G02 | 富节点卡四态/失败重试/中文状态 | —（本 e2e 未逐态断言） | kernel-node-media（image/video/audio 鉴权服务端投递）；kernel-node-info「status and type labels stay Chinese」 | ✅ 单测锚 |
| G03 | 文本字号/mention 编辑/生图 | — | surface:484「text node editing writes value back」；surface:609「adjustTextFontSize clamps」；resource-workflow.test（@mention 键盘/chips） | ✅ 单测锚 |
| G04 | 图片双击大图 | — | surface:121「K2 opens previews only for owned image assets」 | ✅ 单测锚 |
| G06 | 四角 resize/比例锁/freeResize | 选中图片节点→四角 `.cursor-nwse-resize` mousedown+move→宽度实测增大（spec:151-177） | surface:306「resize clamps four-corner geometry and preserves media aspect ratio」；surface:641「toggleNodeFreeResize only flips image nodes」 | ✅ e2e |
| G07 | 左右连接手柄 | 文本右 `.cursor-crosshair` 拖到图片左手柄→1 条 `[data-connection-id]`（spec:214-249） | surface:327「normalizes connections from the visually left node to the right node」 | ✅ e2e |
| G08 | 选中环/关联环/连接目标高亮 | 拖线中目标手柄 `toHaveClass(/pointer-events-auto/)` 高亮（spec:226,267） | surface:667「hover chrome desensitized info projection stays merchant-safe」 | ✅ e2e（连接目标高亮） |
| G09 | 图片尺寸体积信息条/资源引用角标 | — | kernel-node-info「buildDesensitizedNodeInfo exposes merchant fields without raw ids」「text nodes omit image-only ratio row」 | ✅ 单测锚 |
| G10 | Ctrl/Cmd 框选/Shift 追加 | Control+drag marquee `[data-selection-marquee]` 可见→选中 text+video 2 节点（spec:193-212）；Shift-click 追加（spec:179-181） | surface:561「Command marquee selects intersecting nodes in world coordinates」；surface:207「modifier pointerdown preserves selection」 | ✅ e2e |
| G11 | 多选 toggle/Ctrl+A 全选 | Shift-click text+image→`.is-selected` 计数=2→Escape→计数=0（spec:179-183） | surface:207「modifier pointerdown preserves selection and prepares drag group」；Ctrl+A 归 surface:277 完整快捷键集 | ✅ e2e（toggle/Esc）；⌘A 单测锚 |
| G12 | 拖线连节点/落空白五类创建 | 拖线 text→image（1 连线）；图片落空白→`[data-connection-create-menu]`→选「音频」→6 节点/2 连线（spec:251-276） | surface:360「appends one normalized connection and rejects duplicates」；surface:145「routes internal, file, and plain-text clipboard payloads safely」 | ✅ e2e |
| G13 | 连线选中/右键/删除 | Delete 移除选中节点及**关联边**（spec:284-285 隐含 incident edge） | surface:447「deletion removes selected nodes, incident edges, or one connection」 | ✅ e2e（删关联边）；连线右键单测锚 |
| G14 | 节点右键复制/删除 | Delete 删 2 节点→计数 8→6（spec:284-285）；复制见 G18 | surface:447「deletion removes selected nodes...」 | ✅ e2e（删除）；右键复制单测锚 |
| G15 | 小地图 | —（vozeb-native，`canvas-mini-map.tsx`） | mount-contract「imports the authorized VozebCanvas」（挂载级保证）；无逐行为单测 | ⚠️ 挂载保证，行为 e2e 缺口 |
| G16 | 小地图开关/重置/缩放滑块/帮助 | — | vozeb `canvas-zoom-controls.tsx`；无逐控件测试（#169:70 亦标 B0「未逐控件浏览器确认」） | ⚠️ 挂载保证，行为 e2e 缺口 |
| G17 | 完整快捷键（Delete/⌘C/⌘V/⌘A/Esc） | Esc 清选（spec:182）、⌘C+⌘V→8 节点（spec:280-282）、Delete→6（spec:284）、⌘Z 撤销→8/3 连线（spec:286-288） | surface:277「routes the complete canvas shortcut set without hijacking plain keys」；surface:225「session history supports undo, redo, and branch replacement」 | ✅ e2e |
| G18 | 复制带连线/中心锚位重定位 | ⌘C+⌘V 复制 text+image→8 节点 **3 连线**（内部边随复制）（spec:278-288） | surface:387「copy keeps internal edges and relocates the group around the canvas anchor」；surface:188「dragging a selected node moves the whole selected group」 | ✅ e2e |
| G19 | 文件拖入/剪贴板图文粘贴 | — | surface:145「K2 routes internal, file, and plain-text clipboard payloads safely」 | ✅ 单测锚 |
| G20 | 点/线/空白网格切换 | — | canvas-shell-coordinator「new kernel nodes use a non-overlapping grid」（节点落位栅格）；背景网格三态切换 vozeb `k2-canvas-toolbar` | ✅ 单测锚（节点栅格）；背景切换挂载级 |
| G21 | 顶栏菜单/内联重命名 | — | project-persistence:100/113「renameProject」+ backend-port renameProject 路由契约；内联重命名 UI vozeb `use-canvas-store` | ✅ 单测锚（后端契约）；内联 UI 挂载级 |
| G22 | dock 工具栏五类节点/素材/外观/删除/清空 | 工具栏五类节点按钮各建 1 节点（spec:116-119，累计 5） | kernel-node-adapter「creates every toolbar node at approved size without provider state」 | ✅ e2e（五类建节点）；素材/外观/清空单测+挂载级 |
| G23 | hover 工具条 | — | mount-contract「G23–G25 residual: hover chrome host-ported」（断言 `ported/kernel-node-hover-toolbar` + onHoverStart/End）；surface:667「hover chrome desensitized info」 | ✅ 单测锚 |
| G24 | 节点信息弹窗 | — | kernel-node-info「buildDesensitizedNodeInfo exposes merchant fields」「desensitizeNodeJson redacts delivery urls, base64, and sensitive keys」 | ✅ 单测锚 |
| G25 | 图片工具栏自定义 | — | ported/image-quick-tools（5 例：normalize 保序去未知/legacy+object 形/空选回退默认/localStorage round-trip/default catalog 全集） | ✅ 单测锚 |
| G05 | batch stack/展开收起/设主图 | —（**排除**：属节点生成批量堆叠域） | node-generation-contract.test.ts:368（**K4/#166 域**，快照保留冻结输入 + 主图/重试/取消/刷新） | ➖ 排除（归 K4） |
| — | 持久化：save→reload→restore | 保存→`.status-dot` 现 `草稿 vN 已保存`→reload→openProject→8 节点/3 连线/节点 id 集 `toEqual` 恢复（spec:290-311） | project-persistence（loadProject/saveDraft/createCheckpoint/restoreRevision + DRAFT_VERSION_CONFLICT 映射）；graph-bridge round-trip 保域字段 | ✅ e2e |

**e2e 直证覆盖（13 项行为）**：G01/G06/G07/G08/G10/G11/G12/G13/G14/G17/G18/G22 + 持久化。
**单测锚（10 项，逻辑证但非本 e2e 逐断言）**：G02/G03/G04/G09/G19/G20/G21/G23/G24/G25。
**挂载保证、行为 e2e 缺口（2 项，诚实）**：G15 小地图、G16 小地图开关/缩放滑块/帮助。
**排除（1 项）**：G05（节点生成批量域，归 K4/#166）。

## K2 e2e 单测试硬断言链（`creates, arranges, connects, edits, and restores the K2 graph`）

一条端到端旅程，全程用**硬事实**（节点/连线计数、`.is-selected` 计数、`pointer-events-auto`
高亮、`data-connection-id` 计数、node id 集），不断会被 auto-save 覆盖的 status 文本：

1. 建工程 → `[data-canvas-marquee-surface]` 可见；工具栏建文本/图片/视频/音频/生成配置各 1，
   逐个拖到目标坐标（`toBeLessThanOrEqual(2)` 像素级落位）→ `.kernel-node` 计数=5。
2. 选中图片节点 → 四角 `.cursor-nwse-resize` 拖动 → 宽度 `toBeGreaterThan` 原宽（四角 resize）。
3. Shift-click text+image → `.is-selected` 计数=2 → Escape → 计数=0（多选 toggle + Esc）。
4. Control+drag marquee 框住 text+video → `[data-selection-marquee]` 可见 → 两节点 `is-selected`。
5. 文本右手柄拖到图片左手柄 → 目标手柄 `pointer-events-auto` 高亮 + `elementFromPoint` 命中
   图片 nodeId → `[data-connection-id]` 计数=1（连接手柄 + 归一化 + 目标高亮）。
6. 图片手柄拖落空白 → `[data-connection-create-menu]` 可见 → 选「音频」→ `.kernel-node`=6、
   连线=2（落空白五类创建）。
7. Shift 选 text+image → ⌘C → ⌘V → `.kernel-node`=8、连线=3（复制带内部连线）。
8. Delete → 节点=6 → ⌘Z 撤销 → 节点=8、连线=3（删除 + 撤销，快照历史）。
9. 记录 8 节点 id 集 → 保存 → `.status-dot` 现 `草稿 vN 已保存` → reload → openProject →
   节点=8、连线=3、node id 集 `toEqual` 复原（持久化恢复）。

## 命令结果（真实输出）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| e2e `pro-studio-k2-canvas.spec.ts`（隔离库 `meiye_k7ev`，PORT=3602/CORE=4602/CANVAS=4702） | **1 passed（1.2m），EXIT=0**；测试本体 11.0s | 四服务真机（Core/Worker/Main/Canvas）+ 干净隔离 PG + fixture；**#169 的 42P07 未复现**（干净库无 journal 漂移），完整旅程逐硬断言通过。日志 `/tmp/k7ev-k2.log`。 |
| `pnpm --filter @meiye/canvas test`（G01–G25 单测锚点） | **277 pass / 0 fail / 1 skip（278 tests，5.5s），EXIT=0** | 未改 canvas 代码；skip 为既有 trusted payment 条件测试；`kernel-canvas-surface.test.ts` 17 例「K2 ...」+ node-adapter/node-info/node-media/image-quick-tools/project-persistence 全绿。日志 `/tmp/k7ev-canvas-unit.log`。 |
| e2e `pro-studio-security-boundaries.spec.ts` + `pro-studio-cross-service-smoke.spec.ts`（首轮 bundled，隔离库 `meiye_k7ev2`） | **4 failed，EXIT=1**（time-box 各试一次） | 诊断见下节：3 项绑定契约/供给/身份围栏 + 1 处 K6 连带 stale 选择器。日志 `/tmp/k7ev-sec-cross.log`。 |
| e2e `pro-studio-cross-service-smoke.spec.ts`（**选择器修复后单跑**，隔离库 `meiye_k7ev3`） | **1 failed，EXIT=1** | **选择器修复生效**——不再挂 project-card（无 strict-mode），前进到**第一个生成腿 image.generate（spec:189）**，挂 `GENERATION_INPUT_BINDING_INVALID`（绑定契约，**非 audio.sfx、非 #119 供给**，见下节）。日志 `/tmp/k7ev-cross-refix.log`。 |
| e2e `pro-studio-security-boundaries.spec.ts`（**:789 选择器修复后单跑**，隔离库 `meiye_k7ev4`） | **3 failed，EXIT=1** | 3 测试挂点稳定：:360 绑定契约 / :621 copy 额度 / :708 **身份围栏 :774**（非 :789）。**:789 修复不改变结果**——identity 仍挂更靠前的 :774，证实 :789 潜伏、selector 与深层阻塞隔离。日志 `/tmp/k7ev-sec-refix.log`。 |

> 注：跑 e2e 用 `... > log 2>&1; echo EXIT=$?` 读真实退出码——后台任务系统显示的 exit 0 是命令
> 末尾 `echo` 的退出码，Playwright 真实退出码在日志（首轮 `4 failed`、修后单跑 `1 failed`）。

## security-boundaries + cross-service：修 K6 连带选择器 + 经验诊断 + 诚实登记（time-box 不 grind）

任务定性 B0（best-effort，此前隔离跑绿）、"各试一次,过不了诚实登记别硬耗"。首轮 bundled 4 项
全挂；修掉 K6 连带的 stale 选择器后**单跑 cross-service 经验实测下一阻塞**——4 项失败分三类根因，
**均非 K2 画布回归或架构缺陷**：

### 已修：K6 连带 stale 选择器（波及面 = 2 spec / 4 处）
K6（PR #191）给 project-card 加了 `aria-label="导出工程 <name>"` / `aria-label="删除工程 <name>"`
两个带工程名按钮，令 `getByRole('button',{name:<项目名>})` substring 匹配命中 3 按钮。
**波及面清单**（团队交叉验证 + 宽 grep `{name:*.name}` 任意变量路径，全 specs）：
- `cross-service-smoke.spec.ts`:167/169/261 —— **活跃 strict-mode 阻塞**：`.toBeVisible()`/`.click()`
  是单元素动作，3 匹配即违规，测试首挂于此。
- `security-boundaries.spec.ts`:789 —— **潜伏项**：断言是 `.toHaveCount(0)`（校验 identity B 下
  fixtureA 工程**缺席**），count 断言对多按钮 **robust**（缺席=0、存在=3≠0 均正确检出，**不触发
  strict-mode**），且该测试首轮**先挂在更靠前的 :774 身份围栏断言**（见深层阻塞 #3），**:789 从未
  到达**。故 :789 非活跃阻塞，修它属一致性硬化、不改变该测试结果。
- `project-export.spec.ts`:140 的 `删除工程 ${projectB}` 是 K6 引入的**显式精确**选择器（正确用法），
  不动。其余 spec 无此模式。
> **认领遗漏**：本文件首版称"仅 1 spec / 3 处"——我上轮 grep 正则锚定变量开头为 `project`，漏了
> 嵌套 `fixtureA.project.name`；经团队交叉验证补齐为 **2 spec / 4 处**。

**修复**：镜像 K6 `pro-studio-project-export.spec.ts` 已验证模式——cross-service 三处 `.project-card`
`.filter({hasText})` + `.locator('.project-card-open')`；security:789 `.project-card`.filter +
`.toHaveCount(0)`（card 级缺席断言，语义等价且更干净）。两文件 biome check 干净，不碰被测代码。
**证实隔离**：cross-service 修后单跑（`meiye_k7ev3`）不再挂 project-card、前进到生成腿；security
修后单跑（`meiye_k7ev4`）identity 仍挂 **:774 身份围栏**（非 :789）——selector 与深层阻塞干净分离。

### 深层阻塞（3 项，非 selector，交 main 决策，本轮不 grind）
1. **生成输入绑定契约（stale test，非 #119 供给，非 audio.sfx）** —— cross-service **第一个生成腿
   `image.generate`（spec:189）** 与 security `reject foreign workspace objects` **同签名**
   `GENERATION_INPUT_BINDING_INVALID: Canvas generation requires a real frozen nodeId or itemId`。
   根因：`apps/canvas/src/server/backend-port.ts:1401 freezeGenerationLineage` 要求每个画布生成
   绑定**真实冻结 nodeId 或 itemId**（:1422），而两测试的 GenerationInput 是 **prompt-only**
   （`inputAssets:[]`，无 nodeId/itemId）→ 契约拒绝。这是**测试生成输入构造 stale 于收紧后的绑定
   契约**，非供给未 seed。**修后 cross-service 根本没走到 audio.sfx（spec:208）**——本文件首轮
   "audio.sfx 是下阻塞"的推测已被实测证伪（更正留痕）。补齐=为生成绑定一个冻结节点（如
   `nodeId:'smoke-copy'`），但会级联到后续 audio 腿绑定 + audio.sfx 供给（`audio.sfx` 非平台默认，
   `generation-runtime.test.ts:303` 实锤 `activation='inactive'`），属 test rework，交 main 决策。
2. **copy 额度未 seed（#119 供给，发布门归 #119）** —— security `two Canvas sessions preserve
   CAS zero-write and recover after a conflict` 的 `planAgent: INSUFFICIENT_ENTITLEMENT
   Insufficient copy allowance`。额度礼包经 Main→Core 代理 `register_gift`+
   `provision_model_defaults` 触发，pro-studio→canvas 路径不触发（K4 已述）。登记 **BLOCKED（#119）**。
3. **身份围栏断言（深层多服务 provisioning，归 #119）** —— security `identity switch clears
   Canvas caches and fences a delayed response` 首挂在 **:774**
   `expect(contextB.userId).not.toBe(contextA.userId)`（切身份后新旧 userId 应不同）——fixture
   provisioning 退化致 contextA/contextB 同源（与另两测试 setup 崩同源）。该断言在 :789 之前，故
   :789 潜伏选择器从不影响本失败。登记 **BLOCKED（#119）**。

**结论**：K6 连带 stale 选择器（2 spec / 4 处）已修并证实隔离（含 security:789 潜伏项主动对齐）。
余下阻塞**明确两类**（Phase 2 发布结论须区分 test-rework vs 供给 BLOCKED）：【类 A】旧 spec 绑定
契约 stale test（cross-service image.generate + security foreign-workspace，需 test rework 对齐
`freezeGenerationLineage`，**非 #119**，本轮按 team lead 决策登记 K7 遗留）+【类 B】#119 深层供给
BLOCKED（copy 额度 / 身份 provisioning / audio.sfx，发布门归 #119）。按 time-box 不 grind seed 供给、
不做级联 test rework。**K2 主验收（primary deliverable）已干净跑绿，不受影响。**

## 改动文件

- **新增证据**：本文件 `docs/evidence/pro-studio/k2-canvas-parity-evidence-2026-07-23.md`。
- **修复（测试选择器，surgical，2 spec / 4 处）**：K6（PR #191）连带的 stale 选择器，镜像 K6
  `pro-studio-project-export.spec.ts` 已验证模式；两文件 biome check 干净；不改任何被测代码。
  - `tests/e2e/specs/pro-studio-cross-service-smoke.spec.ts` 三处（167/169/261）
    `getByRole('button',{name:project.name})` → `.project-card`.filter + `.project-card-open`。
  - `tests/e2e/specs/pro-studio-security-boundaries.spec.ts`:789
    `getByRole('button',{name:fixtureA.project.name}).toHaveCount(0)` → `.project-card`.filter
    `.toHaveCount(0)`（潜伏项，一致性硬化；见上节）。
- **未改** `pro-studio-k2-canvas.spec.ts`、`scripts/ci/provision-test-db.sh`、任何功能代码 /
  manifest（WS-A）/ kernel-ui spec（WS-B）——K2 干净库直接跑绿，provision 无缺陷，均无须改动。
  深层阻塞（生成绑定契约 stale test / #119 供给）**未改**——按 team lead 决策登记 K7 遗留（类 A
  test-rework / 类 B #119 BLOCKED），见遗留缺口 #3。
- 跑 e2e 时 paraglide/inlang 自动重写 `project.inlang/.gitignore`（构建副作用）已 `git checkout`
  还原，不入本 commit。`test-results/`（含失败截图 / error-context）已被 `.gitignore` 忽略。

## 遗留缺口（诚实登记）

1. **G15 小地图 / G16 小地图开关-重置-缩放滑块-帮助 的逐行为 e2e**：二者为 vozeb-native
   组件，经 mount-contract 保证随 `VozebCanvas` 挂载，但无逐控件浏览器断言（#169 亦标 B0）。
   补齐路径：扩 K2 spec 加 minimap 可见性 + 缩放滑块拖动 + 帮助浮层开合断言。
2. **G05 批量堆叠 / 设主图**：属节点生成批量域，归 K4（`node-generation-contract.test.ts:368`），
   非 K2 画布残差，本文件不重复覆盖。
3. **security-boundaries（3）+ cross-service（1）跑绿——分两类，Phase 2 发布结论须区分**：
   K6 连带 stale 选择器（**2 spec / 4 处**：cross-service 167/169/261 + security:789）**已修并证实
   隔离**（cross-service 前进到生成腿；security identity 仍挂更靠前的 :774，:789 属潜伏、被 fence
   先挡，本轮已一并主动对齐 → 将来 binding 修复不会再暴露它）。余下阻塞按根因**明确两类**：

   **【类 A】旧 spec 绑定契约 stale test（需 test rework 对齐 `freezeGenerationLineage`，非 #119）**
   —— cross-service `image.generate`（spec:189）+ security `reject foreign workspace objects`
   （:360）同签名 `GENERATION_INPUT_BINDING_INVALID`。旧 spec 用 prompt-only GenerationInput，未
   对齐收紧后契约（要求真实冻结 nodeId/itemId，`apps/canvas/src/server/backend-port.ts:1422`）。
   **决策（team lead，2026-07-23）：本轮不修，登记 K7 遗留 test-rework 待办**。理由：①补齐要给生成腿
   绑冻结节点、级联 audio 腿 + audio.sfx（落入类 B #119），完整绿仍 BLOCKED；②非 K7 parity 核销主线
   —— G01–G48 由四票（K3–K6）+ K2 覆盖，四票新 spec 已对齐收紧契约并跑绿；cross-service/security 属
   K2 时代旧 spec **双 stale**（selector + 绑定契约），与 kernel-ui 同族漂移。

   **【类 B】#119 深层供给未 seed（发布门归 #119，BLOCKED）** —— ①copy 额度（security CAS :621
   `INSUFFICIENT_ENTITLEMENT`）②身份/workspace provisioning（security identity :774
   `contextB.userId === contextA.userId`）③audio.sfx（cross-service :208 潜在，`audio.sfx` 非平台
   默认，`generation-runtime.test.ts:303` 实锤 inactive）。均需 recorded/gifted 供给环境，发布结论层
   归 #119。

   按 time-box 未 grind seed 供给 / 未做级联 test rework。类 A 修法与类 B 供给互斥于本轮范围，交
   Phase 2 分别处置。
