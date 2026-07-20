# 09 · 轻量可视化编排快评 + 自建「非代码可变层」路线评估

> **交叉验证裁定（Codex，2026-07-17）：成立但需实质修正（自建主线成立且**本仓已有 admin-config 修订系统（apps/core/src/p1/admin-config/，CAS+审计+回滚+secret 拒绝）应扩展复用而非另建**；Flowise 论据需改写、与 Langflow 证据强度分开；n8n「所有客户可见功能须 Embed」被官方 FAQ 推翻、改四类边界；Windmill AGPL 合规路线存在、「仅范式」是产品策略非许可必然）** — 全文见 `xcheck/r09-xcheck.md`；引用本报告断言前先对照裁定。

> 调研员：harness-visual-light-and-build-own ｜ 日期：2026-07-17
> 方法：本地源码镜像（`references/repos/harness-2026-07-17/`）第一手核实 + 联网核实活跃度/CVE/许可解读。
> 标注约定：**【官方核实】**=直接读源码 LICENSE/README/package.json 或官方文档；**【核实·三方】**=权威安全机构/媒体报道；**【推断】**=我的工程判断。

---

## 0. 结论先行（TL;DR）

1. **Flowise / Langflow：排除进生产 SaaS 后端。** 两者 2025–2026 各有一串被**大规模在野利用**的严重 CVE（未授权 RCE、硬编码 JWT 认证绕过、CVSS 9.8–10.0），根因是「设计上就执行用户提供的代码节点 + 弱默认认证」，与「客户可见的多租户 SaaS 后端」本质冲突。仅可作**设计参考**或严格网络隔离的内部工具。
2. **n8n：内嵌客户可见功能 = 需付费 Embed 许可（不能白嫖）；纯内部运营自动化 = 免费 SUL 允许。** 二者是清晰的两条线。
3. **Windmill：AGPLv3（开源二进制）+ 专有企业特性。** 作为「代码优先 + 自动生成 UI + 简化版 Temporal」的**范式参考**极有价值；但 AGPL 网络传染 + CE「未经协议禁 managed service/wrap」使其不适合直接内嵌进商业 SaaS。
4. **自建路线（本报告推荐主线）：** React Flow（MIT，37.3K stars，Stripe/LinkedIn 在用）做**只读 DAG 投影**（零运行时/零安全/零许可风险，因为它什么都不执行）+ 常变层数据化（提示词走 Langfuse prompt management、参数/④段策略顺序走 `harness_config` 版本表 + zod + 后台表单 + 发布/回滚）。工作量级 **~2–3 人周** v1，且其中大部分「数据管道」不管选哪条路都得做。
5. **与 Dify/Coze 混合路线相比：** 自建薄后台把「确定性五段控制流 + 红线门禁 + N 选 1 择优」这块**护城河留在自己的 TS/AI SDK 代码里**，只把「真正常变的提示词/参数」外置成数据；混合路线让你继承平台的数据模型/执行语义/发布节奏/安全暴露面，恰恰在护城河那几段上跟平台对着干。

---

## 1. 轻量可视化平台快评

### 1.1 Flowise —— 排除（进生产后端）

- **许可【官方核实】**：`LICENSE.md` = Apache 2.0，但 `packages/server/src/enterprise/` 目录与带显式版权声明的文件（如 `IdentityManager.ts`）走 **Commercial License**。即「开放核心」模式。仓库根 `package.json`：`"name": "flowise", "version": "3.1.3"`。
- **活跃度【官方核实】**：git HEAD = `2026-07-17`（`Fix Flowise 809 Sanitize Organization User #6633`），高度活跃，YC 系。
- **durable 能力【推断】**：Flowise 是「请求作用域的 chatflow 执行器」，无代码级 durable-execution 原语（无 Temporal/DBOS 式持久 step、崩溃续跑）；不满足我们对 durable 载体的要求。
- **安全记录【核实·三方】——这是决定性因素：**
  - **CVE-2025-59528（CVSS 10.0）**：`CustomMCP` 节点未经校验执行 JavaScript → 未授权 RCE，影响 < 3.0.6；2026-04-07 起在野利用，估计 **12,000–15,000 个联网实例暴露**。
  - **CVE-2026-40933（CVSS 9.9）**：恶意 chatflow 导入即可「一键」触发 post-auth RCE（stdio MCP 无沙箱直接起子进程）。
  - **CVE-2026-56271（CVSS 9.8）**：硬编码默认 JWT secret/aud/iss → 伪造任意用户（含 admin）令牌，认证绕过，影响 < 3.1.0（本地镜像 3.1.3 已修复）。
  - 另有 CVE-2025-8943、CVE-2025-26319 在野利用。
