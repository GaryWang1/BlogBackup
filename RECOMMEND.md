# 论坛推贴

选择“论坛”→当前论坛→“推贴”→“下一步”。推贴模式不需要搜索词，按搜索开始时间向前检索 48 小时的所有主题帖，不含跟帖。检索逐页完成，不受作者/关键词搜索的三页、80 条限制。源站列表和正文显示的是美西时间，使用 `America/Los_Angeles` 解析并自动处理夏令时；不能采用其 JSON-LD 将页面时间直接加 `Z` 的错误标记。筛选范围是连续 48 小时，列表及起止时间统一显示美西论坛时间，方便与原帖核对。遇到未能读取的分页、置顶帖或时间戳，会明确提示结果不完整。

选择 1–5 篇，点击“推贴”。服务器读取选中文章正文并一次调用 Gemini，生成每篇推荐原因。可编辑日期、逐篇原因及整封信，然后复制给网管。不会自动提交。纯图片、音视频及无法读取的文章需要手动填写；失败文章可单独重试。手动修改整封信后，更新上方条目不会覆盖整封信，需使用标明“替换手动修改”的按钮套用。

## Gemini 免费层配置

1. 在 [Google AI Studio](https://aistudio.google.com/apikey) 创建 **未关联付费账单的免费层项目**，取得 API 密钥。
2. 在 Netlify 的项目环境变量中设置 `GEMINI_API_KEY`，作用范围包含 Functions；`GEMINI_MODEL` 默认 `auto`，先查询该密钥可用的模型，再从已确认支持免费层的 Flash 文本模型中选择。不要继续固定为旧的 `gemini-2.5-flash`：Google 当前已限制新项目使用 2.5 系列。重新部署以使环境变量生效。密钥不得放进网页代码或提交到 Git。
3. 本地版从服务器进程环境读取同名变量。在 PowerShell 当前会话设置环境变量后启动服务；应用不会自动加载 `.env`。
4. 未配置密钥也能搜索、选帖和手动编辑推荐信；自动推荐原因会显示配置提示。

### 本地重启与 HTTP 404

在运行 `node server.js` 的 PowerShell 窗口按 **Ctrl+C**，等到再次出现 `PS ...>` 提示符后执行：

```powershell
$env:GEMINI_MODEL = "auto"
node server.js
```

同一窗口之前设置的 `GEMINI_API_KEY` 会保留；重启电脑或新开 PowerShell 窗口后需要重新设置。成功启动会显示 `Gemini API key: configured`，不会显示密钥本身。

若出现 `already running`，说明启动未成功，浏览器仍连接旧服务；关闭浏览器不等于停止服务器。无需重启电脑，在旧服务器所在窗口按 Ctrl+C 即可。

HTTP 404 表示 Google 请求的资源/模型不可用，和本机端口占用不同。自动模式使用官方 ListModels 返回的可用模型，不猜模型是否可用；明确设置的模型仍受尊重，失败时给出设置 `auto` 的提示。Google 返回的具体错误会显示在页面中，密钥会被遮盖。额度不足不切换模型、不自动重复生成。

免费额度以 [AI Studio 显示的限制](https://ai.google.dev/gemini-api/docs/rate-limits)为准。额度不足不会改用其他付费服务，也不会自动重试消耗额度。应用不能通过密钥判断项目是否启用了计费，因此请保持该项目为免费层。Google 的[免费层数据政策](https://ai.google.dev/gemini-api/docs/pricing)适用于发送的公开文章正文；不发送论坛账号、密码或评论。

## 接口与验证

- `POST /api/bbs/search`：`searchMode: "recommend"`、`forumId`、`forumName`、`page`（默认 1）、`startedAt`（后续页沿用首个响应）。响应包括 `results`、`nextPage`、`windowStart`、`startedAt`、`warnings`。客户端持续读取至 `nextPage: null`，合并去重；警告或中断必须显示为不完整。
- `POST /api/bbs/recommend`：`forumId` 和 `posts: [{sourceUrl}]`，1–5 篇，同论坛 HTTPS 文学城地址。响应 `results` 按选择顺序返回源站标题、作者、推荐原因或逐篇错误。每次最多发送每篇 60,000 字符正文，超长文章不截断冒充全文，而是提示手动填写。
- Netlify 沿用持久化请求限流（独立推贴计数）；本地版每 IP 每小时最多 10 次。已有博客归档、作者搜索和关键词合集流程保持兼容。
- `npm test`：正文提取、时间边界、分页、置顶去重、回复排除、选择校验、错误处理、模板等测试。`npm run build`：部署文件检查。
- `npm run test:ui`：无头浏览器测试，使用模拟接口，不调用 AI。需要已安装 Playwright Chromium，或通过 `TEST_CHROMIUM_PATH` 指定本机 Chrome/Edge 可执行文件。覆盖选帖限制、复制与降级、手动编辑保留、分页失败、切换论坛和窄屏布局；截图保存到已忽略的 `logs/`。

上线前用免费层密钥实际生成一封推荐信，核对 Gemini 项目仍为免费层及中文推荐语质量。测试不依赖真实密钥，不产生 AI 调用费用。
