# D-087 图片采用语言与写入合同

- 日期：2026-07-20
- 状态：`accepted`
- 对应主决策：D-087
- 范围：图片 Result Workspace 的单图采用、主图/封面语义、套图组装、替换、调整和保存素材

本文所称“不可变媒体版本”首轮由新的 owned media asset id 与 parent/source lineage 共同承载，不等同于 `reuse-memory.ts` 中表示可复用配方/系列的 `AssetRevision` 类型。

## 1. 动作词典

| 当前对象与目标 | 唯一候选态主动作 | 完成反馈 | canonical 结果 |
| --- | --- | --- | --- |
| 独立单图或海报 | `采用这张` | `已采用这张图片` | 写入当前单图成品槽 |
| 当前内容主图 | `选为主图` | `已设为主图` | 目标图成为当前 variant 有序列表第 1 张 |
| 独立封面或已采用套图编辑 | `设为封面` | `已设为封面` | 目标图成为当前 variant 有序列表第 1 张的新 derived revision |
| 组装中的单张候选 | `加入套图` | `已加入套图，第 N 张` | 只更新本地 working selection |
| 完整候选套图 | `采用这组` | `已采用这组，共 N 张` | 原子写入有序套图 revision |
| 已采用槽位的替代候选 | `替换当前图片` | `已替换，原版本仍可恢复` | 创建新的 derived revision |

同一情境只显示一个采用主动作。Recipe/deliverable 必须提供足够信息来解析目标；无法唯一确定目标时，先让用户选择成品角色，不能默认写入第一个槽位。

套图采用前的本组封面选择也使用“设为封面”，但反馈必须为“已设为本组封面，采用这组后生效”，并持续显示未采用状态，不能使用 canonical 的“已设为封面”反馈。

## 2. 首次创建与单图写入

- 首次采用不存在目标 ContentPackage 时，命令必须绑定来源 Work/Task、workspace、Recipe/deliverable revision、候选不可变媒体版本、目标语义与稳定幂等键，并使用 `expectedContentPackageRevision = null` 或独立 create-if-absent 命令原子创建唯一包。
- 同一幂等键在丢响应后重放必须返回同一 ContentPackage 和 revision；同一来源 Work/Recipe 的并发首次采用不得创建第二个 canonical 包。
- 已有 ContentPackage 时，`采用这张`、`选为主图`和 canonical `设为封面`必须绑定候选不可变媒体版本、目标 ContentPackage、目标语义与 expectedRevision。
- 命令成功创建新的 ContentPackage revision，并保存 source、adoption target、immutableMediaVersionRef、actor、time 和 reason。
- stale expectedRevision 必须拒绝静默覆盖，刷新后展示当前槽位与候选差异，再由用户确认。
- 已采用同一不可变媒体版本到同一位置是幂等重放；采用不同候选必须走“替换当前图片”，不能把旧版本从历史中删除。

## 3. 套图组装与原子采用

候选组必须由冻结的 Recipe/deliverable 槽位和 canonical Task/Work/Job 输出提供组身份与顺序，不得扫描同一 Session 的所有图片、按 createdAt 拼组或由前端临时猜测“这一批”。当前生成仍为单媒体输出时，多图 Recipe 应由父任务的有序 child slots 冻结整组。

采用前的套图工作面维护可撤销 working selection：

```text
candidate immutable media revision refs
ordered slots
cover/main role
removed candidates
source task/revision
return focus and scroll position
```

“加入套图”、采用前排序、设封面和移除只修改 working selection，不创建 Work、Task、Job、Asset 或 ContentPackage revision，也不预占生成费用。采用前设封面必须持续显示“尚未采用”，反馈为“已设为本组封面，采用这组后生效”。执行“采用这组”时，以稳定幂等 create-if-absent 或已有包 OCC 命令原子写入：

- 有序不可变媒体版本引用；
- 每张图片的序号；
- 由 Recipe/deliverable 解释的第 1 张主图/封面语义；
- 来源 Task/Job/Asset 血缘；
- 当前 Recipe/deliverable revision；
- expected ContentPackage revision。

任一图片缺失、权利撤销、非持久化或 revision stale 时整组拒绝提交，不允许部分采用后留下不可解释套图。

首版不新增独立 PrimaryImage/Cover 实体。image_text 当前平台 variant 的有序视觉列表第 1 张就是该 variant 的主图/封面；切换封面等价于创建新的有序 ContentPackage revision。平台 variant 可以拥有不同顺序，但必须继续来自同一 canonical ContentPackage 版本链。

“加入套图/移除/采用前排序/设为本组封面”编译为本地 working-selection typed intent/reducer，不调用 canonical 写命令。只有“采用这张/选为主图/采用这组/替换当前图片/已采用后设为封面”等提交动作进入同一服务端 visual-adoption command。服务端命令至少区分 `standalone | set_primary | adopt_set | replace_set | replace_item` mode，并绑定来源 run、不可变媒体版本列表、baseVersionId、expectedRevision 或首次创建空 revision、稳定幂等键，统一执行非空、唯一、image-only、权利、来源、OCC 和原子写入校验。

## 4. 已采用后的编辑

