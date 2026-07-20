# CreatOK public site and pricing notes

Research date: 2026-07-07

Scope: CreatOK public website only. I did not log in, did not enter the console/backend, and did not call `/api/*`. Facts below are public-page claims unless marked as an access result or inference.

Method: web search/open for public pages, plus `curl` checks for HTTP status, `robots.txt`, sitemap, and publicly linked GitHub files. No screenshots were saved; this note keeps URL-backed source summaries instead.

## Source and access log

| URL | Access result | Notes |
| --- | --- | --- |
| https://www.creatok.ai/ | 200 | English homepage. |
| https://www.creatok.ai/zh | 200 | Chinese homepage. |
| https://www.creatok.ai/pricing | 200 | English pricing. |
| https://www.creatok.ai/zh/pricing | 200 | Chinese pricing. |
| https://www.creatok.ai/agent-skills | 200 | English agent-skills landing page. |
| https://www.creatok.ai/zh/agent-skills | 200 | Chinese agent-skills landing page. |
| https://www.creatok.ai/viral-video-cloning | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/viral-video-cloning | 200 via `curl`; `web.open` refused safe-open | Tool limitation, not site failure. |
| https://www.creatok.ai/product-link-to-video | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/product-link-to-video | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-to-prompt | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/tiktok-transcript-generator | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-subtitle-remover | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-watermark-remover | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-translator | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/text-to-speech | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/storyboard-generator | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-upscale | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/video-character-swap | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/image-text-translator | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/ai-product-detail-page | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/nano-banana-ai-image-generator | 200 | Public tool landing page. |
| https://www.creatok.ai/zh/tiktok-data-analytics | 200 | Public data/analytics tool. |
| https://www.creatok.ai/zh/inspiration-hub | 200 | Public prompt/copy ideation tool. |
| https://www.creatok.ai/zh/sora-video-generation | 200 | Public model/tool landing page. |
| https://www.creatok.ai/zh/seedance-2-mini | 200 | Public model page. |
| https://www.creatok.ai/zh/seedance-2 | 200 | Public model page. |
| https://www.creatok.ai/zh/kling-3 | 200 | Public model page. |
| https://www.creatok.ai/zh/gemini-omni | 200 | Public model page. |
| https://www.creatok.ai/zh/gpt-image-2 | 200 | Public model page. |
| https://www.creatok.ai/zh/happy-horse | 200 | Public model page. |
| https://www.creatok.ai/app/ai-video-generator | 200 final URL is `/login?redirect_url=.../app/ai-video-generator` | Login-gated app route; not entered. |
| https://www.creatok.ai/app/workspace/api-keys | 200 final URL is `/login?redirect_url=.../app/workspace/api-keys` | API key page requires login; not entered. |
| https://www.creatok.ai/robots.txt | 200 | Allows `/`, disallows `/_next/`, `/app/*`, `/api/*`, login/signup/reset routes. |
| https://www.creatok.ai/sitemap.xml | 200 | Points to `sitemap-0.xml`. |
| https://www.creatok.ai/sitemap-0.xml | 200 | Lists multilingual public pages; many prompt gallery pages are also indexed. |
| https://github.com/EchoSell/creatok-skills | 200 | Public GitHub repo linked from CreatOK. |
| https://raw.githubusercontent.com/EchoSell/creatok-skills/main/README.md | 200 | Public README with install/API-key usage. |
| https://api.github.com/repos/EchoSell/creatok-skills | 200 | Public repo metadata: created 2026-03-07, updated 2026-07-06, pushed 2026-06-21, 14 stars, 4 forks, JavaScript primary language at access time. |

## Public positioning

CreatOK positions itself as a TikTok e-commerce AI content platform. The Chinese homepage headline is "发现、复刻和裂变 TikTok 电商爆款视频"; the subcopy says it uses AI to produce image/text/audio/video selling assets, discover viral content, and publish via official API.

The English homepage frames the promise as scaling from one winning ad to many videos: generate, clone, and publish TikTok Shop video ads with AI.

Homepage proof points shown publicly:

- 300K+ TikTok e-commerce sellers / active users.
- 5M+ generated videos.
- 20+ countries.
- Claims of being a TikTok official certified partner / official API gold service partner.
- Claims of GDPR-compliant data protection.
- Marketplace logos shown include eBay, Amazon, Allegro, Mercado Libre, Etsy, Lazada, Shopee, and Shopify.

