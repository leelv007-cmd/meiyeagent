# D-244：价格有效期由商家说，不由系统替他决定

Status: accepted (2026-07-28) · 承接 #244 · 关联 D-151①（单写入通道）/ D-116（对客白话）/ ADR-0018（生成期零阻断）

## 起因

商家在录入向导里填一个活动价，系统一句不问就把它存成「当前生效、永不过期」。活动结束几周后，这个价还在以「当前事实」的身份进内容生成——商家从没说过它是长期价，是系统替他做了这个决定，而且没告诉他。

这跟 W12① 前端替商家全开四平台五场景是同一类失效：**系统替商家做了没告诉他的决定**。

现场的三段事实链：

- 前台 `progressive-fact.ts` 只收价格，没有有效期输入位；
- 保存时把 `expiresAt` 写死 `null`；
- 生成侧 `fact-satisfaction.ts` / `store-fact-ledger.ts` 一直**会**按有效期排除过期事实——它只是永远等不到一个有有效期的价格。

后端从来准备好了，前台从来没问。

## 裁决一：向导必问，且不设静默默认

价格步骤后面追加一个同级的必答问题——「这个价格用到什么时候？」，两条路：**长期有效**，或**用到某一天**。

- 不预选任何一项。留空不是「长期有效」，留空就是没回答，确认按钮不给过。
- 商家答「长期有效」时写 `expiresAt: null`；答日期时写当天结束的时刻。
- 两个入口（首页补问卡 + 五步录入向导第五步）共用同一个控件，规则只写一遍。

**为什么不能「不填就默认长期」**：那正是这张票要修的东西。默认值在这里等价于替商家宣布他的促销价永不结束。

## 裁决二：`prepare_assisted_price_intake` 退役，不留第三态

这条命令是全仓**唯一**带完整有效期契约的价格入口，也是唯一一个**零生产前台调用点**的命令。留着它就是留一个「后端准备好了、前台永远不用」的假接缝——正是这张票的病因本身。

- 删除：契约 schema（`prepareAssistedPriceIntakeCommandSchema` 及其类型）、能力权限项、`asset-memory` 命令分支、`AssetIntakeService.prepareAssistedPriceIntake` 与其截金额的 `assistedPriceAmount`、随之孤立的 `AssistedScreenshotAssetAuthorizer` 构造参数。
- 不新建替代通道：有效期跟着价格候选自己的 `effectiveFrom` / `expiresAt` 走 `finalize_store_intake`，与 D-151① 的单写入通道一致。
- 原来挂在这条命令上的幂等/冲突覆盖，改挂在它本来就在调用的 `recordBatch(batch, fingerprint)` 上，没有净损失。

## 裁决三：存量价格标为「待你确认」，一条数据都不作废

`StoreProject` 增一个三态字段 `priceValidUntil`：

| 值 | 含义 |
|---|---|
| 字段不存在 | 没人问过他。历史数据落在这里。 |
| `null` | 商家说了：长期有效。 |
| ISO 时刻 | 商家说了：用到那时候。 |

于是「历史迁移」根本不是迁移，是一次**读取时的推导**：向导看到某个项目没有 `priceValidUntil`，就把有效期这一格标成待确认，走 W01/W02 已经建好的 `unconfirmed` + `provenance` 那套语义（没有造第二套）。

- **不激进**：不作废、不改写任何已入库的价格事实，它照旧有效。
- **不延续问题**：不再假装它是商家确认过的永久价。
- **幂等且可重放**：纯推导，没有回填脚本、没有一次性状态、重放多少次结果相同。
- 商家下次进向导时被引导补上这一句，补完就不再问。

D-151③ 的历史导入通道（`source.kind: 'import'`）**豁免**：那些值本来就没人问过有效期，导入不许替商家编一个，所以它导进来仍然是「待确认」，等商家亲口说。

## 接缝（成对）

| 写入端 | 读取端 |
|---|---|
| 向导 / 补问卡 → 价格候选的 `expiresAt` | `store-fact-ledger.ts` `isStoreFactActive` → `listActive` 不返回过期价 |
| 向导 → `profilePatch.projects.upsert[].priceValidUntil` | `createProgressiveFactDraft` → 无此字段即标待确认 |
| 两者必须一致 | `store-intake-finalizer.ts`：商家确认的价格若无有效期、或两侧不一致，整条命令 `STORE_FACT_MAPPING_INVALID` 拒绝 |

最后一行是这张票真正的防线：即使将来某个前台又忘了问，服务端也不会替商家把沉默存成「永不过期」。
