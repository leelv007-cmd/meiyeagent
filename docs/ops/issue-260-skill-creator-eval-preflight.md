# Issue #260 美业版 skill-creator 与 A/B 评测预案

> 状态：`preflight`。只读复核基线
> `main@d8c1508190cb822f8bd75a999eeffc1ada3735f2`。
> 本文只定义零 rebase 面的行为合同；未建 Skill、未写管线、未跑 promptfoo，
> 不能作为 #260 验收证据。

## 1. 固定来源

- 上游：`anthropics/skills`
- 固定提交：`b29e7cf65e5cb78a5ac33d582270551bc74a14eb`
- 原文：`skills/skill-creator/SKILL.md`
- blob：`65b3a402dbd09b8e83f9d637c6b553875189085c`
- 许可：`skills/skill-creator/LICENSE.txt`，Apache-2.0，
  Copyright 2026 Anthropic, PBC

本票只蒸馏官方 `Capture Intent` 的四项：

1. 所用工具；
2. 步骤序列；
3. 商家做过的纠正；
4. 观察到的输入/输出格式。

官方脚本、子 Agent、打包器、HTML viewer、文件目录和通用 Skill 编辑器不进入
本项目。原因不是能力不足，而是 D-163 已裁定：美业版 skill-creator 是一条
平台层配方，运行在现有六原语、PG Skill 目录和商家确认边界上。

## 2. 平台层配方草案

- `name`：`capture-store-workflow`
- 展示名：`记住这套做法`
- `description` 草案：

  > 当商家说“以后都这么做”“记住这个流程”“下次照这个来”“把刚才这套方法
  > 留下来”或要求复用刚完成的创作流程时使用。先从当前对话提取工具、步骤、
  > 商家纠正和输入输出格式；只补问确实缺失的内容，商家确认后才沉淀为本店
  > 可复用配方。

- 层级：平台层；
- 产物：门店层 proposal；商家确认后成为不可变 revision；
- 导出：无。门店层产物引用租户事实、平台 Skill 和运行时原语，不存在可携带形态；
- 模型：只声明所需能力，不写模型、部署或供应商；
- prompt：只引用 Langfuse 位点，不内联基础 prompt 正文；
- 工具：只消费 #256 合入后的 `read_context`、`ask_merchant`、`record`，
  不新增原语或专用 API。

## 3. 一次真实沉淀的状态机

```text
merchant trigger
  → read_context(current conversation)
  → extract {tools, steps, corrections, inputOutputFormats}
  → ask_merchant(missing fields, one group, skippable)
  → propose workflow recipe
  → merchant confirm or reject
  → record only after confirm
  → immutable store revision
  → merchant catalog visible
```

行为不变量：

1. 先读当前对话，再补问；禁止让商家重复已说过的信息；
2. 四项一次性问全，每项均允许“暂未确定”，整组可跳过；
3. `answer / deferred / skipped` 是显式入站状态，`description` 只给人看，
   回模型的是稳定 `label`；
4. 模型只能产生 proposal，`confirm_*` 只能由已认证商家触发；
5. 未确认、拒绝、超时或伪造确认时，PG 中不得出现 accepted revision；
6. 提案必须引用来源对话与纠正，不得把模型补写内容伪装为商家经验；
7. skill-creator 这次会话本身必须钉扎
   `skillRevision + promptName@promptVersion + catalogRevision`；
8. 不建 message/session→Skill 专用绑定字段，不建“一键沉淀”后端管线；
9. 目录可见必须来自真实查询投影，不以 Toast、静态卡片或 testid 代替。

## 4. TDD 公共 seams

| 行为 | 公共 seam | 关键负控 |
| --- | --- | --- |
| 触发与上下文抽取 | `read_context` 原语 + 当前会话快照 | 已存在四项时不得调用 `ask_merchant` |
| 缺口补问 | #250 完成后的 `ask_merchant` 契约 | label/description 混淆、逐项追问、不可跳过 |
| proposal | #256 `record` proposal 壳 | 模型直接 confirm 或直接 accepted |
| 商家确认 | `P1ApplicationService.executeModule(...)` | 未认证 actor、伪造 claim、重复确认 |
| PG 持久化 | `PostgresSkillRepository` 公开查询 | 重启丢失、未确认写入、租户串读 |
| 三轴冻结 | Task snapshot + 同一条事件 | 任一轴静默 fallback 或执行中漂移 |
| 目录可见 | D-139 `/dashboard/catalog` 查询投影 | 仅 admin 可见、静态假卡、跨店可见 |
| 浏览器旅程 | 触发语→补问→proposal→确认→目录卡 | 拒绝后仍出现、刷新后消失 |

最小垂直切片顺序：

