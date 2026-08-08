# V3.1-D 交付：Artifact 原位生长 + Steering 双队列 + 发布交接 + 商家自报旅程

> **已发布**：https://github.com/leelv007-cmd/meiyeweb-agent/issues/433（label: ready-for-agent）；本文为票面本地快照。
> 决策权威：V3.1 §5.5–5.6、§6、§24、§26.1（消费侧）、§27.5；决策记录附录 B（U2）；硬约束附录 A（A19 二维码限定、D-155 白名单）。
> 依赖：#431（冻结计划执行链）；**仅自报落库子交付**另依赖 #432 的 OutcomeEvidence 合同，其余交付不受其阻塞（#432 是并行 lane、不阻塞主线，V3.1 §35）。

## Problem Statement

生成过程中商家看到的是不断追加的「候选卡+结果卡+交付卡」堆叠，同一对象出现多次；中途想改（「封面别写最后两个名额」）只能等全部做完重来；做完后从系统到手机发布的路径断裂；发布后的结果没有回流入口。

## Solution

右栏一个稳定 Artifact 原位生长（同一 artifactId reconciliation，逐块/逐页/逐场景更新）；运行中 Steering 按影响分类精准应用（双队列：打断式 steer / 追加式 follow_up）；Delivered 后发布交接（分块复制/确定性 ZIP/手机二维码商家自发/能力三态/发布留痕）；次日自报追问把结果写回 OutcomeEvidence。

## User Stories

1. As a 美业商家, I want 图文在右侧同一个对象里逐页长出（骨架→文案→配图状态）而不是刷出一堆新卡片, so that 过程清晰无重复。
2. As a 美业商家, I want 视频任务按分镜/关键帧/字幕/封面逐场景显示进度, so that 长任务不焦虑。
3. As a 美业商家, I want 运行中说「封面不要写最后两个名额，第二页少点字」，系统只改封面和第二页并明确告诉我影响范围, so that 纠偏不推倒重来。
4. As a 美业商家, I want 「等下，换个风格」（当前单元完成即插入）和「做完再加一条朋友圈」（全部完成后插入）被区分处理, so that 我的意图时点被尊重。
5. As a 美业商家, I want 增加页数/换平台这类改变数量费用的指令回到方案层重报价确认, so that 费用变化永远知情。
6. As a 美业商家, I want 6 页成功 5 页时只重做失败页且退费规则清楚, so that 部分失败不全损。
7. As a 美业商家, I want 已完成内容永不被静默覆盖（修改产生派生版本）, so that 我能回到之前的版本。
8. As a 美业商家, I want Delivered 后看到主推荐/其他交付物/发布准备度/快捷修改/生成同系列/继续同一 Thread, so that 下一步永远明确。
9. As a 美业商家, I want 标题/正文/话题/CTA 分块复制、图片按序命名批量下载（确定性 ZIP）、视频含字幕封面与平台安全区, so that 发布材料到手即用。
10. As a 美业商家, I want 扫二维码在手机上继续交接、由我自己在平台 App 里发布（系统绝不代发）, so that 五分钟内完成手机发布。
11. As a 美业商家, I want 未验证的发布能力显示为 assisted/unavailable 而不是伪装可直发, so that 我不被假按钮误导。
12. As a 美业商家, I want 点「我已发布」并可留链接/时间/截图，绑定确切内容版本, so that 结果留痕可信。
13. As a 美业商家, I want 次日一句话追问 + 一键 chips 补记结果（同一 Work 只问一次，连续两次不理降频）, so that 反馈零负担。
14. As a Core 服务, I want ArtifactUpdate 协议（artifactId/revision/status: skeleton|partial|ready|failed/patch）同 id reconciliation, so that 前端渲染与恢复有唯一合同。
15. As a Core 服务, I want 全部 Steering 形成可追踪 command（绑定 thread/work/task/plan revision/snapshot/content revision），accepted/acceptance_unknown 的 Provider 副作用不可被「修改」, so that 执行侧审计完整。
16. As a 运维, I want make_steering_v1 flag 与 disable_make_steering kill switch, so that 中途干预能力可独立降级。

## Implementation Decisions

- Steering 分类四态：future_step_patch（不重报价）/ derived_revision / plan_change（回方案层 replan+requote）/ unsafe_or_conflicting（解释并要求修正）（V3.1 §5.6/§23.3）。
- 发布交接全部落在 D-155 白名单内（交付与导出、assisted_handoff/manual_copy/export、商家自报记账）；二维码语义=MobilePublishHandoff 商家自发，扫码后我方驱动发布被 reject（附录 A19）。
- assisted 交接承接既有 receipt 细则：24h 未确认提醒、一次性链接 72h 失效、「已交接」与「已发布」分离。
- 自报写路径消费 #432 的 OutcomeEvidence 合同（merchant_reported；幂等键 contentPackageRef+signal+observedAt/sourceRef）；40% 覆盖率首窗只观测（U2）。
- 移动端：过程/作品胶囊切换、Artifact 全屏 Sheet、付费 Interrupt 全宽底部面板；不在手机暴露复杂编辑器（V3.1 §4.3）。
- Delivered 精修仍走对象工作区真相面（NoteObjectWorkspace 方向），本 spec 不重写编辑器。
- ArtifactUpdate wire 为 discriminated union：`{mode:'snapshot', full}` / `{mode:'delta', baseRevision, patch}`；patch schema 按 artifactType 受控（非 unknown）；同 revision 重放幂等、跳 revision 退回取 snapshot，对接 #429 的重连顺序（V3.1 §27.6、§35 批次 4「snapshot/delta」交付项）。

## Testing Decisions

- 主 seam：P1 action + 事件流边界——artifact stable id 断言（重复对象率=0）、steering 分类与影响范围、partial delivery 结算、发布留痕绑定 revision、自报幂等。
- ArtifactUpdate SSE round-trip：乱序/重复/跳 revision/断线重连断言（delta 失败或跳号回退取 snapshot）。
- Playwright journey：Mid-run Steering（V3.1 §37.4-G，改封面与第二页其他页保持/增页进 replan）、发布交接（Delivered 五分钟内完成手机交接）、自报旅程（§37.4-K）。
- 退出门（V3.1 §35 批次 4）全部纳入验收。

## Out of Scope

平台代发/自动发布（D-155 冻结面，automatic_verified 首发=0）；Proactive 建议（V3.1-F）；对象工作区编辑器重构。

## Further Notes

Artifact 渲染组件全部走 Controlled Surface Registry（模型不可传 HTML/组件名/任意 action，V3.1 §28.4）。
