# NextAI — Chat with your PDFs (RAG)

Upload a PDF, then ask questions about it in text or by voice. The backend implements a full RAG pipeline with LangChain, OpenAI, Qdrant and Cohere Rerank.

## Architecture

```
React (3000)  ──►  Express (5050)  ──►  Qdrant (6333, Docker)
                        │
                        ├──► OpenAI  text-embedding-ada-002 (embeddings) / gpt-3.5-turbo (generation)
                        └──► Cohere  rerank-v3.5 (reranking)
```

How the five classic RAG steps map onto [server/chat.js](server/chat.js):

| Step | Implementation | When |
|---|---|---|
| Chunking | `RecursiveCharacterTextSplitter`, 500 chars with 50 overlap | on upload |
| Embedding | OpenAI `text-embedding-ada-002` | on upload |
| Indexing | Qdrant HNSW (ANN). Collection name is derived from the file's SHA-1, so re-uploading the same file reuses the index | on upload |
| Retrieval & reranking | ANN recall of top 20 → Cohere rerank → keep top 4 | on question |
| Prompting & generation | The 4 chunks are stuffed into the prompt → `gpt-3.5-turbo` | on question |

## Requirements

- Node.js ≥ 18 (developed on 22)
- Docker Desktop (for Qdrant)
- An OpenAI API key
- A Cohere API key (free tier is enough; used for reranking)

## First-time setup

### 1. Install dependencies

```bash
# Frontend (repo root)
npm install

# Backend
cd server
npm install
```

### 2. Configure environment variables

**Frontend** `./.env`:

```
REACT_APP_DOMAIN=http://localhost:5050
```

**Backend** `./server/.env` (copy from [server/.env.example](server/.env.example)):

```
REACT_APP_OPENAI_API_KEY=sk-...
COHERE_API_KEY=...
QDRANT_URL=http://localhost:6333

# Optional tuning
# RAG_TOP_K1=20                  # ANN recall size
# RAG_TOP_K2=4                   # chunks passed to the LLM after reranking
# COHERE_RERANK_MODEL=rerank-v3.5
```

Both `.env` files are excluded by `.gitignore` and are never committed.

## Running

Start the three parts in order: **Qdrant → backend → frontend**.

### Step 1: Start Qdrant (Docker)

```bash
cd server
docker compose up -d
```

The container is named `Qdrant`. Vectors are persisted in the Docker volume `qdrant_storage`, so they survive restarts.

Verify:

```bash
docker ps                                   # a container named Qdrant should be running
curl http://localhost:6333/collections      # {"result":{"collections":[...]},"status":"ok"}
```

Web UI: http://localhost:6333/dashboard

Stop with `docker compose down` (keeps data) or `docker compose down -v` (deletes data too).

### Step 2: Start the backend

```bash
cd server
npm start
```

You should see `Server is running on port 5050`.

### Step 3: Start the frontend

In a new terminal, from the repo root:

```bash
npm start
```

The browser opens http://localhost:3000 automatically.

### Start frontend and backend together

Once Qdrant is up, you can also launch both from the repo root with one command:

```bash
npm run dev
```

## Usage

1. Drag a PDF onto the upload area (or click it). The file is chunked, embedded and written to Qdrant; the page reports `indexed: N chunks` or `already indexed` (re-uploading the same file does not re-embed it).
2. The **Uploaded files** list below the upload area shows every PDF on the server. You can upload several. The one tagged `active` is the file being queried; click **Use** on another file to switch, **Deactivate** to clear the selection (questions are then answered by the LLM alone, without retrieval), or the red delete button to remove the file together with its Qdrant index.
3. Type a question in the box at the bottom and press **Ask**. The answer appears in the conversation area.
4. Turn on **Chat Mode** to ask by microphone; answers are read aloud (requires the Web Speech API — Chrome works best).

## Backend API

| Method | Path | Description |
|---|---|---|
| `POST` | `/upload` | `multipart/form-data`, field name `file`. Uploads and indexes a PDF |
| `GET` | `/chat?question=...` | Answers a question about the active PDF as plain text. With no active file the LLM answers without retrieval |
| `GET` | `/files` | Lists uploaded PDFs (size, indexed, active) |
| `POST` | `/files/:name/select` | Makes an uploaded PDF the active one |
| `POST` | `/files/deselect` | Clears the active file; `/chat` falls back to a plain LLM conversation |
| `DELETE` | `/files/:name` | Deletes the PDF and its Qdrant index (the index is kept if another file with identical content remains) |

Quick test from the command line:

```bash
curl -F "file=@/path/to/your.pdf" http://localhost:5050/upload
curl "http://localhost:5050/chat?question=What%20is%20this%20document%20about"
```

> Do not upload files straight out of `server/uploads/`: multer writes the upload back to the same path, so the file would be read and written at once and end up corrupted. Upload from any other directory.

## Troubleshooting

**Answers have nothing to do with the PDF**
No file is active (the default after a backend restart), so the LLM is answering from its own knowledge. Click **Use** on a file in the **Uploaded files** list.

**`Failed to index ...: Invalid PDF structure` (500)**
The PDF is corrupted or truncated. Use a complete PDF.

**`ECONNREFUSED 6333` / `fetch failed`**
Qdrant is not running. Run `cd server && docker compose up -d`.

**`EADDRINUSE :::5050`**
The port is taken, usually by a previous backend process. On Windows, find it with `Get-NetTCPConnection -LocalPort 5050` and stop it.

**Docker reports `failed to connect to the docker API`**
Docker Desktop is not running. Start it, then run `docker compose up -d`.

## Project layout

```
nextai/
├── src/                      # React frontend
│   └── components/
│       ├── PdfUploader.js    # Upload widget → POST /upload
│       ├── FileList.js       # File list → GET /files, select / deselect, DELETE /files/:name
│       ├── ChatComponent.js  # Question input / voice → GET /chat
│       └── RenderQA.js       # Conversation rendering
├── server/                   # Express backend
│   ├── server.js             # Routes: /upload, /files, /chat
│   ├── chat.js               # RAG pipeline: ingest() and chat()
│   ├── docker-compose.yml    # Qdrant container
│   ├── .env.example          # Backend env template
│   └── uploads/              # Where uploaded PDFs are stored (git-ignored)
└── .env                      # Frontend env (REACT_APP_DOMAIN)
```
