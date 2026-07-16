# CreatOK 架构推断报告

研究日期：2026-07-07
方法：复用本机登录态（opencli session `creatok`）对 `https://www.creatok.ai/app/dashboard` 做只读实探（未触发任何生成任务、未消耗额度），叠加本地已存证据（`references/creatok/network/*.json`、`raw/*.html`、`notes/technical-surface.md`）。证据分级：**已确认** = 本次实探或已存捕获直接证明；**推测** = 间接证据合理推断；**未确认** = 无证据。

## 0. 结论速览

CreatOK 是一个 **Vercel 上的 Next.js 全栈单体**：一个部署单元承载营销站 + App + 全部 API（Route Handlers），Better Auth 管认证与组织，对象存储用字节火山引擎 TOS（全球加速域），异步生成任务走"提交 + 状态轮询 + resume"，模型层聚合多家第三方，credits 账本做商业化。**没有独立 agent runtime、没有微服务拆分、没有 agent 框架痕迹。**

| 层 | 判断 | 级别 |
|---|---|---|
| 前端框架 | Next.js **16.2.9** App Router（RSC）+ Turbopack + React + Tailwind + Radix/shadcn 风格组件 + Lucide | 已确认 |
| 托管 | **Vercel**（`server: Vercel`、`x-vercel-id: sfo1::iad1::…`、`dpl_` 部署 ID、Vercel Analytics）；计算区域 **iad1（美东）** | 已确认 |
| API 形态 | 同域 Next.js Route Handlers：`/api/*` + `/app/api/*`（`x-matched-path` 证实无独立 API 网关/域名）；统一信封 `{code, msg, data}`，`code=0` 成功，业务错误码分段（30001-30011 额度/配额） | 已确认 |
| 认证 | **Better Auth**（cookie `better-auth.last_used_login_method`；get-session 载荷含 admin 插件字段 banned/banReason/banExpires/impersonatedBy + organization 插件 activeOrganizationId）；Google 登录（GIS）；Cloudflare Turnstile 人机验证 | 已确认 |
| 对象存储 | **火山引擎 TOS**，bucket `creatok`，**传输加速域** `creatok.tos-accelerate.volces.com`（本次实探页面资源直连该域；上传走 presigned PUT，`tosClientType:"accelerate"`） | 已确认 |
| 异步任务 | 提交（submit）→ 状态机 draft/pending/queued/processing/running/downloading/completed/failed/cancelled → **前端轮询**（含 success-rate 轮询、image resume 端点）；dashboard 无 WebSocket/SSE 资源，bundle 无 EventSource/socket.io/pusher 痕迹 | 已确认（轮询）/ 推测（无推送通道） |
| Agent/向导 | **自研 REST 状态机**：`/prompts/wizard/next-question → refine → generate/advance`、image skill 的 analyze-reference/next-question/generate——服务端驱动的分步向导；bundle 中 **零** LangChain/Mastra/tRPC/@ai-sdk UI 签名 | 已确认（端点形态）/ 推测（无框架） |
| 模型层 | 聚合第三方：Sora 2 系、Veo 3.1 系、Kling 3、Seedance 1.5/2 系、Doubao/Seedream、GPT Image 2、Nano Banana、Gemini 等；按 模型×分辨率×时长 的 credit 定价表；bundle 引用 keyapi.ai（聚合商/密钥管理，具体路由未确认） | 已确认（前端配置）/ 未确认（服务端路由） |
| 商业化 | credits 双账本（user/org）、月度重置、每日免费额度、存储配额；套餐 free/basic/pro/ultra（6/150/1000/5000 月度积分）；支付回跳参数含 provider/paymentId/subscriptionId（多 provider 设计，具体支付商未确认——已存页面未加载 stripe.js/creem/paddle） | 已确认 / 支付商未确认 |
| 数据库 | 无任何泄漏（bundle 中 neon/prisma/drizzle/supabase/redis 全为营销文案误命中）。Better Auth + Vercel 常规搭配是托管 Postgres | 未确认（推测 Postgres） |
| 观测/增长 | Vercel Analytics + GA/Google Ads + Meta Pixel + 百度统计（中国+海外双市场投放）+ `mpc2-prod-*.a.run.app`（Google Cloud Run 上的事件采集，推测 Mixpanel 代理）；静态媒体 CDN `static.echotik.live`（EchoSell/EchoTik 系） | 已确认（存在）/ 推测（用途） |

