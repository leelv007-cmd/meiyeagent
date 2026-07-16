# AgentKit `ad_video_gen` 广告视频生成用例 — 源码深拆

> 调研对象：`bytedance/agentkit-samples` → `python/02-use-cases/`
> 本地留档：`references/benchmark/ai-native-journey-study-2026-07-08/sources/agentkit-samples/`
> 关键发现：官方把**同一个"广告视频生成"业务做了三个变体**，正好演示三种编排范式，是本次最大收获。
> - `ad_video_gen`（单 Agent，最轻）
> - `ad_video_gen_seq`（SequentialAgent 串行 workflow）
> - `ad_video_gen_a2a`（A2A 多微服务 Agent）

## 一、端到端旅程

**用户输入**：一句话自然语言 + 可选商品图 URL（不支持上传/base64，只收公网 URL，`ad_video_gen/prompt.py:27-28`）。例：`"请生成一条杨梅饮料的商品展示视频，竖屏9:16，清爽夏日风。卖点：天然杨梅…商品图：https://…"`。a2a 版还能收商品**网页链接**，由 market-agent 用 Playwright 抓取解析。

**内部阶段**（以最完整的 seq/a2a 为准）：
`理解商品(market) → 分镜脚本(storyboard) → 批量生首帧图(image) → 图片评估选优(eval) → 批量生视频(video) → 视频评估选优(eval) → 合成上传(release)`

**输出形态**：单 Agent 版直接在对话里返回 **Markdown 图片 + HTML `<video>` 标签**（`prompt.py:82-89` 有固定模板）；seq/a2a 版最终产出**合成成片**并上传 TOS 得到公网 URL。

## 二、编排结构（三变体对比 = 编排图）

| 维度 | ad_video_gen（单Agent） | ad_video_gen_seq（串行） | ad_video_gen_a2a（微服务） |
|---|---|---|---|
| 结构 | 1 个 root_agent 循环 | `SequentialAgent` 固定 7 段 | 5 个独立 uvicorn 服务，A2A 通信 |
| 生成量 | 1 张四宫格图 + 1 条视频 | 每分镜 N 张候选，评估 N→1 | 同 seq，抽卡选优 |
| 有无质检 | 无 | 有 image/video 双评估 | 有 evaluate-agent |
| 合成 | 无（图生视频一步到位） | moviepy 本地拼接+TOS | release-agent 合成 |
| 定位 | 快速端到端 Demo | 平台部署稳定链路 | 可批量化生产 |

- **单 Agent 版**（`agent.py:31-49`）：`Agent(tools=[image_generate, video_generate])`，靠 prompt 约束"只调一次生图、一次生视频"，把 4 个分镜压进**一张 2x2 四宫格参考图**当风格锚，再图生视频。极简。
- **串行版**（`app/root/agent.py:111-128`）：`MMSequentialAgent(sub_agents=[market, storyboard, image, eval(image), video, eval(video), release])`。亮点：在每个子 Agent 之间**自动插入 `CallBackAgent`**（`:87-98`）做进度播报。
- **A2A 版**：编排逻辑其实写在**外部脚本** `app/main.py:137-296`，按 7 步依次 `run_sse` 调各服务，`pick_best_image/video`（`:48-88`）在编排器侧做选优。每步产物落一个 JSON 文件（`1_video_config.json`→`2_shot_list.json`→…→`7_final_video.json`），**中间 artifact 链非常清晰**。

**阶段间产物格式**：全程用 **Markdown / JSON 结构化文本**在 `session.state` 里传递。核心 artifact：
- `video_config`（营销 brief，`app/market/prompt.py:40-49`）：`product_name / suggest[卖点] / plan[分镜建议] / target_audiences / reference_url / resolution / ratio / first_image_generate_number / video_generate_number`。
- `shot_list`（分镜，`app/storyboard/prompt.py`）：4 个 shot，每个 `{shot_id, image[画面], action[运镜], reference[参考图]}`，用 **AIDA 模型**（注意/兴趣/欲望/行动）映射四镜（`:26-48`）。
- 评估产物：每个候选打 `score(0~1) + reason`，维度=**美学/画质/一致性**（`app/eval/prompt.py:106-114`）。

**模型分工**（单 Agent 版为例，`README.md:36-40`）：DeepSeek-V4-Pro 做理解规划 → Doubao-Seedream（生图）→ Doubao-Seedance（生视频）。seq/a2a 用 Doubao-Seed-1.6 + Seedream4.5 + Seedance1.x。

## 三、人机交互契约（最重要）

