# XHS 图文专项融合 + 全局 Agent 化 UI/UX 升级规格

| Field | Value |
| --- | --- |
| Status | **authoritative for implementation planning**（本规格闭合地图 Destination；实施另开） |
| Date | 2026-08-01 |
| Wayfinder map | `.wayfinder/map-xhs-vertical-integration.md` |
| 异构铁律 | 「融入」= 模式移植（重新实现）+ 资产移植（prompt / 词库结构）；**不是**代码搬运 |
| Supersedes（产品面意图） | #281「UI 大改 + copy/note 载体扩展集中开票」遗留；两版 codex UI/UX 方案原文对撞后由本规格合流 |

> **实施唯一入口（产品合同层）。** 入口 IA、工作台四态、载体 kind、九功能 adopt/reject、合规双轨、资产挂接、分期绿集均以本规格为准。  
> 冲突时：本规格 + 地图 Decisions > 两版 codex 原文 > 历史 #281 遗留表述。  
> 本规格 **不** 代替实施 PR；地图会话 **不** 改生产代码。与代码相关的断言均指向研究报告；材料未锁处标「实施时定」。

---

## §0 元信息

### 0.1 Wayfinder 九票清单

| 票标题 | 文件 | 角色 | 状态 |
| --- | --- | --- | --- |
| 盘点 xhswork 基线：功能→代码映射与资产清单 | `.wayfinder/issues/xhs-01-research-xhswork-baseline-inventory.md` | research | closed |
| 审计我方创作面现状：入口、载体与生成主链落地状态 | `.wayfinder/issues/xhs-02-research-our-creation-surface-audit.md` | research | closed |
| 裁决爆款复刻链接解析的合规边界 | `.wayfinder/issues/xhs-03-lock-link-parse-compliance-boundary.md` | grilling | closed |
| 锁定 xhswork 功能 adopt/reject 矩阵 | `.wayfinder/issues/xhs-04-lock-adopt-reject-matrix.md` | grilling | closed |
| 锁定工作台 Agent 化目标形态（合流两版 codex 方案） | `.wayfinder/issues/xhs-05-lock-agent-workbench-form.md` | grilling | closed |
| 产出融合规格 | `.wayfinder/issues/xhs-06-produce-integration-spec.md` | produce（本文件） | 本规格即交付物 |
| 对撞评审两版 codex UI/UX 方案并核对仓库事实 | `.wayfinder/issues/xhs-07-research-codex-uiux-proposals-review.md` | research | closed |
| 锁定创作入口 IA 与载体扩展（收编 #281 集中开票） | `.wayfinder/issues/xhs-08-lock-creation-entry-ia-and-carriers.md` | grilling | closed |
| 工作台四态原型：可点击状态演示 | `.wayfinder/issues/xhs-09-prototype-workbench-four-states.md` | prototype | closed |

### 0.2 研究报告（证据与代码路径真源）

| # | 路径 | 用途 |
| --- | --- | --- |
| 01 | `references/analysis/xhswork-integration-2026-08-01/01-xhswork-baseline-inventory.md` | xhswork 九功能映射、prompt/词库、合规抓取事实 |
| 02 | `references/analysis/xhswork-integration-2026-08-01/02-our-creation-surface-audit.md` | 我方入口/主链/copy·note 缝/#281 四扩展点/IA 约束面 |
| 03 | `references/analysis/xhswork-integration-2026-08-01/03-codex-uiux-proposals-review.md` | C1–C13 / D1–D8 / F1–F23 事实核对 |

### 0.3 原型资产（形态定稿参照，非实现代码基线）

| 资产 | 本地路径 | 票 |
| --- | --- | --- |
| 工作台四态原型 v3 | `references/analysis/xhswork-integration-2026-08-01/04-workbench-prototype.html` | [工作台四态原型：可点击状态演示](../../.wayfinder/issues/xhs-09-prototype-workbench-four-states.md) |
| 入口 IA 原型 v2 | `references/analysis/xhswork-integration-2026-08-01/05-entry-ia-prototype.html` | [锁定创作入口 IA 与载体扩展](../../.wayfinder/issues/xhs-08-lock-creation-entry-ia-and-carriers.md) |

### 0.4 输入方案原文（对撞候选，非现行权威）

- `docs/legacy-web-repo-UI-UX-Agent化调整建议0801.md`（方案一）
- `docs/美业宣发经营Agent-UI-UX调整建议-完整版0801.md`（方案二）
- 合流裁决以 [锁定工作台 Agent 化目标形态](../../.wayfinder/issues/xhs-05-lock-agent-workbench-form.md) 为准

### 0.5 先例格式

`docs/specs/pro-studio-retirement-spec-2026-08-01.md`（元信息表、证据引用、分期绿集写法）

---

## §1 目的与范围

### 1.1 目的

产出可直接交给实施的 **一体化规格**，锁定：

1. xhswork 九创作功能的 adopt / adapt / reject 与移植形态；
2. 爆款复刻链接解析的合规双轨；
3. 两版 codex UI/UX 方案对撞后的工作台 Agent 化目标形态；
4. 创作入口 IA 与 ContentPackage 载体扩展（**收编 #281**）；
5. 分期实施顺序与可执行验收门。

地图内不改生产代码；实施另开。

### 1.2 范围内

| 域 | 内容 |
| --- | --- |
| 创作功能域 | 图文生成 / 封面 / 仿写 / 编辑器内 AI / 违禁词 / 深度思考 / 参考图风格分析 等（§4） |
| 链接解析合规 | 爆款复刻取材双轨与永不采用红线（§5） |
| 全局 UI/UX 升级 | 四态工作台、文档时间线、建议行、Activity Shelf、记忆三层路径、宽度合同等（§2、§8） |
| #281 收编 | copy/note 载体与执行确认合同；四个扩展点一次性消费（§3） |
| 资产移植 | 六 prompt 文件、sensitive_words 结构、内联 prompt 评估（§6） |

### 1.3 范围外

