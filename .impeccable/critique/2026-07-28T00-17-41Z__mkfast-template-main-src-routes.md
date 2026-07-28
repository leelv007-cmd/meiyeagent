---
target: mkfast-template-main 商家可见面 (dashboard+settings+auth)
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 4
p1_count: 3
timestamp: 2026-07-28T00-17-41Z
slug: mkfast-template-main-src-routes
---
Method: dual-agent (A: 设计总监视角 · B: 确定性证据)

## Design Health Score

| # | 启发式 | 分数 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 1 | 硬加载时页面标题与面包屑实测 1.11:1（白字压 rgb(243,243,243)）—— 店主看不到自己在哪一页 |
| 2 | 系统与真实世界匹配 | 2 | 导航词汇正确；「本次交付」「最小事实」「表达身份」「中台」「不执行业务写入」「工作区负责人」六处黑话漏给店主 |
| 3 | 用户控制与自由 | 2 | 五步向导 4/5 可跳过；跳完系统仍说「还没有确认过的门店事实」，形成无解释死循环 |
| 4 | 一致性与标准 | 2 | 三个产品名；`/dashboard` 标题层级与字号反向且无 h1；2 个组件有 blur 无描边，违反玻璃有边法则 |
| 5 | 错误预防 | 3 | 生成前的接地门是正确产品判断；扣分只在措辞与材质 |
| 6 | 识别优于回忆 | 1 | 六张配方卡说明实测 1.09:1，等于不存在；`.widget__description` 明 1.06:1 / 暗 1.17:1 |
| 7 | 灵活性与效率 | 1 | DOM 里有全局命令面板，界面无任何触发提示；无批量、无键盘序号；进首屏滚 850px 才能打字 |
| 8 | 美学与极简 | 2 | 首屏 11 个顶层区块争焦点、侧栏 y=270–750 全空；但 §6 禁用模式实测零命中，「hero 大数字卡」指控不成立 |
| 9 | 错误识别/诊断/恢复 | 3 | 应用内 404 态是标准答案级；`/auth/error` 外壳页未被设计系统收编 |
| 10 | 帮助与文档 | 1 | 全站无「帮助」入口；§5 要求的顶部胶囊组＝帮助/通知/账户，实际只有 订阅/语言/主题 |
| **合计** | | **18 / 40** | **Poor —— 核心体验受损，需要大修** |

## Design Specificity Verdict

**判定：材质专属，构图通用，且最专属的那一层没上线。**

**LLM 评估（Assessment A，未见检测器输出时形成）**：不是「换 logo 就能卖给任何 SaaS」，但远未达 DESIGN.md 的「门店橱窗」。专属性集中在最表层的材质与文案 —— 氛围层是真的（美甲/美睫特写暖调影像，符合 §6「非风景」）、侧栏是真玻璃（`oklch(1 0 0 / 0.8)` + `blur(64px)` + `1px oklch(1 0 0 / 0.55)`）、一级导航与 PRODUCT.md 完全一致。越往构图和首屏叙事走，越退化成通用后台：首屏第一个元素是配额卡，Composer 被压到 850px 以下；`/auth/login` 是零特征通用 SaaS 卡片。

**确定性扫描（Assessment B）**：
- CLI `detect.mjs` 扫 `src/routes/dashboard|settings|auth` + `src/product` 共 **222 个文件 → exit 0，零 findings**。扫 `src/components` → exit 2，5 条，**全部落在 `heroui-pro/vendor/` 第三方镜像 CSS，全部误报**（`transition: width` 是侧栏折叠动画等）。B 主动做了扫描器有效性对照（全树复扫 + 确认 `.tsx` 在 `SCANNABLE_EXTENSIONS` 内），确认「零 findings」是真实结果而非静默截断。
- **元结论：机械检测器在这个项目上基本是盲的。** 本报告全部 P0 都来自人工判断或 B 自建的 `measure.js` 定向测量，没有一条来自出厂检测器。

**Visual overlays**：注入成功（`document.title` 可写回读 + `window.__IMPECCABLE_INJECT_OK === true`，是真 mutable 注入）。live-server 起在 :8400，`/dashboard` 一页跑出 `[impeccable] 8 anti-patterns found`，B 裁定 4 条误报（单一字族是 §3 明令、中性墨色被误判为紫、`go*` 哈希类名属 sonner toast）、4 条真实（`bounce-easing`、`nested-cards`、`dark-glow #10b981` 不在 §4 阴影词汇表、`text-overflow` ×2 溢出 211px/513px）。**live-server 已确认停止**（`kill 92474` → `CONFIRMED EXITED`，:8400 curl 返回 000/exit 7）。覆盖层只跑了 `/dashboard` 一页，其余页面的反模式覆盖来自定向规则而非全量规则集。

## Overall Impression

这套设计系统的**材质层是真的，叙事层没上线，而两者之间隔着一个团队已经知道并推迟的技术债**。

三条独立证据链指向同一个结论：DESIGN.md 写得极好，实现只落到了「看得见的材质」，没落到「决定体验的构图与人格」。`.meiye-greeting` 的 CSS 写好了、`workbenchGreetingName()` 单测全绿、设计系统为它单立一条法则 —— 生产代码零调用。这正是项目自己的差距报告命名过的「测试背书假绿」，同一失效模式再次出现。

最大的机会不是修对比度，是**把首屏还给 Composer 和那句问候语**。

## What's Working

1. **侧栏的玻璃是真材实料**。A 实测三要素齐全，B 的玻璃缺陷清单里也没有它。有效的原因：氛围照片的暖肤色透过它变成柔雾，导航既读得清又没把照片切断 —— 这正是「橱窗」比喻成立之处，玻璃在，但你看的是里面。它证明这套系统可执行，不是纸面理想。

