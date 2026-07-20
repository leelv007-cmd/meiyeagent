# 产品真机走查差距评审 — 2026-07-18（HEAD 97f7914）

> **状态：固定提交快照。** 本报告记录 `97f7914` 的真机观察；其中视频入口、token 流、投影收束、视觉与遮挡等后续处置不得从本正文推断，当前状态以 [`implementation-gap-ledger-2026-07-19.md`](./implementation-gap-ledger-2026-07-19.md) 和最新代码/测试为准。

**方法**：四服务真机拉起（core+worker+web+canvas，业务库 `meiye`，harness=FIXTURE 激活，DBOS 系统库 `meiye_walkthrough_dbos`），全新账号 `day0-walk@example.test` 从 Day-0 冷态起步，浏览器实走：注册登录 → 一句话开工 → 交付 → 三平台变体 → 导出 → 收件箱审批 → 人工交接 → 记录发布 → 信号补记 → 结果阶梯；另覆盖 素材/门店/设置/定价/Pro Studio/画布轻编辑/移动端视口。对照基准：产品设计权威文档（D-001~D-041）+ PRODUCT.md/DESIGN.md + 全量功能 spec 提炼的 40 项可眼验清单。

**结论一句话**：主链闭环真实跑通、诚实性纪律（无价门/无伪案例/三态能力/单阻塞审批）落地质量高；但 **视频成片在 UI 上不可达（P0 主打功能断头）**、**token 流式未接（违 ADR-0007 现行口径）**、**新旧投影并存自相矛盾**、**收件箱审批卡可被浮层遮挡**四项属必修，另有一批商家语言泄漏与视觉系统未到 DESIGN.md 规格的差距。

---

## 1. 范式级六项对照（设计文档身份基准）

| 项 | 判定 | 依据 |
|---|---|---|
| B1 Composer 唯一主轴 | ⚠️ 部分 | Composer 在且是入口，但非 DES 规格（白瓷大卡+墨丸发送钮未见）；「今天值得发什么」浮卡与主内容抢重心且引发遮挡 bug（§2.4） |
| B2 无槽位填表 D-031 | ✅ | 主流程只有意图文本+场景 chips；表单只出现在审批边界（合法）与档案页（合法） |
| B7 成品优先 D-023 | ✅ | 首个结果=完整可采用成品（标题+正文+CTA+可使用标签），无先选稿 |
| C1 Day-0=Day-N D-029 | ✅ | 新账号直接进同一工作界面，零建档即可开工；冷态推荐诚实（"还没有基于本店事实的推荐"） |
| D4 一点胭脂法则 | ✅(偏保守) | 玫瑰金只出现在氛围带火花；生成辉光/AI 火花时刻未观察到（fixture 即时完成，无法确证 D7） |
| F2 定位边界 D-030 | ✅ | 全站无预约管理/收银/库存/CRM/排班面；线索台账=信号回执，未越界 |

## 2. P0 差距（必修）

### 2.1 视频成片 UI 不可达（违 D-027「视频成片入 P0 主打」）
- 桌面工作台任何状态（Day-0 冷态、新建创作、暂时跳过、热态回访）均不渲染「快速起步」段——`unified-creation-workbench.tsx` 中 `做视频`（`video.generate`）入口挂在 `workbenchStage === 'empty'` 条件下，实测该段在所有可达状态下从未出现（dead UI path）。
- 移动端「移动工作台」首页同样无视频入口。
- 成品包内：抖音/视频号变体只有文字变体，包内无成片生成入口（`VideoWorkflowPanel` 仅在 `contentPackage.kind === 'video'` 时渲染，而用户造不出 video 包）。
- 后端管线完备（`apps/core/src/video/` composer/renderer/proof），配额面板已展示"剩余视频"——纯前端最后一公里断头。

### 2.2 token 流式缺失（违 ADR-0007 / 07-13 路径B 拍板）
现有 SSE（`use-workflow-event-stream.ts`）只承载 `workflow.progress`/`workflow.state` 帧，消费方仅 video-workflow-panel 与 harness-question-card；文案主链整包返回、TanStack Query 失效刷新。这正是 07-13 拍板废弃的「Job 级进度条」口径。fixture 即时返回掩盖了体感，但通路缺失是代码层事实（07-18 拆票盘点已记录"copy流非SSE"，未见改判决策）。

