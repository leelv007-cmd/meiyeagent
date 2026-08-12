# V31-68 — admin 页运维健康挂件对 job-runtime/observability 恒 403，打破 admin 旅程零 console 错误合同

**Parent**: V31-65 验收跑（2026-08-12）暴露
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-65（其 spec 的最终断言被本票挡住）、V31-13（观测票）
**Status**: open（2026-08-12）— pinned with request/response evidence; fix not started

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 9ac46064342e7621808153307bf4e2c12e887e37
**Workflow Run**:
**Artifact Digest**:

## 症状（本地插桩取证，两次 403 逐字）

`/admin/sensitive-words` 首载时（platform admin 会话），`src/p1/admin-operations-health.tsx:360` 的运维健康挂件经 BFF 代理 `POST /api/core/p1/query` 发 `{"module":"job-runtime","action":"observability","payload":{}}`，Core 回 403：`FORBIDDEN — Job runtime operations require an allowlisted worker or admin actor.`（初跑＋重试各一次，之后页面其余功能全部正常）。任何挂着该挂件的 admin 页都会在 console 落两条错误，`expect(browserErrors).toEqual([])` 类合同全部无法通过。

## 定性

浏览器 admin 会话（web 侧 role=admin）经 BFF 代理到 Core 后，**没有被 Core 认作 job-runtime 的 admin actor**（Core 的判定是 allowlisted worker / admin actor，与 web 平台角色是两套身份）。要么代理层把平台 admin 身份正确投影成 Core admin actor，要么该挂件不该在缺授权时反复打这条查询（fail-soft 且不落 console error）。修哪一侧先查 job-runtime 模块对 admin actor 的既有判定（`apps/core` 内 `Job runtime operations require` 报错点）与 BFF actor 投影约定，别拍脑袋放宽 Core 门。

## 验收

- [ ] `/admin/sensitive-words` 首载 console 零 error（V31-65 spec 最终断言过）
- [ ] job-runtime 观测数据对 admin 会话要么真实可见、要么明确降级（不重试打 403）
