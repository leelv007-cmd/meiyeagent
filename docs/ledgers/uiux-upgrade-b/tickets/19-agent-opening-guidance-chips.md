# 票 19 · Agent 开场：拟人化问候 + 今日建议 chips + 场景 chips 点选即预填
> 阶段: Phase 4 · 开场与骨架 ｜ 差距: P1-5 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "19",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-5"
  ],
  "contractIds": [
    "I02",
    "I05"
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

- P1-5 已核实：主入口没有 Agent 拟人化问候、今日建议 chips 与场景 chips；用户第一眼仍面对一个空输入框，需自行组织 prompt。
- 目标体验：开场先由 Agent 递出 2-3 条可行动的今日建议；中央意图框旁常显「引流 / 种草 / 促销 / 复购」场景 chips，并以「全部场景 ▾」渐进展开其余现有场景。点选建议或场景后，立即得到可继续编辑的完整意图，再由用户显式建立创作记录。
- 对标锚点：KickArt 的中央意图框、场景 chips 与灵感入口；本票迁移“Agent 主动递建议 + 点选降低表达门槛”的范式，不复制通用聊天界面。
- 决策边界：维持 D3「对话式外壳、结构化内核」；chip 只预填既有结构化创建流，不新增消息历史或独立 chat clone。D4 仍为 3 选 1 单选；L-1 贴链接抓取继续 de-scope；图片/视频模型不得增加跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:206-223`：工作台本体及 `intent`、`mode`、onboarding 等本地状态；本票可在此增加轻量的建议/场景选择状态，无需另造状态层。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:225-285`：页面已读取 inbox tasks、产品 assets，并汇总为 `sourceOptions`；今日建议应优先复用这些真实运营信号，避免新开后端接口或伪造个性化。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:491-501`：首屏仍是静态标题「把一句想法变成可恢复的内容对象」及工程化说明，没有 Agent 主动问候。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:531-581`：onboarding 卡为「一句话开工」+ Textarea；`543-571` 的 chips 仅是有历史数据时出现的来源复用，不是今日建议或业务场景。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:582-637`：输入框下只有本机文件、无效链接占位和 agent/direct 切换；本票不得把链接按钮接成 URL 抓取。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:646-674`：只有点击「建立创作记录」才创建 Work；建议/场景点击沿用此显式确认边界，不静默提交。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:819-826`：「内容场景」仍是建 Work 后的原生 select（项目种草/口碑晒单/同城到店），既不在首屏，也不会点选预填。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts:71-77`：现有创作闭环从填写意图到建立 Work 的浏览器验收入口，可扩展为 chip 预填后的真实用户路径。
- 行号复核结论：差距报告引用的 `496/573-637/820-826` 截至本票撰写时均未漂移；以上范围按当前文件补充了上下文。

## 改造方案（步骤级 + 涉及文件清单）

1. 在 onboarding 首屏把静态工程标题改成自然、克制的 Agent 问候，并保留中央意图框为唯一输入核心；不增加独立聊天栏、消息气泡或第二套提交路径。
2. 基于页面已加载的 `inboxQuery` 与 `productQuery` 派生最多 3 条今日建议：优先把当前任务标题、可用素材标签组织成可编辑意图；数据不足时显示明确的常用建议，不伪装成实时经营洞察。去重并限制长度，避免首屏被长任务标题撑开。
3. 为今日建议建立统一的 `label + intent` 视图模型。用户点选后写入现有 `intent`、聚焦 Textarea、显示清晰选中态；用户仍可修改文本，并通过原「建立创作记录」按钮确认。
4. 在意图框邻近位置增加横向可滚动的主场景 chips：「引流 / 种草 / 促销 / 复购」+「全部场景 ▾」。展开区只复用当前已有场景词（项目种草/口碑晒单/同城到店），不在本票扩张场景 taxonomy。
5. 场景 chip 使用同一预填函数生成完整、可编辑的美业内容意图；再次选择其他 chip 时明确替换当前预填并同步选中态。手工编辑后文本即为最终事实，创建 Work 时仍只提交用户眼前确认过的 `intent`。
6. 保留键盘可达、焦点可见与移动端横滑；紧凑屏不把 chips 挤成难点的小触区，也不遮挡现有 CTA。
7. 扩展既有创作闭环浏览器用例，覆盖「建议预填 → 可编辑 → 显式建立 Work」与「场景预填 → 切换 → 最终文本进入创作记录」两条用户旅程；验收仍以页面可见结果为准。

涉及文件：

- `mkfast-template-main/src/product/unified-creation-workbench.tsx`：问候、建议派生、场景目录、chip 交互与现有 intent/创建流接线。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`：扩展现有真实浏览器创作闭环。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 新用户或点击「新建创作」进入开场时，首屏可见自然的 Agent 问候、2-3 条今日建议、中央意图框和场景 chips；不再只出现静态标题 + 空 Textarea。
- 有任务或素材时，用户看到的今日建议能辨认出对应任务标题或素材标签；没有可用数据时，界面明确呈现为常用建议，不声称已分析不存在的经营数据。
- 用户点任一今日建议后，意图框立即出现一条可直接开工的完整文案，焦点回到输入框，所选 chip 有清晰高亮；用户能继续增删文字。
- 用户无需展开技术表单即可点选「引流 / 种草 / 促销 / 复购」；点选后意图框立即预填对应业务目标，切换场景时高亮与文本同步更新。
- 用户点「全部场景 ▾」可看到项目种草、口碑晒单、同城到店；再次收起不清空已填写内容。移动端可横向滑动主场景且每个入口均可稳定点按。
- chip 点击不会自动创建 Work；用户修改预填内容并点击「建立创作记录」后，创作记录展示的正是提交前最后可见文本，原 agent/direct 选择仍生效。
- 开场保持单一工作台：用户不会看到新增的独立聊天窗口、第二个输入框或与结构化创作流竞争的提交入口。
- 截图对照：以相同桌面视口并列「当前产品开场」与「KickArt 对标开场」，图中可直接标出问候、今日建议、意图框、场景 chips 四层；当前产品四层均可见且信息层级、可点击状态不弱于对标。另补一张移动端当前产品截图，证明 chips 可横滑且 CTA 未被挤出首屏关键区域。

## Blocked-by / Blocks

- Blocked-by：无实现前置；但遵守全局规则，票 02 完成前本票不得关票。
- Blocks：MAP 未登记下游阻断票。
- 边界协同：票 22 负责统一输入台三喂料与清理链接死占位；本票不恢复贴链接抓取，也不以票 22 未完成为由扩张范围。

## 风险与回退

- 风险：把静态兜底包装成“今日洞察”会制造虚假智能。控制：仅真实任务/素材可带来源语义；无数据时明确叫常用建议。
- 风险：chip 切换覆盖用户手写文本。控制：预填替换必须由用户主动点击触发，替换结果立即完整展示且可编辑；不得后台静默改写。
- 风险：建议、来源 chips、场景 chips 同屏造成新的 chip 墙。控制：今日建议最多 3 条，主场景固定 4 条，其余渐进展开；来源复用保持独立语义分组。
- 风险：与票 12 的 Composer 渐进展开、票 22 的输入能力发生越界。控制：本票只改开场引导和 intent 预填，不改模型、执行合同、上传或链接能力。
- 回退：若建议质量或首屏密度不达标，可单独关闭今日建议区并恢复原静态开场；保留场景预填、Textarea、显式建 Work 与现有结构化创建链，数据合同无需回滚。