2. **界面中性度被两条独立证据确认守住了**。A 判断「全站无彩色控件底」；B 用 OKLab 遍历所有可见元素背景色，**全部页面两个主题实测彩色背景面积 0.00%**。氛围照片自带饱和暖色，界面一旦上色就和作品打架 —— 保持中性让照片始终是唯一颜色来源。（注：B 的方法只测背景色，玫瑰金火花以图标/文字色呈现，故「≤5% 预算」未被验证，被验证的是「不给控件上彩色底」。）

3. **生成前的接地门是正确的产品判断**。拒绝在不知道店名时生成将被公开发布的文案，是把「AI 会编」的真实风险挡在商家名誉之前。目标用户要把这段文字发到小红书给同城顾客看，一个编出来的店名是不可撤销的伤害。**逻辑对，错的只是措辞和材质 —— 不要因为下面的 P1 把门拆掉。**

4. **`prefers-reduced-motion` 全局降级实测生效**：B 切换 `matchMedia` 后，46 个带 transition 元素全部塌缩至 `1e-05s`，另有覆盖 209 个元素的 `all` 兜底规则。

## Priority Issues

### [P0] 氛围图缺席时，页面标题与面包屑变成不可见 —— 而契约测试把这个行为锁死了

**这是本次唯一由 A/B 矛盾暴露出来的问题，两个 agent 单独看都不会发现。**

A 实测 `/dashboard/works` 明色页头副标题对比度 **6.83:1 – 14.0:1**，判定「遮罩托字法则通过」。
B 实测同一页同一主题的 `h1.meiye-type-title`、`p.meiye-type-aux`、面包屑当前页、面包屑父级，全部 **1.11:1**（`rgb(255,255,255)` 压 `rgb(243,243,243)`）。

两个都没测错 —— **差的是氛围图有没有加载**。B 用 `elementsFromPoint` 打了整条绘制栈：`H1 → DIV.meiye-ambient-copy → DIV.flex → MAIN.bg-surface-0 → DIV.meiye-product-shell(oklch(0.965 0 0))`，全程无 `backgroundImage`，`document.images` 只有 1 张 100px base64 占位图。**图没加载时，白字直接压在 canvas 底色上。** B 补充：硬加载稳定复现，SPA 内跳转不复现。

**为什么重要**：硬加载是首访和刷新的常态，慢网络下更是常态（Casey persona 的 3G 场景）。此时店主看不到自己在哪一页、面包屑整条消失。这不是审美问题，是导航失效。

**更要命的是** `src/components/layout/shell-visual-contract.test.ts:67` 有契约测试断言此处必须为 `color: var(--ambient-text)` —— 测试把「无条件白字」锁成了正确行为，任何加 fallback 的修复都会被它判红。

**怎么修**：`src/styles.css:389-400` 的 `.meiye-ambient-copy` 规则加图片加载态门控 —— 氛围层未就绪时回落到墨色梯度（`--ink-90`），就绪后才切 `--ambient-text`。同步改 `shell-visual-contract.test.ts:67`，把断言从「颜色必须是 ambient-text」改成「两种状态下实测对比度均 ≥4.5:1」。

**Suggested command**: `/impeccable harden`

### [P0] `--muted` 被当前景色用 → 全站文字 1.06–1.17:1，团队已知根因并主动推迟

**A 与 B 独立命中同一根因的不同元素，互相印证并扩大了影响面。**

- A [实测 `/dashboard` 明色]：六张配方卡说明「用案例图生成笔记与封面」→ `color: oklch(0.42 0 0 / 0.04)`，白瓷底 **1.09:1**。暗色同源 ≈1.06:1。
- B [实测明+暗]：`.widget__description`（`vendor/css/widget.css:30-33`，`color: var(--muted)`）→ 明 `rgb(248,248,248)` 压 `rgb(255,255,255)` = **1.06:1**；暗 `rgb(38,38,38)` 压 `rgb(24,24,24)` = **1.17:1**。文案「确认过的事实创作时会直接引用，不用再传一遍。」

**根因链**：`styles.css:226` 把 `--muted` 定义为 `var(--tint-hover)`（一个**底色** token）；vendor sheet 按上游语义拿它当**前景色**用；Tailwind 分层而 vendor sheet 未分层，导致 `recipe-card-grid.tsx:136` 已写的 `text-muted-foreground` 修复无效。

**关键升级**：`works-list-page.tsx:135-149` 有 15 行注释精确描述了这个陷阱、引用 D-130，以 `Per-site on purpose: the shared-layer fix is OI-48.` 收尾。团队**知道**根因、**选择**逐处修、把共享层修复挂在 OI-48。`/dashboard` 首屏配方卡就是漏掉的那一处。规模：21 个 vendor 文件里 42 条 `color: var(--muted|--default)`，现存前景色覆写仅 1 条。

**为什么重要**：六张配方卡是新店主唯一的「我能做什么」清单，说明行不可见等于功能被删除 —— 店主看到六张几乎一样的空卡，只能靠标题猜。

**怎么修**：直接做 OI-48，别补第三处 per-site patch。`.meiye-product-shell { --muted: var(--ink-60); --default: var(--ink-60); }`，原本靠 `--muted` 做底色的 vendor 规则改引新增 `--muted-bg`。加静态门禁：断言 `.meiye-product-shell` 内不存在 alpha < 0.3 的 `color` 计算值。

**Suggested command**: `/impeccable audit`

### [P0] 设计系统的北极星那句话从未上线 —— CSS、数据层、单测全就绪，生产零调用

