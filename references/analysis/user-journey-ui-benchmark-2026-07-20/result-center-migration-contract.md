# D-089 独立结果中心迁移合同

- 日期：2026-07-20
- 状态：`accepted`
- 对应主决策：D-089
- 用户选择：方案 C「新建独立结果中心」
- 范围：Result Center 路由、既有 Workbench/移动 ActionBook/ContentPackage detail 的职责迁移、深链恢复、灰度与回滚

## 1. 目标形态

```text
Composer
  └─ submit → durable Work
                  └─ /dashboard/results/$workId
                       ├─ shared Result Shell
                       ├─ copy/image/video workspace
                       └─ canonical commands

Content library/history/task/notification
  ├─ resolvable Work → Result Center
  └─ legacy package without Work
       ├─ view/archive → ContentPackage detail
       └─ explicit adjust/deliver → ensure compatibility Work → Result Center
```

Result Center 是运行中和运行后结果处理的主工作区。它不是 Result 数据实体，也不拥有独立状态、历史、资产、交付或计费记录。

## 2. 三个页面的永久职责

| 页面 | 永久职责 | 必须退出的职责 |
|---|---|---|
| Composer / Workbench | 意图、素材、对口、Recipe/模型设置、报价确认、提交；提交后的最小运行/完成摘要 | 完整候选采用、版本编辑、媒体精修、主动交付 |
| Result Center | 进度与恢复、候选、采用、调整、版本、交付、运行证据、进入 Pro Studio | 独立业务状态、独立账本、独立资产或发布真相 |
| ContentPackage detail | 内容库档案、不可变版本/来源/回执深链、legacy 只读与按需迁移入口 | 与 Result Center 平行的完整主动编辑和交付工作区 |

## 3. 路由合同

主路由为 `/dashboard/results/$workId`。允许的可分享状态仅包括：

- `contentId`：该 Work 已创建或采用的 ContentPackage；
- `versionId`：不可变版本；
- `panel`：`result | adjust | delivery | history | run`；
- `focusKey`：语义化焦点目标，不保存 DOM selector。

服务端 resolver 必须验证 Work、ContentPackage、version 和当前 workspace 的 lineage/权限关系。任何显式目标失效或不匹配都返回 recoverable error，不得退回最新 Work、最新 ContentPackage 或用户最近访问对象。

旧 `stage=action|progress|handoff` 只可映射为初始 panel 的兼容提示，不进入 phase 真相。Result phase 每次从 canonical 对象重新计算。

Result Center 不占用一级导航，也不提供无 `workId` 的集合首页。入口来自 Composer 提交/完成、最近创作、内容档案、任务、通知和可信深链；结果集合、搜索、筛选与批量管理继续归“内容”或任务/历史投影。入口根据 phase 使用“查看进度 / 处理当前问题 / 继续调整 / 继续交付 / 查看结果”等明确动作，并全部解析到同一 Work/revision。

缺少目标、目标不存在和无权访问必须分别处理，不得回落到最新 Work。浏览器返回按来源恢复原草稿或列表筛选、分页、滚动与焦点；“回到创作”是基于当前结果开启新意图，不等同于返回来源。

### 3.1 Legacy ContentPackage 按需兼容

没有来源 Work 的旧 ContentPackage 默认留在只读详情。只有用户明确选择继续调整或主动交付时，服务端执行幂等 `ensure_legacy_content_work_anchor`：以 workspace、ContentPackage id 和 migration contract revision 形成稳定键，创建或返回唯一 `origin=legacy_import` compatibility Work，再进入 Result Center。

该命令只建立稳定 target 与 lineage，不调用模型、不创建 Task/Job/ProviderAttempt、不预占或扣减额度、不生成 ContentPackage revision，也不伪造 Recipe、prompt、模型、RouteSnapshot、报价或权利事实。原 revisions、Assets、ExportReceipt、ApprovalReceipt 与 DeliveryAttempt 仍由 ContentPackage 引用，compatibility Work 不复制它们。后续用户明确提交 AI 调整或生成时，才按当时模型和报价创建新的 derived Task/Job 并独立计费。

迁移失败时原详情保持可读；丢响应重试必须找回同一 Work。已存在 anchor 后，旧详情的主动调整、生成和交付入口统一打开 Result Center，不再执行平行命令。

## 4. 唯一投影和唯一命令

```ts
type ResultTarget = {
  workId: string;
  contentId?: string;
  versionId?: string;
};

type ResultShellModel = {
  target: ResultTarget;
  phase: ResultPhase;
  workspaceKind: "copy" | "image" | "video";
  primaryAction: ResultAction;
  secondaryActions: ResultAction[];
  canonicalLinks: CanonicalObjectLink[];
};

interface ResultCommandAdapter {
  execute(input: {
    action: ResultAction;
    target: ResultTarget;
    expectedRevision?: string;
    idempotencyKey: string;
  }): Promise<ResultCommandOutcome>;
}
```

