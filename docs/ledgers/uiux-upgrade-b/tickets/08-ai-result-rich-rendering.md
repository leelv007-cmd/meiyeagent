# 票 08 · AI 结果富渲染：静态 Markdown 先行 + prompt-kit ResponseStream/Streamdown-cjk copy-in
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P0-5 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "08",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-AI-SDK-FIRST",
    "DEC-TOKEN-STREAMING"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-5"
  ],
  "contractIds": [
    "I03",
    "I09"
  ],
  "blockedBy": [
    "07"
  ],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 `P0-5`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:135-143`）当前定性为 `partial`：prompt-kit、Streamdown、`@streamdown/cjk`、AI Elements 均未采购，正式 AI 结果仍是裸文本；但项目并非没有 Markdown 能力，静态 GFM 渲染栈已经存在，只是没有接进 AI 结果层。
- 报告§一根因①②（`:22-24`）命中本票：选型停在文档层，且“能力存在”被误当成“用户在主路径看得见”。本票必须把富渲染接到 `/dashboard` 的真实结果卡，不能以依赖安装、源码 copy-in 或桶导出关票。
- 报告§二（`:38-44`）与 ADR-0010:8 已裁决 token 级流式：票 07 提供 `useChat/useObject` 与 SSE 消费，本票负责中文逐字富渲染；不得退回 Job progressbar 代替 token 流，也不得把完整响应做客户端打字动画后冒充真实流式。
- `references/benchmark/ui-adaptation-study-2026-07-08/ai-ui-libs-review.md:94-107,113-125` 的最小采购边界是：手动 copy 单件、沿用 Base UI、流式价值组件优先；不跑整包安装，不引入重型 chat runtime。`ResponseStream` 只作受控呈现，Streamdown + CJK 才是未闭合 Markdown 与中文断行的渲染主路径。
- 范围边界：D3 保持“对话式外壳、结构化内核”，不做 chat clone；D4 保持 3 选 1 单选，不新增多选采用；不复活 L-1 贴链接抓取；不引入模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:1045-1105`：正式工作台结果卡入口；`1073-1076` 仍以 `<p className="whitespace-pre-wrap">{asset.body}</p>` 渲染，报告的 `:1074` 未漂移。
- `mkfast-template-main/src/components/markdown/markdown.tsx:19-25,85`：已有 `<Markdown>` 会随 `content` 异步调用渲染器并输出 HTML；当前加载态会在每次内容变化时出现，不适合直接逐 token 重跑，但可先承接完成态静态结果。
- `mkfast-template-main/src/lib/markdown.ts:19-33`：已有 unified + remark-gfm + rehype 管线；`23-24` 允许并解析原始 HTML。它原本服务受控页面内容，接模型输出前必须隔离或转义原始 HTML，不能扩大信任边界。
- `mkfast-template-main/src/routes/blog/$slug.tsx:108-111`、`mkfast-template-main/src/components/page/markdown-page.tsx:28-31`：博客与法律页已在用同一 `<Markdown>` + `prose` 样式，证明静态标题、列表、强调、链接与代码排版能力已存在。
- `mkfast-template-main/package.json:37-102`：React 19、Tailwind 4、typography、remark/rehype/unified 已在；当前依赖表和 `pnpm-lock.yaml` 均无 prompt-kit、Streamdown、`@streamdown/cjk` 或 AI Elements，报告“零采购”仍准确。
- `mkfast-template-main/src/components/ai/ai-summarization-card.tsx:81-93`、`mkfast-template-main/src/components/ai/ai-translation-card.tsx:201-213`、`mkfast-template-main/src/components/ai/ai-caption-card.tsx:185-200`：报告点名的 demo 结果分别在 `:83`、`:203`、`:187` 继续裸文本。文件实际带 `ai-` 前缀；它们已由票 04 裁决随公开 `/ai` 下线，不是本票接线目标。

## 改造方案（步骤级 + 涉及文件清单）

1. **先接完成态静态 Markdown**：在正式工作台结果卡用现有 `<Markdown>` 替换 `asset.body` 裸文本，并套用项目现成 `prose` 规则；保留空态、接受 Content、卡片边界与结构化 Asset/Content 关系，不改 D4 交互。
2. **收紧 AI 内容信任边界**：为模型正文使用禁止原始 HTML 的安全路径；博客/法律页的既有行为不得被无意改变。外链、图片、代码块的可见行为沿用现有产品规则，模型输出不能注入脚本、事件属性或任意 HTML。
3. **按最小单件 copy-in**：只移植 prompt-kit `ResponseStream` 所需源码并记录上游版本/许可证；不跑整包 CLI，不采购 AI Elements，不引入对话线程、工具调用或另一套 primitive。按当前 Base UI 约定适配，禁止遗留 Radix `asChild` 假设。
4. **接入 Streamdown + CJK**：仅增加流式 Markdown 所需依赖，让未闭合标题、强调、列表、链接、行内代码/代码块在增量到达时保持可读；中文标点、换行和光标动画由 CJK 插件与真实 streaming 状态驱动。
5. **统一结果呈现状态**：同一结果卡接票 07 已建立的 token/partial-object 状态；生成中使用 Streamdown-cjk，完成后收敛为持久化正文的静态 Markdown。切换不得清空、重复、跳回或产生两套正文。
6. **禁止假流式**：`ResponseStream` 只能消费票 07 的真实增量或承担光标/过渡呈现；若只拿到完整字符串，直接显示完成态，不得二次切字模拟“AI 正在写”。真实增量到达速度快时也不得额外拖慢。
7. **跑中文渲染 spike 题 5**：用同一组美业正文覆盖中英文混排、全角标点、emoji、标题、嵌套列表、强调、链接、行内代码、代码块，以及每个 Markdown 定界符被拆到不同 chunk 的情况；观察开始—进行中—完成三态与窄屏排版。
8. **只接正式主路径并留证**：接入 `/dashboard` 结果区和票 07 的正式流式结果，不触碰票 04 将删除的 `/ai` demo；证据采用同一 prompt、同一视口、同一候选构建的当前产品/升级后/即梦或 KickArt 对照。