- **结论【推断】**：当前版本虽在补，但**模式**清楚——一个「设计上就跑用户代码 + 默认认证薄弱」的产品，反复出现被大规模利用的未授权 RCE。绝不作客户可见后端；如需借鉴仅取其 chatflow 只读可视化的观感。**排除。**

### 1.2 Langflow —— 排除（进生产后端）

- **许可【官方核实】**：`LICENSE` = **MIT**，Copyright 2024 Langflow（背后 DataStax/IBM）。
- **活跃度【官方核实】**：git HEAD = `2026-07-15`（`fix(release): scope bundle RC versioning`），高度活跃。
- **durable 能力【推断】**：Python/FastAPI 的 flow 执行器，同样无 Temporal 式 durable 原语；生产 durable 要另配。
- **安全记录【核实·三方】——同样是决定性因素：**
  - **CVE-2025-3248（CVSS 9.8）**：`/api/v1/validate/code` 缺认证 → 未授权 RCE（滥用 Python decorator/默认参数），影响 < 1.3.0。
  - **入 CISA KEV**（2025-05-05）；GreyNoise 观测 **361 个恶意 IP** 在野利用；被用于部署 **Flodrix 僵尸网络**；**2026-07-07 CISA 更新标注其已用于勒索软件活动**（Sysdig 记录首例「agentic ransomware」即由此 CVE 起手）。
  - 另有 **CVE-2026-5027**（Langflow RCE，同批被 CISA 追踪，攻击者追求 RCE 与跨租户访问）。
- **结论【推断】**：一个被列入 CISA KEV 且被勒索团伙实际利用的产品，作为多租户 SaaS 后端组件是不可接受的负债。**排除。**（MIT 许可本身很友好，但许可友好 ≠ 安全可用。）

---

## 2. n8n —— Sustainable Use License 精确边界

### 2.1 许可文本【官方核实】（`n8n/LICENSE.md`，Sustainable Use License v1.0）

三层结构：
- 非 `master` 主分支内容 **不授予许可**；
- 文件名含 `.ee.` 或目录名含 `.ee` 的文件走 **Enterprise License**（`LICENSE_EE.md`：**生产使用必须持有对应 n8n 企业许可**，仅开发/测试可免许可）；
- 其余走 **Sustainable Use License**。

SUL 的核心限制句（逐字）：

> "You may use or modify the software only for your own **internal business purposes** or for non-commercial or personal use. You may distribute the software or provide it to others only if you do so **free of charge for non-commercial purposes**."

即：自用（内部业务）可以；**把 n8n 的能力作为商业服务提供给第三方 = 不在 SUL 授权范围内**。

### 2.2 两种用法分别裁定

**(a) 内嵌进我们的商业 SaaS、作为客户可见功能 —— 不能白嫖，需付费 Embed 许可。**
- 【官方核实·n8n 支持文档】原文：*"Should you plan to **embed n8n into your product**—effectively using it to manage workflows and credentials for your clients while exposing these workflows to them—a **white-labeled Embed license** would be necessary."*
- 【核实·三方】n8n 官方鼓励开发者「build with n8n」，但要求另签协议并支付费用；边界灰区可邮件 `license@n8n.io` 确认。
- 结论【推断】：只要 n8n 的价值被最终客户直接消费（哪怕只是后台跑 workflow），就落进 Embed 许可范畴。对我们的美业 SaaS，**把 n8n 当客户可见编排引擎 = 需付费商业授权**，不符合「白嫖开源」预期，且引擎语义仍与我们的五段式 Harness 不对齐。