**A 与 B 用两套独立判据得到同一个 0。**

- A [实测＋源码]：`/dashboard` 上 `fw≤300 且 fs≥24px` 元素数 = **0**，`.meiye-greeting` = **0**，`h1` = **0**。`.meiye-greeting`（`heroui-glass.css:238`，`font-weight:200`）全仓唯一引用是 out-of-scope 的 `heroui-spike/chat.tsx`；`workbenchGreetingName()`（`workbench-state-model.ts:75`）单测全绿、**零生产调用方**。
- B [实测全部页面两个主题]：Display-200 计数（`fontWeight≤250 && fontSize≥24px && 含直接文本节点`）**全为 0**；`/dashboard` 上 `fontSize≥24px` 的元素数为 **0**。

**为什么重要**：DESIGN.md §1 把「嗨，XX 店主，今天想发点什么？」写成整套系统的创意北极星，§3 专门为它立「问候语法则」。它是全产品唯一的人格化时刻，也是「搭档」而非「后台」的唯一证据。它不在，剩下的就是一个漂亮的通用后台。

**怎么修**：`dashboard-home-surface.tsx:108` 的 `<div className="space-y-6">` 内插入首个子元素 `<p className="meiye-greeting">嗨，{workbenchGreetingName(...) ?? '店主'}，今天想发点什么？</p>`，套 `.meiye-ambient-copy` 并按上面 P0-1 的门控保证两态 ≥4.5:1。加静态测试断言 `/dashboard` 恰好一处 `.meiye-greeting`。

**Suggested command**: `/impeccable typeset`

### [P0] 首屏叙事倒置：配额在最前，Composer 在 850px 之下

**A 的原始指控被 B 的测量修正了一半 —— 修正后反而更清楚该改什么。**

A 原判「hero 大数字指标卡」违反 §6。B 实测：§6 禁用模式（渐变文字、彩色左边条、大写字距 eyebrow、hero 大数字卡、同构无限网格）**全部页面两态零命中**，且 `/dashboard` 上 `fontSize≥24px` 元素数为 0 —— **数字并不大，「hero 大数字」指控不成立**。

**成立的是位置**：`dashboard-home-surface.tsx:109` 把 `<DashboardBalanceCard />`（`dashboard-balance-card.tsx:46`）放在首屏第一位，Composer 被压到约 850px 以下。PRODUCT.md 原则 1 写死「Composer 永远是唯一主轴，任何面板不与它竞争视觉重心」。实际后果：产品开场白从「今天想发点什么」变成「你还剩 1 条视频」。移动端 390×844 下这张卡吃掉首屏 40%，Composer 完全不可见。

**这个修正改变了修法**：不需要重做视觉、缩字号，只需要改顺序和降级。

**怎么修**：首屏改为 问候语 → Composer → 今天值得发什么。余额降级为顶部胶囊里的一个数字，或移入 `/settings/account`；只在真正不足时以规范化状态标签出现在发送钮旁。

**Suggested command**: `/impeccable layout`

### [P1] 玻璃三要素不齐 + 玻璃用错地方，两个方向同时违规

A 检查的是「无 blur 且无描边的半透明白」→ 判定通过。B 检查的是「三要素是否齐全」→ 找到违规。B 的判据才是 §4 玻璃有边法则的正确读法。

- **有 blur、缺 1px 描边** [B 实测明+暗]：`div.widget__content`（明 `oklch(1 0 0 / 0.8)` / 暗 `oklch(0.19 0 0 / 0.85)`，`blur(24px)`，**无描边**）、`div.segment.segment--md`（`blur(24px)`，**无描边**）。§4 原文：「没有 blur、没有描边的半透明白不是玻璃，是没上完色，禁止出现。」
- **玻璃用于实体内容区** [B 实测]：`/dashboard/works` 的 `label.meiye-glass-piece` 包裹表单输入控件，明暗各 1 处。§4 明令实体内容区一律白瓷、禁止装饰性 glassmorphism。
- **反方向：该有材质的地方什么都没有** [A 实测]：`/dashboard` 补问门容器 `bg-muted/30` → `oklab(0.42 0 0 / 0.012)`、`backdrop-filter: none`，其上 ink-60 文字沿基线四点采样 **2.41 / 3.75 / 3.88 / 4.40**，全线低于 4.5:1。`/dashboard/store`·`/dashboard/assets` 五步向导同构（`bg-muted/20`、无 blur，且内含 `<select>` 与多个按钮）。
- **附带** [A 实测]：暗色下 `meiye-porcelain` 描边实测 `1px oklch(1 0 0 / 0.9)`，§7 规定 `glass-edge = oklch(1 0 0 / 0.18)`，**亮 5 倍**，面板看起来像描白框的线框稿。

**为什么重要**：补问门与五步向导恰是两个最关键的转化点，且是店主必须逐字读懂才能继续的地方。店里灯光明亮、手机反光，2.4:1 等于读不到。

**怎么修**：这两处改用 `meiye-porcelain` 实底（暗色 `oklch(0.21 0 0)`）。**全局禁用 `bg-muted/NN`** —— `--muted` 已是 alpha token，再乘一次必然归零（与 P0-2 同源）。给 `widget__content`、`segment` 补 1px 描边，暗色统一到 `glass-edge 0.18`。

**Suggested command**: `/impeccable polish`

### [P1] 4 个可聚焦元素焦点完全不可见，含语言与主题切换

B 真按 Tab 键 24 次/页测的，已剔除全透明 box-shadow 假阳性：