Core workflow on the homepage:

1. Discover: follow real-time viral trends and break down reference-video script structure.
2. Create: generate original videos or clone viral hits, then add product shots and voiceovers.
3. Publish: connect TikTok Shop, publish in batches or on schedule, and run pre-checks before posting.

Main product claims:

- Viral trend charts, reference-video breakdown, and inspiration gallery.
- AI-generated original video and one-click viral cloning.
- Smart prompt optimization, product image to video, team collaboration, shared assets, bulk management.
- TikTok Shop publishing through official API, not script simulation.
- Account/product management, pre-checks, batch and scheduled publishing.
- Top AI model access/tuning for sales content: Sora, Veo, Kling, Seedance, Wan, Nano Banana, and others are named on the homepage.

## Target customers and use cases

Explicit homepage use cases:

- TikTok Shop sellers: create product showcase videos, increase conversion, batch-produce assets, test creative angles.
- Brand e-commerce marketing: batch-produce marketing assets, test viral ideas, reduce production costs, improve ROI.
- Product review / seeding videos: generate review-style content that builds trust.

Other public tool pages broaden the target customer set:

- TikTok transcript generator: short-video creators, ad/material teams, TikTok Shop operators, content strategy and competitor research teams.
- Inspiration Hub: content creators, e-commerce sellers, marketing teams, and brand owners.
- Agent skills: TikTok creators, sellers, and operators using Codex, Claude Code, OpenClaw, Hermes, WorkBuddy, or similar agents.

## Pricing

Pricing is credit/subscription based. The public pricing cards show different currencies by locale. Amounts below are as displayed on 2026-07-07.

| Plan | English pricing | Chinese pricing | Credits and estimated output | Publicly listed features |
| --- | --- | --- | --- | --- |
| Free / 免费版 | $0 | ¥0 | 6 credits/month; up to about 6 images or 2 videos; actual usage varies by model | Viral breakdown trial; basic generation quality; 3 video analyses/day; videos publicly visible; short-term retention; email support. |
| Basic / 基础版 | Early bird $10, original $14/month | Early bird ¥69, original ¥99/month | 150 credits/month; up to about 150 images or 50 videos; about 2 Seedance 2 videos | Everything in Free; HD short-video generation; access to all top AI video/image models; no character consistency; watermark-free videos; unlimited video analysis; private videos; 1-month retention; standard render queue; community support. |
| Pro / 专业版 | Early bird $35, original $69/month | Early bird ¥249, original ¥599/month | 1,000 credits/month; up to about 1,000 images or 300+ videos; about 25 Seedance 2 videos | Everything in Basic; ad-grade video generation; character consistency with 5 free characters; 3-month retention; recover recently deleted resources; faster queue; 2-seat team workspace; shared credits/assets; priority support. |
| Ultra / 旗舰版 | Early bird $169, original $249/month | Early bird ¥1199, original ¥1699/month | 5,000 credits/month; up to about 5,000 images or 1,600+ videos; about 130 Seedance 2 videos | Everything in Pro; character consistency with 25 free characters; 6-month retention; highest priority queue; 10-seat team workspace; dedicated support. |

Pricing FAQ summary:

- Credit consumption varies by model, duration, resolution, and generation method.
- Advanced models and HD/long videos consume more credits than pricing-card estimates.
- Failed tasks are described as credit-compensated; the public FAQ says failures can happen with faces, protected IP-like characters, or regulated content.
- Running out of credits leads to add-on credit purchase or plan upgrade; add-ons require an active subscription.
- Subscription credits roll over while renewal is on time; paused credits are frozen; add-on credits are described as permanent.
- Plans can be canceled anytime from account settings, with access through the billing period.
- Monthly plans are non-refundable; annual refund terms were not yet announced.

Commercialization signals in pricing:

- Free tier functions as a trial with public visibility and short retention.
- Paid tiers move users to private videos, watermark-free HD output, longer retention, unlimited analysis, queues, support, team seats, shared credits/assets, and character consistency.
- The product monetizes by credits, subscriptions, add-on credits, and higher-priority/team production tiers.

## Agent skills

Public pages:

- https://www.creatok.ai/agent-skills
- https://www.creatok.ai/zh/agent-skills
- https://github.com/EchoSell/creatok-skills

Positioning:

