# V31-62 — V31-15 AC2/3/4 定向浏览器绿证补齐（原位生长核心合同只有单测背书）

**Parent**: V31-15（artifact protocol，status done 但证据表 3/4 行空）
**批次**: 收尾
**Blocked by**: None — 浏览器验收 lane；与 V31-60/V31-61 无文件交集
**Status**: open（2026-08-11）

> 锚点署树 `main@0af4beb7`。

## What to build

V31-15 于 2026-08-08 合入并标 done，但其 Evidence 表只有 AC1（稳定 artifact id）拿到 Playwright 真绿（且 unit/eval 未在 tip 重取、按填表规则不得勾选）。§5.5「原位生长」的三条核心合同**没有任何浏览器旅程绿证**：

- **AC2**：SSE 乱序/重复/跳 revision/断线重连全过，delta 失败回退 snapshot；
- **AC3**：移动端 Artifact 全屏 Sheet 可用；
- **AC4**：版本回看可达、派生版本不覆盖已完成内容。

本票=按 V31-15「Evidence」节的填表规则（三结果列各守一轴、`—`/`n/a`/`未跑` 三态、四列非空且结果真实方可勾选）补齐 AC2/3/4 三行定向旅程证据，并在 tip 重取 AC1 的 unit/eval 数字。

## Acceptance criteria

- [ ] AC2 定向旅程：乱序/重复/跳 revision/断线重连四个扰动至少各一条正断言 + delta→snapshot 回退一条（可扩展 `v31-artifact-growth-journey.spec.ts` 或新 spec，进必跑门）
- [ ] AC3 移动 viewport 旅程：Artifact 全屏 Sheet 打开/关闭/内容一致
- [ ] AC4 旅程：完成内容修改产生派生版本、旧 revision 可回看、原内容不变
- [ ] AC1 unit/eval 在 tip 重取数字回填
- [ ] V31-15 Evidence 表按填表规则回填并按勾选规则勾选；跑法遵守 e2e-lock + lane 专属端口纪律，证据出自 clean solo 运行

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

> 开工后填；退出码从重定向文件取；PG 证据出自 `scripts/ci/provision-test-db.sh` 一次性库。

## 背景记录

- 2026-08-11 纠偏轮开票：用户问询 §5.5/V31-15 约定时主控复核证据表，发现 done 票下 AC2/3/4 零浏览器证据（Wave-4 resume 说明也明确「AC2/3/4 本轮无定向浏览器绿证，保持空」），属「测试背书缺位」型债，转本票补齐。
