# V31-84 — P0 链式死锁：五步录入「说一句」提取空＋「逐条点头」确认按钮零请求 ⇒ 档案→素材→配方全链锁死

**Parent**: 能力基线盘点第二轮（`docs/reviews/capability-baseline-audit-r2-2026-08-13.md` §0.2）
**批次**: 清红队列（P0，Day-0 主链）
**Blocked by**: 无
**Related**: V31-73（下游引导卡——引导去传素材，但素材门被本票挡）、V31-85（配方 slot 死路）、D-139~149（五步录入决策）

**Status**: open（2026-08-13）— 盘点取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（单一真相栈两轮；fetch 钩子取证确认按钮零网络请求）
**Evidence SHA**: 1baf207461e57fd4fafbdce250a4582ddef03bcb
Evidence 注：二号账号取证；「我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元」提取产出五字段全空
**Workflow Run**:
**Artifact Digest**:

## 两处断点

1. **提取空转**：第 3 步「说一句」的句子（含名称/城市/项目/价格）到第 5 步草稿五字段全空。
   先定性：fixture 档 canned 提取缺失 vs 提取链根本未接（live 档同断）——修对应侧。
2. **确认死按钮**：第 5 步手填「门店名称」后确认按钮激活、点击 ✓、**零网络请求**
   （window.fetch 钩子只见 pending-actions/harness/tasks 轮询）、无任何反馈、事实不落库。

## 商家侧后果链（全链实测）

档案永远无法确认 →「门店信息」恒空、dashboard 恒提示「还差门店名称」→ 素材上传恒被
「请先确认门店档案」挡 → 案例图永缺 → 图文/视频配方永不可达（V31-73 的引导卡把商家
引向一扇死门）。

## Acceptance criteria

- [ ] 两断点各自定性＋修复（先红后绿）
- [ ] 端到端：说一句→草稿含名称→逐条确认→「门店信息」出现已确认事实→素材上传成功→图文配方可提交（e2e）
- [ ] 确认按钮失败路径有可见反馈（不再静默）
