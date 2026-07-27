# W01 建档链数据流复核

日期：2026-07-27
复核基线：`main@e4a99b28`
状态：已实现并通过独立复审；合并前核销

## 结论

W01 的生产断点位于商家确认入口与 StoreFact 账本之间。两个现有
`confirm_store` 入口都只更新 `ProductState.store`；定制创作的
ContextBundle 只读取 StoreFact，所以商家在现有入口确认的门店事实不会成为
`current_fact`。

ContextBundle 的读取、分层和冻结链已经有效，本票不重建消费端。

## 实际生产链

### StoreFact 写入

生产代码只有两个语义写入口：

1. `ContextFoundationModule` 的 `store_fact_append`
   → `StoreFactSemanticMutationPolicy`
   → `PostgresStoreFactLedger`。
2. `AssetMemoryFoundationModule` 的 `confirm_asset_intake_fact`
   → `AssetIntakeService.confirmFact`
   → `StoreFactSemanticMutationPolicy`
   → `PostgresStoreFactLedger`。

其中第二条已有 reservation、逐 fact OCC、decision receipt 和宕机恢复匹配，
适合作为商家确认事实的唯一复用入口。唯一写路径静态门禁止其它生产模块直接写
StoreFact SQL 或绕过语义策略。

### 现有商家入口

- 流内 `ProgressiveFactCard` 从空 draft 开始，构造完整 `confirm_store`。
- 门店页手工表单也构造完整 `confirm_store`。
- `ProductService` 对 `confirm_store` 执行整对象替换。

因此现状是：

```text
ProgressiveFactCard / store page
  → confirm_store
  → ProductState.store
  -X→ AssetIntakeService.confirmFact
  -X→ StoreFact
  -X→ ContextBundle current_fact
```

流内卡的完整替换还会确定性地丢失未出现在 draft 中的账号、额外项目、
`regulated` 和 `prohibitions`。

### 已通的消费链

`LedgerBackedHarnessContextPort` 在定制创作时：

1. 从 StoreFact ledger 读取当前 scope 的 active facts；
2. 投影为 `layer: 'current_fact'`、`pool: 'store_personal'`；
3. 冻结 fact revision、source、effective time 和 expiry 到 ContextBundle；
4. 由后续 Recipe/fact satisfaction 消费冻结结果。

## D-151 目标链

本票采用已确认的“一次确认事件、两个投影”：

```text
ProgressiveFactCard
  → finalize_store_intake（单命令、单幂等键）
      ├─ AssetIntakeService.confirmFact
      │    → StoreFact【内容事实权威】
      └─ server patch-merge
           → ProductState.store【身份与兼容投影】
  → LedgerBackedHarnessContextPort
  → ContextBundle current_fact
```

约束：

- finalizer 复用 `confirmFact`，不新增第三个 ledger writer；
- 项目、价格、团购、优惠、履约及明确 key 的可引用档案进入 StoreFact；
- 账号、brand voice、regulated 与合规策略留在 ProductState；
- profile 只允许 patch-merge，数组按稳定标识 upsert，删除必须显式；
- profile 与 fact 都有 OCC；
- durable projection receipt 记录阶段；若 fact 已写而 profile 投影失败，同一
  幂等键重试必须收敛到原 fact revision；
- legacy `confirm_store` 不带明确确认来源时不得自动升格历史价格为 StoreFact；
- 旧门店页手工表单在 W01 删除；W02 再挂同一 finalizer 的五步向导；
- 浏览器不得直调 `store_fact_append`、循环写事实或自行声明高信任 provenance。

## 验收边界

W01 必须以真实 PostgreSQL 证明：

- 流内确认的事实形成 StoreFact revision，并在定制创作的冻结 ContextBundle 中
  以 `current_fact` 出现；
- source 与 expiry 原样进入 fact snapshot；
- 同幂等键重放不增加 fact/profile revision；
- 旧 profile revision 返回 409；
- 中途 profile 投影失败后重试收敛；
- 仅修改一个项目时，既有账号、额外项目、regulated 与 prohibitions 不丢；
- 显式删除项目产生 StoreFact revocation；
- 过期、撤销、无权利或示例事实不进入模型事实集合；
- 唯一 StoreFact 写路径静态门继续通过。

## 最终核销

- 写入入口：`apps/core/src/p1/operations/asset-memory-foundation-module.ts:130` 调用
  `finalize_store_intake`；`apps/core/src/p1/operations/store-intake-finalizer.ts` 复用
  `AssetIntakeService.confirmFact`，随后 patch-merge `ProductState.store`。StoreFact SQL
  仍只由 `PostgresStoreFactLedger` 持有。
- 消费入口：`apps/core/src/p1/harness/production-context-port.ts:197-205` 读取 active
  facts；冻结 bundle 的 production chain 将其投影为 `current_fact/store_personal`。
- W02 接缝：非手工来源只能引用服务器持久化 batch；W02 仍负责五步 UI，不在 W01
  范围内声称完成。
- PostgreSQL（绝对 `e2e-lock.sh`）：20 passed / 0 failed / 0 skipped，exit 0；覆盖
  clock retry、W02 receipt、OCC、并发 reconciliation、scope、双投影和值/删除一致性。
- Chromium（绝对锁、独立库 `meiye_w01_e2e_20260727_r7`）：1 passed / 0 failed /
  0 skipped，exit 0；验证 finalizer → StoreFact → ContextBundle factRefs 全链。
- 独立第五轮复审：P0=0、P1=0，允许合并。
