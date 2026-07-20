---
target: mkfast-template-main product app (门店橱窗 shell)
total_score: 30
p0_count: 0
p1_count: 3
timestamp: 2026-07-18T15-57-52Z
slug: mkfast-template-main-src-product
---
Method: dual-agent (A: impeccable-a · B: impeccable-b)

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | 「正在为你起草文案…」在实际阻塞于素材/Brief 确认时仍持续显示，分不清"在干活"和"在等我" |
| 2 | Match System / Real World | 3 | 商家语言整体优秀，但泄漏 统一输入台/并发任务/"Before / After"/授权制度依据编号 |
| 3 | User Control and Freedom | 4 | Brief 可采可改可忽略、版本历史+回滚、暂时跳过、撤回，全线成立 |
| 4 | Consistency and Standards | 2 | /pricing 整页模板橙（hue 38）+ Bricolage 字体，与主应用（玫瑰 hue18 + Inter）完全脱节；暗色工作台反转白瓷 |
| 5 | Error Prevention | 4 | 素材授权门、费用前置确认勾选、无价不发 |
| 6 | Recognition Rather Than Recall | 3 | 当前值 vs AI 草稿并排；但模块清单要求记住每个禁用模块缺什么 |
| 7 | Flexibility and Efficiency | 3 | 场景 chips、⌘K、做同款；但多闸门 Brief 流程慢、无键盘直发 |
| 8 | Aesthetic and Minimalist Design | 3 | 核心 chrome 优雅；内容卡、详情面板、7 项模块清单偏密 |
| 9 | Error Recovery | 3 | 恢复文案诚实；硬失败态未能实测到 |
| 10 | Help and Documentation | 3 | 全程内联解释；但 并发 等词无解释 |
| **Total** | | **30/40** | **Good — 基础扎实，对比度/一致性欠账可清** |

# Anti-Patterns Verdict

**LLM 评估（A 路）**：核心不是 slop。侧栏玻璃实测 blur(64px)+glass-80+1px 白描边+24px 圆角，与 DESIGN.md 壳级玻璃逐像素吻合；玫瑰金全屏仅 2 处（远低于 5% 预算）；问候语压暗氛围实测 ~9-12:1。失败模式是"不一致的口袋"：/pricing 是 mkfast 模板遗留皮肤，付款时刻看起来像另一个产品。

**确定性扫描（B 路）**：CLI 16 条（exit 2）——15 条 advisory 字号脱谱（产品组件里 9/10/11px 低于 DESIGN.md 谱系下限 12px，如 composer-image-input.tsx:446=11px、creation-shelf.tsx:527=10px、model-card-picker.tsx:116=9px），1 条 broken-image 为测试文件误报。浏览器注入 7 页：nested-cards 高发（dashboard×13、settings×11、content×3——DESIGN.md 明文禁嵌套卡，A 路只在登录页轻微注意到，检测器抓到了 LLM 漏的面）；low-contrast「1.0:1 白对白」×6 是背景不可解析的签名，恰好与 A 路"内容卡白字压浅渐变"P1 互证；text-overflow h2/237px+p/577px 五页字节级相同=同一共享组件，一处检查即可；skipped-heading h1→h3（content 页）为真实 a11y 小项。

**误报裁定**：inter 单家族（overused/single-font）= DESIGN.md 明文"绝不引入第二家族"，按设计意图豁免——但 /pricing 的 single-font=Bricolage Grotesque 反向实锤了脱品牌；layout-transition width = 侧栏折叠动画，属常规；flat-type-hierarchy 1.3 比在 product register（1.125-1.2 典型）内可接受；broken-image 在 .test.tsx 里，误报。

**覆盖层**：注入成功且检测器在页内真实运行（7 页控制台证据齐全）；覆盖层服务已按规停掉，徽标不会在刷新后保留。

# Overall Impression

工作台首屏（问候+氛围+Composer+玻璃侧栏）已经是一个能让人信任的、有身份的产品；诚实纪律（无价不发、授权门、因果免责）是真实差异化。但商家掏钱的那一页（/pricing）还穿着模板的橙色旧衣，二级页（门店/素材页头、内容卡）有实测的对比度硬伤。最大机会：把首屏的材质纪律推平到每一个次级面。

# What's Working

1. **材质系统是真的，不是化妆。** 侧栏/胶囊玻璃三要素全齐且量化达标，玻璃只在浮层、内容区白瓷——这是 AI slop 的结构性反面。
2. **诚实架构成为设计模式。** 费用前置（「消耗 1 条文案额度（可用 0/30）」）、拒绝伪造核验（「人工记录不会被标成已验证」）、因果免责（「不代表由该内容导致」）、Brief 非破坏性+版本回滚——对"AI 会不会乱花钱/乱发东西"的焦虑客群正中要害。
3. **问候+氛围的执行。** Display-200 白字压暗化氛围，实测 9-12:1，情绪峰值与遮罩托字法则同时成立。

# Priority Issues