涉及文件清单：

- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/components/markdown/markdown.tsx`、`mkfast-template-main/src/lib/markdown.ts`、`mkfast-template-main/package.json`、`pnpm-lock.yaml`。
- 新增：仅限 prompt-kit `ResponseStream` 的本地 copy-in 源码和一个正式 AI 结果流式适配件；当前仓库尚无对应文件，实施时按既有组件目录约定落位，不在 brief 中虚构路径。
- 不修改/不复活：`mkfast-template-main/src/components/ai/` 目录中的现有 demo 卡及公开 `/ai` 旁路；其去向遵循票 04。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/components/ai-elements/response.tsx`——Response = memo(Streamdown)，memo 比较函数只比 children，流式高频更新防整树重渲（必抄细节）。ai-elements 组件走 Vercel 官方 CLI 拉取，不从该仓拷贝（仓库无 LICENSE）。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家打开正式工作台的既有文案结果，能直接看见清晰的标题、段落、列表、强调、链接和代码排版，不再看到 Markdown 符号原样堆叠或整段等宽裸文本。
- 商家提交副驾或文案生成后，第一段真实内容到达即在原结果卡内出现，后续文字持续增长；不会先静默等待完整结果，再用匀速打字动画伪装生成过程。
- 中文正文流出时，全角标点、emoji、中英文混排与换行保持自然；`**`、反引号、列表和链接被拆在不同到达批次时，不出现持续闪烁、残缺标签、重复正文或无法消失的光标。
- 生成完成时，同一张卡平滑停在完整成品排版；刷新页面或离开后返回，持久化结果的文字、层级与链接观感一致，不从富排版退回裸文本。
- 当一次返回 3 个文案候选时，用户看到 3 个边界稳定、各自逐步成形的候选；本票不增加多选采用，也不改变后续 3 选 1 的锁定语义。
- 流中断时，用户仍能读到已经到达的内容和明确的中断提示；重试后不会把旧正文与新正文叠成两份，也不会把失败态显示成已完成。
- 在桌面与移动窄屏上，长标题、长链接、中文列表和代码块不撑破结果卡；生成中到完成的卡片高度变化不遮挡“接受为 Content”等关键动作。
- 截图/录屏对照：同一美业 prompt、同一桌面视口并排展示“当前产品整段裸文本结果 vs 升级后富排版结果”，再附升级后开始—进行中—完成三帧与即梦/KickArt Agent 生成中参照；流式参照不得使用报告已判运行态证据 `UNKNOWN` 的 CreatOK。

## Blocked-by / Blocks

- Blocked-by：票 07。票 07 必须先提供真实 token/partial-object 增量、明确 streaming/completed/error 状态与 BFF 透传；本票不另建第二套请求协议。
- 全局关票闸：Phase 0 必须完成，且票 02 的体验合同 required 条目未验绿前，本票不得关闭。
- Blocks：MAP 未声明直接下游票；本票关闭 P0-5，并为 Path B Exit milestone 的流式呈现与成品排版证据提供必需输入，不改变 `09 → 10` 等其他主链。

## 风险与回退

- **假流式被误验收**：prompt-kit `ResponseStream` 支持客户端模拟展示。控制：证据必须显示网络增量与 UI 增长相对应；回退为真实 chunk 的朴素增量文本，也不能把完整响应切字播放。
- **双渲染器完成态跳变**：Streamdown 与现有 unified 输出可能在列表间距、链接或代码块上不同。控制：共享同一内容样例和视觉 token；若无法无跳变，完成态继续用 Streamdown，静态历史再单独收敛，不能牺牲生成中可读性。
- **模型 Markdown 扩大 XSS 面**：现有 `rehypeRaw` 适用于受控页面，不可直接信任模型正文。控制：AI 路径转义/禁用原始 HTML；回退为安全的 Markdown 子集或转义纯文本，不回退到允许任意 HTML。
- **中文插件或长文性能不稳**：高频 chunk 可能造成重排、输入卡顿或移动端掉帧。控制：只合并渲染批次，不延迟真实首字；回退时关闭动画并保留真实增量与 CJK 可读性。
- **copy-in 漂移与 primitive 冲突**：prompt-kit 维护放缓，整包导入会带来无关依赖。控制：锁定单件源码与许可证，按 Base UI 改写；回退删除该展示件，保留 Streamdown-cjk 最小渲染链。
- **范围串票**：误接 `/ai` demo、引入完整聊天框架或顺手改候选/模型/链接策略会破坏票 04 与锁定决策。控制：只改正式结果呈现；回退相关旁路 UI，不回退 D3、D4、L-1 de-scope 或禁止跨品牌 Auto。
