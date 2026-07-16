# CreatOK 技术表面线索

研究日期：2026-07-07

范围：只做观察。我没有提交生成任务，没有点击生成控件，也没有主动调用可见的 `/app/api/*` 生成类接口。使用的来源包括：`references/creatok/raw/homepage.html`、`references/creatok/raw/dashboard-request.html`、`references/creatok/raw/homepage.opencli.md`、`references/creatok/network/` 下已保存的 network preview，以及公开页面引用的 `/_next/static/chunks/*.js` 静态资源的只读 GET。

限制：前端静态包可能包含过期、灰度、登录后才可用或未启用的代码路径。只有 saved network preview 里实际出现过的请求才标为“已确认 network”；其它 endpoint 名称只代表“前端可见”。凡是超出前端证据的后台实现判断，均标为“推测”。

## 框架与构建

- 已确认：CreatOK 是 Next.js App Router 应用。证据包括 `/_next/static/chunks/*`、`self.__next_f.push` 的 React Server Component flight payload、`parallelRouterKey`、`next-size-adjust`，以及 Next.js runtime message。
- 已确认：存在 Turbopack 构建痕迹，包括 `/_next/static/chunks/turbopack-1b610d7rwo44b.js`、`globalThis.TURBOPACK`、`TURBOPACK_ASSET_SUFFIX`、`NEXT_DEPLOYMENT_ID`、`NEXT_CLIENT_ASSET_SUFFIX`。
- 已确认：页面带有 Vercel 风格部署标记，例如 `data-dpl-id="dpl_..."` 和 `?dpl=dpl_...` 查询参数；saved network 也出现 `POST /_vercel/insights/view`。
- 推测：部署或至少前端分发链路使用 Vercel。依据是 `dpl_` 部署 ID、`/_vercel/insights`、Vercel client scripts。
- 已确认：前端是 React；样式里大量 Tailwind 风格 utility class；bundle 中可见 Lucide icons 与 Radix UI primitives。具体设计系统层是推测，但组件形态接近 shadcn/Radix 风格。
- 已确认：应用有多语言/i18n。公开 locale route 包括 `/zh`、`/zh-TW`、`/ja`、`/id`、`/es`，静态 payload 中也包含大量翻译字典。
- 推测：认证/组织能力基于 Better Auth 或类似 auth organization client。证据是 `authClient.organization.*`、`/api/auth/*` 和 organization 子路径；库名未直接确认。

## 已保存 network 线索

saved network preview 中，dashboard/agent 页面加载时已确认以下请求：

- `GET https://www.creatok.ai/api/auth/get-session` -> 200
- `GET https://www.creatok.ai/api/public/version` -> 200
- `GET https://www.creatok.ai/app/api/plan` -> 200
- `GET https://www.creatok.ai/app/api/agent/sessions?` -> 200
- `GET https://www.creatok.ai/app/api/organizations/plans` -> 200
- `GET https://www.creatok.ai/api/auth/organization/list` -> 200
- `POST https://www.creatok.ai/_vercel/insights/view` -> 200
- 第三方 pageview/event 请求到 Facebook，以及 `mpc2-prod-21-is5qnl632q-uc.a.run.app/events?cee=no`。

## API 路径形态

- 已确认：客户端定义了 `useAppApi` wrapper，base prefix 是 `"/app/api"`。调用方传入 `/assets`、`/upload/image/presigned`、`/ai-tasks/video-generation/submit` 时，运行时会组装成 `/app/api/assets`、`/app/api/upload/image/presigned` 等；也支持 `skipPrefix` 跳过前缀。
- 已确认：app API 预期返回 JSON，结构为 `code`、`msg`、`data`；成功 code 是 `0`。
- 已确认：wrapper 会自动补 `Content-Type: application/json`，除非 body 是 `FormData`。

前端可见 API 名称：

