# V31-80 — 展示层二波：内部指令/裸 ID 直出、方案卡执行后不冻结、双叙述与用量双行复发

**Parent**: 能力基线盘点第一轮（`docs/reviews/capability-baseline-audit-2026-08-13.md` §3）
**批次**: 清红队列后、C3/C4 能力收敛 lane 内消化
**Blocked by**: 无（与 V31-78/79 并行）
**Related**: V31-75（第一波，含单点映射与清场纪律）、V31-74（用量行互斥收敛）、§39 六态

**Status**: open（2026-08-13）— 盘点取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（盘点四号，fixture 档）
**Evidence SHA**: 0487afd99e724d6ca9ac3e0fccdecf3a32126ca0
Evidence 注：走查代码树；work-3095236e（copy 单）与 work-cd980cd4（图文单）为取证对象
**Workflow Run**:
**Artifact Digest**:

## 清单（症状 → 初步锚点）

1. **时间线「结果」行直出内部指令**：「…只使用冻结事实与授权素材，不得编造价格、日期、效果或
   顾客案例，不得偏离 ExecutionPlanSnapshot。」渲染给商家。疑=结果叙述取自 brief/执行指令
   拼接（fixture 档 echo 放大可见性，但拼接源在产品侧，live 档同样会带出脏前缀——修产品侧
   的叙述来源选择，不是修 fixture）。
2. **成品标题=同一段内部指令拼接**（工作区标题 textbox、平台预览同染）。
3. **右栏上下文裸串 `work-<uuid>`** 给商家看。
4. **方案卡执行后不冻结**：r1 已「开始制作」并交付，卡上仍是活跃的「返回修改／开始制作」
   （§39 六态「已经确认／已经执行」未投影；V31-75 只修了失败态）。
5. **多 Work 双叙述复发**：同 thread 第二单提交时，prompt 叙述气泡双条（V31-75 第 3 项修的
   是单 Work 场景，多 Work 复发）。
6. **用量双行并存**：确认卡路径「本次约消耗 20 分 失败将退回积分」与「本次用量已确认」
   同屏（V31-74 `resolveComposerQuoteUsageLine` 的互斥在该路径未生效或被旁路）。
7. **事实计数矛盾**：方案卡「已绑定 2 项事实用法」vs 工作区「暂无关联事实」（零事实账号）；
   先定性 2 从哪来（fixture 语义 or 产品侧计数），再修显示。

## 边界

- 不动生成/计费行为；第 6 项只修渲染互斥，不动 V31-74 决策函数语义。
- 第 1/2 项若定性为「fixture 结构化输出把指令 echo 进 title」，则修法=产品侧叙述/标题
  来源字段选择＋fixture 保真度修正各一半，票下写清分界。

## Acceptance criteria

- [ ] 七项逐项修复或定性豁免（写明理由），每项一条测试背书（先红后绿）
- [ ] 时间线/工作区/右栏无内部术语与裸 ID（静态扫描断言可加进 V31-75 已建的映射单测旁）
- [ ] 方案卡在 delivered/failed/executing 三态下的按钮矩阵有 interaction 测试
- [ ] 多 Work 场景叙述唯一性有 e2e 或 interaction 断言

## 留痕

- 开票：2026-08-13 盘点第一轮（C3/C4/C16 走查）。V31-75 关票时的 dev 复核跑在假 Core 上
  （见 V31-79），单 Work 场景结论仍有效；本票是多 Work/确认卡路径的补洞，不推翻前票。