| 域 | 说明 |
| --- | --- |
| **商业域** | 积分 / 套餐 / 支付 / 兑换码 / 邀请；仅「按操作计费颗粒度」作 entitlement 映射参考（[锁定 xhswork 功能 adopt/reject 矩阵](../../.wayfinder/issues/xhs-04-lock-adopt-reject-matrix.md)） |
| **发布 / 分发域** | 扫码发小红书 App、多平台同步分发合同本图不定 |
| **历史 / 作品管理模式对撞** | 已有 works/results；本图不做两边体验对撞 |
| **xhswork 管理后台** | 模型管理 / 用户管理 / 订单管理等 |
| 地图内改代码 / 合并 PR / 跑迁移 | 明确禁止 |

**备查（非本规格交付）**：OpenCLI `xiaohongshu publish`（创作者中心 UI 自动化发布）已实测存在，未来分发域立项可直接评估，无需第三方 `myaibot.vip` 类服务（来源：[裁决爆款复刻链接解析的合规边界](../../.wayfinder/issues/xhs-03-lock-link-parse-compliance-boundary.md)；地图 Out of scope）。

### 1.4 异构与产品原则

参考仓 `references/repos/xhswork/` 与本仓完全异构 → 只移植模式与资产。用户旅程先于代码；HITL 生成自由+发布收口；HeroUI 基座；UI 基线见 §7。

---

## §2 工作台目标形态

证据主源：[对撞评审两版 codex UI/UX 方案](../../.wayfinder/issues/xhs-07-research-codex-uiux-proposals-review.md) → [锁定工作台 Agent 化目标形态](../../.wayfinder/issues/xhs-05-lock-agent-workbench-form.md)；形态验证：[工作台四态原型](../../.wayfinder/issues/xhs-09-prototype-workbench-four-states.md)。

### 2.1 共识 C1–C13（不可回退前提）

全部锁定。摘要如下（细节与代码事实见 `03-codex-uiux-proposals-review.md` §一）：

| # | 前提 |
| --- | --- |
| C1 | **不推翻**一级 IA：单 Dashboard 路由三段 + 五个一级导航 |
| C2 | 目标 = **Agent 状态驱动工作台**，不是更大聊天页 / 场景货架 |
| C3 | 推荐 CTA / 动作 chip：**只预填**，永不自动提交、不扣额度 |
| C4 | 输出类型轴一级、配方二级；五类宣发任务不是一级导航 |
| C5 | 定制 vs 自由：同一 Composer 壳，不同显露深度 |
| C6 | 执行确认卡 = 统一生成边界：只读、只确认/拒绝；改设置回输入区 |
| C7 | 成品卡 = 下一步行动中心 / **进入对象工作区的门**；对话流不铺满编辑控件 |
| C8 | 长任务可离场、可恢复；任务卡承载阶段/离开/取消 |
| C9 | 记忆一级入口正确，但当前页不能代表「越用越懂我」 |
| C10 | 视觉：门店橱窗 / 玻璃壳 + 白瓷内容 + 玫瑰金克制 |
| C11 | 开源策略：抄协议与模式，**不替换** DBOS / Task / ContentPackage 真相链 |
| C12 | 明确不做：通用会话列表聊天、工具市场首页、原始 CoT/工具日志、叠加确认、孤立记忆管理页 |
| C13 | P0–P2 分层；P0 先修主入口 Agent 感知与关键诚实问题 |

### 2.2 四态模型

| 态 | 语义（产品） | P0 最小落点 |
| --- | --- | --- |
| **Idle** | 冷启动：问候 + 分段器 + Composer + 建议 + Activity Shelf | Idle 布局定稿对齐（完整视觉可分 PR） |
| **Active** | 任务进行中：折叠推荐/继续；时间线承载补问/进度 | **Active 折叠**（推荐与继续收起） |
| **Waiting** | 长任务可离场：阶段卡 + 恢复 | 与既有 progress / async-task-center 对齐；深化实施时定 |
| **Delivered** | 候选/交付去重摘要；媒体可宽 | **交付去重**；宽度合同起步 |

来源：D3 裁决（[锁定工作台 Agent 化目标形态](../../.wayfinder/issues/xhs-05-lock-agent-workbench-form.md)）。

### 2.3 分歧 D1–D8 裁决表

| # | 裁决 | 分期含义 |
| --- | --- | --- |
| **D1** | **文档时间线**视觉（方案二）+ **AgentFrame 六族**作实现注册表（方案一）；气泡流淘汰 | 时间线主体 P1；帧注册表可并行渐进映射 |
| **D2** | 数据 = **类型化 handoff** + 去掉硬编码 copy 预填（P0 事实修复）；视觉 = **轻胶囊建议行**（今日建议=首位高亮 chip，点开见三要素小卡） | P0 修 handoff/copy；Strip→chip 形态 P0/P1 交界 |
| **D3** | 四态语义全采；P0 = Active 折叠 + 双滚动修复 + 交付去重；**双栏与 Composer 粘底 morph → P1** | 见 §8 |
| **D4** | **零新 runtime**；AG-UI / assistant-ui / CopilotKit 只抄协议与模式；ai@7 / Motion / cmdk / HeroUI 真依赖；react-resizable-panels **转正 Result Inspector**；**Tiptap 引入限对象工作区**；**UI 基线 = HeroUI Pro AI showcase + assistant-ui 示例** | 见 §7 |
| **D5** | 记忆：P0 去 JSON + 默认待确认 + 冷启动诚实文案；P1 三层页；P2 任务内三处露出 + 改名「经验」 | 见 §8 |
| **D6** | **Activity Shelf**（≤3 张对象卡：缩略图 / 状态 / 下一步）；原型定稿横排大留白卡；P0/P1 交界 | 完整版 P1 |
| **D7** | P0：交付卡**去重摘要**（candidate 完成后收起为一行胶囊）；原位 morph 动画 P1 | 见 §8 |
| **D8** | 宽度合同：**对话 800、媒体展开 1240**（原型实测成立） | P0 起步 / P1 与双栏联动 |

