# 商家前台 critique 整改 brief — 2026-08-07

依据：`.impeccable/critique/2026-08-07T12-52-43Z__mkfast-template-main-src-routes.md`（22/40，3 P0 + 2 P1 + 次要观察）。用户拍板：主轴 P0 优先、订阅禁用属业务现状（修法=留资）、范围全收（P0–P3）。执行顺序：shape → clarify → adapt → harden → typeset → layout → polish。

## Shape 决策（2026-08-07 用户三案拍板）

**D-C1 chip 语义＝「空填入、脏不碰」**：正文为空 → 预填意图文案（无字可吃）；已有输入 → 只挂配方/lens/上下文标签，绝不改写正文；两种路径都给撤销。根因：`recommendation-handoff.ts` 的 `applyRecommendationHandoff` 无条件 `updateUserText`，违背 lens 状态机自身「Switch always keeps user text」契约（`lens-state-machine.ts`）。修复兑现 PRODUCT.md「绝不静默覆盖用户输入」。

**D-C2 发送门＝保 D-081，必选态做可见**：不给默认 lens（lens 决定报价与交付物，显式选择有理，D-081 不翻案）。整改：创作类型 chip 与建议 chip 视觉分族并标「必选」；发送钮未就绪时呈禁用态＋就近说明缺什么；删除与 lens 门冲突的承诺句（「点发送会先问你几个问题」保留给它真实覆盖的门店信息流内问答，`structured-nodes.ts` 机制存在）。

**D-C3 门店页两案都做**：① 资质区按主营方向条件渲染——首发无医美，普通品类不展示医疗资质表单；`display_preflight` 的医疗资质警告同步条件化（数据模型不动）。② 主营方向选项从供给三品类（护发/皮肤管理/生发）扩为全商家词表（美发/美甲/美睫/皮肤管理/生活美容/养发生发），今日推荐对无供给品类照旧 fall-through（`TODAY_RECOMMENDATION_INDUSTRY_SLUGS` 不动，「美甲 intentionally absent」语义保留在推荐层，不再泄漏到商家档案层）。

**D-C4 Idle 态双输入面归一**：门店引导卡撤输入框，降为拟人化一句话提醒＋跳门店页的单 CTA；门店信息补齐走既有流内问答与门店页，恢复「Composer 唯一主轴」（DESIGN.md §Composer、D-031 结构化输入融入对话流）。

## 后续命令范围（来自 critique Action Summary）

- clarify：失效承诺句、订阅卡「开通后通知我」留资化、生成失败双错误合一＋复述「失败将退回积分」、设置页模板腔（你/您）、「安全返回掌心行动簿」、忘记密码安抚。
- adapt：44px 触控合同（发送钮 40px、分段器 28px、门店表单、pricing 页脚）、移动端 /settings 墙开洞（积分购买可达）、「注册」出汉堡、截断与遮挡、侧栏邮箱溢出。
- harden：rail 按钮可访问名称、视觉标题转真实标题元素＋跳级修复、登录态四页页名 title、sessions 空态 CTA、URL 去 surfaceRevisionId、连接页双状态归一。
- typeset：auth 字阶重建＋auth 面组拉回门店橱窗世界。
- layout：pricing 决策分层、顶栏积分控件收敛、settings 卡套卡拆平、五步向导重排。
- polish：4.4:1 对比度、「体验」破折号、面包屑、重复标签、⌘K 降噪。

工程遗留（不属设计命令，建议开票）：生成失败底层归因（dev 疑缺模型凭据）、/api/core/p1/* ERR_ABORTED 确认、composer-home.tsx 4148 行拆分。