- 认证/组织：`/api/auth`、`/api/auth/get-session`、`/api/auth/organization/list`，以及 organization client path，如 `/organization/list`、`/organization/create`、`/organization/set-active`、`/organization/get-full-organization`、`/organization/update-member-role`。
- 套餐/积分：`/app/api/plan`、`/app/api/organizations/plans`。
- 公开版本/联盟归因：`/api/public/version`、`/api/affiliate-code/resolve?code=...`。
- Prompt 工具：`/app/api/prompts/optimization`、`/app/api/prompts/convert`、`/app/api/prompts/storyboard/parse`、`/app/api/prompts/wizard/suggestions`、`/app/api/prompts/wizard/auto-detect`、`/app/api/prompts/wizard/generate`、`/app/api/prompts/wizard/generate/advance`、`/app/api/prompts/wizard/next-question`、`/app/api/prompts/wizard/refine`。
- 图片 skill workflow：`/app/api/image-generator/skill/templates`、`/app/api/image-generator/skill/analyze-reference`、`/app/api/image-generator/skill/next-question`、`/app/api/image-generator/skill/generate`。
- 生成任务名称：`/app/api/ai-tasks/image-generation/submit`、`/app/api/ai-tasks/image-generation/resume`，以及会通过 wrapper 加前缀的相对路径 `/ai-tasks/image-generation/submit`、`/ai-tasks/video-generation/submit`、`/ai-tasks/batch`。
- 素材/商品：`/assets`、`/assets/:id`、`/assets/recycle`、`/asset-groups`、`/asset-groups/:id/assets`、`/asset-groups/:id/assets/:assetId`、`/products`、`/products/:id`、`/products/parse-url`。
- 上传/媒体：`/upload/image/presigned`、`/upload/video/presigned`、`/flow/upload/presigned`、`/api/proxy/video`。
- 其它可见名称：`/images/edit`、`/preset-prompts`、`/app/api/ai-video-generator/success-rate`。

## 生成与模型线索

- 已确认：视频提交代码通过 app API wrapper 调用 `/ai-tasks/video-generation/submit`。提交前会校验模型是否支持 reference images、reference videos、first frame、end frame、edit mode、duration、resolution、aspect ratio。
- 已确认：任务状态包括 `draft`、`pending`、`queued`、`processing`、`running`、`downloading`、`completed`、`failed`、`cancelled`。
- 已确认：图片生成提交常量包括 `IMAGE_TASK_SUBMIT_URL="/app/api/ai-tasks/image-generation/submit"` 与 `IMAGE_TASK_RESUME_URL="/app/api/ai-tasks/image-generation/resume"`。
- 已确认：前端模型配置中可见 Sora 2、Sora 2 Exp、Sora 2 Pro、Veo 3.1 系列、Kling 3、Kling 3 Omni、Seedance 1.5 Pro、Seedance 2、Seedance 2 Fast、Seedance 2 Mini、Gemini Omni Flash Exp、HappyHorse、Nano Banana 系列、GPT Image 2、Doubao/Seedream 模型。
- 推测：Grok Video 与 Wan 模型配置也存在于前端代码，但可能是灰度或未启用；我只确认看到了前端 label/config 字符串。
- 已确认：前端可见多组按 model/resolution/duration 计费的 credit mapping。`/app/api/ai-video-generator/success-rate` 会被轮询获取模型成功率。

## 上传、媒体与资产

- 已确认：上传链路是先请求 presigned URL，再由浏览器对 `presignedUploadUrl` 发 `PUT`，并带上文件 MIME 的 `Content-Type`，随后通过 `/assets` 创建资产记录。
- 已确认：presigned upload 请求字段包括 `fileName`、`fileType`、`fileSize`、`tosClientType`、`compression`、`prefix`，以及可选 `objectKey`。
- 已确认：前端使用的 presigned response 字段包括 `presignedUploadUrl`、`presignedAccessUrl`、`objectKey`。
- 已确认：图片/视频上传代码中出现 `tosClientType:"accelerate"`。
- 推测：对象存储使用 Volcengine TOS。依据是前端 bundle 包含 TOS SDK namespace/log tag、TOS headers，以及 Volcengine docs URL；但未确认后台 bucket 或 provider。
- 已确认：资产记录字段包括 `assetType`、`objectKey`、`objectSize`、`sourceSystem`、`metadata`、`url`、`thumbnailUrl`、`providerRefs`。
- 已确认：素材来源 filter 中可见 `user_upload`、`ai_tasks`、`sora_generations`。