### 2.4 Idle 形态定稿

验证来源：原型 v2/v3 + [工作台四态原型](../../.wayfinder/issues/xhs-09-prototype-workbench-four-states.md) Resolution。

自上而下：

1. **大标题问候**
2. **定制 / 自由创作分段器**（C5）
3. **单一大 Composer**（控件收进底栏图标胶囊：＋素材 / 输出类型▾ / 配方▾ / @ / 额度 / 圆形发送）
4. **轻胶囊建议行**（小红书图文、爆款复刻等在首屏配方位；今日建议=首位高亮 chip）
5. **Activity Shelf**（横排大留白卡）

层级原则：图标 + 胶囊区分主次；大留白呼吸感。对标用户指定基线：HeroUI Pro AI showcase、assistant-ui 示例（见 §7）。

### 2.5 宽度合同

| 场景 | 宽度 |
| --- | --- |
| 对话主列 | **800** |
| 媒体展开 | **1240** |

现状 `max-w-3xl` 压媒体（`03-…` F4）；实施改主列 class；双栏属 P1（D3）。

### 2.6 主路径动线（入口 IA）

来源：[锁定创作入口 IA 与载体扩展](../../.wayfinder/issues/xhs-08-lock-creation-entry-ia-and-carriers.md)。

```
说一句话 / 点建议
  → 文档时间线（Active）
  → 流内 AG-UI interrupt 执行确认（若含付费媒体）
  → Waiting（可离场）
  → Delivered 成品卡（行动中心）
  → 对象工作区精修
  → 「导出 / 发布准备」出口占位（不承诺分发合同）
```

- 五个一级导航维持；「记忆」改名「经验」按 D5 留 **P2**。
- XHS 专项 = **图文 lens 下的配方族**（小红书图文、爆款复刻等），配方二级显露，**不新增一级导航**（C4）。

---

## §3 载体与执行确认合同

来源：[锁定创作入口 IA 与载体扩展](../../.wayfinder/issues/xhs-08-lock-creation-entry-ia-and-carriers.md)；缝定位：`02-our-creation-surface-audit.md` §3。

### 3.1 ContentPackage kind 三枚举

| kind | 含义 |
| --- | --- |
| `media` | 单媒资（图/视频等） |
| `copy` | 纯文案 |
| `note` | 图文复合 = 页组 + 封面 + 正文；**XHS 图文成品即 note** |

**现状缝（须改）**（审计 §3.1–3.2）：

- 契约 `packages/contracts/src/content-package.ts`：`kind` 现为 `z.enum(['image_text', 'video'])`，**无独立 copy / 第三枚举 note 口径**。
- 前台 lens 三值 `copy | image_text | video`；Harness 快照另有 `image` / `image_text_note` 等——实施须做 **schema 全链** 与 lens/编排映射，字段级 note 域模型（页组/封面/正文 schema 细节）地图标为 **规格/实施细化**；材料未锁的字段表 → **实施时定**。

> 口径锁三枚举；与历史 `image_text` 迁移（rename vs 别名）→ **实施时定**，产品语义以 media/copy/note 为准。

### 3.2 执行确认：按「是否含付费媒体执行」判定

| 情形 | 确认卡 |
| --- | --- |
| 含付费媒体执行（含 note 批量配图） | **必过卡** |
| 纯 copy | **免确认**（D-043 不动） |

废止「仅 lens=media 隐式」的旧表述；改为**操作是否触发付费媒体执行**。确认卡仍只读、只确认/拒绝（C6）。

### 3.3 流内 AG-UI interrupt 呈现时序

不做独立静态对比页。时序：

```
plan.ready
  → interrupt: execution_confirm
  → 流暂停、零扣费
  → 用户确认 / 拒绝
  → execution.confirmed（或拒绝路径）
  → 流恢复 / 终止
```

与 D1 帧注册表、D4 AG-UI 协议语义贯通（[锁定创作入口 IA 与载体扩展](../../.wayfinder/issues/xhs-08-lock-creation-entry-ia-and-carriers.md) Feedback log）。

### 3.4 #281 四个扩展点消费表

审计精确定位（`02-our-creation-surface-audit.md` §3.3）：

| # | 扩展点 | 代码定位（审计） | 本规格消费方式 |
| --- | --- | --- | --- |
| 1 | 确认门 lens/operation 过滤 | `apps/core/src/p1/harness/workflow-core.ts` L2972–2983（`confirmPaidGenerationExecution` **仅 media**）；回归 `workflow-core.test.ts` L2084–2118 | 改为「是否含付费媒体执行」；note 含批量配图必过；纯 copy 免确认 |
| 2 | e2e 合同与 D-043 文案 | `composer-card-family` 等（merge-ledger T31；审计 §3.3） | 更新：copy 主路径仍无额度确认；note/media 付费路径有流内确认 |
| 3 | 前端挂载条件 | `execution-confirm-card*.tsx`；`composer-home.tsx` 的 `execution-confirm-slot` | 改为流内 interrupt 呈现；挂载条件对齐付费媒体判定 |
| 4 | kind schema 全链 | `contentPackageKindSchema` 等（`packages/contracts/src/content-package.ts`） | 三枚举起步（P0/P1）；映射与迁移实施时定 |

### 3.5 对象工作区三件套（产品面必备）

对齐 xhswork 编辑体验（入口 IA 票追加）：

| 件 | 要求 |
| --- | --- |
| **富文本编辑器** | Tiptap；选区 AI（续写/改写/扩写/精简/语气/自定义）+ 违禁词内联替换；**只进对象工作区，不进 Composer**（C12 / 矩阵） |
| **笔记预览** | **手机样式嵌套**：完整手机壳内小红书笔记页所见即所得 |
| **封面预览** | **小红书 App 瀑布流样式嵌套**：自家封面嵌入模拟发现页双列瀑布流，供点击吸引力判断 |

---
## §4 九功能规格