**(b) 纯内部运营自动化（给非代码运营搭内部流程）—— 免费 SUL 允许。**
- 属于 "internal business purposes"：运营团队用 n8n 串接内部工具（如：新商家入驻→建库→通知，或内容审核流水的内部编排），价值由**我们自己内部消费**，不暴露给终端客户。这是 SUL 明确允许的自用场景。
- 注意【推断】：一旦这些内部流程开始**直接对外服务客户**（把内部 flow 的产出作为产品功能卖出去），就滑向 (a)。边界 = 「谁在消费 n8n 的价值」。

### 2.3 self-host 要求 + AI 节点能力

- **self-host【官方核实】**：Node.js/TypeScript monorepo（`n8n-monorepo` v`2.31.0`，HEAD 2026-07-17，极活跃），Postgres 存储，queue mode 走 Redis/BullMQ（执行持久化 + 重试，但属「workflow 实例持久化」而非代码级 durable-execution 原语【推断】）。
- **AI 节点能力【官方核实】**：AI 生态很厚——`@n8n/nodes-langchain`（AI Agent、chains、vector store、embeddings 等 LangChain 系节点）、`@n8n/ai-node-sdk`、`@n8n/ai-utilities`、`@n8n/computer-use`、`chat-hub`；但 **`@n8n/ai-workflow-builder.ee`（AI 自动搭 workflow）是 EE 企业许可**。
- 定位结论【推断】：n8n 的价值在 **(b) 内部运营自动化**（可免费自托管），可作为团队内部胶水层留观；**不作** 客户可见编排引擎。

---

## 3. Windmill —— 许可结构 + 范式参考点

### 3.1 许可结构【官方核实】（`windmill/LICENSE`）

- 默认 **AGPLv3**；`backend/`、`frontend/` 中带 `enterprise` 编译标记 / 需 license check 激活的片段为**专有商业**；`python-client/ deno-client/ go-client/ powershell-client/` 与 **OpenFlow spec、OpenAPI 文件 = Apache 2.0**。
- 「不含 `enterprise` flag 从源码编译出的二进制」= 纯 **AGPLv3** 开源。
- **Community Edition**（`ghcr.io` docker 镜像 / GitHub release）= 含 AGPL+Apache 源码 **+ 非公开专有代码**；授予「免费使用全部 CE 特性 + 原样分发」的权利，但**明确禁止：sell / resell / 作为 managed service 提供 / 以任何形式 modify 或 wrap —— 除非另有明确协议**。

### 3.2 对我们的适用性【推断】

- **不适合直接内嵌**：(1) AGPLv3 有网络使用传染性——若我们基于 AGPL 源码改造并对外提供服务，须开放对应源码，对闭源商业 SaaS 是硬约束；(2) 若用 CE 镜像省事，则「禁 managed service/wrap」直接堵死把它当客户可见能力封装。两条路都要求另签商业协议。

### 3.3 值得抄的范式参考点【官方核实 README + 推断】

Windmill 自述：*"Open-source developer platform for internal code… Self-hostable alternative to Retool, Pipedream, Superblocks and a **simplified Temporal with autogenerated UIs**."* 三个可提炼参考点：

1. **「代码优先，UI 是投影」**：脚本用 TS/Python/Go/Bash 写，**从脚本的类型化入参自动生成表单 UI**。这正是我们要的模型——**Harness 骨架=代码，可视化=只读投影，后台表单=从 config 的类型 schema 生成**。
2. **OpenFlow spec（Apache 2.0）**：一套 DAG 序列化格式，可作我们 `harness_config` DAG 表达的参考蓝本（无需照抄，取「用声明式 JSON 描述有向步骤图」的思路）。
3. **「simplified Temporal」定位**：它确实带 durable 工作流执行（Postgres 队列 + 分步持久）——提醒我们：**durable 能力应由专门载体（Temporal/DBOS/Inngest，见兄弟报告）承担，而非塞进可视化层**。可视化层不碰执行。

---

## 4. 自建路线评估（本报告核心）

### 4.1 React Flow（xyflow）快评 + 只读 DAG 可视化工作量估算

