# MinerU API 实读笔记（mineru.net/apiManage/docs，2026-07-24）

- 来源：https://mineru.net/apiManage/docs（Jina 实读，原文快照存会话 scratchpad/mineru-docs.md）
- 用途：D-120 多格式资产解析管线的引擎选型与路由条件依据；服务 D-119 拍照代填/D-117 参考文件
- 开源仓：https://github.com/opendatalab/MinerU（自部署迁移路径）

## 一、两种 API 模式

| 维度 | 🎯 精准解析 API | ⚡ Agent 轻量解析 API |
|---|---|---|
| 鉴权 | Token（Bearer） | 免登录，IP 限频 |
| 接口 | `POST /api/v4/extract/task`（URL 提交单文件）/ `POST /api/v4/file-urls/batch`（本地文件批量：先申请上传链接[24h 有效]→上传→自动提交解析） | `/api/v1/agent/parse/url` / `/api/v1/agent/parse/file` |
| 模型 | `pipeline`（默认）/ `vlm`（**官方推荐**）/ `MinerU-HTML`（HTML 必选此项） | 固定 pipeline 轻量 |
| 限制 | ≤200MB、≤200 页、批量≤200 个 | ≤10MB、≤20 页、单文件、**不支持 HTML** |
| 输出 | Zip：Markdown+JSON（可加 docx/html/latex） | 仅 Markdown（CDN 链接） |
| 调用 | 异步：提交→轮询 或 callback | 异步：提交→轮询 |

**结论：生产用精准解析 API（token+JSON 输出+批量）；Agent 轻量版仅适合开发调试/spike（IP 限频不可控、无 JSON）。**

## 二、关键参数（精准 API）

- `model_version`：`pipeline|vlm|MinerU-HTML`，默认 pipeline，**推荐 vlm**；HTML 文件必须显式 `MinerU-HTML`
- `is_ocr`：**默认 false**——扫描件/图片必须显式开 true，否则文字层缺失（美业价目表照片场景必开）
- `enable_table`：默认 true（价目表核心依赖）；`enable_formula`：默认 true（美业场景可关省耗）
- `language`：默认 `ch`（中文场景保持默认）
- `page_ranges`：`"2,4-6"` 逗号+区间；Agent 版仅 `from-to` 简单格式
- `extra_formats`：`docx/html/latex` 可选附加导出（源为 html 时无效）
- `callback`+`seed`：回调 POST，`checksum=SHA256(uid+seed+content)` 防篡改；**接收非 200 时最多重推 5 次**——与 DBOS 任务载体的对接合同（callback 触发任务步推进，或退化为轮询步）
- 支持格式：PDF、图片（png/jpg/jpeg/jp2/webp/gif/bmp）、Doc/Docx、PPT/PPTx、Xls/Xlsx、HTML（URL）

## 三、配额与状态机

- **每账号每天 1000 页最高优先级**，超出降优先级排队（非硬拒）——单商家建档页数少（价目表 1-2 页），验证期≈500+ 商家建档/天，足够；规模化前自部署迁移
- 国外 URL（github/aws）会超时（网络限制）——上传物走我方对象存储 URL 或 file-urls/batch 直传
- 状态机：`pending→running→converting→done|failed`；`extract_progress.extracted_pages/total_pages` 可做**真实进度条**（对齐 D-114 白话进度，不做假进度——绘文反面教材）
- `err_msg` 在 failed 时给原因（格式不支持等）

## 四、D-120 细化路由表（输入 → 引擎 → 参数）

