# Diff / accept-reject 改写模式 —— Notion + Grammarly（一手存档）

- 来源: https://www.notion.com/help/suggested-edits ；https://support.grammarly.com/hc/en-us/articles/38552281546765-Docs-Grammarly-s-new-AI-writing-surface-user-guide ；https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai
- 抓取日期: 2026-07-08

## 模式定义

AI（或协作者）不直接覆盖原值，而是把"改写版"以差异/建议形态呈现，用户逐处 **accept / reject**。适合"用户已有一版内容、AI 来润色/纠错"的场景。

## Notion Suggested edits（官方原文）

- "Hover over a suggestion and select ✓ to **accept** the edit. Your page's contents will update accordingly."
- "Hover over a suggestion and select ✗ to **reject** the edit. The suggestion will disappear."
- 还可对建议 emoji 反应、点开回复评论。
- 形态：inline 差异标注（新增/删除态），悬停出现 ✓/✗ 双按钮，逐处决策。

## Notion AI 写作（生成后的采纳菜单）

- 生成结果落在一个浮层框里，提供 **Replace selection（替换选区）/ Insert below（插入下方）/ Try again（重试=per-field regenerate）/ Continue writing / Close**。
- 图像：可"refine your prompt or ask for **variations**"（多候选/变体），满意再 insert。
- 数据库：AI 建议 properties/views，用户可"keep as-is 或让 AI tweak"，满意点 **Done**。

## Grammarly（官方 user guide）

- 问题以**彩色下划线**标注（红=拼写/语法/用词等关键项，蓝=清晰度/语气等复杂项）。
- "Click the underline to open the **suggestion card**. Click the suggestion card to **accept or dismiss** the suggestion."
- 形态：下划线锚点 → 悬浮建议卡 → accept 应用 / dismiss 忽略。逐条、就地、可无视。

## 适用字段类型
- 长文正文的润色/纠错/合规改写（我们美业：把商家草稿改成合规专业口语）。
- **不适合空白字段的首次预填**（diff 需要有"原值"作对比基线）。首次预填用 Carbon/Shopify 式直填，二次优化再用 diff。
