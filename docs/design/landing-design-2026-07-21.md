# Landing 设计系统 — 丽客美页 LIKEPAGE（2026-07-21）

> **独立性声明（哥拍板 2026-07-21）**：本 Landing 按独立设计系统执行，**不受根 `DESIGN.md`（玫瑰金火花/门店橱窗）约束**；同时以 `.meiye-landing` 作用域完全隔离，不得改变产品端任何页面的视觉。两套系统的关系 = 并行不互扰：Landing 是对外橱窗海报，产品端是工作台。
> 结构基底：`references/ai-saas` 模板（12 区，结构/动效 1:1 保留）；色调来源：`references/风格参考图/` 5 张图共性提取。
> 文案唯一事实源：`landing-copy-2026-07-21.md`。

## 1. 色彩系统「珍珠香槟 · 高调透亮」（2026-07-21 提亮修订，哥拍板）

> 修订记录：初版按 5 张图定「暖香槟金·琥珀丝绒」（深琥珀/古铜端较重）；哥反馈整体偏深，补充第 6 张参考图 `huaban-5406234642.jpg`（骨叶脉络·珍珠香槟高调）为**光感基准**——浅色主题全面提亮为高调（high-key）珍珠香槟系，深端不低于中金 `#C7A263`；暗色主题保持熔金古铜不变。

参考图共性：珍珠象牙底、浅金香槟渐变、白色光斑 bokeh、通透柔焦；深古铜只保留给暗色主题。

### 1.1 语义 token（`.meiye-landing` 作用域）

| token | light（默认） | dark（`.dark .meiye-landing`） | 用途 |
|---|---|---|---|
| `--background` | `#FAF5EC` 珍珠象牙 | `#2A1B10` 熔金深棕 | 页面底 |
| `--foreground` | `#4A3826` 软咖啡 | `#F3E9DC` | 正文 |
| `--muted` | `#F3ECDD` | `#3E2A18` | 弱底 |
| `--muted-foreground` | `#8A7862`（AA） | `#C4B39E` | 次级文字 |
| `--border` | `#EADDC6` | `#5C3A1E` | 发丝线 |
| `--accent` / `--ring` | `#C09649` 浅香槟金 | `#D4A155` | 品牌强调/焦点 |
| `--accent-light` | `#EFDCB2` | `#E8C98F` | 强调浅档 |
| `--accent-foreground` | `#3F2F1B`（金底配深字，高调奢感） | `#2A1B10` | 强调上文字 |
| `--l-gradient-from → --l-gradient-to` | `#C39A5E → #EAD3A2` | 同 | 品牌渐变（替换模板 `#333DA7→#7388DF` 全部出现点） |
| `--l-glow` | `#F4CE96` 浅金光晕 | `#F0A868` | 光斑/呼吸微光 |
| `--l-rose` | `#E96B5F` 珊瑚点缀 | `#E77F87` | ≤5% 面积点缀（星形/角标） |
| `--l-card` | `#FDFBF5` | 同 light（卡恒浅，模板机制） | Hero 提示卡等实体卡 |

### 1.2 硬编码色换算表（模板 7 文件逐处替换）

| 模板原值 | 新值 | 出现点 |
|---|---|---|
| `#6366F1` / `#A5B4FC`（token） | `#C09649` / `#EFDCB2` | globals token 层 |
| `#333DA7`（渐变起） | `#C39A5E` | image-reveal×3、showcase×2、stats、bottom-cta、footer(rgba 浅化五档) |
| `#7388DF`（渐变止） | `#EAD3A2` | 同上 |
| hero 卡 `#f8f8fa` | `var(--l-card)` | hero.tsx |
| 紫影 `rgba(124,58,237,.08)` | `rgba(192,150,73,.10)` | hero.tsx |
| hero `text-gray-*`/`border-gray-*` | 暖中性（`--muted-foreground`/`--border` 系） | hero.tsx |
| fluid RGB `{r:.21,g:.18,b:.51}` | light `{r:.84,g:.7,b:.48}` / dark `{r:.86,g:.7,b:.46}`（useTheme 感知；暗色降饱和避免 multiply 出红斑） | fluid-cursor.tsx |
| gradient-fade.svg 烧色 `#7388DF/#333DA7/#0C0E21/#030409` | light 版 `#F3E4C6/#E9D3A8/#D9BC86/#C7A263`（rect→`#FAF5EC`，全浅无深端）；dark 专用 `gradient-fade-dark.svg`（初版深端色降饱和：`#E6D2AC/#B08A50/#4E3A22/#2E2115`，rect `#F2E9D8`），hero 双 img 按 `dark:hidden`/`hidden dark:block -scale-y-100` 切换 | public/landing/gradient-fade{,-dark}.svg |
| hero/header 文字机制 | 模板 `text-background` 压深端 → 高调化后浅色改 `text-foreground`（软咖啡压浅金），dark 保留 `dark:text-background`（深字压翻转后的浅顶） | hero.tsx / header.tsx |
| favicon `#0066FF` | `#C09649` | 不改产品 favicon（范围外），仅 landing 资产内不引入旧蓝 |

## 2. 质感语言

- **丝绒渐变**：大面积柔焦渐变（gradient-fade.svg 重制 + mix-blend 罩色），方向感来自参考图的横向丝绸拉丝。
- **颗粒**：`.meiye-landing::before` feTurbulence data-URI，`opacity:.03`，全局薄膜（可删）。
- **金发丝线**：1px `--border` 分隔线；装饰性轨道线/✦ 星形用 `--accent`（✦ 允许少量 `--l-rose`）。
- **光斑 bloom**：`--l-glow` 径向渐变，只出现在 hero 与 bottom-cta 两端，中段留白。
- **图像罩色**：所有实拍图统一 `mix-blend-color` 品牌渐变罩（模板机制不变，换色即可），保证异源图片同调。

