# V31-84 — P0 链式死锁：五步录入「说一句」提取空＋「逐条点头」确认按钮零请求 ⇒ 档案→素材→配方全链锁死

**Parent**: 能力基线盘点第二轮（`docs/reviews/capability-baseline-audit-r2-2026-08-13.md` §0.2）
**批次**: 清红队列（P0，Day-0 主链）
**Blocked by**: 无
**Related**: V31-73（下游引导卡——引导去传素材，但素材门被本票挡）、V31-85（配方 slot 死路）、D-139~149（五步录入决策）

**Status**: implementation-complete（2026-08-13）— grok lane 交付＋主控收口；两断点修复已活体走查证毕（全确认路径）；跳过兜底路径的合同矛盾拆出 V31-86

**Implementation state**: implemented
**Verification state**: live-verified（主控活体走查：提取回填 4 字段→逐条点头→finalize 200→7 事实落库→档案+门店信息投影渲染→素材上传过档案门→素材页授权成功；配方提交段被 V31-85/挂源缺口挡，见 residual）
**Evidence SHA**: b991400001bebbb978c25609549b167f61dc5ad7
Evidence 注：lane-84 合入 commit；主控追加提取守卫＋spec 全确认修正在后续 commit；走查号=journey-dogfood-0813@example.test
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

- [x] 两断点各自定性＋修复（先红后绿）
- [x] 端到端：说一句→草稿含名称→逐条确认→「门店信息」出现已确认事实→素材上传成功（活体走查证毕；图文配方提交段被挂源缺口挡，拆 V31-85/V31-88，e2e spec 已落盘 --list 可解析）
- [x] 确认按钮失败路径有可见反馈（throw STORE_INTAKE_NOT_READY + toast）

## 收口定性（2026-08-13 主控）

- **断点 1**（提取空转）定性=「没发」：句子从未出浏览器。修复=前端保守正则提取
  （name/city/projectName/projectPrice 四字段，provenance=ai_suggestion，第 5 步仍须点头）
  ＋前进导航自动整理＋「让我整理一下」按钮。**方案取舍**：这是本地兜底，未接
  `p1_store_workflow_capture_*` 提取链——capture 域接入留作后续产品决策。
  主控追加守卫：价格词（日常价/现价/活动价/单价/价格）不再被误捕为项目名（先红后绿）。
- **断点 2**（确认死按钮）定性=finalize request 构造失败时静默 return。修复=throw+toast。
  **更深一层**（活体 409 揭示）：向导 Day-0 首次 finalize 的 profilePatch 携带未确认字段的
  兜底文案（district=本区 等），与 Core `assertStoreFactMappings`「patch 字段必须有确认」
  （07-27 W01 审计加固）正面冲突 ⇒ 跳过兜底路径合同上不可达，拆出 **V31-86** 待设计拍板。
  全确认路径（含 district/address/booking 手填点头）活体证毕：finalize 200、7 事实落库。
- **e2e spec 主控修正**：confirm 循环补齐三个履约字段（原 spec 钉部分确认路径，会 409 假红）。

## Residual

- grok 的 e2e spec 用 `seedComposerInlineAuthorize` 挂案例图（R1 对 day-0 类 spec 的禁令
  边界待裁决）；全栈跑归 V31-77 旅程门轮。
- 「finalize not-ready 可见反馈」路径无测试钉住（变异验证：改回静默 return 测试仍绿）。
- 走查新发现三缺口另票：V31-86（合同矛盾）、V31-87（同内容跨面重传幂等 409 砖）、
  V31-88（素材库已授权资产无 composer 挂源入口）。
