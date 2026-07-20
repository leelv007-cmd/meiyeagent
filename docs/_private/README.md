# 私密凭据目录（docs/_private/）

> ⚠️ 本目录除本 README 外，**全部被 .gitignore 忽略，永不进 git**。
> 用途：存放真实 provider 的 API Key、Base URL、调用文档，供本地测试引用。

## gitignore 保护

`.gitignore` 规则：
```
/docs/_private/*        # 忽略本目录下所有文件
!/docs/_private/README.md   # 唯一放行：本说明文件
```
即：往这里放的任何 `.md` / `.env` / `.txt` / Key 文件都**不会被提交**，只有本 README 会。

## 哥往这里放什么

把 provider 的三样东西放进来（文件名随意，都在忽略范围内）：
1. **调用文档**（说明是 OpenAI 兼容格式还是别的、有哪些模型、请求示例）
2. **Base URL**
3. **API Key**

### 已落盘：Tu-zi 媒体 OpenAPI（2026-07-17）

| 路径 | 内容 |
|---|---|
| `docs/_private/tuzi-api/README.md` | 索引 + 产品 operation 映射（图+视频） |
| `docs/_private/tuzi-api/images-generations.openapi.yaml` | `POST /v1/images/generations` 文生图 |
| `docs/_private/tuzi-api/images-edits.openapi.yaml` | `POST /v1/images/edits` 图生图 |
| `docs/_private/tuzi-api/videos.openapi.yaml` | `POST /v1/videos` Seedance 视频 |
| `docs/_private/tuzi.env` | Base URL + Key（密钥，勿打印） |

代码引用以 `tuzi-api/README.md` 为准；探针证据在 `docs/evidence/pro-studio/ticket-09/`、`ticket-21/`。

推荐放成一个文件，例如 `docs/_private/provider-creds.md`，格式不限。放好后告诉控制器（我），我会：
- 读文档判断是 LLM 还是媒体、什么调用格式；
- 把变量填进项目根的 `.env`（同样 gitignore 保护，不进 git）；
- 更新 `.env.example` 补空占位说明（这个进 git，但只有占位不含真 Key）；
- 跑真实链路测试时直接引用。

## 目标变量名（代码已写死，参考用）

**LLM（真实文案）**：
```
MODEL_EXECUTION_MODE=direct
MODEL_DIRECT_BASE_URL=...
MODEL_DIRECT_API_KEY=...
MODEL_DIRECT_MODEL=...
```

**火山方舟媒体（真实图/视频）**：
```
MODEL_MEDIA_EXECUTION_MODE=ark
ARK_MEDIA_BASE_URL=...
ARK_MEDIA_API_KEY=...
ARK_SEEDREAM_MODEL=...   # 图片
ARK_SEEDANCE_MODEL=...   # 视频
```

变量名的完整清单见 `apps/core/src/p1/model-supply/runtime-config.ts`。你不用记这些——放好文档+URL+Key，剩下我来接。