## 3. 排版

- **展示衬线（英文/数字）**：`"Likepage Didone"`（Bodoni Moda/Playfair 拉丁子集自托管 woff2）→ `Didot/Bodoni MT` → `Songti SC` → `Noto Serif SC`。用于：LIKEPAGE 词标、眉线小字、大数字、英文点缀。
- **中文正文/标题**：沿用应用系统栈（PingFang SC/HarmonyOS Sans 系），标题加字重不换族——中文大字 + 英文衬线小字的双语版式（参考图 1/2 范式）。
- **字距**：英文装饰小字 `tracking-[0.3em]` 全大写；中文标题正常字距。
- 模板 Geist 字体不迁移；正文层完全走应用现有 `--font-brand` 栈。

## 4. 主题

- **浅色为默认**（与应用 `defaultMode:'light'` 一致）：奶油米白底，参考图 1/2/4/5 气质。
- **暗色 = 熔金古铜**（参考图 3 气质）：`#2A1B10` 底 + 金色强调提亮，不是灰黑主题。
- 主题切换沿用应用 ThemeProvider（html class + localStorage），Landing 浮动切换钮保留模板位。
- hero 背景 SVG 的 `dark:-scale-y-100` 翻转机制保留。

## 5. 作用域与工程边界

- 全部 token 只声明在 `.meiye-landing` / `.dark .meiye-landing` 下（复用 `.meiye-product-shell` 先例机制，`@theme inline` 的 var() 在使用点解析）。
- 全局仅允许两个带 fallback 的新增：`--color-accent-light`、`--font-landing-display`（产品页零引用 → 零影响）。
- 模板的未作用域全局规则（如 `a:focus-visible`）一律加 `.meiye-landing` 前缀后再引入。
- 禁止触碰：产品端 tokens、`--spark` 系、玻璃三档、任何 dashboard/auth/pro-studio 样式。

## 6. 12 区映射与动效保留清单

| # | 区 | 模板源 | 动效（原样保留） |
|---|---|---|---|
| 0 | Header | header.tsx | 滚动隐现 + mix-blend-difference |
| 1 | Hero | hero.tsx + fluid-cursor.tsx | WebGL 流体光标（改双主题金色）、背景 parallax |
| 2 | TextReveal | text-reveal.tsx | 逐词显影 |
| 3 | ImageReveal | image-reveal.tsx | GSAP ScrollTrigger scrub 长廊 |
| 4 | TrustedBy | trusted-by.tsx | logo 轮换 |
| 5 | ToolsCarousel | tools-carousel.tsx | 拖拽轮播 |
| 6 | ShowcaseCards | showcase-cards.tsx | WebGL bulge + Safari fallback |
| 7 | Stats | stats.tsx | 柱状动画（数据=事实数字） |
| 8 | Testimonials | testimonials.tsx | 轮播 |
| 9 | Pricing | pricing.tsx | hover 浮起 |
| 10 | FAQ | faq.tsx | 手风琴 |
| 11 | BottomCTA | bottom-cta.tsx | 渐变底光 |
| 12 | Footer | footer.tsx | 词标水印淡出 |

平滑滚动：Lenis 仅在 Landing 挂载、卸载即销毁；`prefers-reduced-motion` 全链路降级（`.meiye-landing` 作用域 CSS 强制 + Lenis bail + FluidCursor 不挂载）。

**实现期定案的两处合法适配（2026-07-21，属「换色打破处」）**：
1. **Header 弃用模板 `mix-blend-difference`**——difference 混合在彩色琥珀底上必然补出蓝色（模板靛蓝品牌下不可见此缺陷）。改为滚动态自适应：hero 顶部文字走 `text-background`（与 H1 同逻辑，两主题各自压对侧明度）、滚动后玻璃 bar（`bg-background/70 + backdrop-blur` + `text-foreground`）、移动端菜单展开恒白字压深古铜。logo 白 SVG 以 invert 滤镜按同一状态机切换。
2. **`.meiye-landing` 需 `isolation: isolate`**——模板把页面底色放在 `body` 上，负 z-index 的 hero 背景层可画其上；本移植底色在内层块，必须自建堆叠上下文否则背景层被页面底色盖没。
另：颗粒层实现为 wrapper 的 `background-image`（feTurbulence data-URI）而非 `::before`，零堆叠风险；模板 `lib/motion.tsx` 的辅助组件全数未被引用，未随移植保留（ReducedMotionProvider 由上述三层降级替代）。

## 7. 可达性

- 文字对比：`--foreground`/`--background` 双主题均 ≥ 7:1；`--muted-foreground` 加深至 ≥ 4.5:1（AA）。
- 金色 `--accent` 不做小号正文色，只做强调/图形/大字。
- 状态不只靠色：定价「主推/敬请期待」均有文字角标；焦点环 `--ring` 双主题可见。
- 跳转链接、`main#main-content`、skip-to-content 保留模板实现。

## 8. 资产清单

| 资产 | 规格 |
|---|---|
| `public/landing/logo.svg` | LP 花押/词标短版（didone 路径化，香槟金/白双态由 CSS 控） |
| `public/landing/logo-text.svg` | LIKEPAGE 全词标（路径化，footer 水印 + header） |
| `public/landing/gradient-fade.svg` | 模板同构重制，fill 换香槟金族（见 1.2） |
| `public/landing/logos/*.svg` | 模板 15 个灰度装饰 mark 原样拷贝（不声称客户） |
| `public/landing/img/*` | 从 `public/seed/scene|template|asset|store` 选 12+4+3 张 |
| `public/fonts/didone-display-latin.woff2` | Bodoni Moda 拉丁子集（仅 A-Z/a-z/0-9/标点） |
