---
title: Pro Studio 内核真接入实施规格
status: implemented-engineering
triage: release-gated
date: 2026-07-19
revision: 1
source_of_truth:
  - 已批计划: Pro Studio 真接入与规划对齐计划（会话 plan，2026-07-19）
  - 父规格: docs/specs/vozeb-adoption-pro-studio-spec.md（rev2）
  - ADR-0011 ContentPackage 唯一成品聚合
  - ADR-0012 Composer 与 Pro Studio 两线产品边界
  - A2/A3 书面授权: docs/evidence/pro-studio/a2-authorization-2026-07-19.md、a3-authorization-2026-07-19.md
  - 书面仪器: docs/design/# Git 仓库开发授权书.md（csyqlz + basketikun → legacy-origin-a）
  - 上游钉死: csyqlz/vozeb @ a2c52c7aacf68d825563b7455efa9c34f3db0123（v1.0.0）
  - 票状态基线: .scratch/vozeb-pro-studio/STATUS.md（SaaS 壳 19 implemented / 6 partial）
  - 票包: .scratch/pro-studio-kernel-integration/
---

# Pro Studio 内核真接入实施规格

> **历史工程基线（2026-07-22）**：本规格和对应 K01–K11 acceptance 是 2026-07-19 的原始工程交付记录。D-099 rev2 已撤销 K03 对“上游 parity/内核完成”及“import 即挂载”的充分性判据；K03 当时实际取证的节点、文本编辑、框选、多拖和 Undo/Redo 行为保留为回归基线。当前 Pro Studio 实施入口、G01–G48 核销和 K1–K7 票包以 [`pro-studio-parity-rework-spec-2026-07-22.md`](./pro-studio-parity-rework-spec-2026-07-22.md) 为准。

> **实施状态（2026-07-19）**：K01–K11 engineering DoD 已完成并合入 `main`，证据见 `docs/evidence/pro-studio/kernel-integration-v1-acceptance-2026-07-19.md`。本规格正文继续作为合同；N2 生产恢复、安全演练、定价、升单验证与 Audio/SFX 商业激活仍是公开发售门，不得由工程完成推导为可售。

> 本规格承接已拍板的「真接入」计划：在 **A2/A3 书面授权已归档** 的前提下，把授权的 **canvas / render / retouch 内核** exact-copy 进独立 Canvas 服务，经既有 **BackendPort → Product Core** 接缝服务端化，使商家看到的是上游式无限画布与精修，而不是工程列表薄壳。父规格 `vozeb-adoption-pro-studio-spec` 的领域合同、反面教材与发布门 **不重开**；本规格只补「内核挂载与适配」这一缺口。

## Problem Statement

升单客群（陪跑教练、中高阶商家）需要的是高自由度的探索式创作台：节点图、连线、蒙版精修、多分支择优，再把合格结果采用进门店内容库。

当前产品已具备：

- 两线边界与加购权益（Composer 日常轻编辑 vs Pro Studio 加购）
- 启动码 SSO、独立 Canvas 服务、BackendPort 薄 BFF
- AdvancedCanvasProject / revision、生成 Job、采用、Agent 七动词合同、fixture 跨服务 smoke
- A2/A3 书面授权与 copy-manifest 授权状态

但商家进入 Pro Studio 后看到的是 **工程列表 + runtime 面板薄壳**，不是上游无限画布内核；`copy-manifest.copies` 仍为空。授权解除的是「能不能拷内核」的门，**不等于** 已挂载内核。结果是：规划中的「高阶工作台」在体验上未兑现，演示与升单验证无法按原规划走通。

## Solution

在 **不复制 Vozeb 后端/业务 runtime** 的前提下：

1. 按钉死 commit 对 canvas/render/retouch core 做 **字节级 exact-copy**，并写入 copy-manifest（每文件 A2/A3 证据与 sha256）。
2. 用 **最小嵌入 layout** 挂载内核：剥离积分/管理员/独立登录；主题、工作区、返回目标来自启动码 bootstrap。
3. 用 **适配层** 把内核的 localForage / IndexedDB / 本地生成调用，接到既有 BackendPort 与 Product Core（工程 CAS、OwnedAsset、Generation Job、ledger、adoption、Agent 确认凭据）。
4. 按父规格 E2E 四组做 **内核路径** 验收；Audio 商业激活与对外发售门仍可 fail-closed，但 UI 不得假可用。