### 2.3 新旧两套投影并存且互相矛盾
同一次任务：工作台显示「文案 revision 1 已交付」，而 `创作记录`（sessions）与 `作品详情`（works）页显示「草稿 · 对象已保存，但尚未提交执行 · 持久化结果 0」。旧 P1 works/jobs 投影面（素材页"历史投影"导航：最近/搜索/作品/执行任务）仍全部暴露给用户，与内容包新链两套真相并行。店主视角=系统自相矛盾。

### 2.4 收件箱审批卡被浮层遮挡（关键路径可卡死）
1280×720 视口下，「今天值得发什么」与「添加图片素材」卡浮在异步任务中心弹层之上，「确认并发布」按钮被遮挡不可点（截图证据在会话 scratchpad `shot-09-blocked.png`）；1440×900 下工作台「查看本次设置」同样报 blocked-by-overlay。z-index/层级需系统性清理。

## 3. P1 差距

1. **配额双口径矛盾**：内容页顶栏「剩余内容 30/30 · 剩余视频 5/5」vs 账户页「文案 可用21/总量30 · 图片总量0 · 视频总量0」；实际已结算 9 条文案后内容页仍显示 30/30。两套 meter 语义未对齐或其一为假数。
2. **商家语言泄漏（违 F4/B11/D-007）**：
   - 「生成三平台版本 · **US$0.06**」——Provider 美元成本直出为按钮价签（复审五类根因之"Provider成本≠售价"在 UI 的残留）；
   - 热点机会卡「地域范围: **ws_6xkZiR2Oh…**」内部 workspace ID 直出；
   - 费用账本「**llm-openai**」供应商 slug 直出；
   - 创作记录/作品详情/画布页出现「打开 Session / 打开 Work / 0 个 Asset · 0 个已接受 Content / 不可变 revision」等对象英文；
   - 画布编辑区暴露 `official-before_after-v2-seeded-preview-headline` 模板 slug；
   - Pro Studio 页整段英文未翻（"Advanced Canvas generation, agent-assisted editing…"）。
3. **视觉系统离 DESIGN.md 规格的距离**：侧栏为白色实心贴边栏，非「磨砂玻璃悬浮板」（A2/D2）；氛围层只有顶部一条暗色抽象纹理带，非全出血美业影像（D1/C5）；问候语未带店名个性化（D5 部分）；顶栏无订阅/升级玻璃胶囊+玫瑰金火花（F1 缺失，付费墙前置缺 UI 锚点）；「闭店内容簿」徽标语义费解（en="After-hours content book"，中文"闭店"易读成停业）。
4. **回访首屏空灰块**：图文成品无图片素材时，「结果与接受」预览区留一整屏灰色空位，首屏价值锚定弱。
5. **C2 示例橱窗偏弱**：冷态只有「查看示例」按钮，未见可"做同款"的预置示例门店成品橱窗（按钮点开深度未测，存疑非定罪）。
6. **审批完成后无成功反馈**：确认并发布后待办直接消失，无 toast/回执指引去向；控制台伴随一次 422/403（未复现定位，建议排查 approval consume 的重试路径）。

## 4. 通过项（真实亮点）

- **全链闭环一次走通**：意图→交付→变体→导出（回执含平台/时间/SHA/zip 下载）→收件箱 JIT 审批（恰一次语义、绑定版本/账号/平台/时间/费用）→已准备人工交接→记录发布→六类信号补记（<10 秒）→结果阶梯五级点亮。D-032/B12/E8/E9/E10 全数落地。
- **诚实性纪律**：无价门生效（成品零具体价格承诺）；热点缺信号时降级为常青并如实说明；自动发布如实标注"尚未完成真实验证，请导出后手机端发布"（三态能力 D-024）；相关性明示"不代表由该内容导致"。
- **两层独立交付 D-028**：文案任务交付即文案本身，无强制成片、无降级表述。
- **资产三页**：门店"粘贴价目表生成可编辑初稿"是好的 AI-native 进料；表达身份登记（品牌/个人IP + 三栏偏好）+ 无身份回退中性表达提示在位。
- **商业面**：定价页按产出量口径（"某类不足只阻止对应生成"）、Growth ¥499/月落在拍板价格带、Pro Studio ¥299 独立加购、画布轻编辑与 Pro Studio 分层清晰（输出用途/水印/AIGC 标识/存为自建模板齐全）。
- **移动端**：独立「移动工作台」（行动/进度/交接三段式）而非响应式压缩。