- "Let Your AI Agent Analyze TikTok Hits & Generate Videos" in English.
- "让你的 AI Agent 帮你拆爆款" in Chinese.
- The page says CreatOK skills can be installed on Codex, Claude Code, OpenClaw, Hermes, WorkBuddy, and most major AI agents.

Public flow:

1. Install skills via the linked GitHub repo: `https://github.com/EchoSell/creatok-skills`.
2. Generate an API key in CreatOK console: `https://www.creatok.ai/app/workspace/api-keys` (login-gated).
3. Configure `CREATOK_API_KEY="ok_xxx"` in shell profile.

Capabilities claimed on CreatOK pages:

- TikTok transcript extraction.
- Visual scene understanding.
- Hook and script structure analysis.
- Key timestamp/highlight extraction.
- Turning analyzed scripts into new TikTok selling videos.
- One API key lets an agent consume the user's account credits.

Public GitHub README summary:

- Repo name: `EchoSell/creatok-skills`, public.
- Skills are for TikTok creators, sellers, and operators.
- README says they can analyze videos, recreate reference videos, generate new videos, and generate AI images through CreatOK remote APIs.
- Manual install targets OpenClaw (`~/.agents/skills`), Claude Code (`~/.claude/skills`), and Codex (`~/.codex/skills`).
- Installed skill names listed: `creatok-analyze-video`, `creatok-recreate-video`, `creatok-generate-video`, `creatok-generate-image`.
- Example prompts include analyzing a TikTok video, rewriting a reference video for a product, generating a TikTok-style video, generating an AI image, and checking an existing generation task.

Limitations:

- The API key route redirects to login.
- The Chinese/English agent-skills pages expose FAQ question headings in static text, but full FAQ answers were not visible in the extracted public text.

## Public tool pages

### Viral video cloning

URL: https://www.creatok.ai/viral-video-cloning and https://www.creatok.ai/zh/viral-video-cloning

Summary:

- Inputs: TikTok link or short reference upload, plus product link/images/name/selling points.
- Analyzes hook, scene structure, camera style, pacing, captions, and selling angle.
- Produces editable creative logic/storyboard rather than copying the original clip blindly.
- Use cases: TikTok Shop product videos, fast ad iteration, UGC-style creative planning, creative refresh.
- FAQ says users can start with a free trial, but analysis, generation, asset library, retries, downloads, and history may require login, credits, or plan quota.
- Commercial-use language is cautious: users should only use references and generated videos when they have rights to source materials, product assets, likenesses, voice, music, and platform usage.

### Product link to video

URL: https://www.creatok.ai/product-link-to-video and https://www.creatok.ai/zh/product-link-to-video

Summary:

- Turns product URLs, catalog images, saved product-library items, or manual product details into UGC-style short ads.
- Public metadata says it analyzes selling points, lets users choose UGC style/language/avatar, and generates product videos suitable for ads.
- Supports marketing formats such as UGC discovery, product showcase, product review, unboxing, demo, proof-led directions, tutorial, try-on, and stress test.
- Full workspace handles link analysis, product details, asset upload, avatar selection, scene generation, clip creation, downloads, and history.
- FAQ says analysis/generation/download/retry/history can require login and credits.
- Commercial-use language is conditional on rights to product assets, claims, likeness, music, and source material.

### TikTok transcript generator

URL: https://www.creatok.ai/zh/tiktok-transcript-generator

Summary:

- Free public tool for pasting a public TikTok link or video ID.
- Claims no file upload and no TikTok account required.
- First use asks for Cloudflare verification to prevent API abuse.
- Results promised: transcript, script copy, translation, content breakdown, and watermark-free download.
- Output can preserve timestamps and support hook/structure/CTA analysis.
- Public page says the free tool is suitable for single-video work; batch/team workflows are pushed toward CreatOK registration and pricing.

### Video to prompt

URL: https://www.creatok.ai/zh/video-to-prompt

Summary:

- Turns public TikTok videos or local short videos into editable AI video prompts.
- The link parser is described as currently adapted for TikTok only; other sources should be uploaded as files.
- FAQ says uploads support videos up to 30 seconds.
- Output typically covers subject, action, camera movement, scene, composition, lighting, rhythm, and style.
- Suggested uses include TikTok viral recreation, script breakdown, ad-material rewrite, and using outputs as prompts for Sora 2, Kling, Runway, Veo, Pika, etc.
- Login adds prompt history, reanalysis, and continuation into video generation.