**主测试 seam（唯一领域接缝）：** Canvas `BackendPort`（同源 `/api/canvas/*`）→ Product Core Application Service。内核与适配层不得引入第二套资产/账务/任务/采用状态。

## User Stories

### 授权与可审计复制

1. As a 平台工程负责人, I want every exact-copied upstream file listed with source, target, sha256 and A2/A3 evidence, so that 合入与发布可审计且 CI 能校验一致性。
2. As a 平台工程负责人, I want the copy set limited to canvas/render/retouch core at the pinned commit, so that 后端 runtime、任意代理、Points、本地 Agent 桥不会进入构建。
3. As a 平台工程负责人, I want third-party fonts/media/prompt corpora fail-closed or explicitly noted, so that A3 不因作者授权被误当成全清。
4. As a 法务/交付审计人, I want the written dual-grantor instrument hash bound to the manifest, so that 授权范围可追溯。

### 进入与壳

5. As a 已购 Pro Studio 的工作区成员, I want 一键进入全屏画布且免二次登录, so that 高阶工作台是产品的一部分。
6. As a 未购用户, I want 介绍位与购买路径而不是死链, so that 我知道升单档存在（既有能力，内核接入不得破坏）。
7. As a 中高阶运营, I want 返回时回到来时的成品/素材/工程上下文, so that 两线不迷路。
8. As a 中高阶运营, I want 画布内无积分、独立退出、管理员入口, so that 体验是我方产品而不是上游站长台。
9. As a 中高阶运营, I want 主题与语言跟随主应用 bootstrap, so that 两界面像同一产品。

### 无限画布内核体验

10. As a 中高阶运营, I want 无限画布上自由摆放文本/图片/配置/视频/音频节点并连线, so that 探索过程可视化。
11. As a 中高阶运营, I want 连线决定生成输入上下文, so that 实验输入关系可追。
12. As a 中高阶运营, I want 框选、多选拖拽、无限缩放、撤销与快捷键, so that 大型工程可操作。
13. As a 中高阶运营, I want 从本店素材库插入素材到画布, so that 门店真实照片进入高阶创作。
14. As a 中高阶运营, I want 满意生成结果一键存回素材库, so that 过程产物可复用。

### 精修

15. As a 中高阶运营, I want 局部蒙版重绘, so that 只改画面一部分。
16. As a 中高阶运营, I want 裁切、切图、放大（超分）, so that 常见精修不离开产品。
17. As a 中高阶运营, I want 参考图驱动编辑, so that 风格参照可表达。
18. As a 中高阶运营, I want 精修结果作为新节点并保留派生连线, so that 可对比多方向再择优。

### 云端工程与媒体

19. As a 中高阶运营, I want 工程与媒体保存在云端并按工作区隔离, so that 换设备/清缓存后仍在。
20. As a 中高阶运营, I want 新建/重命名/复制/软删工程并看到列表, so that 多项目可管理。
21. As a 中高阶运营, I want 自动保存 draft 带冲突保护, so that 并发不静默丢稿。
22. As a 中高阶运营, I want 显式检查点与恢复, so that 采用引用的是冻结版本。
23. As a 中高阶运营, I want 离开时有未保存提醒, so that 不丢工作。
24. As a 中高阶运营, I want 裁切/切图等纯前端派生文件可持久化为 OwnedAsset, so that 媒体事实不在浏览器 IndexedDB。

### 生成与计费

25. As a 中高阶运营, I want 画布内提交图片生成并看到进行中/成功/失败, so that 不用盯刷新。
26. As a 中高阶运营, I want 刷新后任务状态按工程恢复, so that 长任务不丢。
27. As a 中高阶运营, I want 自由文本与图片反推提示词, so that 好图可复用为提示词。
28. As a 中高阶运营, I want 视频生成（按 capability 声明的高级参数）, so that 高阶视频实验不出走。
29. As a 中高阶运营, I want TTS 配音可试听下载或明确不可用说明, so that 不假可用。
30. As a 中高阶运营, I want 音效按产品策略可用或明确未开放, so that 不假可用。
31. As a 中高阶运营, I want 生成前见额度报价、失败自动退还并有人话解释, so that 额度可解释。
32. As a 中高阶运营, I want 从美业提示词 seed 起步, so that 首次不上空白框。

