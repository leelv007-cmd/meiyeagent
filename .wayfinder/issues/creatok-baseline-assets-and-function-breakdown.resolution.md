# Resolution: CreatOK 基础资产准备与功能拆解

Resolved at: 2026-07-07

## Answer

CreatOK 是一个面向 TikTok Shop / 跨境电商卖家的垂类内容生产工作台，不是单点 AI 视频生成器。它将爆款拆解、视频/图片生成、商品套图、A+ 内容、资产库、Flow 工作流、TikTok 官方发布、积分计费和 Agent Skills 组织成闭环。

Detailed report:
- `references/creatok/reports/creatok-function-breakdown.md`

Evidence index:
- `references/creatok/notes/evidence-index.md`

Supporting notes:
- `references/creatok/notes/public-site-and-pricing.md`
- `references/creatok/notes/dashboard-information-architecture.md`
- `references/creatok/notes/technical-surface.md`

Local source snapshot:
- `references/repos/creatok-skills/`

## Key decision

For the beauty-local-commerce product, borrow CreatOK's productization mechanisms:
- structured vertical workflows instead of blank chat;
- asset library as first-class product surface;
- task history and resumable async generation;
- credits/usage ledger with failure compensation;
- scenario templates / skills;
- platform-account publishing page with official capability framing.

Do not copy its product center of gravity:
- TikTok viral cloning should become historical-content reuse and platform variants;
- true video generation should remain after P0;
- TikTok Shop product-link workflows should become store project / price / real-asset workflows;
- A+ ecommerce detail pages should become beauty project cards and platform-native graphic packs;
- TikTok official publishing cannot be generalized to Xiaohongshu/Douyin/Dianping.