- 排序、设封面、移除、补图和替换都是确定性 ContentPackage 编辑，每次创建新的 derived revision。
- `替换当前图片`必须保存旧位置、旧媒体版本、新媒体版本、来源和 reason，提供撤销或版本恢复。
- 原媒体对象永不修改；确定性编辑和模型编辑都生成新的候选不可变媒体版本。
- 模型编辑必须继承 D-046：创建 derived Task、derived-from/source/route/cost 审计链，不新增 message/thread 持久化实体。
- 新候选默认不改变当前 ContentPackage；单图通过“替换当前图片”，整组通过“采用这组”，再以 OCC 写入。
- `调整这张`只针对目标不可变媒体版本创建调整任务或确定性派生；不得默认重新生成整组。
- `调整整组`必须在提交前显示受影响张数、费用和预计时长，并为每个实际受影响对象保留血缘。运行中部分成功可以保留为候选并只重试失败项，但不得部分采用；完整有效集合仍通过一次“采用这组”原子写入。
- 复杂自由布局可进入 Pro Studio，但回流仍通过同一 adoption/revision 合同，不建立第二套图片或历史真相。

## 5. 保存素材边界

| 动作 | 作用对象 | 是否改变当前内容 |
| --- | --- | --- |
| `保存到素材库` | 明确的单个不可变媒体版本 | 否 |
| `保存选中图片到素材库` | 用户明确选择的多个不可变媒体版本 | 否 |
| `采用这张/这组` | 当前 ContentPackage 槽位或有序套图 | 是 |

素材保存必须引用持久化对象、权利状态和 parent/source lineage，不复制临时 Provider URL。相同不可变媒体版本在同一素材库中的重复保存应幂等返回“已在素材库”。采用不会自动把图片升级为跨任务可复用素材；在上述媒体版本与血缘落库前，素材保存动作不得正式上架。

## 6. 桌面、移动与无障碍

- 桌面同一时刻最多一个 adoption primary；次动作包含调整、素材保存和更多。
- 移动端固定一个 primary 与“更多”，套图组装使用全屏或主工作区，不使用嵌套 bottom sheet。
- 图片选择态同时使用文字、勾选和位置说明，不只靠颜色；读屏名称示例为“第 2 张，候选，加入套图”。
- 预览焦点、尚未提交的 selected、已写入的 adopted、当前第 1 张 cover/main 和已保存素材必须是分离状态，不能复用图库现有名为 `selected` 的灯箱预览变量或共用一个勾号。
- 排序必须支持键盘和非拖拽替代动作，例如“前移”“后移”；移动后播报新位置。
- 采用、替换或恢复完成后，焦点回到更新后的图片、槽位或套图摘要，不跳回页面顶部。
- 320×720、390×844、横屏和 200% 缩放下必须能完成单图采用、套图组装、排序、设封面、替换与撤销，无页面级横向溢出。

## 7. 当前实现基线与开发缺口

- `adopt_into_content_package` 已要求至少一个唯一、有序、同 Session 或已授权的视觉 Asset，并能原子创建 image_text ContentPackage；可复用为整组采用底座。
- 当前 direct image Job 和媒体结果仍是单 Asset，没有一等候选组、候选序号或服务端推荐主图；多图 Recipe 必须先补父任务有序槽位，不能把 Session 图片默认全选当成候选组。
- `attach_content_package_generation` 已能把完成任务的唯一、有序输出追加到已采用 ContentPackage，但当前是整次任务级附加，不等于用户完成了角色化单图或套图采用。
- canonical media gallery 当前只有预览、放大、失败重试和详情链接，没有采用、角色、排序、替换或素材保存动作。
- 现有 ContentPackage 主要保存 ordered asset ids，普通媒体没有通用 revision 字段或 parent/source lineage；`reuse-memory.ts` 的 `AssetRevision` 不能冒充图片版本。
- Pro Studio 与 Light Composer 当前写回现有包时不能安全保持原 ContentPackage 的最终文案或会新建另一个包；补齐“克隆 base version 文案、只替换视觉顺序”的同一 visual-adoption command 前，不算 D-087 回流闭环。
- 因此 D-087 是目标合同，不代表现有图片结果页已经完成这些动作。

## 8. 首轮验收

1. 每种图片情境只出现正确的唯一主动作和对应完成反馈。
2. 已有 ContentPackage 的单图采用带 expectedRevision；stale 时不覆盖当前位置。
3. 首次采用在没有 ContentPackage 时幂等创建唯一包；丢响应重放和并发提交不产生第二个包。
4. “采用这组”一次写入完整顺序和不可变媒体版本引用；任一失效时零部分写入。
5. 采用前组装、取消和撤销不创建 canonical 业务对象或生成费用；本组封面明确标注采用后才生效。
6. 已采用后的排序、设封面、移除和替换均产生可恢复的新 revision。
7. 调整产生候选不可变媒体版本，不自动替换当前成品；整组部分成功不得部分采用。
8. 保存素材不改变 ContentPackage；采用不自动创建可复用素材。
9. 逐张调整不重跑整组；整组调整显示影响范围、费用和预计时长。
10. 键盘、读屏、320/390px 和 200% 缩放能够完成全部 P0 动作。

## 9. 对标证据边界

- 小云雀本轮未提交图片生成；旧素材回流证据主要来自视频，不能外推图片自动保存。
- CreatOK 可支持“图片有角色、套图有结构、资产库独立”的方向，但当前账号未验证采用动作。
- 讯飞绘文反向基线可支持逐图多版本、单图重试和整批导出方向，但当前 live 未验证本文中文动作。
- 最终语言和写入合同来源于我方 Product/ContentPackage 与不可变媒体血缘边界，不是竞品按钮复刻。
