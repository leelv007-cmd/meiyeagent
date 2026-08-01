# Issue #315 P1-03 — 六 prompt 美业改写与 Langfuse 位点挂接交底

| Field | Value |
| --- | --- |
| Issue | #315 |
| Spec | `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §6.1 / §6.2 / §10.3-5 |
| Code | `apps/core/src/p1/harness/langfuse-prompts.ts` |
| Tests | `apps/core/src/p1/harness/langfuse-prompts.test.ts` |
| Date | 2026-08-01 |

## 1. 新位点命名与 14 位点表扩展方式（本票定案）

### 1.1 扩展方式

**单一扁平注册表扩展，不建第二套 resolver 表。**

| 项 | 定案 |
| --- | --- |
| 注册表 | 继续唯一 `HARNESS_PROMPT_SITES` |
| 历史核心 | `HARNESS_CORE_PROMPT_KEYS` = 14（D-149 不变） |
| 本票增量 | `XHS_VERTICAL_PROMPT_KEYS` = 6 |
| 总位点 | `HARNESS_PROMPT_SITE_COUNT` = **20** |
| 解析器 | `LangfuseHarnessPromptResolver` 对全表统一 strict pin / pilot fallback |
| 能力轴 | 新位点默认 `structured-output` + `text/plain`；`xhsStyleAnalysis` 多模态经 `harnessPromptCapabilityRequirement(key, { referenceImage: true })` 动态加 `image/*` |
| copy 准入 | `task-admission` copy-lens **仍只 pin `HARNESS_CORE_PROMPT_KEYS`（14）**；XHS 垂直位点待 pipeline 接线票显式声明，避免无消费者撑大每次 copy 路由轴 |

### 1.2 命名

| Key | Langfuse name | 源资产（xhswork） |
| --- | --- | --- |
| `xhsOutline` | `harness/xhs-outline` | `server/prompts/outline.js` |
| `xhsContent` | `harness/xhs-content` | `server/prompts/content.js` |
| `xhsNoteGen` | `harness/xhs-note-gen` | `server/prompts/note_gen.js` |
| `xhsImagePrompt` | `harness/xhs-image-prompt` | `server/prompts/image_prompt_gen.js` |
| `xhsCoverPrompt` | `harness/xhs-cover-prompt` | `server/prompts/cover_prompt_gen.js` |
| `xhsStyleAnalysis` | `harness/xhs-style-analysis` | `server/prompts/style_analysis.js` |

原则：`harness/` 前缀保持推送/钉扎通道一致；`xhs-` 段区分垂直资产，避免与 `note-plan` / `copy-generation` 等核心位点语义撞车。

### 1.3 运维注意（合入后）— 全表 freeze 可用性耦合（有意保留）

`LangfuseHarnessPromptResolver.resolve()` **仍一次性冻结全部 20 位点** 写入每次 admitted task 的 `prompts` / `promptRevisionRefs`（与能力轴 copy 只 pin 14 是两条线）：

| 面 | 范围 | 说明 |
| --- | --- | --- |
| copy 能力轴 pin | 核心 14 | `task-admission` 不把 `xhs*` 塞进 route requirements |
| prompt resolve / strict pin | **全 20** | 单一注册表 + 统一 pin 政策（D-036 / D-149 扩展）；缺任一 XHS pin 在 strict 下会 **boot 或 admission resolve 失败** |

这是本票有意设计，**不做** selective freeze 范围拆分（留给未来若运维成本过高再开票）。

strict 部署 **强制**：

1. `pnpm --filter @meiye/core langfuse:prompts:push` 推送含 6 新位点的 builtin 正文；
2. `LANGFUSE_PROMPT_VERSIONS` JSON **补齐全部 20 key**（缺任一 key → strict boot / resolve 失败关闭）。

pilot 本地未配置时 6 新位点自动 `builtin-v1` fallback（已单测）。

---

## 2. 六 prompt 美业改写差异对照表

| 位点 | 源通用语境（xhswork） | 美业改写要点（本仓 builtin） | 保留协议 |
| --- | --- | --- | --- |
| `xhsOutline` | 「任意主题」信息图策划；示例为京都穷游/旅行贴纸 | 角色改为美业门店图文策划；转化钩子（到店/预约/肤质）；合规禁极限医疗承诺；示例改为夏日控油三步护理 | `<page>` / `[封面\|内容\|总结]` / `{topic,pageCount,category,styleAnalysisBlock}` |
| `xhsContent` | 泛小红书爆款文案专家 | 美业门店转化；顾问/店长语气；禁虚假疗效；标签偏项目/肤质 | `【标题】/正文/【标签】`；标签**不加 #**、空格分隔 / `{topic,outline,category}` |
| `xhsNoteGen` | 泛爆款笔记 + tone/role | 明确美容师/店主/顾客口吻；门店转化与事实边界 | **与 xhsContent 同一标签协议**（不加 #、空格分隔） / `{topic,tone,roleBlock}` |
| `xhsImagePrompt` | 泛视觉总监 + 旅游美食决策树 | 美业静物/柔光/知识卡；禁血腥手术实景；negative 增 medical wound | 英文 prompt + 中文图上字 / 原占位符集 |
| `xhsCoverPrompt` | 5 通用预设：xiaohongshu/minimal/collage/gradient/photo | **美业预设替换**：`beauty_soft` / `beauty_editorial` / `before_after` / `spa_minimal` / `salon_photo` | `{userPrompt,style,size}` |
| `xhsStyleAnalysis` | 通用七维视觉分析 | 美业可复用词表（门店台面、产品剪影、轻医美科普风）；面部只描述光线构图 | 七行中文冒号协议 |

**禁漂移**：builtin 不得保留「京都穷游 / 冰岛极光 / 迪拜奢华」等未改写通用示例作主叙事；由 core 单测锁定。

---

## 3. 四处内联 prompt 评估裁决

来源：规格 §6.2 + inventory §2。

| # | 源位置 | 内容 | 裁决 | 理由 | 消费票 |
| --- | --- | --- | --- | --- | --- |
| 1 | `viralService.rewriteNote` | 爆款仿写 JSON 协议 | **进 Langfuse 位点**（后续注册，本票不扩 key） | 服务端结构化生成、需版本钉扎与审计哈希；属生产基础提示词 | P2-12 爆款复刻接线时挂 `harness/xhs-viral-rewrite`（建议名，接线票可微调） |
| 2 | `viralService.replicateImages` | 图片复刻 vision 分析 | **进 Langfuse 位点**（后续） | 多模态系统模板，宜 pin；与 `xhsStyleAnalysis` 不同（复刻导向英文生图 prompt） | P2-12 → 建议 `harness/xhs-viral-image-vision` |
| 3 | `FloatingToolbar.tsx` 6 动作 | 润色/扩写/缩写/改语气/生标题/翻译 | **对象工作区本地模板** | 短动作指令、绑定选区 UI、非 Harness 主链；随 Tiptap 选区条共置 | P2-10 对象工作区选区 AI |
| 4 | `editorController.aiAssist` | `` `${prompt}\n\n${selectedText}` `` 无系统模板 | **本地编排，不单独占 Langfuse 基础位点** | 无独立基础模板；动作模板来自 #3；禁止把商家自由输入当「不可钉扎系统提示词」写进生产链 | P2-10；Core 侧若代理选区 AI，只冻结动作模板 id，不冻结用户自定义句 |

本票**不**把 1/2 注册进 `HARNESS_PROMPT_SITES`，避免无消费者的空位点撑大 strict pin 面；裁决已锁定，接线票按上表挂接。

---

## 4. 验收映射

| 票面验收 | 证据 |
| --- | --- |
| 新位点均有版本化与 fallback（core 单元） | `langfuse-prompts.test.ts`：`XHS vertical sites resolve with version pin and pilot builtin fallback` |
| 生产链无内联基础提示词漂移 | 同文件 `production base prompts must come from the registry (anti-drift)` + 美业改写非通用克隆测 |
| 六 prompt 美业改写差异对照表写入交底 | 本文 §2 |
| 位点命名与 14 表扩展定案 | 本文 §1 |
| 四处内联评估裁决 | 本文 §3 |
| core 回归绿 | 见实施 summary 命令计数 |

---

## 5. 非本票范围

- 不接线 outline/content 生成 pipeline / NotePlan 产品时间线（P1 其他票）。
- 不实现爆款复刻 / Tiptap 选区 AI 运行时（P2）。
- 不引入 AG-UI / assistant-ui / CopilotKit runtime。
- 不搬 xhswork 抓取代码；不提交 `references/` 资产。
- 不做 selective freeze（全 20 resolve 有意保留；见 §1.3）。

---

## 6. 票下留言草稿（供主控/编排发帖；lane 不 push、不关票）

> 以下两段为 **可直接粘贴** 的 issue #315 评论正文（markdown）。编排在 0 open review 后发帖即可完成 §11.3 留痕。

### 6.1 认领评论（claim）

```markdown
## 领票留痕（#315 / P1-03）

- **worktree**: `/Users/bin/orca/workspaces/美业内容2/lane-315`
- **branch**: `leelv007-cmd/lane-315`
- **开工基线 sha**: `08288ac50f98c5a12544dc6554b2dd27b3204a9f`
- **实现 commit**: `66f156fa67ae8277e47e31f53d0cc177b778b074`（首版）+ `20ea32cd7d7e21b335464c0a0b20537e26b22ec6`（复核修复）
- **范围**: 六 prompt 美业改写挂 `HARNESS_PROMPT_SITES`；四处内联评估写交底；不接线 pipeline 运行时

交底：`docs/handoff/issue-315-xhs-prompt-sites-2026-08-01.md`
```

### 6.2 实施时定 + 交验评论（verification / leave-trace）

```markdown
## 方案定案 + 交验（#315）

### A. 「实施时定」闭合（规格 §10.3-5）

**14 位点表扩展方式（定案）**：单一扁平注册表扩展，不建第二 resolver。

| 项 | 值 |
| --- | --- |
| 注册表 | 唯一 `HARNESS_PROMPT_SITES` |
| 核心 | `HARNESS_CORE_PROMPT_KEYS` = 14（D-149） |
| 增量 | `XHS_VERTICAL_PROMPT_KEYS` = 6 |
| 总计 | `HARNESS_PROMPT_SITE_COUNT` = **20** |
| 解析 | 全表统一 strict pin / pilot fallback |
| copy 能力轴 | 仍只 pin 核心 14（`task-admission`） |
| resolve 冻结 | **仍冻全 20**（有意可用性耦合；合入前必须 push+pin 6 新 key） |

**命名表**

| Key | Langfuse name |
| --- | --- |
| xhsOutline | harness/xhs-outline |
| xhsContent | harness/xhs-content |
| xhsNoteGen | harness/xhs-note-gen |
| xhsImagePrompt | harness/xhs-image-prompt |
| xhsCoverPrompt | harness/xhs-cover-prompt |
| xhsStyleAnalysis | harness/xhs-style-analysis |

交底全文：`docs/handoff/issue-315-xhs-prompt-sites-2026-08-01.md` §1–§3。

### B. 四处内联 prompt 裁决摘要

| 源 | 裁决 | 消费票 |
| --- | --- | --- |
| viral rewrite JSON | 后续 Langfuse（本票不注册空 key） | P2-12 |
| viral image vision | 后续 Langfuse | P2-12 |
| FloatingToolbar 6 动作 | 对象工作区本地模板 | P2-10 |
| aiAssist 直拼 | 本地编排，不占基础位点 | P2-10 |

### C. 票面验收 → 证据

| 验收 | 证据 |
| --- | --- |
| 新位点版本化 + fallback | `apps/core/src/p1/harness/langfuse-prompts.test.ts` — `XHS vertical sites resolve with version pin and pilot builtin fallback` |
| 禁漂移 | 同文件 anti-drift + beauty rewrite non-clone；tag 协议 content/note 对齐（均无 `#`） |
| 六 prompt 差异对照表 | 交底 §2 |
| 命名/扩展定案 | 交底 §1 + 本评论 A |
| 四处内联裁决 | 交底 §3 + 本评论 B |
| core 回归 | `langfuse-prompts` + `task-admission` focused 绿；全量非 PG unit 2670 pass / 0 fail（首版） |

### D. 运维红线（合入前）

1. `pnpm --filter @meiye/core langfuse:prompts:push`
2. `LANGFUSE_PROMPT_VERSIONS` 补齐 **全部 20 key**（strict 缺一即失败）

lane 不 push、不关票；「已合入」以 merge-ledger 为准。
```
