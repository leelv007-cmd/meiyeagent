# #324 P2-12 交底 —— 爆款复刻端到端（粘贴轨先行）

- 分支：`legacy-origin-a/lane-324`（worktree `lane-324`）；**未 push、未关票**，合入与批换锚由主控执行。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.3 / §5 / §8.3 P2-4 / §8.4。
- 前置（merge-ledger）：#315、#317、#319 已关票。
- 关联：OpenCLI live 核销与链接主路径转正 → **#328**（本票仅保留 UI 位 + 诚实不可用）。

---

## 一、「实施时定」闭合

### 1.1 仿写 prompt 位点命名（承接 #315 §3）

| 项 | 定案 |
| --- | --- |
| 仿写 NotePlan | `xhsViralRewrite` → Langfuse `harness/xhs-viral-rewrite` |
| 图片复刻 vision | `xhsViralImageVision` → Langfuse `harness/xhs-viral-image-vision` |
| 注册表 | 仍唯一 `HARNESS_PROMPT_SITES`（#315 扩展模型） |
| 计数 | 14 core + **8** XHS = **22**（#315 的 6 + 本票 2） |
| 消费点 | rewrite：formal `recipe.viral_adapt` + paste marker → `ModelSupplyNotePlanStructuredPort.plan`；vision：真实 source asset ids → `freezeAutoTextRouteForExecution` + `text.respond/reference_image` → `ImageIntent.scene/composition` |
| 输出契约 | rewrite 只能输出现有 `note-plan/v1`；不再声明与 `notePlanSchema` 冲突的 title/body/tags 根对象 |
| pin 政策 | 不变：strict 全表 pin；pilot builtin-v1 fallback |

### 1.2 OpenCLI live 门默认态

| 项 | 定案 |
| --- | --- |
| 默认 | **关闭**（`evidencePresent !== true`） |
| 商家文案 | 「暂不可用（OpenCLI live 门未核销）」—— **不得** 写「已可用」 |
| 转正 | 仅 #328 在真实账号 note+download 核销证据齐全后，由主控/该票打开 |
| 粘贴轨 | 始终可用；确认卡明示「粘贴笔记文字」/「粘贴 + 上传图片」 |

### 1.3 rawInput 标记（Web ↔ Core）

| 项 | 值 |
| --- | --- |
| Marker | `[viral_adapt_source:paste]` |
| 权威 | core `apps/core/src/p1/harness/viral-adapt.ts`；web 镜像同字符串 |
| 作用 | note-plan 阶段识别爆款粘贴轨并注入 `xhsViralRewrite` |

### 1.4 Recipe seed

| 项 | 值 |
| --- | --- |
| recipeId | `recipe.viral_adapt` |
| variantKey | `viral_adapt` |
| lens / deliverable | `image_text` / `note` |
| workflow | `workflow.image_text@1`（走既有 note 全链） |
| 取材 | 粘贴正文进 rawInput；可选 `viral_reference_image` 图槽（非抓取）；仅接受 Composer 完成上传与授权后的真实 asset id |

---

## 二、旅程与文件

| 阶段 | 行为 | 文件 |
| --- | --- | --- |
| Idle chip | 「爆款复刻」handoff 含 `recipeChipId: 'viral_adapt'` | `idle-suggestion-chips.ts` |
| 补问取材 | 粘贴正文 + 可选参考图；图片 CTA 只聚焦现有 rights-aware `ComposerImageInput`，不制造标签/资产；OpenCLI 位保留且 disabled | `viral-adapt-sourcing-card.tsx` / `composer-home.tsx` |
| 确认卡 | 明示取材方式 + 规格 + OpenCLI 诚实状态 | `viral-adapt-confirm-card.tsx` |
| 提交意图 | marker + 粘贴正文 + 真实 `参考图资产：<assetId>` → Composer intent；精确绑定 visible published `recipe.viral_adapt` | `viral-adapt-journey.ts` + `recommendation-handoff.ts` + `composer-home.tsx` |
| Core 仿写→note | rewrite 语境物化后走 `notePlanSchema`；有图时 vision 走参考图多模态路由并落 `ImageIntent`；carrier=note 投影 | `viral-adapt.ts` / `note-plan-structured-port.ts` / `unified-media-stage-ports.ts` |

红线：无匿名抓取 / 逆向签名 / 账号池（`viral-adapt.static.test.ts`）。

---

## 三、验收映射

| 票面验收 | 证据 |
| --- | --- |
| live 门未过仅粘贴轨 + 文案诚实 | core `viral-adapt.test.ts`；web `viral-adapt.interaction.test.tsx` / `viral-adapt-journey.test.ts` |
| 确认卡明示取材方式 | 同上 + `projectViralAdaptConfirm` / `projectViralAdaptConfirmView` |
| 仿写产出 note 口径全链 | `runViralAdaptPasteToNoteProjection` carrier=`note`；note-plan 注入 `xhsViralRewrite`；recipe `deliverableKind: 'note'` |
| 真实上传，无伪资产 | web interaction：点图片 CTA 只调 host upload seam，未附加时不出现“参考图 1”/“已上传”；真实 asset id 才进 submit intent |
| formal Recipe fail-closed | `recommendation-handoff.test.ts`：跳过同 lens 默认 recipe，精确绑定 `recipe.viral_adapt`；不可见时不绑定；Core 错 recipe 返回 `VIRAL_ADAPT_RECIPE_MISMATCH` |
| vision 真消费 | `unified-media-stage-ports.test.ts`：断言 `inputAssets=[{assetId, role:'reference_image'}]`、`xhsViralImageVision` prompt binding、结果进 `ImageIntent`；无图 0 额外 VLM call |
| 红线 | `viral-adapt.static.test.ts` |

### 3.1 VLM 激活与失败边界

- 只有 `snapshot.recipe.id === 'recipe.viral_adapt'` + 可解析 paste marker + 参考 asset id 同时存在于 frozen `snapshot.sources.assets` 和 authorized `rightsRefs` 时才调 vision。
- 无图：不调 VLM，不伪造风格分析；错 recipe / 越界 asset：409 fail-closed。
- 缺 vision port、缺 reference-image-capable frozen route、缺 prompt，或 provider 返回不合法 JSON：502 fail-closed，不降级到 fixture 风格。
- vision 提交仍携带 frozen `text.respond` route、`billingTaskId`、`billingQuoteRevision` 与 prompt binding；后续页图仍走原 NotePlan 媒体生成/报价/执行边界，本票未增加旁路运行时。

---

## 四、非本票范围

- OpenCLI live 实测核销与链接轨转正（#328）。
- e2e 全量（主控）。
- 匿名抓取 / 签名逆向 / 账号池（永久红线）。
- 新 agent runtime；Tiptap 不进 Composer。

---

## 五、运维注意（合入后）

strict 部署须 `langfuse:prompts:push` 并 pin **全部 22** key（含 `xhsViralRewrite` / `xhsViralImageVision`）；缺 pin → strict resolve 失败关闭（与 #315 全表冻结同构）。

> 状态边界：本分支只更新 builtin/消费者与测试，**未执行外部 Langfuse push，也未改 pin**。合入前由主控完成 strict push + 22-key pin 并重跑验收。
