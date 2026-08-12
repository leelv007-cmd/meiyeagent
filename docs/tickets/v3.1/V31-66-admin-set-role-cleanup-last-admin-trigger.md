# V31-66 — admin-set-role.postgres.test.ts 的 cleanup 在干净库触发 last-admin 守卫（测试隔离缺陷）

**Parent**: opt-in 证据刷新轮（2026-08-12）发现
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-64（同轮仪器整备）
**Status**: open（2026-08-12）— reproduced twice on fresh databases; fix not started

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 9ac46064342e7621808153307bf4e2c12e887e37
**Workflow Run**:
**Artifact Digest**:

## 症状与根因（两个独立全新库复现）

`mkfast-template-main/src/auth/admin-set-role.postgres.test.ts` 正文断言全过，死在 :335 的 `finally`：先把 parked admins 恢复为 `admin` 再删自建三用户——当库里唯一的平台 admin 就是这三个时，`prevent_last_platform_admin()` 触发 `LAST_ADMIN_REQUIRED`（SQLSTATE 23514）删除失败。**套件静默依赖环境行（库里恰好有别的 admin 才绿）**，此前一直被脏库掩盖。

## 修法边界

改测试的 cleanup 顺序（按触发器允许的次序 demote/delete，或先建 sentinel admin）；**不得**弱化 `prevent_last_platform_admin()` 产品守卫。修复后在全新库跑绿并更新 `docs/ops/opt-in-test-evidence.json`（现记 `known_red`，ticket=本票）。