### Subtitle remover

URL: https://www.creatok.ai/zh/video-subtitle-remover

Summary:

- AI removal of hard-coded subtitles while preserving original quality as much as possible.
- Public claim: monthly free quota, supports videos up to 60 seconds.
- Batch link says up to 10 videos at a time and longer durations in the fuller workflow.
- Supports common formats such as MP4, MOV, AVI, and up to 4K resolution.

### Watermark remover

URL: https://www.creatok.ai/zh/video-watermark-remover

Summary:

- AI removal of visible watermarks, with monthly free quota and support for videos up to 60 seconds.
- Targets corner logos, export logos, platform watermarks, Sora-style watermarks, and brand overlays.
- Public page says uploaded videos are retained only for task processing and delivery, not long-term storage.
- FAQ warns complex scenes can still show repair artifacts.

### Video translator

URL: https://www.creatok.ai/zh/video-translator

Summary:

- Online video translation tool with AI dubbing and lip sync.
- Public metadata says it supports 15 target languages and uploads or TikTok/Douyin link import.
- Modes include lip sync or audio-only translation, and fast/fine modes.
- Full workspace includes source import, language/mode selection, result download, and task history.
- FAQ says generation/download/retry/history may require login and credits.
- Commercial-use language is conditional on rights to source video, voice, likeness, music, and copy claims.

### Text to speech

URL: https://www.creatok.ai/zh/text-to-speech

Summary:

- Turns scripts into natural AI voiceover for video, ads, and narration.
- Public controls include voice selection, speed, pitch, and volume/expression options.
- Providers named include MiniMax and Fish Audio.
- Languages listed include English, Chinese, Japanese, Korean, Spanish, French, German, Indonesian, Thai, Vietnamese, Malay, Filipino, Portuguese, Russian, and Italian.
- FAQ says the tool can be tried free, while generation/history management requires a CreatOK account.

### Storyboard generator

URL: https://www.creatok.ai/zh/storyboard-generator

Summary:

- Turns reference images and a video brief into editable storyboard previews and long storyboard images.
- Public schema says it supports JPG/PNG/WebP references, 9:16/16:9/1:1 aspect ratios, and 4/6/9/12/16 panels.
- Intended as a planning step before generating video prompts or video.

### TikTok data analytics

URL: https://www.creatok.ai/zh/tiktok-data-analytics

Summary:

- Free TikTok creator analysis tool.
- Input: any TikTok creator username.
- Public page claims it can fetch recent-video metrics: likes, comments, shares, views, saves, and watermark-free video links.
- First use requires Cloudflare verification.
- Public copy says it analyzes public account data; FAQ heading asks about private accounts but answer was not visible in extracted text.

### Inspiration Hub / Creative Flywheel

URL: https://www.creatok.ai/zh/inspiration-hub

Summary:

- AI prompt/copy ideation tool for selling-video scripts.
- Public page claims 9 major categories and 30+ or 35+ creative angles, with multiple text models and support for 25 major countries/regions.
- Categories include seller angle, buyer angle, emotional, reverse marketing, authority, aesthetic/healing, rational, visual, and promotion.
- Target users include content creators, e-commerce sellers, marketing teams, and brand owners.

### Other public tool URLs confirmed

These returned 200 and are publicly linked from the Chinese homepage/footer:

- https://www.creatok.ai/zh/video-upscale
- https://www.creatok.ai/zh/video-character-swap
- https://www.creatok.ai/zh/image-text-translator
- https://www.creatok.ai/zh/ai-product-detail-page
- https://www.creatok.ai/zh/nano-banana-ai-image-generator

App/workspace routes behind login:

- `/app/ai-video-generator`
- `/app/gallery`
- `/app/image/product-listing-aplus`
- `/app/platform/tiktok`
- `/app/trending`
- `/app/workspace/api-keys`

## Public model pages

