"""tests for the three endpoints; fakes keep embedder, llm, and network out"""

import contextlib
from dataclasses import replace
from typing import Any, Iterator

import httpx
import numpy as np
from fastapi.testclient import TestClient

from app import main
from app.config import load_settings
from app.rag import LLMError
from app.store import Store


@contextlib.contextmanager
def _client(tmp_path: Any) -> Iterator[TestClient]:
    """an app whose store lives in the tmp dir; the with block runs the lifespan"""
    settings = replace(
        load_settings(),
        db_path=str(tmp_path / "api.db"),
        embed_model="BAAI/bge-small-en-v1.5",
    )
    with TestClient(main.create_app(settings)) as client:
        yield client


def _fake_embed(texts: list[str], model_name: str = "test") -> list[np.ndarray]:
    """return one deterministic vector per text, length 4 for any input"""
    return [np.zeros(4, dtype=np.float32) for _ in texts]


def _ingest_note(client: TestClient) -> dict[str, Any]:
    """post one note and return the response body"""
    response = client.post(
        "/ingest", json={"type": "note", "content": "sqlite stores chunks. cosine sorts them."}
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_root_items_empty(tmp_path: Any) -> None:
    """an empty inbox lists no items"""
    with _client(tmp_path) as client:
        assert client.get("/items").json() == []


def test_ingest_note_round_trip(tmp_path: Any, monkeypatch: Any) -> None:
    """a note ingests, then shows in items with a chunk count"""
    monkeypatch.setattr(main, "embed", _fake_embed)
    with _client(tmp_path) as client:
        body = _ingest_note(client)
        assert body["type"] == "note"
        assert body["source"] == ""
        assert body["chunks"] == 0
        assert body["status"] == "pending"
        items = client.get("/items").json()
        assert items[0]["id"] == body["id"]
        assert items[0]["chunk_count"] == 1
        assert items[0]["preview"]


def test_ingest_note_held_no_text(tmp_path: Any, monkeypatch: Any) -> None:
    """a whitespace-only note cannot produce a chunk, so the api rejects it"""
    monkeypatch.setattr(main, "embed", _fake_embed)
    with _client(tmp_path) as client:
        response = client.post("/ingest", json={"type": "note", "content": "   "})
        assert response.status_code == 400
        assert "no text" in response.json()["detail"]


def test_ingest_bad_type_rejected(tmp_path: Any) -> None:
    """a type outside note and url fails validation"""
    with _client(tmp_path) as client:
        response = client.post("/ingest", json={"type": "email", "content": "x"})
        assert response.status_code == 422


def test_ingest_empty_content_rejected(tmp_path: Any) -> None:
    """an empty content string fails validation"""
    with _client(tmp_path) as client:
        response = client.post("/ingest", json={"type": "note", "content": ""})
        assert response.status_code == 422


def test_ingest_url_happy_path(tmp_path: Any, monkeypatch: Any) -> None:
    """a url ingests: the server fetches, extracts, chunks, and stores"""
    monkeypatch.setattr(main, "embed", _fake_embed)

    def fake_fetch(url: str, timeout: float = 10.0) -> str:
        """stand in for the network fetch"""
        assert url == "https://example.com/a"
        return "<html><body><p>scale breaks above fifty thousand chunks.</p></body></html>"

    monkeypatch.setattr(main, "fetch_url", fake_fetch)
    with _client(tmp_path) as client:
        response = client.post(
            "/ingest", json={"type": "url", "content": "https://example.com/a"}
        )
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["type"] == "url"
        assert body["source"] == "https://example.com/a"
        items = client.get("/items").json()
        assert items[0]["preview"].startswith("scale breaks above")


def test_ingest_url_fetch_error_gives_502(tmp_path: Any, monkeypatch: Any) -> None:
    """a failed fetch yields 502 with the cause in the detail"""
    monkeypatch.setattr(main, "embed", _fake_embed)

    def fake_fetch(url: str, timeout: float = 10.0) -> str:
        """stand in for a dead host"""
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(main, "fetch_url", fake_fetch)
    with _client(tmp_path) as client:
        response = client.post(
            "/ingest", json={"type": "url", "content": "https://example.com/a"}
        )
        assert response.status_code == 502
        assert "fetch failed" in response.json()["detail"]


def test_query_on_empty_store_answers_without_llm(tmp_path: Any) -> None:
    """an empty inbox returns guidance, not an error"""
    with _client(tmp_path) as client:
        response = client.post("/query", json={"question": "what did I save?"})
        assert response.status_code == 200
        body = response.json()
        assert body["sources"] == []
        assert "No content is saved" in body["answer"]


def test_query_empty_question_rejected(tmp_path: Any) -> None:
    """an empty question fails validation"""
    with _client(tmp_path) as client:
        assert client.post("/query", json={"question": ""}).status_code == 422


def test_query_returns_answer_and_sources(tmp_path: Any, monkeypatch: Any) -> None:
    """a query reaches the llm and returns its answer with the sources"""

    def fake_answer(
        question: str, store: Store, app_settings: object, embed_fn: object = None
    ) -> dict[str, object]:
        """stand in for the rag pipeline"""
        assert question == "what stores the chunks?"
        return {
            "answer": "per [1], sqlite stores the chunks",
            "sources": [
                {"item_id": 1, "chunk_index": 0, "text": "sqlite stores chunks", "score": 0.9}
            ],
        }

    monkeypatch.setattr(main, "answer", fake_answer)
    with _client(tmp_path) as client:
        response = client.post("/query", json={"question": "what stores the chunks?"})
        assert response.status_code == 200
        body = response.json()
        assert body["answer"].startswith("per [1]")
        assert body["sources"][0]["text"] == "sqlite stores chunks"


def test_query_llm_failure_gives_502(tmp_path: Any, monkeypatch: Any) -> None:
    """an llm failure surfaces as 502 with the llm error text"""
    monkeypatch.setattr(
        main,
        "answer",
        lambda question, store, app_settings, embed_fn=None: (_ for _ in ()).throw(
            LLMError("OPENROUTER_API_KEY is not set")
        ),
    )
    with _client(tmp_path) as client:
        response = client.post("/query", json={"question": "what stores the chunks?"})
        assert response.status_code == 502
        assert "OPENROUTER_API_KEY" in response.json()["detail"]


