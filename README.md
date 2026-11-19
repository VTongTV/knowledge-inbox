# Knowledge Inbox

Knowledge Inbox is a personal knowledge inbox. Save a note or a URL. Ask a question. The app answers with citations from the sources you saved.

## What it does

- Save a short note. Or save a URL. The server fetches the page and extracts the text.
- Ask a question. The app finds the passages that match it and answers from them.
- Every answer cites its sources. Each cited source shows a relevance score.

No accounts exist. The app is single-user. No authentication is required.

## Stack

- Backend: FastAPI, SQLite, numpy, fastembed (`BAAI/bge-small-en-v1.5`). LLM calls go through httpx to OpenRouter.
- Frontend: React and TypeScript on Vite. Tailwind v4. A few shadcn primitives. Geist and JetBrains Mono fonts.

## Run it

### 1. Backend

Create the environment and install the dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Put your OpenRouter key in `backend/.env`:

```
OPENROUTER_API_KEY=sk-or-...
```

The first request downloads the embedding model.
The download is about 130 MB and runs one time.

Start the API server:

```powershell
uvicorn app.main:app --port 8000
```

### 2. Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL that Vite prints. The default is `http://localhost:5173`.

## Demo mode

One command seeds the store with six notes about this codebase and one live URL. The URL is the PostgreSQL INSERT documentation page. The seed totals about 65 chunks.

```powershell
cd backend
.venv\Scripts\python.exe scripts/seed_demo.py
```

The script refuses to run on a non-empty store.
Use `--reset` to wipe and reseed. The command deletes all saved data.

```powershell
.venv\Scripts\python.exe scripts/seed_demo.py --reset
```

Try these questions:

- what chunking strategy does knowledge inbox use?
- how does citation verification work?
- what does the RETURNING clause do?

## API

| Route | Body | Returns |
|---|---|---|
| `POST /ingest` | `{"type": "note"\|"url", "content": "..."}` | `202` with `status: "pending"`. The client polls `GET /items` until the chunk count is above zero. |
| `GET /items` | - | Every item with a preview and a chunk count |
| `POST /query` | `{"question": "..."}` | `{"answer": "...", "sources": [{item_id, chunk_index, text, score, verified}]}` |

Status codes: `202` ingest accepted, `200` success, `400` the content held no text, `422` the body failed validation, `500` the store failed, `502` the page fetch or the LLM call failed. The detail string names the cause.

## Design choices

- **Chunking:** Sentences grouped into windows of about 400 characters. Overlap is 60 characters. A chunk never cuts a sentence. A thought that spans a boundary stays in both chunks.
- **Vector store:** SQLite. Each chunk stores its embedding as JSON. Search loads every vector and scores it with numpy cosine. The `chunks_fts` table mirrors the chunk text for keyword search.
- **Hybrid retrieval:** The cosine list and the BM25 keyword list merge with reciprocal rank fusion. Chunks that match only by keyword can win. If the SQLite build lacks FTS5, the store logs a warning and uses the cosine list alone.
- **Rerank:** The top pool goes through a local ColBERTv2 model. The model is `answerdotai/answerai-colbert-small-v1`. It loads once. Set `RERANK_ENABLED=false` to switch it off. If the model fails to load, the fused order is kept.
- **Cutoff:** Chunks under `MIN_CHUNK_SCORE` (default 0.45) can not reach the prompt. If nothing survives, the answer says that the sources do not cover the question and the LLM is not called.
- **Verified citations:** Every `[n]` marker in the answer gets checked against the sentence that carries it. Each source reports `verified`. A source is `true` when the sentence and the source share at least two significant words.
- **Async ingest:** The fetch and the validation run before the response. The embed runs in the background. The response returns `202` with `status: "pending"`.
- **What breaks at scale:** The cosine scan reads every chunk on every query. Past fifty thousand chunks, move to a vector index. The store runs behind one lock. A second process needs a database that accepts concurrent connections.

## Fetcher limits

The server sends `KnowledgeInbox/0.1 (server-side page fetcher)` as the user agent. Some sites block that fetch anyway. Wikipedia returns `403` to the HTTP client even though a browser passes the same headers. PostgreSQL documentation accepts the fetch.

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests/ -q
```

72 tests pass. They cover the store, the chunker, the HTML extractor, the fetch path, the embedding shape, the RAG loop, and all three endpoints. Every test runs offline.

## Layout

```
backend/app/      config, store, text, embed, rag, main
backend/tests/    one test module per app module
backend/scripts/  the demo seed
frontend/src/     the home screen with all interactive surfaces
```