### 采用与内容库

33. As a 中高阶运营, I want 选中文案与有序媒体显式采用为成品, so that 探索结果进入正式内容库。
34. As a 中高阶运营, I want 采用时选新建成品或既有成品新版本, so that 可开新也可迭代。
35. As a 中高阶运营, I want 同 revision 同选区重复采用回到同一成品, so that 不误产重复。
36. As a 中高阶运营, I want 已采用节点显示徽标并可跳转, so that 知道哪些分支已落地。
37. As a 单店商户, I want 采用来的成品与 Composer 产成品同一内容库体系, so that 不关心产自哪个工作台。

### Agent

38. As a 中高阶运营, I want 在线助手用固定七动词协助改图结构, so that 专业操作可加速。
39. As a 中高阶运营, I want 每批命令先看 diff/费用上限再确认, so that 不静默改工程。
40. As a 中高阶运营, I want 拒绝确认则零写入, so that 我掌控变更。
41. As a 中高阶运营, I want stale revision 冲突时重读再确认, so that 双会话安全。
42. As a 平台安全负责人, I want 无本地 agentToken/shell/自动关确认进入构建, so that 上游不安全桥不进 SaaS。

### 安全与边界

43. As a 平台安全负责人, I want 跨 workspace 的 project/revision/asset/job/package 访问失败且零副作用, so that 无 IDOR。
44. As a 平台安全负责人, I want 客户端无法提交 channelId/baseUrl/serverUrl/apiKey/供应商路径, so that 无自授权洞。
45. As a 平台运营者, I want 画布线成本与主线同一 ledger 口径, so that 账可观测。

### 规划对齐与验收

46. As a 产品负责人, I want 内核路径 smoke「登录→进画布→生成→采用→内容库可见」, so that 真接入可演示。
47. As a 产品负责人, I want Pro Studio 仍不进一级导航且不锁 Composer, so that 两线边界不回退。
48. As a 产品负责人, I want 对外发售仍受 N2/安全/定价/升单门约束, so that 工程完成不等于公开销售。

## Implementation Decisions

### 1. 范围与与父规格关系

- 本规格 **只覆盖内核 exact-copy、最小嵌入、适配层、内核路径验收**。
- 父规格已实现的 BackendPort 合同、AdvancedCanvasProject、Job origin、adoption、entitlement、Agent 服务端 allowlist、加购商业路径 **复用，不重做**。
- 父规格仍 open 的生产盘点（Polotno 历史）、N2、定价、SFX 供应商选型 **不因本规格自动关闭**；本规格可在 UI 层 fail-closed。

### 2. 唯一领域接缝

- **唯一领域 seam：** Canvas BackendPort → Product Core Application Service。
- 冻结 action 全集继承父规格（会话、工程、素材、生成、采用、Agent、用量）；表外 404；禁字段 schema 层拒绝。
- 首发 **不启用** HostBridge；bootstrap 经启动码兑换上下文。
- 若内核需要「图状态 ↔ 服务端 graph」映射，仅允许 **CanvasKernelHostAdapter** 作为 UI 适配模块：输入/输出均为 BackendPort DTO 与内核图模型，不持久化第二套事实。

### 3. Exact-copy 策略

- 上游钉死：`a2c52c7` / `v1.0.0`；环境变量 `PRO_STUDIO_UPSTREAM_ROOT` 校验 HEAD。
- **可拷：** canvas 页与组件、渲染与精修对话框/工具、与画布直接耦合的纯前端工具库（主题色板、图片元数据只读工具等）中经清单裁定的文件。
- **禁拷：** 任意路径代理、Points 结算、本地 Agent 桥、独立注册/首用户 admin、服务端 task Map、WebDAV、874 prompt 库 bulk 数据。
- 目标树建议：`apps/canvas` 下独立 vendor 命名空间；**exact-copy 行禁止静默改算法**；适配代码放在 vendor 外且不进 sha 行。
- 每行 manifest：`source`、`target`、`sha256`、`authorizationStatus: authorized`、A2/A3 证据路径；含第三方资产则 `thirdPartyNotes` 或替换为我方资产。
- A2 证据与书面仪器（双授权方 csyqlz + basketikun，被授权方 legacy-origin-a，目的商业开发及复制）已归档；本规格实施时 **不得清空** 该授权记录。

