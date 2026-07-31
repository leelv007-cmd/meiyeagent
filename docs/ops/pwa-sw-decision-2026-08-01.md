# PWA Service Worker 落地决策（#280-1，2026-08-01）

## 选择

**选定方案：同源自托管最小 SW（`public/sw.js`）＋客户端注册，不引入 Serwist/Workbox。**

## 候选与试探顺序

| 顺序 | 方案 | 结论 |
|---|---|---|
| 1 | production build 产出并注册 SW | **采用**。Vite `public/sw.js` 随构建拷入静态资产；`src/pwa/register-service-worker.ts` 在 root shell 挂载时注册 `scope: '/'`。 |
| 2 | Serwist / vite-plugin-serwist 社区解法 | **不采用**。票面范围只要安装可用性（registration＋network-first 透传），Serwist 的预缓存/路由图对 Cloudflare Workers 静态路径与严格 CSP 同源于扰面更大，超范围。 |
| 3 | 仅浏览器引导 fallback、无 SW | 保留为**安装 UI 层**（`beforeinstallprompt`＋iOS Safari 主屏幕指引），**不替代** SW。 |

## 范围红线

- 只做安装可用性：registration + network-first 透传。
- 不做离线数据缓存、推送、后台同步。
- SW 脚本同源自托管（`/sw.js`），不引入外部 CDN。
- CSP 无新增外部 script 源。

## Manifest

- 动态路由 `src/routes/manifest[.]json.ts` 已存在（配置名/描述/主题色）。
- 另补 `public/manifest.json` 静态副本（品牌文案取自既有 `site_name` / `site_description`，图标 `favicon.svg`），保证静态资产路径在非 SSR 静态探测下也 200。

## 验收口径

- `pnpm --filter @meiye/web build` 产物含 `sw.js`。
- 本地 production-candidate / `wrangler dev` 下 `navigator.serviceWorker.getRegistration()` 有 registration。
- `pnpm typecheck` / `pnpm check` / `pnpm test`（web 相关）绿。
- 安装引导：设置面卡片 `data-testid=pwa-install-settings-card`；移动首次轻提示可 dismiss。