**许可与活跃度【官方核实】**：
- `packages/react` = `@xyflow/react` **v12.11.2**，**MIT**（Copyright 2019–2025 webkid GmbH）。依赖极轻：仅 `@xyflow/system`（自家）+ `classcat` + `zustand`。**它是纯前端 UI 库，不执行任何后端代码、不碰凭据、不起子进程——因此把 §1 那类 RCE/认证绕过风险从根上排除了。**
- git HEAD `2026-07-06`（`@xyflow/react@12.11.2` release），持续活跃。
- 采用度【核实·三方】：GitHub **37.3K stars**，npm 上 **797 个依赖项目**，Stripe / LinkedIn 在生产使用。是 React 节点式 UI 的事实标准。
- 安全姿态【官方核实】：仓库有正式 `SECURITY.md`（私密上报 + 1 周确认 / 4 周处置目标）。作为纯渲染库，攻击面天然小。

**现成模板可抄的情况【官方核实 + 核实·三方】**：
- 官方「**AI Workflow Editor**」模板（Next.js + **React Flow UI** + **AI SDK** + shadcn/ui + Zustand）—— **技术栈与我们完全一致**，但它是 **Pro（付费）模板**（原文：*"This is a Pro template. Get all pro examples… with a React Flow Pro subscription."*）。底层库 MIT 免费，付费的只是 Pro 示例集 + 1:1 支持 + issue 优先级。
- 免费 MIT 社区模板充足：`Open Agent Builder`（Next.js 15 App Router + React Flow + 8 种节点类型）、`Azim-Ahmed/Automation-workflow`、多个 drag-and-drop workflow builder。可作抄改起点。
- 本地镜像 `examples/react/src/examples/` 已含全部所需原语示例：`SaveRestore`、`Layouting`、`Subflow`、`NodeToolbar`、`CustomNode`、`Validation`、`ControlledUncontrolled`、`UseNodesData` 等。**只读 DAG + 节点详情面板所需积木齐全，无需 Pro 订阅。**

**「五段式只读 DAG + 节点点开看提示词版本/参数/运行状态」工作量估算【推断】**（假设后端 prompt 版本/config/trace 数据已由兄弟组件就位）：

| 部件 | 说明 | 人日 |
|---|---|---|
| 静态 DAG 定义 | 五段 Harness 是固定图，nodes/edges 直接从 `harness_config` 派生或硬编码；布局固定可硬编码坐标，省掉 dagre/elk | 0.5 |
| 只读画布 | `<ReactFlow>` 组合 props（`nodesDraggable=false`、`nodesConnectable=false`、`elementsSelectable=true`、禁连线）+ 5 个自定义节点组件（每段一种，含状态色） | 1.5 |
| 节点详情抽屉 | 点节点 → 侧栏 Drawer 展示：当前生效 prompt 版本（取自 Langfuse prompt / prompt 表）、当前参数（取自 `harness_config`）、上次运行状态 | 2 |
| 运行状态叠加 | 按最近一次执行结果给节点上色 + 下钻到某次 run 的 trace（数据来自 Langfuse，兄弟组件域） | 1.5 |
| 整合/样式/空态 | 与产品视觉系统对齐、加载/空/错误态 | 1 |

**只读 viewer 小计 ≈ 5–7 人日**（画布本身仅 ~2 人日；其余是数据接线，而数据接线不管选哪条路都要做）。注意：**这个 viewer 是「锦上添花」而非必需**——MVP 阶段甚至可以先不做可视化，只做下面 4.2 的配置后台。

### 4.2 「常变层数据化」方案骨架

核心原则（对齐 **12-Factor Agents**，见 4.3）：**骨架/控制流留在 TS + AI SDK 代码里（确定性主干）；只把「真正常变的东西」外置成数据 + 薄后台。** 三类常变项各有归宿：

1. **提示词 → Langfuse Prompt Management**（兄弟组件已调研）：UI 编辑 + 版本 + 一键回滚 + label（prod/staging）现成，不自造。代码里通过 `prompt_ref`（name + label/version）引用。
2. **模型/择优参数、④段策略顺序 → 自建 `harness_config` 版本表 + 后台表单**。
3. **durable 执行 → 交给专门载体**（不在本层）。

**数据模型草图（英文代码）【推断】**：