1. **流式事件**：底层是 Google ADK 的 `Event(content=Content(parts=[Part(text)]), partial=True)`，SSE 传输（`run_sse`）。`CallBackAgent`（`app/root/agent.py:31-63`）在流式模式下先发 `partial=True` 增量、再发完整 event。
2. **步骤状态播报**：每个子 Agent 用 hook 往 `state["cb_agent_state"]` 写一句人话进度，如 `"✅分镜脚本生成工作完成，继续执行首帧图生成任务。"`（`app/storyboard/hook.py:21-26`），由下一个 CallBackAgent 回放给用户 —— 这就是"步骤状态条"的实现。
3. **中间产物展示 = 不阻塞确认**：单 Agent 版明确规定生视频前**必须先把四宫格参考图用 Markdown 展示**并提示"视频要几分钟请耐心等待"，但**"这一步不要等待用户确认，展示后继续"**（`ad_video_gen/prompt.py:35-37`）。即：**过程透明可观察，但默认一键到底，不设人工确认 gate**。
4. **早停**：`session.state["end_invocation"]` 为真则中断串行链（`app/root/agent.py:106-108`）。
5. **UI 层**：**没有自定义前端**（无 gradio/react）。用户交互靠 ① `veadk web` 内置调试页 ② AgentKit 平台调试页 ③ 直接调 SSE API。"界面"本质是一个**能渲染 Markdown 图片 + HTML video 的聊天框**。质检选优（抽卡）也是自动的，用户不介入换素材。

## 四、AgentKit / VeADK 框架范式

- **技术栈**：`agentkit-sdk-python==0.5.10` + `veadk-python==0.5.37` + `google-adk==1.32.0`（`ad_video_gen/pyproject.toml`）。**VeADK 是套在 Google ADK 之上的火山封装**，事件/流式/session 模型全是 ADK 原生（`Event/Content/Part/partial`、`session.state`、SSE）。
- **Agent 定义**：`Agent(name, model_name, description, instruction=PROMPT, tools=[...], generate_content_config)`（`agent.py:31-41`）。
- **服务壳**：`AgentkitAgentServerApp(agent, short_term_memory=ShortTermMemory(backend="local"))`，内部是 FastAPI，`.run(host, port)` 起服务。
- **工具接口值得抄**（`app/video/tools/video_generate_by_code.py:23-152`）：`params: list[dict]` 批量提交，每项 `{video_name, prompt, first_frame?, last_frame?}`，参数走 **prompt 尾部命令行式 flag**（`--rs 1080p --rt 9:16 --dur 15 --wm true --seed`）；返回 `{status, success_list:[{name:url}], error_list}`。docstring 极其详尽（约束、示例、边界全写进去当 LLM 上下文）。
- **多 Agent 装配**：串行=`SequentialAgent(sub_agents)`；委派=`Agent(sub_agents=[...])` 由 LLM 决定 handoff（`director-agent/agent.py:22-33`，还开了 `thinking:enabled`）；跨进程=A2A 协议。
- **对我们"AI SDK 起步 + 自研 step-runner"的启示**：ADK 的 `session.state` 当阶段间黑板 + `partial=True` 流式 + hook 写"人话进度"这三件套，正是我们 step-runner 该有的接口；**命令行式 flag 塞进 prompt 尾部**是个轻量传参技巧可借鉴。

## 五、其他 use-cases 清单（`python/02-use-cases/`）

ad_video_gen×3、`video_gen`（通用生视频）、`comic_drama_gen`（漫画短剧，含 Skill 目录=角色/场景/编剧/分镜/合成五 reference）、`video_breakdown_agent`（**爆款视频逆向拆解+复刻**）、`content_guardrails`（**内容合规护栏**）、`store_inspection_assistant`（**门店巡检**）、`customer_support`、`restaurant_ordering`/`coffee_order`（点单）、`travel_planner`、`stock_analysis`、`data_analysis_with_datalake`、`mini_aiops`、`ai_coding`、`partners`。

## 六、对美业副驾的可平移点

把"广告视频生成"换成"美业门店内容生成"，以下**直接可平移**：

1. **营销 brief 结构（market 阶段）**：`video_config` 的字段结构原样迁 →「门店名/项目卖点/目标客群/适用场景/参考图」，让老板娘一句话+可选门店图即可启动。这是 AI 原生的入口，不是传统表单。
2. **AIDA 四段叙事骨架（storyboard 阶段）**：注意→兴趣→欲望→行动，对美业极贴：探店钩子→痛点共鸣（比如"额头细纹"）→项目/手法特写→到店引导。`shot_list` 的 `{画面, 运镜, 参考图}` 结构可复用做图文/短视频脚本。
3. **中间产物透明但不阻塞**（`prompt.py:35-37` 范式）：先秒出"文案/分镜草稿"给老板娘看，附一句人话进度提醒，默认继续 —— 契合我方"拟人化一句话提醒 > SaaS 待办卡片"的审美原则；**但美业需在此处补一个"可选确认点"**（老板娘可改文案再继续），这是样例缺的、也是我们差异化处。
4. **评估选优（抽卡 N→1）**：每条内容出 N 个候选、按 美学/画质/合规 三维打分选优，正好承接美业**合规红线硬停**——把"一致性"维度换成"医美违禁词/功效承诺"过滤即是自带护栏。参考 `content_guardrails` use-case。
5. **CallBackAgent 进度播报机制**：串行链每段插一句"✅已完成X，继续Y"，是低成本高感知的过程可视化，符合"过程可观察"要求。
6. **成片合成走 moviepy+对象存储**（`release/tools/video_combine.py`）：如未来做视频，本地拼接+TOS 上传这条链可整段抄。

**不建议照抄之处**：样例默认"一键黑盒到底、零人工确认"，对非技术老板娘反而失控；美业副驾应在 brief 确认、文案定稿两处保留轻量确认点（改而非从头填）。
