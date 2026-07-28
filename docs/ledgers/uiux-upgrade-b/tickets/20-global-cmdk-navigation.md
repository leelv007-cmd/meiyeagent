# 票 20 · ⌘K 全局化 + 「导航/添加到创作」双组
> 阶段: Phase 4 · 开场与骨架 ｜ 差距: P1-6 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "20",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-6"
  ],
  "contractIds": [
    "I10"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P1-6 已核实：当前 `⌘K` 只在已建 Work 后挂载的 `CreationShelf` 内生效；空态、跳过态和其他一级页按下无反应，不是全局命令入口。
- 当前 palette 的模板、工具、Asset 与 Work 都是「带入」语义，却只显示笼统的「正式目录」；没有可跳转 Task / Session / Job / 一级页的「导航」组，用户无法在「打开对象」与「改变当前创作」之间做出明确预期。
- 目标体验：`/dashboard/*` ProductShell 下任意页均可打开同一 palette，固定分为「导航」与「添加到创作」；货架、palette、参考解构台对同一目录对象的名称、状态和可用性保持一致。
- 范围界定：本票的「全局」指已登录业务外壳 `/dashboard/*`，不把营销页、登录页、Settings 或 Admin 扩成新的命令面。
- 决策边界：不改 D3「对话式外壳 + 结构化内核」，不新建 chat clone；不重开 D4 3 选 1；不恢复 L-1 贴链接抓取；不引入模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/creation-shelf.tsx:110-137`：`CreationShelf` 同时拥有货架 UI、palette 状态、模板目录与历史查询；全局生命周期不应再寄生于此局部区块。
- `mkfast-template-main/src/product/creation-shelf.tsx:175-184`：`window.keydown` 监听器仍在 `CreationShelf` 内；报告锚点未漂移。
- `mkfast-template-main/src/product/creation-shelf.tsx:192-246`：模板、工具、Asset / Work 参考已汇总为 `catalogEntries`，货架、palette 与解构台当前可复用这一投影。
- `mkfast-template-main/src/product/creation-shelf.tsx:248-260`：工具选择只切换 operation，参考对象走 `onInsertReference`，随后关闭面板；本票需把「选择」与「可执行」的用户可见结果说清。
- `mkfast-template-main/src/product/creation-shelf.tsx:295-304`：货架内「添加到创作 ⌘K」按钮是目前唯一可发现入口，改造后应保留但改为打开全局 palette。
- `mkfast-template-main/src/product/creation-shelf.tsx:455-490`：`CommandDialog` 标题为「添加到创作」，仅有 `CommandGroup heading="正式目录"`，无「导航」组；报告的单组判断仍准确。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:481-688,743-750`：空态、跳过态均不渲染货架；`CreationShelf` 仍只在已建 Work 的 Reuse 段 `:744` 挂载，报告行号未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:287-298,418-445`：operation / 模型 / 规格变化会清除已接受报价；参考带入会派生新 Work 版本并防重，可作为 palette 的唯一正式接线。
- `mkfast-template-main/src/components/layout/sidebar-layout.tsx:53-89,97-103`：`ProductShellPage` 包裹所有 `/dashboard/*` Outlet，是唯一合理的全局挂载点。
- `mkfast-template-main/src/lib/uiux/navigation.ts:4-11`：`BUSINESS_NAVIGATION` 已是六个业务一级页的单一导航源；palette 不得复制第二份一级页字典。
- `mkfast-template-main/src/product/canonical-history-model.ts:33-71,94-178`：`canonical_history` 已含 Task / Session / Job / Work / Asset，且已映射稳定深链；导航组无需新建后端搜索模型。

## 改造方案（步骤级 + 涉及文件清单）

1. 把 palette 的 open state、快捷键监听、目录查询与待带入动作提升到 `ProductShellPage`。在 `/dashboard/*` 只挂载一个 dialog/监听器，并从 `CreationShelf` 移除局部监听与重复 dialog。
2. 将面板固定分为两组：「导航」直接复用 `BUSINESS_NAVIGATION`，并从 `canonicalHistoryItems` 取 Task / Session / Job 的标题、状态与深链；「添加到创作」只放 Asset / Work / 模板 / 工具。每项显示「打开」或「添加」动作词，不再用「正式目录」混合语义。
3. 货架、palette、参考解构台消费同一份 `catalogEntries` 投影；保留官方/我的、快捷位、版本和无结果语义，不复制对象或建第二套目录。
4. 导航项一律走现有内部路由，选择后关闭 dialog 并进入 canonical 页；Task / Session / Job 不得被当作参考带入。
5. 从其他 `/dashboard/*` 页选「添加到创作」时，保留该一次待办并回到工作台：有当前 Work 时显式带入并回显在引用或 operation 区；无 Work 时在开场卡中显示待带入项，由用户先显式「建立创作记录」。路由切换、空态或加载不得造成静默丢失或重复带入。
6. 带入前用当前 Work、operation 与模型目录校验执行合同兼容性：不兼容项保留可见但禁用，原位说明需补的素材/模型/规格；切换工具后清除旧报价确认，不自动执行、不建 Job、不跨品牌静默换模。
7. 保留 `Esc` 关闭、焦点返回触发位、方向键浏览与 `Ctrl+K` 等价入口；即使焦点在空态 Textarea，快捷键也必须打开面板。
8. 扩展现有浏览器用例，覆盖空态/非工作台开启、导航深链、跨页带入、不兼容禁用原因、无 Job 副作用和两组目录一致性；自动化只作回归旁证。

涉及文件（均为当前已存在路径）：

- `mkfast-template-main/src/product/creation-shelf.tsx`：单一目录投影、全局 palette/provider、双组呈现与货架/解构台复用。
- `mkfast-template-main/src/components/layout/sidebar-layout.tsx`：在 `ProductShellPage` 挂载唯一 palette，覆盖所有 `/dashboard/*` Outlet。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx`：消费跨页待带入动作，接回既有引用派生、operation、报价重确认与空态显式建 Work 流。
- 复用而默认不改：`mkfast-template-main/src/lib/uiux/navigation.ts`、`mkfast-template-main/src/product/canonical-history-model.ts`，分别提供一级页单一来源与 canonical 对象深链。
- `mkfast-template-main/tests/e2e/specs/uiux-shell-routes.spec.ts`：非工作台页全局开启与导航深链旁证。
- `mkfast-template-main/tests/e2e/specs/uiux-operations-reuse.spec.ts`：同一目录、带入不执行与跨页回流旁证。
- `mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`：空态暂存项在用户显式建 Work 后可见落位的旁证。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 用户在工作台空态、已建 Work、内容任务、资产库、内容库、线索台账或门店档案任一 `/dashboard/*` 页按 `⌘K` 都能打开同一命令面板；焦点在输入框时也不失效。
- 面板首屏明确出现「导航」与「添加到创作」两个分组；每个结果可从动作词和组别判断是「打开」还是「添加」，不再只看到混合的「正式目录」。
- 用户搜索并选择一级页或 Task / Session / Job 后，面板关闭并进入对应页/对象；当前 Work 的引用、operation 和 Job 数量不变。
- 用户从资产库等非工作台页选择可用 Asset / Work / 模板 / 工具后，会回到工作台并看到该项已进入引用或操作选择；不会因路由切换丢失、重复添加或自动创建 Job。
- 空工作区中选择「添加到创作」项后，开场卡明确显示待带入对象；只有用户确认意图并点击「建立创作记录」后才落入 Work，不静默建 Work。
- 不兼容项仍可被搜索到，但呈现明确禁用态和可理解原因；用户不会看到模型被跨品牌静默替换，切换工具后必须重新确认页面上的执行报价。
- 货架、`⌘K` 和参考解构台中同一对象的名称、归属、版本、快捷位和可用状态一致；用户更新快捷位后，重新打开面板可立即看到新结果。
- 用户可用 `Esc` 关闭面板并回到原触发位，可用方向键选项；Windows/Linux 使用者可用 `Ctrl+K` 完成同等操作。
- 截图对照：以相同 `1440×900` 桌面视口并列「升级后当前产品双组 palette 打开态」与已有 CreatOK 登录态对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/17-tools-menu-desktop-live.jpg`、`.scratch/creatok-uiux-wayfinding/assets/screenshots/08-assets-desktop-live.jpg`，标注工具发现、资产入口、导航/添加动作的层级与可辨识性；不得把对标图误述为 CreatOK 原生也有 `⌘K` 双组。

## Blocked-by / Blocks

- Blocked-by：无实现前置；但按 MAP 全局规则，票 02 完成前本票不得关票。
- Blocks：MAP 未登记下游阻断票；本票完成后作为 Path B Exit milestone 的 P1-6 用户可见证据。
- 边界协同：票 12/13/14/15 改变 Composer 或目录卡片形态时，仍必须消费本票同一目录与兼容性结果；本票不代做其 UI 改造。

## 风险与回退

- 风险：外壳与货架各留一个监听器/dialog，造成重复开启、焦点争抢或查询翻倍。控制：ProductShell 只挂一份，货架按钮只调用全局 open action；回退时整体撤回外壳挂载，不保留双实现。
- 风险：跨页待带入动作在路由切换/重渲染中丢失或重放。控制：待办带稳定对象 key，只在工作台回显后一次性消费；异常时保留可见待办与重试，不自动重放命令。
- 风险：为让项目「看起来可用」而静默换模、复用旧报价或直接建 Job。控制：不兼容即停在可见阻断态，工具/规格变更必须重确认合同；回退为只导航、暂停带入，不放宽合同。
- 风险：canonical 对象较多时首屏被历史记录淹没。控制：一级页固定靠前，Task / Session / Job 按最近更新排序并由搜索展开；不向空结果注入 fixture 或无关工具。
- 回退：若全局带入存在阻断级问题，可暂时将「添加到创作」项标记为不可用并给出回到工作台的明确提示；「导航」组和全局快捷键继续可用。不删除 canonical 对象、不改后端事实、不恢复局部双 dialog。
