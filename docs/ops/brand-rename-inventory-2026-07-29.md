# 产品端品牌名统一 · 对外露出盘点清单（#265 / D-152②）

> 2026-07-29。票面 #265 验收第 1 条要求「盘点清单先于替换合入」，本文即该清单。
> 方法：四个只读 agent 分片全仓扫描（i18n／导出 ZIP 与水印／邮件·PWA·后台·错误页／测试与散落面），
> 结论由 `scripts/ops/brand-exposure-scan.mjs` 独立复现。全程未编辑文件、未跑 typecheck/test/e2e/dev。

## 0. 两条与票面预期不同的结论（先说）

**① 票面点名的锚点 `built_with_brand` 是死键。**
D-152②（决策原文 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2514`）与 #265 票面均把
`built_with_brand` 表述为「产品端 UI 现名」。实核：该键定义于 `messages/{zh,en}.json:707`，
**全仓 `.ts/.tsx/.mjs` 零引用**，不产生任何用户可见效果。真正在渲染产品名的是另外三个键
（`shell_product_brand` / `shell_admin_brand` / `site_logo_aria`），其中 `shell_product_brand` 的中文值
「美业内容中台」是**决策原文从未提及的第三个名字**。
按 runbook §1.3，本条冲突记录于票下评论；本清单以实现为准列出真实露出面。

**② 票面担心的四类面里，三类已自动对齐，零改动。**
`built_with_brand` 之外，票面点名「邮件模板、导出物料水印、后台标题、PWA manifest/浏览器标题」。实核：
PWA manifest、浏览器标题、og/twitter 卡、邮件页脚**全部解析到 `site_name`/`site_title`**，
而这两个键早已是「丽客美页 LIKEPAGE」。导出 ZIP 与水印**不含任何我方品牌串**。
真实改名面收缩为 **6 个 i18n 键 × 中英两份 = 12 处**，外加 4 处测试守卫。

## 1. 对外露出逐处清单（12 处，全部在 i18n 目录）

全部位于 `mkfast-template-main/project.inlang/messages/`。EN 取拉丁形态 `LIKEPAGE`，理由见 §4-①。

| # | file:line | 键 | 现值 | 渲染点（消费者证明） | 建议新值 |
|---|---|---|---|---|---|
| 1 | `zh.json:3555` | `shell_product_brand` | 美业内容中台 | `src/components/layout/dashboard-sidebar.tsx:66` 可见文本 | 丽客美页 LIKEPAGE |
| 2 | `en.json:3555` | `shell_product_brand` | 美业内容簿 | 同上 | LIKEPAGE |
| 3 | `zh.json:3552` | `shell_admin_brand` | 美业管理模式 | `src/components/admin/shell/admin-dashboard-shell.tsx:108,151`、`src/components/admin/admin-route-page.tsx:28` | **待拍**，见 §4-② |
| 4 | `en.json:3552` | `shell_admin_brand` | Beauty admin mode | 同上 | **待拍**，见 §4-② |
| 5 | `zh.json:3571` | `site_logo_aria` | 美业内容簿标志 | `src/components/shared/logo.tsx:8` aria-label；出现在 404（`layout/default-not-found.tsx:17`）与错误边界（`layout/default-catch-boundary.tsx:26`） | 丽客美页 LIKEPAGE 标志 |
| 6 | `en.json:3571` | `site_logo_aria` | 美业内容簿 logo | 同上 | LIKEPAGE logo |
| 7 | `zh.json:7` | `about_introduction` | 美业内容簿帮助门店把灵感…… | **零引用**（死键） | 丽客美页 LIKEPAGE 帮助门店把…… |
| 8 | `en.json:7` | `about_introduction` | Beauty Content Desk keeps ideas… | **零引用**（死键） | LIKEPAGE keeps ideas… |
| 9 | `zh.json:697` | `block_hero_image_alt` | 美业内容簿工作台预览（{mode}） | **零引用**（死键） | 丽客美页 LIKEPAGE 工作台预览（{mode}） |
| 10 | `en.json:697` | `block_hero_image_alt` | Beauty Content Desk workbench preview ({mode}) | **零引用**（死键） | LIKEPAGE workbench preview ({mode}) |
| 11 | `zh.json:707` | `built_with_brand` | 美业内容簿 | **零引用**（死键，票面锚点） | 丽客美页 LIKEPAGE |
| 12 | `en.json:707` | `built_with_brand` | 美业内容簿 | **零引用**（死键） | LIKEPAGE |

**中英分叉现状**：`shell_product_brand` 今日中英本就不一致（中台 vs 簿）；`built_with_brand` 的 EN 值直接落中文未翻译。
改名后两侧按上表同步，满足票面「双语言 i18n 键同步」验收。

**死键处置**：#7-#12 六处（三个键 × 两份）零渲染点。本清单按票面边界建议**照改不删**——删除属清理动作，
超出 #265 票面范围；`--check` 判据对已改名的死键恒绿，不构成后续负担。若判定应删，另开清理票。

## 2. 工程内部：随改名同批更新的测试守卫（4 处）

不属对外露出，但改名后必红或语义失真，必须与替换落同一 commit。

| file:line | 内容 | 改名后 |
|---|---|---|
| `tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts:13` | `ALLOWED_ENGLISH_CJK = ['美业内容簿', …]`，喂 `removeAllowedEnglishCjk`（:66），断言于 `:72-75` | EN 取拉丁形态后该条目**失效应删**；留着＝白名单空放行，静默削弱下一次 CJK 泄漏的判据 |
| `tests/e2e/specs/uiux-upgrade-b-results.spec.ts:742` | `visibleCopy.replaceAll('美业内容簿','')`，守 `:743` 的 `expect(visibleCopy).not.toMatch(/[㐀-鿿]/u)` | **删** `.replaceAll` |
| `tests/e2e/specs/uiux-upgrade-b-results.spec.ts:764` | 同上，守 `:767` | **删** `.replaceAll` |
| `tests/e2e/specs/uiux-shell-routes.spec.ts:246` | 注释：「品牌链接『美业内容簿标志』会连『内容』一起吃掉」 | 不红但**注释变假**（「丽客美页标志」不含「内容」）。改注释，**保留 `:247` 的 `exact:true`**——去掉会为将来任何含导航词的品牌名重开该缺陷类 |

`tests/e2e/TEST-CATALOG.md:267`（「…contains no Chinese beyond the allowed product brand…」）描述的正是被删的 strip 守卫，随代码改。
同文件 `:168`（`--product-brand` CSS 变量）、`:55`（TanStarter 模板残留）为同词误命中，不动。

## 3. 已核为零改动的面（含证据链，供反向复核）

| 面 | 判定依据 |
|---|---|
| PWA manifest | `src/routes/manifest[.]json.ts:15-19` 取 `websiteConfig.metadata` → `src/config/website.ts:44-54` getter 转发 `site_name()`/`site_description()` |
| 浏览器标题 / og / twitter | `src/routes/__root.tsx:58,68,75,82`、`src/lib/seo.ts:92` 同链；无静态 `index.html`、无 `document.title` 赋值、无 `apple-mobile-web-app-title` |
| 邮件模板 | 三封主题（`zh.json:2326,2330,2336`）无品牌串；页脚 `src/mail/components/email-layout.tsx:44` 渲染 `{site_name()}`，已自动正确；`src/mail/templates/*.tsx` 纯键引用 |
| 交付 ZIP 内文 | `apps/core/src/p1/result-delivery/delivery-package.ts` 全扫无品牌位：`platform-checklist.md`（:167-205）、`evidence/rights-and-facts.json`（:220）、`caption.txt`（:151-165）、封面为首图直拷无叠字（:334-341）；ZIP 内无 README |
| ZIP 文件名 | `delivery-package.ts:130-149` 骨架 `{storeName}-{类型}-{平台}-{日期}-r{rev}.zip`，`storeName` 为商家门店名 |
| 导出水印 | 见 §5-① |
| 错误页/空态/登录页文案 | `not_found_title/description`（`zh.json:2565,2564`）、`catch_boundary_title/description`（`:833,832`）无产品名；`src/routes/auth`、`src/components/auth` 零命中 |
| 静态资产 | `public/**`、`content/**` 零命中；`public/landing/logo.svg`、`logo-text.svg`、`favicon.svg` 为纯几何无 `<text>` |
| promptfoo / CI / fixtures / golden | 5 份根 promptfoo 配置、`.github/workflows/*.yml`、`tests/e2e/fixtures/**`、全部单测与交互测试零命中 |

## 4. 待拍决策（阻塞替换动作）

**① EN 取拉丁形态 `LIKEPAGE`（建议采纳，有硬约束支撑）**
若 EN 键写入 CJK 形态「丽客美页 LIKEPAGE」，`uiux-upgrade-b-results.spec.ts:743,767` 的
`expect(visibleCopy).not.toMatch(/[㐀-鿿]/u)` **必红**——丽 U+4E3D／客 U+5BA2／美 U+7F8E／页 U+9875 全部落在 U+3400–U+9FFF。
`shell_product_brand` 渲染在 shell 上，两条 spec 访问的每个 `/en/*` 路由都带它。
且 `en.json` 既有先例已是拉丁：`landing_nav_brand: "LIKEPAGE"`、`site_name: "LIKEPAGE"`、`landing_footer_copyright: "© {year} LIKEPAGE"`。
取拉丁形态还使 §2 的守卫可**删除**而非改写。

**② `shell_admin_brand` 是模式标签而非产品名（须拍）**
现值「美业管理模式」/「Beauty admin mode」渲染在后台页面标题上方的小眉批位，语义是「你在管理端」。
直接换成纯品牌名会丢失该信号。三选一：`丽客美页 LIKEPAGE 管理端`（保信号，倾向）／纯品牌名（彻底统一）／判定不属改名范围不动。

**③ 内部代号「美业内容副驾」是否跟改（须拍）**
`CONTEXT.md:1`、`DESIGN.md:2,106`、`mkfast-template-main/docs/DESIGN.md:7`、`docs/specs/beauty-content-agent-p1-spec.md:2,19` 用的是
项目内部代号「美业内容副驾」，非产品端露出名。D-152 只约束**对外**，对代号沉默。
按 D-152① 边界（工程内部标识不属对外）默认**不动**；若判定这些文档属对外资料则另议。

## 5. 明确排除项（写明以防日后被重新扫开）

**① 水印与门店名兜底 `'品牌内容'` / `'门店'` —— 不是我方品牌，禁改。**
`apps/core/src/p1/operations/content-package-export-adapter.ts:658` 的 `compliance.watermarkText ?? '品牌内容'`
与 `messages/{zh,en}.json:2981` 的 `p1_canvas_export_brand_fallback` 是**商家自有品牌**的缺省占位。
四个生产取值来源全部指向商家数据：`application-service.ts:7274`（门店名）、`:4189`（作品名）、`:8296`、
`src/product/canvas-work-page.tsx:293` 与 `works/works-light-edit-page.tsx:354`（`watermarkText={displayName}`）。
替换＝在商家未填品牌时把我方品牌烧进商家将发布到小红书/抖音的成品图，属产品语义变更且与工具定位冲突。
同理 `content-package-export-adapter.ts:656` 的「内容由 AI 生成」是合规标识，非品牌。

**② `beauty-delivery-manifest/v1` —— 机读契约，禁改。**
`apps/core/src/p1/result-delivery/delivery-manifest.ts:10`，写入 ZIP 内 `manifest.json` 的 `schema` 字段。
商家解压可见但为机读标识；改动同时破 zod schema 与 `packDeterministicZip` 的字节确定性重放。
ZIP 内英文路径名（`images/`、`evidence/rights-and-facts.json`）同理。

**③ 裸词元「内容簿」「管理模式」不得作为替换单位。**
「内容簿」是工作台隐喻，活在 9 个非品牌键：`canonical_history_loading_title`/`_navigation_aria`/`_search_title`
（`zh.json:766,767,779`）、`dashboard_pending_loading`（:1582）、`footer_tagline`（:1713）、
`workbench_header_badge`（:3789）、`workbench_loading_title`（:3800）、`workbench_projection_failure_title`（:3829）。
无脑 sed 会弄红 `uiux-upgrade-b-composer.spec.ts:134`（`getByText('内容簿暂时无法打开',{exact:true})`）并把 `footer_tagline` 改成病句。
「管理模式」是独立产品概念：`product_navigation_admin`（:3246）、`sidebar_user_enter_admin`（:3568，「进入管理模式」），
`uiux-shell-routes.spec.ts:105,186` 对「进入管理模式」有断言。
**只有完整词元 `美业内容簿` / `美业内容中台` / `美业管理模式` 参与替换**，判据脚本按此设计。

**④ `meiye-` CSS/存储命名空间 —— 内部标识，禁改。**
`src/`、`tests/`、`apps/` 共 825 处（`meiye-product-shell`、`meiye-sidebar-nav-item`、约 60 个 DB/存储键前缀），
从不对用户可见。`package.json:2` 的 `"name": "meiyeweb-agent"` 同理。按 D-152① 明确排除。

## 6. 顺带发现的邻近缺口（不在本票，不擅自扩边界）

1. **邮件发件人无品牌显示名**：`src/config/website.ts:69` 的 `fromEmail: 'onboarding@resend.dev'` 被
   `src/mail/provider/resend.ts:27,63`、`cloudflare.ts:33` 原样作 `from` 传出，收件人看到裸沙箱地址。
   加品牌显示名属**新增能力而非改名**，且需先换掉沙箱域名。
2. **事务邮件锁死英文**：`src/mail/render.ts:19` 的 `const en = { locale: 'en' }` 用于全部主题（`:21-23`），
   `email-layout.tsx:17` 同。邮件页脚恒为 `LIKEPAGE Team`，永不出现中文品牌形态。既存行为，非本次改名引入，
   但决定了邮件验收样张能展示什么。
3. **`en.json:2167` `landing_nav_header_brand = "丽客美页x泽发润复丝"`**：CJK 落在英文目录。
   现有判据抓不到——`expectNoChineseSystemCopy` 只访问 `/en/dashboard` 等六条路由，不含 landing。
   将来若把 EN CJK 门扩到 `/` 会红。
4. **`uiux-precutover-baseline.spec.ts:226,233` 已存在的失效断言**：断言 `'内容簿还是空的'`，
   该串在 `src/`、`project.inlang/`、`apps/` 全仓零命中，冻结基线已陈旧。**非本票引入，单独开票，不吸收进 #265。**

## 7. 清单如何不腐烂

静态清单在 #265 的触发点（R 门前）到来时必然已过期——前端 lane（#264FE → #261 → #253FE）会持续新增用户可见文案，
每个新增点都可能再写一次旧名。这正是票面引用的 D-138 教训（「随下一张碰它的票捎带」机制失效）。

故本清单的可执行形态是 `scripts/ops/brand-exposure-scan.mjs`（判据与本文同批合入）：

- **报告档**（默认，恒 exit 0）：重新导出本文 §1／§2 的清单。清单腐烂时重跑即刷新。
- **`--check` 档**：任何残存对外露出即硬失败。**改名落地前必红**，故当前**未**挂进根 `test`；
  切换条件写在脚本文件头——**与替换动作落同一 commit 时挂上**，此后由它防止在飞 lane 把旧名写回来。

单测 `scripts/ops/brand-exposure-scan.test.mjs` 钉住三件事：分类规则（对外 vs 测试守卫/注释）、
排除树（`docs/`、`references/`、paraglide 产物按设计保留旧名）、以及 EN 取拉丁形态的理由。

## 8. 验收用命令（本清单阶段未运行，留给替换阶段）

```bash
cd <lane-265>

# 清单重导 / 改名后判据
node scripts/ops/brand-exposure-scan.mjs
node scripts/ops/brand-exposure-scan.mjs --check     # 改名后须 exit 0
node --test scripts/ops/brand-exposure-scan.test.mjs

# 中英双语键同步
grep -n -E '"(shell_product_brand|shell_admin_brand|site_logo_aria|about_introduction|block_hero_image_alt|built_with_brand)"' \
  mkfast-template-main/project.inlang/messages/{zh,en}.json

# 受影响 e2e（⚠️ playwright.config.ts:136-137 的 webServer 跑 locale:compile:e2e，
#   会重写共享 paraglide 产物——仅在隔离 worktree 内跑，且不与任何 dev 并行）
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts \
  tests/e2e/specs/uiux-upgrade-b-results.spec.ts \
  tests/e2e/specs/uiux-shell-routes.spec.ts

# 交付 ZIP 装配（@meiye/core 的 test 无 locale:compile 前缀，不掀别的 lane）
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/result-delivery/delivery-manifest.test.ts

# 水印真烧录（需系统 CJK 字体；CI 缺 fonts-wqy-zenhei 会恒红，属既有缺口）
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/operations/content-package-export-adapter.test.ts

# 邮件样张（⚠️ package.json:28 的 email:dev 以 locale:compile 开头，仅隔离 worktree 内跑）
cd mkfast-template-main && pnpm email:dev    # http://localhost:3333
```