1. 完整对话已有四项：直接 proposal，商家确认后 PG 可重读；
2. 对话缺两项：一次性补问，回答后 proposal；
3. 商家整组跳过：保留 unknown，不编造，不直接 accepted；
4. 商家拒绝 proposal：零 accepted revision，目录不可见；
5. 伪造 confirm：default-deny；
6. 真浏览器完成一次沉淀并在刷新后从目录重新进入。

## 5. `beauty-copywriting` promptfoo A/B

配对不变量：

- 同一 workspace、ContextBundle、商家输入和 Recipe；
- 同一 prompt name/version、catalog/model revision、provider、温度和预算；
- 同一红线与事实授权；
- 唯一变量是 `beauty-copywriting` binding 开/关；
- 两组同批执行并盲化顺序，不先看结果再改 scorer；
- 输出、trace、token、延迟、成本和原始评分全部保留。

首批用例建议：

| 用例 | 输入重点 | 独立判据 |
| --- | --- | --- |
| 小红书项目介绍 | 已确认服务、手法、适合人群 | 一个主推荐；具体收益对应事实；无疗效承诺 |
| 朋友圈团购 | 价格、有效期、预约方式 | CTA 只用已授权动作；不造限时/销量 |
| 美甲前后对比 | 有素材授权、无效果数字 | 顾客语言；不编造百分比或评价 |
| 发型师 IP | 已确认表达身份与禁说项 | 语气一致；不越过身份授权 |
| 信息不足 | 只有项目名称 | 明示缺口或补问；不补造价格、资质、效果 |
| 商家要求多版本 | 主观方向确有分歧 | 先给一个主推荐，按要求再展开不超过两个备选 |

评分分两层：

1. **硬断言**：事实引用合法、一个主推荐、CTA 合法、红线为零、
   禁止编造数字/资质/评价、输出结构可解析；
2. **盲评**：清晰度、收益表达、具体性、顾客语言、段落单一主张。

判定规则：

- with-skill 输出必须在 trace 中带预期 revision/hash/receipt，且模型请求端口收到
  materialized instruction；否则 A/B 无效；
- 先跑 #242-L1 正控和故意失败负控，证明评测门会真红；
- 改善、持平、变差都记录为产品结论；
- 若无可检测差异，判为死库存并删除，不把“管线跑完”改写成“Skill 有效”；
- 任何 scorer/golden 变更必须形成下一版 eval revision，禁止覆盖首跑结果。

## 6. 当前依赖与待回填证据

| 门 | 当前 main 证据 | #260 边界 |
| --- | --- | --- |
| #256 六原语 | 已合入并接通 `read_context`、`ask_merchant`、`record` 生产装配 | 不新增原语；`record` 仍只是 proposal port |
| #250 ask_merchant 基础切片 | 已闭合 durable hold、renderer ack、自由文本、reask 与 waiting 专属卡；grouped answer 在单问题 consumer 仍显式拒绝 | Capture Intent 所需的一次性分组补问仍等 grouped workflow consumer，不得把基础切片写成三态整组合同已完成 |
| #251 proposal/confirm 管道 | 未合入 | 没有该权威管道前，不得宣称一次真实沉淀已走完 `propose_* → confirm_*` |
| #258 sidecar/frontmatter | 已合入官方格式 import/export、manifest sidecar 与 PG repository | #260 只消费现有格式，不重开 schema |
| #259/#254 五命令与目录面 | #259 基础面及 #254 W4 代码已合入；严格 checker 仍因缺精确 `#254 关票` 回执返回 exit 10 | 门未开前只做零 rebase 预备；五命令仍须在 #260 自身旅程按公开派发口真跑 |
| #248/#262 三轴事件与快照 | 已合入 task-root/execution-child 三轴载体与生产 sender | #260 必须证明自身两次执行的精确 skill/prompt/catalog 轴，不以通用上游测试替代 |
| #242-L1 正负控/golden | 已合入 11-case recorded seam、exact scorer、Promptfoo 正门与 assertion control | 属 recorded 证据，不冒充 live provider；copywriting paired EvalRun 仍须新建 |
| #247 有界执行 | 已合入 D-167 signed-unbounded/provisional seed/触顶续跑；生产默认仍 fail closed | 浏览器旅程须在 e2e 显式 seed 下运行，不把 e2e 配置写进生产 |
| skill-creator 真实会话 | 未运行 | 必须包含触发、补问或无补问、proposal、商家确认、PG 重读与目录可见 |
| copywriting paired EvalRun | 未运行 | 唯一变量必须是 `beauty-copywriting` binding，改善/持平/变差原样记录 |
| D-139 浏览器目录旅程 | 前端仍缺 #253FE，语义锁未释放 | 前端 gate 满足前不改配方卡入口；满足后与 D lane 最新形态适配 |
