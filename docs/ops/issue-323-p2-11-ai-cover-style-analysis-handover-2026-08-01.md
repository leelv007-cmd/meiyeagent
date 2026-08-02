# #323 P2-11 交底 —— AI 封面与参考图风格分析

- 分支：`leelv007-cmd/lane-323`（worktree `/Users/bin/orca/workspaces/美业内容2/lane-323`）
- **未 push、未关票**；合入与 P1 齐验门由主控执行
- 开工基线 sha：`69cf06e1a6e18734fcefef8122a833e8a4b8e3a7`
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.2 / §4.8 / §4.10 / §6.1
- 前置 prompt 位点：#315（`xhsCoverPrompt` / `xhsStyleAnalysis` 已挂 Langfuse 注册表）

---

## 0. 2026-08-02 合入门复核与修复

复核结论：原提交的绿测试只覆盖 helper / 纯投影 / 局部 interaction，产品主路没有真正消费这些结果。具体缺口是：

1. AI 封面的比例、美业预设、size 未进入 quote-signed Composer 契约，Core 编译和 Model Supply 提交也没有读取它们；
2. Result Center 工具按钮没有可达出口，Delivered 预填在 frozen 状态下不会形成新提交；
3. `@素材` 控件没有写入 canonical `role=style`，七维分析没有走 Model Supply 多模态路径，更没有进入 NotePlan 和最终配图 prompt / constraints；
4. 时间线文案函数没有生产调用者。

本次修复已把上述四个缺口接入真实提交、准入、Model Supply 和配图执行链，并增加 RED→GREEN 回归证据。

---

## 一、「实施时定」闭合：AI 封面 size 映射（§4.2）

| 产品比例 | Provider size (`WxH`) | 定案理由 |
| --- | --- | --- |
| `3:4` | `1536x2048` | 小红书主竖版；对齐 Seedream 生成可接受长宽 |
| `1:1` | `2048x2048` | 方图 / 朋友圈；live 探针安全正方形 |
| `9:16` | `1152x2048` | 全屏竖版封面 |

权威落点：

- Core：`apps/core/src/p1/harness/xhs-cover.ts` → `XHS_COVER_SIZE_MAP`
- Web 镜像：`mkfast-template-main/src/product/composer/ai-cover-action.ts` → `AI_COVER_SIZE_MAP`

美业预设（替换通用 preset，#315 已写 builtin）：  
`beauty_soft` / `beauty_editorial` / `before_after` / `spa_minimal` / `salon_photo`

---

## 二、行为与挂点

### 2.1 AI 封面

| 面 | 行为 |
| --- | --- |
| Idle | **无**一级入口（`AI_COVER_IDLE_PRIMARY_ENTRY = false`；普通工具条无「封面」chip） |
| Delivered | 次级动作「生成 AI 封面」→ 展开三比例可选 → 预填 Composer intent（**不自动提交**） |
| 对象工作区 | Image worksurface 工具 chip「生成 AI 封面」（`data-testid=image-ai-cover-tool`） |
| 付费门 | 封面 reservation 仅 `image` units → `triggersPaidMediaExecution === true` |
| 契约 / 执行 | 比例 + preset + size 由 quote 签名；Core 物化冻结 prompt，Model Supply 提交真实 `width` / `height` |

### 2.2 参考图风格分析（七维）

| 维 | 协议键 |
| --- | --- |
| 1–7 | 画风 / 配色 / 背景 / 文字风格 / 装饰元素 / 排版结构 / 整体调性 |

| 面 | 行为 |
| --- | --- |
| Composer | `@素材 · 用作风格参考` 控件 + `@素材` 文案识别 |
| 时间线 | 阶段文案：`正在分析参考图风格（七维），后续配图会按同一风格保持一致` |
| Model Supply | canonical `role=style` 转换为授权 `reference_image`，走现有 pinned structured runner / 多模态 provider 路径 |
| 配图链 | `consistencyRequirements` 注入七维；`{styleAnalysisBlock}` 注入 NotePlan 与每页生图 prompt；七维缺一则 fail closed |

---

## 三、关键文件

