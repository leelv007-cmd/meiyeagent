# V31-86 — Day-0「跳过用兜底」与 Core 双门合同矛盾：部分确认 finalize 必 409

**Parent**: V31-84 收口定性（`docs/tickets/v3.1/V31-84-store-onboarding-capture-confirm-broken.md` 收口段）
**批次**: 清红队列（P1，Day-0 主链半径）
**Blocked by**: 无（设计已拍板，见「拍板结果」）
**Related**: V31-84（全确认路径已通）、W01 审计加固 0b8afd61（门 2 出生 commit）

**Status**: implementation-complete（2026-08-13）— 二轮拍板（LLM 化流畅路径）已落地并活体走查证毕；Phase 2（LLM 提取接线）判不可接，另立 V31-89

**Implementation state**: implemented（Phase 1 全量；Phase 2=可行性报告 `docs/reviews/v31-86-phase2-llm-arrange-feasibility-2026-08-13.md`）
**Verification state**: live-verified（全新 Day-0 号：说一句→档案卡四项 AI 推测＋三项平台兜底全预填带来源徽章→**单击保存 200**→facts 只收 4 条真值、profile 带三兜底、回执 fieldProvenance 八字段齐→素材过门→挂源→提交 202。变异双证：去 revision-0 界红、去常量逐字界红、去第 5 步预填红）
**Evidence SHA**: 97f534d0c76a4c2b6f92222f70e831e21fb4dbfb
Evidence 注：走查号 journey-v3186-185351@example.test（ws_wBFDHprmCTdLlwkYdBjMeCaiTeQ4Z70t）；旧路径 409 取证见 V31-84 票
**Workflow Run**:
**Artifact Digest**:

## 矛盾定性（三方合同互斥）

1. **门 1** `apps/core/src/product/product-service.ts` `createStoreProfileFromPatch`：
   首个 profile patch 必须携带 name/city/district/address/booking/brandVoice/regulated，
   缺一 409 STORE_PROFILE_INCOMPLETE。
2. **门 2** `apps/core/src/p1/operations/store-intake-finalizer.ts` `assertStoreFactMappings`
   （2026-07-27 W01 审计加固引入）：patch 中每个 PROFILE_FACT_MAPPINGS 字段
   （name/city/district/industry/address/booking）都必须有对应 confirmation，否则 409
   STORE_FACT_MAPPING_INVALID。
3. **前端承诺** `progressive-fact.ts` `buildFinalizeStoreIntakeCommand`：Day-0 首次
   finalize 为满足门 1，把未确认字段填兜底文案（本区/门店地址待补充/到店咨询预约）
   进 patch——正撞门 2。UI 明文承诺「没确认的部分我会用兜底写法先顶上」。

⇒ 商家在五步录入/Day-0 对话流里跳过 district/address/booking 中任何一个，首次保存
必 409。该路径自 07-27 起死亡且零测试覆盖（现有绿测全走全确认）。

## 拍板结果（2026-08-13 用户，两轮，第二轮为准）

> 第一轮（A+B 混合：缺失项弹窗＋双出口＋60s 倒计时默认补全）**同日被用户推翻**——
> 那仍是审批墙。第二轮定案：**整条路径智能化流畅化，LLM 多介入简单判断与推荐，
> 不让商家反复确认**（与 D-117/D-122 HITL 总纲一致：介入位=修正点非审批墙，流程恒前进）。

1. **LLM 优先整理**：「说一句」走 LLM 提取与推荐（优先接 `p1_store_workflow_capture_*`
   capture 域/既有 harness 通道；fixture 档走 canned；V31-84 的正则作即时/离线兜底层，
   LLM 结果只填空与纠偏）。缺失字段由系统直接给推荐值，不问。
2. **第 5 步改「已整理档案卡」**：全字段预填、可直接点改，逐字段标注来源
   （商家说的 / AI 推测 / 平台兜底）；**单击「都对，保存」一次确认整卡**。
   取消逐条点头强制门、取消缺失项弹窗与倒计时。看见即知情，一击即确认。
3. **合同映射**：保存=一次批量确认动作。有真值的字段照旧生成 candidates+confirmations
   （facts 只收真值）；兜底字段进 patch **不进 facts**；门 2 有界放宽——仅
   initializing patch、仅 district/address/booking、且值逐字等于平台兜底常量方可免
   confirmation，任意其他未确认值仍 409（W01 底线：商家断言必有确认背书，免检的只有
   平台常量）。门 1 不动（patch 恒完整，无「按缺失继续」路径）。FALLBACKS 下沉
   `@meiye/contracts` 单源化。
4. **留痕**：批量确认回执记录逐字段 provenance（merchant_stated / ai_suggestion /
   platform_default）。
5. **原则条款（适用于后续同类票）**：Day-0 与同级简单判断默认 LLM 介入推荐；凡「逐条
   点头/多步确认表单」类交互一律按修正点重塑（素材授权多步表单等后续票同此原则）。

## Acceptance criteria

- [x] 设计拍板落盘（本节，二轮为准）
- [x] 门 2 有界放宽先红后绿；审计不变式测试：任意非常量未确认值仍 409（主控变异双证）
- [x] FALLBACKS 单源化（`packages/contracts/src/store-profile-defaults.ts`）
- [x] 档案卡批量确认 UX（interaction 13/13 改钉新 UX；w02/w12/price-validity/v31-84 四条既有 spec 同步改写）
- [x] 兜底字段不进 facts、真值字段进 facts＋confirmations（PG 23/23＋活体查库）
- [x] LLM 整理接入定性=**不可接**（capture 域是店内作业流程菜谱＋需 DBOS workflow/conversation）；报告落盘，接线另立 V31-89
- [x] e2e spec 落盘＋四条既有 spec 改写，--list 全可解析（全栈跑归 V31-77 旅程门轮）
- [x] 批量确认回执含逐字段 provenance（活体回执八字段在案）