- **[P1] /pricing 整页脱品牌 + 推荐档 CTA「不可用」。** A 路测得强调色 oklch(0.553 0.195 38.4)（模板橙），B 路测得整页唯一字体是 Bricolage Grotesque（模板字体，主应用是 Inter）——双路独立证实这是 mkfast 模板遗留皮肤。最高信任权重的付费页看起来像另一个产品，且推荐 Growth 档 CTA 是死结「不可用」（注：当前栈 Stripe 为假 key，「不可用」可能是环境诚实态，需在配了支付的环境复核；但脱品牌皮肤与真实无关，成立）。另有配额卡+价格卡两排冗余。**Fix**：/pricing 重新蒙皮到品牌 token（墨丸 CTA、白瓷卡、玫瑰金只做订阅火花、Inter 栈），「不可用」换成真实状态+原因。**Command**: /impeccable polish（scoped /pricing）
- **[P1] 门店/素材页头对比度硬失败。** ink-60 深字直压暗色氛围区，实测 ~1.1-1.9:1，无遮罩——违反 PRODUCT.md 的 WCAG AA 硬要求与遮罩托字法则。（RW3 只修了工作台氛围区文字，内页页头是残留面。）**Fix**：页头垫白瓷面板/遮罩，或改用问候语式白字+压暗方案。**Command**: /impeccable polish
- **[P1] 内容库卡片：白字压浅渐变 + 同构卡网格。** A 路目测白 18px 标题压浅灰渐变占位不可读；B 路 white-on-white 不可解析背景签名×6 + clipped-overflow-container×6 同页互证；三张同构卡重复触发禁令。**Fix**：标题垫 mask-scrim 或实底题带；真实缩略图/可读的深字浅底空态；卡片差异化。**Command**: /impeccable polish
- **[P2] Composer「本次内容套组」= 槽位表单回潮（D-031）。** 7 项带编号清单、6 项禁用且重复解释「当前起步卡或作品未包含此模块」，嵌在"唯一主轴"里；加上 13 枚改稿 chips，是全站认知负载最差的两个决策点。**Fix**：折叠/隐藏不可用模块，改为对话流 chips/单问确认卡，去编号脚手架。**Command**: /impeccable distill
- **[P2] 误导性持续状态。** 「结果与接受 / 正在为你起草文案…」在生成实际阻塞于素材授权+Brief 确认时不变，制造「它是不是正在花我的钱」焦虑。**Fix**：反映真状态（「等待你确认素材后开始」/「待确认 Brief」），起草文案只留给真流式。**Command**: /impeccable clarify

# Persona Red Flags

- **Alex（急性子熟手）**：到达任何产出要过多重闸门（采纳 4 个 Brief 字段→采用并确认→选授权素材→确认门店档案→生成）；无 Enter 直发；提交钮叫「建立创作记录」不叫"生成"。首稿前流失。
- **Sam（键盘/无障碍）**：Composer 文本域和 ghost 按钮 outline-style:none（主输入的焦点环反而最弱，导航却是正确的 2px 墨环）；门店/素材页头 ~1.5:1；内容卡白字压浅渐变。AA 硬要求恰好在 Sam 依赖的位置失守。
- **美业店主（非技术、怕术语）**：pricing 页「并发任务」读不懂；「统一输入台」「结果与接受」「建立创作记录」抽象；素材表单「授权/制度依据编号」「专业边界」像法务文书；「Before / After」英文卡；「可用 0/30」无白话解释。橙色 pricing 读作"另一个 app"。

# Minor Observations

- 暗色工作台把白瓷 Composer 反转成炭色——DESIGN.md 只给 Pro Studio 留深色；读作模板暗色继承而非橱窗定制（待用户拍板意图）。
- 问候语是泛化「嗨，店主」，已知商家名（林晓）未用——拟人化问候意图未兑现。
- 移动端底部导航镜像桌面四目的地+FAB（移动原则说不镜像）；移动页副标题被卡片盖住裁切。
- 小开关 blur(8px)+暗玻璃但 0px 描边——玻璃有边法则轻微偏差。
- 版本历史「AI 生成」徽标是中性灰，不是玫瑰火花——错过一个正当的品牌 AI 时刻。
- 登录页白卡套细边外卡（轻嵌套）；settings nested-cards×11、dashboard×13（检测器）——DESIGN.md 明文禁嵌套卡，需逐处裁定。
- content 页标题层级 h1→h3 跳级（a11y）。
- 产品组件里 9-11px 字面字号低于谱系下限（detect CLI 15 处，file:line 见 B 路存档）。
- mkfast-template-main/docs/DESIGN.md 是过期模板设计文档（暗色极简+Bricolage），会误导工具链（context 解析即命中它）与后来者——建议删除或替换为根 DESIGN.md 指针。
- 五页字节级相同的 text-overflow（h2/237px、p/577px）指向一个共享页头组件，查一处即可全清。

# Questions to Consider

1. 问候语赢得了情绪开场，但 /pricing 是橙色的另一个产品——商家决定付钱的那一刻记住的是哪一个？为什么最信任攸关的一页穿着模板剩下的皮？
2. Composer 是「唯一主轴」——但在续作品上它变成 7 项编号、多数禁用的清单。它还是 Composer 吗，还是 D-031 禁掉的槽位表单从侧门回来了？
3. 诚实纪律是护城河——但它埋在密集的二级面板里。如果焦虑的商家从没滚到「不代表由该内容导致」，诚实是安抚了谁，还是只满足了合规？