| 输入形态 | 路由 | 参数/理由 |
|---|---|---|
| 单张手机照片/APP 截图（价目表、团购单——**最高频**） | **我方 VLM 直读** | 一步语义化省两跳；歪斜/反光鲁棒；数据不出我方模型边界 |
| 复杂版面图片（多栏长价目单、整页菜单、VLM 直读置信度低时） | MinerU 精准 | `model_version=vlm, is_ocr=true, enable_table=true, enable_formula=false` |
| PDF 电子版（有文字层） | MinerU 精准 | `vlm, is_ocr=false` |
| PDF 扫描件 | MinerU 精准 | `vlm, is_ocr=true` |
| Word/PPT/Excel（价目表 xlsx、项目介绍 docx、品牌手册 ppt） | MinerU 精准 | `vlm`（office 全系原生支持，我方无需装 office 解析栈） |
| 网页 URL（大众点评/美团店铺页、文章页） | MinerU 精准 | `model_version=MinerU-HTML`（必须显式）；美团/抖音 app 内反爬页可达性**待实测**，兜底=截图代链接→VLM 直读 |
| 批量素材文档（≤200 个/次） | `file-urls/batch` | 24h 上传链接；对应 D-120「批量异步」轨 |
| 营业执照等敏感证件 | **我方 VLM**（不出第三方） | D-120 数据边界条款 |
| 纯视觉图（门头/作品/客照） | 我方 VLM 四 slot 分类 | 不进文档解析 |

路由判定顺位：敏感类→VLM；纯视觉→VLM 分类；单图→VLM 直读优先（置信度低回退 MinerU）；多页/office/HTML→MinerU；批量→batch 接口。**VLM 直读 vs MinerU 的精度阈值待美业真实样本集实测标定**（D-120 待验证项）。

## 五、除资产录入外的复用环节（按优先级）

1. **人设/建档向导的「添加参考文件」**（D-117/D-119 已有入口）：品牌手册 PDF/旧文案 docx→解析→LLM 提取表达样例（contentStyle 范文）与品牌信息——同一 ParseService 复用，零新建。
2. **平台页面反推建档**（D-119 待验证「已有账号反推」的近亲）：商家大众点评/美团店铺页 URL→MinerU-HTML→店铺信息/项目/评价关键词→建档草案——把「拍照代填」升级为「链接代填」，Day-0 成本再降一档；反爬可达性待实测。
3. **风格模板导入（admin 侧）**：运营导入爆款结构文档/竞品笔记 PDF→解析→D-116 风格集合配置草案——运营效率工具，非商家面。
4. **行业知识库（远期）**：护发/美业知识文档、平台规则页→解析入库→D-113 事实检索源或客服/合规参考（MinerU 官方定位即「面向 Agent 和 RAG 的解析平台」）。
5. **内部调研工具**：对标产品文档/白皮书解析（我方运营自用）。

架构含义：**解析管线=共享基础设施（ParseService），不是资产录入专属**——输入路由+Provider 调用+ParsedDocument 落库做成一个服务，上述环节全部复用（D-120 四层表结构中 ParsedDocument 层的共享价值）。

## 六、限流与计费（登录态实测补核，2026-07-24）

- **计费：「目前暂无商业化收费计划」**（限流策略页原文）——当前 API 免费，限额内放开用；保留动态调整限流的权利
- **提交频控**：三个提交接口（单文件/批量上传/urls批量）共用 **50 文件/分钟**；**单用户 5000 文件/天，其中 HTML 最多 100 个/天**（「链接代填」的日容量边界）
- **查询频控**：结果查询接口共用 1000 次/分钟
- **登录态仪表盘**（apiManage/token 页实测）：今日解析文件数 0/5000、今日优先解析页数 0/1000 实时可见；当前线上模型版本标识 `lm3.4.0`
- **Token 管理**：每账号最多 **5 个 Token**；**有效期 90 天，到期不可续期须重建**——运维硬要求：token 轮换机制必须做（到期前重建+热切换），否则解析链路 90 天必断一次

## 七、未核事项（留法务/实测批次）

- [ ] 数据留存条款（上传文件在 mineru.net 的保存期限与用途）——隐私政策页为新 tab 未取到，D-040 合规置后批次处理；D-120 数据边界条款（敏感证件不出第三方）已先行兜底
- [ ] MinerU-HTML 对美团/抖音/大众点评反爬页面的实际可达性（HTML 100 个/天限额下的「链接代填」可行性）
- [ ] vlm vs pipeline 模型在美业价目表样本上的精度差；MinerU vs 我方 VLM 直读对比（路由回退阈值标定）
- [ ] 免费政策变化监测（「暂无商业化收费计划」为当前口径，规模化前须复核+自部署预案在位）
