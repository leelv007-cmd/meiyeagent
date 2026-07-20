哥，# 判定汇总表

本轮共抽取 20 条可证伪断言。结果：**✅ 10 条、⚠️ 6 条、❌ 4 条**。没有修改任何文件。

| # | 报告断言 | 判定 | 核验结论 |
|---|---|---|---|
| 1 | promptfoo 为 MIT，版本 0.121.19，发布于 2026-07-14 | ✅ | 本地 LICENSE/package.json 与 npm registry 一致 |
| 2 | promptfoo 约 23.4k stars，近期仍活跃 | ✅ | 核验时 23,360 stars；2026-07-17 仍有 push，最新提交集中在 7 月 16 日 |
| 3 | OpenAI、Anthropic 在使用 promptfoo | ⚠️ | 有 promptfoo 官网和 GitHub 的官方自述；OpenAI 关系另有收购公告，但未找到 Anthropic 独立确认 |
| 4 | promptfoo 由 “Promptfoo company” 维护 | ⚠️ | 已过时或至少不完整；README 称已成为 OpenAI 一部分，OpenAI 也发布了收购公告 |
| 5 | promptfoo/evalite 分别有 423/61 个 open issues | ❌ | 这是 GitHub `open_issues_count`，包含 PR；实际 issue 分别约 96/45，另外有 327/16 个 open PR |
| 6 | `assertScoringFunction` 可实现“任一关键指标 < 1 即 fail” | ✅ | 支持读取命名分数并返回 `pass:false`；可实现硬门 |
| 7 | 报告中的 `defaultTest.assertScoringFunction:` YAML 可用 | ❌ | 点号不会形成嵌套；应写成 `defaultTest: { assertScoringFunction: ... }` |
| 8 | promptfoo 支持 JavaScript/Python 自定义断言 | ✅ | 官方文档和实现均支持，可返回布尔值、分数或完整 GradingResult |
| 9 | 自定义 TS provider 可将整条应用管线包装成 target | ✅ | 可以，但 provider 在 Node.js 中加载，浏览器专用依赖、CSS、bundler alias 需适配或预编译 |
| 10 | red-team “自定义策略插件”示例含两条指定原文 | ⚠️ | 两条原文存在，但 `policy` 是插件，不是 strategy；报告术语混淆 |
| 11 | 内置 `cross-session-leak`、`imitation`、`medical`、`memory-poisoning` | ⚠️ | 前三者存在；记忆投毒的规范 ID 是 `agentic:memory-poisoning`，不是裸 ID |
| 12 | DeepSeek/Qwen 有原生 provider，火山方舟/豆包没有独立 provider | ✅ | 本地存在 DeepSeek、Alibaba/Qwen provider；未发现 Volcengine/Doubao 独立 provider |
| 13 | `select-best`、`max-score` 判分器存在 | ✅ | 两者均存在；前者由模型选最佳输出，后者聚合既有断言分数，语义不同 |
| 14 | evalite 0.19.0 与 1.0 beta 并存 | ✅ | npm dist-tags 为 `latest=0.19.0`、`beta=1.0.0-beta.16` |
| 15 | evalite main 自 2025-11-10 停滞 | ✅ | main 最后提交时间确为该日；但 v1 分支此后持续开发到 2026-04，不能推成整个项目停滞 |
| 16 | evalite 是单人维护 | ⚠️ | npm 只有一个 maintainer，提交高度集中于 Matt Pocock；但 GitHub 有多名贡献者，不能字面称“只有一人” |
| 17 | evalite 自述 experimental 且会有 breaking changes | ✅ | README 明确如此表述 |
| 18 | evalite 只有平均分阈值，没有逐条硬门 | ❌ | 内置“分数阈值”确实只有全局平均值，但单个 case 的 assertion/throw 会直接令任务失败和进程退出 1 |
| 19 | evalite 没有内置断言/判分器目录 | ⚠️ | 对 0.19 main 基本成立；1.0 beta 已加入 exactMatch、contains、levenshtein、toolCallAccuracy 等 |
| 20 | BeautyPreferenceMemoryEval 用纯 Vitest 自写 runner 与现有项目“同栈、零阻抗” | ❌ | 当前项目实际使用 `node:test + tsx`，没有直接依赖 Vitest；正确的同栈方案应是现有 runner 加领域 fixture driver |

