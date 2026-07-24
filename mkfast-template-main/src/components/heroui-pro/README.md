# HeroUI Pro V3 组件供给层（D-130）

前端组件基准＝**HeroUI Pro V3（Glass 主题）**。本目录是它进入 `@meiye/web` 的
唯一入口：REBUILD／NEW 面从这里取组件，KEEP 桶不为换库专项迁移（触碰时换）。

- 视觉权威仍是仓库根 `DESIGN.md`。组件一律经 `theme/design-token-bridge.css`
  适配后接入，**不得用 HeroUI 默认视觉直出**。
- 授权镜像 `references/repos/herouipro-v3/` 是用户专属授权物：**gitignored、
  永不入库、永不再分发**。`scripts/uiux/heroui-mirror-guard.mjs`（挂在
  `pnpm check`）在 CI 断言这条纪律。

## 目录

| 路径 | 属性 | 说明 |
| --- | --- | --- |
| `index.ts` | 手写 | 唯一 import 面。消费方写 `@/components/heroui-pro`，不深引 `vendor/*`。 |
| `components.json` | 手写 | 版本钉扎 + 需要哪些组件。改这里再跑 sync。 |
| `vendor-patches.json` | 手写 | 对拷入源码的全部改写声明（见下）。 |
| `theme/design-token-bridge.css` | 手写 | DESIGN.md 门店橱窗 → HeroUI v3 token 适配层。 |
| `heroui-glass.css` | 手写 | 页面级样式入口（HeroUI 基座 + Glass + 桥）。 |
| `vendor/` | **生成物** | 由 sync 整棵重写，不要手改。 |
| `vendor/MIRROR.json` | 生成物 | 版本、镜像 commit、单元清单、逐文件 sha256。 |

## 拷贝流程

镜像不在 git 里，所以它只存在于持有授权的机器上（Orca 各 worktree 通常也没有，
需用 `HEROUI_PRO_MIRROR` 指过去）。

```bash
# 1. 把镜像切到 components.json 里钉扎的 ref
git -C references/repos/herouipro-v3 checkout 0358aeb

# 2. 同步（默认读 <repo>/references/repos/herouipro-v3）
pnpm --filter @meiye/web heroui:sync

# 2'. 镜像在别处（例如 Orca 子 worktree）
HEROUI_PRO_MIRROR=/path/to/herouipro-v3 pnpm --filter @meiye/web heroui:sync

# 3. 验证
pnpm --filter @meiye/web typecheck
pnpm --filter @meiye/web test
```

sync 做四件事：

1. **校验钉扎**——镜像 `package.json` 的 name/version 必须等于
   `components.json` 的 `package`/`version`，否则直接失败。
2. **解闭包**——从 `components` 列出的组件出发，跟着源码里的 `../` 相对
   import 递归拉全（`sidebar` → `sheet` + `icons` + 三个 utils），保持镜像原有
   目录布局，所以拷进来的相对 import 不用改写就能解析。
3. **按需拷 CSS**——只取拷进来的组件对应的 `src/css/components/<name>.css`，
   加上 `themes/glass/index.css`。**Brutalism / Mouve 不拷、不启用**（D-130）。
4. **应用声明式补丁**——见下一节——并写出 `vendor/MIRROR.json`。

### 升级＝重拉指定版本

改 `components.json` 的 `version` + `mirrorCommit`，把镜像切到那个 ref，重跑
sync。`vendor/` 整棵重建，**不做增量合并**，所以本地手改会被无声冲掉——任何要
长期存在的改动都必须走 `vendor-patches.json`。

### `vendor-patches.json`

拷入的源码要过本 app 的编译口径（`noUnusedLocals` / `noUnusedParameters`），
而上游有几处未使用符号。每条补丁声明 `file`／`reason`／`find`／`replace`，
sync 时**必须恰好命中一次**，否则整个 sync 失败——升级时这个失败就是「上游是不是
已经自己修了」的信号。补丁只满足编译口径，不改任何组件行为。

## 页面怎么用

```tsx
import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { Widget } from '@/components/heroui-pro';

export const Route = createFileRoute('/...')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
  component: Page,
});

function Page() {
  // token 桥挂在 `html:has(.meiye-heroui-glass)` 上，所以壳元素必须带这个 class
  return <div className="meiye-heroui-glass">…</div>;
}
```

`heroui-glass.css` 走**路由级 `<link>`**，不进 `src/styles.css`：

- HeroUI v3 的 `--background` / `--foreground` / `--border` / `--radius` 与本 app
  现存的 shadcn 同名 token 冲突，全局引入会掀翻所有既有页面；
- 初始 CSS 包（`scripts/uiux/bundle-budget.mjs` 量的 `styles-*.css`）不受影响。

留给换壳票的两件事（本 spike 不做）：

1. 这张样式表现在带了**第二份 Tailwind**（`@heroui/styles/css` 自己 `@import
   "tailwindcss"`），产物 ~733KB 未压缩。全站铺开时要合进主 Tailwind root，或
   只引用到的组件 CSS。
2. token 桥用 `:has()` 收在壳子树内，**portal 出去的浮层**（modal/popover/
   tooltip 挂在 `document.body`）拿不到。全站铺开时把 class 提到 `<html>`。

## 脚手架

`/heroui-spike/chat`（template-chat 起点＝工作区交互页）与
`/heroui-spike/dashboard`（template-dashboard 起点＝运营后台）是空壳路由，
production 构建下整段 404，不挂任何现有 IA、不接后端。双主题走查证据见
`.scratch/heroui-glass-spike-2026-07-25/`。