### 4. 最小嵌入

- 独立 Next Node Canvas 服务全屏顶层打开（已有）。
- 挂载上游画布客户端为默认创作面；工程列表可作为入口层保留，但 **打开工程必须进入内核画布**。
- DOM/bundle 验收：无上游账户/积分/管理员 UI；可见返回主站、当前工作区、主题/语言。
- 样式：允许保留上游 antd 画布样式隔离，不要求 shadcn 重写。

### 5. 持久化适配

- 工程：内核写路径 → `saveProjectDraft`（`expectedDraftVersion` CAS）；检查点 → `createCheckpoint`；加载 → `loadProject` / list/get revision/restore。
- viewport/选区/面板开关：UI session only，不进 revision（父规格冻结）。
- 删除/复制语义：继承父规格（软删+引用保护；复制仅当前图+同 Asset 引用）。

### 6. 媒体适配

- 导入、裁切、切图、超分、蒙版等本地二进制：经 `persistLocalCanvasArtifact` 或 Job 交付成为 OwnedAsset；禁止再以 IndexedDB 为权威事实。
- 播放/下载：`getAssetDelivery`（Range/MIME/nosniff/私有缓存合同已有则复用）。
- hydration：graph 内 storageKey/asset 引用与服务端 AssetId 对齐；跨设备打开必须可解析。

### 7. 生成与精修适配

- 图片生成/编辑/蒙版、text.respond、视频、audio.speech/audio.sfx：一律 `submitGeneration` / list/get/cancel + catalog/quote；结果节点与派生连线由适配层写回 graph 再 draft save。
- 计费：仅 Job 终态 ledger；禁止 2xx 即结算、禁止 Points。
- 供应商参考图：沿用已验证策略（data URL/multipart）；grant 分支保持 fail-closed 除非启用证据齐。
- **Audio：** catalog 未激活时 UI 必须禁用或明确「未开放」，禁止显示可点但必败的假入口（除非错误文案即产品策略）。

### 8. Agent 适配

- 仅 `planAgentOps` / `confirmAgentOps` / `applyAgentOps` / `listAgentAudit`。
- 七动词冻结；确认凭据一次性与 read-set 绑定。
- **构建负向扫描：** 无 agentToken query、localStorage agent token、canvas-agent 本地 shell、自动关确认默认路径。

### 9. 采用

- 内核选区 → `adoptOutput`（领域 `adopt_advanced_canvas_output`）；同 project+revision+有序选区幂等。
- 徽标与跳转：`listAdoptions` 投影；节点不维护第二套 accepted 状态。

### 10. 实施波次（票号见票包）

```text
波次 0 清单与复制:  K01 清单冻结 → K02 exact-copy+manifest
波次 1 挂载与事实:  K03 最小嵌入挂载 → K04 工程持久化适配 → K05 媒体 OwnedAsset 适配
波次 2 能力接线:    K06 图/蒙版/精修生成 → K07 文/视/Audio UI 诚实接线 → K08 Agent UI → K09 采用 UX
波次 3 验收门:      K10 内核路径 E2E/conformance → K11 产品对齐验收（V1）
```

最长链：`K01→K02→K03→K04→K05→K06→K09→K10`。K07/K08 可与 K06 后并行。K11 依赖 K10。

### 11. 量级诚实口径

- 相对父规格「23–36 人周」整体：本缺口聚焦内核挂载，粗估 **约 2–4 人周**（清单+copy 1–2 日；挂载与适配 1–2 周；E2E 收口 2–4 日），不含 SFX 供应商等待、N2 生产演练、升单 3 样本。
- 最大风险：把禁拷 runtime 一并拷入；或 UI 像内核但事实仍在浏览器（假接入）。