# 逐条展开

## 一、promptfoo 基础事实与维护状态

### 1. MIT、0.121.19、2026-07-14：✅属实

本地镜像明确给出版本和许可证：

- [promptfoo/package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/package.json:5)：`0.121.19`
- [promptfoo/package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/package.json:6)：`MIT`
- [promptfoo/LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/LICENSE:1)

[npm registry](https://registry.npmjs.org/promptfoo/latest) 同样返回 `0.121.19` 和 MIT；完整 registry 时间记录为 `2026-07-14T16:44:51.242Z`。

### 2. 23.4k stars、近期活跃：✅属实

核验时 [GitHub 仓库页](https://github.com/promptfoo/promptfoo) 显示约 23.4k stars；GitHub API 精确值为 23,360。

仓库在 2026-07-17 仍有 push，最近多条提交发生于 7 月 16 日。因此报告将其描述为活跃项目是有依据的。

需要注意：仓库内 [site-stats.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/src/site-stats.json:2) 仍写 20.6k stars，明显是较旧的静态营销数据，不能优先于实时 GitHub 数据。

### 3. “OpenAI、Anthropic 在用”：⚠️有官方口径，但证据等级被写高了

Promptfoo 官网源码确实写着：

> See how teams at OpenAI and Anthropic use Promptfoo...

见 [官网页面源码](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/src/pages/index.tsx:684)。GitHub 仓库介绍也使用了 “Used by OpenAI and Anthropic”。

因此：

- 作为“promptfoo 官方宣称”的事实：✅有来源。
- 作为“已被两家公司独立证实的生产使用事实”：证据不足。
- OpenAI 侧另有其发布的 [收购 Promptfoo 公告](https://openai.com/index/openai-to-acquire-promptfoo/)，关系明确。
- Anthropic 侧未找到来自 anthropic.com 或其官方文档的独立确认：**❓线上未核实**。

报告应改写成：

> Promptfoo 官方网站及仓库宣称其被 OpenAI、Anthropic 团队使用；OpenAI 关系另有官方收购公告，Anthropic 独立确认尚未核实。

### 4. “Promptfoo company 维护”：⚠️过时或不完整

本地 [README](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/README.md:23) 已写明 “Promptfoo is now part of OpenAI”。

OpenAI 的公告措辞是“将收购”，并提到惯常交割条件。报告若继续仅写 “Promptfoo company” 会遗漏当前关键治理关系。更稳妥的表述是：

> 项目原由 Promptfoo 团队主导，2026 年已进入 OpenAI 收购/整合关系；当前 README 自述为 OpenAI 的一部分。

### 5. “423/61 个 open issues”：❌字段误读

GitHub REST API 的 `open_issues_count` 同时包含 issue 和 pull request。

核验时分别为：

| 项目 | 真正 open issues | open PR | 合计 |
|---|---:|---:|---:|
| promptfoo | 96 | 327 | 423 |
| evalite | 45 | 16 | 61 |

因此报告表格把 423 和 61 直接标成 “open issues” 是明确错误。正确列名可以是“开放 issue + PR 总数”，或者分别列出 issue 与 PR。

---

## 二、promptfoo 断言、provider 与 red-team 能力

### 6. `assertScoringFunction` 硬门：✅属实

实现会汇总命名断言分数，然后调用用户提供的 scoring function，由其返回最终 `pass`、`score` 和 `reason`：

- [AssertionsResult.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/assertions/AssertionsResult.ts:209)
- [类型定义](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/types/index.ts:840)
- [官方示例文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/index.md:245)

所以类似以下逻辑完全可行：

```ts
const pass = Object.values(namedScores).every((score) => score >= 1);
```

补充一点：普通断言在没有 test threshold 时，本来就是“任一断言失败，则测试失败”。`assertScoringFunction` 的独特价值主要在于：

- 自定义关键指标集合；
- 自定义组合关系；
- 允许普通指标降级、关键指标硬失败；
- 控制最终总分与失败原因。

### 7. 报告里的 YAML 配置：❌不能正确生效

报告写的是：

```yaml
defaultTest.assertScoringFunction: file://...
```

YAML 不会把带点的键自动解释为嵌套对象。Promptfoo 的 schema 识别的是顶层 `defaultTest`，其内部再放 `assertScoringFunction`。

正确写法是：

```yaml
defaultTest:
  assertScoringFunction: file://assert-scoring.ts
```

官方文档也使用这一结构，见 [expected-outputs 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/index.md:264)。

这是报告中影响实际落地的高优先级错误：如果照抄原示例，硬门函数可能被忽略或在校验阶段报错。

### 8. JavaScript/Python 自定义断言：✅属实

JavaScript 断言支持返回：

- `boolean`
- `number`
- 完整 `GradingResult`

证据见 [JavaScript assertions 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/javascript.md:60)。

Python 同样支持自定义断言和结构化评分结果，见 [Python assertions 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/python.md:120)。

### 9. TS provider 包装整条应用管线：✅属实，但要保留运行时约束

自定义 provider 的 `callApi` 可以调用数据库、HTTP 服务、agent orchestration 或应用内部函数，最后返回 `ProviderResponse`。因此把整条美业生成管线视作一个 target 是可行的。

证据见 [custom provider 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/providers/custom-api.md:77)。

但报告应补充官方给出的限制：

- TS provider 在 Node.js 环境加载；
- 依赖浏览器全局对象的应用代码不能直接运行；
- bundler alias、CSS import、前端专用模块可能需要适配；
- 必要时应预编译成 Node 可加载模块，或改为 HTTP provider。

相关说明见 [同一文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/providers/custom-api.md:252)。

### 10. 自定义 policy 示例原文：⚠️原文属实，分类名称有误

官方配置文档确实包含：

- “不得泄露其他客户数据”
- “未经经理批准不得越权退款”

对应英文原文可在 [red-team configuration](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-research-2026-07-17/../repos/harness-2026-07-17/promptfoo/site/docs/red-team/configuration.md:484) 的 policy 示例中找到。

问题在于：`policy` 属于 **plugin**，并不是 strategy。

二者作用不同：

- plugin：定义要测试什么风险；
- strategy：定义如何构造或变换攻击。

因此报告里的“自定义策略插件”应改成“自定义 policy 插件”。

### 11. 四个插件名称：⚠️记忆投毒 ID 写错

本地注册表确认：

- `cross-session-leak`：存在
- `imitation`：存在
- `medical`：存在，但还涉及风险集合/展开逻辑
- 记忆投毒：存在，但规范 ID 是 `agentic:memory-poisoning`

证据：

- [插件索引](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/redteam/plugins/index.ts:503)
- [插件常量](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/redteam/constants/plugins.ts:158)
- [memory poisoning 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/red-team/plugins/memory-poisoning.md:41)

报告如果直接建议配置 `memory-poisoning`，可能无法匹配规范插件 ID。

### 12. DeepSeek/Qwen 原生、方舟/豆包无独立 provider：✅属实

本地存在：

- [deepseek.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/providers/deepseek.ts:1)
- [alibaba.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/providers/alibaba.ts:1)

provider registry 也注册了 Alibaba/Qwen 和 DeepSeek，见 [registry.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/src/providers/registry.ts:175)。

在 provider 源码和官方 provider 文档中未发现 `volcengine`、`doubao` 或独立 Ark provider。因此报告的 grep 结论成立。

火山方舟提供 OpenAI SDK 兼容接口及 `/api/v3` base URL，见 [火山引擎官方文档](https://www.volcengine.com/docs/82379/1795150)。所以通过 OpenAI-compatible provider 接入是合理路线，但最终兼容性仍需用实际模型、鉴权头和返回结构进行请求验证。

### 13. `select-best`、`max-score`：✅属实

两者都有官方文档和实现：

- [select-best](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/model-graded/select-best.md:1)
- [max-score](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/promptfoo/site/docs/configuration/expected-outputs/model-graded/max-score.md:1)

但不能将二者笼统描述成同类判分器：

- `select-best`：让模型在多个候选输出中选最好者；
- `max-score`：根据其他断言已产生的分数选最高者，本身不是独立语义 judge。

---

## 三、evalite 版本、维护和门禁能力

### 14. 0.19.0 与 1.0 beta 并存：✅属实

[npm registry](https://registry.npmjs.org/evalite/latest) 的 dist-tags 为：

```text
latest = 0.19.0
beta   = 1.0.0-beta.16
```

本地 main 的 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/packages/evalite/package.json:2) 也是 0.19.0。

不过把 0.19.0 称为“稳定版”容易误导。它只是 npm 的非 prerelease `latest`；项目自身仍明确称 experimental。

### 15. main 自 2025-11-10 停滞：✅字面属实，但不能外推成整个项目停滞

本地 main 最后提交为 2025-11-10 UTC；东八区日期可能显示为 11 月 11 日。

但 v1 分支此后仍有约 192 个提交，开发持续到 2026-04-28。因此正确结论是：

> 0.19/main 已停止推进，开发重心转向 v1 beta；不是整个项目从 2025-11 起完全无开发。

这一事实反而支持“版本迁移风险较高”，但不支持“项目无人维护”。

### 16. 单人维护：⚠️维护权集中，但不是字面单人项目

npm 元数据仅列出 Matt Pocock 一名 maintainer，GitHub 也位于个人账号下，提交量高度集中于他。这足以说明 bus factor 偏低。

但 GitHub contributors 中还有多名实际贡献者，第二名及后续贡献者也有提交。因此建议改成：

> 个人主导、npm 发布权单点、贡献和维护权高度集中。

这比“单人维护”更准确。

### 17. experimental + breaking changes：✅属实

本地 README 明确写着 Evalite 仍是实验性项目，并会持续推送 breaking changes：

[evalite README](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/packages/evalite/readme.md:16)

这是报告反对把 Evalite 当长期骨干时最扎实的事实依据之一。

### 18. “只有平均分阈值，无逐条硬门”：❌混淆了分数阈值与测试失败机制

Evalite 的 `--threshold=70` 确实基于所有 score 的全局平均值：

- [CI 文档](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/apps/evalite-docs/src/content/docs/guides/ci.mdx:138)
- [reporter 实现](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/packages/evalite/src/reporter.ts:216)

但每条 data point 本身是独立测试。task/scorer 内 assertion 或 throw 会：

1. 把该 case 标为失败；
2. 由 runner 设置退出码 1；
3. 使 CI 硬失败。

证据见：

- [evalite.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/packages/evalite/src/evalite.ts:275)
- [EvaliteRunner.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/evalite/packages/evalite/src/reporter/EvaliteRunner.ts:48)

准确说法应是：

> Evalite 内置的“分数型门槛”只有全局平均 threshold，没有 promptfoo 那样成熟的每指标阈值和组合 DSL；但单条 case 可以通过 assertion/throw 实现硬失败。

甚至使用 0/1 scorer 配合 threshold 100，也能间接实现全量通过门，只是表达力和诊断体验较弱。

### 19. “没有内置断言目录”：⚠️只适用于 0.19

0.19 main 确实没有 promptfoo 那种丰富的内置断言和模型判分目录，主要依赖用户 scorer 或外部库。

但 1.0 beta 已经加入：

- `exactMatch`
- `contains`
- `levenshtein`
- `toolCallAccuracy`

后续 v1 源码还包含 faithfulness、answer similarity、answer relevancy、context recall 等。因此报告把 0.19 代码观察直接外推到整个 Evalite 当前产品线，不够准确。

即便修正，这些能力的规模、组合表达和 red-team 覆盖仍显著弱于 promptfoo。

---

## 四、两条核心结论复核

### 结论 A：“主推荐 promptfoo、evalite 不作骨干”

**裁定：成立，但事实链必须修正。**

仍然支持 promptfoo 做主骨干的事实：

- 断言类型、模型判分和组合能力明显更完整；
- `assertScoringFunction` 可以明确表达关键指标硬门；
- 支持 JS/Python 自定义断言；
- provider 接口适合包装完整 agent/生成管线；
- red-team 插件和策略体系成熟；
- 仓库在核验日期仍高度活跃；
- Evalite 明确自述 experimental，并处于 0.19 与 v1 beta 迁移期；
- Evalite 缺少 promptfoo 等量级的 red-team、复杂断言组合和官方 PR 工作流。

需要从推理链中删除或修正的论据：

- “Evalite 无法逐条硬失败”是错的；
- “Evalite 没有内置 scorer”只适用于 0.19；
- “单人维护”应改为维护权高度集中；
- Promptfoo 的 OpenAI/Anthropic 使用应标为官方自述，而非双方独立确认；
- 报告的 `assertScoringFunction` YAML 示例必须修正。

所以，“Evalite 不作长期骨干”仍合理，但原因应是**成熟度、版本迁移、组合表达、red-team 覆盖和维护集中度**，而不是“它只能看平均分、不能硬失败”。

### 结论 B：“BeautyPreferenceMemoryEval 用纯 Vitest 自写 runner 最顺”

**裁定：动摇，按当前项目事实不成立。**

项目现有测试栈不是 Vitest：

- 根脚本调用工作区测试及 Node test：[根 package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/package.json:21)
- Core 使用 `tsx --test`：[apps/core/package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/package.json:24)
- Canvas 使用 `tsx --test`：[apps/canvas/package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/canvas/package.json:11)
- 实际测试导入 `node:test` 和 `node:assert/strict`：[product-service.test.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/product/product-service.test.ts:1)

项目 manifests 中没有直接 Vitest 依赖；lockfile 中出现 Vitest 只是传递依赖，不能称为“同栈”。

因此“纯 Vitest、同 runner、零阻抗”是明确的项目事实错误。更合适的方案是：

> 使用现有 `node:test + tsx + node:assert/strict`，新增一个领域级多轮 fixture driver，负责运行“写入偏好 → 跨会话读取 → 冲突更新 → 隔离验证”等状态序列。

这里应区分：

- 不需要“自写测试 runner”；
- 需要的是运行在现有 runner 上的**领域 harness/fixture driver**。

BeautyPreferenceMemoryEval 采用代码级状态机测试的总体方向是对的，因为它涉及：

- 多轮状态变迁；
- 跨 session 数据持久性；
- 用户隔离；
- 更新/覆盖规则；
- 可确定性数据库断言。

但 runner 应选现有 `node:test`。如果未来需要统一的 eval UI、trace、历史趋势和 scorer 展示，Evalite 也可以把一整段多轮 fixture 包为一个 data point，并用 assertion/throw 硬失败；不能再用“Evalite 只有平均分门”作为排除理由。

# 总裁定

## 报告总裁定：**成立但需修正**

主方向——**promptfoo 作为通用评测与 red-team 骨干，Evalite 暂不承担长期骨干角色**——经交叉验证后仍成立。

但报告包含 4 个明确错误：

1. 把 GitHub `open_issues_count` 当成纯 issue 数；
2. `defaultTest.assertScoringFunction` YAML 嵌套写错；
3. 声称 Evalite 没有逐条硬失败能力；
4. 声称当前项目使用 Vitest，因此 BeautyPreferenceMemoryEval 选择 Vitest“同栈、零阻抗”。

另有 6 项需要降级或补充限定，包括 OpenAI/Anthropic 使用证据等级、维护主体、policy/plugin 术语、记忆投毒规范 ID、Evalite 单人维护表述和 beta 内置 scorer。

最终建议：

- 保留“promptfoo 主推荐”；
- 保留“Evalite 暂不作骨干”，但重写支撑论据；
- 修复 promptfoo YAML 示例后再允许照抄落地；
- 将 BeautyPreferenceMemoryEval 改为 **`node:test + tsx` 上的领域 fixture driver**；
- 将“OpenAI/Anthropic 在用”注明为 promptfoo 官方口径，其中 Anthropic 独立确认标记为 **❓线上未核实**。