## 积分、计费与套餐

- 已确认：plan code 包括 `free`、`basic`、`pro`、`ultra`。
- 已确认：前端 monthly credit 常量：Free 6、Basic 150、Pro 1000、Ultra 5000。
- 已确认：前端常量 `DAILY_FREE_CREDIT_LIMIT` 为 20。
- 已确认：credit response 解析字段包括 `limit`、`used`、`remaining`、`canGenerate`、`percentage`、`resetInterval`、`nextResetAt`、`cycleEndAt`、`ledger`、`orgId`、`organization`、`role`。
- 已确认：ledger 可以是 `user` 或 `org`，UI 会展示团队/组织积分。
- 已确认：API error code 中有积分/配额状态：`30001` credits exceeded、`30002` free credit limit exceeded、`30003` model limited、`30004` subscription expired、`30005` storage quota exceeded、`30006` credit limit exceeded、`30010` avatar extra slot payment required、`30011` avatar composition cap reached。
- 已确认：支付回跳 tracking 会读取 `status`、`orgId`、`provider`、`paymentId`、`subscriptionId`、`orderId`、`transactionId`、`amount`、`currency`、`plan`、`itemId`、`itemName` 等 query 参数。

## 关键 route

- 公开/营销：`/`、`/pricing`、`/agent-skills`、`/blog`、`/contact`、`/privacy-policy`、`/terms-of-service`。
- 公开工具/模型页：`/viral-video-cloning`、`/product-link-to-video`、`/video-to-prompt`、`/video-subtitle-remover`、`/video-watermark-remover`、`/video-translator`、`/text-to-speech`、`/voice-cloning`、`/ai-product-photo`、`/ai-image-upscaler`、`/virtual-try-on`、`/multi-angle`、`/background-remover`、`/sora-video-generation`、`/seedance-2`、`/seedance-2-mini`、`/kling-3`、`/gemini-omni`、`/gpt-image-2`、`/happy-horse`、`/nano-banana-ai-image-generator`。
- App route：`/app/dashboard`、`/app/ai-video-generator`、`/app/gallery`、`/app/assets`、`/app/image/generator`、`/app/image/product-listing-aplus`、`/app/platform/tiktok`、`/app/trending`、`/app/agent/:id?new=1`。
- 登录门槛：已有 notes 显示 `/app/ai-video-generator` 与 `/app/workspace/api-keys` 未登录时会跳转 login。

## 第三方服务痕迹

- Vercel Analytics：`/_vercel/insights/view`、`va.vercel-scripts.com`。
- Facebook/Meta Pixel：`connect.facebook.net/en_US/fbevents.js`、`www.facebook.com/tr`、pixel id `1186225440163613`。
- Google Analytics/Ads：`G-BPNTYGRKMJ`、`AW-17889844420`，前端代码里有 purchase/conversion event。
- Baidu analytics：`hm.baidu.com/hm.js?242c8c42e3fc23ce7bb70803955f394e`、`fxgate.baidu.com/angelia/fcagl.js?...`。
- Google Identity Services：`https://accounts.google.com/gsi/client`。
- Cloudflare Turnstile：`https://challenges.cloudflare.com/turnstile/v0/api.js?...`。
- 静态媒体 CDN：`https://static.echotik.live/creatok/...`。
- schema 中链接的公开 GitHub repo：`https://github.com/EchoSell/creatok-skills`。
- 其它可见外部 URL：`https://www.keyapi.ai`、`https://www.volcengine.com/docs/6349/127737`、`https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js`。
- 推测：`mpc2-prod-21-is5qnl632q-uc.a.run.app/events?cee=no` 是第三方事件采集服务；具体 vendor/用途未确认。

## 未确认项

- 未确认生成 endpoint 的 response body、队列行为、provider routing 或实际扣费。
- 未确认后台存储 bucket 名、数据库、队列系统或 server-side 模型 provider 凭据。
- 未新开 dashboard browser session；已保存的 network preview 加公开 static chunks 已覆盖本次技术表面观察目标，且更符合“不触发生成任务、不消耗额度”的约束。