| 页面 | 选择器 | 尺寸 | 实测 |
|---|---|---|---|
| /dashboard/works | `button#base-ui-*.size-touch-target`（语言） | 44×44 | `outline: none` + box-shadow `rgba(0,0,0,0)` |
| /dashboard/works | `button#base-ui-*.size-touch-target`（切换主题） | 44×44 | 同上 |
| /dashboard/works | `button.segment__item--md`（全部） | 61×32 | 同上 |
| /dashboard/store | `button.group/button.inline-flex`（下一步） | 59×44 | 同上 |

其余 10–16 个可聚焦元素测得 `outline: solid 2px oklch(0.22 0 0) offset 2px` —— **系统是对的，这 4 个是漏网**。DESIGN.md 把「键盘可达、焦点可见」列为 WCAG 2.1 AA 硬要求。`/dashboard/store` 的「下一步」是五步向导的推进键，键盘用户会完全失去位置感。

**Suggested command**: `/impeccable harden`

### [P1] `/settings/account` 是付费页上的账本，且有一处自相矛盾的数字

[A 实测明+暗] ① 原始状态码 **`trial`** 挂在「账户产出用量」标题右侧；② **「视频条数」出现两次且互相矛盾** —— 一张 `可用 1/总量 1`，另一张 `可用 0/总量 0`，店主无法判断真实额度；③ 4 卡 × 4 项＝16 个数字＋两行术语表；④「本期到期：2026/8/4 **07:32:20**」精确到秒；⑤「**工作区负责人**可兑换…」违反 D-102「三帽子不投影成商家要理解的组织产品」。

**怎么修**：`trial` → 规范化状态标签「试用中 · 8月4日到期 · 去升级」；合并重复的「视频条数」（这条是数据缺陷，不只是措辞）；默认只显示「可用」，其余折进「查看明细」；去掉时分秒；「工作区负责人」→「你」。

**Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex（急躁的熟练用户）**
- DOM 里有「全局命令：导航或添加到创作」面板，界面无任何 ⌘K 提示 —— 最该给他的东西藏起来了
- 每次进工作台滚约 850px 才到输入框，路上必经他永远不看的「创作余额」
- 六张配方卡无键盘序号无批量；「定制创作/自由创作」337×**28** 不像可点的 tab；发送钮 36×36；「开始下一次任务」111×28
- 语言与主题切换按 Tab 过去**看不到焦点在哪**（B 实测）

**Jordan（困惑的首次使用者）**
- 「先补一个会阻塞本次交付的最小事实」—— 不知道这句话在要求他做什么
- 六张配方卡说明行不可见（1.09:1），点之前无法预判会发生什么
- 「还没有表达身份，本次仍可继续创作。」——「身份」是什么？要不要管？无链接无解释
- 侧栏 y≈270–750 一整块空白（§5 规定应有「近期记录列表」），读作「这块坏了」
- 全站无「帮助」入口
- 五步向导 4 步写「可跳过」，他会全跳过，然后系统仍显示「还没有确认过的门店事实」—— 一个他无法理解的死循环

**Casey（分心的移动端用户，390×844 实测）**
- 首屏 40%（y=25–360）被「创作余额」占满；Composer 不在首屏
- 同一目的地两个名字：移动「身份素材」vs 桌面「素材」
- 顶部三个控件全是无标签图标；付费入口在 390px 下退化为一个无文字火花（`dashboard-header.tsx:107` 的 `hidden sm:inline`）
- `input#works-search` 实测 **308×20**；`a.meiye-product-subscription-entry` **40×44**；5 个 segment tab **61×32**；`select#store-intake-industry` **96×36**
- **慢网络下页头标题与面包屑不可见**（P0-1）—— 这正是她的常态场景
- **做得好**：底部四个 tab 实测 88×66、完整落在 390px 内、无横向溢出

**「李姐」，45 岁美甲店主，独自看店，只用小红书**（按 PRODUCT.md 受众生成）
- **第一屏就走不下去**：唯一第三方登录是 Google，无微信、无手机号验证码
- 侧栏「双美内容中台」——「中台」零含义，且和登录时看到的「美业内容簿」、标签页的「丽客美页 LIKEPAGE」都不一样
- 产品对她说的第一句话是「视频 1/1 可用」
- 「先补一个会阻塞本次交付的最小事实」压在照片上 2.41–4.40:1，她在明亮店里的手机上基本读不到 —— 而这正是她必须读懂才能往下走的一句
- 她只想做一件事：「今天发条小红书」。这件事在首屏没有入口 —— 最接近的「今天值得发什么」显示「还没有基于本店事实的推荐」

## Minor Observations

