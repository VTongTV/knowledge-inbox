"""fastapi app: three endpoints over the store and the rag pipeline"""

import json
import logging
import sys
from contextlib import asynccontextmanager
from functools import partial
from typing import AsyncIterator, Literal

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import Settings, load_settings
from app.embed import embed
from app.rag import LLMError, answer
from app.store import Store, StoreError
from app.text import FetchError, chunk_text, extract_text, fetch_url

logger = logging.getLogger(__name__)
settings = load_settings()


class _JsonFormatter(logging.Formatter):
    """one log line as json so a log shipper can parse every field"""

    def format(self, record: logging.LogRecord) -> str:
        """write level, logger, message, and the record time as one json object"""
        payload = {
            "ts": super().formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        return json.dumps(payload)


def _configure_logging() -> None:
    """attach the json formatter to the root handler once"""
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JsonFormatter("%(message)s"))
        root.addHandler(handler)
        root.setLevel(logging.INFO)


class IngestRequest(BaseModel):
    """post body for /ingest; content is plain text or a url"""

    type: Literal["note", "url"] = Field(description="note or url")
    content: str = Field(min_length=1, description="the note text or the url")


class QueryRequest(BaseModel):
    """post body for /query"""

    question: str = Field(min_length=1, description="the question to answer")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """open the sqlite store at startup, close it at shutdown"""
    startup_settings: Settings = app.state.settings
    try:
        app.state.store = Store(startup_settings.db_path)
    except StoreError as exc:
        logger.error("startup failed: %s", exc)
        raise
    logger.info("startup ok; store at %s", startup_settings.db_path)
    yield
    app.state.store.close()
    logger.info("shutdown ok; store closed")


def create_app(startup_settings: Settings | None = None) -> FastAPI:
    """build the app; startup_settings injects settings for tests"""
    app_settings = startup_settings if startup_settings is not None else settings
    app = FastAPI(title="Knowledge Inbox", version="0.1.0", lifespan=lifespan)
    app.state.settings = app_settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/ingest", status_code=202)
    def ingest(body: IngestRequest, request: Request, background_tasks: BackgroundTasks) -> dict[str, object]:
        """fetch and validate now; embed and store the item in the background"""
        store: Store = request.app.state.store
        app_settings: Settings = request.app.state.settings
        if body.type == "url":
            try:
                page = fetch_url(body.content, timeout=app_settings.fetch_timeout)
            except FetchError as exc:
                logger.warning("ingest fetch rejected: %s", exc)
                raise HTTPException(status_code=502, detail=f"fetch failed: {exc}") from exc
            except httpx.HTTPError as exc:
                logger.warning("ingest fetch failed: %s", exc)
                raise HTTPException(status_code=502, detail=f"fetch failed: {exc}") from exc
            raw = extract_text(page)
            source = body.content
        else:
            raw = body.content
            source = ""
        chunks = chunk_text(
            raw, size=app_settings.chunk_size, overlap=app_settings.chunk_overlap
        )
        if not chunks:
            logger.warning("ingest held no text: type=%s", body.type)
            raise HTTPException(status_code=400, detail="content held no text to index")
        logger.info("ingest: %d chunks for type=%s, embed deferred", len(chunks), body.type)
        try:
            item = store.add_item_shell(body.type, raw, source)
        except StoreError as exc:
            logger.error("ingest shell write failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"store write failed: {exc}") from exc
        background_tasks.add_task(_embed_and_store_item, store, app_settings, item["id"], chunks)
        return {
            "id": item["id"],
            "type": item["type"],
            "source": item["source"],
            "created_at": item["created_at"],
            "chunks": 0,
            "status": "pending",
        }

    @app.get("/items")
    def list_items(request: Request) -> list[dict[str, object]]:
        """list every saved item with a preview and a chunk count"""
        store: Store = request.app.state.store
        try:
            return store.list_items()
        except StoreError as exc:
            logger.error("list store read failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"store read failed: {exc}") from exc

    @app.post("/query")
    def query(body: QueryRequest, request: Request) -> dict[str, object]:
        """answer a question from the saved content, with cited sources"""
        store: Store = request.app.state.store
        app_settings: Settings = request.app.state.settings
        embed_fn = partial(embed, model_name=app_settings.embed_model)
        try:
            return answer(body.question, store, app_settings, embed_fn=embed_fn)
        except LLMError as exc:
            logger.warning("query llm failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return app


def _embed_and_store_item(store: Store, app_settings: Settings, item_id: int, chunks: list[str]) -> None:
    """embed the chunk texts and attach them to the shell item"""
    try:
        vectors = embed(chunks, model_name=app_settings.embed_model)
        store.add_item_chunks(item_id, chunks, vectors)
    except Exception as exc:
        logger.error(
            "background embed failed for item %d: %s; deleting the shell item", item_id, exc
        )
        try:
            store.delete_item(item_id)
        except StoreError as cleanup_exc:
            logger.error("cleanup for item %d failed: %s", item_id, cleanup_exc)





_configure_logging()
app = create_app()
