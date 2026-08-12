# V31-67 — issue-255-safe-provision 套件依赖仓外已删路径，默认又静默 skip（仪器缺陷）

**Parent**: opt-in 证据刷新轮（2026-08-12）发现
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-43（issue-255 live collector，另一套件勿混）
**Status**: open（2026-08-12）— suite depends on a deleted host path and silently skips by default; fix not started

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 9ac46064342e7621808153307bf4e2c12e887e37
**Workflow Run**:
**Artifact Digest**:

## 症状

`apps/core/src/p1/harness/issue-255-safe-provision.postgres.test.ts`：默认 3 case 全 skip（门控 `RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST==='1'`）；带 opt-in 则 3 case 全红——shell 到 `ISSUE_255_SAFE_PROVISIONER_PATH`（默认 `~/.codex/monitors/issue-255-safe-provision.mjs`），该 shim 读 digest 钉住的 `…/lane-255/scripts/ci/issue-255-safe-provision.mjs`，**路径已不存在**（子进程 ENOENT，非产品断言）。「不带 opt-in 恒静默绿、带 opt-in 恒环境红」，两头都不产真信号。

## 修法方向（二选一）

1. 把 provisioner 实现连同 digest pin 收编进本仓；
2. 依赖缺失时 fail closed（明确报仪器缺件）而非静默 skip。
修复后更新 `docs/ops/opt-in-test-evidence.json`（现记 `known_red`，ticket=本票）。
