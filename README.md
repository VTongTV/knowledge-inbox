# Knowledge Inbox

A personal knowledge inbox. Save a note or a URL, then ask a question over what you saved. The app chunks the content, embeds it, and answers the question with citations from the stored sources.

## What it does

- Save a short note, or save a URL. The server fetches the page and extracts its text.
- Ask a question. The app finds the stored passages that match the question and answers from them.
- Every answer lists its sources with a relevance score, so each claim is traceable.

## Stack

- Backend: FastAPI, sqlite, numpy, fastembed with `BAAI/bge-small-en-v1.5`, httpx against an OpenRouter-compatible chat endpoint.
- Frontend: React and TypeScript on Vite. The interface is a dark glassmorphic single screen: time-aware greeting, rotating tagline, chat composer, command chips, and a drawer with the saved items, over a slow aurora ambient field. Typography is Geist Variable and JetBrains Mono, styled with Tailwind v4 and a few shadcn primitives bound to the design tokens.

## Run it

### 1. Backend

Create the environment and install the dependencies:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Put your OpenRouter key in `backend/.env` (this file is gitignored):

```
OPENROUTER_API_KEY=sk-or-...
```

Start the API server:

```powershell
cd backend
uvicorn app.main:app --port 8000
```

The first ingest downloads the embedding model, about 130 MB, one time. Embedding then runs on the CPU.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints, by default `http://localhost:5173`.

## API

| Route | Body | Returns |
|---|---|---|
| `POST /ingest` | `{"type": "note"\|"url", "content": "..."}` | The saved item with its id and chunk count |
| `GET /items` | — | Every item with a preview and a chunk count |
| `POST /query` | `{"question": "..."}` | `{"answer": "...", "sources": [{item_id, chunk_index, text, score}]}` |

Status codes: `200` success, `400` the content held no text, `422` the request body failed validation, `502` the page fetch or the LLM call failed. The detail string names the cause.

## Design choices

- **Chunking:** sentences, grouped to about 400 characters, with a 60-character overlap between neighbors. A chunk therefore never cuts a sentence, and a thought that spans a boundary stays in both chunks.
- **Vector store:** sqlite. Each chunk keeps its embedding as JSON. Search loads every vector and scores with numpy cosine. No second database, no new service, no extension to compile.
- **What breaks at scale:** search cost grows with the chunk count, because every query scans the full table. Past fifty thousand chunks, move to a vector index (sqlite-vec, pgvector, or a dedicated store). The store also serializes writes behind one lock; a second app process needs a database that accepts concurrent connections.
- **Production changes, in one line each:** run the fetch behind a job queue with retries; cache embeddings of identical text; stream the answer token by token; collect per-source feedback; move the key to a secret manager.

## Fetcher limits

The server-side fetch sends a descriptive `User-Agent: KnowledgeInbox/0.1 (server-side page fetcher)`. Some sites block that fetcher anyway. Wikipedia returns 403 to our HTTP client on a TLS fingerprint check, while browser requests with the same user agent succeed. PostgreSQL documentation and most static sites accept the fetcher. A production version sends the page fetch through a headless browser for such hosts, or uses the host's published API when one exists.

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests/ -q
```

The suite covers the store round-trip, the chunker, the HTML extractor, the URL fetch, the embedding output shape, the RAG loop, and all three endpoints. Every test runs offline: the fetch uses a mock transport and the LLM calls are faked.

## Layout

```
backend/app/   config, store, text, embed, rag, main
backend/tests/ one test module per app module
frontend/src/  the home screen: composer wired to POST /query, Saved drawer wired to GET /items, ingest through the composer popover to POST /ingest. The aurora ambient is pure CSS
```