裁决主源：[锁定 xhswork 功能 adopt/reject 矩阵](../../.wayfinder/issues/xhs-04-lock-adopt-reject-matrix.md)；代码映射：`01-xhswork-baseline-inventory.md`；对齐缺口：`02-our-creation-surface-audit.md` §6。

**总表**

| # | 功能 | 裁决 | 移植形态 |
| --- | --- | --- | --- |
| 1 | 一键图文生成 | **adopt** | 模式移植 |
| 2 | AI 封面 | **adopt** | 模式移植 + `cover_prompt_gen` 资产 |
| 3 | 爆款复刻 | **adapt** | 模式移植（取材双轨替换抓取） |
| 4 | 编辑器内 AI | **adopt** | 模式移植（Tiptap + 选区条） |
| 5 | 笔记生成 tone/role | **adapt** | 模式移植（美业语境选择器） |
| 6 | 违禁词检测+替换 | **adopt** | 表结构资产 + UI 模式；数据自建 |
| 7 | 深度思考开关 | **adopt**（小） | 模式移植 → 模型档位 |
| 8 | 参考图风格分析 | **adopt**（小） | 模式移植 + `style_analysis` 资产 |
| 9 | 扫码发布 | **reject** | — |

### 4.1 一键图文生成 — adopt

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt · 模式移植 |
| 产品面 | **完整多页编辑时间线**：大纲逐页可编辑 → 批量出图带状态 → 逐页重生；落**对象工作区**（C7），衔接 Result Inspector |
| 挂点 | Idle 配方「小红书图文」→ Active 时间线 → 确认卡（含付费媒体）→ Waiting → Delivered → 对象工作区逐页精修 |
| 依赖 | 复用 Harness NotePlan 编排（审计：编排在服务端五段，缺产品面时间线）；`outline`/`content`/`image_prompt_gen` prompt 资产（§6） |
| 参考 | xhswork 四段 pipeline：`01-…` §1.1 |

### 4.2 AI 封面 — adopt

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt · 模式 + `cover_prompt_gen` |
| 产品面 | 美业语境预设替换通用预设；比例 **3:4 / 1:1 / 9:16** 保留；封面预览走瀑布流嵌套（§3.5） |
| 挂点 | Delivered **次级动作** + 对象工作区工具；Idle **不**单独一级入口 |
| 依赖 | Core image provider；size 映射 **实施时定**（`01-…` §1.2）；审计 §6 缺独立 Cover 预设 |

### 4.3 爆款复刻 — adapt

| 项 | 口径 |
| --- | --- |
| 裁决 | adapt（[合规边界票](../../.wayfinder/issues/xhs-03-lock-link-parse-compliance-boundary.md)） |
| 移植 | AI 仿写与风格复刻 = 模式移植；**取材层整体替换为双轨**，不搬 `viralService.fetchNote` |
| 挂点 | 配方 chip → 补问卡双轨取材 → 确认卡**明示取材来源/规格** → 生成 |
| 依赖 | OpenCLI live 门（§5）；手动粘贴兜底；仿写/复刻图内联 prompt 实施时抽取（§6） |
| 红线 | 见 §5.3 |

### 4.4 编辑器内 AI — adopt

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt · 模式移植 |
| 产品面 | Tiptap + 选区工具条：续写 / 改写 / 扩写 / 精简 / 语气 / 自定义；**只进对象工作区**（C12） |
| 挂点 | 对象工作区；图文 / 笔记 / 文案三载体复用 |
| 依赖 | Tiptap（D4）；动作集合以矩阵票为准（对照 `01-…` §1.4 Plate 工具条） |
| 不做 | 不进 Composer 主输入 |

### 4.5 笔记生成 tone/role — adapt

| 项 | 口径 |
| --- | --- |
| 裁决 | adapt · 模式移植 |
| 产品面 | 前台选择器**美业语境化**（如美容师 / 店主 / 顾客口吻等）；MarketingIdentity = 默认值，选择器 = 显式覆盖 |
| 挂点 | 定制默认注入；自由创作显式选择（与 C5 一致） |
| 依赖 | `note_gen` 资产；与既有 note_style 合流 **实施时定**（审计 §3） |

### 4.6 违禁词检测 + 替换 — adopt

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt · 结构资产 + UI 模式 |
| 产品面 | 生成链自动步骤 + 交付检查条 + 工作区扫词与**内联替换建议** |
| 挂点 | 生成期与红线门合流共库；编辑期 SensitiveCheck 式 UI（`01-…` §1.6 / §3） |
| 依赖 | 美业自建词库（**不搬** 31 条示范 seed）；`sensitive_words` 结构 word+category+replacements[]；运营 CRUD |
| 初版数据 | 起草+人工校（地图 Not yet；矩阵口径） |

### 4.7 深度思考开关 — adopt（小）

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt（小）· 模式移植 |
| 产品面 | **自由创作显露、定制创作隐藏**（两方案共识） |
| 挂点 | 自由创作展开区；不进 Idle 主轴 |
| 依赖 | 映射既有模型档位，不另建开关；thinking 参数 **实施时定** |

### 4.8 参考图风格分析 — adopt（小）

| 项 | 口径 |
| --- | --- |
| 裁决 | adopt（小）· 模式 + `style_analysis` |
| 产品面 | 独立风格分析步骤（七维），输出供批量配图风格一致性复用 |
| 挂点 | Composer @素材 → 时间线阶段说明 |
| 依赖 | 多模态 + `style_analysis`；衔接 `composer-image-input`（审计 §6 部分能力） |

### 4.9 扫码发布 — reject

| 项 | 口径 |
| --- | --- |
| 裁决 | **reject** |
| 理由 | 发布/分发域出本图范围；xhswork 依赖第三方 `myaibot.vip`（`01-…` §5）不可移植 |
| 产品出口 | Delivered / 对象工作区仅 **「导出/发布准备」占位**，不承诺分发合同 |
| 备查 | OpenCLI `xiaohongshu publish` 供未来分发域立项（§1.3） |