## 1. 本次实探新增的关键证据

1. `window.next.version = "16.2.9"`；无 `#__next` 根节点 + `self.__next_f` → App Router/RSC。
2. 文档与三个 API 的响应头（同源 fetch 读取）：`server: Vercel`、`x-powered-by: Next.js`、`x-vercel-id: sfo1::iad1::…`（边缘 POP 旧金山，函数区域美东 iad1）、`x-matched-path` 与路由一一对应 → **API 与页面同一 Vercel 项目**，无独立后端域。
3. Cookie 名单直接坐实 Better Auth（`better-auth.last_used_login_method`）；另有 `NEXT_LOCALE`、`creatok:user-preferences:selected-model`、`sidebar_state`、`g_state`、`_fbp`、`AGL_USER_ID`。
4. 页面资源 origin 列表出现 `creatok.tos-accelerate.volces.com` → 生产素材直出火山 TOS 加速域（此前只推测）。
5. `/app/api/plan` 实际载荷：`{ledger:"user", plan:"free", limit:6, remaining:…, resetInterval:"monthly", nextResetAt…}` → credits 账本字段与 notes 推断一致。
6. `/api/public/version` 返回 `26750f9f3d77`（形如 git SHA 的版本号）。

## 2. 架构画像（推断图）

```text
用户（全球 + 中国）
  → Vercel Edge（sfo1 等 POP）
    → Next.js 16 App（单体，iad1 serverless functions）
        ├─ 营销页 / 多语言 locale routes（RSC + Turbopack）
        ├─ /api/auth/*          Better Auth（+admin +organization 插件，Google 登录，Turnstile）
        ├─ /app/api/*           业务 REST（code/msg/data 信封）
        │    ├─ plan / organizations/plans     credits 账本
        │    ├─ ai-tasks/*/submit|resume       生成任务（状态机+轮询）
        │    ├─ prompts/wizard/*、image skill  自研分步向导（服务端状态机）
        │    ├─ assets / asset-groups / products  资产与商品域
        │    └─ upload/*/presigned             预签名直传
        ├─ 数据库（未确认，推测托管 Postgres）
        └─ 第三方模型 API（Sora/Veo/Kling/Seedance/Doubao/GPT-Image…，服务端持 key）
对象存储：火山引擎 TOS bucket "creatok"（tos-accelerate 全球加速域，浏览器 presigned PUT 直传 + 直读）
静态媒体 CDN：static.echotik.live
增长/埋点：Vercel Analytics + GA/Ads + Meta Pixel + 百度统计 + Cloud Run 事件采集
```

## 3. 值得注意的工程取舍（对照我方）

1. **单体到底**：营销站、App、全部 API、任务提交全在一个 Vercel 项目里，靠 route 目录分层，不靠服务拆分。一个面向全球+中国、带多模型视频生成的商业化产品，没拆微服务、没独立 agent runtime。
2. **中国用户体验的解法是"存储选国内厂商的全球加速"而不是"计算搬回国内"**：计算在美东 Vercel，媒体大文件走火山 TOS accelerate（字节系，境内外都快）+ 百度统计做国内投放归因。网页本身对大陆的可达性依赖 Vercel 边缘（未做国内合规部署——它是境外主体服务跨境电商卖家，监管姿态与我们不同，不能直接照抄这一点）。
3. **长任务不用 durable agent/推送**：提交 + 客户端轮询 + resume 端点 + 失败补偿（credits refund 错误码），体验足够。与我方 durable_jobs 设计同构。
4. **"Agent" 是产品叙事，不是运行时**：wizard 类端点是服务端驱动的分步 REST 状态机；没有任何 agent 框架签名。发货的竞品用"朴素 REST + 自研编排"支撑了 Agent 卖点。
5. **Better Auth（含 organization/admin 插件）在生产 SaaS 被验证**，与 mkfast-template 同款底座。

## 4. 未确认清单（后续可补证的方式）

- 数据库/队列具体选型：无非侵入式取证手段，除非官方披露或招聘 JD 泄漏。
- 支付 provider：走一次 checkout 页面（不下单）可见加载的支付 SDK。
- 模型服务端路由（自持 key vs keyapi 聚合）：不可从前端取证。
- Agent 对话的流式传输方式（fetch ReadableStream vs 轮询）：需实际发送一条消息观察（会消耗额度，未执行）。