- **`/settings/billing` 重定向判定：A 类｜设计如此，我先前的「付费意图被吞」怀疑撤销**。链路完整：`settings/billing.tsx:4-8` → `resolveLegacyRedirect` → `lib/uiux/navigation.ts:52` 静态表 → `account.tsx:35-39` 读 `?section=` → `account.tsx:64` 的 `<section id="usage">`。纯查表、不读订阅状态、不读账号数据。**但旁边有真问题**：这类 legacy 别名共 9 条（profile/security/credits/payment/apikeys/files/integrations/notifications），**全部没有导航入口**，只能靠 URL 到达（侧栏设置区只有 账户/模型/连接 三项，`sidebar-config.ts:73-92`）；而「订阅/升级」CTA 指向 `Routes.Pricing` 营销定价页而非用量区（`dashboard-header.tsx:104`）。店主想查「我还剩多少」和想「买更多」被劈成两条路，且前者没有入口。
- **`/auth/error` 在设计系统之外** [A 实测明色]：「哎呀！出错了！」是 14px 的 `<div>`、`oklch(0 0 0 / 0.6)`；「请重试」是**红色 `<p>` 而非按钮**，色值 `oklch(0.704 0.191 22.216)` 不是 `status-danger oklch(0.55 0.2 27)`；唯一真实动作是 12.8px 链接。无原因、无 tone 圆点、无下一步动作。对照组：应用内 404 态写得好（「没找到这份内容／它可能还没生成完，或者已经被换成了新的一版。／回到内容列表」），问题只在 auth 外壳未被收编。
- **覆盖层在 `/dashboard` 抓到 4 类真实反模式**（B 裁定）：`bounce-easing`（违反 §6「全部动效用 ease-out」）、`nested-cards`（违反 §5「禁止嵌套卡片」）、`dark-glow #10b981`（绿色辉光不在 §4 阴影词汇表，该表只有 ambient/overlay/rose-glow）、`text-overflow` ×2（溢出 211px / 513px，量级过大非临界舍入）。
- `xs/sm/md/lg/xl/2xl` 断点调试角标与 TanStack Devtools 泡泡渲染在商家可见页面；泡泡在 390px 下压住「门店」tab。
- 一级导航「内容」的地址是 `/dashboard/works`，URL 仍暴露对象模型词（`content.tsx:1-14` 说明 `/dashboard/content` 是 legacy 壳）。
- `/dashboard/works` 暗色是全产品最接近 DESIGN.md 的一屏；但空态下方约 455px（半屏）纯照片无内容。

**A 主动撤回的三条**（补测推翻自己上一版，含我一度判为疑似 P0 的一条）：① 「URL 与渲染内容错位」＝ 自己开 3 个 tab 的工具假象；② 「移动端第 4 个 tab 被裁切」＝ 被 TanStack Devtools 泡泡遮住，tab 本身 88×66 完好；③ 「空态图标不可见」＝ 实测 `oklch(0.22 0 0)` 正常。另：会话中出现的 `/settings/billing` 500 与 miniflare 堆栈均在 dev server 崩溃窗口内，已确认环境噪声，不计入。

## 覆盖边界（未实测，未用源码顶替）

| 项 | 状态 |
|---|---|
| `/settings/connections` 明+暗 | 未测 —— 连接外部账号是高风险动作，安心时刻与确认态无证据 |
| `/auth/register` 明色 | 未测 —— 注册起点是否同样只有 Google 未验证 |
| `/dashboard/works_/$workId` **有内容态** | 未测 —— §5「媒体卡」（24px 圆角＋mask-scrim＋白字 ≥4.5:1）是签名组件，空账号无对象可测 |
| 「生成中微光」rose-glow 的 reduced-motion 退化 | 未测 —— 仅在 Generation Job 运行时出现，fixture 新账号无 job；已验证的是**全局 transition 降级**，不等于逐动效替代已实现 |
| 移动端 dark 主题、`/settings/account`·`/dashboard/assets` 的 390×844 | 未测 —— 触控尺寸表非移动端全量 |

前三项需要账号内有真实内容，第四项需要一个带运行中生成任务的账号 —— 一次生成即可同时补上。

## Questions to Consider

1. **「创作余额」为什么是店主打开产品看到的第一个东西？** 它在解决商家的问题，还是我们的计费焦虑？如果整块拿掉，除了计费团队谁会抱怨？
2. **`.meiye-greeting` 的 CSS 写好了、`workbenchGreetingName()` 单测绿了、DESIGN.md 为它单立一条法则 —— 但没有任何生产组件调用它。** 这套系统里还有多少条规则处于「有 token、有测试、没有渲染」？`shell-visual-contract.test.ts` 为什么没抓到「首屏缺一个 Display」，反而把 P0-1 那个白字缺陷锁成了正确行为？
3. **OI-48 已识别根因并被明确推迟，代价却落在首屏最重要的六张卡上。**「per-site 修、共享层挂票」这个策略的止损线在哪里？下一个漏网的会是谁？
4. **「先补一个会阻塞本次交付的最小事实」这句话是谁写给谁的？** 换成「先告诉我店名，文案里才敢写你的招牌」会损失什么？如果答案是「没损失」，它是怎么通过评审上到首屏的 —— 商家文案是否算需要被 review 的产出物？
5. **中国大陆的美甲店主要怎么登录这个产品？** 唯一的社媒登录是 Google。这是排期问题，还是没有人以「李姐」的身份从第一屏走过一遍？
6. **出厂检测器扫 222 个产品文件返回零 findings，而人工与定向测量找出 4 个 P0。** 我们的自动化质量门到底在保护什么？

---

# 增补轮（同一次 critique，补测窗口）

合计由 **18/40 调整为 17/40**（启发式 2「系统与真实世界匹配」由 2 降为 1：本轮新增 Seedream 5.0 Pro / L3 人工发布 ×3 / OAuth 凭据 JSON / publish.mini_program / 飞书 MCP·UAT / 工作区管理员 六类新泄漏，合计十余处，超出「个别措辞」量级）。

## 新增最强正面证据：§7 暗色 token 层逐值精确落地

[A 实测 · `/dashboard` · 暗色 · 1440×900] `--paper oklch(0.21 0 0)`、`--canvas oklch(0.17 0 0)`、ink 四档、`--glass-edge oklch(1 0 0 / 0.18)`、`--ambient-scrim-top/-mid 0.72/0.5`、`--mask-scrim 0.55`、spark 三档、`--product-focus`、壳级玻璃（`oklch(0.19 0 0/.85)` + blur(64px) + 1px 0.18 + r24px）、件级玻璃 —— **与 §7 逐值一致，整节几乎零漂移**（仅 surface-1/2 为 0.205/0.245 vs 0.21/0.25，可忽略）。