### 4.10 挂点总览（八功能；reject 除外）

| 功能 | Idle | Active / 时间线 | Delivered / 工作区 |
| --- | --- | --- | --- |
| 一键图文 | 图文配方 | 多页时间线 + 确认 | 对象工作区精修 |
| AI 封面 | — | — | 次级动作 + 工具 |
| 爆款复刻 | 配方 chip | 补问双轨取材 + 确认 | 成品卡 |
| 编辑器内 AI | — | — | Tiptap 选区条 |
| tone/role | 分段器语境 | 身份/选择器 | — |
| 违禁词 | — | 生成链步骤 | 检查条 + 扫词 |
| 深度思考 | — | 自由展开区 | — |
| 风格分析 | @素材 | 阶段说明 | 约束注入配图 |

---

## §5 合规边界

权威：[裁决爆款复刻链接解析的合规边界](../../.wayfinder/issues/xhs-03-lock-link-parse-compliance-boundary.md)；xhswork 抓取事实：`01-…` §4。

### 5.1 双轨取材

| 轨 | 形态 | 条件 |
| --- | --- | --- |
| **主路径** | OpenCLI 登录态通道 | 本机 OpenCLI（票面记载 v1.8.6 实测在位）`rednote` / `xiaohongshu` 适配器；`note`（正文+互动）、`download`（图视频）、`comments`、`search` 覆盖取材；输入 = 用户分享的完整笔记链接（带 xsec_token）；机制 = 用户自有浏览器登录态读页面水合（Pinia store）+ UI 自动化 |
| **兜底** | 手动粘贴 | 用户粘贴笔记文字 / 上传图片；覆盖无浏览器环境或扩展掉线；**live 门未过期间为先行形态** |

### 5.2 live 实测门（主路径转正条件）

- **一次核销**：真实账号跑通 OpenCLI `note` + `download` 后，登录态通道方可转正为默认主路径。
- 票面记载：当时 daemon 在跑但 Chrome 扩展未连接，冒烟留给 live 门——实施验收须重跑核销，不以历史状态代替绿集。

### 5.3 永不采用红线

| 红线 | 说明 |
| --- | --- |
| 服务端匿名抓取 | 含 xhswork `viralService.js` `fetchNote` 模式：裸 `fetch` HTML、UA 伪装、无 Cookie 解析 `og:*` / `__INITIAL_STATE__`（`01-…` §4） |
| 逆向签名 | 破解 x-s 等协议签名 |
| 账号池 / 云端集中登录态 | 多账号集中托管代登 |

### 5.4 对产品与矩阵的约束

- 爆款复刻 = **adapt**，不搬抓取代码。
- 确认卡 / 补问卡须让用户理解取材方式（登录态读自己的浏览器 vs 粘贴）。
- 仿写 LLM 本身合规；风险在**未授权抓取**，故取材层整体替换。

---

## §6 资产移植清单

来源：矩阵票 Resolution + `01-…` §2–§3。

### 6.1 六 prompt 文件

| 文件（xhswork `server/prompts/`） | 用途 | 处置 |
| --- | --- | --- |
| `outline.js` | 一键大纲 | 美业语境改写 → Langfuse 版本化挂接（D-036） |
| `content.js` | 一键正文 | 同上 |
| `note_gen.js` | 笔记生成 | 同上 |
| `image_prompt_gen.js` | 配图英文 prompt | 同上 |
| `cover_prompt_gen.js` | 封面 prompt | 同上 + 美业预设替换 |
| `style_analysis.js` | 参考图七维分析 | 同上 |

挂接参考 `langfuse-prompts.ts` `HARNESS_PROMPT_SITES`（审计 §4.3）；新位点命名 **实施时定**；原则：版本化 + fallback，禁生产内联基础提示词漂移。

### 6.2 四处内联 prompt（实施时抽取评估）

| 位置（xhswork） | 内容 |
| --- | --- |
| `viralService.rewriteNote` | 爆款仿写 JSON 协议 |
| `viralService.replicateImages` | 图片复刻 vision 分析 |
| `FloatingToolbar.tsx` | AI 编辑 6 动作 |
| `editorController.aiAssist` | 前端 prompt 直拼、无系统模板 |

评估后决定：进 Langfuse 位点 vs 对象工作区本地模板；**不得**原样复制未改写的通用语境。

### 6.3 违禁词库

| 项 | 口径 |
| --- | --- |
| 结构移植 | `sensitive_words(word, category, replacements[], status…)`；分类 extreme/medical/cosmetic/finance/legal/vulgar/other（`01-…` §3） |
| 数据 | **不搬** seed 31 条；**美业专项自建** + 人工校 |
| 合流 | 生成期**红线门**与编辑期扫词**共库**；红线现状为 promptfoo + `policy-gates`（审计 §4.4），≠ 运营词库 CRUD 产品面 |
| 运营 | CRUD；批量导入 UI 是否做 **实施时定**（xhswork Admin 有 API 无 UI） |

### 6.4 计费颗粒度参考（不改我方计费模型）

xhswork 按操作扣分（大纲 / 配图 / 正文 / 封面各自 `consume*`，`01-…` §1 / §7）记入规格，供 **entitlement / quote 映射参考**；本规格**不**改我方 usage/cost 模型。映射表 **实施时定**。

---

## §7 技术边界

来源：D4（[锁定工作台 Agent 化目标形态](../../.wayfinder/issues/xhs-05-lock-agent-workbench-form.md)）；依赖事实：`03-…` D4/F11/F19/F20。

### 7.1 零新 runtime

- **不**引入 AG-UI / assistant-ui / CopilotKit **runtime** 替换 DBOS / Task / ContentPackage / Harness 真相链（C11）。
- 对话头已有 AG-UI 三层注释语境（`composer-conversation.tsx`，`03-…` D4）— 继续**抄协议语义**（含 interrupt），不换内核。

### 7.2 依赖裁决表

