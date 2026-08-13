# V31-86 — Day-0「跳过用兜底」与 Core 双门合同矛盾：部分确认 finalize 必 409

**Parent**: V31-84 收口定性（`docs/tickets/v3.1/V31-84-store-onboarding-capture-confirm-broken.md` 收口段）
**批次**: 待设计拍板（P1，Day-0 主链半径）
**Blocked by**: 设计决策（见下）
**Related**: V31-84（全确认路径已通）、W01 审计加固 0b8afd61（门 2 出生 commit）

**Status**: open（2026-08-13）— 主控活体取证；两案待用户拍板，未派工

**Implementation state**: not-started
**Verification state**: reproduced（活体 409 STORE_FACT_MAPPING_INVALID，payload 全量在案）
**Evidence SHA**: b991400001bebbb978c25609549b167f61dc5ad7
Evidence 注：journey-dogfood-0813 号只点头 4 字段保存 ⇒ 409；补齐 district/address/booking 点头后同键重放 ⇒ 200
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

## 两案待拍板（建议 B）

- **A（门 2 开洞）**：initializing patch 上豁免兜底四字段的确认要求。改动小，
  但直接削 W01 审计加固（Day-0 窗口内未确认值可进 profile）。
- **B（兜底下沉 Core，建议）**：前端 patch 只携带已确认字段；门 1 放宽为「缺失的
  展示性字段由 Core 以平台常量兜底补全」。审计不削（进 profile 的商家断言仍全部
  有确认背书；兜底=平台常量，非商家声明）；兜底真相单源化。代价=FALLBACKS 常量
  下沉（contracts 共享或 Core 内常量）＋前端改 patch 构造。

## Acceptance criteria

- [ ] 用户拍板 A/B（或另案）并落盘决策
- [ ] 跳过路径先红后绿（e2e：只点头 4 字段保存成功；「门店信息」仅展示已确认事实）
- [ ] W01 审计不变式复核（未确认商家断言不得进 profile/facts）