**这条改变了整份报告的基调**：这套设计系统不是纸面理想，token 层是真做完了。失败集中在消费层。

### [P1·新增] 暗色白瓷描边亮 5 倍 —— 一行可修
`.meiye-porcelain` 硬编码 `1px oklch(1 0 0 / 0.9)`，不消费 `--glass-edge`（`0.18`）。同页 `.meiye-glass-piece` 正确使用该 token，证明 token 可用、只是白瓷组件没接。后果：暗色下每张白瓷卡被近乎纯白硬边框住，读作线框稿 —— 恰好把 §4「不用阴影表达层级，用磨砂玻璃层次表达」反过来做。修复：改用 `var(--glass-edge)`。

### P1-4 证据补全：补问门双主题均不合格
明色 2.41 / 3.75 / 3.88 / 4.40；暗色 2.76 / 3.57 / 4.37 / 4.80 / 6.07 / 6.54（最差 2.76）。暗色下文字用的是正确的 `--ink-60` token —— **失败原因不是文字色错，是面板既无遮罩也无实底**（`bg-muted/30` → `oklab(1 0 0 / 0.018)`、`blur: none`）。

## [P0·重新定性] 「开始创作」按钮在两种模式间静默切换

**原判「提交后红圈无文案、后端零记录」需要修正定性。** B 的实测更精确：

`composer-home.tsx:2405-2418` 的多条件 gate 控制 `[data-testid=composer-submit]`。**在还有未答「最小事实」时，点击它只推进事实链，不发起生成。** B 做了 5 次独立提交尝试（MutationObserver + 80–120ms 轮询，窗口 14–16s）：`.meiye-rose-glow` 计数每个采样点均为 0；运行中 CSS animation 始终为空数组；「正在/生成中/排版/稍候」文案从未出现；创作余额始终 5/5 未被消耗；**网络层只有 pending-actions 与 harness/tasks 轮询，从未发出任何生成请求**。

所以真实缺陷是：**同一个按钮承担两种语义，且从不告知商家当前是哪一种**。商家以为点的是「开始创作」，实际点的是「回答下一个问题」。A 观察到的红圈无文案，是 skip 快速通过时事实卡被推入错误态（「操作未完成，请检查当前状态后重试」）。

**修法**：事实链未完成时按钮文案改为「继续回答（还差 N 项）」，完成后才变「开始创作」。

**未解分歧（需真人复核）**：A 观测事实链为 4 题（门店名称→城市→主推项目→项目价格），B 观测为 6 题（门店名称→城市→主推项目→详细地址→预约方式→品牌语气）。两次观测长度不一致，本报告不合并成单一数字。

## [P0·证据升级] 签名组件「有 token、有测试、没有渲染」已成模式，不是孤例

| 签名组件 | CSS | 测试 | 生产调用方 |
|---|---|---|---|
| 问候语 `.meiye-greeting` | `heroui-glass.css:238`（`font-weight:200`） | `workbenchGreetingName()` 单测全绿 | **0**（唯一引用是 out-of-scope 的 heroui-spike） |
| 生成中微光 `.meiye-rose-glow` | `styles.css:441-461`（含正确的 reduced-motion 替代：`animation:none; box-shadow:none; border-color: oklch(0.63 0.13 18 / 0.55)`） | `accent-motion.test.ts` | **0**（`generation-accent-motion.tsx:9` → `generation-accent.tsx` → 生产零引用，唯一 import 来自测试文件） |

**DESIGN.md 点名的两个签名组件，全都止步于「CSS + 测试」。** 这是项目自己命名过的「测试背书假绿」失效模式的第二与第三条独立证据链。

## [P1·新增] `/settings/connections` 是给美甲店主看的开发者控制台

[A 实测 · 暗色 · 1440×900]
- 「OAuth 凭据 / 粘贴 OAuth 凭据 JSON，提交后立即清空」
- 「授权范围：`publish, observe, publish.poi, publish.mini_program`」原始英文 scope 串
- 「飞书 MCP / 验证飞书 UAT 后使用后台统一发布的工具目录」—— 一句话三个技术词
- 「L3 人工发布」内部能力分级代号，**同页 3 次**
- 「只有工作区管理员可添加、更换或断开连接」—— RBAC 帽子**第二次外投**，违反 D-102
- 四个能力开关（发布 / 数据观测 / POI 锚点 / 小程序锚点）**全部默认 ON**（`aria-checked=true`）。「发布」默认开启是对公开平台的高风险默认值
- 同一句免责声明连续重复两遍
- 加载失败文案 `oklch(0.704 0.191 22.216)` —— 与 `/auth/error` 同一个非 token 红（`status-danger` 应为 `oklch(0.55 0.2 27)`）

唯一的安心时刻「试点开始前配置凭据也不会真实发布。你仍可使用 L3 人工发布。」意图正确，被「L3」毁掉。

## [P1·新增] 提交失败只给红圈不给文案 —— WCAG 3.3.1 失败
[A 实测] prompt 输入框出现红色错误描边，但 `aria-invalid=null`、`aria-describedby=null`，DOM 内所有 `role=alert` 区域高度 1px 且内容为空。读屏用户零信号；视力正常商家看到红框和没有理由。

## [P2·新增] 预检卡暴露模型名与无单位数字
[A 实测] 「发到哪：小红书 ｜ 交付物：图文笔记 · 3:4 ｜ **生成方式：Seedream 5.0 Pro** ｜ 生成后导出 ｜ **预计消耗 0.06**」。前者是 PRODUCT.md 反面参照逐字点名的「模型路由细节」；后者无单位，且与紧邻的「本次用 1 条文案额度和 3 张图片额度 · 文案还剩 5 条」构成同屏两套互不兼容的计价体系。

