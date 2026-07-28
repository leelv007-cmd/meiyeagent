# 票 04 · 三家模板品牌残留一次性清扫 + /ai 旁路下线
> 阶段: Phase 0 · 共同前置 ｜ 差距: P0-2、P1-10 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "04",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-2",
    "P1-10"
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

- **P0-2（partial）**：对外首页、页脚、浏览器标题、社交链接和邮件地址仍暴露 TanStarter；同一运行面还指向 MkFastHQ 与 mksaas.link。用户第一眼看到的是 SaaS 脚手架，而不是「美业内容簿」。
- **P1-10（partial）**：公开 `/ai` 挂载 8 张模板 demo 卡，并通过两条平行通道绕过 core ModelSupply：2 张直调 fal.ai，6 张直调 Cloudflare Workers AI REST。页面无鉴权、进导航与 sitemap，用户可绕开正式创作台的目录、额度、审计和 `live_verified` 门禁发起 AI 花费。
- **共同根因**：差距报告 §一根因①④——拍板未变成可验收的工程约束，产品停在「模板上贴功能」。本票只收口用户可见品牌面与 `/ai` 旁路，不扩展到票 24 的模型内部标识。
- **边界**：不新增 AI 能力，不将 demo 改造成第二个创作入口；不重开 D4，不改 D3「对话式外壳 + 结构化内核」，不恢复 L-1 贴链接抓取，不引入跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/project.inlang/messages/zh.json:406-410,723-725`：首页 hero、`site_name/title/description` 仍是 TanStarter/TanStack SaaS 模板；`en.json:406-410,723-725` 同步残留。报告行号未漂移。
- `mkfast-template-main/src/components/layout/footer.tsx:8,97-104`：页脚全局 import 并渲染 `BuiltWithButton`；`src/components/shared/built-with-button.tsx:9,15-17` 硬编码 TanStarter 外链、图标和文案。
- `mkfast-template-main/public/tanstarter.png`：上述页脚按钮的 demo 资产仍在册。
- `mkfast-template-main/src/config/website.ts:58-61,73-77`：社交位指向 MkFastHQ、MkSaaS 和 TanStarter，发件人/客服邮箱仍为 `support@tanstarter.dev`。报告行号未漂移。
- `mkfast-template-main/src/components/blocks/hero.tsx:26`、`content/blog/*.md`、`project.inlang/messages/{zh,en}.json`：用户可访问的营销与博客面仍有 TanStarter/MkSaaS 链接、文案或资产来源，说明不能只改报告列举的三行文案。
- `mkfast-template-main/src/routes/(pages)/ai.tsx:15-21,37-60`：公开 `/ai` 路由渲染 8 张 demo 卡；`src/routeTree.gen.ts:68,376-380` 证实其已注册为可达路由。
- `mkfast-template-main/src/config/navbar-config.ts:40-100`：导航暴露 8 个 `/ai#...` 入口；`src/lib/routes.ts:14-22` 保留全部常量，`src/lib/locale.ts:92-96` 把 `/ai` 视为本地化公开页。
- `mkfast-template-main/src/routes/sitemap[.]xml.ts:27-33`：`/ai` 及 about/changelog/roadmap/waitlist starter 页公开进 sitemap。报告的 `sitemap.xml:29` 是简写，仓内实际路径如此，行号 29 仍准确。
- `mkfast-template-main/src/api/ai.ts:1-2,166-210,327-398,406-444,470-531,541-560`：Fal adapter 与 Workers AI REST 均在模板 server functions 内直调；未经 ModelSupply。
- `mkfast-template-main/src/components/ai/*.tsx`：8 张卡只由 `/ai` 聚合，并直接消费 `src/api/ai.ts`；`src/config/ai-models.ts:1-24` 只为这套 demo 定义模型。
- `mkfast-template-main/package.json:51-52`：`@tanstack/ai` 与 `@tanstack/ai-fal` 为旁路依赖；当前 src 使用点只在上述 demo API。
- `mkfast-template-main/src/routes/(pages)/about.tsx:12-19`、`changelog.tsx:9-20`、`roadmap.tsx:8-15`、`waitlist.tsx:8-15`：P1-10 点名的无关 starter 页仍为正式路由。

## 改造方案（步骤级 + 涉及文件清单）

1. **锁定替换口径**：运行面统一使用当前产品名「美业内容簿」及已批准品牌资产；没有经确认的官方社交账号/邮箱时直接不展示，不伪造替换值。
2. **清扫用户可见品牌面**：重写 `project.inlang/messages/{zh,en}.json` 中正在渲染的首页/SEO/页脚/页面文案；清理 `src/components/blocks/{hero,features,features2,logo-cloud}.tsx` 与 `content/blog/*.md` 的模板品牌文案、链接和远程素材。范围是可发布运行面，不删第三方 `LICENSE` 归属或内部开发说明。
3. **移除页脚植入**：从 `src/components/layout/footer.tsx` 删除 import/渲染，删除 `src/components/shared/built-with-button.tsx` 与 `public/tanstarter.png`。
4. **收口对外联系信息**：在 `src/config/website.ts` 移除三方社交链与 TanStarter 邮箱，仅保留经确认的产品自有通道；同步让首页、about、footer、SEO 不再生成空按钮或错链。
5. **整链下线 `/ai`**：删除 `src/routes/(pages)/ai.tsx`、`src/components/ai/*.tsx`、`src/api/ai.ts`、`src/config/ai-models.ts`；从 `src/config/navbar-config.ts`、`src/lib/routes.ts`、`src/lib/locale.ts`、`src/routes/sitemap[.]xml.ts` 移除入口，再生成 `src/routeTree.gen.ts`。不把旧 URL 转发到另一个无治理 demo。
6. **移除无关 starter 页**：删除 `src/routes/(pages)/{about,changelog,roadmap,waitlist}.tsx`，清掉 `src/config/{navbar-config,footer-config}.ts`、`src/lib/{routes,locale}.ts`、`src/routes/sitemap[.]xml.ts` 的可达入口；确认无其他消费者后删除 `src/components/changelog/release-card.tsx`、`src/components/roadmap/roadmap.tsx`、`src/components/waitlist/waitlist-form-card.tsx` 与 `content/changelog/*.md`。
7. **清理旁路依赖**：从 `package.json` 移除仅供 demo 使用的 `@tanstack/ai`/`@tanstack/ai-fal`，同步更新根目录 `pnpm-lock.yaml`。这不代表否定票 06 所需的 Vercel AI SDK 正式栈。
8. **按用户旅程复验**：分别以未登录访客和已登录商家遍历首页、顶导航、页脚、浏览器标题、旧 URL 与正式创作入口；以桌面端 + 移动端截图留证。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 新访客打开首页并滚动到页脚，页面正文、导航、品牌标识、浏览器标题与页脚只呈现「美业内容簿」及其自有语义，看不到 TanStarter、MkFast、MkSaaS、「Built with」或 SaaS 脚手架介绍。
- 用户点击页头/页脚的每个社交与联系入口，只会到达美业内容簿自有通道；未配置自有通道时该入口不出现，不会跳到 TanStarter/MkFast/MkSaaS 或向 `tanstarter.dev` 发邮件。
- 用户在顶部导航、页脚和 sitemap 中都找不到 AI demo、about、changelog、roadmap、waitlist 入口；直接访问 `/ai`、其本地化/锚点变体及上述 starter URL 时，看到美业品牌的不可用页，不再看到 8 张 demo 卡或可发起生成的表单。
- 已登录商家要生成内容时，只能从正式工作台进入现有创作旅程；下线 demo 不改变 D3 结构、D4 的 3 选 1 单选、L-1 de-scope 或禁止跨品牌 Auto 的可见行为。
- **截图对照**：在同一桌面宽度和同一移动端宽度各产出一组「当前产品首页顶部 + 页脚 vs CreatOK/KickArt 对应公开外壳」逐屏图；图中可直接看出当前产品已达到单一品牌、无模板归属植入、无旁路 demo 导航的同等成品感。
- 从首页到正式工作台的桌面端与移动端截图中，不再出现断图、空社交按钮、死链、模板占位文案或中英文品牌不一致。

## Blocked-by / Blocks

- **Blocked-by**：无实施前置。但遵守 MAP 全局关票规则：**票 02 完成前，本票不得关票**。
- **Blocks**：作为 Phase 0 共同前置之一，本票未满足 DoD 时 Phase 1-5 不得进入 frontier，且不得达成 Path B Exit milestone。

## 风险与回退

- **品牌资料不全**：伪造社交账号或邮箱会制造新错链。安全回退是隐藏未确认入口，保留已确认的美业品牌名与图形，不恢复模板链接。
- **路由/SEO 遗漏**：只删页文件会留下导航、hreflang、sitemap 或生成路由残留。回退时应整体回退本票的路由收口，不单独恢复 `/ai` 页或 API 直调。
- **误删可复用能力**：AI demo 组件目前只有 `/ai` 消费者，但执行时仍须在删除前重做全仓引用核对。如出现新的正式消费者，只保留其纯 UI 部分并改接 ModelSupply，旁路 server function 仍不恢复。
- **依赖名称混淆**：当前 `@tanstack/ai`/`@tanstack/ai-fal` 是模板旁路，与票 06 按 ADR-0007 落地的 Vercel AI SDK 不是同一套依赖。回退时不得为「预留 AI SDK」恢复前者。
- **缓存与旧链**：搜索引擎或用户收藏可短期继续访问旧 URL。保留美业品牌的明确不可用页；不因旧链流量恢复 demo 生成能力。