| 依赖 | 裁决 | 备注 |
| --- | --- | --- |
| `ai@7`（AI SDK） | **真依赖**（已在用） | `package.json` `ai@7.0.19`；`@ai-sdk/react@4.0.23` 不同轨（F19）— 勿写成「全套 7」 |
| Motion | **真依赖** | 已装；四态 / morph 用 layout |
| cmdk | **真依赖** | 配方「更多」/ 命令面板 |
| HeroUI / HeroUI Pro Chat 族 | **真依赖** | 壳 + 对话容器；创作卡家族仍大量 shadcn（审计 §5）— 升级随工作台改动渐进 |
| react-resizable-panels | **转正 Result Inspector** | 依赖已装、产品路径未引用（F11/F12）；**首页不做可拖三栏** |
| Tiptap | **引入，限对象工作区** | 与编辑器内 AI adopt 对齐；不进 Composer |
| AG-UI | **只抄协议** | interrupt / envelope 映射 |
| assistant-ui | **只抄模式** / 可拷贝组件片段 | 禁完整 Thread Runtime |
| CopilotKit | **零依赖**，文档参考 HITL 分界 | — |

### 7.3 UI 实现基线

用户指定（地图 Notes + 原型 Feedback）：

1. **HeroUI Pro AI showcase** 模板（template-chat.heroui.pro/pro-ai-showcase）
2. **assistant-ui** 示例（assistant-ui.com/examples/ai-sdk）

用于 Idle 层级、Composer 胶囊底栏、消息/时间线视觉语法；**不是**引入其服务端 runtime。

### 7.4 主链与挂点（实施锚点，非新决策）

| 层 | 路径锚点（审计） |
| --- | --- |
| Dashboard 三段 | `product/composer/composer-home.tsx` |
| 对话 / 70svh 双滚动 | `composer-conversation.tsx` `max-h-[min(70svh,44rem)]`（F7） |
| 推荐硬编码 copy | `composer-home.tsx` `selectLens(..., 'copy')`（F1） |
| 执行确认槽 | `execution-confirm-slot` / `execution-confirm-card*` |
| 交付卡 | `composer-delivery-card.tsx` |
| 继续工作 | `dashboard-continue-section.tsx` |
| 记忆页 | `memory-vault-page.tsx`（JSON.stringify F9） |
| 导航真源 | `lib/uiux/navigation.ts` `BUSINESS_NAVIGATION` |
| Harness 五段 | `apps/core/src/p1/harness/workflow-core.ts` |
| CP 契约 | `packages/contracts/src/content-package.ts` |

---
## §8 分期实施

分期尊重已锁分配（工作台形态票 D3/D5/D6/D7 + 入口 IA 票 kind 起步）。每期验收门为**可验证绿集描述**；未列命令处允许实施票补精确 suite 名，但行为断言不可空。

### 8.1 P0 — 诚实修复 + 合同起步

| 项 | 内容 | 来源 |
| --- | --- | --- |
| Active 折叠 | 任务进行中折叠推荐与「继续」段，释放纵向空间 | D3；F6 |
| 双滚动修复 | 去掉对话区 `70svh` 与页面双滚动打架；单一滚动主轴 | D3；F7 |
| 交付去重 | candidate 完成后收起为摘要/一行胶囊；交付卡不重复贴全文 excerpt | D7；F8 |
| 推荐卡硬编码 copy | 去掉 `selectLens(...,'copy')` 硬编码；类型化 handoff 预填正确 lens | D2；F1 |
| 记忆去 JSON + 待确认 | `memory-vault-page` 非 string 不用 `JSON.stringify` 糊用户；默认待确认优先；冷启动诚实空态文案 | D5；F9 |
| kind 三枚举合同起步 | contracts / 核心读写路径承认 media·copy·note 口径（或等价映射落地）；纯 copy 仍免确认 | §3；#281-4 |

**P0 可不含**：双栏、Composer 粘底 morph、完整 Activity Shelf、完整多页时间线、Tiptap 全量、OpenCLI 主路径（live 门未过时允许仅粘贴轨）。

#### P0 验收门

| # | 可验证断言 |
| --- | --- |
| P0-1 | 提交进入 running/Active 后，推荐卡与继续段**不可同时占满首屏**（折叠或等价隐藏可测） |
| P0-2 | 对话长内容场景：无「内层 70svh + 外层页面」双重滚动（手动或 e2e 滚动容器数断言） |
| P0-3 | 同一候选完成后，UI **不**并排完整 candidate 正文 + 交付卡全文 excerpt；交付为主摘要 |
| P0-4 | 推荐 onUse / handoff **不得**无条件预填 copy lens；有 outputHint 时尊重 hint（单元或 interaction） |
| P0-5 | 记忆页展示：非 string 字段不以原始 JSON 字符串作为商家主文案 |
| P0-6 | kind 契约：三枚举（或映射）类型检查绿；`confirmPaidGenerationExecution` / 等价门对「纯 copy」仍无 pre-run hold，对「含付费媒体」有 hold（core 回归） |
| P0-7 | 触达路径 typecheck + 相关 web interaction/聚焦 e2e 绿（suite 实施票列） |

### 8.2 P1 — 工作台壳 + 图文主体

| 项 | 内容 |
| --- | --- |
| 双栏 | 桌面事件流 \| 上下文/Inspector；移动端右栏 Bottom Sheet 等价 |
| Composer 粘底 morph | Active 后 Composer 粘底；避让 mobile-nav `4.25rem`（F13） |
| Activity Shelf 完整版 | ≤3 对象卡：缩略图 / 状态 / 下一步；横排大留白 |
| 记忆三层页 | 待你确认 → 已记住（域）→ 证据抽屉 |
| 多页编辑时间线主体 | 大纲可改 + 批量出图状态 + 逐页重生（一键图文产品面） |
| 宽度 800/1240 | 对话/媒体态切换生效 |
| 流内 interrupt 确认 | plan.ready → execution_confirm → 确认后恢复（§3.3） |
| note 付费媒体过卡 | note 批量配图必过确认卡 |

