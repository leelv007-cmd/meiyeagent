# 票 25 · 移动触区/根字号集中改造 + 中文字体栈补齐
> 阶段: Phase 5 · 一致性与视觉收尾 ｜ 差距: P1-12、P2-5 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "25",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-12",
    "P2-5"
  ],
  "contractIds": [
    "I12"
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

- P1-12 已部分核实：Button/Input/Select 默认高度仍为 32px，移动路径靠页面内 `min-h-11` 逐点补到 44px；真实差距是“集中规则缺失 + 44px 未达承诺的 48px + 18–20px 根字号未落地”，不得重写成“移动端普遍只有 32px、主 CTA 不可用”。
- 报告建议 P1-12 降为 P2：现有 44px 补偿已达 WCAG AA，本票是一致性和 AAA 承诺收口，不是阻断性故障修复。
- P2-5 是 P2 表第 5 项，且已部分核实：产品壳已使用本地系统栈，中文界面零字体下载已兑现；唯一差距是 HarmonyOS Sans、MiSans 两档 fallback 缺失，不得引入 webfont 或把 Bricolage 重新定性为中文加载问题。
- ADR-0010 要求路径 B 以用户可见行为和对标产品逐屏截图验收；修改 token、默认变体或通过工程检查均不能单独关票。
- 范围守卫：D3 仍是“对话式外壳 + 结构化内核”，不做 chat clone；D4 仍是 3 选 1 单选；不恢复已 de-scope 的 L-1 贴链接抓取；不新增图片/视频模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

| 入口 | 当前事实 |
| --- | --- |
| Button 默认触区 | `mkfast-template-main/src/components/ui/button.tsx:6-39` 定义全部变体；`:23-33` 仍为 default `h-8`、sm `h-7`、lg `h-9`、icon `size-8`。报告的 `:23-27` 未漂移，但只覆盖到 lg，icon 变体延伸至 `:33`。 |
| Input 默认触区 | `mkfast-template-main/src/components/ui/input.tsx:6-17` 为唯一实现，`:12` 仍固定 `h-8`，未消费集中触区 token。 |
| Select 默认触区 | `mkfast-template-main/src/components/ui/select.tsx:31-57` 的 trigger 在 `:44` 仍为 default `h-8` / sm `h-7`，未消费集中触区 token。 |
| 根字号/主题入口 | `mkfast-template-main/src/styles.css:78-82` 已有 `@theme inline` 字体 token；`:164-172` 的 body/html 只设字体，无 18–20px 根字号。 |
| 产品壳字体栈 | `mkfast-template-main/src/styles.css:176-212` 定义 `.meiye-product-shell`；`:209-211` 仍是 `Inter / PingFang SC / Microsoft YaHei / ui-sans-serif / system-ui / sans-serif`，报告行号未漂移，缺 HarmonyOS Sans、MiSans。 |
| 移动行动簿补偿 | `mkfast-template-main/src/product/mobile-action-book.tsx:487-902` 当前有 15 处 `min-h-11`，覆盖 Tabs、Button 及链接；这是 44px 页内补偿，不是集中规则。 |
| 移动桌面接力补偿 | `mkfast-template-main/src/components/layout/desktop-relay-page.tsx:43-62` 的按钮与链接分别在 `:45` / `:56` 使用 `min-h-11`。 |
| “19 处”口径校正 | 全 `mkfast-template-main` 实扫仍有 19 处 `min-h-11`：上述 15+2 处，另有 `mkfast-template-main/src/product/unified-creation-workbench.tsx:877-894` 的 2 个桌面 Switch 行容器；后两者不得冒充移动按钮。 |
| 产品壳挂载 | `mkfast-template-main/src/routes/dashboard.tsx:14-23` 和 `src/components/layout/sidebar-layout.tsx:49-60` 均挂 `.meiye-product-shell`；`src/routes/dashboard/index.tsx:30-40` 在移动端分流到 `MobileActionBook`。 |

## 改造方案（步骤级 + 涉及文件清单）

1. 在 `styles.css` 的现有 `@theme inline` 建立单一 48px 触区 token，并在现有 `@layer base` 的 `html` 入口将根字号明确为区间下限 18px；触区使用固定 px 与根字号解耦，不使用 `h-12` rem 在 18px 根字号下意外膨胀为 54px。
2. 让 Button default/lg/icon、Input default、SelectTrigger default 共用该 token；对 xs/sm 等紧凑视觉变体，保留图形尺寸但在移动粗指针场景提供 48px 可点区，避免小图标被放成大图标。
3. 将 `mobile-action-book.tsx` 与 `desktop-relay-page.tsx` 的 17 处移动 `min-h-11` 收口到同一 48px token；能由基础组件覆盖的删除页内补丁，Tabs/链接等非三类基础组件则显式消费 token。
4. 将 `unified-creation-workbench.tsx:877-894` 两个 44px 行容器改为同 token，仅做尺寸一致性收口；不借机改 Switch 含义、报价确认流或 D4 候选逻辑。
5. 在 `.meiye-product-shell` 现有本地栈中，于 PingFang SC 之前依次加入 `HarmonyOS Sans`、`MiSans`；保留 Inter 西文、PingFang SC、Microsoft YaHei 和系统兜底，不加 `@font-face`、字体资产或网络请求。
6. 在 379×820 与 390×844 移动视口走通行动→进度→交接，并复验桌面工作台/设置页；只对真实截断、重叠、滚动或密度回归做局部修正，不顺手重排页面。

涉及文件（均为当前已存在路径）：

- 集中 token / 根字号 / 字体栈：`mkfast-template-main/src/styles.css`。
- 基础控件：`mkfast-template-main/src/components/ui/button.tsx`、`src/components/ui/input.tsx`、`src/components/ui/select.tsx`。
- 现有 44px 补偿收口：`mkfast-template-main/src/product/mobile-action-book.tsx`、`src/components/layout/desktop-relay-page.tsx`、`src/product/unified-creation-workbench.tsx`。
- 只作路由/壳层回归核对，默认不改：`mkfast-template-main/src/routes/dashboard.tsx`、`src/routes/dashboard/index.tsx`、`src/components/layout/sidebar-layout.tsx`。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在 379×820 与 390×844 视口进入移动行动簿，阶段 Tab、拍摄/相册入口、主次 CTA、恢复与交接链接的可点高度均不低于 48px，纯图标操作的命中区不小于 48×48px；连续点按相邻操作不误触。
- 移动端中文正文以 18px 基线清晰呈现，无需手势缩放即可读；标题、状态、辅助文案的层级仍可辨，不出现文字覆盖按钮、单字竖排或固定底栏挡住主操作。
- 根字号放大后，商家仍能在移动端完整走通“行动→进度→交接”，在桌面端完成一句话开工和 Composer 提交；输入、下拉、弹层、导航与焦点环不被裁切或挤出视口。
- 在已安装 HarmonyOS Sans 或 MiSans 的鸿蒙/小米设备上，中文直接使用本机字体；其他设备稳定回退 PingFang SC / Microsoft YaHei / system-ui，首屏无字体下载等待、闪烁或中文缺字。
- 浅色/深色、默认/禁用/焦点态下，放大后的 Button、Input、Select 与移动链接仍有完整边界、文字和焦点指示；不得以透明空白撑高而让可见内容仍难点。
- 截图对照：以现有当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/22-dashboard-mobile-live.jpg` 、对标 CreatOK `.scratch/creatok-uiux-wayfinding/assets/screenshots/11-dashboard-mobile-live.jpg` 与升级后 390×844 同路由截图做三联图；标注主按钮/Tab/导航的触区和正文字号，升级后须肉眼可见地比旧基线更易读、更易点，且不低于对标的移动操作密度。
- 另附升级后移动端行动/进度/交接三阶段和桌面 Composer 的真实运行截图；代码 diff、token 表、尺寸扫描或工程检查结果只能作旁证，不能替代以上用户可见验收。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：票 02 完成前，本票不得关票；票 02 完成后，仍须将 P1-12/P2-5 体验合同 required 条目与本票逐屏证据验绿。
- Blocks：无 MAP 明示下游票；本票的移动截图是 Path B Exit milestone “含移动端逐屏对照”的一部分，不代替其他 required 票。

## 风险与回退

- 风险：18px 根字号会放大 rem 布局，导航、弹层和桌面密度可能溢出。控制：触区用固定 48px token 解耦，按真实截断做局部修正。回退时可单独撤回根字号，保留 48px 触区和字体 fallback。
- 风险：全局 18px 根字号和共享组件默认变体会波及模板营销/管理页。控制：同批复验共享组件的非产品消费者，只对真实溢出做局部修正。若影响无法在本票内安全收口，回退根字号/默认变体并保持本票未完成，不用页面级 44px 补丁冒充交付。
- 风险：简单把 sm/xs/icon 视觉尺寸全改为 48px 会破坏层级和工具栏密度。控制：分离可见图形与命中区；回退为保留图形尺寸、仅恢复 48px 命中区，不回到 32/44px 移动触区。
- 风险：本机未安装 HarmonyOS Sans/MiSans 时无法肉眼区分栈顺序。控制：至少在一台安装对应字体的设备取真实截图，其他设备验证稳定回退。若字形布局异常，回退新 fallback 顺序，不引入远程字体。