## 5. 环境备忘（非产品缺陷）

- 根 `.env` 的 `MODEL_DIRECT_API_KEY`/`TUZI_MEDIA_API_KEY` 仍是 `set-via-docs` 占位符，且未配 `HARNESS_DBOS_SYSTEM_DATABASE_URL`——今日 20:04 用 `pnpm dev` 起的栈 harness 实际未激活（工作台任务链路不通）。要跑 direct 真机需补这两类配置；本次走查为此以 e2e 配方重启了四服务。
- 注册流程依赖邮箱验证而本地无邮件通道，需手工 `update "user" set email_verified=true` 才能登录——本地开发体验可考虑 APP_ENV 门控放行。

## 6. 建议处置顺序

1. 视频入口接通（2.1，含桌面快速起步段 stage 条件修正 + 包内成片入口）——P0 主打回归。
2. 遮挡 bug 与审批反馈（2.4 + 3.6）——关键路径可用性。
3. 投影统一：sessions/works/历史投影四页要么读内容包真相、要么下线收敛（2.3）。
4. token 流式按 ADR-0007 接通（2.2）。
5. 商家语言清扫 + 配额口径统一（3.1/3.2）。
6. 视觉系统按 DESIGN.md 走一轮专项（3.3/3.4），建议与 3.2 合并为一个「橱窗打磨」票包。

—— 走查执行：主会话真机浏览（agent-browser），证据截图存会话 scratchpad（shot-01~12），对照清单由子代理自权威文档提炼（40 项）。

---

## 7. 处置执行记录（2026-07-18 当晚，主控编排）

同日两波并发 Codex + Opus 对抗复核 + 定向返工，全部差距处置完毕。

### 7.1 Wave 1（四路并发，全部合入）
| 车道 | 分支 | 处置 | 复核裁决 |
|---|---|---|---|
| A 视频入口（§2.1+§3.1/3.2 部分） | fix/walk-a-video | 成品类型 chips（做图文/做视频）双态可达；抖音/视频号变体「生成视频成片」派生（绑 source workId，额度门诚实拦截）；移动端视频路径；US$ 价签→额度口径；llm-openai→能力名；配额条与账户同源 | 无 P0；1 P1 经主控查证 core 有 BRIEF/GROUNDING 双 409 兜底→降级 P2 |
| B 投影统一（§2.3） | fix/walk-b-projection | 六个历史路由统一读内容包权威态；「已交付·第N版·可使用」直达成品；真草稿/旧版流程记录两类诚实标注；素材页历史投影导航摘除；对象英文词清扫 | 无 P0/P1，"草稿谎言"被证结构性不可能 |
| C 遮挡+审批反馈（§2.4+§3.6） | fix/walk-c-overlay | 弹层 body portal + 全局 z 阶梯 token（base<sticky<sidebar<popover<overlay<toast）+ 侧栏 pointer-events 隔离；审批成功 toast/失败可重试卡；单飞锁封双击 | 无 P0/P1；portal/SSR/锁全反驳失败 |
| D 语言+开发体验（§3.2/§5） | fix/walk-d-language | ws_ ID→本店服务范围；Pro Studio 中文化；闭店→打烊；用量四术语白话解释；本地注册免邮箱验证（isDev 锚定生产安全）；目录商家语言清扫 | 无 P0；2 P1 → RW2 |

### 7.2 RW1（后端审批复导出死锁，主控真机诊断出的存量缺陷）
诊断链：同变体复导出生成同 id 审批请求（决定性 id 缺实例维度）→ findIndex 命中已 consumed 条目→APPROVAL_REQUEST_NOT_PENDING→错误类无 status 被吞成 INVALID_COMMAND 400→命令租约 5 分钟锁死重试。修复（fix/walk-rw1-approval, 225367e）：请求 id 加入 revision+platform+variant 维度；存量重复 id 按 pending+binding 兼容匹配；错误 404/409 保真；确定性 4xx 立即弃 claim；**抖音导出无审批判定为缺陷并修复**（target-platform 限制移除）。真机复验：卡死的 pending 成功消费。