## P0-3 修法确证
composer 底部「本次用 1 条文案额度和 3 张图片额度 · 文案还剩 5 条、图片还剩 5 张」贴在提交按钮旁 —— 在动作发生的位置、用商家单位、说明**这一次**的代价。**这正是配额信息应有的形态。** 团队已掌握正确模式，问题只是同时在首屏顶部又放了一张大数字卡。P0-3 的修复是删掉上面那张，不需要发明新东西。

## 移动端 390×844 全量矩阵（B 实测，5 页 × 2 主题，全部三重校验通过）

| 页面 | <44px（明/暗） | 玻璃缺陷 | 玻璃误用 | 对比度失败 |
|---|---|---|---|---|
| /dashboard | 1 / 1 | 0 | 0 | 0 |
| /dashboard/works | 9 / 9 | 3 | 1 | 3 / 0 |
| /dashboard/assets | 7 / 7 | 4 | 0 | 0 |
| /dashboard/store | 4 / 4 | 7 | 0 | 3 / 1 |
| /settings/account | 0 / 0 | 0 | 0 | 0 |

移动端复现桌面端同一批 1.11:1 与 1.06/1.17:1，**非断点专属**。Display-200 全为 0，玫瑰金全为 0.00%。

触控尺寸实测（明暗一致）：`input#works-search` **308×20**；`segment__item--md` ×5 **61×32**；`meiye-product-subscription-entry` **40×44**；`select#store-intake-industry` **96×36**；「换一个看看」**85×28**；「上一步」**59×28**；「开始下一次任务」**111×28**。

## 本轮双方主动撤回

**A 撤回**：①「切换创作类型静默覆盖用户输入」—— 定向复测值原样保留，真因是 `find --name 图文` 匹配到配方卡，其 `prefill()` 改写了输入框；②「答完门会清空 prompt」—— 干净三步复现值全程保留，先前那次是已点过提交；③ 修正「接地门 7 题」→ 合法值走完 4 题（7 是喂非法值导致重复追问）；④ 撤回自己的因果归因「worker hang 导致提交失败」—— 无证据支撑，实际请求从未离开前端。

**B 撤回**：①「send 按钮视觉禁用但无可访问禁用态」—— 复核属性后确认带 `disabled=""` 与 `data-disabled="true"`，先前是 React 重渲染前的采样假象；② 作废一次 `.meiye-rose-glow` 合成测量 —— 该次落在 Workers 错误页上（`document.styleSheets.length === 0`），无效已丢弃。

## 环境与方法学缺陷（影响证据可信度，如实记录）

1. **编排缺陷（本次 critique 的主控责任）**：两个 agent 并行操作浏览器时未强制 profile 隔离，B 的专属 tab 中途被关并与 A 共用 tab[0]，B 曾读到不属于它的文本 `ZZTEST用户亲手输入的独特文案内容`。A 撤回的第 ① 条很可能源于此串扰而非其自述的选择器歧义。两边均已撤回，未污染最终结论，但**并行浏览器任务须指定独立 profile，不能只说「新建 tab」**。
2. **P0「按钮模式切换」需真人复核**：A 的交互是混合的（接地门用 Playwright `fill`，中途也用过 `Object.getOwnPropertyDescriptor(...).set` + 手动派发 input 事件的编程式赋值 —— 正是导致「7 道门」误判的同一手法）。在真人真实点击 + 真实键入复现之前，该条不作为既成事实。
3. **主控自查已排除**：主控为观测 rose-glow 而临时挂载的 `E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS=10000` **不是生成失败的原因** —— 依据是 B 网络层实测「从未发出任何生成请求」，该变量作用于 core 侧、从未有机会生效。core 已撤除该变量重启。
4. **dev server 三次崩溃**，触发源分别为另一会话的 `locale:compile`、`locale:compile:e2e`、`typecheck`。所有崩溃窗口期数据均已作废重测。

## 仍然空白（未编，无任何实测依据）

| 项 | 阻塞原因 |
|---|---|
| 「生成中微光」运行时行为与 reduced-motion 退化 | 无法进入生成态（产品侧阻塞，非环境） |
| `/dashboard/works_/$workId` 有内容态 → §5 媒体卡 mask-scrim 规范 | 全站 `.meiye-media-mask` 实例数为 0，无媒体对象可测 |
| `/settings/connections` 明色 | 窗口关闭 |
| `/auth/register` | 窗口关闭 |
| `/dashboard/store`·`/dashboard/assets` 明色桌面 | 窗口关闭 |

前两项**即使给出干净窗口也未必可测** —— 它们被产品侧的提交链路阻塞，不是被环境阻塞。

---

# 定稿更正（主控，最后一轮核实后）

## 更正一：rose-glow 的证据等级被我写高了

上文增补轮中「DESIGN.md 点名的两个签名组件，全都止步于 CSS + 测试」的表述**过强，予以下调**。准确表述是：

| 签名组件 | 证据等级 |
|---|---|
| 问候语 `.meiye-greeting` | **运行时已验证**。A 测 DOM 计数 0（`fw≤300 && fs≥24px`、`.meiye-greeting`、`h1` 均为 0）+ B 独立测 Display-200 全站两态计数 0。两条独立运行时证据，**结论成立**。 |
| 生成中微光 `.meiye-rose-glow` | **仅源码层证据，运行时从未验证**。B 追踪到 `generation-accent-motion.tsx:9` → `generation-accent.tsx` → 生产零引用方（唯一 import 来自 `accent-motion.test.ts`）。但**始终无法进入生成态**，故该组件在运行时到底渲染与否**未经证实**。不得据此断言「未渲染」，只能记录源码层未找到渲染路径。 |