```typescript
// 一份「已发布配置」是不可变快照；发布=新增版本行，回滚=重指指针
table harness_config_version {
  id            uuid pk
  env           enum('dev','staging','prod')   // 环境隔离，防止直接改 prod
  version       int                            // 单调递增，(env, version) 唯一
  status        enum('draft','published','archived')
  config        jsonb                          // 见下方 zod schema
  created_by    text                           // 审计：谁
  created_at    timestamptz                    // 审计：何时
  note          text                           // 变更说明
}

table harness_config_pointer {
  env               enum('dev','staging','prod') pk  // 每环境一个活跃指针
  active_version_id uuid fk -> harness_config_version.id
  updated_by        text
  updated_at        timestamptz
}
```

```typescript
// zod：写入时校验 + 加载时校验(fail-closed)
const StageParams = z.object({
  model: z.enum(['...allowed models...']),        // 模型白名单，非自由文本
  temperature: z.number().min(0).max(2),
  promptRef: z.object({ name: z.string(), label: z.enum(['prod','staging']) }),
});

const HarnessConfig = z.object({
  stage1_intent:   StageParams,
  stage3_brief:    StageParams,
  stage4_execute:  z.object({
    ...StageParams.shape,
    nBest:          z.number().int().min(1).max(5),   // N选1 的 N
    scoringWeights: z.record(z.string(), z.number()), // 择优权重
    strategyOrder:  z.array(z.enum([                  // ④段内部策略顺序=有序枚举数组
      'redline_gate','dedup','style_match','length_fit',
    ])).nonempty(),                                    // 红线门禁始终在序列里，不可删
  }),
});
```

**发布/回滚流【推断】**：
- 非代码人员在后台改的是 `draft` 版本 → 点「发布」→ **必过 eval 门禁**（promptfoo/evalite，兄弟组件域）→ 通过才写 `published` 并把 pointer 指过去。
- 回滚 = pointer 重指到上一个 `published` version（O(1)，无需回退代码）。
- 每次真实 LLM 调用/trace **必须记录 `config_version_id` + `prompt_version`**，任何历史 run 可精确复现（审计闭环，接 Langfuse trace）。

**非代码人员的后台表单形态【推断】**：
- 因为 Harness 形状固定、参数可枚举，**用 schema 驱动的表单**（react-hook-form + zod resolver，或从 zod schema 生成）即可。非代码人员编辑的是**枚举字段**（下拉选模型、滑块调温度、拖拽排 `strategyOrder`、跳转 Langfuse 编辑 prompt），**不是自由画图、不是写代码**。这正好落在用户给定前提「后台会有非代码人员调整、维护简易性是硬标准」。
- 借鉴 Windmill「从类型化 schema 自动生成 UI」的思路（§3.3）。

**这条路的坑【推断】**（必须正面处理）：
1. **配置漂移（config drift）**：UI 改的 prod 配置与 git/code review 脱节。缓解=配置版本行本身即审计记录（who/when/note）+ 定期把 published config 导出进 git 作 artifact；每条 trace 带 `config_version_id`。
2. **环境差异**：dev/staging/prod 配置分叉。缓解=`env` 维度隔离 + **promotion 流程**（从 staging 版本「提升」到 prod，而非直接编辑 prod）。
3. **审计/可复现**：见上，trace 必须钉住 config+prompt 版本。
4. **最大的坑——无门禁直发**：非代码人员改一个 prompt/参数就影响全部租户。缓解=**发布强制过 eval 门禁 + 一键回滚**。可视化层帮不上这个忙，真正的护栏在 eval gate（兄弟组件）。这也说明**自建薄后台天然与 promptfoo/evalite + Langfuse 咬合**，不是孤立组件。

### 4.3 行业先例（「固定代码骨架 + 外置提示词/配置管理」的生产实践）

1. **12-Factor Agents（HumanLayer，`github.com/humanlayer/12-factor-agents`）【核实·三方】** —— 最贴合的可引用架构宣言。核心洞察：*"most successful AI products aren't purely agentic—they combine **deterministic code** with strategically placed LLM decision points."* 直接对应我们的两条原则：
   - **Factor 2「Own Your Prompts」**：*"Don't outsource your prompt engineering to a framework"* —— 提示词要自持、可外置、可版本化（= 我们走 Langfuse 而非把 prompt 焊死在某平台节点里）。
   - **Factor 8「Own Your Control Flow」**：*"Rather than giving the LLM actual code to run in a loop… have the LLM output structured data that your deterministic code then executes, which means you own the control flow, can insert validation logic, and can pause execution at any point."* —— 这正是我们五段式 Harness 的确定性主干 + 红线门禁 + N 选 1 择优。宣言明确指出「传统 agent 框架大多卡在 70–80% 可靠性天花板，最后 20% 需要对 prompt/context/control flow 的掌控」——即**不要把控制流交给可视化平台**。

