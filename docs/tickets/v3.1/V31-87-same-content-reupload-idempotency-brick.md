# V31-87 — 同内容图片跨面重传恒 409 IDEMPOTENCY_CONFLICT：composer 内联上传永久失败循环

**Parent**: V31-84 收口走查新发现
**批次**: 清红队列（P1，素材链）
**Blocked by**: 无
**Related**: V31-84、V31-88（挂源缺口——正是它逼商家重传同图）

**Status**: implementation-complete（2026-08-13）— 幂等键改为「内容 hash＋事实指纹」，两入口统一，失败呈现分层；主控追加撤权传播修复

**Implementation state**: implemented
**Verification state**: unit/PG-verified（Core 5＋PG 1＋web 11＋interaction 3；同键同 payload 仍幂等的防线保留并有测试；主控变异：撤权传播去掉 add_asset 即红）。活体重传路径未复走（新号链路已被 V31-88 挑选器替代为常规路径）
**Evidence SHA**: 7e6876aca407939a953ded2ef88d57d996da1fb0
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

- [x] 语义=键纳入「内容 hash＋注册事实指纹」＋Core 侧同 objectKey 复用既有资产改走元数据更新（两者组合）
- [x] 失败分层：不可重试（IDEMPOTENCY_CONFLICT/4xx）给说明＋指向素材库挑选，不再给死重试钮
- [x] 先红后绿＋e2e spec 落盘（--list 可解析，全栈跑归旅程门轮）

## 收口补记（2026-08-13 主控）

- **主控直修（lane 未覆盖）**：`add_asset` 的复用分支会把已授权素材打回 pending/blocked，
  但撤权传播的触发清单只有 withdraw/update_metadata/authorize ⇒ 引用该素材的 ContentPackage
  收不到「需处理」。补进清单并限定**只在复用分支**触发（新素材首次 add 不传播，否则既有
  三条测试即红）。先红后绿＋变异验证。
- **顺带修门**：`quality-gates` 的「每条 v31-*.spec.ts 必须登记」在 main 上已红——V31-82/83/
  84/86 四条 spec 是我前几轮合入时漏登记的，本轮补齐，门恢复 14/14 绿。