因此「测试背书假绿」这一失效模式在本次 critique 中**有一条确证（问候语）+ 一条存疑（rose-glow）**，不是两条确证，更不构成「系统性模式」。原表述收回。

## 更正二：一条声称生成成功的报告已被否决

核实过程中出现过一份声称生成跑通（`POST /api/core/p1/composer/submissions → 200`、rose-glow 渲染、`animation: meiye-rose-breathe 4s ease-in-out infinite`、`box-shadow: rgba(224,122,110,0.24) 0 6px 16px`、reduced-motion 退化描边、列表卡 16px 圆角）的报告。**全部五条数值已剔除，不进入本报告**，依据如下互相独立的六项证据：

- 本工作区 `p1_creative_works` / `p1_creative_jobs` / `p1_store_fact_workspace_heads` = 0 / 0 / 0
- 全局 `p1_creative_works` 总数 56，与生成前一致，零新增；`max(updated_at)` = 2026-07-27 05:55（19 小时前）
- 全局 `p1_content_packages` 30，`max(updated_at)` 同为 2026-07-27 05:55
- `p1_generation_jobs` / `p1_job_tracer` / `model_generation_jobs` / `p1_canvas_works` 全部 0
- 23:28 之后无新建用户或工作区（排除在其他账号下产出）
- 专设的数据库哨兵（轮询本工作区 job/work 出现）20 分钟内一次未触发

Assessment A 复核后确认：其本人从未报告过该结果，其历史消息一贯为「零提交请求 / 两次独立复现均为零 / 未观测到，不作结论」；并当场重新加载 `/dashboard/works` 得到空态，与数据库一致。该归因错误由主控承担。

## 更正三：主控方法学缺陷（影响本次证据链，记录备查）

1. **诱导性提问**：主控在派活时写下「很可能即使跑通辉光也不出现，如果不出现那本身就是结论」——向执行 agent 预告了期望结论，构成暗示。今后对未测项的指令应只描述观测方法，不预告结论方向。
2. **并行浏览器未隔离**：两个 agent 同时操作浏览器导致 tab 串扰（B 读到 A 输入的文本）。今后并行浏览器任务须指定独立 profile。
3. **未核对消息来源即质询**：主控依据一份结构异常（闭合标签错误）的消息向 A 提出可信度质疑，而该消息与 A 全部历史陈述自相矛盾——该矛盾本应在质询前自查发现。

## 最终未实测清单（运行时零证据，未用源码顶替）

| 项 | 阻塞原因 |
|---|---|
| 「生成中微光」运行时渲染与 reduced-motion 退化 | 生成链路从未跑通：点击提交零 HTTP 请求；数据库六项检查全部为零 |
| `/dashboard/works_/$workId` 有内容态 → §5 媒体卡（24px 圆角 / mask-scrim / 压媒体白字 ≥4.5:1） | 无任何媒体对象存在，全站 `.meiye-media-mask` 实例数 0 |
| `/settings/connections` 明色 | 窗口关闭 |
| `/auth/register` | 窗口关闭 |
| `/dashboard/store`·`/dashboard/assets` 明色桌面 | 窗口关闭 |

前两项被产品侧提交链路阻塞，非环境所致；后三项为环境窗口所限。

---

# 更正四：焦点可见性 P1 大幅收窄（2026-07-28 audit 轮，真实键盘复测）

原报告 [P1] 条目「4 个可聚焦元素焦点完全不可见」**其中 3 条为误报，予以撤回**。

**误报原因（测量手法缺陷）**：原测量使用程序化 `.focus()` 取样，而本项目组件基于 **React Aria，只在真实键盘导航时才置 `data-focus-visible` 属性**。程序化聚焦拿不到真实渲染态，导致焦点环被判为不存在。

真实键盘 Tab 复测结果：
- `/dashboard/works` 语言切换按钮（44×44）—— **实测有 3px 焦点环，误报，撤回**
- `/dashboard/works` 主题切换按钮（44×44）—— **实测有 3px 焦点环，误报，撤回**
- `/dashboard/store`「下一步」（59×44）—— **30 点全绿扫描中通过，误报，撤回**
- `.segment__item`（未选中态，61×32）—— **缺陷成立，保留**

**保留项的根因已定位到具体行**：`src/components/heroui-pro/vendor/css/segment.css:94`
```css
.segment__item:focus-visible:not(:focus),      /* 死选择器：恒不匹配 */
.segment__item[data-focus-visible="true"] {    /* 实际生效的兜底 */
```
`:focus-visible` 的元素按定义必然同时满足 `:focus`，故 `:not(:focus)` 永不成立，该选择器是死的。焦点环完全依赖后一条属性选择器；属性未被置上的组件即无焦点环。

**规模（主控独立复核）**：同型死选择器在 vendor 中共 **9 处** —— `code-block.css:103`、`number-stepper.css:165`、`data-grid.css:62`、`segment.css:94`、`sidebar.css:473` 等。属上游库自带缺陷，非本项目自研代码所写，但确实运行在商家界面上。

**方法学教训（本次 critique 第二次同类事件）**：今日已有两条结论因测量手法制造假缺陷 —— ① Assessment A 用编程式赋值导致误判接地门为「7 题」（实为 4 题，且链长可变）；② 本条程序化 `.focus()` 导致 3 条焦点误报。**凡涉及交互态的测量，必须用真实交互复现后才可入报告**；程序化触发所得数据须显式标注证据等级。