2. **Prompt CI/CD / 配置化 prompt 部署（Agenta、Azure Prompt Flow + DevOps 等工程博客）【核实·三方】** —— 成熟范式：*"Moving prompts out of the codebase into a managed environment… prompts are treated as **configuration objects** containing the system message, user templates, model parameters (temperature, top_p), and tool definitions. This allows versioning independent of application code and enables **non-technical stakeholders (like Product Managers) to iterate**."* 与我们 4.2 的 `harness_config` + Langfuse 完全同构；并强调**发布前跑自动 eval、经 staging 审核**（= 我们的 eval 门禁）。

3. **Langfuse Prompt Management（兄弟组件 08 已详调）【核实·三方】** —— 生产级「提示词 UI 编辑 + 版本 + label + 回滚 + 与 trace 关联」的现成实现，是「提示词外置」这一子问题的直接买方案，无需自造。

> 三条先例共同背书：**控制流留代码（自持、确定性），提示词与参数外置为受版本管理的配置数据，发布经 eval 门禁**——与用户给定的默认路线一字不差。

---

## 5. 结论

### 5.1 路线二（自建薄后台）最小组件清单 + 总工作量级【推断】

| 组件 | 买/建 | 说明 | 工作量级 |
|---|---|---|---|
| 提示词管理 | **买**（Langfuse） | UI 编辑/版本/回滚/label，代码里 `promptRef` 引用 | 集成 ~2–3 人日（兄弟组件域） |
| `harness_config` 版本表 + pointer | **建** | Postgres 两张表 + zod schema + 加载 fail-closed | ~2–3 人日 |
| 后台配置表单 | **建** | schema 驱动（react-hook-form + zod），枚举字段/滑块/排序 | ~3–4 人日 |
| 发布/回滚 + 审计 | **建** | 版本行审计 + pointer 重指 + trace 钉版本；发布挂 eval 门禁 | ~2–3 人日 |
| eval 门禁 | **买/集成**（promptfoo/evalite） | 发布前跑，兄弟组件域 | 集成成本另计 |
| 只读 DAG viewer | **建（可后置）** | React Flow MIT + 节点详情抽屉 + 状态叠加 | ~5–7 人日（非 MVP 必需） |

**核心后台（不含 viewer）≈ 9–13 人日；含 viewer ≈ 2–3 人周 v1。** 且其中「配置表/发布回滚/审计/eval 门禁」这些**不管选哪条路都得做**——差别只在自建时它们长在自己的数据模型上、完全可控。

### 5.2 哪些平台部件值得抄（取范式，不订阅套壳）【推断】

- **Windmill**：①「类型化 schema → 自动生成表单 UI」——直接指导 4.2 后台表单从 zod schema 生成；② OpenFlow spec（Apache 2.0）作 DAG 序列化参考；③「代码优先、UI 是投影」哲学。
- **n8n**：`@n8n/nodes-langchain` 的 AI Agent 节点参数面作「该暴露哪些模型/工具参数」的清单参考；引擎本身不用（除非 (b) 内部运营，可免费自托管）。
- **Flowise / Langflow**：仅取 chatflow 只读可视化的**观感设计**作节点详情面板参考；运行时坚决不碰。
- **React Flow**：直接抄免费 MIT 社区模板（Open Agent Builder 等）+ 本地 `examples/` 原语；Pro 模板（AI Workflow Editor）可按需订阅省时，但非必须。

### 5.3 路线二（自建薄后台）vs Dify/Coze 混合路线（兄弟组件 harness-visual-platforms 域）—— 相对优劣【推断】