| Page | URL | Public facts and positioning |
| --- | --- | --- |
| Sora video generation | https://www.creatok.ai/zh/sora-video-generation | Public page presents Sora 2 for e-commerce video generation, with 9:16/16:9, 4/8/12s lightweight options, "Official API" label, no-watermark claim, no invite-code claim, and full generator link. FAQ says Sora 2 supports up to 15s and Sora 2 Pro up to 25s; character/person reference and protected-IP-like references are not supported. |
| Seedance 2 Mini | https://www.creatok.ai/zh/seedance-2-mini | Lower-cost/faster Seedance option for drafts, variants, UGC ads, hooks, and product tests. Public settings: 480p/720p, 4-15s. Page says Mini is best for first-round testing before upgrading winning prompts. |
| Seedance 2 | https://www.creatok.ai/zh/seedance-2 | Page describes Seedance 2 as a multimodal AI video generator supporting text, images, video, and audio. It shows 9 images + 3 videos + 3 audio references, 16:9/9:16/1:1, 5/10/15s, and "join waitlist"; copy says users can use available CreatOK models first and switch later. |
| Kling 3 | https://www.creatok.ai/zh/kling-3 | Public page says Kling 3 is live, supports native 4K, 2-6 shot storyboards, native audio sync, 5-language lip sync, and 40% faster generation. It shows Video 3.0 and Video 3.0 Omni / director version. |
| Gemini Omni | https://www.creatok.ai/zh/gemini-omni | Described as Google's conversational video generation model and "Nano Banana's video version." Public controls show 4/6/8/10s, 9:16/16:9/1:1, and up to 3 reference images. Capabilities listed include multimodal mixing, preserving photo identity/details, conversational editing, video-to-video editing, AI avatars, templates, and native audio. |
| GPT Image 2 | https://www.creatok.ai/zh/gpt-image-2 | Free GPT Image 2 image generator. Public claims: native PNG alpha/transparent output, 48+ language text rendering, up to 5,000-character prompts, up to 16 reference images, and estimated 1 credit per generation. |
| HappyHorse | https://www.creatok.ai/zh/happy-horse | Described as unified video+audio generation, 15B-parameter single Transformer architecture, 8-step inference, native synced video/audio. Note a public-copy inconsistency: hero says seven languages, while a later section lists six audio languages: Chinese, English, Japanese, Korean, German, and French. |

## FAQ and risk/compliance language

Homepage FAQ summary:

- AI TikTok Shop video creation is framed as three steps: Discover, Create, Publish.
- Generated videos can be published directly to TikTok through the official API.
- Paid plans produce HD, watermark-free output.
- The site does not guarantee a TikTok account will never be banned; it says risk depends on whether the user's content follows TikTok rules.
- CreatOK argues its official-API publishing and pre-checks reduce risks compared with script automation.
- Product image to video is supported.
- Viral "recreation" is described as learning creative approach, pacing, framing, and tone, then generating a new video with the user's product and original footage.
- Quality is positioned around top model integrations, automatic model selection, prompt optimization, and multiple generation attempts.
- Homepage broadly states generated videos include full commercial licensing for TikTok sales, ads, and marketing.

Commercial-rights caveat across tool pages:

- Tool-specific pages are more cautious than the homepage. Viral cloning, product-link-to-video, text-to-speech, and video translation pages all condition commercial use on the user having rights to the source materials, product assets, likenesses, voices, music, claims, and platform usage.

## Business model / commercialization read

Verifiable from public pages:

- Freemium acquisition: Free plan, monthly free quotas on several tools, public/free data tools, and free trials.
- Credit economy: Model choice, duration, resolution, and workflow affect credit consumption.
- Subscription ladder: paid tiers add private output, watermark-free HD, better retention, faster queues, support, team seats, shared assets/credits, and character consistency.
- Add-on credits: sold to active subscribers when credits run out.
- Agent monetization: agent skills consume the same account credits through one API key.
- Workspace lock-in: history, downloads, retries, batch features, API keys, publishing workspace, asset library, and complete generation flows route into login-gated `/app` pages.
- Compliance positioning: official TikTok API publishing, pre-checks, non-script automation, rights caveats, and GDPR claim.
- Commerce focus: pricing, tools, and public copy repeatedly tie value to TikTok Shop sellers, e-commerce ad testing, product videos, UGC/review formats, and marketing ROI.

## Open questions / not verified from public pages

- TikTok partner/certification claims were visible on CreatOK pages but not independently verified against TikTok-owned sources in this pass.
- Model availability and performance claims are based on CreatOK public copy only.
- Logged-in workspace capabilities, actual API behavior, actual credit consumption, generated output quality, and publishing workflow were not tested.
- Some public pages include rich structured data in HTML that exposes FAQ answers even when visible text is harder to extract; where possible, this note used the public HTML/curl text and marked login-gated areas separately.
