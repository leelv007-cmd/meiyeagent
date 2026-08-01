# #323 P2-11 交底 —— AI 封面与参考图风格分析

- 分支：`leelv007-cmd/lane-323`（worktree `/Users/bin/orca/workspaces/美业内容2/lane-323`）
- **未 push、未关票**；合入与 P1 齐验门由主控执行
- 开工基线 sha：`69cf06e1a6e18734fcefef8122a833e8a4b8e3a7`
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.2 / §4.8 / §4.10 / §6.1
- 前置 prompt 位点：#315（`xhsCoverPrompt` / `xhsStyleAnalysis` 已挂 Langfuse 注册表）

---

## 一、「实施时定」闭合：AI 封面 size 映射（§4.2）

| 产品比例 | Provider size (`WxH`) | 定案理由 |
| --- | --- | --- |
| `3:4` | `1536x2048` | 小红书主竖版；对齐 Seedream 生成可接受长宽 |
| `1:1` | `2048x2048` | 方图 / 朋友圈；live 探针安全正方形 |
| `9:16` | `1440x2560` | 全屏竖版封面 |

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

### 2.2 参考图风格分析（七维）

| 维 | 协议键 |
| --- | --- |
| 1–7 | 画风 / 配色 / 背景 / 文字风格 / 装饰元素 / 排版结构 / 整体调性 |

| 面 | 行为 |
| --- | --- |
| Composer | `@素材 · 用作风格参考` 控件 + `@素材` 文案识别 |
| 时间线 | 阶段文案：`正在分析参考图风格（七维），后续配图会按同一风格保持一致` |
| 配图链 | `consistencyRequirements` 注入七维；`{styleAnalysisBlock}` 注入 `xhsOutline` |

---

## 三、关键文件

| 文件 | 角色 |
| --- | --- |
| `apps/core/src/p1/harness/xhs-cover.ts` | size 映射、预设、prompt 物化、付费 reservation |
| `apps/core/src/p1/harness/xhs-style-analysis.ts` | 七维 parse / inject / consistency 消费 |
| `apps/core/src/p1/harness/merchant-delivery-language.ts` | `merchantStyleAnalysisProgress` |
| `mkfast-template-main/src/product/composer/ai-cover-action.ts` | Delivered / workspace 纯投影 |
| `mkfast-template-main/src/product/composer/style-analysis-entry.ts` | @素材入口纯投影 |
| `mkfast-template-main/src/product/composer/composer-delivery-card.tsx` | Delivered 次级 UI |
| `mkfast-template-main/src/product/composer/composer-style-reference-control.tsx` | @素材控件 |
| `mkfast-template-main/src/product/results/image-worksurface-model.ts` | 对象工作区工具投影 |
| `mkfast-template-main/src/product/results/image-worksurface.tsx` | 工具 chip |

---

## 四、验收映射（行为为证）

| 票面验收 | 证据 |
| --- | --- |
| 封面生成走付费媒体确认门且三比例可选（core + interaction） | `xhs-cover.test.ts`（gate + 三比例）；`composer-ai-cover.interaction.test.tsx`（三比例可选 + 不误开 Result Center） |
| 风格分析产出七维结构并被配图链消费（core） | `xhs-style-analysis.test.ts`（parse 7 维 + consistencyRequirements + outline inject） |
| Idle 无一级入口 | `ai-cover-action.test.ts` + `COMPOSER_TOOL_ENTRY_SEEDS` 负向 |
| 触达 e2e | 留给主控全量；lane 内 focused unit/interaction 绿 |

---

## 五、验证命令（本机 lane）

```bash
# core
pnpm --filter @meiye/core exec tsx --test \
  src/p1/harness/xhs-cover.test.ts \
  src/p1/harness/xhs-style-analysis.test.ts

# web unit
pnpm --filter @meiye/web test -- \
  src/product/composer/ai-cover-action.test.ts \
  src/product/composer/style-analysis-entry.test.ts \
  src/product/results/image-worksurface-model.test.ts

# web interaction（注意：同 worktree 不与 dev 并跑；先 locale 若需要）
pnpm --filter @meiye/web test:interaction -- \
  src/product/composer/composer-ai-cover.interaction.test.tsx \
  src/product/composer/composer-style-reference.interaction.test.tsx
```

---

## 六、非本票 / 遗留

1. 不重写对象工作区编辑器壳（#322 属主）；本票只挂 AI 封面工具 chip。
2. 不接爆款链接主路径（#324）。
3. 全链路 live 生图（真实 provider 出图）与 e2e 全量由主控在 P1 齐验后门一并核。
4. Composer 草稿 → Core 提交路径把 `styleReferenceAssetIds` 写入 `imageIntent.references[].slot=style_ref` 的 HTTP 粘合可随后续接线加强；本票已钉纯模型 + 控件 + 配图链消费。