新旧 renderer 都只能调用这一 adapter。adapter 复用现有 Product Core commands、OCC、幂等 registry、query invalidation、账本和审计；迁移期禁止双写或为新路由新增旁路 mutation。

## 5. 返回、刷新与跨设备恢复

- URL 保存可分享目标，`history.state` 或受控 return store 保存来源筛选、滚动、触发点焦点和展开面板。
- 未提交编辑按 `{workspaceKind, workId, baseRevisionId, surfaceVersion}` 隔离；revision 漂移时提供恢复、对比、丢弃。
- 浏览器返回 Composer 时恢复提交前草稿和触发位置，不复制 Work 或重新提交。
- 版本深链固定展示指定版本；存在新版本时提示，不自动跳到最新版本。
- 跨设备只中继已持久化 canonical state；本地未提交选择或编辑不宣称已同步。
- not-found、forbidden、lineage mismatch、stale revision 分别展示，不用一个空白页或“暂无结果”吞掉错误。

## 6. 迁移波次

1. Wave 0：实现 target resolver、phase/action projection、command adapter、恢复合同和 shadow telemetry，旧视觉不变。
2. Wave 1：建立 Result Center 路由，以旧结果 body 作为临时 panel；桌面和移动内部灰度。
3. Wave 2：迁入文案/图文工作区。
4. Wave 3：迁入图片工作区及采用、套图、版本血缘。
5. Wave 4：迁入视频工作区及单镜/整段生成、报价、恢复和交付。
6. Wave 5：历史、通知、任务、内容详情与设备中继统一解析 Result Center 深链。
7. Wave 6：删除 Workbench 完整结果分支和 ContentPackage detail 重复主动动作；保留 legacy fallback。

波次不是对外分轮。正式首发必须同时通过文案、图片、视频和桌面、移动发布门。

## 7. 灰度与回滚

建议开关：

- `result_center_projection_v1`：shadow projection；
- `result_center_route_v1`：新路由总开关；
- `result_workspace_copy_v1`、`result_workspace_image_v1`、`result_workspace_video_v1`：媒介工作区开关；
- `result_center_canonical_links_v1`：历史、通知、任务和内容入口收敛。

按账号稳定分桶；同一账号桌面和移动默认一致，一次会话内不热切换 renderer。回滚只切路由/renderer，不回滚数据和 schema。

以下任一情况触发立即回滚：

- 写入错误 Work、ContentPackage、version 或 workspace；
- 重复命令、重复扣费或重复 Provider request；
- 未提交编辑或返回现场丢失；
- 旧深链失效、重定向循环或显式目标回落最新对象；
- 键盘无法完成主任务、焦点陷阱或读屏阻断。

## 8. 退场门

迁移完成必须同时满足：

1. 所有入口对同一对象投影出相同 `{target, revision, workspaceKind, phase, primaryAction}`。
2. 新旧 renderer 的命令参数、幂等键、OCC 结果、账本与最终对象一致。
3. Workbench 不再承载完整结果编辑器，只保留摘要和 Result Center 入口。
4. ContentPackage detail 不再拥有与 Result Center 平行的主动采用、AI 调整、重生成和交付命令；legacy fallback 有明确计数和退出策略。
5. 旧 query、稳定对象路径、任务、历史、刷新、通知和设备中继均恢复同一 target/revision。
6. 明确目标不存在时绝不回落最新结果。
7. 浏览器返回恢复筛选、滚动、触发点焦点和未提交编辑。
8. 320px、390px、横屏和 200% 缩放无根页面横向溢出；移动只显示一个 primary 与“更多”。
9. 页面只有一个主标题、主区域和聚合 live region；弹层关闭后焦点回触发器。
10. 完成一次无需部署、无需数据回滚的 renderer 回滚演练。

## 9. 当前代码事实与实现边界

- `/dashboard` 当前按 viewport 分叉为 `UnifiedCreationWorkbench` 与 `MobileActionBook`，并存在不同的结果状态机。
- `/dashboard/content/$contentId` 当前继续挂载完整 `ContentLibrarySurface`，不是轻量 focused detail。
- `ContentPackageDetail` 当前同时承载编辑、版本、导出、批准、交付、重试、复用和回滚，不能一次性删除。
- Workbench、Mobile ActionBook 和 ContentPackage detail 已有的 Harness、CopyCandidateSelector、CanonicalMediaGallery、VideoWorkflow、版本/OCC、导出和交付能力优先复用，但必须通过共享 adapter 收敛。

因此，D-089 是渐进 UI/路由迁移，不是数据搬迁项目，也不代表上述目标能力已经实现。
