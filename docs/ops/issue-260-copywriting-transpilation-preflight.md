# Issue #260 `copywriting` 转译开荒预案

> 状态：`preflight`。基线 `main@cc04918ddb11f5cd5013ee085a369047538e218c`。
> 本文只完成零 rebase 面的人工蒸馏设计；未写 PG、未建 Skill、未绑定
> Recipe、未运行真实生成，不能作为 #260 验收证据。

## 1. 固定来源与许可

- 上游：`coreyhaines31/marketingskills`
- 固定提交：`7868cb9251fad80a73d26e488a5ad5f6c4a9f335`
- 原文：`skills/copywriting/SKILL.md`
- blob：`0793e62270e203de1b2e2ff591a56015e4cf0075`
- 同批阅读：
  `references/copy-frameworks.md`、`references/natural-transitions.md`、
  `evals/evals.json`、仓库根 `LICENSE`
- 许可：MIT，Copyright (c) 2025 Corey Haines。后续若写入实质性改编内容，
  PG 来源字段及第三方声明必须保留来源、提交、路径、许可和版权归属。

## 2. 八步筛选结论

| 检查 | 结论 |
| --- | --- |
| 许可可用 | 通过，MIT |
| 标准 frontmatter | 通过，仅 `name`、`description`、`metadata` |
| 脚本/执行依赖 | 无 `scripts/`，不引入外部执行面 |
| 工具依赖 | 不照搬；目标 sidecar 的 `allowedTools` 保持最保守空集 |
| 红线/规避审核 | 未发现；后续仍须跑既有七红线正控与故意失败负控 |
| 冻结发布面 | 删除 SEO、站点发布、外部投递语义；只保留生成方法论 |
| 自主探索 | 删除文件探测和跨 Skill 路由；缺信息统一交给 `ask_merchant` |
| 蒸馏成本 | B 档；两份 reference 必须人工取舍，禁止整包展开进上下文 |

## 3. 段落级裁剪与域内改写

保留并改写为平台层通用方法论：

1. 清楚优先于聪明；
2. 用户收益优先于功能罗列；
3. 具体、可核对的事实优先于空泛形容；
4. 顾客语言优先于公司术语；
5. 一段只推进一个主张；
6. 直白、主动、诚实，不编造统计、评价、资质或效果；
7. 标题、正文和 CTA 必须服务同一个宣发目标。

按当前产品合同改写：

- `homepage / landing / pricing / feature / about` 页面轴，改为
  `小红书文案 / 朋友圈文案 / 团购活动文案 / 项目介绍 / IP 表达`
  等商家可理解的载体与任务；
- CTA 改为私信、预约、到店、团购券等已确认的转化动作，禁止模型自行补造；
- SaaS 示例改为美发、美甲、美睫、生活美容等非医美首发场景；
- 上游“默认给 2–3 个备选”改为一个可直接采用的主推荐，只有商家主动要求
  或主观分歧时再展开备选；
- `product-marketing.md` 文件探测改为读取既有 ContextBundle；
- 上游缺失信息的逐项追问，改为一次性 `ask_merchant`，允许整组跳过并为
  每项提供“暂未确定”；
- 删除 meta title、SEO description、站点页面模板、相关 Skill 跳转和文件路径。

两份 reference 的常驻蒸馏边界：

- `copy-frameworks.md` 只保留“结果/痛点/人群/差异/证据”五类标题思路，
  不保留整页 section 模板；
- `natural-transitions.md` 只保留自然转折、前置重点和 AI 腔禁用项，
  不常驻完整短语词典。

## 4. 目标产物草案

- `name`：`beauty-copywriting`
- 层级：平台层；行业层首批保持空
- `description` 草案：

  > 为美业门店写作、重写或改善可直接发布的营销文案。商家提出“写一条小红书
  > 文案”“给团购活动写朋友圈”“标题不够抓人”“把这段说得更像顾客会说的”
  > “换一个更能引导预约的版本”时使用。先用已确认的门店事实、素材、表达身份
  > 与转化动作；信息不足时一次性补问，绝不编造价格、效果、资质、评价或授权。

- `instruction`：仅装上节七条方法论、载体差异和诚实写作边界；
- 标准 frontmatter 与治理 sidecar：等待 #258 的实际 schema 后适配，不按当前
  `SKILL_STAGES` / `evalSuiteRef` 旧形态预写；
- prompt：仅引用 Langfuse 位点；不得把基础 prompt 正文写进 Skill；
- 模型：只声明能力，不写模型 ID、部署名或供应商；
- 来源/许可：使用第 1 节固定值；
- 触发：消费 #256/#258 合入后的真实原语与 schema，不复活第二套枚举。

## 5. 第一条 Skill 开荒顺序

正式前置合入后，按以下顺序逐步留证：

1. 选一张已发布的 `copy` Recipe 宿主，记录非缺省
   `workflowRevisionRef`、Recipe revision 与 Surface revision；
2. 通过生产公开派发链逐项真实运行
   `skill_define → skill_accept → skill_bind → skill_rollback →
   skill_deployment`，每项查询真实 PG 并在重建 repository 后重读；
3. 先用无操作 instruction 的空壳做正/负控：绑定时 resolver 命中，解绑时不命中；
4. 新建 Recipe revision，同时写运行期确定性选择关系和
   `recipe.skillRevisionRefs` 完整性声明，再跑 `RecipeStudioService.validate()`；
5. 从 `/dashboard` 真点击 D-139 `copy` lens 下的配方卡，完成报价、提交和交付；
6. 同一 workflow 合并三份证据：PG revision/binding、trace 的
   refs/hash/receipt、模型端口实际收到的 materialized instruction；
7. 固定商家、任务、prompt、catalog/model revision，仅切换 Skill binding，
   跑 promptfoo A/B；原始输出和分数原样保留；
8. 质量改善、无改善或变差均如实记录。若输出无可检测差异，删除死库存，不为
   证明有效修改 scorer 或 golden。

## 6. 待回填的行为证据

| 门 | 当前 | 正式证据 |
| --- | --- | --- |
| #266、#242-L1、#256、#258、#259 合入 | 阻塞 | 合入 SHA + 上游关票断言实跑 |
| 生命周期五命令 | 未跑 | 生产入口日志 + PG 状态 + 重启重读，5/5 |
| 平台层存储 | 未写 | catalog/revision/sidecar 查询；行业层 0 条 |
| 确定性触发双落位 | 未写 | bound 正控、unbound 负控、Recipe validate |
| D-139 商家入口 | 前端语义锁 | 真浏览器点卡、提交、交付 |
| 真实注入 | 未跑 | refs/hash/receipt + materialized instruction + 真实输出 |
| promptfoo A/B | #242-L1 阻塞 | 同三轴、单变量 paired EvalRun |
| 保留/删除判断 | 未判 | 原始分数、人工双盲记录、结论 |
