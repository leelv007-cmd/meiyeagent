# V31-87 — 同内容图片跨面重传恒 409 IDEMPOTENCY_CONFLICT：composer 内联上传永久失败循环

**Parent**: V31-84 收口走查新发现
**批次**: 清红队列（P1，素材链）
**Blocked by**: 无
**Related**: V31-84、V31-88（挂源缺口——正是它逼商家重传同图）

**Status**: open（2026-08-13）— 主控活体取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（重试按钮循环复现，响应体在案）
**Evidence SHA**: b991400001bebbb978c25609549b167f61dc5ad7
Evidence 注：journey-dogfood-0813 号；素材页已传 case.png（asset-0a411f19），composer 内联再传同字节文件
**Workflow Run**:
**Artifact Digest**:

## 症状链

1. 商家在素材页上传并授权了一张图；composer 配方槽不认（见 V31-88），引导「先传一张」。
2. 商家在 composer 内联重传**同一张图**：`/api/storage/upload` 200（同内容 hash 同 key），
   随后 `/api/core/product/commands` 409 `IDEMPOTENCY_CONFLICT`
   （register 命令幂等键derive自内容 hash，而本次 payload 带 customer_case 类别＋权利
   详情，与素材页首次注册的 payload 不同 ⇒ 键同 payload 异被拒）。
3. UI 只说「图片上传失败，请重试」，重试永远同败——商家无路可走，也不知道原因。

## Acceptance criteria

- [ ] 同内容重传的语义拍板：幂等键纳入 payload 变体，或识别既有资产直接复用/更新元数据
- [ ] 失败文案不再泛化「请重试」——可重试与不可重试错误分开呈现
- [ ] 先红后绿：跨面同图重传场景 e2e/集成测试
