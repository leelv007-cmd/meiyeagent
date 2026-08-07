# 商家前台 critique 整改收官报告 — 2026-08-08

依据：`.impeccable/critique/2026-08-07T12-52-43Z__mkfast-template-main-src-routes.md`（双 agent critique，22/40，3 P0 + 2 P1 + 次要观察）与 `docs/reviews/impeccable-critique-remediation-brief-2026-08-07.md`（shape 决策 D-C1~C4 + 六波范围）。
执行形态：主控（Claude/Fable）编排＋逐波亲验（浏览器实测/看图/抽验），Opus 执行 agent 七波串行实施于 main 检出（用户拍板模式）；每波完整门禁（biome + root typecheck + web 双套件，基线之外零新增），台账逐波记 `docs/ops/merge-ledger.md`。

## 七波完成度：7/7（38 个功能 commit，未 push）

| 波 | commits | 关键成果 |
|---|---|---|
| shape（D-C1~C4） | 7bbef98c..4ab9d6b4 | chip 空填入脏不碰＋撤销＋通知条；发送门保 D-081、必选态可见＋禁用有因；Idle 单主轴（Day-0 卡变提醒+CTA）；门店资质条件渲染＋品类词表六项（含美甲/美睫）；顺带修复 HEAD 上四处既有 typecheck 断裂 |
| clarify | 72497d1d..0cdcd456 | 订阅卡「开通后通知我」留资（/contact?plan=*）；生成失败单一错误＋真话「没跑起来的创作不扣积分」（无条件退分承诺被 spec §230 反驳）；「您→你」33 键清零＋回归守卫；掌心行动簿→移动工作台；忘记密码安抚 |
| adapt | b6e3dd21..9c0ea30f | pointer:coarse 48px 触控地板（composer 胶囊/分段/发送、门店 select、页脚、抽屉行）；移动 settings 墙开积分专洞＋返回链；注册上手机导航栏；面包屑挤压修复；2 反驳（邮箱截断正常、底衬已存在） |
| harden | c06a2d0a..6b92a5f4 | 真实标题层级（store/works/pricing/dashboard）；逐页 tab title（appPageHead）；sessions 空态文案+CTA；surfaceRevisionId 出 URL（死参数）；连接页单状态＋能力位门控灭 5×403；2 反驳（rail 刻意 aria-hidden、tasks 重定向系 T34/D-127 故意） |
| typeset | 046032a5..77e18312 | auth 五页入门店橱窗：44/24/16/14/12 字阶（原 12–16 扁平）、氛围 token 上提 :root 单源、白瓷卡、暗色主题补齐（原白锁）、零玫瑰金、对比度地板 5.21:1、CJK keep-all 断行、注册页得到问候语 |
| layout | 96e61be5..93409711 | pricing 套餐主/加油包次级条带＋「免费」补位；顶栏积分单入口（本页时降 span+aria-current）；settings SettingsSection 拆平（7 卡 4 重复标题→4 面 0 卡头、标题零跳级）；向导变进度轨（去 per-chip 可跳过、必做只说一次）；sessions H1 创作过程；outline 按钮补描边（DESIGN 玻璃有边） |
| polish | 1c493851..b179628d | 双基线红击杀（solid 底＋标题名解嵌）；muted-foreground 4.39→5.10:1（18 处共享病灶）；⌘K sr-only 泄漏根修（DialogHeader 入 portal）；纠错说明折叠为 details；孤儿键清理 |

主控直修：无（全波由执行 agent 完成，主控只做验收与台账）。

## 终态门禁（polish 波全量回归）

- root typecheck：exit 0
- web 单测：1999 tests / **0 fail**（两个基线红已连根修复，非跳过）
- web 交互：548 tests / **0 fail**
- core：3258 tests / 0 fail / 222 skip（PG 套件，按纪律留给票面级电池）
- 检测器复扫（商家路由+样式层）：**0 findings**（vendored heroui-pro 的 5 条既知发现除外，属第三方低所有权）

## 执行 agent 反驳主控/critique 的论断（复核机制产出，均采纳）

1. 爆款复刻确认句实为罐头常量而非商家手打——D-C1 统一适用（主控前提被反驳）
2. 「失败将退回积分」是按模型开关的分支承诺，不可无条件复述（spec §230）
3. 「3 个基线红」过期——真基线 2 红且归因 be81436c；最终两红均被连根修复
4. 侧栏邮箱溢出 81px＝正常截断的 scrollWidth 签名；底部导航遮挡＝固定条中滚动错觉（84px 底衬在位）
5. rail 无可访问名＝刻意 aria-hidden 装饰件，旁有 44×44 已标注开关
6. settings「10 卡套卡」不复现——真病是标题与卡互相复读＋5 条 bg-muted 底带
7. ⌘K「常驻行」从未可见——是 portal 外的 sr-only 泄漏（对读屏是真病，从根修）
8. 门店面包屑已诚实；「内容工作区」是去往同名页的顶栏动作
9. 方法学：本 app 暗色为 class 驱动，Playwright colorScheme 拍出来的是浅色（后续验图须 localStorage 注入）

## 遗留（建议开票，未授权不执行）

1. **supportEmail 供给**（用户项）：`src/config/website.ts` 未配 `supportEmail`，/contact 投递必抛错——留资链路最后一米，需真实地址。
2. **落地页暗色不感知**（本次范围明确排除落地页）：42 处硬编码 text-black/bg-white 跨 6 组件；暗色下 hero 1.14:1。连带：lime 强调色 1.52–1.66:1、手机样机文案 2.37–4.35:1。
3. **时间桥异步覆写假说**：`composer-home.tsx` 服务端恢复路径可把空 `merchantText` 写入正文（chip 类已在入口闭死，此为独立隐患）。
4. **catalogRecipeRevisionId 对仍走 URL**：承载「配方绑对面」的完整性，迁 sessionStorage 需动恢复链，单独开票。
5. **`composer_run_failed_credits_returned` 无条件退分承诺**与按模型开关矛盾（D-164⑥ 域）。
6. shadcn `CardTitle` 渲染 `<div>`（连接页卡标题非标题元素）——共享 ui 组件改动需单独决策。
7. `/privacy` 共享 `.meiye-auth-shell` 仍白锁暗色。
8. 门店向导原生 `<select>` 与自定义控件不成族。
9. 生成链本地环境缺模型凭据（`HARNESS_LIVE_MODEL_REQUIRED_ERROR`）——e2e/journey 背书留给下一张功能票。

## 建议下一步

修完后重跑 `/impeccable critique`（同 slug 记趋势：18 → 23 → 22 → ?）实测分数变化；商家前台三 P0 已全灭，预期显著上行。
