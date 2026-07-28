# 票 24 · 点睛动效 1-2 处懒加载 + 模型卡内部标识净化
> 阶段: Phase 5 · 一致性与视觉收尾 ｜ 差距: P2-4、P2-2 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "24",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P2-2",
    "P2-4"
  ],
  "contractIds": [
    "I12"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P2-4 `[已核实]`：差距报告 §五指出点睛动效层零落地；生成中缺少情绪锚点，发布完成态也没有与结果相称的反馈。既定边界是仅在 1–2 处懒加载点睛，不能全站铺动效。
- P2-2 `[部分核实]`：`/settings/models` 的文案 LLM 卡副标题会把 `recorded-openai-copy`、`recorded-v1` 等内部占位标识直接展示给店主；`displayName` 已净化，但 `stableModelName/version` 尚未经过生产视图净化。
- 根因对应差距报告 §一根因四：模板和内部工程标识进入了产品界面，属于产品化收尾断层；本票只修 P2-2/P2-4，不扩成模板品牌或全站文案清扫。
- 口径纠偏：报告概括“发布完成仅 `toast.success`”，当前代码里的成功 toast 实际对应“L1 已提交”或“L3 发布包已建立”，都不等于真实发布完成；真实 `published` 目前主要只显示 Badge。因此庆祝动效必须绑定真实状态从非 `published` 迁移为 `published`，不得绑定提交成功。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/catalog.ts:212-231`：默认模型目录；其中 `:218-221` 四个 LLM 种子仍保存 `recorded-*-copy` 与 `recorded-v1`。报告行号准确；这些值属于内部目录事实，不在本票删除。
- `mkfast-template-main/src/p1/settings-view-model.ts:270-274`：`publicModelName()` 已去掉 `Direct/Managed`；`:342-381` 仍把原始 `stableModelName/version` 透传进店主视图。报告所引 `:378-381` 准确。
- `mkfast-template-main/src/p1/model-settings.tsx:110-140`：模型卡副标题直接拼接 `manufacturer/stableModelName/version`；报告所引 `:134-140` 准确。`:385-420` 另有 Auto 卡，但本票不得借净化改动新增、启用或扩大任何跨品牌 Auto。
- `mkfast-template-main/src/routes/settings/models.tsx:7-32`：店主可见入口为 `/settings/models`，`ModelSettings` 在该页直接渲染。
- `mkfast-template-main/package.json:37-101` 与 `pnpm-lock.yaml`：实核无 Magic UI、Aceternity、Confetti、`motion`/`framer-motion` 依赖或实现；差距仍成立。
- `mkfast-template-main/src/components/uiux/state-panel.tsx:12-17`：状态类型没有 success；`:52-57` 的 loading 反馈只有 `animate-spin`。不应把通用 `StatePanel` 全局动画化。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:936-960`：生成 Job 区只展示静态执行记录与 `ProductStatus`，是生成中点睛动效的精准挂载点。
- `mkfast-template-main/src/product/mobile-action-book.tsx:322-399`：L1 提交/L3 建包成功只触发 toast，但均非真实发布完成；`:748-769`、`:854-869` 才依据 `currentL1Job.status/currentHandoff.status === 'published'` 显示真实发布态。
- `mkfast-template-main/src/styles.css:235-244`：产品壳已统一尊重 `prefers-reduced-motion`，新增动效须沿用该降级纪律。

## 改造方案（步骤级 + 涉及文件清单）

1. 在店主视图边界净化模型元数据：保留 manufacturer 与可公开的正式型号/版本，过滤 `recorded-*`、内部 copy 占位版本等非产品标识；后端 catalog、部署解析、审计数据均不改。
2. 让模型卡只消费净化后的公开元数据；文案 LLM 卡副标题最少仍可读到厂商，不以空白、`undefined` 或内部 id 代替。
3. 在 Job 为 `submitting/running` 时懒加载一处轻量 AnimatedShinyText 风格状态提示；原有状态文字与可访问性播报保留为加载失败/慢网 fallback，动效只作视觉增强。
4. 在移动发布流中监听同一 Job/Handoff 从非 `published` 到 `published` 的真实迁移，懒加载一次轻量 Confetti；以对象 id 去重，刷新后面对既有 published 记录不重放，L1 submitted 与 L3 handoff created 均不触发。
5. 两处动效均遵守 `prefers-reduced-motion`：用户选择减少动态效果时展示静态状态，不播放闪动或粒子；不在技能卡墙、全局 StatePanel 或其他页面扩散。
6. 补模型元数据净化回归覆盖，以及发布状态迁移/重复触发的行为覆盖；验证 slow-network fallback、减少动态效果和真实 published 触发语义。

涉及文件：

- 修改 `mkfast-template-main/src/p1/settings-view-model.ts`
- 修改 `mkfast-template-main/src/p1/settings-view-model.test.ts`
- 视实现需要微调 `mkfast-template-main/src/p1/model-settings.tsx`
- 新增 `mkfast-template-main/src/components/uiux/generation-accent.tsx`
- 新增 `mkfast-template-main/src/components/uiux/publish-celebration.tsx`
- 修改 `mkfast-template-main/src/product/unified-creation-workbench.tsx`
- 修改 `mkfast-template-main/src/product/mobile-action-book.tsx`
- 仅在 Confetti 实现确需轻量运行库时修改 `mkfast-template-main/package.json` 与 `pnpm-lock.yaml`；优先使用既定 copy-in/轻依赖方案，不引入整套 UI 框架。

明确不改：

- `apps/core/src/p1/model-supply/catalog.ts` 的内部目录与审计事实。
- D4 的 3 选 1 单选、换一批、免费重试 ≤2；D3 的对话式外壳/结构化内核（非 chat clone）。
- L-1 贴链接抓取（已 de-scope）；任何跨品牌 Auto（禁止），以及任何模型静默切换逻辑。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 店主打开“设置 > 模型 > 文案 LLM”时，四张卡均不再出现 `recorded`、`*-copy`、`recorded-v1` 等内部字符串；卡片仍显示清晰的公开模型名、厂商与能力信息。
- 店主切换文案、图片、视频模型时，合法的公开型号/版本仍正常显示；页面没有空副标题、`undefined` 或内部路由词，净化改动没有新增跨品牌 Auto 入口或静默切换行为。
- 用户提交生成任务后，在 `submitting/running` 阶段能看到一处克制的动态状态提示；慢网或动效资源尚未加载时，原状态文字立即可见，不出现空白或布局跳变。
- 只有真实发布状态从未发布变为 `published` 时播放一次庆祝反馈；“L1 已提交”“L3 发布包已建立”、页面刷新和重复查询都不会误放或重复播放。
- 开启系统“减少动态效果”后，上述两处均以静态反馈呈现，生成状态与真实发布结果仍清楚可辨。
- 截图对照项：证据包至少包含一组“当前产品生成中 + 真实发布完成”与即梦或 KickArt 对应状态的同屏对照，并附本产品改造前/后截图；截图须能看出情绪锚点已补齐且未遮挡任务状态、操作按钮或结果内容。
- `/settings/models` 另留一张改造前/后同位置截图，肉眼可确认内部标识消失且公开信息未被一并删空。

## Blocked-by / Blocks

- Blocked-by：无，可独立进入开发。
- 全局关票门禁：票 02 完成前，本票即使行为已交付也不得关票；最终须按验收矩阵 v2 的体验合同复验。
- Blocks：无直接后续票；本票验收证据计入 Path B Exit milestone，随全部 required 票完成后参与逐屏截图验收与 24 条差距回写。

## 风险与回退

- 误触发风险：把“提交/建包成功”当成“发布完成”会制造错误信心。防线是只监听真实 `published` 状态迁移并按对象 id 去重；回退时移除庆祝挂载，不改变发布状态机与 toast。
- 性能风险：粒子或动画进入首包、全局渲染会掉帧。防线是两处独立懒加载、静态 fallback、禁止改通用 `StatePanel`；回退可单独关闭任一动效而不影响主流程。
- 可达性风险：闪动/粒子可能造成眩晕或干扰读屏。防线是遵循 `prefers-reduced-motion`、视觉层不承载唯一语义、状态文字继续可读；回退为纯静态提示。
- 净化过度风险：通配过滤可能误删正式型号。防线是只过滤已知内部命名模式，并保留厂商及公开型号/版本；回退仅恢复店主 view-model 映射，不动后端 catalog、偏好或历史审计。
- 范围漂移风险：借本票改模型选择、D3/D4 或 L-1 会重开已锁决策。发现相关需求时另行回 ADR/对应票，本票不承接。