### 7.3 Wave 2 + RW2（三路并发，全部合入）
- **RW2**（fix/walk-rw2，8 项）：auth e2e 注册用例适配自动验证（真机 playwright 5/5 过）；已释放文案纠偏（失败/取消/到期）；isDev 锚测试补钉；QuotaMeter 遗孤删除；移动端水印改读 workspace 合规默认；revision→第{n}版；共享 query retry 对齐；异步中心 Escape/外点关闭+焦点归还。
- **Lane E token 流式**（fix/walk-e-stream，ADR-0007 落地）：`workflow.token` 帧契约（append-only，全局单调 sequence，title/body/cta 通道）；core 走 AI SDK streamText+partialOutputStream，fixture 8字符/40ms 分块；工作台渐进渲染+白话进度（正在为你起草文案…）+终态权威对账+SSE 降级兜底；`create_creative_work` 可选 operation 持久化（E4，重载恢复视频编排器已真机验证）；问候个性化+无图文案紧凑卡（空灰块消除）。
- **Lane F 橱窗打磨**（fix/walk-f-visual，DESIGN.md 达标）：磨砂玻璃悬浮侧栏（12px 外距）；全出血暖光美业氛围层（仓内素材，双主题遮罩保对比）；顶栏订阅/升级胶囊+玫瑰金火花（useCurrentPlan 态感知）；暗色主题材质补齐；打烊徽标安静化。主题切换"失灵"根因=下拉需二次选择，非缺陷。

### 7.4 收口基线（全部真机）
- contracts 35/0 fail；web 473/0 fail；core（真 PG+DBOS）1167/0 fail（6 live-provider skip）；auth e2e 5/5。
- 浏览器实走：流式中间态（白话进度行）→终态对账、视频工作重载恢复、暗色/移动端视觉、审批闭环（复导出→确认→消费）全部通过。
- 附带修复：F 引入的两个测试文件 Node24 `cloudflare:` 崩溃，主控按仓库标准 registerHooks+动态 import 修复。

### 7.5 剩余 P2 backlog（不阻塞）
ai-image-selector/identity-manager raw status 直出；canvas 模板 slug 兜底泄漏；en.json 英文侧术语清扫；admin 面 5 处 "Work" 字样；工作台 hero z-10 未走 token；移动端异步中心 z-20 靠 DOM 顺序；portal 焦点 trap；热点卡正则启发式两向边界；hydration state 仍含内部 id（显示层已滤）；移动端页头"移动工作台"重复；工作台交付行 "revision" 字样；跨查询最终一致瞬时"旧版流程记录"；遗孤 locale 键清理；canvas-work-page 对象词；滚动监听未节流；sonner z 全局降级；托管环境 Last-Event-ID 断线续传与真实 provider 增量流待真机验证（fixture 已验）。

### 7.6 末轮复核与 RW3（同夜收尾）
- 末轮 Opus 复核两路：Lane E 放行（无 P0/P1；累积快照转 delta 陷阱被专测钉死证伪，单调游标结构性防翻倍；4 P2 全由终态对账兜底）；Lane F/RW2 无 P0，1 P1（浅色主题氛围区深墨字对比度）+ 数条 P2，另将 isAdmin 语言前缀、useCurrentPlan 崩溃、cloudflare stub 修复、R3/R4/R5/R8 等点名疑虑逐一证伪。
- **RW3**（fix/walk-rw3，39ed65a+ea4d0c8）：氛围区文字对比度修复（浅色空态用氛围浅字/实底）、R6 漏改串（needs_attention 第{n}版）、admin 头部胶囊 padding 回归、useCurrentPlan staleTime+关焦点重取、订阅胶囊白瓷实底、移动端视频合规默认加载期提交门（pending 不可提交/error 显式警告）。
- 终验：web 477/0 fail；浅色主题实走=白瓷卡+深字+白问候压氛围带，暗色=深玻璃材质，双主题成立；此前"半明半暗"帧确认为手动切换瞬态非缺陷。
- 最终 HEAD 全套基线：contracts 35 / web 477 / core 真机 1167，全 0 fail；auth e2e 5/5。
