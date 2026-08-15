# V31-68 — admin 页运维健康挂件对 job-runtime/observability 恒 403，打破 admin 旅程零 console 错误合同

**Parent**: V31-65 验收跑（2026-08-12）暴露
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-65（其 spec 的最终断言被本票挡住）、V31-13（观测票）
**Status**: done（2026-08-12）— 修复、本地行为验证与同 SHA CI 绿证均已归档

**Implementation state**: done
**Verification state**: verified — local contracts + browser + CI browser
**Evidence SHA**: 6ae81da0bb1b8a14c8ce78e8b68fb326301dadc1
**Workflow Run**: 31589105737 / p2-browser-acceptance job 94089694036（job failure；`admin-sensitive-words` 1/1 passed，含 console 纯净合同）
**Artifact Digest**: `p2-browser-acceptance-evidence` / artifact 9139007817 / `sha256:8333bd8037f7df073d0f228833063474f6d6df5275a518f29cd01d81f2b0b367`

## 症状（本地插桩取证，两次 403 逐字）

`/admin/sensitive-words` 首载时（platform admin 会话），`src/p1/admin-operations-health.tsx:360` 的运维健康挂件经 BFF 代理 `POST /api/core/p1/query` 发 `{"module":"job-runtime","action":"observability","payload":{}}`，Core 回 403：`FORBIDDEN — Job runtime operations require an allowlisted worker or admin actor.`（初跑＋重试各一次，之后页面其余功能全部正常）。任何挂着该挂件的 admin 页都会在 console 落两条错误，`expect(browserErrors).toEqual([])` 类合同全部无法通过。

## 定性

浏览器 admin 会话（web 侧 role=admin）经 BFF 代理到 Core 后，**没有被 Core 认作 job-runtime 的 admin actor**（Core 的判定是 allowlisted worker / admin actor，与 web 平台角色是两套身份）。要么代理层把平台 admin 身份正确投影成 Core admin actor，要么该挂件不该在缺授权时反复打这条查询（fail-soft 且不落 console error）。修哪一侧先查 job-runtime 模块对 admin actor 的既有判定（`apps/core` 内 `Job runtime operations require` 报错点）与 BFF actor 投影约定，别拍脑袋放宽 Core 门。

## 验收

- [x] `/admin/sensitive-words` 首载 console 零 error（V31-65 spec 最终断言过）
- [x] job-runtime 观测数据对 admin 会话要么真实可见、要么明确降级（不重试打 403）

## 2026-08-12 施工与验收记录（主控）

lane 交付 `6ae81da0`（BFF 精确映射方案）。**票面定位更正**：不是单一挂件——`job-runtime/observability` 有三个观察者共用 query key（admin-operations-health @/admin/audit、admin-capability-registry 经 admin shell header **每个 admin 页都发**、admin-operations-panels @/admin 首页），shell header 才是 sensitive-words 页上的真实发起点。**Core 门一行未动**（顺带查明不对称：job-runtime 是唯一 `actor==='admin' AND allowlist` 语义的模块，其余 admin 模块是 OR 放行）；代理层仅在「p1/query + job-runtime + observability + 上游 403 FORBIDDEN」四条件全中时翻译为 200 降级载荷，反例矩阵（他模块 403/他 action/commands 路由/INSUFFICIENT_ENTITLEMENT）逐字透传钉死。前端三观察者统一 4xx 不重试；降级卡 `admin-operations-health-unauthorized`；capability registry 把降级读作 `operational_metrics_unauthorized` 而非 loading。
主控亲验：proxy route 17/17＋registry 20/20＋interaction 3/3；**e2e=admin-sensitive-words 整案 1 passed（44.8s，零 console 错误）**。已知取舍：降级后该 surface 不再触发 `permission_denied` 遥测（200 响应），运营侧如需埋点信号另开票。

## 2026-08-12 CI provenance 收口

run 31589105737 的 p2 artifact 记录 `admin-sensitive-words` **1/1 passed**，从真实 admin shell 消费本票降级路径，并通过最终 console 零错误断言。p2 job 的后续失败不来自本票；artifact 日志与 `--list` 顺序提供逐 spec 证据。Artifact REST digest 与下载包复算一致；Attestations REST 无记录，因此只声明 artifact digest。