| 文件 | 角色 |
| --- | --- |
| `apps/core/src/p1/harness/xhs-cover.ts` | size 映射、预设、prompt 物化、付费 reservation |
| `apps/core/src/p1/harness/xhs-style-analysis.ts` | 七维 parse / inject / consistency 消费 |
| `apps/core/src/p1/harness/merchant-delivery-language.ts` | `merchantStyleAnalysisProgress` |
| `apps/core/src/p1/harness/unified-media-stage-ports.ts` | AI 封面编译、精确尺寸提交、七维分析与 NotePlan / 配图消费 |
| `apps/core/src/p1/model-supply/structured-node-runner.ts` | 结构化节点的授权多模态输入 |
| `packages/contracts/src/composer-submission.ts` | quote-signed AI 封面闭集契约 |
| `mkfast-template-main/src/product/composer/ai-cover-action.ts` | Delivered / workspace 纯投影 |
| `mkfast-template-main/src/product/composer/style-analysis-entry.ts` | @素材入口纯投影 |
| `mkfast-template-main/src/product/composer/composer-home.tsx` | 真实 AI 封面预填 / 新 session / signed 提交，以及 `role=style` 写入 |
| `mkfast-template-main/src/product/composer/composer-delivery-card.tsx` | Delivered 次级 UI |
| `mkfast-template-main/src/product/composer/composer-style-reference-control.tsx` | @素材控件 |
| `mkfast-template-main/src/product/results/image-worksurface-model.ts` | 对象工作区工具投影 |
| `mkfast-template-main/src/product/results/image-worksurface.tsx` | 工具 chip |

---

## 四、验收映射（行为为证）

| 票面验收 | 证据 |
| --- | --- |
| 封面生成走付费媒体确认门且三比例可选（core + interaction） | `composer-submission.test.ts` + `composer-http.test.ts` + `unified-media-stage-ports.test.ts`（签名、准入、精确宽高提交）；`composer-ai-cover.interaction.test.tsx`（三比例可选） |
| 风格分析产出七维结构并被配图链消费（core） | `unified-media-stage-ports.test.ts`（生产 NotePlan + 两页生图消费）；`structured-node-runner.test.ts`（授权参考图进入 provider 请求） |
| 时间线真实上报 | `workflow-core.test.ts`（`running` 七维阶段早于 styles-ready 人工选择） |
| Result Center 按钮可达 | `result-merchant-truth.interaction.test.tsx`（enabled + click 触发真实出口） |
| Idle 无一级入口 | `ai-cover-action.test.ts` + `COMPOSER_TOOL_ENTRY_SEEDS` 负向 |
| 触达 e2e | 留给主控全量；lane 内 focused unit/interaction 绿 |

---

## 五、验证命令（本机 lane）

```bash
# contracts
pnpm --filter @meiye/contracts exec tsx --test \
  src/composer-submission.test.ts

# core production paths
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/xhs-cover.test.ts \
  src/p1/harness/xhs-style-analysis.test.ts \
  src/p1/harness/unified-media-stage-ports.test.ts \
  src/p1/model-supply/structured-node-runner.test.ts

# web unit
pnpm --filter @meiye/web exec tsx --test \
  src/product/composer/ai-cover-action.test.ts \
  src/product/composer/style-analysis-entry.test.ts \
  src/product/results/image-worksurface-model.test.ts

# web interaction（注意：同 worktree 不与 dev 并跑；先 locale 若需要）
pnpm --filter @meiye/web exec vitest run \
  src/product/composer/composer-ai-cover.interaction.test.tsx \
  src/product/composer/composer-style-reference.interaction.test.tsx \
  src/product/results/result-merchant-truth.interaction.test.tsx

# compile gates
pnpm --filter @meiye/contracts typecheck
pnpm --filter @meiye/core typecheck
pnpm --filter @meiye/web build
pnpm --filter @meiye/web typecheck
```

---

## 六、非本票 / 遗留

1. 不重写对象工作区编辑器壳（#322 属主）；本票只挂 AI 封面工具 chip。
2. 不接爆款链接主路径（#324）。
3. 全链路 live 生图（真实 provider 出图）与 e2e 全量由主控在 P1 齐验后门一并核。