Dify/Coze 混合路线是「batteries-included」：自带可视化 builder + prompt IDE + 内置 RAG/模型路由，到 demo 更快、对非代码人员即时可用度更高；代价是你**继承平台的数据模型、执行语义、发布节奏与安全暴露面**（§1 的 Langflow/Flowise 已示范这类「跑用户代码」的 builder 一旦客户可见，RCE 风险有多现实），而且我们的护城河——**确定性五段控制流 + 红线门禁 + N 选 1 择优**——并不能干净地映射到它们的节点图上，你会**恰恰在护城河那几段跟平台对着干**。自建薄后台反过来：前期数据管道要自己铺（~2–3 人周），但控制流留在 TS/AI SDK 代码里（12-Factor 背书），「常变层」外置成数据 + 一个非代码人员能在护栏内安全编辑的小后台，可视化层是**只读 MIT React Flow 投影、零运行时/零安全/零许可风险因为它从不执行任何东西**。**一句话：护城河那几段自己写、租一切不碰客户数据与红线门禁的东西——自建薄后台在「可控性 × 安全 × 许可干净」上全面占优，代价是牺牲了 Dify/Coze 的开箱即用速度。** 结合用户既有偏好（成熟组件优先但不自写 framework——React Flow 是成熟组件不是 framework；本地知识库/护栏才是护城河），**推荐路线二为主线**，Dify/Coze 仅在需要快速搭一次性内部 demo 时作战术选项。

---

## 附录 · 来源 URL

**本地第一手源码（`references/repos/harness-2026-07-17/`）**
- Flowise `LICENSE.md` / `package.json`（v3.1.3，Apache2.0+enterprise 商业）
- langflow `LICENSE`（MIT）
- n8n `LICENSE.md`（Sustainable Use License v1.0）/ `LICENSE_EE.md` / `package.json`（v2.31.0）/ `packages/@n8n/*`
- windmill `LICENSE`（AGPLv3+Apache+专有）/ `README.md`
- xyflow `packages/react/package.json`（@xyflow/react v12.11.2，MIT）/ `examples/react/src/examples/` / `SECURITY.md`

**联网核实**
- Langflow CVE-2025-3248：https://www.recordedfuture.com/blog/langflow-cve-2025-3248 ｜ https://securityaffairs.com/190018/security/u-s-cisa-adds-a-langflow-flaw-to-its-known-exploited-vulnerabilities-catalog.html ｜ https://thehackernews.com/2026/07/cisa-adds-4-actively-exploited-adobe.html ｜ https://github.com/langflow-ai/langflow/security/advisories/GHSA-vwmf-pq79-vjvx ｜ https://www.picussecurity.com/resource/blog/cve-2025-3248-cve-2026-5027-langflow-rce ｜ https://www.mallory.ai/stories/019f4134-c5d4-7385-ab6c-779d19c782f5
- Flowise CVE：https://thehackernews.com/2026/04/flowise-ai-agent-builder-under-active.html ｜ https://www.anavem.com/en/news/cybersecurity/cve-2025-59528-hackers-exploit-critical-flowise-rce-flaw ｜ https://www.obsidiansecurity.com/blog/when-is-stdio-mcp-actually-a-vulnerability ｜ https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-3gcm-f6qx-ff7p ｜ https://www.thehackerwire.com/flowise-critical-jwt-auth-bypass/ ｜ https://www.securityweek.com/exploit-code-published-for-critical-flowise-rce-vulnerability/amp/
- n8n 许可：https://docs.n8n.io/sustainable-use-license/ ｜ https://support.n8n.io/article/can-i-use-your-license-for-my-use-case ｜ https://www.fatcamel.ai/blog/n8n-licensing-101-understanding-commercial-embed-and-sustainable-use-licenses
- React Flow：https://reactflow.dev/ui/templates/ai-workflow-editor ｜ https://github.com/xyflow/xyflow ｜ https://www.npmjs.com/package/@xyflow/react ｜ https://reactflow.dev/showcase ｜ https://github.com/topics/workflow-builder
- 行业先例：https://github.com/humanlayer/12-factor-agents ｜ https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-02-own-your-prompts.md ｜ https://www.humanlayer.dev/blog/12-factor-agents ｜ https://agenta.ai/blog/cicd-for-llm-prompts ｜ https://learn.microsoft.com/en-us/azure/machine-learning/prompt-flow/how-to-integrate-with-llm-app-devops
