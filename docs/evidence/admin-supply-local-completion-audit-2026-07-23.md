# #106 / #128 本地完成度审计（2026-07-23）

**审计对象：** #106 AP/MP 管理与能力面、#128 Z2-ACCEPT 同一增量。
**审计提交：** `b8b171fec4e2fe586cb52134a0b83cd5e5eba0ae`。
**口径：** #128 的官方单渠道 `primary_connectivity` 发布门优先于 #106 中已被修订的双渠道发布前置。本文只记录本地可复现的合同、recorded 与 UI 结果；不把 fixture、历史收据或跳过的 live 测试写成 `live_verified`。

## 本地验证结果

| 范围 | 结果 | 本次证据 |
|---|---|---|
| #128 Gate 1：能力骨架 | **GREEN（本地）** | capability inventory 4/4；AP Z2 SSR/投影 11/11。库存覆盖 13 项、六问完整、音频保留为 `not_in_scope_for_supply_v1`、异常按根因可聚合。 |
| #128 Gate 2：Story 30 与三模态 recorded 主链 | **GREEN（recorded）** | core Z2 10/10；文本、图片、视频均跑过 procurement → credential → conformance → publish → allocate → task/ledger → audit。 |
| #128 Gate 3：发布门与双端标签 | **GREEN（本地）** | MP-08 matrix/publish 24/24；AP Z2 11/11；Composer 实际选择面静态检查 1/1。少于两个独立故障域时拒绝 `multi_channel_ready`，单渠道必须显示 `single-channel/no-fallback`。 |
| #128 Gate 4：D-048 | **GREEN（本地静态/SSR）** | AP Z2 11/11，运营路径不含 code/SQL/env/raw JSON/CLI，异常首页仍为只读且无 ack/assign。已有四服务 Playwright 3/3 记录在 `admin-supply-accept-gaps-2026-07-20.md`，本次未重启四服务复跑。 |
| #128 Gate 5：诚实 gap 清单 | **GREEN（已更新）** | 主 gap 清单仍明确 G-LIVE-* 为唯一整包 blocker；本次修正了受保护 workflow 的视频模型 pin，并补全 Web 复跑前的 locale 编译。 |

## #106 分组结论

| 规格分组 | 本地状态 | 已验证的边界 |
|---|---|---|
| A：能力骨架与异常首页（1–8） | **GREEN（本地）** | inventory、六问、静态依赖表、真实/unknown envelope、根因去重、只读异常首页、六个一级能力域和 D-048 禁令均有合同或 SSR 覆盖。 |
| B：能力权限（9–11） | **GREEN（本地）** | 15 个 capability-permission 合同测试覆盖默认拒绝、HTTP 403、治理域、不可变审计字段及 Cloudflare 写操作拒绝。 |
| C/D：供应实体、凭据、路由、数据政策与健康（12–22） | **GREEN（本地合同）** | 117 个 supply-registry/permission 合同测试覆盖四层 registry、CredentialAccount 三态与 secret no-echo、动态热装配、RoutePolicy 发布/CAS/回滚、硬过滤、三层排序和带来源的 health overlay。持久化子测试在本机因未设置 `TEST_DATABASE_URL` 不执行，未被升级为新鲜 PostgreSQL 证据。 |
| E：权益与 SupplyPool（23–29） | **GREEN（本地合同）** | 66 个 entitlement/pool 测试覆盖产品/供应侧隔离、Allocation 优先级、shared/dedicated 禁止无授权回退、三层容量、公平队列与账本冻结字段。 |
| F/G：三模态闭环、控制中心与 Cloudflare（30–39） | **GREEN（recorded/UI），LIVE 未满足** | 49 个 provider conformance/adapter recorded 合同测试通过，2 个 opt-in live conformance 用例跳过；控制中心、凭据、关联视图、路由模拟、受治理动作及 Cloudflare 只读呈现由 Web 单测覆盖。主 live gate 也因未提供受保护环境而跳过。 |

## 本次修正

1. `admin-supply-accept-gaps-2026-07-20.md` 将视频 live 目标对齐到 `.github/workflows/provider-live.yml` 所固定的 `doubao-seedance-2-0-mini-260615`，不再引用旧的 Seedance 1.5 fixture 模型。
2. 同一 gap 清单的 Web 复跑步骤现在先执行 `pnpm --filter @meiye/web locale:compile`，并同时运行 Composer 的真实选择面标签检查；否则直接 TSX runner 无法解析生成的 Paraglide imports。
3. `z2-accept-ap.test.tsx` 的过期说明更新为：Composer 选择面已有专门静态测试，四服务 Playwright 是已记录的交互证据，而非仍开放的 UI gap。

## 不满足项与精确解除证明

**#128 整包不得宣称完成，#106 的 C5 真实连通部分也不得宣称完成。** 默认测试执行未启用受保护的官方 ARK 凭据、账户 identity、CatalogModel 绑定、CNY 价格、每探针 reservation 和成本上限；本次 `live-fault-injection.integration.test.ts` 仅按设计跳过，未发起供应商调用。当前可见的 `provider-live.yml` workflow run 列表也没有可用的当前工件；这不是缺失证明，只能说明本审计没有可消费的 live 证据。

唯一可解除 C5 的证明是：在受保护 GitHub Environment `provider-live` 中，以当前 release commit 运行 `.github/workflows/provider-live.yml`，设置 `RUN_PROVIDER_LIVE_CONNECTIVITY=1`、`PROVIDER_LIVE_REQUIRE_ALL=1` 与 `PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity`，并提供受保护的官方 ARK 凭据、账号 identity、文本/图片 CatalogModel 绑定、正数 CNY 价格和三条 probe reservation。上传的脱敏工件 `apps/core/provider-live-evidence/provider-live-gate.json` 必须绑定该 release commit、运行 nonce、配置 revision 和未过期时间，并显示文本/图片/视频各一次真实 adapter 调用、provider task/result hash/cost、`blockedChecks=[]`、`skippedOperations=[]`；三条 publish gate 都必须是 `single_channel`、`publishAllowed=true`、`multiChannelReady=false` 且标签为 `single-channel/no-fallback`。取得两条独立故障域的实时证据前，仍不得声明 multi-channel ready 或自动 fallback。

## 本次运行的针对性命令

```bash
pnpm --filter @meiye/contracts exec tsx --test src/capability-inventory.test.ts
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 src/p1/z2-accept/z2-accept.test.ts
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 src/p1/model-supply/provider-conformance/fault-injection/fault-injection.matrix.test.ts src/p1/model-supply/provider-conformance/fault-injection/publish-gate.test.ts
pnpm --filter @meiye/web locale:compile
pnpm --filter @meiye/web exec tsx --test src/p1/z2-accept-ap.test.tsx src/product/composer/composer-channel-readiness.static.test.ts
pnpm --filter @meiye/web exec vitest run src/p1/admin-supply-control.interaction.test.tsx
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts
```