#### P1 验收门

| # | 可验证断言 |
| --- | --- |
| P1-1 | 桌面宽度 ≥1240 时 Active/Delivered 可出现双栏或 Inspector 分栏（resizable 允许） |
| P1-2 | Active 态 Composer 粘底；移动端不被底栏永久遮挡发送按钮 |
| P1-3 | Activity Shelf 最多 3 卡；每卡含状态 + 至少一下一步动作入口 |
| P1-4 | 记忆页 IA 可见三层（待确认默认在上） |
| P1-5 | 图文 note 旅程：时间线可编辑 ≥1 页大纲并触发配图状态展示（fixture/录制路径可） |
| P1-6 | 含付费媒体：流内出现确认 interrupt，拒绝则零扣费（core + e2e） |
| P1-7 | 媒体展开主列可达 ~1240；纯对话态 ~800（样式合同或 snapshot） |
| P1-8 | typecheck + composer/image-text/dashboard-home 相关 e2e 绿 |

### 8.3 P2 — 经验化与能力收齐

| 项 | 内容 |
| --- | --- |
| 记忆改名「经验」 | 前台文案；路由可仍 `/dashboard/memory` |
| 任务内三处露出 | 执行前依据 / 交付后沉淀 / 纠错分流（方案二；依赖 producer 就绪度，无 producer 时诚实空态） |
| 对象工作区三件套齐 | Tiptap 选区 AI + 手机嵌套笔记预览 + 瀑布流封面预览 |
| AI 封面 / 违禁词 UI / 风格分析七维 | 按 §4 挂点收齐 |
| 爆款复刻主路径 | OpenCLI live 门核销通过后转正；粘贴轨保留 |
| 深度思考 | 自由创作显露映射档位 |
| 交付 morph | candidate→delivery 原位动画（D7 P1 可提前，最晚 P2） |

#### P2 验收门

| # | 可验证断言 |
| --- | --- |
| P2-1 | 一级导航商家可见文案为「经验」（或产品文案合同测试锁定） |
| P2-2 | 对象工作区：选区 AI 至少 3 个动作可测；笔记预览含手机壳 DOM/role；封面预览含双列瀑布流容器 |
| P2-3 | 违禁词：样本文案可检出并给出 replacements 建议（fixture 词库） |
| P2-4 | 爆款：live 门证据文件/记录存在后，链接主路径可用；未过门时仅粘贴可用且文案诚实 |
| P2-5 | 相关 e2e + core 回归绿；无新增一级导航 |

### 8.4 硬序

- P0 ≺ P1 ≺ P2（可多 PR，合并序尊重阶段）
- kind 合同与确认门逻辑建议 **P0 起步、P1 流内呈现与 note 过卡闭环**
- Tiptap / 三件套允许 P1 骨架、P2 齐装，但 **不得** 先把编辑器塞进 Composer
- OpenCLI 主路径 **不得** 在 live 门未核销时对用户标为「已可用」

### 8.5 回滚

- 分阶段 git revert；P0 UI 可独立回滚。kind 写库后的迁移/回滚策略 → **实施时定**（PR 须写明）。

---

## §9 改动约束面与文档同步清单

### 9.1 入口 IA / 工作台改动约束面

改 IA 或工作台壳时须同步评估（审计 `02-…` **§7**，勿只改单 route）：

#### 路由

| 约束 | 路径 |
| --- | --- |
| 文件式路由 | `mkfast-template-main/src/routes/dashboard/**` |
| 生成树（勿手改） | `routeTree.gen.ts` |
| 布局 | `routes/dashboard.tsx` |
| 工作台 search 合同 | `routes/dashboard/index.tsx`（taskId / catalog* / workId 等） |
| legacy 重定向 | `content.tsx`、`tasks.tsx`、深链 content_/tasks_ |
| 路径常量 | `lib/routes.ts` |
| legacyRedirects | `lib/uiux/navigation.ts` |

#### 导航

| 约束 | 路径 |
| --- | --- |
| 一级导航真源 | `BUSINESS_NAVIGATION`（`navigation.ts`） |
| 侧栏 | `sidebar-config.ts`、`dashboard-sidebar.tsx` |
| 移动底栏 | `mobile-nav.tsx` |
| 命令面板 | `global-command-model.ts` |
| 产品文案合同 | `lib/product-surface-contract.test.ts` |

#### e2e 族（文件清单见审计 §7.3；实施时按触达选用）

重点：`dashboard-home-mount`、`uiux-day0-contract`、`uiux-creation-loop`、`uiux-shell-routes`、`composer-card-family`、`composer-reshell`、`marketing-composer-harness`、`image-text-note-compiler`、`memory-vault-governance`、`mobile-product-shell`、`p0-golden-journey`、`catalog-live-navigation` 等。

#### 契约与 Core

- `packages/contracts`：`creation-experience.ts`、`harness.ts`、`content-package.ts`、`note-plan.ts`
- Core：`workflow-core` 确认门、launch-seeds 配方、Langfuse 位点表

### 9.2 权威文档同步（实施阶段，非本文件批改）

本规格闭合后，实施/文档 lane 应评估 rewrite 或指针（**列出待同步，不在本规格会话修改它们**）：

| 文档 | 同步意图 |
| --- | --- |
| `CONTEXT.md` | 工作台四态 / note 载体 / 禁止 xhs 匿名抓取 |
| `PRODUCT.md` / `DESIGN.md` | 入口 IA、对象工作区三件套、经验改名节奏 |
| `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` | 新 D 摘要指针本规格；旧 D 正文不改写装成新法 |
| `docs/ops/merge-ledger.md` #281 行 | 指向本规格已收编 |
| 两版 codex 方案 md | banner：对撞结论以本规格 + xhs-05 为准 |
| `mkfast-template-main/tests/e2e/TEST-CATALOG.md` | 新旅程/确认 interrupt / note 合同 |
| `AGENTS.md` / web `AGENTS.md` | 实施约束：零新 runtime、Tiptap 边界、合规红线 |

