# V31-15 — Artifact protocol（snapshot/delta）+ 原位生长 + registry 注册

**Parent**: spec-D（#4）`docs/specs/v3.1-agent-specs-2026-08-08/spec-D-433-delivery.md`；权威 V3.1 §5.5、§24.1、§27.5
**批次**: 4（frontend 部分可归 frontend lane）
**Blocked by**: V31-03, V31-04
**Status**: done (merged, 2026-08-08)

## What to build

右栏稳定 Artifact 原位生长（同一 artifactId reconciliation）：图文逐页（骨架→文案→配图状态）、视频逐场景（分镜/关键帧/字幕/封面）；ArtifactUpdate wire=discriminated union {mode:'snapshot',full}/{mode:'delta',baseRevision,patch}，patch schema 按 artifactType 受控；同 revision 重放幂等、跳 revision 退回取 snapshot；渲染组件全部注册 Controlled Surface Registry；已完成内容永不静默覆盖（修改产生派生版本）。

## Acceptance criteria

- [ ] artifact stable id 断言：重复对象率=0
- [ ] SSE round-trip：乱序/重复/跳 revision/断线重连全过（delta 失败回退 snapshot）
- [ ] 移动端 Artifact 全屏 Sheet 可用
- [ ] 版本回看可达（派生版本不覆盖）
