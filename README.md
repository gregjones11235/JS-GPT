# NextAI — PDF 问答（RAG）

上传一份 PDF，然后用自然语言（或语音）对它提问。后端基于 LangChain + OpenAI + Qdrant + Cohere Rerank 实现了一条完整的 RAG 流水线。

## 架构概览

```
React (3000)  ──►  Express (5050)  ──►  Qdrant (6333, Docker)
                        │
                        ├──► OpenAI  text-embedding-ada-002（嵌入）/ gpt-3.5-turbo（生成）
                        └──► Cohere  rerank-v3.5（重排）
```

RAG 五个步骤在 [server/chat.js](server/chat.js) 中的实现：

| 步骤 | 实现 | 触发时机 |
|---|---|---|
| 切块 | `RecursiveCharacterTextSplitter`，500 字符 / 50 重叠 | 上传时 |
| 嵌入 | OpenAI `text-embedding-ada-002` | 上传时 |
| 构建索引 | Qdrant HNSW（ANN），collection 名由文件内容 SHA1 派生，重复上传直接复用 | 上传时 |
| 检索与重排 | ANN 召回 Top-20 → Cohere rerank 精排 → 取 Top-4 | 提问时 |
| 提示词与生成 | 把 4 个 chunk 拼入提示词 → `gpt-3.5-turbo` | 提问时 |

## 环境要求

- Node.js ≥ 18（开发时使用 22）
- Docker Desktop（运行 Qdrant）
- OpenAI API Key
- Cohere API Key（免费额度即可，用于 rerank）

## 首次配置

### 1. 安装依赖

```bash
# 前端（仓库根目录）
npm install

# 后端
cd server
npm install
```

### 2. 配置环境变量

**前端** `./.env`：

```
REACT_APP_DOMAIN=http://localhost:5050
```

**后端** `./server/.env`（可从 [server/.env.example](server/.env.example) 复制）：

```
REACT_APP_OPENAI_API_KEY=sk-...
COHERE_API_KEY=...
QDRANT_URL=http://localhost:6333

# 可选调参
# RAG_TOP_K1=20                  # ANN 粗召回数量
# RAG_TOP_K2=4                   # rerank 后送入 LLM 的数量
# COHERE_RERANK_MODEL=rerank-v3.5
```

`.env` 文件已在 `.gitignore` 中排除，不会被提交。

## 启动运行

按顺序启动三个部分：**Qdrant → 后端 → 前端**。

### 第 1 步：启动 Qdrant（Docker）

```bash
cd server
docker compose up -d
```

容器名为 `Qdrant`，向量数据持久化在 Docker 卷 `qdrant_storage` 中，重启不丢失。

验证：

```bash
docker ps                                   # 应看到名为 Qdrant 的容器
curl http://localhost:6333/collections      # 返回 {"result":{"collections":[...]},"status":"ok"}
```

Web 管理界面：http://localhost:6333/dashboard

停止：`docker compose down`（保留数据）；`docker compose down -v`（连数据一起删除）。

### 第 2 步：启动后端

```bash
cd server
npm start
```

看到 `Server is running on port 5050` 即成功。

### 第 3 步：启动前端

新开一个终端，在仓库根目录：

```bash
npm start
```

浏览器自动打开 http://localhost:3000。

### 一键启动前后端

Qdrant 起来之后，也可以在根目录用一条命令同时启动前后端：

```bash
npm run dev
```

## 使用方式

1. 在页面上方拖拽或点击上传一份 PDF。上传时会完成切块、嵌入并写入 Qdrant，页面提示 `indexed: N chunks` 或 `already indexed`（同一文件再次上传不会重复嵌入）。
2. 上传区下方的 **Uploaded files** 列表显示服务器上的所有 PDF：可以上传多份。带 `active` 标签的是当前提问对象；点其他文件的 **Use** 可切换；点 **Deactivate** 取消激活（此时提问不走检索，由 LLM 直接回答）；点红色删除按钮会同时删除文件和它在 Qdrant 中的索引。
3. 在底部输入框输入问题并点击 **Ask**，答案会显示在对话区。
4. 打开 **Chat Mode** 可以用麦克风提问，回答会被朗读出来（需要浏览器支持 Web Speech API，Chrome 最佳）。

## 后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/upload` | `multipart/form-data`，字段名 `file`。上传并建立索引 |
| `GET` | `/chat?question=...` | 对当前激活的 PDF 提问，返回纯文本答案；没有激活文件时不做检索，LLM 直接回答 |
| `GET` | `/files` | 列出已上传的 PDF（含大小、是否已索引、是否激活） |
| `POST` | `/files/:name/select` | 把某个已上传的 PDF 设为当前提问对象 |
| `POST` | `/files/deselect` | 取消激活，之后 `/chat` 退化为无 RAG 的普通对话 |
| `DELETE` | `/files/:name` | 删除 PDF 及其 Qdrant 索引（内容相同的其他文件仍在时保留索引） |

命令行测试：

```bash
curl -F "file=@/path/to/your.pdf" http://localhost:5050/upload
curl "http://localhost:5050/chat?question=What%20is%20this%20document%20about"
```

> 注意：不要直接用 `server/uploads/` 里的文件测试上传——multer 会把上传内容写回同名路径，导致读写同一文件而损坏 PDF。请从其他目录上传。

## 常见问题

**回答和 PDF 内容无关**
没有激活的文件（后端重启后默认没有），此时 LLM 是在凭自身知识作答。在 **Uploaded files** 列表里点 **Use** 选一份即可。

**`Failed to index ...: Invalid PDF structure`（500）**
PDF 文件损坏或被截断。仓库自带的 `server/uploads/hbs-lean-startup.pdf` 就是一份截断文件，请换用完整的 PDF。

**`ECONNREFUSED 6333` / `fetch failed`**
Qdrant 未启动，先执行 `cd server && docker compose up -d`。

**`EADDRINUSE :::5050`**
端口被占用，通常是上一个后端进程还在运行。Windows 可用 `Get-NetTCPConnection -LocalPort 5050` 找到并结束进程。

**Docker 报 `failed to connect to the docker API`**
Docker Desktop 没有运行，先启动它再执行 `docker compose up -d`。

## 项目结构

```
nextai/
├── src/                      # React 前端
│   └── components/
│       ├── PdfUploader.js    # 上传组件 → POST /upload
│       ├── FileList.js       # 文件列表 → GET /files、select / deselect、DELETE /files/:name
│       ├── ChatComponent.js  # 提问 / 语音 → GET /chat
│       └── RenderQA.js       # 对话渲染
├── server/                   # Express 后端
│   ├── server.js             # 路由：/upload、/files、/chat
│   ├── chat.js               # RAG 流水线：ingest() 与 chat()
│   ├── docker-compose.yml    # Qdrant 容器
│   ├── .env.example          # 后端环境变量模板
│   └── uploads/              # 上传的 PDF 落盘目录
└── .env                      # 前端环境变量（REACT_APP_DOMAIN）
```