### 12. 共享资源与合并

- 改 contracts / core / 主 Web / 根脚本须声明 owner 与合并顺序（ADR-0012）。
- 本规格默认 **Canvas app + copy-manifest 证据** 为主改动面；Core 仅在适配发现合同缺口时 additive 修复。

## Testing Decisions

### 好测试的定义

- 只断言 **外部行为**：命令进、事实出、投影可读、用户可见状态、安全拒绝零副作用。
- 不测上游内核内部函数实现细节；不测供应商 SDK 内部。
- 架构红线用静态/构建门禁（copy-manifest 一致、禁模式扫描）。

### 主 seam 测试

- **BackendPort / Application Service（既有 prior art：pro-studio-runtime 与 backend-port 测试）：** draft CAS、load 恢复、persist artifact、submitGeneration 生命周期、adoption 幂等、Agent 确认冲突。
- **适配层：** 给定内核事件图，断言发出的 BackendPort 请求 shape 与禁字段不出现；失败映射为产品态。

### 静态与门禁

- `pnpm pro-studio:conformance`：copy 段在 K02 后不得再因空 copies 失败；其余 N2/价/Audio 可仍 partial。
- 构建负向扫描：本地 Agent 桥、任意代理、注册/首用户提权。
- discoverExactCopyTargets：未声明 exact-copy 不得存在。

### E2E 组（内核路径；prior art：pro-studio-entitlement / engineering-tickets / cross-service-smoke）

1. **E1 壳：** 解锁进入 → 打开工程见内核 → 未保存提醒 → 刷新恢复节点图。
2. **E2 创作：** 插入/连线抽样 → 蒙版或裁切至少一类 → 生成一图 → 任务恢复。
3. **E3 Agent（可后置）：** 一确认一拒绝；stale revision。
4. **E4 采用：** 选区采用 → 内容库可见 → 徽标。
5. **Smoke：** 登录 → 进画布内核 → 生成 → 采用 → 内容库（替换「仅薄壳」叙事）。

### 产品眼验清单（K11）

- 不进一级导航；Composer 不锁。
- 无限画布 + 至少一类精修真实可用。
- 换设备/清站点数据后工程+媒体可恢复（抽样）。
- Audio/SFX 不假可用。
- 深色影棚密度不被主应用浅色橱窗范式强套。

## Out of Scope

- 重开父规格已关闭的 01–16 等领域重写（除非适配暴露合同 bug）。
- Vozeb 全功能 parity、WebDAV、874 prompt 采集、签到/积分/CDK、本地 Agent 桥。
- 用 Vozeb 取代 Composer / 日常轻编辑；Polotno 五门槛生产盘点收口（主线闸）。
- 跨门店教练关系、外部设计师席位、独立音频成品 kind。
- 对外公开销售（N2 生产恢复、安全生产矩阵人工批准、定价/升单验证）——可并行，不在本规格 DoD 内宣称「可售」。
- 改造上游内核做 artboard/页式能力。
- SPA 抽取脱 Next。

## Further Notes

- **假接入判定：** UI 像无限画布，但工程仍权威落在浏览器存储，或生成仍打上游代理/Points → 本规格失败。
- **Audio 策略：** 默认 A（规格字面，未激活则禁用）；产品若选 B（白名单降级）须书面改 release-evidence，不得静默。
- **升单验证门：** 仍建议 ≥3 真实样本完成「进内核→合格成品→采用→导出」；本规格交付的是可验证工程面，不是商务放行。
- **与票 21/25 关系：** K02 关闭「copy 空清单」残留；K10 推进内核路径 smoke；不自动关闭 N2/定价。
- **票包路径：** `.scratch/pro-studio-kernel-integration/`（MAP / STATUS / issues/K01–K11）。
- **GitHub：** 规格 [#61](https://github.com/legacy-origin-a/legacy-web-repo/issues/61)；票 K01–K11 = [#62](https://github.com/legacy-origin-a/legacy-web-repo/issues/62)–[#72](https://github.com/legacy-origin-a/legacy-web-repo/issues/72)，均 `ready-for-agent`。实施分支 `spec/pro-studio-kernel-integration-2026-07-19`，合入策略由交付时另定。