正式决策日志 D 号 → **实施时定**。

---

## §10 术语与收尾

### 10.1 术语表

| 术语 | 定义 |
| --- | --- |
| **模式移植** | 按能力步骤/交互在本仓重实现；不复制 xhswork 源码树 |
| **资产移植** | prompt 模板、表结构等文本/schema 经美业改写后挂接 |
| **adapt** | 模式可融，但关键层替换（如爆款取材双轨） |
| **reject** | 本图不做（扫码发布） |
| **四态** | Idle / Active / Waiting / Delivered |
| **文档时间线** | Agent 阶段全宽文本/rail + 补问/确认/成品全宽卡；非气泡主导 |
| **AgentFrame** | 实现层帧注册表（六族映射既有 turn kinds） |
| **Activity Shelf** | Idle 区 ≤3 张对象卡（缩略图/状态/下一步） |
| **对象工作区** | Result Center / works 精修面；承载编辑器三件套 |
| **note** | ContentPackage kind：页组+封面+正文的图文复合成品 |
| **live 实测门** | OpenCLI 真实账号 note+download 一次核销 |
| **#281 收编** | copy/note 确认与 kind 扩展由本规格正主消费 |

### 10.2 明确不做（重申）

- 匿名抓取 / 逆向签名 / 账号池  
- 新一级导航挂 XHS 工具货架  
- Composer 内嵌重编辑器 / 工具市场首页  
- 替换 DBOS·Task·ContentPackage 真相链  
- 本图内兑现分发合同或商业积分体系搬迁  
- 地图会话改生产代码  

### 10.3 实施时定清单（材料未锁，禁止脑补）

1. note 字段级 schema（页组/封面/正文）与历史 `image_text` 迁移策略  
2. 美业违禁词初版数据起草与人工校流程细节  
3. 多图批量成本/并发/供应商适配参数  
4. entitlement 与 xhswork 按操作计费的映射表  
5. 新 Langfuse 位点命名与 14 位点表扩展方式  
6. 正式决策日志 D 号  
7. OpenCLI 生产安装/daemon 运维拓扑  

### 10.4 证据索引

| 类型 | 路径 |
| --- | --- |
| 地图 | `.wayfinder/map-xhs-vertical-integration.md` |
| 关闭票 | `.wayfinder/issues/xhs-01` … `xhs-05`、`xhs-07` … `xhs-09`（xhs-06 = 本规格） |
| 研究报告 | `references/analysis/xhswork-integration-2026-08-01/01|02|03-*.md` |
| 原型 | 同目录 `04-workbench-prototype.html`、`05-entry-ia-prototype.html` |
| 先例 | `docs/specs/pro-studio-retirement-spec-2026-08-01.md` |

### 10.5 下一步

1. 关闭 produce 票（xhs-06），以本文件为唯一规格交付物。  
2. 另开实施：按 **P0 → P1 → P2** 拆 PR，对照本章验收门。  
3. 实施前完成 §9.2 最小文档指针（CONTEXT + #281 ledger + 方案 banner）。  
4. 爆款主路径在 live 门证据齐全后再标「已转正」。  

---

## §11 开发纪律与留痕（实施批 #313–#328）

实施票：P1 = [#313](https://github.com/legacy-origin-a/legacy-web-repo/issues/313)–[#319](https://github.com/legacy-origin-a/legacy-web-repo/issues/319)，P2 = [#320](https://github.com/legacy-origin-a/legacy-web-repo/issues/320)–[#328](https://github.com/legacy-origin-a/legacy-web-repo/issues/328)（编号即开发顺序；票上原生 blocked-by 边为机器判据）。通用纪律全文以 `docs/ops/agent-dispatch-runbook-2026-07-29.md` 为准（环境铁律／关票纪律／受阻轮询协议全部适用），与 `docs/specs/credit-billing-spec-2026-08-01.md` §11 同构；本节只列本效力面的收束，冲突时以手册为底、本节为特化。

### 11.1 角色与主权

- **开发 = lane agent**：一票一 lane 一 worktree 一分支（`git worktree add ../lane-<票号> main`）。票面即任务书，票下「主控裁决／依赖更新／主控合同增补」前缀评论覆盖票面原文。
- **总控 = 主控会话**：验收、合入 main、关票、修订本规格的唯一主权方。lane **不 push、不关票、绝不移动 main**、绝不以「主控」前缀发评论；「已合入」唯一有效凭证 = `docs/ops/merge-ledger.md` 出现对应 sha 行。
- **决策冲突序**：本规格终稿 > wayfinder 票 Resolution > 票面文字。发现冲突落票下评论并停下问主控，不得自行扩边界。

### 11.2 开工与依赖

- 开工顺序 = §8.4 硬序 + 票上 blocked-by 边：P0 收口（#286/#287/#288，PR #296 合入 main）为全批总前置；P2 票（#320–#328）合入不得先于 P1 验收门（P1-1 至 P1-8）齐验。
- 被阻塞票未解锁（阻塞票未关）不得开工，只准做零 rebase 面预备（schema 草案／只读盘点／设计稿）。

### 11.3 留痕（多 Agent 交接防信息丢失）

- **认领即留痕**：领票评论注明 worktree 路径、分支名、开工基线 sha；关键节点（方案定案、受阻、交底文档落点）逐条评论，不得只留在 agent 会话内。
- **「实施时定」项（§10.3）定案必须评论留痕**并写入交底文档；只写会话不算数。
- **交验 = 票下评论逐条对应票面验收断言**，附运行证据（file:line／命令输出／测试真实计数）；四门齐备：消费者证明（D-150）／可达性证明／出口证明（含负向）／反向复核（D-157 双向）。

---

**本规格为「XHS 图文专项融合 + 全局 Agent 化 UI/UX 升级」地图 Destination 的权威闭合文档。** 九票决议、合规双轨、工作台四态、载体三枚举与分期绿集均已写入；实施另开 lane，不以本文件代替代码变更。规格正文至此完整收束。
